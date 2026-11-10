'use strict';
module.exports = (db) => ({
  insertSale(s) {
    const cols = Object.keys(s);
    return db.prepare(`INSERT INTO sales (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`)
      .run(s).lastInsertRowid;
  },
  insertItem(i) {
    db.prepare(`INSERT INTO sale_items (sale_id, variant_id, description, qty, unit_price, unit_cost, discount,
                                        tax_rate, line_total, promotion_id)
                VALUES (@sale_id, @variant_id, @description, @qty, @unit_price, @unit_cost, @discount,
                        @tax_rate, @line_total, @promotion_id)`).run(i);
  },
  insertPayment(p) {
    db.prepare(`INSERT INTO sale_payments (sale_id, method, amount, tendered, reference)
                VALUES (@sale_id, @method, @amount, @tendered, @reference)`)
      .run({ tendered: null, reference: null, ...p });
  },
  insertReceivable(r) {
    return db.prepare(`INSERT INTO receivables (customer_id, sale_id, original_amount, balance, due_date, created_at)
                       VALUES (@customer_id, @sale_id, @original_amount, @balance, @due_date, @created_at)`)
      .run(r).lastInsertRowid;
  },
  sale(id) {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!sale) return null;
    sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
    sale.payments = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(id);
    return sale;
  },
  recent(limit = 20) {
    return db.prepare('SELECT * FROM sales ORDER BY id DESC LIMIT ?').all(limit);
  },
});
