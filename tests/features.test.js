'use strict';
// Flete en lempiras, códigos por categoría, inventario, clientes/proveedores, descuentos,
// factura con RTN/DNI, aviso de agotado, reimpresión, alertas por niveles y reportes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-features-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.BACKUP_DIR = path.join(tmp, 'backups');

const { getDb, closeDb } = require('../server/db/connection');
const { migrate } = require('../server/db/migrate');
const { repos } = require('../server/repositories');
const catalog = require('../server/services/catalog');
const inventory = require('../server/services/inventory');
const partners = require('../server/services/partners');
const sales = require('../server/services/sales');
const cash = require('../server/services/cash');
const reports = require('../server/services/reports');
const { getAlerts, groupSlow } = require('../server/services/alerts');

migrate(getDb());
const r = repos();
r.settings.set('price_rounding', '0');
const admin = { id: null, role: 'admin' };
const cajero = { id: null, role: 'cajero' };

const jeans = catalog.createCategory({ name: 'Jeans', margin_pct: 50, min_stock: 1 });
const p1 = catalog.createProduct({ name: 'Jean mom', category_id: jeans.id, cost: 30000, extra_cost: 5000,
  variants: [{ size: '28', color: 'Azul', stock: 3 }, { size: '30', color: 'Azul', stock: 1 }] });
const p2 = catalog.createProduct({ name: 'Jean skinny', category_id: jeans.id, cost: 20000,
  variants: [{ size: '28', color: 'Negro', stock: 5 }] });
const [v28, v30] = p1.variants;
const skinny = p2.variants[0];

