// Aba "Análises": indicadores, gasto por mês (colunas empilhadas por categoria),
// médias por categoria e tabela por ano. Lê as despesas salvas pelo app.js.
(function () {
  const { CATEGORIES, CHART_ORDER, analytics, yearsWithData, formatMoney, toISODate } = Calc;
  const $ = (sel) => document.querySelector(sel);
  const STORAGE_KEY = 'semanasp:v1';
  const catLabel = (id) => (CATEGORIES.find((c) => c.id === id) || { label: id }).label;
  const color = (id) => `var(--cat-${id})`;
  let selectedYear = null; // null = todo o histórico
  let lastResult = null;

  function expenses() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)).expenses || []; } catch (_) { return []; }
  }

  const monthName = (key, style = 'short') => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: style }).replace('.', '');
  };

  // R$ 1.234 / R$ 12 mil — para eixos e espaços curtos.
  const compact = (cents) => {
    const v = cents / 100;
    if (v >= 1000) return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: v >= 10000 ? 0 : 1 })} mil`;
    return `R$ ${Math.round(v)}`;
  };
  const money0 = (cents) => formatMoney(Math.round(cents / 100) * 100).replace(/,00$/, '');

  // ---------- Abas ----------
  function showTab(tab) {
    document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $('#view-week').hidden = tab !== 'week';
    $('#view-stats').hidden = tab !== 'stats';
    $('#fab').hidden = tab !== 'week';
    if (tab === 'stats') render();
    try { sessionStorage.setItem('semanasp:tab', tab); } catch (_) { /* sem armazenamento */ }
  }
  document.querySelector('.tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });

  // ---------- Renderização ----------
  function render() {
    const all = expenses();
    const today = toISODate(new Date());
    const years = yearsWithData(all);
    if (selectedYear === null && !render.initialized) {
      const current = Number(today.slice(0, 4));
      selectedYear = years.includes(current) ? current : years[0] || null;
      render.initialized = true;
    }
    $('#stats-years').innerHTML = [...years.slice().reverse(), null].map((y) =>
      `<button type="button" data-year="${y ?? ''}" aria-pressed="${y === selectedYear}">${y ?? 'Tudo'}</button>`).join('');

    const r = analytics(all, selectedYear, today);
    lastResult = r;
    $('#kpi-total').textContent = money0(r.total);
    $('#kpi-total-sub').textContent = r.trips ? `em ${r.trips} ${r.trips === 1 ? 'viagem' : 'viagens'}` : 'nenhuma viagem ainda';
    $('#kpi-month').textContent = money0(r.avgPerMonth);
    $('#kpi-month-sub').textContent = `${r.activeMonths} ${r.activeMonths === 1 ? 'mês' : 'meses'} com viagem`;
    $('#kpi-trip').textContent = money0(r.avgPerTrip);
    $('#kpi-trip-sub').textContent = 'semana com gasto';
    $('#kpi-sched').textContent = money0(r.scheduled);

    renderLegend(r);
    renderChart(r);
    renderMonthTable(r);
    renderCategories(r);
    renderYears(all, years, today);
  }

  function usedCategories(r) {
    return CHART_ORDER.filter((c) => r.months.some((m) => m.byCategory[c] > 0));
  }

  function renderLegend(r) {
    const cats = usedCategories(r);
    const hasFuture = r.months.some((m) => m.future && m.total > 0);
    $('#month-legend').innerHTML = cats.map((c) => `<span><i style="background:${color(c)}"></i>${catLabel(c)}</span>`).join('')
      + (r.avgPerMonth ? '<span><i class="avg"></i>Média mensal</span>' : '')
      + (hasFuture ? '<span><i class="future"></i>Mais claro = agendado</span>' : '');
  }

  function niceMax(v) {
    if (v <= 0) return 100000;
    const p = 10 ** Math.floor(Math.log10(v));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  function renderChart(r) {
    const el = $('#month-chart');
    const W = Math.max(280, el.clientWidth || 340);
    const H = 210, top = 16, bottom = 22, left = 46, right = 6;
    const plotW = W - left - right, plotH = H - top - bottom;
    const n = r.months.length;
    if (!n) { el.innerHTML = '<p class="muted center">Sem despesas no período.</p>'; return; }
    const max = niceMax(Math.max(...r.months.map((m) => m.total), r.avgPerMonth));
    const y = (v) => top + plotH - (v / max) * plotH;
    const band = plotW / n;
    const barW = Math.max(4, Math.min(24, band * 0.62));
    const GAP = 2, R = 4;

    let svg = '';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      svg += `<line class="${i ? 'grid' : 'base'}" x1="${left}" x2="${W - right}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text x="${left - 6}" y="${yy + 3}" text-anchor="end">${i ? compact(v) : '0'}</text>`;
    }

    r.months.forEach((m, i) => {
      const cx = left + band * i + band / 2, x = cx - barW / 2;
      let col = '';
      let base = y(0);
      const segs = CHART_ORDER.filter((c) => m.byCategory[c] > 0);
      segs.forEach((c, j) => {
        const h = (m.byCategory[c] / max) * plotH;
        const isTop = j === segs.length - 1;
        const hh = Math.max(0.5, isTop ? h : h - GAP); // folga de 2px entre segmentos
        const yTop = base - h;
        if (isTop && hh > R) {
          // ponta arredondada só no topo da coluna, base reta
          col += `<path fill="${color(c)}" d="M${x},${base} V${yTop + R} Q${x},${yTop} ${x + R},${yTop} H${x + barW - R} Q${x + barW},${yTop} ${x + barW},${yTop + R} V${base} Z"/>`;
        } else {
          col += `<rect fill="${color(c)}" x="${x}" y="${isTop ? yTop : yTop + GAP}" width="${barW}" height="${hh}"/>`;
        }
        base -= h;
      });
      const label = n <= 12 || i % 2 === 0 || m.key.endsWith('-01') ? monthName(m.key).slice(0, n > 12 ? 1 : 3) : '';
      const yearMark = n > 12 && m.key.endsWith('-01') ? `’${m.key.slice(2, 4)}` : '';
      svg += `<g class="col" data-i="${i}">
        <rect class="hit" x="${left + band * i}" y="${top}" width="${band}" height="${plotH}"/>
        <g opacity="${m.future ? 0.4 : 1}">${col}</g>
        <text x="${cx}" y="${H - 6}" text-anchor="middle">${label}${yearMark}</text>
      </g>`;
    });

    if (r.avgPerMonth) {
      const ya = y(r.avgPerMonth);
      svg += `<line class="avg" x1="${left}" x2="${W - right}" y1="${ya}" y2="${ya}"/>`;
      svg += `<text class="avg-label" x="${W - right}" y="${ya - 4}" text-anchor="end">média ${compact(r.avgPerMonth)}</text>`;
    }

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Gasto por mês, colunas empilhadas por categoria">${svg}</svg><div class="tooltip" hidden></div>`;
    el.dataset.band = band;
    el.dataset.left = left;
  }

  function showTip(i) {
    const el = $('#month-chart');
    const tip = el.querySelector('.tooltip');
    if (!tip) return; // gráfico ainda não desenhado
    const m = lastResult && lastResult.months[i];
    el.querySelectorAll('.col').forEach((g) => g.classList.toggle('active', Number(g.dataset.i) === i));
    if (!m) { tip.hidden = true; return; }
    const rows = CHART_ORDER.filter((c) => m.byCategory[c] > 0).reverse().map((c) =>
      `<div class="row"><span><i style="background:${color(c)}"></i>${catLabel(c)}</span>${formatMoney(m.byCategory[c])}</div>`).join('');
    const status = m.scheduled && m.done ? ` · ${formatMoney(m.scheduled)} agendado` : m.scheduled ? ' · agendado' : '';
    tip.innerHTML = `<b>${monthName(m.key, 'long')} ${m.key.slice(0, 4)}${status}</b>${rows || '<span class="muted">Sem gastos</span>'}`
      + (rows ? `<div class="row tot"><span>Total</span>${formatMoney(m.total)}</div>` : '');
    tip.hidden = false;
    const band = Number(el.dataset.band), left = Number(el.dataset.left);
    const cx = left + band * i + band / 2;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(0, cx - w / 2), el.clientWidth - w)}px`;
    tip.style.top = '-8px';
  }

  const chartEl = $('#month-chart');
  chartEl.addEventListener('pointerover', (ev) => {
    const g = ev.target.closest('.col');
    if (g) showTip(Number(g.dataset.i));
  });
  chartEl.addEventListener('click', (ev) => {
    const g = ev.target.closest('.col');
    if (g) showTip(Number(g.dataset.i));
  });
  chartEl.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType === 'mouse') showTip(-1);
  });
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('#month-chart')) showTip(-1);
  });

  function renderMonthTable(r) {
    const rows = r.months.filter((m) => m.total > 0).map((m) => `
      <tr class="${m.future ? 'future' : ''}"><td>${monthName(m.key)}/${m.key.slice(2, 4)}</td>
      <td>${m.done ? formatMoney(m.done) : '—'}</td><td>${m.scheduled ? formatMoney(m.scheduled) : '—'}</td></tr>`).join('');
    $('#month-table').innerHTML = rows
      ? `<table class="data"><thead><tr><th>Mês</th><th>Realizado</th><th>Agendado</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="muted">Sem despesas no período.</p>';
  }

  function renderCategories(r) {
    const cats = CHART_ORDER.filter((c) => r.byCategory[c] > 0);
    const max = Math.max(1, ...cats.map((c) => r.byCategory[c]));
    $('#stats-categories').innerHTML = cats.map((c) => {
      const share = (r.byCategory[c] / r.total) * 100;
      const pct = share > 0 && share < 1 ? '<1' : Math.round(share);
      const extra = c === 'hospedagem' && r.avgPerNight ? ` · ${formatMoney(r.avgPerNight)} por noite` : '';
      return `<li>
        <div class="label"><span>${(CATEGORIES.find((x) => x.id === c) || {}).icon || ''} ${catLabel(c)}</span><b>${formatMoney(r.byCategory[c])} <span class="muted">${pct}%</span></b></div>
        <div class="track"><div class="fill" style="width:${(r.byCategory[c] / max) * 100}%;background:${color(c)}"></div></div>
        <div class="sub">${formatMoney(r.avgPerTripByCategory[c])} por viagem${extra}</div>
      </li>`;
    }).join('') || '<li class="muted">Nenhum gasto realizado no período.</li>';
  }

  function renderYears(all, years, today) {
    const rows = years.slice().reverse().map((y) => {
      const r = analytics(all, y, today);
      return `<tr><td>${y}</td><td>${money0(r.total)}</td><td>${r.trips}</td><td>${money0(r.avgPerTrip)}</td><td>${r.scheduled ? money0(r.scheduled) : '—'}</td></tr>`;
    }).join('');
    $('#year-table').innerHTML = rows
      ? `<table class="data"><thead><tr><th>Ano</th><th>Realizado</th><th>Viagens</th><th>Média/viagem</th><th>Agendado</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="muted">Sem despesas.</p>';
  }

  $('#stats-years').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-year]');
    if (!b) return;
    selectedYear = b.dataset.year ? Number(b.dataset.year) : null;
    render();
  });

  window.addEventListener('semanasp:remote', () => { if (!$('#view-stats').hidden) render(); });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!$('#view-stats').hidden) render(); }, 150);
  });

  try { if (sessionStorage.getItem('semanasp:tab') === 'stats') showTab('stats'); } catch (_) { /* sem armazenamento */ }
})();
