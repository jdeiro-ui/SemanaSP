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
  { id: '1', createdAt: 1, date: '2026-10-13', category: 'hospedagem', amount: 30000, payment: 'nubank', reimbursable: true, description: 'Hotel', city: 'São Paulo' },
  { id: '2', createdAt: 2, date: '2026-10-13', category: 'alimentacao', amount: 4550, payment: 'ticket', reimbursable: false, description: 'Jantar; cliente', city: 'São Paulo' },
  { id: '3', createdAt: 3, date: '2026-10-14', category: 'transporte', amount: 2000, payment: 'nubank', reimbursable: false, description: 'Uber', city: '' },
  { id: '4', createdAt: 4, date: '2026-10-19', category: 'outros', amount: 999, payment: 'pix', reimbursable: true, description: 'Semana seguinte', city: '' },
];

test('expensesInWeek filtra pela semana', () => {
  assert.deepEqual(Calc.expensesInWeek(sample, '2026-10-12').map((e) => e.id), ['1', '2', '3']);
  assert.deepEqual(Calc.expensesInWeek(sample, '2026-10-19').map((e) => e.id), ['4']);
});

test('summarize separa reembolsável e soma por forma de pagamento', () => {
  const s = Calc.summarize(Calc.expensesInWeek(sample, '2026-10-12'), 50000);
  assert.equal(s.total, 36550);
  assert.equal(s.reimbursable, 30000);
  assert.equal(s.notReimbursable, 6550);
  assert.deepEqual(s.byPayment, { nubank: 32000, ticket: 4550 });
  assert.equal(s.byCategory.hospedagem, 30000);
  assert.equal(s.byDay['2026-10-13'], 34550);
  assert.equal(s.remaining, 13450);
  assert.equal(Calc.summarize([], 0).remaining, null);
});

test('toCSV usa ; e vírgula decimal, escapando campos', () => {
  const csv = Calc.toCSV(sample.slice(1, 2));
  const lines = csv.replace('﻿', '').split('\r\n');
  assert.equal(lines[0], 'Data;Check-out/Volta;Noites;Categoria;Descrição;Cidade;Pagamento;Parcelas;Reembolsável;Data da compra;Companhia aérea;Localizador;Valor;Valor total');
  assert.equal(lines[1], '13/10/2026;;;Alimentação;"Jantar; cliente";São Paulo;Ticket;;Não;;;;45,50;45,50');
});

test('paymentLabel cobre formas antigas', () => {
  assert.equal(Calc.paymentLabel('pix'), 'Pix/dinheiro');
  assert.equal(Calc.paymentLabel('corporativo'), 'Corporativo');
});

// Hotel de sex 16/10 a seg 19/10: 3 noites (16, 17, 18) — atravessa o fim da semana de 12/10.
const stay = { id: 'h', createdAt: 9, date: '2026-10-16', checkout: '2026-10-19', category: 'hospedagem',
  amount: 100000, payment: 'nubank', reimbursable: true, description: 'Hotel', city: 'Rio de Janeiro' };

test('allocate divide a hospedagem por noite, sobra de centavos nas primeiras', () => {
  assert.equal(Calc.nights(stay), 3);
  assert.deepEqual(Calc.allocate(stay), [
    { date: '2026-10-16', amount: 33334 },
    { date: '2026-10-17', amount: 33333 },
    { date: '2026-10-18', amount: 33333 },
  ]);
  // Sem check-out (ou check-out inválido) fica num dia só.
  assert.deepEqual(Calc.allocate({ ...stay, checkout: undefined }), [{ date: '2026-10-16', amount: 100000 }]);
  assert.deepEqual(Calc.allocate({ ...stay, checkout: '2026-10-16' }), [{ date: '2026-10-16', amount: 100000 }]);
});

test('hospedagem que atravessa semanas entra em cada semana só com suas noites', () => {
  // Check-in na segunda 19/10 já não tem noite na semana de 12/10.
  const late = { ...stay, id: 'h2', date: '2026-10-11', checkout: '2026-10-13', amount: 20000 };
  assert.deepEqual(Calc.expensesInWeek([stay, late], '2026-10-12').map((e) => e.id), ['h2', 'h']);
  assert.deepEqual(Calc.expensesInWeek([stay], '2026-10-19').map((e) => e.id), []);

  const s = Calc.summarize([stay, late], 0, '2026-10-12');
  assert.equal(s.total, 100000 + 10000); // as 3 noites do Rio + 1 de 2 noites da outra
  assert.equal(s.byDay['2026-10-11'], undefined);
  assert.equal(s.byDay['2026-10-12'], 10000);
  assert.equal(s.byDay['2026-10-17'], 33333);
  assert.deepEqual(Calc.weekShare(late, '2026-10-12'), { amount: 10000, nights: 1, legs: 0 });
  assert.deepEqual(Calc.weekShare(late, '2026-10-05'), { amount: 10000, nights: 1, legs: 0 });
});

test('toCSV de hospedagem traz check-out, noites da semana e valor parcial', () => {
  const late = { ...stay, date: '2026-10-11', checkout: '2026-10-13', amount: 20000, description: 'Hotel SP', city: 'São Paulo' };
  const row = Calc.toCSV([late], '2026-10-12').replace('\ufeff', '').split('\r\n')[1];
  assert.equal(row, '11/10/2026;13/10/2026;1 de 2;Hospedagem;Hotel SP;São Paulo;Nubank;;Sim;;;;100,00;200,00');
});

