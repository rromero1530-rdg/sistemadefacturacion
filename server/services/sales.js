'use strict';
const { repos } = require('../repositories');
const { applyPromotions } = require('./promotions');
const fiscal = require('./fiscal');
const { splitTax } = require('../lib/money');
const { nowLocal, todayLocal, addDays } = require('../lib/time');
const { badRequest, conflict, notFound } = require('../lib/errors');

const METHODS = ['cash', 'card', 'transfer', 'credit'];

/**
 * Cotiza un carrito: precios, promociones automáticas y desglose de ISV.
 * El POS llama esto en cada cambio para mostrar totales; la venta usa EXACTAMENTE la misma función.
 */
function quote(items, r = repos()) {
  if (!Array.isArray(items) || !items.length) {
    return { lines: [], promotions: [], gross: 0, discount: 0, total: 0, exempt: 0,
             taxable15: 0, taxable18: 0, tax15: 0, tax18: 0, cost: 0 };
  }
  // Consolidar líneas repetidas de la misma variante
  const merged = new Map();
  for (const it of items) {
    const qty = Math.trunc(Number(it.qty));
    if (!(qty > 0)) throw badRequest('Cantidad inválida');
    merged.set(Number(it.variant_id), (merged.get(Number(it.variant_id)) || 0) + qty);
  }
  const variants = new Map(r.catalog.variantsByIds([...merged.keys()]).map((v) => [v.id, v]));
  const lines = [...merged].map(([id, qty]) => {
    const v = variants.get(id);
    if (!v) throw notFound(`Producto ${id} no existe`);
    return { variant_id: v.id, product_id: v.product_id, category_id: v.category_id, qty,
             unit_price: v.price, unit_cost: v.cost, tax_rate: v.tax_rate, stock: v.stock,
             description: [v.product_name, v.size, v.color].filter(Boolean).join(' / '), sku: v.sku };
  });

  const promo = applyPromotions(lines, r.catalog.activePromotions(todayLocal()));
  const t = { gross: 0, discount: 0, total: 0, exempt: 0, taxable15: 0, taxable18: 0, tax15: 0, tax18: 0, cost: 0 };
  const byRate = {};

  lines.forEach((l, i) => {
    l.discount = promo.discounts[i];
    l.promotion_id = promo.lineAssignments[i];
    l.line_total = l.qty * l.unit_price - l.discount;
    t.gross += l.qty * l.unit_price;
    t.discount += l.discount;
    t.total += l.line_total;
    t.cost += l.qty * l.unit_cost;
    byRate[l.tax_rate] = (byRate[l.tax_rate] || 0) + l.line_total;
  });
  // El ISV se calcula sobre el total por tasa (no línea por línea) para minimizar redondeos
  for (const [rate, gross] of Object.entries(byRate)) {
    const { base, tax } = splitTax(gross, Number(rate));
    if (Number(rate) === 0) t.exempt += gross;
    else if (Number(rate) === 18) { t.taxable18 += base; t.tax18 += tax; }
    else { t.taxable15 += base; t.tax15 += tax; }
  }
  return { lines, promotions: promo.applied, ...t };
}

/**
 * Registra una venta completa en una sola transacción:
 * numeración fiscal, líneas, pagos, inventario, crédito.
 */
