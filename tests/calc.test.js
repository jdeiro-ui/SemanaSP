const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../calc.js');

test('weekStart retorna a segunda-feira da semana', () => {
  assert.equal(Calc.weekStart('2026-10-17'), '2026-10-12'); // sábado
  assert.equal(Calc.weekStart('2026-10-18'), '2026-10-12'); // domingo
  assert.equal(Calc.weekStart('2026-10-12'), '2026-10-12'); // segunda
  assert.equal(Calc.weekStart('2026-01-01'), '2025-12-29'); // virada de ano
});

test('weekDays lista os 7 dias', () => {
  assert.deepEqual(Calc.weekDays('2026-10-12'), [
    '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18',
  ]);
});

test('parseAmount entende formatos brasileiros', () => {
  assert.equal(Calc.parseAmount('12,50'), 1250);
  assert.equal(Calc.parseAmount('R$ 1.234,56'), 123456);
  assert.equal(Calc.parseAmount('1.234'), 123400);
  assert.equal(Calc.parseAmount('45.9'), 4590);
  assert.equal(Calc.parseAmount('80'), 8000);
  assert.ok(Number.isNaN(Calc.parseAmount('')));
  assert.ok(Number.isNaN(Calc.parseAmount('abc')));
});

const sample = [
  { id: '1', createdAt: 1, date: '2026-10-13', category: 'hospedagem', amount: 30000, payment: 'corporativo', reimbursable: false, description: 'Hotel', city: 'São Paulo' },
  { id: '2', createdAt: 2, date: '2026-10-13', category: 'alimentacao', amount: 4550, payment: 'pessoal', reimbursable: true, description: 'Jantar; cliente', city: 'São Paulo' },
  { id: '3', createdAt: 3, date: '2026-10-14', category: 'transporte', amount: 2000, payment: 'pessoal', reimbursable: false, description: 'Uber', city: '' },
  { id: '4', createdAt: 4, date: '2026-10-19', category: 'outros', amount: 999, payment: 'pessoal', reimbursable: true, description: 'Semana seguinte', city: '' },
];

test('expensesInWeek filtra pela semana', () => {
  assert.deepEqual(Calc.expensesInWeek(sample, '2026-10-12').map((e) => e.id), ['1', '2', '3']);
  assert.deepEqual(Calc.expensesInWeek(sample, '2026-10-19').map((e) => e.id), ['4']);
});

test('summarize separa corporativo, reembolsável e bolso', () => {
  const s = Calc.summarize(Calc.expensesInWeek(sample, '2026-10-12'), 50000);
  assert.equal(s.total, 36550);
  assert.equal(s.corporate, 30000);
  assert.equal(s.reimbursable, 4550);
  assert.equal(s.outOfPocket, 2000);
  assert.equal(s.byCategory.hospedagem, 30000);
  assert.equal(s.byDay['2026-10-13'], 34550);
  assert.equal(s.remaining, 13450);
  assert.equal(Calc.summarize([], 0).remaining, null);
});

test('toCSV usa ; e vírgula decimal, escapando campos', () => {
  const csv = Calc.toCSV(sample.slice(1, 2));
  const lines = csv.replace('﻿', '').split('\r\n');
  assert.equal(lines[0], 'Data;Categoria;Descrição;Cidade;Pagamento;Reembolsável;Valor');
  assert.equal(lines[1], '13/10/2026;Alimentação;"Jantar; cliente";São Paulo;Cartão/dinheiro pessoal;Sim;45,50');
});
