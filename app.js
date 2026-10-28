(function () {
  const { PAYMENTS, CITIES, AIRLINES, INSTALLMENT_PAYMENTS, MAX_INSTALLMENTS, installmentsOf,
    hasReturnLeg, paymentLabel, nights, weekShare, toISODate, addDays, weekStart, weekDays, parseDate,
    expensesInWeek, parseAmount, formatMoney, summarize, toCSV } = Calc;

  const APP_VERSION = '2026.10.28-1';
  const STORAGE_KEY = 'semanasp:v1';
  const $ = (sel) => document.querySelector(sel);

  // ---------- Persistência ----------
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (data && Array.isArray(data.expenses)) return { budget: 0, deleted: {}, ...data };
    } catch (_) { /* dados corrompidos: começa do zero */ }
    return { expenses: [], budget: 0, deleted: {} };
  }

  // Grava no aparelho e avisa o sync.js (backup na nuvem) que há mudanças.
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new Event('semanasp:saved'));
  }

  const state = load();
  const today = () => toISODate(new Date());

  // Despesas com categoria/forma de pagamento que saiu do app (Combustível, Nubank,
  // Unlimited) passam para a substituta. Também roda sobre o que chega da nuvem.
  function migrateAll() {
    let changed = false;
    for (const e of state.expenses) if (Calc.migrateExpense(e)) { e.updatedAt = Date.now(); changed = true; }
    return changed;
  }
  const migrated = migrateAll();

  // Categorias (de fábrica + personalizadas). Cores pelo `slot` (--slot-N); sem slot
  // (da 9ª em diante) usam a cor de Outros.
  const cats = () => Calc.resolveCategories(state.categories);
  const catById = (id) => cats().find((c) => c.id === id) || { id, label: id, icon: '📎', slot: 0 };
  const catColor = (id) => `var(--slot-${catById(id).slot || 5})`;
  window.Categories = { list: cats, get: catById, color: catColor };

  // Preferências deste aparelho (não vão para a nuvem).
  const pref = (key, fallback) => {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch (_) { return fallback; }
  };
  const setPref = (key, on) => { try { localStorage.setItem(key, on ? '1' : '0'); } catch (_) { /* sem armazenamento */ } };

  // Modo privado: troca os valores da tela por "R$ •••" (formulário e CSV seguem com os reais).
  window.Privacy = {
    on: pref('semanasp:privacy', false),
    money: (cents) => (window.Privacy.on ? 'R$ •••' : formatMoney(cents)),
  };
  const money = (cents) => window.Privacy.money(cents);
  let currentWeek = weekStart(today());
  let editingId = null;
  let selectedCategory = 'hospedagem';

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

    $('#total').textContent = money(s.total);
    $('#reimbursable').textContent = money(s.reimbursable);
    $('#not-reimbursable').textContent = money(s.notReimbursable);

    const budgetEl = $('#budget');
    if (state.budget > 0) {
      const pct = Math.min(100, (s.total / state.budget) * 100);
      const over = s.remaining < 0;
      budgetEl.className = 'budget' + (over ? ' over' : '');
      budgetEl.innerHTML = `
        ${over ? `Orçamento estourado em ${money(-s.remaining)}`
               : `Restam ${money(s.remaining)} de ${money(state.budget)}`}
        <div class="track"><div class="fill" style="width:${pct}%"></div></div>`;
      budgetEl.hidden = false;
    } else {
      budgetEl.hidden = true;
    }

    const maxCat = Math.max(1, ...Object.values(s.byCategory));
    $('#by-category').innerHTML = Object.keys(s.byCategory).map(catById)
      .filter((c) => s.byCategory[c.id] > 0)
      .sort((a, b) => s.byCategory[b.id] - s.byCategory[a.id])
      .map((c) => `
        <li>
          <div class="label"><span>${escapeHtml(c.icon)} ${escapeHtml(c.label)}</span><b>${money(s.byCategory[c.id])}</b></div>
          <div class="track"><div class="fill" style="width:${(s.byCategory[c.id] / maxCat) * 100}%;background:${catColor(c.id)}"></div></div>
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
          <div class="label"><span>${escapeHtml(paymentLabel(id))}</span><b>${money(s.byPayment[id])}</b></div>
          <div class="track"><div class="fill" style="width:${(s.byPayment[id] / maxPay) * 100}%;background:${p ? p.color : '#64748b'}"></div></div>
        </li>`;
      }).join('') || '<li class="muted">Sem gastos.</li>';

    const days = weekDays(currentWeek);
    const maxDay = Math.max(1, ...days.map((d) => s.byDay[d] || 0));
    $('#by-day').innerHTML = days.map((d) => {
      const v = s.byDay[d] || 0;
      return `
        <div class="day${d === today() ? ' today' : ''}">
          <span class="val">${v ? (window.Privacy.on ? '•••' : Math.round(v / 100)) : ''}</span>
          <div class="col" style="height:${(v / maxDay) * 100}%"></div>
          <span class="name">${weekdayShort(d)}</span>
        </div>`;
    }).join('');

    $('#empty').hidden = items.length > 0;
    $('#export-csv').hidden = items.length === 0;
    $('#expense-list').innerHTML = items.slice().reverse().map((e) => {
      const c = catById(e.category);
      const n = nights(e);
      const share = weekShare(e, currentWeek);
      const isFlight = e.category === 'passagem';
      let when = `${weekdayShort(e.date)}, ${fmtShort(e.date)}`;
      if (n) when = `${fmtShort(e.date)} → ${fmtShort(e.checkout)} · ${n} ${n === 1 ? 'noite' : 'noites'}`;
      else if (isFlight) {
        when = `Ida ${fmtShort(e.date)}${hasReturnLeg(e) ? ` → volta ${fmtShort(e.returnDate)}` : ''}`
          + (e.purchaseDate ? ` · comprada ${fmtShort(e.purchaseDate)}` : '');
      }
      let partial = '';
      if (share.amount !== e.amount) {
        const part = n ? `${share.nights} de ${n} noites` : weekShare({ ...e, returnDate: null }, currentWeek).amount ? 'Ida' : 'Volta';
        partial = `<div class="part">${part} nesta semana · total ${money(e.amount)}</div>`;
      }
      const inst = installmentsOf(e);
      const tags = `<span class="tags"><span class="tag">${escapeHtml(paymentLabel(e.payment))}${inst > 1 ? ` ${inst}x` : ''}</span>`
        + (e.reimbursable ? '<span class="tag refund">reembolsável</span>' : '') + '</span>';
      const title = e.description || (isFlight && (e.airline || e.locator)
        ? [c.label, e.airline, e.locator].filter(Boolean).join(' · ') : c.label);
      return `
        <li data-id="${e.id}">
          <span class="ico">${escapeHtml(c.icon)}</span>
          <div class="info">
            <div class="desc">${escapeHtml(title)}</div>
            <div class="muted">${when}${e.city ? ' · ' + escapeHtml(e.city) : ''}</div>${partial}
          </div>
          <div class="amt">${money(share.amount)}${tags}</div>
        </li>`;
    }).join('');
  }

  // ---------- Formulário de despesa ----------
  const dialog = $('#expense-dialog');
  const form = $('#expense-form');

  function renderCategoryPicker() {
    // Ocultas não aparecem, a não ser que seja a da despesa sendo editada.
    $('#category-picker').innerHTML = cats().filter((c) => !c.hidden || c.id === selectedCategory).map((c) =>
      `<button type="button" data-cat="${c.id}" aria-pressed="${c.id === selectedCategory}">${escapeHtml(c.icon)} ${escapeHtml(c.label)}</button>`
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
    form.amount.value = Number.isFinite(src.amount) ? (src.amount / 100).toFixed(2).replace('.', ',') : '';
    form.date.value = src.date || (thisWeek ? today() : currentWeek);
    form.description.value = src.description || '';
    form.checkout.value = src.checkout || '';
    form.returnDate.value = src.returnDate || '';
    form.purchaseDate.value = src.purchaseDate || today();
    form.locator.value = src.locator || '';
    setAirline(src.airline || '');
    const lastPayment = last && PAYMENTS.some((p) => p.id === last.payment) ? last.payment : PAYMENTS[0].id;
    const knownPayment = (id) => PAYMENTS.some((p) => p.id === id);
    form.payment.value = knownPayment(src.payment) ? src.payment : lastPayment;
    form.reimbursable.checked = expense ? expense.reimbursable : false;
    // Parcelas valem só para esta despesa: uma nova começa à vista (salvo se o SMS informar).
    form.installments.value = String(expense ? installmentsOf(expense) : (draft && draft.installments) || 1);
    syncInstallments();
    const firstVisible = (cats().find((c) => !c.hidden) || { id: 'outros' }).id;
    selectedCategory = src.category || firstVisible;
    renderCategoryPicker();
    syncDates();

    const otherCities = [...new Set(state.expenses.map((e) => e.city))].filter((c) => c && !CITIES.includes(c));
    $('#cities').innerHTML = otherCities.map((c) => `<option value="${escapeHtml(c)}">`).join('');
    setCity(expense ? expense.city : src.city || (last ? last.city : CITIES[0]));
    cityTouched = false;
    $('#geo-hint').hidden = true;
    if (!expense && !(draft && draft.city)) suggestCityFromLocation();

    dialog.showModal();
    if (!expense && !draft) form.amount.focus();
  }

  form.payment.innerHTML = PAYMENTS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');

  // Local: atalhos para as cidades fixas ou "Outro", que abre o campo para digitar.
  let cityIsOther = false;
  let cityTouched = false; // escolhido à mão: a localização não sobrescreve
  form.city.addEventListener('input', () => { cityTouched = true; });

  // Cidade pela localização: Rio/SP pela distância (sem serviço externo); outras
  // cidades pelo OpenStreetMap. A posição é reaproveitada por 10 minutos.
  let geoCache = null;
  function locateCity() {
    if (!pref('semanasp:geo', true) || !navigator.geolocation) return Promise.resolve(null);
    if (geoCache && Date.now() - geoCache.at < 10 * 60 * 1000) return Promise.resolve(geoCache.city);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(async ({ coords }) => {
        let city = Calc.cityFromCoords(coords.latitude, coords.longitude);
        if (!city) {
          try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=pt-BR&lat=${coords.latitude}&lon=${coords.longitude}`;
            const a = (await (await fetch(url)).json()).address || {};
            city = a.city || a.town || a.village || a.municipality || null;
          } catch (_) { city = null; }
        }
        geoCache = { city, at: Date.now() };
        resolve(city);
      }, () => resolve(null), { timeout: 15000, maximumAge: 10 * 60 * 1000 });
    });
  }

  async function suggestCityFromLocation() {
    const city = await locateCity();
    if (!city || cityTouched || !dialog.open || editingId) return;
    setCity(city);
    $('#geo-hint').textContent = `📍 ${city} · pela sua localização`;
    $('#geo-hint').hidden = false;
  }

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
    cityTouched = true;
    $('#geo-hint').hidden = true;
    if (btn.dataset.city !== 'Outro') return setCity(btn.dataset.city);
    setCity(cityIsOther ? form.city.value : '', true);
    form.city.focus();
  });

  $('#category-picker').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-cat]');
    if (!btn) return;
    selectedCategory = btn.dataset.cat;
    renderCategoryPicker();
    syncDates();
  });

  // Hospedagem: "Data" vira check-in, aparece o check-out e o valor por noite.
  // Passagem: "Data" vira ida, aparecem volta, data da compra, companhia e localizador.
  function syncDates() {
    const isStay = selectedCategory === 'hospedagem';
    const isFlight = selectedCategory === 'passagem';
    $('#date-label').textContent = isStay ? 'Check-in' : isFlight ? 'Ida' : 'Data';
    $('#return-field').hidden = !isFlight;
    $('#flight-fields').hidden = !isFlight;
    form.returnDate.setCustomValidity('');
    syncStay(isStay);
  }

  function syncStay(isStay = selectedCategory === 'hospedagem') {
    $('#checkout-field').hidden = !isStay;
    form.checkout.required = isStay;
    form.checkout.setCustomValidity('');
    $('#stay-hint').hidden = !isStay;
    if (!isStay) return;
    if (!form.checkout.value && form.date.value) form.checkout.value = addDays(form.date.value, 1);
    const n = nights({ category: 'hospedagem', date: form.date.value, checkout: form.checkout.value });
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
  form.checkout.addEventListener('change', () => syncStay());
  form.amount.addEventListener('input', () => { syncStay(); syncInstallments(); });
  form.returnDate.addEventListener('input', () => form.returnDate.setCustomValidity(''));
  form.locator.addEventListener('input', () => {
    const pos = form.locator.selectionStart;
    form.locator.value = form.locator.value.toUpperCase();
    form.locator.setSelectionRange(pos, pos);
  });

  // Companhia aérea: atalhos ou "Outra" para digitar.
  function setAirline(name, other = !!name && !AIRLINES.includes(name)) {
    form.airline.value = name || '';
    form.airline.hidden = !other;
    $('#airline-picker').innerHTML = [...AIRLINES, 'Outra'].map((a) => {
      const pressed = a === 'Outra' ? other : !other && a === name;
      return `<button type="button" data-airline="${a}" aria-pressed="${pressed}">${a === 'Outra' ? '✏️ Outra' : a}</button>`;
    }).join('');
  }

  $('#airline-picker').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-airline]');
    if (!btn) return;
    if (btn.dataset.airline !== 'Outra') return setAirline(btn.dataset.airline);
    setAirline(form.airline.hidden || AIRLINES.includes(form.airline.value) ? '' : form.airline.value, true);
    form.airline.focus();
  });

  // Parcelas: só para Nubank e Unlimited; opções mostram o valor de cada parcela.
  function syncInstallments() {
    const allowed = INSTALLMENT_PAYMENTS.includes(form.payment.value);
    $('#installments-field').hidden = !allowed;
    const amount = parseAmount(form.amount.value);
    const current = form.installments.value || '1';
    form.installments.innerHTML = Array.from({ length: MAX_INSTALLMENTS }, (_, i) => {
      const k = i + 1;
      const label = k === 1 ? 'À vista' : amount > 0 ? `${k}x ${formatMoney(Math.round(amount / k))}` : `${k}x`;
      return `<option value="${k}">${label}</option>`;
    }).join('');
    form.installments.value = current;
  }
  form.payment.addEventListener('change', syncInstallments);

  form.addEventListener('submit', (ev) => {
    const amount = parseAmount(form.amount.value);
    if (!(amount >= 0)) {
      ev.preventDefault();
      form.amount.setCustomValidity('Informe o valor');
      form.amount.reportValidity();
      return;
    }
    const isStay = selectedCategory === 'hospedagem';
    const isFlight = selectedCategory === 'passagem';
    if (isStay && !nights({ category: 'hospedagem', date: form.date.value, checkout: form.checkout.value })) {
      ev.preventDefault();
      form.checkout.setCustomValidity('O check-out precisa ser depois do check-in');
      form.checkout.reportValidity();
      return;
    }
    if (isFlight && form.returnDate.value && form.returnDate.value < form.date.value) {
      ev.preventDefault();
      form.returnDate.setCustomValidity('A volta não pode ser antes da ida');
      form.returnDate.reportValidity();
      return;
    }
    const installments = Number(form.installments.value);
    const data = {
      amount,
      checkout: isStay ? form.checkout.value : null,
      returnDate: isFlight ? form.returnDate.value || null : null,
      purchaseDate: isFlight ? form.purchaseDate.value || null : null,
      airline: isFlight ? form.airline.value.trim() || null : null,
      locator: isFlight ? form.locator.value.trim().toUpperCase() || null : null,
      installments: INSTALLMENT_PAYMENTS.includes(form.payment.value) && installments > 1 ? installments : null,
      date: form.date.value,
      category: selectedCategory,
      description: form.description.value.trim(),
      city: form.city.value.trim(),
      payment: form.payment.value,
      reimbursable: form.reimbursable.checked,
    };
    data.updatedAt = Date.now();
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
    state.deleted[editingId] = Date.now();
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
    download(`despesas_${currentWeek}.csv`, toCSV(items, currentWeek, cats()), 'text/csv;charset=utf-8');
  });

  // ---------- Configurações ----------
  const settingsDialog = $('#settings-dialog');
  const settingsForm = $('#settings-form');

  $('#btn-settings').addEventListener('click', () => {
    settingsForm.budget.value = state.budget ? (state.budget / 100).toFixed(2).replace('.', ',') : '';
    settingsForm.geo.checked = pref('semanasp:geo', true);
    catDraft = cats().map((c) => ({ ...c }));
    catRemoved = [];
    renderCatEditor();
    settingsDialog.showModal();
  });

  // ---------- Editor de categorias (aplicado só ao salvar as configurações) ----------
  let catDraft = [];
  let catRemoved = [];

  function readCatEditor() {
    document.querySelectorAll('#cat-editor li').forEach((li) => {
      const c = catDraft.find((x) => x.id === li.dataset.id);
      c.icon = li.querySelector('.cat-icon').value.trim();
      c.label = li.querySelector('.cat-label').value.trim();
      const show = li.querySelector('.cat-show input');
      if (show) c.hidden = !show.checked;
    });
  }

  function renderCatEditor() {
    $('#cat-editor').innerHTML = catDraft.map((c) => `
      <li data-id="${c.id}">
        <input class="cat-icon" value="${escapeHtml(c.icon)}" maxlength="4" aria-label="Ícone">
        <input class="cat-label" value="${escapeHtml(c.label)}" maxlength="30" placeholder="Nome da categoria" aria-label="Nome">
        ${c.custom ? '<button type="button" class="cat-del" aria-label="Excluir categoria">🗑️</button>'
          : c.id === 'outros' ? '<span class="muted small">fixa</span>'
          : `<label class="cat-show"><input type="checkbox" ${c.hidden ? '' : 'checked'}> mostrar</label>`}
      </li>`).join('');
  }

  $('#cat-add').addEventListener('click', () => {
    readCatEditor();
    const c = { id: 'c-' + Date.now().toString(36), label: '', icon: '🏷️', custom: true, hidden: false, slot: Calc.nextCustomSlot(catDraft) };
    catDraft.splice(catDraft.length - 1, 0, c); // antes de Outros
    renderCatEditor();
    $(`#cat-editor li[data-id="${c.id}"] .cat-label`).focus();
  });

  $('#cat-editor').addEventListener('click', (ev) => {
    const del = ev.target.closest('.cat-del');
    if (!del) return;
    readCatEditor();
    const id = del.closest('li').dataset.id;
    const used = state.expenses.filter((e) => e.category === id).length;
    if (used && !confirm(`${used} ${used === 1 ? 'despesa usa' : 'despesas usam'} esta categoria e ${used === 1 ? 'irá' : 'irão'} para Outros. Excluir?`)) return;
    catDraft = catDraft.filter((c) => c.id !== id);
    catRemoved.push(id);
    renderCatEditor();
  });

  // Aplica o editor: salva só o que difere do padrão e move despesas de categorias excluídas.
  function applyCatEditor() {
    readCatEditor();
    for (const c of catDraft) if (c.custom && !c.label) catRemoved.push(c.id); // nova sem nome: descarta
    const saved = catDraft.filter((c) => !catRemoved.includes(c.id)).map((c) => (c.custom
      ? { id: c.id, label: c.label, icon: c.icon || '🏷️', custom: true, slot: c.slot }
      : { id: c.id, label: c.label, icon: c.icon, hidden: !!c.hidden }));
    if (JSON.stringify(Calc.resolveCategories(saved)) === JSON.stringify(cats()) && !catRemoved.length) return false;
    state.categories = saved;
    state.categoriesUpdatedAt = Date.now();
    for (const e of state.expenses) {
      if (catRemoved.includes(e.category)) { e.category = 'outros'; e.updatedAt = Date.now(); }
    }
    return true;
  }
  $('#cancel-settings').addEventListener('click', () => settingsDialog.close());
  settingsForm.addEventListener('submit', () => {
    const v = parseAmount(settingsForm.budget.value);
    setPref('semanasp:geo', settingsForm.geo.checked);
    let changed = applyCatEditor();
    if ((v > 0 ? v : 0) !== state.budget) {
      state.budget = v > 0 ? v : 0;
      state.budgetUpdatedAt = Date.now();
      changed = true;
    }
    if (changed) save();
    render();
    window.dispatchEvent(new Event('semanasp:remote')); // redesenha as Análises
  });

  $('#backup-export').addEventListener('click', () => {
    download(`semanasp_backup_${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
  });
  // Importar acrescenta despesas (ex.: vindas de planilha) sem apagar as atuais.
  $('#merge-import').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.expenses)) throw new Error('formato inválido');
      const result = Calc.mergeExpenses(state.expenses, data.expenses);
      if (!result.added) return alert('Nenhuma despesa nova: todas já estavam no app.');
      const skipped = result.skipped ? ` (${result.skipped} já existiam e serão ignoradas)` : '';
      if (!confirm(`Adicionar ${result.added} despesas${skipped}? As despesas atuais são mantidas.`)) return;
      state.expenses = result.expenses;
      save();
      settingsDialog.close();
      render();
      alert(`${result.added} despesas importadas.`);
    } catch (err) {
      alert('Não foi possível ler o arquivo: ' + err.message);
    }
  });

  $('#backup-import').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.expenses)) throw new Error('formato inválido');
      if (!confirm(`Substituir os dados atuais por ${data.expenses.length} despesas do backup?`)) return;
      // O backup passa a valer em todos os aparelhos: o que não está nele vira exclusão.
      const now = Date.now();
      const kept = new Set(data.expenses.map((e) => e.id));
      for (const e of state.expenses) if (!kept.has(e.id)) state.deleted[e.id] = now;
      state.expenses = data.expenses.map((e) => ({ ...e, updatedAt: now }));
      for (const id of kept) delete state.deleted[id];
      state.budget = Number(data.budget) || 0;
      state.budgetUpdatedAt = now;
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

    const origin = { uber: 'da corrida da Uber', keeta: 'do pedido do Keeta', sms: 'do SMS do cartão' }[result.source] || 'do print';
    const problems = [];
    if (!result.amount) problems.push('Não encontrei o valor.');
    if (result.purchases > 1) problems.push(`Achei ${result.purchases} compras no print; usei a última (mais recente).`);
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

  $('#app-version').textContent = APP_VERSION;

  // ---------- Offline ----------
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // Quando uma versão nova do service worker assume, recarrega uma vez para usá-la.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded || dialog.open || settingsDialog.open) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Ponte para o sync.js: lê o estado e aplica mudanças vindas da nuvem.
  window.SemanaSP = {
    getState: () => state,
    applyRemote(docs, settings) {
      const r = Calc.syncMerge(state.expenses, state.deleted, docs);
      let changed = r.changed;
      if (r.changed) {
        state.expenses = r.expenses;
        state.deleted = r.deleted;
      }
      const patch = Calc.settingsFromRemote(state, settings);
      if (patch) {
        Object.assign(state, patch);
        state.budget = state.budget || 0;
        changed = true;
      }
      if (!changed) return false;
      if (migrateAll()) save(); // algo antigo veio da nuvem: converte e devolve atualizado
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      window.dispatchEvent(new Event('semanasp:remote'));
      return true;
    },
  };

  // ---------- Quadros recolhíveis ----------
  // Tocar no título recolhe/expande o quadro; a escolha fica salva neste aparelho.
  const COLLAPSE_KEY = 'semanasp:collapsed';
  let collapsed = [];
  try { collapsed = JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || []; } catch (_) { /* sem armazenamento */ }
  document.querySelectorAll('.card[data-collapse]').forEach((card) => {
    const head = card.firstElementChild;
    head.classList.add('card-head');
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    const set = (isCollapsed) => {
      card.classList.toggle('collapsed', isCollapsed);
      head.setAttribute('aria-expanded', String(!isCollapsed));
    };
    set(collapsed.includes(card.dataset.collapse));
    const toggle = (ev) => {
      if (ev.target.closest('button:not(.card-head), a, input')) return; // ex.: "Exportar CSV"
      const isCollapsed = !card.classList.contains('collapsed');
      set(isCollapsed);
      collapsed = collapsed.filter((k) => k !== card.dataset.collapse).concat(isCollapsed ? [card.dataset.collapse] : []);
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)); } catch (_) { /* sem armazenamento */ }
      if (!isCollapsed) window.dispatchEvent(new Event('semanasp:remote')); // redesenha gráficos que estavam ocultos
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(ev); } });
  });

  // ---------- Modo privado ----------
  function applyPrivacy() {
    const on = window.Privacy.on;
    const btn = $('#btn-privacy');
    btn.textContent = on ? '🙈' : '👁️';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Mostrar valores' : 'Ocultar valores');
    btn.title = btn.getAttribute('aria-label');
    $('#privacy-banner').hidden = !on;
  }
  $('#btn-privacy').addEventListener('click', () => {
    window.Privacy.on = !window.Privacy.on;
    setPref('semanasp:privacy', window.Privacy.on);
    applyPrivacy();
    render();
    window.dispatchEvent(new Event('semanasp:remote')); // redesenha as Análises
  });
  applyPrivacy();

  render();
  if (migrated) save();
  if ('caches' in window) consumeSharedImage();
})();
