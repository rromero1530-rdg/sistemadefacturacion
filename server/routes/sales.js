'use strict';
const { Router } = require('express');
const { repos } = require('../repositories');
const sales = require('../services/sales');
const cash = require('../services/cash');
const { backupNow } = require('../db/backup');

const r = Router();
r.post('/sales/quote', (req, res) => res.json(sales.quote(req.body.items)));
r.post('/sales', (req, res) => res.status(201).json(sales.createSale(req.body)));
r.get('/sales', (req, res) => res.json(repos().sales.recent(Number(req.query.limit) || 20)));
r.get('/sales/:id', (req, res) => res.json(sales.getSale(Number(req.params.id))));

r.get('/cash/current', (req, res) => res.json(cash.summary(null)));
r.post('/cash/open', (req, res) => res.status(201).json(cash.open(req.body)));
r.post('/cash/movements', (req, res) => res.status(201).json(cash.addMovement(req.body)));
r.post('/cash/close', (req, res) => {
  const result = cash.close(req.body);
  // Respaldo automático a OneDrive al cerrar caja (no bloquea la respuesta)
  backupNow('cierre').catch((e) => console.error('Respaldo al cierre falló:', e.message));
  res.json(result);
});

module.exports = r;
