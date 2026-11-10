'use strict';
const { Router } = require('express');
const auth = require('../services/auth');
const { repos } = require('../repositories');
const m = require('../middleware/security');
const { AppError } = require('../lib/errors');

const r = Router();
const loginLimiter = m.rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });

const publicUser = (u) => u && ({ id: u.id, name: u.name, username: u.username, role: u.role,
                                  must_change_password: !!u.must_change_password });

r.get('/auth/status', (req, res) => {
  res.json({ needsSetup: auth.needsSetup(), setupAllowedHere: m.isLocal(req), user: publicUser(req.user),
             business: repos().settings.get('business_name') });
});

// Crear el primer administrador: solo si no hay usuarios y solo desde la misma computadora
r.post('/auth/setup', loginLimiter, (req, res) => {
  if (!m.isLocal(req)) throw new AppError(403, 'La configuración inicial solo puede hacerse desde la computadora del sistema');
  const { user, token } = auth.setupAdmin(req.body, m.ctx(req));
  m.setSessionCookie(req, res, token);
  res.status(201).json({ user: publicUser(user) });
});

r.post('/auth/login', loginLimiter, (req, res) => {
  const { user, token } = auth.login(req.body, m.ctx(req));
  m.setSessionCookie(req, res, token);
  res.json({ user: publicUser(user) });
});

r.post('/auth/logout', (req, res) => {
  if (req.user) auth.logout(req.user, m.ctx(req));
  m.clearSessionCookie(res);
  res.json({ ok: true });
});

// Permitido aunque deba cambiar la contraseña (por eso no usa requireAuth)
r.post('/auth/change-password', loginLimiter, (req, res) => {
  if (!req.user) throw new AppError(401, 'Sesión no iniciada o expirada');
  auth.changePassword(req.user, req.body, m.ctx(req));
  res.json({ ok: true });
});

// ---- Administración de usuarios (solo admin) ----
const admin = [m.requireAuth, m.requireRole('admin')];
r.get('/users', admin, (req, res) => res.json(repos().users.list()));
r.post('/users', admin, (req, res) => res.status(201).json(auth.createUser(req.user, req.body, m.ctx(req))));
r.patch('/users/:id', admin, (req, res) => res.json(auth.updateUser(req.user, Number(req.params.id), req.body, m.ctx(req))));
r.post('/users/:id/reset-password', admin, (req, res) => res.json(auth.resetPassword(req.user, Number(req.params.id), m.ctx(req))));
r.get('/audit', admin, (req, res) => res.json(repos().users.auditList(Number(req.query.limit) || 200)));

module.exports = r;