// Passagem comprada em 01/09 para ida dom 18/10 e volta sex 23/10 (trechos em semanas diferentes).
const flight = { id: 'f', createdAt: 10, category: 'passagem', date: '2026-10-18', returnDate: '2026-10-23',
  purchaseDate: '2026-09-01', airline: 'LATAM', locator: 'XPTO12', amount: 120001, payment: 'nubank',
  installments: 3, reimbursable: true, description: '', city: 'São Paulo' };

test('passagem conta na semana da viagem, metade na ida e metade na volta', () => {
  assert.deepEqual(Calc.allocate(flight), [{ date: '2026-10-18', amount: 60001 }, { date: '2026-10-23', amount: 60000 }]);
  assert.deepEqual(Calc.expensesInWeek([flight], '2026-08-31').map((e) => e.id), []); // semana da compra
  assert.deepEqual(Calc.weekShare(flight, '2026-10-12'), { amount: 60001, nights: 0, legs: 1 });
  assert.deepEqual(Calc.weekShare(flight, '2026-10-19'), { amount: 60000, nights: 0, legs: 1 });
  // Só ida, ou volta no mesmo dia: tudo na data da ida.
  assert.deepEqual(Calc.allocate({ ...flight, returnDate: '' }), [{ date: '2026-10-18', amount: 120001 }]);
  assert.deepEqual(Calc.allocate({ ...flight, returnDate: '2026-10-18' }), [{ date: '2026-10-18', amount: 120001 }]);
  // Check-out só vale para hospedagem.
  assert.equal(Calc.nights({ ...flight, checkout: '2026-10-20' }), 0);
});

test('parcelas só valem para Nubank e Unlimited', () => {
  assert.equal(Calc.installmentsOf(flight), 3);
  assert.equal(Calc.installmentsOf({ ...flight, payment: 'unlimited' }), 3);
  assert.equal(Calc.installmentsOf({ ...flight, payment: 'pix' }), 1);
  assert.equal(Calc.installmentsOf({ ...flight, installments: null }), 1);
});

test('toCSV de passagem traz volta, compra, companhia, localizador e parcelas', () => {
  const row = Calc.toCSV([flight], '2026-10-19').replace('\ufeff', '').split('\r\n')[1];
  assert.equal(row, '18/10/2026;23/10/2026;;Passagem;;São Paulo;Nubank;3x;Sim;01/09/2026;LATAM;XPTO12;600,00;1200,01');
});

test('mergeExpenses acrescenta sem duplicar e descarta itens inválidos', () => {
  const existing = [{ id: 'a', date: '2026-10-14', amount: 100 }];
  const incoming = [
    { id: 'a', date: '2026-10-14', amount: 999 }, // já existe
    { id: 'b', date: '2026-10-20', amount: 0 },   // valor zero é válido
    { id: 'b', date: '2026-10-20', amount: 0 },   // repetido no próprio arquivo
    { id: 'c', date: '20/10/2026', amount: 5 },   // data em formato errado
  ];
  const r = Calc.mergeExpenses(existing, incoming);
  assert.deepEqual(r.expenses.map((e) => e.id), ['a', 'b']);
  assert.equal(r.expenses[0].amount, 100);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 3);
});

test('analytics separa realizado e agendado, média por mês, viagem e noite', () => {
  const ex = [
    // Semana 05/10: hotel 2 noites (R$ 400) + almoço R$ 50 → viagem de R$ 450
    { id: 'a', date: '2026-10-06', checkout: '2026-10-08', category: 'hospedagem', amount: 40000 },
    { id: 'b', date: '2026-10-07', category: 'alimentacao', amount: 5000 },
    // Semana 14/09: voo R$ 600 (ida e volta) → viagem de R$ 600
    { id: 'c', date: '2026-09-15', returnDate: '2026-09-17', category: 'passagem', amount: 60000 },
    // Voo pago pela empresa (R$ 0) não conta como viagem
    { id: 'd', date: '2026-08-04', category: 'passagem', amount: 0 },
    // Futuro (depois de hoje): agendado
    { id: 'e', date: '2026-11-10', category: 'passagem', amount: 50000 },
    // Outro ano
    { id: 'f', date: '2027-01-12', category: 'passagem', amount: 30000 },
  ];
  const r = Calc.analytics(ex, 2026, '2026-10-18');
  assert.equal(r.months.length, 12);
  assert.equal(r.total, 105000);
  assert.equal(r.scheduled, 50000);
  assert.equal(r.trips, 2);
  assert.equal(r.activeMonths, 2);
  assert.equal(r.avgPerMonth, 52500);
  assert.equal(r.avgPerTrip, 52500);
  assert.equal(r.avgPerNight, 20000);
  assert.equal(r.avgPerTripByCategory.passagem, 30000);
  const oct = r.months.find((m) => m.key === '2026-10');
  assert.deepEqual([oct.total, oct.done, oct.future, oct.byCategory.hospedagem], [45000, 45000, false, 40000]);
  const nov = r.months.find((m) => m.key === '2026-11');
  assert.deepEqual([nov.total, nov.scheduled, nov.future], [50000, 50000, true]);

  const all = Calc.analytics(ex, null, '2026-10-18');
  assert.deepEqual([all.months[0].key, all.months[all.months.length - 1].key, all.months.length], ['2026-08', '2027-01', 6]);
  assert.equal(all.scheduled, 80000);
  assert.deepEqual(Calc.yearsWithData(ex), [2027, 2026]);
});
