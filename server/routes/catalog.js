'use strict';
const { Router } = require('express');
const { repos } = require('../repositories');
const catalog = require('../services/catalog');
const { notFound } = require('../lib/errors');
const { requireRole } = require('../middleware/security');

const admin = requireRole('admin');

const r = Router();
r.get('/categories', (req, res) => res.json(repos().catalog.categories()));
r.post('/categories', admin, (req, res) => res.status(201).json(catalog.createCategory(req.body)));
r.put('/categories/:id', admin, (req, res) => res.json(catalog.updateCategory(Number(req.params.id), req.body)));
r.get('/tax-rates', (req, res) => res.json(repos().catalog.taxRates()));

r.get('/products', (req, res) =>
  res.json(repos().catalog.searchVariants({ q: req.query.q?.trim(), categoryId: Number(req.query.category_id) || null })));
r.get('/products/code/:code', (req, res) => {
  const v = repos().catalog.variantByCode(req.params.code.trim());
  if (!v) throw notFound('Código no encontrado');
  res.json(v);
});
r.post('/products', admin, (req, res) => res.status(201).json(catalog.createProduct(req.body)));
r.post('/pricing/preview', admin, (req, res) => res.json(catalog.previewPrice(req.body)));
r.post('/inventory/receive', admin, (req, res) => res.status(201).json(catalog.receiveStock(req.body)));

module.exports = r;
