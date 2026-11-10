'use strict';
/** Borra la base del ambiente de prueba para empezar de cero. Uso: npm run prueba:borrar */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

if (!config.testMode) {
  console.error('Este comando solo funciona en el ambiente de prueba (--prueba). No se borró nada.');
  process.exit(1);
}

const dir = path.dirname(config.dbPath);
let n = 0;
for (const suffix of ['', '-wal', '-shm']) {
  const f = config.dbPath + suffix;
  if (fs.existsSync(f)) {
    try { fs.rmSync(f); n++; } catch (e) {
      console.error(`No se pudo borrar ${f}. Cierra el ambiente de prueba (la ventana negra) e intenta de nuevo.`);
      process.exit(1);
    }
  }
}
console.log(n ? `Base de prueba borrada (${dir}).` : 'No había base de prueba.');
