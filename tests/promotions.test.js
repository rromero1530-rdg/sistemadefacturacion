'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPromotions } = require('../server/services/promotions');

const BOLSOS = 1, ACC = 2, ROPA = 3;
const combo = { id: 1, name: 'Bolso + accesorio', type: 'combo', discount_pct: 15,
  rules: [{ category_id: BOLSOS, qty: 1 }, { category_id: ACC, qty: 1 }] };

test('combo aplica solo a las unidades que forman el combo', () => {
  const lines = [
    { product_id: 10, category_id: BOLSOS, qty: 1, unit_price: 100000 },
    { product_id: 20, category_id: ACC, qty: 2, unit_price: 20000 },
    { product_id: 30, category_id: ROPA, qty: 1, unit_price: 50000 },
  ];
  const r = applyPromotions(lines, [combo]);
  assert.deepEqual(r.discounts, [15000, 3000, 0]);
  assert.equal(r.applied[0].times, 1);
});

test('sin todos los componentes no hay combo', () => {
  const r = applyPromotions([{ product_id: 10, category_id: BOLSOS, qty: 3, unit_price: 100000 }], [combo]);
  assert.deepEqual(r.discounts, [0]);
  assert.equal(r.applied.length, 0);
});

test('item_pct y prioridad: una unidad no recibe dos promociones', () => {
  const liquidacion = { id: 2, name: 'Liquidación accesorios', type: 'item_pct', discount_pct: 50, priority: -1,
    rules: [{ category_id: ACC }] };
  const lines = [
    { product_id: 10, category_id: BOLSOS, qty: 1, unit_price: 100000 },
    { product_id: 20, category_id: ACC, qty: 2, unit_price: 20000 },
  ];
  const r = applyPromotions(lines, [{ ...combo, priority: 10 }, liquidacion]);
  // 1 accesorio en combo (15 %) + 1 accesorio en liquidación (50 %)
  assert.deepEqual(r.discounts, [15000, 3000 + 10000]);
});
