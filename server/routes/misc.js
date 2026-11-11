'use strict';
const { Router } = require('express');
const { repos } = require('../repositories');
const fiscal = require('../services/fiscal');
const reports = require('../services/reports');
const { getAlerts } = require('../services/alerts');
const { backupNow } = require('../db/backup');
const { nowLocal } = require('../lib/time');
const { badRequest } = require('../lib/errors');
const { requireRole } = require('../middleware/security');
const { audit } = require('../services/auth');

const admin = requireRole('admin');

const r = Router();

// ---- Configuración ----
const EDITABLE = ['business_name', 'business_rtn', 'business_address', 'business_phone', 'business_email',
  'fiscal_mode', 'pricing_mode', 'default_margin_pct', 'price_rounding', 'slow_moving_days', 'allow_negative_stock',
  'session_idle_minutes', 'slow_moving_tiers', 'max_cashier_discount_pct'];
r.get('/settings', (req, res) => res.json(repos().settings.all()));
r.put('/settings', admin, (req, res) => {
  const s = repos().settings;
  for (const [k, v] of Object.entries(req.body)) {
    if (!EDITABLE.includes(k)) throw badRequest(`Parámetro no editable: ${k}`);
    if (k === 'fiscal_mode' && !['informal', 'formal'].includes(v)) throw badRequest('fiscal_mode inválido');
    if (k === 'pricing_mode' && !['markup', 'margin'].includes(v)) throw badRequest('pricing_mode inválido');
    if (k === 'slow_moving_tiers' && !/^\d{1,3}(,\d{1,3}){0,4}$/.test(String(v))) throw badRequest('Niveles inválidos (ej. 15,30,60)');
    if (k === 'max_cashier_discount_pct' && !(Number(v) >= 0 && Number(v) <= 100)) throw badRequest('Porcentaje inválido');
    s.set(k, v);
  }
  audit(repos(), 'settings_updated', { user: req.user, ip: req.ip, detail: req.body });
  res.json(s.all());
});

// ---- Fiscal SAR ----
r.get('/fiscal/status', (req, res) => res.json(fiscal.status()));
r.get('/fiscal/cai', admin, (req, res) => res.json(repos().fiscal.list()));
r.post('/fiscal/cai', admin, (req, res) => {
  const id = fiscal.addCai(req.body);
  audit(repos(), 'cai_added', { user: req.user, ip: req.ip, detail: { id, cai: req.body.cai } });
  res.status(201).json({ id });
});

// ---- Demanda insatisfecha ----
const REASONS = ['sin_stock', 'no_manejamos', 'talla', 'color', 'precio', 'otro'];
r.post('/unmet-demand', (req, res) => {
  const b = req.body;
  if (!b.description?.trim()) throw badRequest('Describe qué buscaba el cliente');
  const id = repos().demand.insert({
    description: b.description.trim(), reason: REASONS.includes(b.reason) ? b.reason : 'otro',
    category_id: b.category_id || null, variant_id: b.variant_id || null, size: b.size || null, color: b.color || null,
    qty: Number(b.qty) || 1, customer_name: b.customer_name || null, customer_phone: b.customer_phone || null,
    notes: b.notes || null, created_at: nowLocal(), user_id: req.user.id,
  });
  res.status(201).json({ id });
});
r.get('/unmet-demand', (req, res) => res.json(repos().demand.list({ status: req.query.status })));
r.patch('/unmet-demand/:id', admin, (req, res) => res.json({ changed: repos().demand.setStatus(Number(req.params.id), req.body.status) }));

// ---- Alertas y reportes ----
r.get('/alerts', (req, res) => res.json(getAlerts()));
/** Todo el tablero de reportes en una sola llamada. */
r.get('/reports/dashboard', admin, (req, res) => {
  const q = req.query;
  const days = (new Date(reports.range(q).to.slice(0, 10)) - new Date(reports.range(q).from.slice(0, 10))) / 86400000;
  res.json({
    summary: reports.summary(q),
    byPeriod: reports.sales({ ...q, group: q.group || (days > 92 ? 'month' : days > 31 ? 'week' : 'day') }),
    paymentMethods: reports.paymentMethods(q),
    byUser: reports.byUser(q),
    byHour: reports.byHour(q),
    topProducts: reports.topProducts({ ...q, limit: 15 }),
    profitByCategory: reports.profitByCategory(q),
    income: reports.incomeStatement(q),
    discounts: reports.discounts(q),
    unmetDemand: reports.unmetDemand(q),
  });
});
r.get('/reports/sales', admin, (req, res) => res.json(reports.sales(req.query)));
r.get('/reports/top-products', admin, (req, res) => res.json(reports.topProducts(req.query)));
r.get('/reports/profit-by-category', admin, (req, res) => res.json(reports.profitByCategory(req.query)));
r.get('/reports/income-statement', admin, (req, res) => res.json(reports.incomeStatement(req.query)));
r.get('/reports/unmet-demand', admin, (req, res) => res.json(reports.unmetDemand(req.query)));

// ---- Respaldo manual ----
r.post('/backup', admin, async (req, res, next) => {
  try { res.json({ file: await backupNow('manual') }); } catch (e) { next(e); }
});

module.exports = r;
