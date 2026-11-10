'use strict';
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');

// Carga .env sin dependencias externas (Node >= 20.12)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

function resolvePath(p) {
  if (!p) return p;
  // Permite usar %OneDrive% o %USERPROFILE% dentro del .env en Windows
  const expanded = p.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? '');
  return path.isAbsolute(expanded) ? expanded : path.resolve(ROOT, expanded);
}

function defaultBackupDir() {
  const oneDrive = process.env.OneDriveCommercial || process.env.OneDrive;
  if (oneDrive) return path.join(oneDrive, 'Facturacion', 'respaldos');
  return path.join(ROOT, 'respaldos');
}

const config = {
  root: ROOT,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  timezone: process.env.TIMEZONE || 'America/Tegucigalpa',
  dbPath: resolvePath(process.env.DB_PATH || './database/data/zoecloset.db'),
  migrationsDir: path.join(ROOT, 'database', 'migrations'),
  backup: {
    dir: resolvePath(process.env.BACKUP_DIR) || defaultBackupDir(),
    intervalHours: Number(process.env.BACKUP_INTERVAL_HOURS || 4),
    keep: Number(process.env.BACKUP_KEEP || 60),
  },
};

module.exports = config;
