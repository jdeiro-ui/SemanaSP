// Regras de negócio puras (sem DOM) — usadas pelo app e pelos testes em Node.
(function (root) {
  const CATEGORIES = [
    { id: 'hospedagem', label: 'Hospedagem', icon: '🏨', color: '#6366f1' },
    { id: 'alimentacao', label: 'Alimentação', icon: '🍽️', color: '#f59e0b' },
    { id: 'transporte', label: 'Transporte', icon: '🚕', color: '#10b981' },
    { id: 'combustivel', label: 'Combustível', icon: '⛽', color: '#ef4444' },
    { id: 'passagem', label: 'Passagem', icon: '✈️', color: '#0ea5e9' },
    { id: 'outros', label: 'Outros', icon: '📎', color: '#64748b' },
  ];

  const PAYMENTS = [
    { id: 'nubank', label: 'Nubank', color: '#8a05be' },
    { id: 'unlimited', label: 'Unlimited', color: '#0ea5e9' },
    { id: 'ticket', label: 'Ticket', color: '#e11d48' },
    { id: 'pix', label: 'Pix/dinheiro', color: '#10b981' },
  ];

  // Formas de pagamento de versões anteriores do app, só para exibição.
  const LEGACY_PAYMENTS = { pessoal: 'Pessoal', corporativo: 'Corporativo', outro: 'Outro' };

  const CITIES = ['Rio de Janeiro', 'São Paulo'];
  const AIRLINES = ['LATAM', 'GOL', 'Azul'];

  // Formas de pagamento que aceitam parcelamento.
  const INSTALLMENT_PAYMENTS = ['nubank', 'unlimited'];
  const MAX_INSTALLMENTS = 12;

  function installmentsOf(e) {
    return INSTALLMENT_PAYMENTS.includes(e.payment) && e.installments > 1 ? e.installments : 1;
  }

  function paymentLabel(id) {
    const p = PAYMENTS.find((x) => x.id === id);
    return p ? p.label : LEGACY_PAYMENTS[id] || id || '';
  }

  const pad = (n) => String(n).padStart(2, '0');

  // 'YYYY-MM-DD' -> Date local (evita o deslocamento de fuso de new Date('YYYY-MM-DD')).
  function parseDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function toISODate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function addDays(iso, days) {
    const d = parseDate(iso);
    d.setDate(d.getDate() + days);
    return toISODate(d);
  }

  // Semanas começam na segunda-feira.
  function weekStart(iso) {
    const d = parseDate(iso);
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return toISODate(d);
  }

  function weekDays(startIso) {
    return Array.from({ length: 7 }, (_, i) => addDays(startIso, i));
  }

  function daysBetween(fromIso, toIso) {
    const [a, b] = [fromIso, toIso].map((iso) => {
      const [y, m, d] = iso.split('-').map(Number);
      return Date.UTC(y, m - 1, d);
    });
    return Math.round((b - a) / 86400000);
  }

  // Número de noites de uma hospedagem (0 se não tiver check-out válido).
  function nights(e) {
    return e.category === 'hospedagem' && e.checkout && e.checkout > e.date ? daysBetween(e.date, e.checkout) : 0;
  }

  // Passagem com volta em outro dia tem dois trechos; senão, um.
  function hasReturnLeg(e) {
    return e.category === 'passagem' && !!e.returnDate && e.returnDate > e.date;
  }

  // Divide `amount` em n partes inteiras; os centavos que sobram vão para as primeiras.
  function split(amount, n) {
    const base = Math.floor(amount / n);
    const extra = amount - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
  }

  // Distribui o valor pelos dias: hospedagem vira uma parcela por noite, passagem
  // metade na ida e metade na volta (contando na semana da viagem, não da compra);
  // o resto fica num dia só.
  function allocate(e) {
    const n = nights(e);
    if (n) return split(e.amount, n).map((amount, i) => ({ date: addDays(e.date, i), amount }));
    if (hasReturnLeg(e)) {
      const [ida, volta] = split(e.amount, 2);
      return [{ date: e.date, amount: ida }, { date: e.returnDate, amount: volta }];
    }
    return [{ date: e.date, amount: e.amount }];
  }

  function inRange(date, startIso) {
    return !startIso || (date >= startIso && date <= addDays(startIso, 6));
  }

  // Parte da despesa que cai na semana: { amount, nights, legs } — nights só para
  // hospedagem; legs (trechos na semana) só para passagem com volta.
  function weekShare(e, startIso) {
    const parts = allocate(e).filter((a) => inRange(a.date, startIso));
    return {
      amount: parts.reduce((sum, a) => sum + a.amount, 0),
      nights: nights(e) ? parts.length : 0,
      legs: hasReturnLeg(e) ? parts.length : 0,
    };
  }

  function expensesInWeek(expenses, startIso) {
    return expenses
      .filter((e) => allocate(e).some((a) => inRange(a.date, startIso)))
      .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
  }

  // Valores são guardados em centavos (inteiros) para evitar erros de ponto flutuante.
  function parseAmount(text) {
    if (typeof text === 'number') return Math.round(text * 100);
    let s = String(text).trim().replace(/[R$\s]/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const value = Number(s);
    return Number.isFinite(value) ? Math.round(value * 100) : NaN;
  }

  function formatMoney(cents) {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // Com `startIso`, conta só a parte de cada despesa que cai naquela semana.
  function summarize(expenses, budgetCents, startIso = null) {
    const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
    const byPayment = {};
    const byDay = {};
    let total = 0;
    let reimbursable = 0;
    for (const e of expenses) {
      for (const a of allocate(e)) {
        if (!inRange(a.date, startIso)) continue;
        total += a.amount;
        byCategory[e.category] = (byCategory[e.category] || 0) + a.amount;
        byPayment[e.payment] = (byPayment[e.payment] || 0) + a.amount;
        byDay[a.date] = (byDay[a.date] || 0) + a.amount;
        if (e.reimbursable) reimbursable += a.amount;
      }
    }
    return {
      total,
      count: expenses.length,
      byCategory,
      byPayment,
      byDay,
      reimbursable,
      notReimbursable: total - reimbursable,
      remaining: budgetCents > 0 ? budgetCents - total : null,
    };
  }

  function csvCell(value) {
    const s = String(value ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const brDate = (iso) => iso.split('-').reverse().join('/');
  const brMoney = (cents) => (cents / 100).toFixed(2).replace('.', ',');

  // CSV com ';' e vírgula decimal, que abre direto no Excel em português.
  // Com `startIso`, "Valor" é a parte da semana e "Valor total" o valor cheio.
  // "Data" é o check-in na hospedagem e a ida na passagem.
  function toCSV(expenses, startIso = null) {
    const header = ['Data', 'Check-out/Volta', 'Noites', 'Categoria', 'Descrição', 'Cidade', 'Pagamento', 'Parcelas',
      'Reembolsável', 'Data da compra', 'Companhia aérea', 'Localizador', 'Valor', 'Valor total'];
    const rows = expenses.map((e) => {
      const cat = CATEGORIES.find((c) => c.id === e.category);
      const share = weekShare(e, startIso);
      const isFlight = e.category === 'passagem';
      const end = nights(e) ? e.checkout : isFlight && e.returnDate ? e.returnDate : '';
      return [
        brDate(e.date),
        end ? brDate(end) : '',
        nights(e) ? (share.nights === nights(e) ? share.nights : `${share.nights} de ${nights(e)}`) : '',
        cat ? cat.label : e.category,
        e.description,
        e.city,
        paymentLabel(e.payment),
        installmentsOf(e) > 1 ? `${installmentsOf(e)}x` : '',
        e.reimbursable ? 'Sim' : 'Não',
        isFlight && e.purchaseDate ? brDate(e.purchaseDate) : '',
        isFlight ? e.airline || '' : '',
        isFlight ? e.locator || '' : '',
        brMoney(share.amount),
        brMoney(e.amount),
      ].map(csvCell).join(';');
    });
    return '\ufeff' + [header.join(';'), ...rows].join('\r\n');
  }

  // Acrescenta despesas importadas sem duplicar: ids já existentes são ignorados.
  function mergeExpenses(existing, incoming) {
    const ids = new Set(existing.map((e) => e.id));
    const valid = incoming.filter((e) => e && e.id && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isInteger(e.amount));
    const added = valid.filter((e) => !ids.has(e.id) && ids.add(e.id));
    return { expenses: [...existing, ...added], added: added.length, skipped: incoming.length - added.length };
  }

  const api = {
    CATEGORIES, PAYMENTS, CITIES, AIRLINES, INSTALLMENT_PAYMENTS, MAX_INSTALLMENTS, installmentsOf, hasReturnLeg, paymentLabel, parseDate, toISODate, addDays, weekStart, weekDays,
    nights, allocate, weekShare, mergeExpenses, expensesInWeek, parseAmount, formatMoney, summarize, toCSV,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
