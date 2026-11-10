'use strict';
const auth = require('../services/auth');
const { AppError } = require('../lib/errors');

const COOKIE = 'zc_session';

/** Cabeceras de seguridad (equivalente reducido de helmet, sin dependencias). */
function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    // CDN solo como respaldo si no se ejecutó `npm run vendor`
    "script-src 'self' https://cdn.tailwindcss.com https://unpkg.com",
    "style-src 'self' 'unsafe-inline'",   // Tailwind genera estilos en tiempo de ejecución
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(req, res, token) {
  const secure = req.secure ? '; Secure' : ''; // con HTTPS (red local / nube) se marca Secure
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

const clientIp = (req) => req.socket.remoteAddress || '';
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(clientIp(req));
const ctx = (req) => ({ ip: clientIp(req), userAgent: req.get('user-agent') });

/**
 * Anti-CSRF: toda petición que modifica datos debe traer la cabecera X-Requested-With
 * (un sitio externo no puede enviarla sin permiso CORS) y, si hay Origin, debe ser el propio.
 */
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'ZoeCloset') return next(new AppError(403, 'Solicitud rechazada (CSRF)'));
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) return next(new AppError(403, 'Origen no permitido'));
  next();
}

/** Carga la sesión (si existe) en req.user */
function loadSession(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  req.user = token ? auth.resolveSession(token) : null;
  if (token && !req.user) clearSessionCookie(res);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(new AppError(401, 'Sesión no iniciada o expirada'));
  if (req.user.must_change_password) return next(new AppError(403, 'Debes cambiar tu contraseña', { code: 'MUST_CHANGE_PASSWORD' }));
  next();
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : next(new AppError(403, 'No tienes permiso para esta acción'));

/** Límite de intentos por IP para login (además del bloqueo por cuenta). */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const key = clientIp(req);
    const now = Date.now();
    const h = hits.get(key) || { count: 0, reset: now + windowMs };
    if (h.reset < now) { h.count = 0; h.reset = now + windowMs; }
    h.count++;
    hits.set(key, h);
    if (h.count > max) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      return next(new AppError(429, 'Demasiados intentos. Espera unos minutos.'));
    }
    next();
  };
}

/** Páginas HTML protegidas: sin sesión redirige al login. */
const PUBLIC_PAGES = new Set(['/login.html']);
function protectPages(req, res, next) {
  if (req.method !== 'GET') return next();
  const p = req.path === '/' ? '/index.html' : req.path;
  if (!p.endsWith('.html') || PUBLIC_PAGES.has(p)) return next();
  if (!req.user) return res.redirect('/login.html');
  if (req.user.must_change_password && p !== '/cambiar-clave.html') return res.redirect('/cambiar-clave.html');
  if (p === '/usuarios.html' && req.user.role !== 'admin') return res.redirect('/');
  next();
}

module.exports = {
  securityHeaders, csrfGuard, loadSession, requireAuth, requireRole, rateLimit, protectPages,
  setSessionCookie, clearSessionCookie, isLocal, ctx,
};
