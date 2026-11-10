'use strict';
/**
 * Motor de promociones (función pura).
 *
 * lines: [{ variant_id, product_id, category_id, qty, unit_price }]
 * promotions: [{ id, name, type: 'combo'|'item_pct', discount_pct, priority,
 *                rules: [{ category_id, product_id, qty }] }]
 *
 * - combo:    se forman tantos combos completos como permita el carrito; el descuento
 *             se aplica solo a las unidades que integran cada combo.
 * - item_pct: descuento a toda unidad que cumpla alguna regla.
 * Cada unidad recibe como máximo UNA promoción (la de mayor prioridad).
 * Para combos se usan primero las unidades de menor precio (criterio conservador).
 *
 * Retorna { discounts: number[] (por línea, centavos), lineAssignments, applied: [...] }
 */
function applyPromotions(lines, promotions) {
  const units = [];
  lines.forEach((l, lineIdx) => {
    for (let i = 0; i < l.qty; i++) units.push({ lineIdx, line: l, used: false });
  });

  const discounts = lines.map(() => 0);
  const lineAssignments = lines.map(() => null);
  const applied = [];

  const matches = (rule, line) =>
    (rule.product_id != null && rule.product_id === line.product_id) ||
    (rule.product_id == null && rule.category_id != null && rule.category_id === line.category_id);

  const sorted = [...promotions].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const promo of sorted) {
    if (!promo.rules?.length) continue;
    const pct = promo.discount_pct / 100;
    let promoDiscount = 0;
    let times = 0;

    if (promo.type === 'combo') {
      // Unidades libres por regla, de menor a mayor precio
      const pools = promo.rules.map((r) =>
        units.filter((u) => !u.used && matches(r, u.line)).sort((a, b) => a.line.unit_price - b.line.unit_price)
      );
      // Formar combos uno a uno evitando que una unidad cuente para dos reglas
      for (;;) {
        const picked = [];
        let ok = true;
        for (let r = 0; r < promo.rules.length && ok; r++) {
          const need = promo.rules[r].qty || 1;
          const avail = pools[r].filter((u) => !u.used && !picked.includes(u));
          if (avail.length < need) ok = false;
          else picked.push(...avail.slice(0, need));
        }
        if (!ok) break;
        times++;
        for (const u of picked) {
          u.used = true;
          const d = Math.round(u.line.unit_price * pct);
          discounts[u.lineIdx] += d;
          lineAssignments[u.lineIdx] = promo.id;
          promoDiscount += d;
        }
      }
    } else if (promo.type === 'item_pct') {
      for (const u of units) {
        if (u.used || !promo.rules.some((r) => matches(r, u.line))) continue;
        u.used = true;
        times++;
        const d = Math.round(u.line.unit_price * pct);
        discounts[u.lineIdx] += d;
        lineAssignments[u.lineIdx] = promo.id;
        promoDiscount += d;
      }
    }

    if (promoDiscount > 0) applied.push({ id: promo.id, name: promo.name, times, discount: promoDiscount });
  }

  return { discounts, lineAssignments, applied };
}

module.exports = { applyPromotions };