function createSale(input, user = null) {
  const r = repos();
  return r.db.transaction(() => {
    const session = r.cash.openSession();
    if (!session) throw conflict('No hay caja abierta. Abre la caja antes de vender.');

    const q = quote(input.items, r);
    if (!q.lines.length) throw badRequest('El carrito está vacío');

    const allowNegative = r.settings.get('allow_negative_stock') === '1';
    if (!allowNegative) {
      const short = q.lines.filter((l) => l.qty > l.stock);
      if (short.length) throw conflict('Stock insuficiente', short.map((l) => ({ sku: l.sku, stock: l.stock, qty: l.qty })));
    }

    // ----- Pagos -----
    const payments = (input.payments || []).map((p) => ({
      method: p.method, amount: Math.round(Number(p.amount)),
      tendered: p.tendered != null ? Math.round(Number(p.tendered)) : null, reference: p.reference || null,
    }));
    if (!payments.length) throw badRequest('Debe indicar forma de pago');
    for (const p of payments) {
      if (!METHODS.includes(p.method)) throw badRequest(`Forma de pago inválida: ${p.method}`);
      if (!(p.amount > 0)) throw badRequest('Monto de pago inválido');
      if (p.method === 'cash' && p.tendered != null && p.tendered < p.amount) throw badRequest('Efectivo recibido menor al monto');
    }
    const paid = payments.reduce((a, p) => a + p.amount, 0);
    if (paid !== q.total) throw badRequest(`Los pagos (${paid}) no cuadran con el total (${q.total})`);

    // ----- Cliente / crédito -----
    let customer = null;
    if (input.customer_id) {
      customer = r.partners.customer(input.customer_id);
      if (!customer) throw notFound('Cliente no existe');
    }
    const credit = payments.filter((p) => p.method === 'credit').reduce((a, p) => a + p.amount, 0);
    if (credit > 0) {
      if (!customer) throw badRequest('La venta al crédito requiere un cliente');
      if (customer.balance + credit > customer.credit_limit) {
        throw conflict(`Excede el límite de crédito. Disponible: ${customer.credit_limit - customer.balance}`);
      }
    }

    // ----- Documento -----
    const now = nowLocal();
    const doc = fiscal.nextDocument(r);
    const saleId = r.sales.insertSale({
      ...doc,
      customer_id: customer?.id ?? null,
      customer_name: customer?.name || input.customer_name || 'Consumidor Final',
      customer_rtn: customer?.rtn || input.customer_rtn || null,
      cash_session_id: session.id,
      user_id: user?.id ?? null,
      gross_amount: q.gross, discount_amount: q.discount, exempt_amount: q.exempt,
      taxable15_amount: q.taxable15, taxable18_amount: q.taxable18,
      tax15_amount: q.tax15, tax18_amount: q.tax18, total: q.total, cost_total: q.cost,
      exempt_order_number: input.exempt_order_number || null,
      exoneration_record: input.exoneration_record || null,
      sag_registration: input.sag_registration || null,
      created_at: now,
    });

    for (const l of q.lines) {
      r.sales.insertItem({ sale_id: saleId, variant_id: l.variant_id, description: l.description, qty: l.qty,
                           unit_price: l.unit_price, unit_cost: l.unit_cost, discount: l.discount,
                           tax_rate: l.tax_rate, line_total: l.line_total, promotion_id: l.promotion_id });
      r.catalog.adjustStock(l.variant_id, -l.qty, { lastSoldAt: now });
      r.catalog.insertMovement({ variant_id: l.variant_id, type: 'sale', qty: -l.qty, unit_cost: l.unit_cost,
                                 ref_table: 'sales', ref_id: saleId, created_at: now });
    }
    for (const p of payments) r.sales.insertPayment({ sale_id: saleId, ...p });

    if (credit > 0) {
      r.sales.insertReceivable({ customer_id: customer.id, sale_id: saleId, original_amount: credit, balance: credit,
                                 due_date: addDays(now, customer.credit_days || 30), created_at: now });
    }

    const sale = r.sales.sale(saleId);
    sale.change = payments.reduce((a, p) => a + (p.method === 'cash' && p.tendered ? p.tendered - p.amount : 0), 0);
    sale.promotions = q.promotions;
    return sale;
  })();
}

function getSale(id) {
  const r = repos();
  const sale = r.sales.sale(id);
  if (!sale) throw notFound('Venta no existe');
  return { ...sale, business: r.settings.all() };
}

module.exports = { quote, createSale, getSale };
