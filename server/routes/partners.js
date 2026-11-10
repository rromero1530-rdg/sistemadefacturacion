'use strict';
const { Router } = require('express');
const { repos } = require('../repositories');
const partners = require('../services/partners');

const r = Router();
r.get('/customers', (req, res) => res.json(repos().partners.customers(req.query.q?.trim())));
r.post('/customers', (req, res) => res.status(201).json({ id: partners.createCustomer(req.body) }));
r.get('/customers/:id', (req, res) => res.json(partners.customerDetail(Number(req.params.id))));
r.post('/customers/:id/payments', (req, res) => res.status(201).json(partners.registerPayment(Number(req.params.id), req.body)));
r.get('/suppliers', (req, res) => res.json(repos().partners.suppliers()));
r.post('/suppliers', (req, res) => res.status(201).json({ id: partners.createSupplier(req.body) }));
module.exports = r;
