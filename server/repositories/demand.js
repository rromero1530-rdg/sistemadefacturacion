'use strict';
module.exports = (db) => ({
  insert(d) {
    return db.prepare(`INSERT INTO unmet_demand (description, reason, category_id, variant_id, size, color, qty,
                                                 customer_name, customer_phone, notes, created_at, user_id)
                       VALUES (@description, @reason, @category_id, @variant_id, @size, @color, @qty,
                               @customer_name, @customer_phone, @notes, @created_at, @user_id)`).run({ user_id: null, ...d }).lastInsertRowid;
  },
  list({ status, limit = 200 }) {
    return db.prepare(`SELECT d.*, c.name AS category_name FROM unmet_demand d
                       LEFT JOIN categories c ON c.id = d.category_id
                       ${status ? 'WHERE d.status = @status' : ''} ORDER BY d.id DESC LIMIT @limit`)
      .all({ status, limit });
  },
  summary(from) {
    return db.prepare(`SELECT LOWER(TRIM(description)) AS item, reason, SUM(qty) AS requests, MAX(created_at) AS last_at
                       FROM unmet_demand WHERE created_at >= ? GROUP BY 1, 2 ORDER BY requests DESC LIMIT 50`).all(from);
  },
  setStatus(id, status) {
    return db.prepare('UPDATE unmet_demand SET status = ? WHERE id = ?').run(status, id).changes;
  },
});
