// Regras de negócio puras (sem DOM) — usadas pelo app e pelos testes em Node.
(function (root) {
  const CATEGORIES = [
    { id: 'hospedagem', label: 'Hospedagem', icon: '🏨' },
    { id: 'alimentacao', label: 'Alimentação', icon: '🍽️' },
    { id: 'transporte', label: 'Transporte', icon: '🚕' },
    { id: 'passagem', label: 'Passagem', icon: '✈️' },
    { id: 'outros', label: 'Outros', icon: '📎' },
  ];

  // Ordem fixa das categorias nos gráficos (empilhamento e legenda). As cores
  // (--cat-<id> em styles.css) seguem esta ordem numa paleta validada para daltonismo.
  const CHART_ORDER = ['hospedagem', 'passagem', 'alimentacao', 'transporte', 'outros'];

  // Categorias que deixaram de existir e para onde as despesas antigas vão.
  const RETIRED_CATEGORIES = { combustivel: 'outros' };

  const PAYMENTS = [
    { id: 'nubank', label: 'Nubank', color: '#8a05be' },
    { id: 'unlimited', label: 'Unlimited', color: '#0ea5e9' },
    { id: 'ticket', label: 'Ticket', color: '#e11d48' },
    { id: 'pix', label: 'Pix/dinheiro', color: '#10b981' },
  ];

  // Formas de pagamento de versões anteriores do app, só para exibição.
  const LEGACY_PAYMENTS = { pessoal: 'Pessoal', corporativo: 'Corporativo', outro: 'Outro' };

  const CITIES = ['Rio de Janeiro', 'São Paulo'];

  // Centro e raio (km) das cidades fixas, para reconhecer a cidade pela localização
  // sem consultar serviço externo. Inclui aeroportos (GIG, SDU, CGH, GRU).
  const CITY_AREAS = [
    { name: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729, radiusKm: 45 },
    { name: 'São Paulo', lat: -23.5505, lon: -46.6333, radiusKm: 45 },
  ];

  function distanceKm(lat1, lon1, lat2, lon2) {
    const rad = (d) => (d * Math.PI) / 180;
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
      + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(a));
  }

  // Cidade fixa mais próxima dentro do raio, ou null.
  function cityFromCoords(lat, lon) {
    const near = CITY_AREAS
      .map((c) => ({ name: c.name, d: distanceKm(lat, lon, c.lat, c.lon), r: c.radiusKm }))
      .filter((c) => c.d <= c.r)
      .sort((a, b) => a.d - b.d)[0];
    return near ? near.name : null;
  }
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

  const monthKey = (iso) => iso.slice(0, 7);

  function monthRange(fromKey, toKey) {
    const out = [];
    let [y, m] = fromKey.split('-').map(Number);
    const [ty, tm] = toKey.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) {
      out.push(`${y}-${String(m).padStart(2, '0')}`);
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }

  // Análises de um período. Cada valor entra no dia em que acontece (allocate);
  // o que cai depois de `todayIso` é "agendado" (ex.: passagens já compradas).
  // Uma "viagem" é uma semana com gasto maior que zero.
  // `year`: número do ano, ou null para todo o histórico.
  function analytics(expenses, year, todayIso) {
    const parts = [];
    for (const e of expenses) {
      for (const a of allocate(e)) {
        if (year && Number(a.date.slice(0, 4)) !== year) continue;
        parts.push({ ...a, category: e.category, nights: nights(e) ? 1 : 0 });
      }
    }
    const keys = parts.map((a) => monthKey(a.date)).sort();
    const months = year
      ? monthRange(`${year}-01`, `${year}-12`)
      : keys.length ? monthRange(keys[0], keys[keys.length - 1]) : [];
    const todayMonth = monthKey(todayIso);
    const byMonth = Object.fromEntries(months.map((k) => [k, {
      key: k, total: 0, done: 0, scheduled: 0, byCategory: {}, future: k > todayMonth,
    }]));

    const done = { total: 0, byCategory: {}, nights: 0, weeks: {}, months: new Set() };
    let scheduled = 0;
    for (const a of parts) {
      const m = byMonth[monthKey(a.date)];
      m.total += a.amount;
      m.byCategory[a.category] = (m.byCategory[a.category] || 0) + a.amount;
      if (a.date > todayIso) {
        m.scheduled += a.amount;
        scheduled += a.amount;
        continue;
      }
      m.done += a.amount;
      done.total += a.amount;
      done.byCategory[a.category] = (done.byCategory[a.category] || 0) + a.amount;
      if (a.category === 'hospedagem') done.nights += a.nights;
      const w = weekStart(a.date);
      done.weeks[w] = (done.weeks[w] || 0) + a.amount;
      if (a.amount > 0) done.months.add(monthKey(a.date));
    }
    const trips = Object.values(done.weeks).filter((v) => v > 0).length;
    const lodging = done.byCategory.hospedagem || 0;
    return {
      months: months.map((k) => byMonth[k]),
      total: done.total,
      scheduled,
      trips,
      activeMonths: done.months.size,
      avgPerMonth: done.months.size ? Math.round(done.total / done.months.size) : 0,
      avgPerTrip: trips ? Math.round(done.total / trips) : 0,
      byCategory: done.byCategory,
      avgPerTripByCategory: Object.fromEntries(Object.entries(done.byCategory)
        .map(([c, v]) => [c, trips ? Math.round(v / trips) : 0])),
      avgPerNight: done.nights ? Math.round(lodging / done.nights) : 0,
    };
  }

  // Orçado x realizado: cada semana de viagem (semana encerrada com gasto) é comparada
  // ao orçamento semanal. A semana entra no mês da sua segunda-feira.
  // `year`: número do ano, ou null para todo o histórico.
  function budgetReport(expenses, year, budgetCents, todayIso) {
    const weeks = {};
    for (const e of expenses) {
      for (const a of allocate(e)) {
        const w = weekStart(a.date);
        weeks[w] = (weeks[w] || 0) + a.amount;
      }
    }
    const done = Object.entries(weeks)
      .filter(([w, total]) => total > 0 && addDays(w, 6) < todayIso && (!year || Number(w.slice(0, 4)) === year))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([start, spent]) => ({ start, spent, diff: spent - budgetCents }));
    const byMonth = {};
    for (const w of done) {
      const m = byMonth[monthKey(w.start)] || (byMonth[monthKey(w.start)] = { key: monthKey(w.start), trips: 0, spent: 0, over: 0 });
      m.trips++;
      m.spent += w.spent;
      if (w.diff > 0) m.over++;
    }
    const months = Object.values(byMonth).sort((a, b) => (a.key < b.key ? -1 : 1))
      .map((m) => ({ ...m, budget: m.trips * budgetCents, diff: m.spent - m.trips * budgetCents }));
    const spent = done.reduce((s, w) => s + w.spent, 0);
    return {
      weeks: done,
      months,
      trips: done.length,
      spent,
      budget: done.length * budgetCents,
      diff: spent - done.length * budgetCents,
      overCount: done.filter((w) => w.diff > 0).length,
    };
  }

  // Anos com algum gasto, do mais recente para o mais antigo.
  function yearsWithData(expenses) {
    const ys = new Set();
    for (const e of expenses) for (const a of allocate(e)) ys.add(Number(a.date.slice(0, 4)));
    return [...ys].sort((a, b) => b - a);
  }

  // ---------- Sincronização ----------
  // Cada despesa tem `updatedAt` (ms); exclusões viram marcas { id: updatedAt } em
  // `deleted`, para um aparelho offline não ressuscitar o que outro apagou.
  // Em conflito, vale a mudança mais recente.
  const stamp = (e) => e.updatedAt || e.createdAt || 0;

  // Aplica documentos remotos ({ id, updatedAt, deleted?, ...campos }) ao estado local.
  function syncMerge(expenses, deleted, remoteDocs) {
    const byId = new Map(expenses.map((e) => [e.id, e]));
    const tomb = { ...deleted };
    let changed = false;
    for (const r of remoteDocs) {
      const local = byId.get(r.id);
      const localStamp = local ? stamp(local) : tomb[r.id] || -1;
      if (stamp(r) <= localStamp) continue;
      changed = true;
      if (r.deleted) {
        byId.delete(r.id);
        tomb[r.id] = stamp(r);
      } else {
        const { deleted: _d, ...doc } = r;
        byId.set(r.id, doc);
        delete tomb[r.id];
      }
    }
    return { expenses: [...byId.values()], deleted: tomb, changed };
  }

  // O que precisa subir: despesas e exclusões locais mais novas que a versão remota.
  // `remote` é um Map id -> documento remoto.
  function pendingUploads(expenses, deleted, remote) {
    const out = [];
    for (const e of expenses) {
      const r = remote.get(e.id);
      if (!r || stamp(e) > stamp(r)) out.push({ ...e, updatedAt: stamp(e) });
    }
    for (const [id, at] of Object.entries(deleted || {})) {
      const r = remote.get(id);
      if (r && !r.deleted && at > stamp(r)) out.push({ id, deleted: true, updatedAt: at });
    }
    return out;
  }

  const api = {
    CATEGORIES, CHART_ORDER, RETIRED_CATEGORIES, PAYMENTS, cityFromCoords, analytics, budgetReport, yearsWithData, monthRange, CITIES, AIRLINES, INSTALLMENT_PAYMENTS, MAX_INSTALLMENTS, installmentsOf, hasReturnLeg, paymentLabel, parseDate, toISODate, addDays, weekStart, weekDays,
    nights, allocate, weekShare, mergeExpenses, syncMerge, pendingUploads, expensesInWeek, parseAmount, formatMoney, summarize, toCSV,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
