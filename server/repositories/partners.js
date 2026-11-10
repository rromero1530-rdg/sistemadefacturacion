'use strict';
module.exports = (db) => ({
  customers(q) {
    const where = q ? 'WHERE c.active = 1 AND (c.name LIKE @q OR c.rtn LIKE @q OR c.phone LIKE @q)' : 'WHERE c.active = 1';
    return db.prepare(`SELECT c.*, b.balance FROM customers c JOIN v_customer_balance b ON b.customer_id = c.id
                       ${where} ORDER BY c.name LIMIT 100`).all({ q: `%${q || ''}%` });
  },
  customer(id) {
    return db.prepare(`SELECT c.*, b.balance FROM customers c JOIN v_customer_balance b ON b.customer_id = c.id
                       WHERE c.id = ?`).get(id);
  },
  customerHistory(id) {
    return db.prepare(`SELECT id, doc_number, total, status, created_at FROM sales
                       WHERE customer_id = ? ORDER BY id DESC LIMIT 100`).all(id);
  },
  insertCustomer(c) {
    return db.prepare(`INSERT INTO customers (name, rtn, dni, phone, email, address, credit_limit, credit_days, notes)
                       VALUES (@name, @rtn, @dni, @phone, @email, @address, @credit_limit, @credit_days, @notes)`)
      .run(c).lastInsertRowid;
  },
  suppliers() {
    return db.prepare('SELECT * FROM suppliers WHERE active = 1 ORDER BY name').all();
  },
  insertSupplier(s) {
    return db.prepare(`INSERT INTO suppliers (name, rtn, contact_name, phone, email, address, country, notes)
                       VALUES (@name, @rtn, @contact_name, @phone, @email, @address, @country, @notes)`)
      .run(s).lastInsertRowid;
  },
});
