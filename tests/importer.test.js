const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../calc.js');
const I = require('../importer.js');

test('parseCSV detecta ; e respeita aspas e quebras de linha', () => {
  const rows = I.parseCSV('﻿Data;Descrição;Valor\r\n01/10/2026;"Jantar; cliente";45,90\n02/10/2026;"Diz ""oi""";10\n\n');
  assert.deepEqual(rows, [['Data', 'Descrição', 'Valor'], ['01/10/2026', 'Jantar; cliente', '45,90'], ['02/10/2026', 'Diz "oi"', '10']]);
  assert.deepEqual(I.parseCSV('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('parseDateCell entende vários formatos', () => {
  assert.equal(I.parseDateCell(46323), '2026-10-28');            // serial do Excel
  assert.equal(I.parseDateCell('28/10/2026'), '2026-10-28');
  assert.equal(I.parseDateCell('28/10/26'), '2026-10-28');
  assert.equal(I.parseDateCell('2026-10-28'), '2026-10-28');
  assert.equal(I.parseDateCell('28 de out. de 2026'), '2026-10-28');
  assert.equal(I.parseDateCell(new Date(2026, 9, 28)), '2026-10-28');
  assert.equal(I.parseDateCell('Total'), null);
  assert.equal(I.parseDateCell(45.9), null);
  assert.equal(I.parseDateCell('31/02/2026x'), null);
});

test('parseAmountCell: número, texto com R$, negativo de extrato', () => {
  assert.equal(I.parseAmountCell(45.9), 4590);
  assert.equal(I.parseAmountCell('R$ 1.234,56'), 123456);
  assert.equal(I.parseAmountCell('-45,90'), 4590);
  assert.equal(I.parseAmountCell(-12), 1200);
  assert.equal(I.parseAmountCell('(30,00)'), 3000);
  assert.equal(I.parseAmountCell(''), null);
  assert.equal(I.parseAmountCell('abc'), null);
});

const sheet = [
  ['Minhas despesas de viagem 2026'],
  ['Atualizado em outubro'],
  ['Data', 'Tipo', 'O que', 'Pago com', 'Valor', 'Cidade', 'Saída', 'Reembolso?'],
  [46309, 'Hotel', 'Ibis Paulista', 'Cartão Itaú', 'R$ 600,00', 'São Paulo', 46312, 'sim'],
  ['15/10/2026', 'Refeição', 'Almoço', 'VR', 38.5, 'São Paulo', '', ''],
  ['16/10/2026', 'Voo', 'GOL SDU-CGH', 'Pix', 420, '', '18/10/2026', 'não'],
  ['17/10/2026', 'Lavanderia', 'Roupas', 'Dinheiro', 25, '', '', ''],
  ['', 'Total', '', '', 1083.5, '', '', ''],
];

test('findHeaderRow pula títulos e guessColumns sugere as colunas', () => {
  assert.equal(I.findHeaderRow(sheet), 2);
  assert.deepEqual(I.guessColumns(sheet[2]), { date: 0, category: 1, description: 2, payment: 3, amount: 4, city: 5, endDate: 6, reimbursable: 7 });
});

test('guessCategory e guessPayment traduzem textos comuns', () => {
  const cats = Calc.resolveCategories([{ id: 'c-lav', label: 'Lavanderia', custom: true, slot: 6 }]);
  assert.equal(I.guessCategory('Hotel', cats), 'hospedagem');
  assert.equal(I.guessCategory('Refeição', cats), 'alimentacao');
  assert.equal(I.guessCategory('Voo', cats), 'passagem');
  assert.equal(I.guessCategory('lavanderia', cats), 'c-lav');
  assert.equal(I.guessCategory('Presentes', cats), 'outros');
  assert.equal(I.guessPayment('Cartão Itaú'), 'credito');
  assert.equal(I.guessPayment('VR'), 'ticket');
  assert.equal(I.guessPayment('Débito'), 'pix');
  assert.equal(I.guessPayment('Milhas'), 'keep');
});

test('buildExpenses converte, pula linhas inválidas e gera ids estáveis', () => {
  const rows = sheet.slice(3);
  const opts = {
    map: I.guessColumns(sheet[2]),
    categoryMap: { Hotel: 'hospedagem', 'Refeição': 'alimentacao', Voo: 'passagem', Lavanderia: 'outros' },
    paymentMap: { 'Cartão Itaú': 'credito', VR: 'ticket', Pix: 'pix', Dinheiro: 'keep' },
    source: 'planilha.xlsx',
  };
  const r = I.buildExpenses(rows, opts);
  assert.equal(r.expenses.length, 4);
  assert.deepEqual(r.skipped, [{ line: 5, reason: 'sem data válida' }]);
  const [hotel, almoco, voo, lav] = r.expenses;
  assert.deepEqual([hotel.date, hotel.checkout, hotel.amount, hotel.payment, hotel.reimbursable], ['2026-10-14', '2026-10-17', 60000, 'credito', true]);
  assert.deepEqual([almoco.category, almoco.payment, almoco.amount, almoco.checkout], ['alimentacao', 'ticket', 3850, undefined]);
  assert.deepEqual([voo.category, voo.returnDate, voo.reimbursable], ['passagem', '2026-10-18', false]);
  assert.deepEqual([lav.payment, lav.category], ['Dinheiro', 'outros']);
  // mesmo arquivo de novo: mesmos ids (não duplica ao importar)
  assert.deepEqual(I.buildExpenses(rows, opts).expenses.map((e) => e.id), r.expenses.map((e) => e.id));
  // período
  assert.equal(I.buildExpenses(rows, { ...opts, from: '2026-10-16' }).expenses.length, 2);
  // linhas idênticas no mesmo arquivo continuam sendo duas despesas
  const dup = I.buildExpenses([rows[1], rows[1]], opts).expenses;
  assert.notEqual(dup[0].id, dup[1].id);
});

test('buildExpenses ignora linhas vazias sem contar como problema', () => {
  const r = I.buildExpenses([['', '', ''], ['01/10/2026', 'Táxi', '30'], []], { map: { date: 0, description: 1, amount: 2 } });
  assert.equal(r.expenses.length, 1);
  assert.deepEqual(r.skipped, []);
});
