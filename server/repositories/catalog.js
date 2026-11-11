'use strict';
module.exports = (db) => ({
  categories() {
    return db.prepare(`SELECT c.*, t.code AS tax_code, t.rate AS tax_rate
                       FROM categories c LEFT JOIN tax_rates t ON t.id = c.tax_rate_id
                       WHERE c.active = 1 ORDER BY c.name`).all();
  },
  category(id) {
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  },
  allCategoryNames(exceptId = null) {   // incluye inactivas: el nombre es UNIQUE en la tabla
    return db.prepare('SELECT name FROM categories WHERE id IS NOT ?').pluck().all(exceptId);
  },
  updateCategory(id, c) {
    db.prepare(`UPDATE categories SET name = @name, margin_pct = @margin_pct, tax_rate_id = @tax_rate_id,
                min_stock = @min_stock WHERE id = @id`).run({ ...c, id });
  },
  insertCategory(c) {
    return db.prepare(`INSERT INTO categories (name, parent_id, margin_pct, tax_rate_id, min_stock, slow_days)
                       VALUES (@name, @parent_id, @margin_pct, @tax_rate_id, @min_stock, @slow_days)`)
      .run({ parent_id: null, margin_pct: null, tax_rate_id: null, min_stock: 2, slow_days: null, ...c }).lastInsertRowid;
  },
  taxRates() {
    return db.prepare('SELECT * FROM tax_rates ORDER BY rate DESC').all();
  },
  taxRate(id) {
    return db.prepare('SELECT * FROM tax_rates WHERE id = ?').get(id);
  },
  taxRateByCode(code) {
    return db.prepare('SELECT * FROM tax_rates WHERE code = ?').get(code);
  },

  insertProduct(p) {
    return db.prepare(`INSERT INTO products (code, name, category_id, brand, description, cost, extra_cost_pct,
                                             margin_pct, tax_rate_id, price)
                       VALUES (@code, @name, @category_id, @brand, @description, @cost, @extra_cost_pct,
                               @margin_pct, @tax_rate_id, @price)`).run(p).lastInsertRowid;
  },
  product(id) {
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  },
  insertVariant(v) {
    return db.prepare(`INSERT INTO product_variants (product_id, sku, barcode, size, color, cost, price, stock, min_stock)
                       VALUES (@product_id, @sku, @barcode, @size, @color, @cost, @price, @stock, @min_stock)`)
      .run(v).lastInsertRowid;
  },
  variant(id) {
    return db.prepare('SELECT * FROM v_variants WHERE id = ?').get(id);
  },
  variantsByIds(ids) {
    if (!ids.length) return [];
    return db.prepare(`SELECT * FROM v_variants WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  },
  variantByCode(code) {
    return db.prepare('SELECT * FROM v_variants WHERE active = 1 AND (barcode = ? OR sku = ?)').get(code, code);
  },
  searchVariants({ q, categoryId, limit = 60 }) {
    const where = ['active = 1'];
    const params = {};
    if (q) {
      where.push(`(product_name LIKE @q OR sku LIKE @q OR barcode LIKE @q OR brand LIKE @q
                   OR color LIKE @q OR size = @exact)`);
      params.q = `%${q}%`;
      params.exact = q;
    }
    if (categoryId) { where.push('category_id = @categoryId'); params.categoryId = categoryId; }
    return db.prepare(`SELECT * FROM v_variants WHERE ${where.join(' AND ')}
                       ORDER BY product_name, size, color LIMIT ${Number(limit)}`).all(params);
  },
  adjustStock(variantId, delta, extra = {}) {
    const sets = ['stock = stock + @delta'];
    if (extra.cost != null) sets.push('cost = @cost');
    if (extra.lastSoldAt) sets.push('last_sold_at = @lastSoldAt');
    if (extra.lastReceivedAt) sets.push('last_received_at = @lastReceivedAt');
    db.prepare(`UPDATE product_variants SET ${sets.join(', ')} WHERE id = @id`)
      .run({ id: variantId, delta, cost: extra.cost ?? null, lastSoldAt: extra.lastSoldAt ?? null,
             lastReceivedAt: extra.lastReceivedAt ?? null });
  },
  insertMovement(m) {
    db.prepare(`INSERT INTO inventory_movements (variant_id, type, qty, unit_cost, ref_table, ref_id, note, created_at)
                VALUES (@variant_id, @type, @qty, @unit_cost, @ref_table, @ref_id, @note, @created_at)`)
      .run({ ref_table: null, ref_id: null, note: null, ...m });
  },
  insertPurchase(p) {
    return db.prepare(`INSERT INTO purchases (supplier_id, document_number, purchase_date, extra_cost, total_cost, notes)
                       VALUES (@supplier_id, @document_number, @purchase_date, @extra_cost, @total_cost, @notes)`)
      .run(p).lastInsertRowid;
  },
  insertPurchaseItem(i) {
    db.prepare('INSERT INTO purchase_items (purchase_id, variant_id, qty, unit_cost) VALUES (@purchase_id, @variant_id, @qty, @unit_cost)').run(i);
  },
  activePromotions(today) {
    const promos = db.prepare(`SELECT * FROM promotions WHERE active = 1
                                 AND (starts_at IS NULL OR starts_at <= @today)
                                 AND (ends_at IS NULL OR ends_at >= @today)`).all({ today });
    const rules = db.prepare('SELECT * FROM promotion_rules WHERE promotion_id = ?');
    return promos.map((p) => ({ ...p, rules: rules.all(p.id) }));
  },
  insertPromotion(p, rules) {
    const id = db.prepare(`INSERT INTO promotions (name, type, discount_pct, starts_at, ends_at, priority)
                           VALUES (@name, @type, @discount_pct, @starts_at, @ends_at, @priority)`)
      .run({ starts_at: null, ends_at: null, priority: 0, ...p }).lastInsertRowid;
    const ins = db.prepare('INSERT INTO promotion_rules (promotion_id, category_id, product_id, qty) VALUES (?, ?, ?, ?)');
    for (const r of rules) ins.run(id, r.category_id ?? null, r.product_id ?? null, r.qty ?? 1);
    return id;
  },
});
