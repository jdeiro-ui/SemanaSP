(function () {
  const { CATEGORIES, PAYMENTS, CITIES, paymentLabel, nights, weekShare, toISODate, addDays, weekStart, weekDays, parseDate,
    expensesInWeek, parseAmount, formatMoney, summarize, toCSV } = Calc;

  const STORAGE_KEY = 'semanasp:v1';
  const $ = (sel) => document.querySelector(sel);

  // ---------- Persistência ----------
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (data && Array.isArray(data.expenses)) return { budget: 0, ...data };
    } catch (_) { /* dados corrompidos: começa do zero */ }
    return { expenses: [], budget: 0 };
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  const state = load();
  const today = () => toISODate(new Date());
  let currentWeek = weekStart(today());
  let editingId = null;
  let selectedCategory = CATEGORIES[0].id;

  // ---------- Renderização ----------
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtShort = (iso) => parseDate(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const weekdayShort = (iso) => parseDate(iso).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');

  function render() {
    const end = addDays(currentWeek, 6);
    $('#week-title').textContent = `${fmtShort(currentWeek)} – ${fmtShort(end)}`;
    $('#this-week').hidden = currentWeek === weekStart(today());

    const items = expensesInWeek(state.expenses, currentWeek);
    const s = summarize(items, state.budget, currentWeek);

    $('#total').textContent = formatMoney(s.total);
    $('#reimbursable').textContent = formatMoney(s.reimbursable);
    $('#not-reimbursable').textContent = formatMoney(s.notReimbursable);

    const budgetEl = $('#budget');
    if (state.budget > 0) {
      const pct = Math.min(100, (s.total / state.budget) * 100);
      const over = s.remaining < 0;
      budgetEl.className = 'budget' + (over ? ' over' : '');
      budgetEl.innerHTML = `
        ${over ? `Orçamento estourado em ${formatMoney(-s.remaining)}`
               : `Restam ${formatMoney(s.remaining)} de ${formatMoney(state.budget)}`}
        <div class="track"><div class="fill" style="width:${pct}%"></div></div>`;
      budgetEl.hidden = false;
    } else {
      budgetEl.hidden = true;
    }

    const maxCat = Math.max(1, ...Object.values(s.byCategory));
    $('#by-category').innerHTML = CATEGORIES
      .filter((c) => s.byCategory[c.id] > 0)
      .sort((a, b) => s.byCategory[b.id] - s.byCategory[a.id])
      .map((c) => `
        <li>
          <div class="label"><span>${c.icon} ${c.label}</span><b>${formatMoney(s.byCategory[c.id])}</b></div>
          <div class="track"><div class="fill" style="width:${(s.byCategory[c.id] / maxCat) * 100}%;background:${c.color}"></div></div>
        </li>`).join('') || '<li class="muted">Sem gastos.</li>';

    const maxPay = Math.max(1, ...Object.values(s.byPayment));
    const knownPay = PAYMENTS.map((p) => p.id);
    const payIds = [...knownPay, ...Object.keys(s.byPayment).filter((id) => !knownPay.includes(id))];
    $('#by-payment').innerHTML = payIds
      .filter((id) => s.byPayment[id] > 0)
      .sort((a, b) => s.byPayment[b] - s.byPayment[a])
      .map((id) => {
        const p = PAYMENTS.find((x) => x.id === id);
        return `
        <li>
          <div class="label"><span>${escapeHtml(paymentLabel(id))}</span><b>${formatMoney(s.byPayment[id])}</b></div>
          <div class="track"><div class="fill" style="width:${(s.byPayment[id] / maxPay) * 100}%;background:${p ? p.color : '#64748b'}"></div></div>
        </li>`;
      }).join('') || '<li class="muted">Sem gastos.</li>';

    const days = weekDays(currentWeek);
    const maxDay = Math.max(1, ...days.map((d) => s.byDay[d] || 0));
    $('#by-day').innerHTML = days.map((d) => {
      const v = s.byDay[d] || 0;
      return `
        <div class="day${d === today() ? ' today' : ''}">
          <span class="val">${v ? Math.round(v / 100) : ''}</span>
          <div class="col" style="height:${(v / maxDay) * 100}%"></div>
          <span class="name">${weekdayShort(d)}</span>
        </div>`;
    }).join('');

    $('#empty').hidden = items.length > 0;
    $('#export-csv').hidden = items.length === 0;
    $('#expense-list').innerHTML = items.slice().reverse().map((e) => {
      const c = CATEGORIES.find((x) => x.id === e.category) || CATEGORIES[CATEGORIES.length - 1];
      const n = nights(e);
      const share = weekShare(e, currentWeek);
      const when = n
        ? `${fmtShort(e.date)} → ${fmtShort(e.checkout)} · ${n} ${n === 1 ? 'noite' : 'noites'}`
        : `${weekdayShort(e.date)}, ${fmtShort(e.date)}`;
      const partial = share.amount !== e.amount
        ? `<div class="part">${share.nights} de ${n} noites nesta semana · total ${formatMoney(e.amount)}</div>` : '';
      const tags = `<span class="tags"><span class="tag">${escapeHtml(paymentLabel(e.payment))}</span>`
        + (e.reimbursable ? '<span class="tag refund">reembolsável</span>' : '') + '</span>';
      return `
        <li data-id="${e.id}">
          <span class="ico">${c.icon}</span>
          <div class="info">
            <div class="desc">${escapeHtml(e.description || c.label)}</div>
            <div class="muted">${when}${e.city ? ' · ' + escapeHtml(e.city) : ''}</div>${partial}
          </div>
          <div class="amt">${formatMoney(share.amount)}${tags}</div>
        </li>`;
    }).join('');
  }

  // ---------- Formulário de despesa ----------
  const dialog = $('#expense-dialog');
  const form = $('#expense-form');

  function renderCategoryPicker() {
    $('#category-picker').innerHTML = CATEGORIES.map((c) =>
      `<button type="button" data-cat="${c.id}" aria-pressed="${c.id === selectedCategory}">${c.icon} ${c.label}</button>`
    ).join('');
  }

  // `draft` traz campos pré-preenchidos (ex.: lidos de um print) para uma despesa nova.
  function openExpense(expense, draft = null, note = null) {
    editingId = expense ? expense.id : null;
    $('#form-title').textContent = expense ? 'Editar despesa' : 'Nova despesa';
    $('#delete-expense').hidden = !expense;
    $('#scan-note').hidden = !note;
    if (note) {
      $('#scan-note').textContent = note.text;
      $('#scan-note').className = 'note' + (note.warn ? ' warn' : '');
    }

    const thisWeek = weekStart(today()) === currentWeek;
    const last = state.expenses[state.expenses.length - 1];
    const src = expense || draft || {};
    form.amount.value = src.amount ? (src.amount / 100).toFixed(2).replace('.', ',') : '';
    form.date.value = src.date || (thisWeek ? today() : currentWeek);
    form.description.value = src.description || '';
    form.checkout.value = src.checkout || '';
    const lastPayment = last && PAYMENTS.some((p) => p.id === last.payment) ? last.payment : PAYMENTS[0].id;
    form.payment.value = expense && PAYMENTS.some((p) => p.id === expense.payment) ? expense.payment : lastPayment;
    form.reimbursable.checked = expense ? expense.reimbursable : false;
    selectedCategory = src.category || CATEGORIES[0].id;
    renderCategoryPicker();
    syncStay();

    const otherCities = [...new Set(state.expenses.map((e) => e.city))].filter((c) => c && !CITIES.includes(c));
    $('#cities').innerHTML = otherCities.map((c) => `<option value="${escapeHtml(c)}">`).join('');
    setCity(expense ? expense.city : src.city || (last ? last.city : CITIES[0]));

    dialog.showModal();
    if (!expense && !draft) form.amount.focus();
  }

  form.payment.innerHTML = PAYMENTS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');

  // Local: atalhos para as cidades fixas ou "Outro", que abre o campo para digitar.
  let cityIsOther = false;

  function setCity(city, other = !!city && !CITIES.includes(city)) {
    cityIsOther = other;
    form.city.value = city || '';
    form.city.hidden = !other;
    $('#city-picker').innerHTML = [...CITIES, 'Outro'].map((c) => {
      const pressed = c === 'Outro' ? other : !other && c === city;
      return `<button type="button" data-city="${c}" aria-pressed="${pressed}">${c === 'Outro' ? '✏️ Outro' : '📍 ' + c}</button>`;
    }).join('');
  }

  $('#city-picker').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-city]');
    if (!btn) return;
    if (btn.dataset.city !== 'Outro') return setCity(btn.dataset.city);
    setCity(cityIsOther ? form.city.value : '', true);
    form.city.focus();
  });

  $('#category-picker').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-cat]');
    if (!btn) return;
    selectedCategory = btn.dataset.cat;
    renderCategoryPicker();
    syncStay();
  });

  // Hospedagem: "Data" vira check-in, aparece o check-out e o valor por noite.
  function syncStay() {
    const isStay = selectedCategory === 'hospedagem';
    $('#date-label').textContent = isStay ? 'Check-in' : 'Data';
    $('#checkout-field').hidden = !isStay;
    form.checkout.required = isStay;
    form.checkout.setCustomValidity('');
    $('#stay-hint').hidden = !isStay;
    if (!isStay) return;
    if (!form.checkout.value && form.date.value) form.checkout.value = addDays(form.date.value, 1);
    const n = nights({ date: form.date.value, checkout: form.checkout.value });
    const amount = parseAmount(form.amount.value);
    const hint = $('#stay-hint');
    hint.classList.toggle('error', !n);
    if (!n) hint.textContent = 'O check-out precisa ser depois do check-in.';
    else hint.textContent = `${n} ${n === 1 ? 'noite' : 'noites'}`
      + (amount > 0 && n > 1 ? ` · ${formatMoney(Math.round(amount / n))} por noite` : '');
  }

  form.date.addEventListener('change', () => {
    // Check-in movido para depois do check-out: empurra o check-out para o dia seguinte.
    if (form.checkout.value && form.checkout.value <= form.date.value) form.checkout.value = addDays(form.date.value, 1);
    syncStay();
  });
  form.checkout.addEventListener('change', syncStay);
  form.amount.addEventListener('input', syncStay);

  form.addEventListener('submit', (ev) => {
    const amount = parseAmount(form.amount.value);
    if (!(amount > 0)) {
      ev.preventDefault();
      form.amount.setCustomValidity('Informe um valor maior que zero');
      form.amount.reportValidity();
      return;
    }
    const isStay = selectedCategory === 'hospedagem';
    if (isStay && !nights({ date: form.date.value, checkout: form.checkout.value })) {
      ev.preventDefault();
      form.checkout.setCustomValidity('O check-out precisa ser depois do check-in');
      form.checkout.reportValidity();
      return;
    }
    const data = {
      amount,
      checkout: isStay ? form.checkout.value : null,
      date: form.date.value,
      category: selectedCategory,
      description: form.description.value.trim(),
      city: form.city.value.trim(),
      payment: form.payment.value,
      reimbursable: form.reimbursable.checked,
    };
    if (editingId) {
      Object.assign(state.expenses.find((e) => e.id === editingId), data);
    } else {
      const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random());
      state.expenses.push({ id, createdAt: Date.now(), ...data });
    }
    save();
    currentWeek = weekStart(data.date);
    render();
  });
  form.amount.addEventListener('input', () => form.amount.setCustomValidity(''));
  form.checkout.addEventListener('input', () => form.checkout.setCustomValidity(''));

  $('#delete-expense').addEventListener('click', () => {
    if (!confirm('Excluir esta despesa?')) return;
    state.expenses = state.expenses.filter((e) => e.id !== editingId);
    save();
    dialog.close();
    render();
  });
  $('#cancel-expense').addEventListener('click', () => dialog.close());

  $('#fab').addEventListener('click', () => openExpense(null));
  $('#expense-list').addEventListener('click', (ev) => {
    const li = ev.target.closest('li[data-id]');
    if (li) openExpense(state.expenses.find((e) => e.id === li.dataset.id));
  });

  // ---------- Navegação ----------
  $('#prev-week').addEventListener('click', () => { currentWeek = addDays(currentWeek, -7); render(); });
  $('#next-week').addEventListener('click', () => { currentWeek = addDays(currentWeek, 7); render(); });
  $('#this-week').addEventListener('click', () => { currentWeek = weekStart(today()); render(); });

  // ---------- Exportação / backup ----------
  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('#export-csv').addEventListener('click', () => {
    const items = expensesInWeek(state.expenses, currentWeek);
    download(`despesas_${currentWeek}.csv`, toCSV(items, currentWeek), 'text/csv;charset=utf-8');
  });

  // ---------- Configurações ----------
  const settingsDialog = $('#settings-dialog');
  const settingsForm = $('#settings-form');

  $('#btn-settings').addEventListener('click', () => {
    settingsForm.budget.value = state.budget ? (state.budget / 100).toFixed(2).replace('.', ',') : '';
    settingsDialog.showModal();
  });
  $('#cancel-settings').addEventListener('click', () => settingsDialog.close());
  settingsForm.addEventListener('submit', () => {
    const v = parseAmount(settingsForm.budget.value);
    state.budget = v > 0 ? v : 0;
    save();
    render();
  });

  $('#backup-export').addEventListener('click', () => {
    download(`semanasp_backup_${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
  });
  $('#backup-import').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.expenses)) throw new Error('formato inválido');
      if (!confirm(`Substituir os dados atuais por ${data.expenses.length} despesas do backup?`)) return;
      state.expenses = data.expenses;
      state.budget = Number(data.budget) || 0;
      save();
      settingsDialog.close();
      render();
    } catch (err) {
      alert('Não foi possível ler o backup: ' + err.message);
    }
  });

  // ---------- Leitura de prints (OCR no aparelho) ----------
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const scanDialog = $('#scan-dialog');
  let ocrWorker = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
      document.head.appendChild(s);
    });
  }

  async function getOcrWorker() {
    if (ocrWorker) return ocrWorker;
    if (!window.Tesseract) await loadScript(TESSERACT_URL);
    ocrWorker = await Tesseract.createWorker('por', 1, {
      logger: (m) => {
        if (m.status === 'loading language traineddata') $('#scan-status').textContent = 'Preparando o leitor (só na 1ª vez)…';
        else if (m.status === 'recognizing text') $('#scan-status').textContent = `Lendo o print… ${Math.round(m.progress * 100)}%`;
      },
    });
    return ocrWorker;
  }

  async function scanImage(blob) {
    $('#scan-status').textContent = 'Lendo o print…';
    scanDialog.showModal();
    let result;
    try {
      const worker = await getOcrWorker();
      const { data } = await worker.recognize(blob);
      result = Receipt.parseReceipt(data.text, today());
    } catch (err) {
      scanDialog.close();
      alert('Não foi possível ler o print. Verifique a conexão na primeira vez que usar.\n\n' + (err.message || err));
      return;
    }
    scanDialog.close();

    const origin = result.source === 'uber' ? 'da corrida da Uber' : result.source === 'keeta' ? 'do pedido do Keeta' : 'do print';
    const problems = [];
    if (!result.amount) problems.push('Não encontrei o valor.');
    if (!result.date) problems.push('A data não aparece no print; usei a de hoje.');
    const note = { warn: problems.length > 0, text: `Lido ${origin}. ${problems.join(' ')} Confira antes de salvar.`.replace(/\s+/g, ' ') };
    if (!result.date) result.date = today();
    openExpense(null, result, note);
  }

  $('#scan-input').addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (file) scanImage(file);
  });

  // Imagem recebida pelo menu "Compartilhar" do Android (ver share_target no manifest e sw.js).
  async function consumeSharedImage() {
    const params = new URLSearchParams(location.search);
    if (!params.has('share')) return;
    history.replaceState(null, '', location.pathname);
    const cache = await caches.open('semanasp-share');
    const res = await cache.match('shared-image');
    if (!res) return;
    await cache.delete('shared-image');
    scanImage(await res.blob());
  }

  // ---------- Offline ----------
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
  if ('caches' in window) consumeSharedImage();
})();
