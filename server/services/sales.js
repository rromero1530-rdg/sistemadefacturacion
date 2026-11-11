'use strict';
const { repos } = require('../repositories');
const { applyPromotions } = require('./promotions');
const fiscal = require('./fiscal');
const partners = require('./partners');
const { splitTax } = require('../lib/money');
const { nowLocal, todayLocal, addDays } = require('../lib/time');
const { badRequest, conflict, notFound, AppError } = require('../lib/errors');

const METHODS = ['cash', 'card', 'transfer', 'credit'];
const EMPTY = { lines: [], promotions: [], gross: 0, discount: 0, manualDiscount: 0, total: 0, exempt: 0,
                taxable15: 0, taxable18: 0, tax15: 0, tax18: 0, cost: 0 };

/** Descuento manual de una línea: { discount_pct } o { discount_amount } (centavos). */
function manualDiscountFor(it, available) {
  const pct = it.discount_pct != null && it.discount_pct !== '' ? Number(it.discount_pct) : null;
  const amt = it.discount_amount != null && it.discount_amount !== '' ? Math.round(Number(it.discount_amount)) : null;
  if (pct != null) {
    if (!(pct >= 0 && pct <= 100)) throw badRequest('El descuento debe estar entre 0 % y 100 %');
    return Math.min(available, Math.round((available * pct) / 100));
  }
  if (amt != null) {
    if (!(amt >= 0)) throw badRequest('Descuento inválido');
    if (amt > available) throw badRequest('El descuento no puede ser mayor que el precio');
    return amt;
  }
  return 0;
}

/**
 * Cotiza un carrito: precios, promociones automáticas, descuentos manuales y desglose de ISV.
 * El POS llama esto en cada cambio para mostrar totales; la venta usa EXACTAMENTE la misma función.
 * items: [{ variant_id, qty, discount_pct?, discount_amount? }]
 */
