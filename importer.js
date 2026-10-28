// Importação de planilhas (regras puras, sem DOM): lê linhas já extraídas do arquivo,
// sugere colunas e converte em despesas do app. A tela fica em import-ui.js.
(function (root) {
  const Calc = root.Calc || (typeof require === 'function' ? require('./calc.js') : null);

  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const pad = (n) => String(n).padStart(2, '0');

  // ---------- CSV ----------
  // Detecta o separador (; , ou tab) pela primeira linha e respeita aspas.
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0];
    const sep = [';', '\t', ','].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  // ---------- Células ----------
  // Data em: número serial do Excel, Date, dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd, "12 de mai. de 2026".
  function parseDateCell(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    if (typeof v === 'number') {
      if (v < 20000 || v > 80000) return null; // fora de ~1954–2119: não é data
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
    if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
    m = norm(s).match(/^(\d{1,2})\s*(?:de\s+)?([a-z]{3})[a-z]*\.?\s*(?:de\s+)?(\d{4})/);
    if (m && MONTHS.includes(m[2])) return valid(+m[3], MONTHS.indexOf(m[2]) + 1, +m[1]);
    return null;
  }
  function valid(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1950 || y > 2150) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }

  // Valor em centavos; negativos (extratos) viram positivos.
  function parseAmountCell(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? Math.abs(Math.round(v * 100)) : null;
    const cents = Calc.parseAmount(String(v).replace(/^\s*-\s*/, '').replace(/^\((.*)\)$/, '$1'));
    return Number.isFinite(cents) ? Math.abs(cents) : null;
  }

  const parseBool = (v) => /^(s|sim|x|yes|y|true|1|verdadeiro|reembols)/.test(norm(v));

  // ---------- Cabeçalho e colunas ----------
  // Linha de cabeçalho: entre as 15 primeiras, a primeira com ao menos 2 textos e
  // alguma linha logo abaixo com data e valor.
  function findHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const texts = rows[i].filter((c) => typeof c === 'string' && c.trim() && !parseDateCell(c) && parseAmountCell(c) === null);
      if (texts.length < 2) continue;
      const below = rows.slice(i + 1, i + 4);
      if (below.some((r) => r.some((c) => parseDateCell(c)) && r.some((c) => typeof c === 'number' || /\d+,\d{2}/.test(String(c))))) return i;
    }
    return 0;
  }

  const FIELDS = [
    { key: 'date', label: 'Data', required: true, re: /^(data|date|dia)\b|data (da )?(despesa|compra|lancamento|ida|check.?in)|check.?in|^ida$/ },
    { key: 'amount', label: 'Valor', required: true, re: /valor|value|amount|total|preco|quantia|r\$/ },
    { key: 'description', label: 'Descrição', re: /descri|histor|estabelec|loja|item|detalhe|nome|^o que|^gasto|^despesa$|^onde/ },
    { key: 'category', label: 'Categoria', re: /categ|tipo|grupo/ },
    { key: 'payment', label: 'Forma de pagamento', re: /pagamento|^pago|forma|cartao|meio/ },
    { key: 'city', label: 'Cidade', re: /cidade|local|city|destino/ },
    { key: 'reimbursable', label: 'Reembolsável', re: /reemb/ },
    { key: 'endDate', label: 'Check-out / volta', re: /check.?out|saida|volta|data final|^fim|^ate\b/ },
  ];

  // Sugere a coluna de cada campo pelo nome do cabeçalho (cada coluna usada uma vez).
  function guessColumns(headers) {
    const used = new Set();
    const out = {};
    const order = ['endDate', 'reimbursable', 'payment', 'category', 'city', 'date', 'amount', 'description'];
    for (const key of order) {
      const f = FIELDS.find((x) => x.key === key);
      const i = headers.findIndex((h, idx) => !used.has(idx) && f.re.test(norm(h)));
      if (i >= 0) { out[key] = i; used.add(i); }
    }
    return out;
  }

  // ---------- Tradução de valores ----------
  const CATEGORY_HINTS = [
    ['hospedagem', /hosped|hotel|pousada|airbnb|booking|diaria/],
    ['passagem', /passag|voo|aere|aviao|bilhete/],
    ['alimentacao', /aliment|refei|comida|restaur|lanche|almoco|jantar|cafe|mercado/],
    ['transporte', /transp|uber|taxi|99|onibus|metro|combust|gasolina|estaciona|pedagio|carro/],
  ];

  // Categoria do app para um texto da planilha: pelo nome/ícone das categorias do
  // usuário, depois por palavras-chave; senão Outros.
  function guessCategory(value, categories) {
    const v = norm(value);
    if (!v) return 'outros';
    const exact = categories.find((c) => norm(c.label) === v || c.id === v);
    if (exact) return exact.id;
    const hint = CATEGORY_HINTS.find(([id, re]) => re.test(v) && categories.some((c) => c.id === id));
    return hint ? hint[0] : 'outros';
  }

  // Forma de pagamento: crédito, Ticket, Pix/dinheiro; outra coisa fica com o próprio texto.
  function guessPayment(value) {
    const v = norm(value);
    if (!v) return 'credito';
    if (/debito|pix|dinheiro|especie|transfer|boleto/.test(v)) return 'pix';
    if (/ticket|vale|\bvr\b|\bva\b|alelo|sodexo|pluxee|flash|caju|vr ?benef/.test(v)) return 'ticket';
    if (/credito|cartao|nubank|itau|bradesco|santander|inter|c6|visa|master|elo|amex|unlimited/.test(v)) return 'credito';
    return 'keep';
  }

  // Valores distintos de uma coluna (para a tela de tradução), do mais frequente ao menos.
  function distinctValues(rows, col) {
    const count = new Map();
    for (const r of rows) {
      const v = String(r[col] ?? '').trim();
      if (v) count.set(v, (count.get(v) || 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n }));
  }

  // Id estável por conteúdo: reimportar o mesmo arquivo não duplica.
  function stableId(parts) {
    let h = 2166136261;
    for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return 'imp-' + (h >>> 0).toString(36);
  }

  // Converte linhas em despesas. `map`: campo -> índice da coluna; `categoryMap` e
  // `paymentMap`: texto da planilha -> id no app ('keep' = manter o texto).
  // `from`/`to` (opcionais, aaaa-mm-dd) limitam o período.
  function buildExpenses(rows, { map, categoryMap = {}, paymentMap = {}, from = null, to = null, source = '' }) {
    const expenses = [], skipped = [];
    const seen = new Map();
    rows.forEach((r, i) => {
      const line = i + 1;
      if (!r.some((c) => String(c ?? '').trim() !== '')) return; // linha vazia: ignora sem avisar
      const date = parseDateCell(r[map.date]);
      const amount = parseAmountCell(r[map.amount]);
      if (!date) return skipped.push({ line, reason: 'sem data válida' });
      if (amount === null) return skipped.push({ line, reason: 'sem valor' });
      if ((from && date < from) || (to && date > to)) return skipped.push({ line, reason: 'fora do período escolhido' });
      const get = (k) => (map[k] === undefined || map[k] === null ? '' : String(r[map[k]] ?? '').trim());
      const catText = get('category');
      const payText = get('payment');
      const category = map.category !== undefined ? (categoryMap[catText] || 'outros') : 'outros';
      const pay = map.payment !== undefined ? (paymentMap[payText] || 'credito') : 'credito';
      const e = {
        date, amount, category,
        payment: pay === 'keep' ? payText : pay,
        description: get('description'),
        city: get('city'),
        reimbursable: map.reimbursable !== undefined ? parseBool(get('reimbursable')) : false,
      };
      const end = map.endDate !== undefined ? parseDateCell(r[map.endDate]) : null;
      if (end && end > date && category === 'hospedagem') e.checkout = end;
      if (end && end >= date && category === 'passagem') e.returnDate = end;
      const base = stableId([source, date, amount, e.description, catText]);
      const n = (seen.get(base) || 0) + 1; // linhas idênticas no mesmo arquivo continuam distintas
      seen.set(base, n);
      e.id = n > 1 ? `${base}-${n}` : base;
      e.createdAt = Date.now() + i;
      expenses.push(e);
    });
    return { expenses, skipped };
  }

  const api = {
    FIELDS, parseCSV, parseDateCell, parseAmountCell, findHeaderRow, guessColumns,
    guessCategory, guessPayment, distinctValues, buildExpenses,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Importer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
