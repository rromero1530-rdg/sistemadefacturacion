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

// Ambiente de prueba (--prueba): base, respaldos, puerto y cookie propios, para practicar sin tocar
// los datos reales. Ignora DB_PATH/BACKUP_DIR del .env a propósito, así nunca apunta a la base de la tienda.
const testMode = process.argv.includes('--prueba') || process.env.APP_ENV === 'prueba';
const TEST_DIR = path.join(process.env.LOCALAPPDATA || path.join(ROOT, 'database', 'data'), 'ZoeCloset-prueba');

const config = {
  root: ROOT,
  testMode,
  port: testMode ? Number(process.env.PRUEBA_PORT || 3001) : Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  timezone: process.env.TIMEZONE || 'America/Tegucigalpa',
  dbPath: testMode ? path.join(TEST_DIR, 'prueba.db')
    : resolvePath(process.env.DB_PATH || './database/data/zoecloset.db'),
  migrationsDir: path.join(ROOT, 'database', 'migrations'),
  backup: {
    dir: testMode ? path.join(TEST_DIR, 'respaldos') : resolvePath(process.env.BACKUP_DIR) || defaultBackupDir(),
    intervalHours: Number(process.env.BACKUP_INTERVAL_HOURS || 4),
    keep: testMode ? 5 : Number(process.env.BACKUP_KEEP || 60),
  },
  // Los navegadores comparten cookies entre puertos de localhost: nombre distinto para no cerrar la sesión real.
  sessionCookie: testMode ? 'zc_session_prueba' : 'zc_session',
};

module.exports = config;
