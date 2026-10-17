const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseReceipt, findDate, parseStop } = require('../receipt.js');

// Textos reais extraídos pelo Tesseract (por) de prints dos apps.
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const TODAY = '2026-10-17';

test('print de corrida da Uber', () => {
  const r = parseReceipt(fixture('uber.txt'), TODAY);
  assert.equal(r.source, 'uber');
  assert.equal(r.category, 'transporte');
  assert.equal(r.amount, 3224);
  assert.equal(r.date, '2026-10-14');
  assert.equal(r.description, 'Uber: Rua Marquês de São Vicente, 35, Gávea → Aeroporto Santos Dumont (SDU)');
  assert.equal(r.city, 'Rio de Janeiro');
});

test('print de pedido do Keeta desconta o reembolso parcial', () => {
  const r = parseReceipt(fixture('keeta.txt'), TODAY);
  assert.equal(r.source, 'keeta');
  assert.equal(r.category, 'alimentacao');
  assert.equal(r.amount, 3361);
  assert.equal(r.date, null); // a tela do pedido não mostra a data
  assert.equal(r.description, 'Keeta: Churrasco no Pote - Brooklin (total R$ 37,23, reembolso R$ 3,62)');
  assert.equal(r.city, 'São Paulo');
});

test('findDate sem ano usa o ano atual, ou o anterior se cair no futuro', () => {
  assert.equal(findDate('14 de out. 6:53AM', TODAY), '2026-10-14');
  assert.equal(findDate('20 de dez.', TODAY), '2025-12-20');
  assert.equal(findDate('3 de março de 2025', TODAY), '2025-03-03');
  assert.equal(findDate('pago em 05/09/2026', TODAY), '2026-09-05');
  assert.equal(findDate('sem data', TODAY), null);
});

test('parseStop separa endereço, bairro e cidade', () => {
  assert.deepEqual(parseStop('Av. Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200'),
    { place: 'Av. Paulista, 1578', district: 'Bela Vista', city: 'São Paulo', isStreet: true });
  assert.deepEqual(parseStop('Aeroporto de Congonhas - Campo Belo, São Paulo'),
    { place: 'Aeroporto de Congonhas', district: 'Campo Belo', city: 'São Paulo', isStreet: false });
});

test('texto desconhecido pega o maior valor', () => {
  const r = parseReceipt('Subtotal R$ 10,00\nTaxa R$ 2,50\nTotal R$ 12,50', TODAY);
  assert.equal(r.source, null);
  assert.equal(r.amount, 1250);
});