function quote(items, r = repos()) {
  if (!Array.isArray(items) || !items.length) return { ...EMPTY };
  // Consolidar líneas repetidas de la misma variante (el último descuento indicado manda)
  const merged = new Map();
  for (const it of items) {
    const qty = Math.trunc(Number(it.qty));
    if (!(qty > 0)) throw badRequest('Cantidad inválida');
    const id = Number(it.variant_id);
    const prev = merged.get(id);
    merged.set(id, { ...prev, ...it, qty: (prev?.qty || 0) + qty });
  }
  const variants = new Map(r.catalog.variantsByIds([...merged.keys()]).map((v) => [v.id, v]));
  const lines = [...merged].map(([id, it]) => {
    const v = variants.get(id);
    if (!v) throw notFound(`Producto ${id} no existe`);
    return { variant_id: v.id, product_id: v.product_id, category_id: v.category_id, qty: it.qty,
             unit_price: v.price, unit_cost: v.cost, tax_rate: v.tax_rate, stock: v.stock,
             description: [v.product_name, v.size, v.color].filter(Boolean).join(' / '), sku: v.sku, _input: it };
  });

  const promo = applyPromotions(lines, r.catalog.activePromotions(todayLocal()));
  const t = { gross: 0, discount: 0, manualDiscount: 0, total: 0, exempt: 0, taxable15: 0, taxable18: 0, tax15: 0, tax18: 0, cost: 0 };
  const byRate = {};

  lines.forEach((l, i) => {
    const gross = l.qty * l.unit_price;
    const promoDiscount = promo.discounts[i];
    // El descuento manual se aplica sobre lo que queda después de la promoción
    l.manual_discount = manualDiscountFor(l._input, gross - promoDiscount);
    l.manual_discount_pct = gross ? Math.round((l.manual_discount / gross) * 10000) / 100 : 0;
    l.discount_pct = l._input.discount_pct ?? null;
    l.discount_amount = l._input.discount_amount ?? null;
    delete l._input;
    l.promo_discount = promoDiscount;
    l.discount = promoDiscount + l.manual_discount;
    l.promotion_id = promo.lineAssignments[i];
    l.line_total = gross - l.discount;
    t.gross += gross;
    t.discount += l.discount;
    t.manualDiscount += l.manual_discount;
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

/** Un cajero no puede dar más descuento manual que el permitido (el administrador sí). */
function checkDiscountPermission(q, user, r) {
  if (!q.manualDiscount || user?.role === 'admin') return;
  const max = Number(r.settings.get('max_cashier_discount_pct') ?? 10);
  const over = q.lines.find((l) => l.manual_discount_pct > max + 0.005);
  if (over) {
    throw new AppError(403, `Como cajero puedes dar hasta ${max} % de descuento. "${over.description}" tiene ${over.manual_discount_pct} %. Pide a un administrador que la cobre.`);
  }
}

/**
 * Registra una venta completa en una sola transacción:
 * numeración fiscal, cliente (lo crea si se factura con RTN/DNI nuevo), líneas, pagos, inventario, crédito.
 */
function createSale(input, user = null) {
  const r = repos();
  return r.db.transaction(() => {
    const session = r.cash.openSession();
    if (!session) throw conflict('No hay caja abierta. Abre la caja antes de vender.');

    const q = quote(input.items, r);
    if (!q.lines.length) throw badRequest('El carrito está vacío');
    checkDiscountPermission(q, user, r);
    const discountReason = String(input.discount_reason || '').trim().slice(0, 200) || null;
    if (q.manualDiscount > 0 && !discountReason) throw badRequest('Indica el motivo del descuento');

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

    // ----- Cliente / datos de factura -----
    let customer = null;
    let customerCreated = false;
    const invoice = input.invoice || null;           // { doc: RTN o DNI, name }
    const invoiceName = String(invoice?.name || '').trim().replace(/\s+/g, ' ').slice(0, 120) || null;
    if (input.customer_id) {
      customer = r.partners.customer(input.customer_id);
      if (!customer) throw notFound('Cliente no existe');
    } else if (invoice?.doc) {
      ({ customer, created: customerCreated } = partners.findOrCreateByDoc(r, invoice));
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
      customer_name: invoiceName || customer?.name || 'Consumidor Final',
      customer_rtn: customer?.rtn || null,
      customer_dni: customer?.rtn ? null : customer?.dni || null,
      cash_session_id: session.id,
      user_id: user?.id ?? null,
      gross_amount: q.gross, discount_amount: q.discount, exempt_amount: q.exempt,
      manual_discount: q.manualDiscount, manual_discount_reason: q.manualDiscount ? discountReason : null,
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
                           manual_discount: l.manual_discount,
                           tax_rate: l.tax_rate, line_total: l.line_total, promotion_id: l.promotion_id });
      r.catalog.adjustStock(l.variant_id, -l.qty, { lastSoldAt: now });
      r.catalog.insertMovement({ variant_id: l.variant_id, type: 'sale', qty: -l.qty, unit_cost: l.unit_cost,
                                 ref_table: 'sales', ref_id: saleId, user_id: user?.id ?? null, created_at: now });
    }
    for (const p of payments) r.sales.insertPayment({ sale_id: saleId, ...p });

    if (credit > 0) {
      r.sales.insertReceivable({ customer_id: customer.id, sale_id: saleId, original_amount: credit, balance: credit,
                                 due_date: addDays(now, customer.credit_days || 30), created_at: now });
    }

    // ----- Existencias que quedaron agotadas o bajas, para avisar al terminar -----
    const after = r.catalog.variantsByIds(q.lines.map((l) => l.variant_id));
    const label = (v) => [v.product_name, v.size, v.color].filter(Boolean).join(' / ');
    const stockAlerts = {
      out: after.filter((v) => v.stock <= 0).map((v) => ({ id: v.id, description: label(v), sku: v.sku, stock: v.stock })),
      low: after.filter((v) => v.stock > 0 && v.stock <= v.min_stock)
        .map((v) => ({ id: v.id, description: label(v), sku: v.sku, stock: v.stock, min_stock: v.min_stock })),
    };

    const sale = r.sales.sale(saleId);
    sale.change = payments.reduce((a, p) => a + (p.method === 'cash' && p.tendered ? p.tendered - p.amount : 0), 0);
    sale.promotions = q.promotions;
    sale.stockAlerts = stockAlerts;
    sale.customerCreated = customerCreated;
    return sale;
  })();
}

function getSale(id) {
  const r = repos();
  const sale = r.sales.sale(id);
  if (!sale) throw notFound('Venta no existe');
  return { ...sale, business: r.settings.all() };
}

/** Ventas para el historial / reimpresión: por día (por defecto hoy) y búsqueda opcional. */
function listSales({ date, q } = {}) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : todayLocal();
  return repos().sales.list({ from: `${day} 00:00:00`, to: `${day} 23:59:59`, q: String(q || '').trim() });
}

/** Reimpresión: cuenta cuántas veces se reimprimió y devuelve la venta para imprimirla marcada. */
function reprint(id) {
  const r = repos();
  if (!r.sales.sale(id)) throw notFound('Venta no existe');
  r.sales.markReprint(id);
  return { ...getSale(id), reprinted_at: nowLocal() };
}

module.exports = { quote, createSale, getSale, listSales, reprint };
