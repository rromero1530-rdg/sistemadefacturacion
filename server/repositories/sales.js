'use strict';
module.exports = (db) => ({
  insertSale(s) {
    const cols = Object.keys(s);
    return db.prepare(`INSERT INTO sales (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`)
      .run(s).lastInsertRowid;
  },
  insertItem(i) {
    db.prepare(`INSERT INTO sale_items (sale_id, variant_id, description, qty, unit_price, unit_cost, discount,
                                        manual_discount, tax_rate, line_total, promotion_id)
                VALUES (@sale_id, @variant_id, @description, @qty, @unit_price, @unit_cost, @discount,
                        @manual_discount, @tax_rate, @line_total, @promotion_id)`).run({ manual_discount: 0, ...i });
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
    const sale = db.prepare(`SELECT s.*, u.name AS user_name FROM sales s LEFT JOIN users u ON u.id = s.user_id
                             WHERE s.id = ?`).get(id);
    if (!sale) return null;
    sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
    sale.payments = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(id);
    return sale;
  },
  recent(limit = 20) {
    return db.prepare('SELECT * FROM sales ORDER BY id DESC LIMIT ?').all(limit);
  },
  /** Ventas de un rango con búsqueda por número, cliente, RTN o DNI. */
  list({ from, to, q }) {
    return db.prepare(`SELECT s.id, s.doc_kind, s.doc_number, s.customer_name, s.customer_rtn, s.customer_dni, s.total,
                              s.discount_amount, s.status, s.reprint_count, s.created_at, u.name AS user_name,
                              (SELECT GROUP_CONCAT(method) FROM sale_payments p WHERE p.sale_id = s.id) AS methods,
                              (SELECT SUM(qty) FROM sale_items i WHERE i.sale_id = s.id) AS units
                       FROM sales s LEFT JOIN users u ON u.id = s.user_id
                       WHERE s.created_at BETWEEN @from AND @to
                         AND (@q = '' OR s.doc_number LIKE @like OR s.customer_name LIKE @like
                              OR s.customer_rtn LIKE @like OR s.customer_dni LIKE @like)
                       ORDER BY s.id DESC LIMIT 300`).all({ from, to, q, like: `%${q}%` });
  },
  markReprint(id) {
    db.prepare('UPDATE sales SET reprint_count = reprint_count + 1 WHERE id = ?').run(id);
  },
});
