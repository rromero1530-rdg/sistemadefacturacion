'use strict';
const { repos } = require('../repositories');
const sec = require('../lib/security');
const { nowLocal } = require('../lib/time');
const { AppError, badRequest, notFound, conflict } = require('../lib/errors');

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;            // bloqueo de cuenta tras 5 intentos fallidos
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;   // una sesión dura como máximo 12 h (un turno)
const ROLES = ['admin', 'cajero'];
const GENERIC = 'Usuario o contraseña incorrectos';

const idleMs = (r) => Math.max(5, Number(r.settings.get('session_idle_minutes') || 30)) * 60 * 1000;

function audit(r, action, { user, ip, detail } = {}) {
  r.users.audit({ user_id: user?.id ?? null, username: user?.username ?? null, action,
                  detail: detail ? JSON.stringify(detail) : null, ip: ip ?? null, created_at: nowLocal() });
}

function normalizeUsername(u) {
  const s = String(u || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(s)) throw badRequest('Usuario: 3 a 32 caracteres (letras, números, punto, guion)');
  return s;
}

function assertPassword(password, username) {
  const errors = sec.validatePassword(password, username);
  if (errors.length) throw badRequest('La contraseña no cumple la política', errors);
}

function createSession(r, user, { ip, userAgent }) {
  const token = sec.newToken();
  const now = Date.now();
  r.users.insertSession({ token_hash: sec.sha256(token), user_id: user.id, created_at: now, last_seen_at: now,
                          expires_at: now + ABSOLUTE_MS, ip: ip ?? null, user_agent: String(userAgent || '').slice(0, 200) });
  return token;
}

// ---------------- Asistente inicial ----------------
const needsSetup = (r = repos()) => r.users.countWithPassword() === 0;

function setupAdmin({ name, username, password }, ctx) {
  const r = repos();
  return r.db.transaction(() => {
    if (!needsSetup(r)) throw conflict('El sistema ya tiene usuarios configurados');
    const uname = normalizeUsername(username);
    assertPassword(password, uname);
    if (!String(name || '').trim()) throw badRequest('Nombre requerido');
    const id = r.users.insert({ name: name.trim(), username: uname, role: 'admin', password_hash: sec.hashPassword(password),
                                must_change_password: 0, password_changed_at: nowLocal() });
    const user = r.users.byId(id);
    audit(r, 'setup_admin', { user, ip: ctx.ip });
    return { user, token: createSession(r, user, ctx) };
  })();
}

// ---------------- Login / logout ----------------
function login({ username, password }, ctx) {
  const r = repos();
  const uname = String(username || '').trim().toLowerCase();
  const row = uname ? r.users.byUsername(uname) : null;

  // Siempre se calcula un hash, exista o no el usuario (mismo tiempo de respuesta)
  const ok = sec.verifyPassword(String(password || ''), row?.password_hash || sec.DUMMY_HASH);
  const now = Date.now();

  if (!row || !row.active || !row.password_hash) {
    audit(r, 'login_failed', { ip: ctx.ip, detail: { username: uname.slice(0, 32) } });
    throw new AppError(401, GENERIC);
  }
  if (row.locked_until && row.locked_until <= now) {
    r.users.unlock(row.id); // el bloqueo venció: se reinicia el contador
    row.failed_attempts = 0;
  } else if (row.locked_until && row.locked_until > now) {
    audit(r, 'login_locked', { user: row, ip: ctx.ip });
    const min = Math.ceil((row.locked_until - now) / 60000);
    throw new AppError(423, `Cuenta bloqueada temporalmente por intentos fallidos. Intenta en ${min} min o pide a un administrador que la desbloquee.`);
  }
  if (!ok) {
    r.users.registerFailure(row.id, now + LOCK_MS);
    const attempts = row.failed_attempts + 1;
    audit(r, attempts >= MAX_ATTEMPTS ? 'account_locked' : 'login_failed', { user: row, ip: ctx.ip, detail: { attempts } });
    throw new AppError(401, GENERIC);
  }

  r.users.registerSuccess(row.id, nowLocal());
  const user = r.users.byId(row.id);
  audit(r, 'login', { user, ip: ctx.ip });
  return { user, token: createSession(r, user, ctx) };
}

function logout(session, ctx) {
  const r = repos();
  r.users.deleteSession(session.session_id);
  audit(r, 'logout', { user: session, ip: ctx.ip });
}

