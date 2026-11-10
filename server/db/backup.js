'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { getDb } = require('./connection');

/**
 * Copia consistente de la base (API de backup de SQLite, segura con la base abierta)
 * hacia BACKUP_DIR (normalmente OneDrive). Se escribe como .tmp y luego se renombra
 * para que OneDrive nunca suba un archivo a medias.
 */
async function backupNow(reason = 'manual') {
  const dir = config.backup.dir;
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const finalPath = path.join(dir, `pos-${stamp}-${reason}.db`);
  const tmpPath = finalPath + '.tmp';

  await getDb().backup(tmpPath);
  fs.renameSync(tmpPath, finalPath);
  prune(dir);
  return finalPath;
}

function prune(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^pos-.*\.db$/.test(f)).sort();
  const excess = files.length - config.backup.keep;
  for (let i = 0; i < excess; i++) fs.rmSync(path.join(dir, files[i]), { force: true });
}

function scheduleBackups() {
  const ms = config.backup.intervalHours * 3600 * 1000;
  if (!ms) return null;
  const t = setInterval(() => {
    backupNow('auto').catch((e) => console.error('Error en respaldo automático:', e.message));
  }, ms);
  t.unref();
  return t;
}

if (require.main === module) {
  backupNow('manual').then((p) => console.log('Respaldo creado:', p));
}

module.exports = { backupNow, scheduleBackups };
