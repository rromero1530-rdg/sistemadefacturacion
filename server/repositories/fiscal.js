'use strict';
module.exports = (db) => ({
  activeCai() {
    return db.prepare(`SELECT * FROM fiscal_cai WHERE active = 1 AND next_number <= range_end
                       ORDER BY deadline LIMIT 1`).get();
  },
  list() {
    return db.prepare('SELECT * FROM fiscal_cai ORDER BY id DESC').all();
  },
  insert(c) {
    return db.prepare(`INSERT INTO fiscal_cai (cai, establishment, emission_point, doc_type, range_start, range_end,
                                               next_number, deadline)
                       VALUES (@cai, @establishment, @emission_point, @doc_type, @range_start, @range_end,
                               @range_start, @deadline)`).run(c).lastInsertRowid;
  },
  consume(id) {
    db.prepare('UPDATE fiscal_cai SET next_number = next_number + 1 WHERE id = ?').run(id);
  },
});
