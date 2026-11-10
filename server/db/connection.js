'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../config');

let db;

/**
 * Única puerta de acceso a la base de datos. Para migrar a PostgreSQL,
 * solo los repositorios (server/repositories) y este archivo deben cambiar.
 */
function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  if (/onedrive/i.test(config.dbPath)) {
    console.warn(
      '\n⚠️  DB_PATH apunta a OneDrive. OneDrive puede corromper una base SQLite abierta.\n' +
      '   Recomendado: base local + BACKUP_DIR en OneDrive (ver README).\n'
    );
  }

  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');     // lecturas y escrituras concurrentes
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

function closeDb() {
  if (db) { db.close(); db = undefined; }
}

module.exports = { getDb, closeDb };
