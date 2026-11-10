'use strict';
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const config = require('./config');
const { AppError } = require('./lib/errors');
const sec = require('./middleware/security');

// Si las librerías del frontend no se han descargado (npm run vendor), se usan desde CDN.
const VENDOR_FALLBACK = {
  'tailwind.js': 'https://cdn.tailwindcss.com/3.4.16',
  'lucide.min.js': 'https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js',
};

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(sec.securityHeaders);
  app.use(express.json({ limit: '1mb' }));
  app.use(sec.loadSession);
  app.use('/api', sec.csrfGuard);

  // Rutas públicas
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api', require('./routes/auth'));

  // Todo lo demás requiere sesión iniciada
  app.use('/api', sec.requireAuth);
  app.use('/api', require('./routes/catalog'));
  app.use('/api', require('./routes/sales'));
  app.use('/api', require('./routes/partners'));
  app.use('/api', require('./routes/misc'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  const publicDir = path.join(config.root, 'public');
  app.get('/vendor/:file', (req, res, next) => {
    const local = path.join(publicDir, 'vendor', path.basename(req.params.file));
    if (fs.existsSync(local)) return res.sendFile(local);
    const cdn = VENDOR_FALLBACK[req.params.file];
    return cdn ? res.redirect(cdn) : next();
  });
  app.use(sec.protectPages);
  app.use(express.static(publicDir, { index: 'index.html' }));

  // Manejo centralizado de errores
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    if (/UNIQUE constraint failed/.test(err.message)) return res.status(409).json({ error: 'Registro duplicado', details: err.message });
    if (/(FOREIGN KEY|CHECK|NOT NULL) constraint failed/.test(err.message)) return res.status(400).json({ error: 'Datos inválidos', details: err.message });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });
  return app;
}

module.exports = { createApp };
