'use strict';
module.exports = (db) => ({
  all() {
    return Object.fromEntries(db.prepare('SELECT key, value FROM settings').raw().all());
  },
  get(key) {
    return db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key);
  },
  set(key, value) {
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
  },
});