test.after(() => { closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('flete en lempiras suma al costo y el código se asigna por categoría', () => {
  assert.equal(p1.pricing.landedCost, 35000);               // 300 + 50 de flete
  assert.equal(p1.product.extra_cost, 5000);
  assert.equal(p1.pricing.price, Math.round(35000 * 1.5 * 1.15));
  assert.equal(p1.product.code, 'JEAN-0001');
  assert.equal(p2.product.code, 'JEAN-0002');
  assert.notEqual(v28.sku, skinny.sku);
  const own = catalog.createProduct({ name: 'Jean propio', category_id: jeans.id, code: 'esp-01', cost: 100 });
  assert.equal(own.product.code, 'ESP-01');                 // código manual se respeta
  assert.equal(catalog.updateCategory(jeans.id, { ...jeans, code_prefix: 'jn' }).code_prefix, 'JN');
  assert.equal(catalog.createProduct({ name: 'Jean wide', category_id: jeans.id, cost: 100 }).product.code, 'JN-0003');
});

test('inventario: filtros, totales, entrada con proveedor y ajuste por conteo', () => {
  const sid = partners.createSupplier({ name: 'Textiles SPS', rtn: '0801-1999-123456' });
  assert.equal(r.partners.supplier(sid).rtn, '08011999123456');

  let inv = inventory.list({ q: 'mom' });
  assert.equal(inv.rows.length, 2);
  assert.equal(inv.totals.units, 4);
  assert.equal(inv.totals.costValue, 4 * 35000);

  catalog.receiveStock({ supplier_id: sid, document_number: 'F-100', extra_cost: 1000,
    items: [{ variant_id: v30.id, qty: 2, unit_cost: 30000 }] }, admin);
  const after = r.catalog.variant(v30.id);
  assert.equal(after.stock, 3);
  assert.equal(after.cost, Math.round((35000 + 2 * 30500) / 3));   // promedio con flete prorrateado
  assert.equal(partners.supplierDetail(sid).purchases[0].units, 2);
  assert.throws(() => catalog.receiveStock({ supplier_id: 9999, items: [{ variant_id: v30.id, qty: 1, unit_cost: 1 }] }), /Proveedor/);

  const adj = inventory.adjustCount(v30.id, { counted: 2, reason: 'danado' });
  assert.equal(adj.delta, -1);
  assert.equal(r.catalog.variant(v30.id).stock, 2);
  assert.throws(() => inventory.adjustCount(v30.id, { counted: -1 }), /entero/);
  assert.throws(() => inventory.adjustCount(v30.id, { counted: 1, reason: 'otro' }), /motivo/);

  inventory.adjustCount(skinny.id, { counted: 0, reason: 'conteo' });
  inv = inventory.list({ status: 'out' });
  assert.ok(inv.rows.some((v) => v.id === skinny.id));
  assert.ok(inv.counts.out >= 1);
  inventory.adjustCount(skinny.id, { counted: 5, reason: 'conteo' });
});

test('clientes: RTN/DNI válidos y sin duplicados', () => {
  const id = partners.createCustomer({ name: 'Ana Pérez', dni: '0801-1990-12345' });
  assert.equal(r.partners.customer(id).dni, '0801199012345');
  assert.throws(() => partners.createCustomer({ name: 'Otra', dni: '0801199012345' }), /Ya existe/);
  assert.throws(() => partners.createCustomer({ name: 'X', rtn: '123' }), /14 dígitos/);
  const upd = partners.updateCustomer(id, { name: 'Ana María Pérez', dni: '0801199012345', phone: '9999-1111' });
  assert.equal(upd.name, 'Ana María Pérez');
});

test('descuento manual: límite del cajero, motivo obligatorio y totales con ISV', () => {
  cash.open({ opening_amount: 0 });
  const items = [{ variant_id: v28.id, qty: 1, discount_pct: 20 }];
  const q = sales.quote(items);
  assert.equal(q.manualDiscount, Math.round(v28.price * 0.2));
  assert.equal(q.total, v28.price - q.manualDiscount);
  assert.equal(q.taxable15 + q.tax15, q.total);

  const pay = [{ method: 'card', amount: q.total }];
  assert.throws(() => sales.createSale({ items, payments: pay }, admin), /motivo/);
  assert.throws(() => sales.createSale({ items, payments: pay, discount_reason: 'Prenda con detalle' }, cajero), /hasta 10 %/);
  const sale = sales.createSale({ items, payments: pay, discount_reason: 'Prenda con detalle' }, admin);
  assert.equal(sale.manual_discount, q.manualDiscount);
  assert.equal(sale.manual_discount_reason, 'Prenda con detalle');
  assert.equal(sale.items[0].manual_discount, q.manualDiscount);

  const small = sales.quote([{ variant_id: v28.id, qty: 1, discount_amount: 1000 }]);
  assert.equal(small.manualDiscount, 1000);
  assert.throws(() => sales.quote([{ variant_id: v28.id, qty: 1, discount_amount: v28.price + 1 }]), /mayor que el precio/);
});

test('factura con RTN/DNI: crea el cliente una sola vez y lo reutiliza', () => {
  const q = sales.quote([{ variant_id: skinny.id, qty: 1 }]);
  const s1 = sales.createSale({ items: [{ variant_id: skinny.id, qty: 1 }], payments: [{ method: 'cash', amount: q.total }],
    invoice: { doc: '0801-1985-000111', name: 'Comercial La Ceiba S.A.' } }, cajero);
  assert.equal(s1.customerCreated, true);
  assert.equal(s1.customer_rtn, '08011985000111');
  assert.equal(s1.customer_name, 'Comercial La Ceiba S.A.');

  const s2 = sales.createSale({ items: [{ variant_id: skinny.id, qty: 1 }], payments: [{ method: 'cash', amount: q.total }],
    invoice: { doc: '08011985000111' } }, cajero);
  assert.equal(s2.customerCreated, false);
  assert.equal(s2.customer_id, s1.customer_id);
  assert.equal(s2.customer_name, 'Comercial La Ceiba S.A.');

  const s3 = sales.createSale({ items: [{ variant_id: skinny.id, qty: 1 }], payments: [{ method: 'cash', amount: q.total }],
    invoice: { doc: '0801199900011', name: 'Luis Gómez' } }, cajero);
  assert.equal(s3.customer_dni, '0801199900011');
  assert.equal(s3.customer_rtn, null);

  const s4 = sales.createSale({ items: [{ variant_id: skinny.id, qty: 1 }], payments: [{ method: 'cash', amount: q.total }],
    invoice: { name: 'Solo nombre' } }, cajero);
  assert.equal(s4.customer_id, null);
  assert.equal(s4.customer_name, 'Solo nombre');
  assert.throws(() => sales.createSale({ items: [{ variant_id: skinny.id, qty: 1 }], payments: [{ method: 'cash', amount: q.total }],
    invoice: { doc: '123' } }, cajero), /13/);
});

test('al vender la última unidad avisa que se agotó', () => {
  const left = r.catalog.variant(v30.id).stock;
  const q = sales.quote([{ variant_id: v30.id, qty: left }]);
  const sale = sales.createSale({ items: [{ variant_id: v30.id, qty: left }], payments: [{ method: 'cash', amount: q.total }] }, cajero);
  assert.equal(sale.stockAlerts.out.length, 1);
  assert.equal(sale.stockAlerts.out[0].id, v30.id);
});

test('historial del día y reimpresión marcada', () => {
  const list = sales.listSales({});
  assert.ok(list.length >= 5);
  const found = sales.listSales({ q: 'La Ceiba' });
  assert.equal(found.length, 2);
  const again = sales.reprint(found[0].id);
  assert.equal(again.reprint_count, 1);
  assert.ok(again.reprinted_at);
  assert.equal(sales.reprint(found[0].id).reprint_count, 2);
});

test('lento movimiento por niveles 15 / 30 / 60 días', () => {
  const g = groupSlow([{ idle_days: 15 }, { idle_days: 29 }, { idle_days: 30 }, { idle_days: 59 }, { idle_days: 60 }, { idle_days: 200 }], [15, 30, 60]);
  assert.deepEqual(g.map((x) => x.label), ['15 a 29 días', '30 a 59 días', '60 días o más']);
  assert.deepEqual(g.map((x) => x.items.length), [2, 2, 2]);
  r.db.prepare("UPDATE product_variants SET last_sold_at = date('now', '-40 days'), last_received_at = NULL WHERE id = ?").run(v28.id);
  const a = getAlerts();
  assert.deepEqual(a.slowTiers, [15, 30, 60]);
  assert.ok(a.slowGroups[1].items.some((v) => v.id === v28.id));
});

test('reportes: resumen, formas de pago, vendedores y descuentos', () => {
  const q = { from: '2000-01-01', to: '2999-12-31' };
  const sum = reports.summary(q);
  assert.ok(sum.tickets >= 6);
  assert.ok(sum.manualDiscounts > 0);
  assert.equal(sum.avgTicket, Math.round(sum.total / sum.tickets));
  const pm = reports.paymentMethods(q);
  assert.ok(pm.some((x) => x.method === 'card') && pm.some((x) => x.method === 'cash'));
  assert.ok(reports.byUser(q).length >= 1);
  assert.ok(reports.discounts(q).some((d) => d.reason === 'Prenda con detalle'));
});
