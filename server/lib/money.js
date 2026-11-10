'use strict';
// Todo el dinero se maneja en centavos enteros. La API recibe/entrega Lempiras (decimales).

const toCents = (lempiras) => {
  const n = Number(lempiras);
  if (!Number.isFinite(n)) throw new TypeError(`Monto inválido: ${lempiras}`);
  return Math.round(n * 100);
};
const toLempiras = (cents) => Math.round(cents) / 100;
const roundUpTo = (cents, step) => (step > 0 ? Math.ceil(cents / step) * step : Math.round(cents));

/** Separa un monto con ISV incluido en base imponible + impuesto. */
function splitTax(grossCents, ratePct) {
  const base = Math.round(grossCents / (1 + ratePct / 100));
  return { base, tax: grossCents - base };
}

module.exports = { toCents, toLempiras, roundUpTo, splitTax };
