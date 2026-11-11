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
const longSlug = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12);

/** Prefijo sugerido a partir del nombre de la categoría: "Jeans" -> "JEAN". */
const defaultPrefix = (name) => longSlug(name).slice(0, 4) || 'PROD';

/**
 * Siguiente código de estilo de la categoría: PREFIJO-0001, PREFIJO-0002...
 * Cada estilo (modelo) lleva su propio código; la categoría agrupa todos los del mismo tipo.
 */
function nextProductCode(r, category) {
  const prefix = category.code_prefix || defaultPrefix(category.name);
  for (;;) {
    const seq = r.catalog.bumpCategorySeq(category.id);
    const code = `${prefix}-${String(seq).padStart(4, '0')}`;
    if (!r.catalog.productByCode(code)) return code;
  }
}

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
    extraCostPct: Number(input.extra_cost_pct) || 0,
    extraCost: Math.max(0, Math.round(Number(input.extra_cost) || 0)),
    ...calculatePrice({
      cost: Number(input.cost) || 0,
      marginPct: ctx.marginPct,
      taxRatePct: ctx.taxRate.rate,
      extraCostPct: Number(input.extra_cost_pct) || 0,
      extraCost: Math.max(0, Math.round(Number(input.extra_cost) || 0)),
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
    const code = String(input.code || '').trim().toUpperCase() || nextProductCode(r, r.catalog.category(input.category_id));
    const productId = r.catalog.insertProduct({
      code,
      name: input.name.trim(),
      category_id: input.category_id,
      brand: input.brand || null,
      description: input.description || null,
      cost: Number(input.cost) || 0,
      extra_cost_pct: Number(input.extra_cost_pct) || 0,
      extra_cost: calc.extraCost,
      margin_pct: input.margin_pct ?? null,
      tax_rate_id: input.tax_rate_id ?? null,
      price,
    });
    const base = longSlug(code) || `P${productId}`;
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
function receiveStock({ supplier_id = null, document_number = null, notes = null, extra_cost = 0, items }, user = null) {
  if (!Array.isArray(items) || !items.length) throw badRequest('Debe incluir artículos');
  const r = repos();
  const now = nowLocal();
  extra_cost = Math.round(Number(extra_cost) || 0);
  if (extra_cost < 0) throw badRequest('Flete inválido');
  supplier_id = Number(supplier_id) || null;
  if (supplier_id && !r.partners.supplier(supplier_id)) throw badRequest('Proveedor no existe');
  for (const it of items) {
    if (!(Number.isInteger(Number(it.qty)) && Number(it.qty) > 0)) throw badRequest('Cantidad inválida');
    if (!(Number(it.unit_cost) >= 0)) throw badRequest('Costo inválido');
  }
  return r.db.transaction(() => {
    const units = items.reduce((a, i) => a + Number(i.qty), 0);
    const goods = items.reduce((a, i) => a + Number(i.qty) * Math.round(Number(i.unit_cost)), 0);
    const purchaseId = r.catalog.insertPurchase({
      supplier_id, document_number: document_number || null, purchase_date: todayLocal(), extra_cost,
      total_cost: goods + extra_cost, notes: notes || null, user_id: user?.id ?? null,
    });
    for (const it of items) {
      const v = r.catalog.variant(it.variant_id);
      if (!v) throw notFound(`Variante ${it.variant_id} no existe`);
      const qty = Number(it.qty);
      // Flete/aduana prorrateado por unidad
      const unitCost = Math.round(Number(it.unit_cost)) + (units ? Math.round(extra_cost / units) : 0);
      const currentStock = Math.max(v.stock, 0);
      const avg = Math.round((currentStock * v.cost + qty * unitCost) / (currentStock + qty));
      r.catalog.insertPurchaseItem({ purchase_id: purchaseId, variant_id: v.id, qty, unit_cost: unitCost });
      r.catalog.adjustStock(v.id, qty, { cost: avg, lastReceivedAt: now });
      r.catalog.insertMovement({ variant_id: v.id, type: 'purchase', qty, unit_cost: unitCost,
                                 ref_table: 'purchases', ref_id: purchaseId, user_id: user?.id ?? null, created_at: now });
    }
    return { purchase_id: purchaseId };
  })();
}

/** Valida y normaliza los datos de una categoría. exceptId: la propia categoría al editar. */
function cleanCategory(r, { name, margin_pct = null, min_stock = 2, tax_rate_id = null, code_prefix = null } = {}, exceptId = null) {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!clean) throw badRequest('El nombre de la categoría es obligatorio');
  if (clean.length > 60) throw badRequest('El nombre es demasiado largo (máximo 60 caracteres)');
  // "Calzado", "calzado" y "Cálzado" cuentan como el mismo nombre (SQLite no sabe ignorar tildes).
  const key = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
  if (r.catalog.allCategoryNames(exceptId).some((n) => key(n) === key(clean))) {
    throw badRequest('Ya existe la categoría "' + clean + '"');
  }
  const margin = margin_pct === '' || margin_pct == null ? null : Number(margin_pct);
  if (margin != null && !(Number.isFinite(margin) && margin >= 0 && margin < 1000)) throw badRequest('Margen inválido');
  const minStock = min_stock === '' || min_stock == null ? 2 : Number(min_stock);
  if (!(Number.isInteger(minStock) && minStock >= 0)) throw badRequest('Stock mínimo inválido');
  const tax = tax_rate_id === '' || tax_rate_id == null ? null : Number(tax_rate_id);
  if (tax != null && !r.catalog.taxRate(tax)) throw badRequest('Impuesto inválido');
  // Prefijo del código de estilo (JEAN-0001). Vacío = se toma del nombre.
  const prefix = longSlug(code_prefix).slice(0, 6) || defaultPrefix(clean);
  return { name: clean, margin_pct: margin, min_stock: minStock, tax_rate_id: tax, code_prefix: prefix };
}

/** Crea una categoría (nombre único sin distinguir mayúsculas ni tildes). */
function createCategory(input) {
  const r = repos();
  const id = r.catalog.insertCategory(cleanCategory(r, input));
  return r.catalog.category(id);
}

/**
 * Modifica una categoría. Stock mínimo e impuesto se aplican de inmediato a sus productos (salvo los que
 * tengan valor propio); el margen solo afecta productos nuevos, porque los precios ya guardados no cambian.
 */
function updateCategory(id, input) {
  const r = repos();
  if (!r.catalog.category(id)) throw notFound('Categoría no encontrada');
  r.catalog.updateCategory(id, cleanCategory(r, input, id));
  return r.catalog.category(id);
}

/** Categorías activas; las creadas antes del prefijo muestran el que se usará. */
function listCategories() {
  return repos().catalog.categories().map((c) => ({ ...c, code_prefix: c.code_prefix || defaultPrefix(c.name) }));
}

module.exports = { previewPrice, createProduct, receiveStock, internalBarcode, createCategory, updateCategory, listCategories };
