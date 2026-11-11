'use strict';
const { Router } = require('express');
const { repos } = require('../repositories');
const partners = require('../services/partners');
const { requireRole } = require('../middleware/security');
const { notFound } = require('../lib/errors');

const admin = requireRole('admin');
const r = Router();

// Clientes: cajeros y administradores (los cajeros los registran al facturar)
r.get('/customers', (req, res) => res.json(repos().partners.customers(req.query.q?.trim())));
r.get('/customers/by-doc/:doc', (req, res) => {
  const { rtn, dni } = partners.parseDoc({ doc: req.params.doc });
  const c = repos().partners.customerByDoc(rtn || dni);
  if (!c) throw notFound('No hay cliente con ese RTN/DNI');
  res.json(c);
});
r.post('/customers', (req, res) => {
  const id = partners.createCustomer(req.body);
  res.status(201).json({ id, ...repos().partners.customer(id) });
});
r.get('/customers/:id', (req, res) => res.json(partners.customerDetail(Number(req.params.id))));
r.put('/customers/:id', (req, res) => res.json(partners.updateCustomer(Number(req.params.id), req.body)));
r.post('/customers/:id/payments', (req, res) => res.status(201).json(partners.registerPayment(Number(req.params.id), req.body)));

// Proveedores: solo administradores
r.get('/suppliers', admin, (req, res) => res.json(repos().partners.suppliers(req.query.q?.trim())));
r.post('/suppliers', admin, (req, res) => {
  const id = partners.createSupplier(req.body);
  res.status(201).json({ id, ...repos().partners.supplier(id) });
});
r.get('/suppliers/:id', admin, (req, res) => res.json(partners.supplierDetail(Number(req.params.id))));
r.put('/suppliers/:id', admin, (req, res) => res.json(partners.updateSupplier(Number(req.params.id), req.body)));
module.exports = r;
