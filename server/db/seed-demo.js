'use strict';
/** Carga categorías, productos, clientes y una promoción de ejemplo. Uso: npm run seed:demo */
const { getDb } = require('./connection');
const { migrate } = require('./migrate');
const { repos } = require('../repositories');
const catalog = require('../services/catalog');
const partners = require('../services/partners');
const sec = require('../lib/security');

const db = getDb();
migrate(db);
const r = repos(db);

if (r.catalog.categories().length) {
  console.log('La base ya tiene datos; no se cargó la demo.');
  process.exit(0);
}

const isv15 = r.catalog.taxRateByCode('ISV15').id;
const cat = {};
for (const [name, margin, minStock] of [['Ropa', 70, 2], ['Accesorios', 90, 3], ['Calzado', 55, 1], ['Bolsos', 80, 1]]) {
  cat[name] = r.catalog.insertCategory({ name, margin_pct: margin, tax_rate_id: isv15, min_stock: minStock });
}

const L = (n) => Math.round(n * 100);
const products = [
  { name: 'Blusa de lino', code: 'BLU-LINO', category_id: cat.Ropa, brand: 'Zoe', cost: L(180),
    variants: [['S', 'Blanco', 4], ['M', 'Blanco', 6], ['L', 'Blanco', 2], ['M', 'Beige', 3]] },
  { name: 'Jeans mom fit', code: 'JEAN-MOM', category_id: cat.Ropa, brand: 'Denim Co', cost: L(320), extra_cost_pct: 12,
    variants: [['26', 'Azul', 3], ['28', 'Azul', 5], ['30', 'Azul', 2], ['28', 'Negro', 1]] },
  { name: 'Vestido midi floral', code: 'VEST-MIDI', category_id: cat.Ropa, cost: L(410),
    variants: [['S', 'Rosa', 2], ['M', 'Rosa', 2]] },
  { name: 'Aretes dorados', code: 'ARE-DOR', category_id: cat.Accesorios, cost: L(45),
    variants: [['Única', 'Dorado', 15]] },
  { name: 'Collar perlas', code: 'COL-PER', category_id: cat.Accesorios, cost: L(90),
    variants: [['Única', 'Blanco', 6]] },
  { name: 'Cinturón cuero', code: 'CIN-CUE', category_id: cat.Accesorios, cost: L(120),
    variants: [['Única', 'Café', 1], ['Única', 'Negro', 4]] },
  { name: 'Sandalia plataforma', code: 'SAN-PLA', category_id: cat.Calzado, cost: L(380), extra_cost_pct: 15,
    variants: [['36', 'Negro', 2], ['37', 'Negro', 3], ['38', 'Negro', 1], ['37', 'Nude', 2]] },
  { name: 'Bolso tote', code: 'BOL-TOT', category_id: cat.Bolsos, cost: L(350),
    variants: [['Única', 'Negro', 3], ['Única', 'Camel', 2]] },
  { name: 'Bolso bandolera', code: 'BOL-BAN', category_id: cat.Bolsos, cost: L(260),
    variants: [['Única', 'Rojo', 1]] },
];
for (const p of products) {
  catalog.createProduct({ ...p, variants: p.variants.map(([size, color, stock]) => ({ size, color, stock })) });
}

r.catalog.insertPromotion(
  { name: 'Combo Bolso + Accesorio -15%', type: 'combo', discount_pct: 15, priority: 10 },
  [{ category_id: cat.Bolsos, qty: 1 }, { category_id: cat.Accesorios, qty: 1 }]
);

partners.createCustomer({ name: 'María López', phone: '9999-0000', credit_limit: L(3000), credit_days: 30 });
partners.createCustomer({ name: 'Boutique Ejemplo S. de R.L.', rtn: '08011999123456', credit_limit: L(10000), credit_days: 15 });
partners.createSupplier({ name: 'Importadora Textil SPS', phone: '2550-0000', country: 'Honduras' });

// Usuario cajero de prueba SOLO para desarrollo (no usar en la tienda)
if (process.argv.includes('--with-users')) {
  r.users.insert({ name: 'Admin Demo', username: 'admin', role: 'admin', password_hash: sec.hashPassword('Demo-Admin-2026'),
                   must_change_password: 0, password_changed_at: null });
  r.users.insert({ name: 'Cajera Demo', username: 'cajera', role: 'cajero', password_hash: sec.hashPassword('Demo-Caja-2026'),
                   must_change_password: 0, password_changed_at: null });
  console.log('Usuarios demo: admin / Demo-Admin-2026  ·  cajera / Demo-Caja-2026');
}
console.log('Datos de demostración cargados ✔');
