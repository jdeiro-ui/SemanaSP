// Tela "Importar planilha": arquivo → colunas → tradução de categorias/pagamentos →
// prévia → importar (acrescenta, sem apagar). A leitura roda no aparelho; .xlsx/.xls
// usam a biblioteca SheetJS, carregada só quando necessária.
(function () {
  const SHEETJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const $ = (sel) => document.querySelector(sel);
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const colName = (i) => String.fromCharCode(65 + (i % 26)).repeat(Math.floor(i / 26) + 1); // A, B, … Z, AA…
  const dialog = $('#import-dialog');
  const form = $('#import-form');

  let book = null;     // { name, sheets: { nome: linhas[][] } }
  let rows = [];       // linhas da aba escolhida
  let header = 0;      // índice da linha de cabeçalho

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
      document.head.appendChild(s);
    });
  }

  async function readFile(file) {
    if (/\.csv$|\.txt$/i.test(file.name) || file.type === 'text/csv') {
      const buf = await file.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // CSV salvo pelo Excel
      return { name: file.name, sheets: { [file.name]: Importer.parseCSV(text) } };
    }
    if (!window.XLSX) await loadScript(SHEETJS_URL);
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheets = {};
    for (const n of wb.SheetNames) {
      // Linhas vazias ficam, para a numeração bater com a planilha.
      const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '', blankrows: true });
      if (r.some((row) => row.some((c) => String(c).trim() !== ''))) sheets[n] = r;
    }
    return { name: file.name, sheets };
  }

  const show = (id, on) => { $(id).hidden = !on; };

  function open() {
    form.reset();
    book = null;
    ['#imp-sheet-field', '#imp-header-field', '#imp-map', '#imp-values', '#imp-preview-box'].forEach((id) => show(id, false));
    $('#imp-status').textContent = 'Escolha um arquivo .xlsx, .xls ou .csv. A leitura acontece só neste aparelho.';
    $('#imp-go').disabled = true;
    dialog.showModal();
  }

  $('#import-open').addEventListener('click', () => { $('#settings-dialog').close(); open(); });
  $('#imp-cancel').addEventListener('click', () => dialog.close());

  $('#imp-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    $('#imp-status').textContent = 'Lendo o arquivo…';
    try {
      book = await readFile(file);
    } catch (err) {
      $('#imp-status').textContent = 'Não consegui ler o arquivo. Na primeira vez com .xlsx é preciso internet. ' + (err.message || '');
      return;
    }
    const names = Object.keys(book.sheets);
    if (!names.length) { $('#imp-status').textContent = 'A planilha está vazia.'; return; }
    $('#imp-sheet').innerHTML = names.map((n) => `<option>${esc(n)}</option>`).join('');
    show('#imp-sheet-field', names.length > 1);
    $('#imp-status').textContent = `${file.name}: ${names.length} ${names.length === 1 ? 'aba' : 'abas'}.`;
    selectSheet(names[0]);
  });

  $('#imp-sheet').addEventListener('change', (ev) => selectSheet(ev.target.value));

  function selectSheet(name) {
    rows = book.sheets[name];
    header = Importer.findHeaderRow(rows);
    $('#imp-header').innerHTML = rows.slice(0, 15).map((r, i) => (r.some((c) => String(c).trim() !== '')
      ? `<option value="${i}" ${i === header ? 'selected' : ''}>Linha ${i + 1}: ${esc(r.filter((c) => c !== '').slice(0, 4).join(' · ').slice(0, 60))}</option>` : '')).join('');
    show('#imp-header-field', true);
    buildColumns();
  }

  $('#imp-header').addEventListener('change', (ev) => { header = Number(ev.target.value); buildColumns(); });

  const dataRows = () => rows.slice(header + 1);

  function buildColumns() {
    const heads = rows[header] || [];
    const width = Math.max(...rows.slice(header, header + 20).map((r) => r.length));
    const guess = Importer.guessColumns(heads.map(String));
    const sample = (i) => { const r = dataRows().find((row) => String(row[i] ?? '').trim()); return r ? r[i] : ''; };
    const options = (sel) => ['<option value="">— não usar —</option>'].concat(Array.from({ length: width }, (_, i) =>
      `<option value="${i}" ${sel === i ? 'selected' : ''}>${colName(i)}: ${esc(String(heads[i] || sample(i) || '').slice(0, 30))}</option>`)).join('');
    $('#imp-cols').innerHTML = Importer.FIELDS.map((f) => `
      <label>${f.label}${f.required ? ' *' : ''}
        <select data-field="${f.key}">${options(guess[f.key])}</select>
      </label>`).join('');
    show('#imp-map', true);
    buildValueMaps();
  }

  function currentMap() {
    const map = {};
    document.querySelectorAll('#imp-cols select').forEach((s) => { if (s.value !== '') map[s.dataset.field] = Number(s.value); });
    return map;
  }

  function buildValueMaps() {
    const map = currentMap();
    const cats = window.Categories.list();
    const catOpts = (sel) => cats.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.icon)} ${esc(c.label)}</option>`).join('');
    const payOpts = (sel, raw) => Calc.PAYMENTS.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${p.label}</option>`).join('')
      + `<option value="keep" ${sel === 'keep' ? 'selected' : ''}>Manter “${esc(raw)}”</option>`;
    // Só linhas que serão importadas (com data e valor): totais e anotações ficam de fora.
    const usable = map.date === undefined || map.amount === undefined ? dataRows()
      : dataRows().filter((r) => Importer.parseDateCell(r[map.date]) && Importer.parseAmountCell(r[map.amount]) !== null);
    const values = (col) => (col === undefined ? [] : Importer.distinctValues(usable, col).slice(0, 40));
    const catVals = values(map.category);
    const payVals = values(map.payment);
    $('#imp-cats').innerHTML = catVals.length ? catVals.map(({ value, n }) => `
      <label class="vmap"><span>${esc(value)} <small class="muted">(${n})</small></span>
        <select data-cat="${esc(value)}">${catOpts(Importer.guessCategory(value, cats))}</select></label>`).join('')
      : '<p class="muted small">Sem coluna de categoria: tudo entra como Outros (dá para mudar depois).</p>';
    $('#imp-pays').innerHTML = payVals.length ? payVals.map(({ value, n }) => `
      <label class="vmap"><span>${esc(value)} <small class="muted">(${n})</small></span>
        <select data-pay="${esc(value)}">${payOpts(Importer.guessPayment(value), value)}</select></label>`).join('')
      : '<p class="muted small">Sem coluna de pagamento: tudo entra como Cartão de crédito.</p>';
    show('#imp-values', true);
    preview();
  }

  let result = null;
  function preview() {
    const map = currentMap();
    const missing = Importer.FIELDS.filter((f) => f.required && map[f.key] === undefined).map((f) => f.label);
    if (missing.length) {
      $('#imp-preview').innerHTML = `<p class="note warn">Escolha a coluna de: ${missing.join(' e ')}.</p>`;
      show('#imp-preview-box', true);
      $('#imp-go').disabled = true;
      return;
    }
    const categoryMap = {}, paymentMap = {};
    document.querySelectorAll('#imp-cats select').forEach((s) => { categoryMap[s.dataset.cat] = s.value; });
    document.querySelectorAll('#imp-pays select').forEach((s) => { paymentMap[s.dataset.pay] = s.value; });
    result = Importer.buildExpenses(dataRows(), {
      map, categoryMap, paymentMap, from: form.from.value || null, to: form.to.value || null,
      source: `${book.name}|${$('#imp-sheet').value || ''}`,
    });
    const existing = new Set(window.SemanaSP.getState().expenses.map((e) => e.id));
    const fresh = result.expenses.filter((e) => !existing.has(e.id)).length;
    const reasons = {};
    for (const s of result.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
    const cat = (id) => window.Categories.get(id);
    const fmtDate = (iso) => iso.split('-').reverse().join('/');
    $('#imp-preview').innerHTML = `
      <p><b>${result.expenses.length}</b> ${result.expenses.length === 1 ? 'despesa pronta' : 'despesas prontas'}`
      + (fresh < result.expenses.length ? ` · ${result.expenses.length - fresh} já estão no app` : '') + `</p>`
      + (result.skipped.length ? `<p class="muted small">${result.skipped.length} ${result.skipped.length === 1 ? 'linha ignorada' : 'linhas ignoradas'}: `
        + Object.entries(reasons).map(([r, n]) => `${n} ${r}`).join(', ')
        + ` (ex.: linha ${header + 1 + result.skipped[0].line} da planilha)</p>` : '')
      + `<table class="data"><thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Valor</th></tr></thead><tbody>`
      + result.expenses.slice(0, 6).map((e) => `<tr><td>${fmtDate(e.date)}</td><td>${esc(cat(e.category).icon)} ${esc(cat(e.category).label)}</td>
          <td>${esc(e.description).slice(0, 28)}</td><td>${Calc.formatMoney(e.amount)}</td></tr>`).join('')
      + `</tbody></table>`
      + (result.expenses.length > 6 ? `<p class="muted small">… e mais ${result.expenses.length - 6}.</p>` : '');
    show('#imp-preview-box', true);
    $('#imp-go').disabled = fresh === 0;
    $('#imp-go').textContent = fresh ? `Importar ${fresh} ${fresh === 1 ? 'despesa' : 'despesas'}` : 'Nada novo para importar';
  }

  $('#imp-cols').addEventListener('change', buildValueMaps);
  $('#imp-values').addEventListener('change', preview);
  form.from.addEventListener('change', preview);
  form.to.addEventListener('change', preview);

  $('#imp-go').addEventListener('click', () => {
    if (!result) return;
    const r = window.SemanaSP.importExpenses(result.expenses);
    dialog.close();
    alert(`${r.added} ${r.added === 1 ? 'despesa importada' : 'despesas importadas'}.`
      + (r.skipped ? ` ${r.skipped} já estavam no app.` : '') + ' Dá para editar qualquer uma tocando nela.');
  });
})();
