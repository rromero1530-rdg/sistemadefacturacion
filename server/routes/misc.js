'use strict';
const { Router } = require('express');
const { repos } = require('../repositories');
const fiscal = require('../services/fiscal');
const reports = require('../services/reports');
const { getAlerts } = require('../services/alerts');
const { backupNow } = require('../db/backup');
const { nowLocal } = require('../lib/time');
const { badRequest } = require('../lib/errors');

const r = Router();

// ---- Configuración ----
const EDITABLE = ['business_name', 'business_rtn', 'business_address', 'business_phone', 'business_email',
  'fiscal_mode', 'pricing_mode', 'default_margin_pct', 'price_rounding', 'slow_moving_days', 'allow_negative_stock'];
r.get('/settings', (req, res) => res.json(repos().settings.all()));
r.put('/settings', (req, res) => {
  const s = repos().settings;
  for (const [k, v] of Object.entries(req.body)) {
    if (!EDITABLE.includes(k)) throw badRequest(`Parámetro no editable: ${k}`);
    if (k === 'fiscal_mode' && !['informal', 'formal'].includes(v)) throw badRequest('fiscal_mode inválido');
    if (k === 'pricing_mode' && !['markup', 'margin'].includes(v)) throw badRequest('pricing_mode inválido');
    s.set(k, v);
  }
  res.json(s.all());
});

// ---- Fiscal SAR ----
r.get('/fiscal/status', (req, res) => res.json(fiscal.status()));
r.get('/fiscal/cai', (req, res) => res.json(repos().fiscal.list()));
r.post('/fiscal/cai', (req, res) => res.status(201).json({ id: fiscal.addCai(req.body) }));

// ---- Demanda insatisfecha ----
const REASONS = ['sin_stock', 'no_manejamos', 'talla', 'color', 'precio', 'otro'];
r.post('/unmet-demand', (req, res) => {
  const b = req.body;
  if (!b.description?.trim()) throw badRequest('Describe qué buscaba el cliente');
  const id = repos().demand.insert({
    description: b.description.trim(), reason: REASONS.includes(b.reason) ? b.reason : 'otro',
    category_id: b.category_id || null, variant_id: b.variant_id || null, size: b.size || null, color: b.color || null,
    qty: Number(b.qty) || 1, customer_name: b.customer_name || null, customer_phone: b.customer_phone || null,
    notes: b.notes || null, created_at: nowLocal(),
  });
  res.status(201).json({ id });
});
r.get('/unmet-demand', (req, res) => res.json(repos().demand.list({ status: req.query.status })));
r.patch('/unmet-demand/:id', (req, res) => res.json({ changed: repos().demand.setStatus(Number(req.params.id), req.body.status) }));

// ---- Alertas y reportes ----
r.get('/alerts', (req, res) => res.json(getAlerts()));
r.get('/reports/sales', (req, res) => res.json(reports.sales(req.query)));
r.get('/reports/top-products', (req, res) => res.json(reports.topProducts(req.query)));
r.get('/reports/profit-by-category', (req, res) => res.json(reports.profitByCategory(req.query)));
r.get('/reports/income-statement', (req, res) => res.json(reports.incomeStatement(req.query)));
r.get('/reports/unmet-demand', (req, res) => res.json(reports.unmetDemand(req.query)));

// ---- Respaldo manual ----
r.post('/backup', async (req, res, next) => {
  try { res.json({ file: await backupNow('manual') }); } catch (e) { next(e); }
});

module.exports = r;
