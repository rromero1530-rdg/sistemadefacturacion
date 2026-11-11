'use strict';
const { Router } = require('express');
const { repos } = require('../repositories');
const sales = require('../services/sales');
const cash = require('../services/cash');
const { backupNow } = require('../db/backup');
const { audit } = require('../services/auth');

const r = Router();
r.post('/sales/quote', (req, res) => res.json(sales.quote(req.body.items)));
r.post('/sales', (req, res) => {
  const sale = sales.createSale(req.body, req.user);
  if (sale.manual_discount) {
    audit(repos(), 'manual_discount', { user: req.user, ip: req.ip,
      detail: { sale: sale.doc_number, amount: sale.manual_discount, reason: sale.manual_discount_reason } });
  }
  res.status(201).json(sale);
});
r.get('/sales', (req, res) => res.json(sales.listSales(req.query)));
r.get('/sales/:id', (req, res) => res.json(sales.getSale(Number(req.params.id))));
r.post('/sales/:id/reprint', (req, res) => {
  const sale = sales.reprint(Number(req.params.id));
  audit(repos(), 'sale_reprint', { user: req.user, ip: req.ip, detail: { sale: sale.doc_number, count: sale.reprint_count } });
  res.json(sale);
});

r.get('/cash/current', (req, res) => res.json(cash.summary(null)));
r.post('/cash/open', (req, res) => {
  const result = cash.open(req.body, req.user);
  audit(repos(), 'cash_open', { user: req.user, ip: req.ip, detail: { opening: result.session.opening_amount } });
  res.status(201).json(result);
});
r.post('/cash/movements', (req, res) => res.status(201).json(cash.addMovement(req.body, req.user)));
r.post('/cash/close', (req, res) => {
  const result = cash.close(req.body, req.user);
  audit(repos(), 'cash_close', { user: req.user, ip: req.ip, detail: { difference: result.session.difference } });
  // Respaldo automático a OneDrive al cerrar caja (no bloquea la respuesta)
  backupNow('cierre').catch((e) => console.error('Respaldo al cierre falló:', e.message));
  res.json(result);
});

module.exports = r;