/** Valida el token de la cookie: existencia, usuario activo, inactividad y vencimiento absoluto. */
function resolveSession(token) {
  if (!token || token.length > 100) return null;
  const r = repos();
  const s = r.users.sessionByHash(sec.sha256(token));
  if (!s) return null;
  const now = Date.now();
  if (!s.active || s.expires_at < now || s.last_seen_at < now - idleMs(r)) {
    r.users.deleteSession(s.session_id);
    return null;
  }
  if (now - s.last_seen_at > 60 * 1000) r.users.touchSession(s.session_id, now);
  return s;
}

// ---------------- Contraseñas ----------------
function changePassword(session, { current_password, new_password }, ctx) {
  const r = repos();
  const row = r.users.byUsername(session.username);
  if (!sec.verifyPassword(String(current_password || ''), row.password_hash)) {
    audit(r, 'password_change_failed', { user: session, ip: ctx.ip });
    throw badRequest('La contraseña actual no es correcta');
  }
  if (current_password === new_password) throw badRequest('La nueva contraseña debe ser distinta a la actual');
  assertPassword(new_password, row.username);
  r.db.transaction(() => {
    r.users.setPassword(row.id, sec.hashPassword(new_password), false, nowLocal());
    r.users.deleteUserSessions(row.id, session.session_id); // cierra sesiones en otros navegadores
  })();
  audit(r, 'password_changed', { user: session, ip: ctx.ip });
}

// ---------------- Administración de usuarios ----------------
function createUser(admin, { name, username, role = 'cajero' }, ctx) {
  const r = repos();
  const uname = normalizeUsername(username);
  if (!ROLES.includes(role)) throw badRequest('Rol inválido');
  if (!String(name || '').trim()) throw badRequest('Nombre requerido');
  if (r.users.byUsername(uname)) throw conflict('Ese usuario ya existe');
  const temp = sec.tempPassword();
  const id = r.users.insert({ name: name.trim(), username: uname, role, password_hash: sec.hashPassword(temp),
                              must_change_password: 1, password_changed_at: nowLocal() });
  audit(r, 'user_created', { user: admin, ip: ctx.ip, detail: { id, username: uname, role } });
  return { user: r.users.byId(id), temporaryPassword: temp };
}

function updateUser(admin, id, fields, ctx) {
  const r = repos();
  const target = r.users.byId(id);
  if (!target) throw notFound('Usuario no existe');
  const changes = {};
  if (fields.name != null) changes.name = String(fields.name).trim();
  if (fields.role != null) { if (!ROLES.includes(fields.role)) throw badRequest('Rol inválido'); changes.role = fields.role; }
  if (fields.active != null) changes.active = fields.active ? 1 : 0;
  if (fields.unlock) r.users.unlock(id);

  const losesAdmin = target.role === 'admin' && target.active && (changes.role === 'cajero' || changes.active === 0);
  if (losesAdmin && r.users.countActiveAdmins() <= 1) throw conflict('Debe existir al menos un administrador activo');
  if (id === admin.id && changes.active === 0) throw conflict('No puedes desactivar tu propio usuario');

  r.db.transaction(() => {
    r.users.update(id, changes);
    if (changes.active === 0 || changes.role) r.users.deleteUserSessions(id); // aplica permisos de inmediato
  })();
  audit(r, 'user_updated', { user: admin, ip: ctx.ip, detail: { id, ...changes } });
  return r.users.byId(id);
}

function resetPassword(admin, id, ctx) {
  const r = repos();
  const target = r.users.byId(id);
  if (!target) throw notFound('Usuario no existe');
  const temp = sec.tempPassword();
  r.db.transaction(() => {
    r.users.setPassword(id, sec.hashPassword(temp), true, nowLocal());
    r.users.deleteUserSessions(id);
  })();
  audit(r, 'password_reset', { user: admin, ip: ctx.ip, detail: { id, username: target.username } });
  return { temporaryPassword: temp };
}

function purgeExpiredSessions() {
  const r = repos();
  return r.users.purgeSessions(Date.now(), idleMs(r));
}

module.exports = {
  needsSetup, setupAdmin, login, logout, resolveSession, changePassword,
  createUser, updateUser, resetPassword, purgeExpiredSessions, audit, ROLES,
};
