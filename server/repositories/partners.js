'use strict';
module.exports = (db) => ({
  // ---------------- Clientes ----------------
  customers(q) {
    const where = q
      ? 'WHERE c.active = 1 AND (c.name LIKE @q OR c.rtn LIKE @q OR c.dni LIKE @q OR c.phone LIKE @q OR c.email LIKE @q)'
      : 'WHERE c.active = 1';
    return db.prepare(`SELECT c.*, b.balance,
                              (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.status = 'completed') AS purchases,
                              (SELECT MAX(created_at) FROM sales s WHERE s.customer_id = c.id) AS last_purchase
                       FROM customers c JOIN v_customer_balance b ON b.customer_id = c.id
                       ${where} ORDER BY c.name LIMIT 500`).all({ q: `%${q || ''}%` });
  },
  customer(id) {
    return db.prepare(`SELECT c.*, b.balance FROM customers c JOIN v_customer_balance b ON b.customer_id = c.id
                       WHERE c.id = ?`).get(id);
  },
  /** Busca un cliente por RTN o DNI (solo dígitos). */
  customerByDoc(digits) {
    return db.prepare(`SELECT c.*, b.balance FROM customers c JOIN v_customer_balance b ON b.customer_id = c.id
                       WHERE c.rtn = @d OR c.dni = @d ORDER BY c.active DESC, c.id LIMIT 1`).get({ d: digits });
  },
  customerHistory(id) {
    return db.prepare(`SELECT id, doc_number, total, status, created_at FROM sales
                       WHERE customer_id = ? ORDER BY id DESC LIMIT 100`).all(id);
  },
  openReceivables(customerId) {
    return db.prepare("SELECT * FROM receivables WHERE customer_id = ? AND status = 'open' ORDER BY due_date, id").all(customerId);
  },
  insertCustomer(c) {
    return db.prepare(`INSERT INTO customers (name, rtn, dni, phone, email, address, credit_limit, credit_days, notes)
                       VALUES (@name, @rtn, @dni, @phone, @email, @address, @credit_limit, @credit_days, @notes)`)
      .run(c).lastInsertRowid;
  },
  updateCustomer(id, c) {
    db.prepare(`UPDATE customers SET name = @name, rtn = @rtn, dni = @dni, phone = @phone, email = @email,
                address = @address, credit_limit = @credit_limit, credit_days = @credit_days, notes = @notes
                WHERE id = @id`).run({ ...c, id });
  },
  /** Otro cliente con el mismo RTN o DNI (para evitar duplicados). */
  customerDocTaken(field, digits, exceptId = null) {
    return db.prepare(`SELECT id, name FROM customers WHERE ${field === 'rtn' ? 'rtn' : 'dni'} = ? AND id IS NOT ?`)
      .get(digits, exceptId);
  },

  // ---------------- Proveedores ----------------
  suppliers(q) {
    const where = q ? 'WHERE s.active = 1 AND (s.name LIKE @q OR s.rtn LIKE @q OR s.contact_name LIKE @q OR s.phone LIKE @q)'
      : 'WHERE s.active = 1';
    return db.prepare(`SELECT s.*,
                              (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS purchases,
                              (SELECT COALESCE(SUM(total_cost), 0) FROM purchases p WHERE p.supplier_id = s.id) AS purchased_total,
                              (SELECT MAX(purchase_date) FROM purchases p WHERE p.supplier_id = s.id) AS last_purchase
                       FROM suppliers s ${where} ORDER BY s.name LIMIT 500`).all({ q: `%${q || ''}%` });
  },
  supplier(id) {
    return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  },
  supplierPurchases(id) {
    return db.prepare(`SELECT p.id, p.document_number, p.purchase_date, p.extra_cost, p.total_cost, p.notes,
                              (SELECT SUM(qty) FROM purchase_items i WHERE i.purchase_id = p.id) AS units
                       FROM purchases p WHERE p.supplier_id = ? ORDER BY p.id DESC LIMIT 100`).all(id);
  },
  insertSupplier(s) {
    return db.prepare(`INSERT INTO suppliers (name, rtn, contact_name, phone, email, address, country, notes)
                       VALUES (@name, @rtn, @contact_name, @phone, @email, @address, @country, @notes)`)
      .run(s).lastInsertRowid;
  },
  updateSupplier(id, s) {
    db.prepare(`UPDATE suppliers SET name = @name, rtn = @rtn, contact_name = @contact_name, phone = @phone,
                email = @email, address = @address, country = @country, notes = @notes WHERE id = @id`).run({ ...s, id });
  },
});
