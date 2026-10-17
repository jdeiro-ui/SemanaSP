// Interpreta o texto (OCR) de prints da Uber e do Keeta e monta um rascunho de despesa.
(function (root) {
  const Calc = root.Calc || (typeof require === 'function' ? require('./calc.js') : null);

  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MONEY = /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  const TIME = /\b\d{1,2}[:.]\d{2}\s*(?:[AP]\.?\s?M\.?)?/gi;

  const lines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // OCR costuma ler os ícones de marcador como "o", "e", "-", "•" no início da linha.
  const stripBullet = (s) => s.replace(/^(?:[oe•·\-–—=]\s+|[^\p{L}\p{N}(]+)/u, '').trim();
  const stripChevron = (s) => s.replace(/\s*[>›»]\s*$/, '').trim();

  function amounts(text) {
    return [...text.matchAll(MONEY)].map((m) => Calc.parseAmount(m[1]));
  }

  // Encontra "14 de out." ou "14/10/2026". Sem ano, usa o ano atual (ou o anterior se cair no futuro).
  function findDate(text, todayIso) {
    const [ty] = todayIso.split('-').map(Number);
    let m = text.match(/\b(\d{1,2})\s+de\s+([a-zç]{3})[a-zç]*\.?(?:\s+de\s+(\d{4}))?/i);
    let day, month, year;
    if (m && MONTHS.includes(m[2].toLowerCase())) {
      day = Number(m[1]); month = MONTHS.indexOf(m[2].toLowerCase()) + 1; year = m[3] ? Number(m[3]) : null;
    } else if ((m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      day = Number(m[1]); month = Number(m[2]); year = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : null;
    } else {
      return null;
    }
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    const iso = (y) => `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (year) return iso(year);
    return iso(ty) > todayIso ? iso(ty - 1) : iso(ty);
  }

  function detectSource(text) {
    if (/\buber|solicite uma viagem|informa[çc][õo]es da viag/i.test(text)) return 'uber';
    if (/keeta|entregador|pedir de novo|resumo do pedido|hor[áa]rio garantido/i.test(text)) return 'keeta';
    return null;
  }

  // "Main Terminal, Aeroporto Santos Dumont (SDU) - Centro, Rio de J..." ->
  // { place: 'Aeroporto Santos Dumont (SDU)', district: 'Centro', city: null }
  function parseStop(address) {
    const parts = address.split(/\s+-\s+/);
    const head = parts[0].split(',').map((s) => s.trim());
    const isStreet = head.length > 1 && /^\d/.test(head[head.length - 1]);
    const place = isStreet ? parts[0].trim() : head[head.length - 1];
    const rest = (parts[1] || '').split(',').map((s) => s.trim());
    const clean = (s) => (s && !/(\.\.\.|…)$/.test(s) ? s : null);
    return { place, district: clean(rest[0]), city: clean(rest[1]), isStreet };
  }

  function parseUber(text, todayIso) {
    const all = lines(text);
    const start = all.findIndex((l) => /recibo/i.test(l));
    const stops = [];
    for (const raw of all.slice(start + 1)) {
      if (/valor extra|nenhum valor|adicionad|gorjeta|avalia/i.test(raw)) break;
      const hasTime = TIME.test(raw);
      TIME.lastIndex = 0;
      const line = raw.replace(TIME, '').trim();
      if (!line) continue;
      // Só a 1ª linha de cada parada tem marcador; nas seguintes o "-" separa o bairro.
      if (hasTime || !stops.length) stops.push(stripBullet(line).replace(/^R[o0]da\b/, 'Rua'));
      else stops[stops.length - 1] += ' ' + line;
    }
    const parsed = stops.map(parseStop).filter((s) => s.place);
    const label = (s) => (s.isStreet && s.district ? `${s.place}, ${s.district}` : s.place);
    const values = amounts(text);
    return {
      source: 'uber',
      category: 'transporte',
      amount: values.length ? values[0] : null,
      date: findDate(text, todayIso),
      description: parsed.length ? 'Uber: ' + parsed.map(label).join(' → ') : 'Uber',
      city: (parsed.find((s) => s.city) || {}).city || '',
    };
  }

  function parseKeeta(text, todayIso) {
    const all = lines(text);
    const totalIdx = all.findIndex((l) => /^total\b/i.test(l));
    const totalMatch = totalIdx >= 0 && [...all[totalIdx].matchAll(MONEY)][0];
    const values = amounts(text);
    const total = totalMatch ? Calc.parseAmount(totalMatch[1]) : values.length ? Math.max(...values) : null;

    const refundMatch = text.match(/reembolso parcial:?\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
    const refund = refundMatch ? Calc.parseAmount(refundMatch[1]) : 0;

    let restaurant = '';
    for (let i = totalIdx - 1; i >= 0; i--) {
      const l = stripChevron(stripBullet(all[i]));
      if (l.length > 2) { restaurant = l; break; }
    }

    const addrIdx = all.findIndex((l) => /^\W*\w?\s*entrega:/i.test(l));
    const addr = addrIdx >= 0 && all[addrIdx + 1] ? all[addrIdx + 1].split(',').map((s) => s.trim()) : [];
    const city = addr.length >= 3 ? addr[addr.length - 2] : '';

    const fmt = (c) => (c / 100).toFixed(2).replace('.', ',');
    let description = restaurant ? `Keeta: ${restaurant}` : 'Keeta';
    if (refund && total) description += ` (total R$ ${fmt(total)}, reembolso R$ ${fmt(refund)})`;

    return {
      source: 'keeta',
      category: 'alimentacao',
      amount: total != null ? total - refund : null,
      date: findDate(text, todayIso),
      description,
      city,
    };
  }

  function parseGeneric(text, todayIso) {
    const values = amounts(text);
    return {
      source: null,
      category: null,
      amount: values.length ? Math.max(...values) : null,
      date: findDate(text, todayIso),
      description: '',
      city: '',
    };
  }

  function parseReceipt(text, todayIso) {
    const source = detectSource(text);
    if (source === 'uber') return parseUber(text, todayIso);
    if (source === 'keeta') return parseKeeta(text, todayIso);
    return parseGeneric(text, todayIso);
  }

  const api = { parseReceipt, findDate, detectSource, parseStop };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Receipt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
