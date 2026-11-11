'use strict';
const { repos } = require('../repositories');
const { calculatePrice, resolveMargin } = require('./pricing');
const { badRequest, notFound } = require('../lib/errors');
const { nowLocal, todayLocal } = require('../lib/time');

/** EAN-13 interno con prefijo 20 (uso en tienda), útil para imprimir etiquetas propias. */
function internalBarcode(variantId) {
  const body = '20' + String(variantId).padStart(10, '0');
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6);

function pricingContext(r, { category_id, margin_pct, tax_rate_id }) {
  const settings = r.settings.all();
  const category = r.catalog.category(category_id);
  if (!category) throw badRequest('Categoría no existe');
  const taxRate = r.catalog.taxRate(tax_rate_id ?? category.tax_rate_id) || r.catalog.taxRateByCode('ISV15');
  return {
    settings, category, taxRate,
    marginPct: resolveMargin({ margin_pct }, category, settings),
  };
}

function previewPrice(input) {
  const r = repos();
  const ctx = pricingContext(r, input);
  return {
    marginPct: ctx.marginPct,
    taxRate: ctx.taxRate,
    mode: ctx.settings.pricing_mode,
    ...calculatePrice({
      cost: Number(input.cost) || 0,
      marginPct: ctx.marginPct,
      taxRatePct: ctx.taxRate.rate,
      extraCostPct: input.extra_cost_pct || 0,
      mode: ctx.settings.pricing_mode,
      rounding: Number(ctx.settings.price_rounding || 0),
    }),
  };
}

/**
 * Crea un producto con sus variantes (talla/color).
 * El usuario solo envía el costo bruto; el precio se calcula salvo que mande `price` explícito.
 */
function createProduct(input) {
  if (!input.name) throw badRequest('Nombre requerido');
  if (!Array.isArray(input.variants) || !input.variants.length) {
    input.variants = [{ size: 'Única', color: null, stock: 0 }];
  }
  const r = repos();
  const calc = previewPrice(input);
  const price = input.price != null ? Number(input.price) : calc.price;
  const now = nowLocal();

  return r.db.transaction(() => {
    const productId = r.catalog.insertProduct({
      code: input.code || null,
      name: input.name.trim(),
      category_id: input.category_id,
      brand: input.brand || null,
      description: input.description || null,
      cost: Number(input.cost) || 0,
      extra_cost_pct: input.extra_cost_pct || 0,
      margin_pct: input.margin_pct ?? null,
      tax_rate_id: input.tax_rate_id ?? null,
      price,
    });
    const base = input.code ? slug(input.code) : `P${productId}`;
    const variants = input.variants.map((v, i) => {
      const sku = `${base}-${slug(v.size) || 'U'}-${slug(v.color) || i + 1}`;
      const id = r.catalog.insertVariant({
        product_id: productId, sku, barcode: v.barcode || null,
        size: v.size || null, color: v.color || null,
        cost: calc.landedCost, price: v.price != null ? Number(v.price) : price,
        stock: 0, min_stock: v.min_stock ?? null,
      });
      if (!v.barcode) r.db.prepare('UPDATE product_variants SET barcode = ? WHERE id = ?').run(internalBarcode(id), id);
      const qty = Number(v.stock) || 0;
      if (qty > 0) {
        r.catalog.adjustStock(id, qty, { lastReceivedAt: now });
        r.catalog.insertMovement({ variant_id: id, type: 'initial', qty, unit_cost: calc.landedCost, created_at: now });
      }
      return r.catalog.variant(id);
    });
    return { product: r.catalog.product(productId), variants, pricing: calc };
  })();
}

/** Ingreso de mercancía: suma stock y recalcula costo promedio ponderado. */
function receiveStock({ supplier_id = null, document_number = null, notes = null, extra_cost = 0, items }) {
  if (!Array.isArray(items) || !items.length) throw badRequest('Debe incluir artículos');
  const r = repos();
  const now = nowLocal();
  return r.db.transaction(() => {
    const units = items.reduce((a, i) => a + Number(i.qty), 0);
    const goods = items.reduce((a, i) => a + Number(i.qty) * Number(i.unit_cost), 0);
    const purchaseId = r.catalog.insertPurchase({
      supplier_id, document_number, purchase_date: todayLocal(), extra_cost, total_cost: goods + extra_cost, notes,
    });
    for (const it of items) {
      const v = r.catalog.variant(it.variant_id);
      if (!v) throw notFound(`Variante ${it.variant_id} no existe`);
      const qty = Number(it.qty);
      if (!(qty > 0)) throw badRequest('Cantidad inválida');
      // Flete/aduana prorrateado por unidad
      const unitCost = Number(it.unit_cost) + (units ? Math.round(extra_cost / units) : 0);
      const currentStock = Math.max(v.stock, 0);
      const avg = Math.round((currentStock * v.cost + qty * unitCost) / (currentStock + qty));
      r.catalog.insertPurchaseItem({ purchase_id: purchaseId, variant_id: v.id, qty, unit_cost: unitCost });
      r.catalog.adjustStock(v.id, qty, { cost: avg, lastReceivedAt: now });
      r.catalog.insertMovement({ variant_id: v.id, type: 'purchase', qty, unit_cost: unitCost,
                                 ref_table: 'purchases', ref_id: purchaseId, created_at: now });
    }
    return { purchase_id: purchaseId };
  })();
}

/** Crea una categoría validando nombre único (sin distinguir mayúsculas), margen, stock mínimo e impuesto. */
function createCategory({ name, margin_pct = null, min_stock = 2, tax_rate_id = null } = {}) {
  const r = repos();
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!clean) throw badRequest('El nombre de la categoría es obligatorio');
  if (clean.length > 60) throw badRequest('El nombre es demasiado largo (máximo 60 caracteres)');
  const lower = clean.toLocaleLowerCase('es');
  // SQLite lower() no maneja tildes/ñ, por eso se compara en JavaScript.
  if (r.catalog.allCategoryNames().some((n) => n.toLocaleLowerCase('es') === lower)) {
    throw badRequest(`Ya existe la categoría "${clean}"`);
  }
  const margin = margin_pct === '' || margin_pct == null ? null : Number(margin_pct);
  if (margin != null && !(Number.isFinite(margin) && margin >= 0 && margin < 1000)) throw badRequest('Margen inválido');
  const minStock = min_stock === '' || min_stock == null ? 2 : Number(min_stock);
  if (!(Number.isInteger(minStock) && minStock >= 0)) throw badRequest('Stock mínimo inválido');
  const tax = tax_rate_id === '' || tax_rate_id == null ? null : Number(tax_rate_id);
  if (tax != null && !r.catalog.taxRate(tax)) throw badRequest('Impuesto inválido');
  const id = r.catalog.insertCategory({ name: clean, margin_pct: margin, min_stock: minStock, tax_rate_id: tax });
  return r.catalog.category(id);
}

module.exports = { previewPrice, createProduct, receiveStock, internalBarcode, createCategory };
