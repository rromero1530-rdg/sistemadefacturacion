'use strict';
const config = require('./config');
const { getDb, closeDb } = require('./db/connection');
const { migrate } = require('./db/migrate');
const { backupNow, scheduleBackups } = require('./db/backup');
const { createApp } = require('./app');
const auth = require('./services/auth');

const applied = migrate(getDb());
if (applied.length) console.log('Migraciones aplicadas:', applied.join(', '));

const server = createApp().listen(config.port, config.host, () => {
  console.log(`\n  Zoe Closet listo →  http://localhost:${config.port}`);
  console.log(`  Base de datos   →  ${config.dbPath}`);
  console.log(`  Respaldos       →  ${config.backup.dir}\n`);
});

backupNow('inicio').catch((e) => console.error('No se pudo crear respaldo inicial:', e.message));
scheduleBackups();
setInterval(() => auth.purgeExpiredSessions(), 15 * 60 * 1000).unref();

function shutdown() {
  server.close(() => { closeDb(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
