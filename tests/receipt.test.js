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

const sms = (text) => parseReceipt(text, TODAY);

test('SMS do Nubank: valor, estabelecimento e categoria', () => {
  const r = sms('Nubank: Compra de R$ 45,90 APROVADA em PADARIA PAO DOURADO para o cartão com final 1234.');
  assert.equal(r.source, 'sms');
  assert.deepEqual([r.amount, r.description, r.category, r.payment, r.date], [4590, 'Padaria Pao Dourado', 'alimentacao', 'credito', null]);
});

test('SMS do Itaú com data, hora e parcelas', () => {
  const r = sms('ITAU: Compra aprovada no cartao final 9876 de R$ 1.200,00 em 3x em 16/10 as 14:32, LATAM AIRLINES BRASIL.');
  assert.deepEqual([r.amount, r.date, r.installments, r.description, r.category], [120000, '2026-10-16', 3, 'Latam Airlines Brasil', 'passagem']);
});

test('SMS do Bradesco com valor antes do estabelecimento', () => {
  const r = sms('BRADESCO CARTOES: COMPRA APROVADA NO CARTAO FINAL 4321 EM 15/10/2026 12:01. VALOR DE R$ 87,50 HOTEL IBIS PAULISTA.');
  assert.deepEqual([r.amount, r.date, r.description, r.category], [8750, '2026-10-15', 'Hotel Ibis Paulista', 'hospedagem']);
});

test('SMS com "Local:" e transporte por aplicativo', () => {
  const r = sms('Santander: Compra aprovada no valor de R$ 23,40. Cartao final 5555. Local: UBER *TRIP HELP.UBER.COM');
  assert.deepEqual([r.amount, r.category], [2340, 'transporte']);
  assert.match(r.description, /^Uber \*Trip/);
});

test('print com várias mensagens usa a compra mais recente (a última)', () => {
  const r = sms(`Ontem\nNubank: Compra de R$ 30,00 APROVADA em OXXO PINHEIROS para o cartão com final 1234.\nHoje\nNubank: Compra de R$ 52,10 APROVADA em SUSHI HOUSE para o cartão com final 1234.`);
  assert.deepEqual([r.amount, r.description, r.purchases], [5210, 'Sushi House', 2]);
});

test('compra no débito não marca cartão de crédito; texto sem compra não é SMS', () => {
  assert.equal(sms('Compra aprovada no débito de R$ 10,00 em FARMACIA X. Cartao final 1111').payment, null);
  assert.notEqual(sms('Subtotal R$ 10,00 Total R$ 12,50').source, 'sms');
});

test('SMS com parcelas logo após o estabelecimento', () => {
  const r = sms('Nubank: Compra de R$ 152,40 APROVADA em CHURRASCARIA FOGO DE CHAO em 3x para o cartão com final 1234.');
  assert.deepEqual([r.description, r.installments, r.category], ['Churrascaria Fogo De Chao', 3, 'alimentacao']);
});
