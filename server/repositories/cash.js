'use strict';
module.exports = (db) => ({
  openSession() {
    return db.prepare("SELECT * FROM cash_sessions WHERE status = 'open'").get();
  },
  session(id) {
    return db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(id);
  },
  insertSession(s) {
    return db.prepare(`INSERT INTO cash_sessions (opened_at, opening_amount, notes)
                       VALUES (@opened_at, @opening_amount, @notes)`).run(s).lastInsertRowid;
  },
  closeSession(c) {
    db.prepare(`UPDATE cash_sessions SET status = 'closed', closed_at = @closed_at, expected_cash = @expected_cash,
                counted_cash = @counted_cash, difference = @difference,
                notes = COALESCE(@notes, notes) WHERE id = @id`).run(c);
  },
  insertMovement(m) {
    return db.prepare(`INSERT INTO cash_movements (session_id, type, amount, description, expense_id, created_at)
                       VALUES (@session_id, @type, @amount, @description, @expense_id, @created_at)`)
      .run({ expense_id: null, ...m }).lastInsertRowid;
  },
  insertExpense(e) {
    return db.prepare(`INSERT INTO expenses (expense_date, category, description, amount, payment_method, cash_session_id)
                       VALUES (@expense_date, @category, @description, @amount, @payment_method, @cash_session_id)`)
      .run(e).lastInsertRowid;
  },
  movements(sessionId) {
    return db.prepare('SELECT * FROM cash_movements WHERE session_id = ? ORDER BY id').all(sessionId);
  },
  paymentsByMethod(sessionId) {
    return db.prepare(`SELECT p.method, SUM(p.amount) AS amount, COUNT(DISTINCT s.id) AS count
                       FROM sale_payments p JOIN sales s ON s.id = p.sale_id
                       WHERE s.cash_session_id = ? AND s.status = 'completed'
                       GROUP BY p.method`).all(sessionId);
  },
  receivablePaymentsByMethod(sessionId) {
    return db.prepare(`SELECT method, SUM(amount) AS amount FROM receivable_payments
                       WHERE cash_session_id = ? GROUP BY method`).all(sessionId);
  },
  salesTotals(sessionId) {
    return db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total,
                              COALESCE(SUM(discount_amount),0) AS discounts
                       FROM sales WHERE cash_session_id = ? AND status = 'completed'`).get(sessionId);
  },
});
