'use strict';
const { roundUpTo, splitTax } = require('../lib/money');

/**
 * Calcula el precio de venta a partir del COSTO BRUTO.
 *
 *  costo puesto  = costo bruto * (1 + gastos de importación %)
 *  precio base   = markup: costo * (1 + margen)     | margin: costo / (1 - margen)
 *  precio final  = precio base * (1 + ISV), redondeado hacia arriba (p.ej. a L 5)
 *
 * Todos los montos en centavos.
 */
function calculatePrice({ cost, marginPct, taxRatePct = 15, extraCostPct = 0, mode = 'markup', rounding = 0 }) {
  if (!(cost >= 0)) throw new RangeError('El costo debe ser >= 0');
  const m = Number(marginPct) / 100;
  if (mode === 'margin' && m >= 1) throw new RangeError('El margen sobre precio debe ser < 100 %');

  const landedCost = Math.round(cost * (1 + Number(extraCostPct) / 100));
  const base = mode === 'margin' ? landedCost / (1 - m) : landedCost * (1 + m);
  const price = roundUpTo(Math.round(base * (1 + taxRatePct / 100)), rounding);

  const { base: netPrice, tax } = splitTax(price, taxRatePct);
  const profit = netPrice - landedCost;
  return {
    cost,
    landedCost,
    netPrice,           // precio sin ISV
    tax,                // ISV incluido
    price,              // precio final al público
    profit,             // utilidad bruta por unidad
    marginOnPricePct: netPrice ? round2((profit / netPrice) * 100) : 0,
    markupPct: landedCost ? round2((profit / landedCost) * 100) : 0,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Margen efectivo: producto > categoría > global */
function resolveMargin(product, category, settings) {
  return product?.margin_pct ?? category?.margin_pct ?? Number(settings.default_margin_pct);
}

module.exports = { calculatePrice, resolveMargin };
