'use strict';
const { repos } = require('../repositories');
const { badRequest, notFound } = require('../lib/errors');
const { nowLocal, todayLocal } = require('../lib/time');

const STATUSES = ['all', 'in_stock', 'low', 'out', 'slow'];
const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Primer nivel de "sin movimiento" (por defecto 15 días). */
function slowTiers(r = repos()) {
  const tiers = String(r.settings.get('slow_moving_tiers') || '15,30,60').split(',')
    .map((n) => Math.trunc(Number(n))).filter((n) => n > 0).sort((a, b) => a - b);
  return tiers.length ? tiers : [15, 30, 60];
}

/**
 * Tabla de inventario con filtros y totales (valor al costo y a precio de venta).
 * status: all | in_stock | low (stock bajo, aún hay) | out (agotado) | slow (sin vender desde el 1er nivel)
 */
function list({ q = '', category_id = null, status = 'all' } = {}) {
  const r = repos();
  if (!STATUSES.includes(status)) throw badRequest('Filtro inválido');
  const firstTier = slowTiers(r)[0];
  const needle = fold(q.trim());
  const cat = Number(category_id) || null;

  const all = r.catalog.inventory(todayLocal()).map((v) => ({
    ...v,
    state: v.stock <= 0 ? 'out' : v.stock <= v.min_stock ? 'low' : 'ok',
    slow: v.stock > 0 && v.idle_days >= firstTier,
  }));
  const rows = all.filter((v) => {
    if (cat && v.category_id !== cat) return false;
    if (needle && ![v.product_name, v.product_code, v.sku, v.barcode, v.brand, v.size, v.color, v.category_name]
      .some((x) => fold(x).includes(needle))) return false;
    if (status === 'in_stock') return v.stock > 0;
    if (status === 'low') return v.state === 'low';
    if (status === 'out') return v.state === 'out';
    if (status === 'slow') return v.slow;
    return true;
  });

  const sum = (list, fn) => list.reduce((a, v) => a + fn(v), 0);
  const positive = (v) => Math.max(v.stock, 0);
  return {
    rows,
    slowDays: firstTier,
    totals: {
      variants: rows.length,
      units: sum(rows, positive),
      costValue: sum(rows, (v) => positive(v) * v.cost),
      retailValue: sum(rows, (v) => positive(v) * v.price),
    },
    // Conteos de toda la tienda (para las pestañas de filtro)
    counts: {
      all: all.length,
      in_stock: all.filter((v) => v.stock > 0).length,
      low: all.filter((v) => v.state === 'low').length,
      out: all.filter((v) => v.state === 'out').length,
      slow: all.filter((v) => v.slow).length,
    },
  };
}

const ADJUST_REASONS = {
  conteo: 'Conteo físico', danado: 'Dañado', perdida: 'Pérdida / robo', muestra: 'Regalo / muestra', otro: 'Otro',
};

/** Ajuste por conteo físico: deja la existencia en la cantidad contada y registra la diferencia. */
function adjustCount(variantId, { counted, reason = 'conteo', note = '' } = {}, user = null) {
  const r = repos();
  const v = r.catalog.variant(variantId);
  if (!v) throw notFound('Producto no encontrado');
  const qty = Number(counted);
  if (!(Number.isInteger(qty) && qty >= 0)) throw badRequest('La cantidad contada debe ser un número entero, 0 o mayor');
  if (!ADJUST_REASONS[reason]) throw badRequest('Motivo inválido');
  if (reason === 'otro' && !String(note).trim()) throw badRequest('Describe el motivo del ajuste');
  const delta = qty - v.stock;
  if (delta === 0) return { variant: v, delta: 0 };
  const now = nowLocal();
  r.db.transaction(() => {
    r.catalog.adjustStock(v.id, delta);
    r.catalog.insertMovement({
      variant_id: v.id, type: 'adjustment', qty: delta, unit_cost: v.cost, user_id: user?.id ?? null, created_at: now,
      note: [ADJUST_REASONS[reason], String(note).trim()].filter(Boolean).join(': '),
    });
  })();
  return { variant: r.catalog.variant(v.id), delta };
}

module.exports = { list, adjustCount, slowTiers, ADJUST_REASONS };
