'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base temporal aislada
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelpos-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.BACKUP_DIR = path.join(tmp, 'backups');

const { getDb, closeDb } = require('../server/db/connection');
const { migrate } = require('../server/db/migrate');
const { repos } = require('../server/repositories');
const catalog = require('../server/services/catalog');
const sales = require('../server/services/sales');
const cash = require('../server/services/cash');
const fiscal = require('../server/services/fiscal');
const partners = require('../server/services/partners');
const { getAlerts } = require('../server/services/alerts');
const { backupNow } = require('../server/db/backup');

migrate(getDb());
const r = repos();
const isv = r.catalog.taxRateByCode('ISV15').id;
const bolsos = r.catalog.insertCategory({ name: 'Bolsos', margin_pct: 80, tax_rate_id: isv, min_stock: 1 });
const acc = r.catalog.insertCategory({ name: 'Accesorios', margin_pct: 90, tax_rate_id: isv, min_stock: 3 });
r.catalog.insertPromotion({ name: 'Combo', type: 'combo', discount_pct: 15 },
  [{ category_id: bolsos, qty: 1 }, { category_id: acc, qty: 1 }]);
r.settings.set('price_rounding', '0');

const bolso = catalog.createProduct({ name: 'Bolso', category_id: bolsos, cost: 35000, variants: [{ size: 'U', color: 'Negro', stock: 2 }] }).variants[0];
const arete = catalog.createProduct({ name: 'Aretes', category_id: acc, cost: 4500, variants: [{ size: 'U', color: 'Oro', stock: 5 }] }).variants[0];

test.after(() => { closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('precio calculado desde costo bruto y código de barras interno', () => {
  assert.equal(bolso.price, Math.round(35000 * 1.8 * 1.15));
  assert.match(bolso.barcode, /^20\d{11}$/);
});

test('no se puede vender sin caja abierta', () => {
  assert.throws(() => sales.createSale({ items: [{ variant_id: bolso.id, qty: 1 }], payments: [] }), /caja/i);
});

test('venta con combo, ISV, inventario, comprobante y arqueo', () => {
  cash.open({ opening_amount: 50000 });
  const q = sales.quote([{ variant_id: bolso.id, qty: 1 }, { variant_id: arete.id, qty: 1 }]);
  assert.ok(q.discount > 0);
  assert.equal(q.taxable15 + q.tax15, q.total);

  const sale = sales.createSale({
    items: [{ variant_id: bolso.id, qty: 1 }, { variant_id: arete.id, qty: 1 }],
    payments: [{ method: 'cash', amount: q.total, tendered: q.total + 5000 }],
  });
  assert.equal(sale.doc_kind, 'comprobante');
  assert.equal(sale.doc_number, 'CI-00000001');
  assert.equal(sale.change, 5000);
  assert.equal(r.catalog.variant(bolso.id).stock, 1);

  cash.addMovement({ type: 'expense', amount: 2000, description: 'Bolsas plásticas' });
  const closed = cash.close({ counted_cash: 50000 + q.total - 2000 });
  assert.equal(closed.session.difference, 0);
});

test('modo fiscal: numeración con CAI y validación de stock', () => {
  cash.open({ opening_amount: 0 });
  r.settings.set('fiscal_mode', 'formal');
  fiscal.addCai({ cai: 'ABC123-DEF456-ABC123-DEF456-ABC123-0F', range_start: 1, range_end: 100, deadline: '2099-12-31' });
  const q = sales.quote([{ variant_id: arete.id, qty: 1 }]);
  const s = sales.createSale({ items: [{ variant_id: arete.id, qty: 1 }], payments: [{ method: 'card', amount: q.total }] });
  assert.equal(s.doc_kind, 'factura');
  assert.equal(s.doc_number, '000-001-01-00000001');
  assert.throws(() => sales.createSale({ items: [{ variant_id: bolso.id, qty: 5 }], payments: [{ method: 'card', amount: 1 }] }), /Stock insuficiente/);
});

test('crédito: límite, cuenta por cobrar y abono', () => {
  const cid = partners.createCustomer({ name: 'Cliente crédito', credit_limit: 100000, credit_days: 0 });
  const q = sales.quote([{ variant_id: arete.id, qty: 1 }]);
  sales.createSale({ customer_id: cid, items: [{ variant_id: arete.id, qty: 1 }], payments: [{ method: 'credit', amount: q.total }] });
  assert.equal(partners.customerDetail(cid).balance, q.total);
  partners.registerPayment(cid, { amount: q.total, method: 'cash' });
  assert.equal(partners.customerDetail(cid).balance, 0);
});

test('alertas de stock mínimo', () => {
  const a = getAlerts();
  assert.ok(a.lowStock.some((v) => v.id === bolso.id || v.id === arete.id));
});

test('respaldo consistente', async () => {
  const file = await backupNow('test');
  assert.ok(fs.existsSync(file));
});

test('crear categoría: valida nombre único sin importar mayúsculas y datos', () => {
  const c = catalog.createCategory({ name: '  Blusas   de  seda ', margin_pct: '65', min_stock: '4', tax_rate_id: String(isv) });
  assert.equal(c.name, 'Blusas de seda');
  assert.equal(c.margin_pct, 65);
  assert.equal(c.min_stock, 4);
  assert.equal(c.tax_rate_id, isv);
  assert.equal(catalog.createCategory({ name: 'Cinturones', margin_pct: '' }).margin_pct, null);
  assert.throws(() => catalog.createCategory({ name: 'BOLSOS' }), /Ya existe/);
  assert.throws(() => catalog.createCategory({ name: '   ' }), /obligatorio/);
  assert.throws(() => catalog.createCategory({ name: 'X', margin_pct: 'abc' }), /Margen/);
  assert.throws(() => catalog.createCategory({ name: 'Y', min_stock: '-1' }), /Stock/);
  assert.throws(() => catalog.createCategory({ name: 'Z', tax_rate_id: 9999 }), /Impuesto/);
});

test('editar categoría: cambia datos, valida duplicados y aplica stock mínimo al instante', () => {
  const c = catalog.createCategory({ name: 'Calzado', margin_pct: 50, min_stock: 1 });
  catalog.createProduct({ name: 'Tenis', category_id: c.id, cost: 50000, variants: [{ size: '38', color: 'Blanco', stock: 3 }] });
  const lowStock = () => r.reports.lowStock().some((v) => v.product_name === 'Tenis');
  assert.equal(lowStock(), false);

  const u = catalog.updateCategory(c.id, { name: 'Calzado de mujer', margin_pct: '', min_stock: 5, tax_rate_id: isv });
  assert.equal(u.name, 'Calzado de mujer');
  assert.equal(u.margin_pct, null);
  assert.equal(lowStock(), true);   // 3 unidades <= 5 ahora es stock bajo

  assert.equal(catalog.updateCategory(c.id, { name: 'CALZADO DE MUJER' }).name, 'CALZADO DE MUJER'); // su propio nombre
  assert.throws(() => catalog.updateCategory(c.id, { name: 'bolsos' }), /Ya existe/);
  assert.throws(() => catalog.createCategory({ name: 'Accesórios' }), /Ya existe/);   // tildes no cuentan
  assert.throws(() => catalog.updateCategory(99999, { name: 'Nada' }), /no encontrada/);
});
