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
    { id: 'pessoal', label: 'Cartão/dinheiro pessoal' },
    { id: 'corporativo', label: 'Cartão corporativo' },
  ];

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

  function expensesInWeek(expenses, startIso) {
    const end = addDays(startIso, 6);
    return expenses
      .filter((e) => e.date >= startIso && e.date <= end)
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

  function summarize(expenses, budgetCents) {
    const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
    const byDay = {};
    let total = 0;
    let reimbursable = 0;
    let corporate = 0;
    for (const e of expenses) {
      total += e.amount;
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
      byDay[e.date] = (byDay[e.date] || 0) + e.amount;
      if (e.payment === 'corporativo') corporate += e.amount;
      else if (e.reimbursable) reimbursable += e.amount;
    }
    return {
      total,
      count: expenses.length,
      byCategory,
      byDay,
      reimbursable,
      corporate,
      outOfPocket: total - corporate - reimbursable,
      remaining: budgetCents > 0 ? budgetCents - total : null,
    };
  }

  function csvCell(value) {
    const s = String(value ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // CSV com ';' e vírgula decimal, que abre direto no Excel em português.
  function toCSV(expenses) {
    const header = ['Data', 'Categoria', 'Descrição', 'Cidade', 'Pagamento', 'Reembolsável', 'Valor'];
    const rows = expenses.map((e) => {
      const [y, m, d] = e.date.split('-');
      const cat = CATEGORIES.find((c) => c.id === e.category);
      const pay = PAYMENTS.find((p) => p.id === e.payment);
      return [
        `${d}/${m}/${y}`,
        cat ? cat.label : e.category,
        e.description,
        e.city,
        pay ? pay.label : e.payment,
        e.reimbursable ? 'Sim' : 'Não',
        (e.amount / 100).toFixed(2).replace('.', ','),
      ].map(csvCell).join(';');
    });
    return '﻿' + [header.join(';'), ...rows].join('\r\n');
  }

  const api = {
    CATEGORIES, PAYMENTS, parseDate, toISODate, addDays, weekStart, weekDays,
    expensesInWeek, parseAmount, formatMoney, summarize, toCSV,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
