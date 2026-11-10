'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { getDb } = require('./connection');

/** Aplica en orden los archivos database/migrations/NNN_*.sql que aún no se han ejecutado. */
function migrate(db = getDb()) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').pluck().all());
  const files = fs.readdirSync(config.migrationsDir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();

  const done = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(config.migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    })();
    done.push(file);
  }
  return done;
}

if (require.main === module) {
  const done = migrate();
  console.log(done.length ? `Migraciones aplicadas: ${done.join(', ')}` : 'Base de datos al día.');
}

module.exports = { migrate };
