'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePrice } = require('../server/services/pricing');
const { splitTax } = require('../server/lib/money');

test('markup: costo 100 + 60 % + ISV 15 % = 184.00', () => {
  const p = calculatePrice({ cost: 10000, marginPct: 60, taxRatePct: 15 });
  assert.equal(p.price, 18400);
  assert.equal(p.netPrice, 16000);
  assert.equal(p.tax, 2400);
  assert.equal(p.profit, 6000);
});

test('margen sobre precio: costo 100 con 40 % => base 166.67', () => {
  const p = calculatePrice({ cost: 10000, marginPct: 40, taxRatePct: 15, mode: 'margin' });
  assert.equal(p.netPrice, 16667);
  assert.equal(p.marginOnPricePct, 40);
});

test('gastos de importación y redondeo a L 5', () => {
  const p = calculatePrice({ cost: 10000, marginPct: 60, taxRatePct: 15, extraCostPct: 10, rounding: 500 });
  assert.equal(p.landedCost, 11000);
  assert.equal(p.price % 500, 0);
  assert.ok(p.price >= 20240);
});

test('splitTax separa ISV incluido', () => {
  assert.deepEqual(splitTax(11500, 15), { base: 10000, tax: 1500 });
});
