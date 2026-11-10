'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zoecloset-auth-'));
process.env.DB_PATH = path.join(tmp, 'auth.db');
process.env.BACKUP_DIR = path.join(tmp, 'backups');

const { getDb, closeDb } = require('../server/db/connection');
const { migrate } = require('../server/db/migrate');
const { createApp } = require('../server/app');
const sec = require('../server/lib/security');

migrate(getDb());
let server, base;

test.before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); });

/** Cliente con su propio "navegador" (cookie) */
function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { 'X-Requested-With': 'ZoeCloset', ...(body ? { 'Content-Type': 'application/json' } : {}),
                 ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: res.status, headers: res.headers, body: await res.json().catch(() => null), setCookie: set };
  };
}

test('política de contraseñas y hash scrypt', () => {
  assert.ok(sec.validatePassword('corta1').length);
  assert.ok(sec.validatePassword('soloLetrasLargas').length);
  assert.ok(sec.validatePassword('ruben123456', 'ruben').length);
  assert.deepEqual(sec.validatePassword('Vestido-Rosa-2026', 'ruben'), []);
  const h = sec.hashPassword('Vestido-Rosa-2026');
  assert.match(h, /^scrypt\$/);
  assert.ok(sec.verifyPassword('Vestido-Rosa-2026', h));
  assert.ok(!sec.verifyPassword('vestido-rosa-2026', h));
});

test('sin sesión: API 401 y páginas redirigen al login', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/products')).status, 401);
  const page = await c('GET', '/');
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/login.html');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

const admin = client();
test('asistente inicial crea admin una sola vez, con cookie segura', async () => {
  assert.equal((await admin('GET', '/api/auth/status')).body.needsSetup, true);
  const weak = await admin('POST', '/api/auth/setup', { name: 'Ruben', username: 'ruben', password: '123' });
  assert.equal(weak.status, 400);
  const ok = await admin('POST', '/api/auth/setup', { name: 'Ruben Romero', username: 'Ruben', password: 'Vestido-Rosa-2026' });
  assert.equal(ok.status, 201);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.match(ok.setCookie, /SameSite=Strict/);
  const again = await client()('POST', '/api/auth/setup', { name: 'X', username: 'hacker', password: 'Otra-Clave-2026' });
  assert.equal(again.status, 409);
});

test('CSRF: sin cabecera o con origen externo se rechaza', async () => {
  assert.equal((await admin('POST', '/api/cash/open', { opening_amount: 0 }, { 'X-Requested-With': '' })).status, 403);
  assert.equal((await admin('POST', '/api/cash/open', { opening_amount: 0 }, { Origin: 'http://malicioso.com' })).status, 403);
});

let tempPass;
test('admin crea cajero con clave temporal; debe cambiarla antes de usar el sistema', async () => {
  const res = await admin('POST', '/api/users', { name: 'María', username: 'maria', role: 'cajero' });
  assert.equal(res.status, 201);
  tempPass = res.body.temporaryPassword;
  assert.ok(!('password_hash' in res.body.user));

  const cajero = client();
  const login = await cajero('POST', '/api/auth/login', { username: 'maria', password: tempPass });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.must_change_password, true);
  const blocked = await cajero('GET', '/api/products');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.details.code, 'MUST_CHANGE_PASSWORD');

  const ch = await cajero('POST', '/api/auth/change-password', { current_password: tempPass, new_password: 'Caja-Zoe-4521' });
  assert.equal(ch.status, 200);
  assert.equal((await cajero('GET', '/api/products')).status, 200);

  // Permisos por rol
  assert.equal((await cajero('GET', '/api/users')).status, 403);
  assert.equal((await cajero('PUT', '/api/settings', { business_name: 'X' })).status, 403);
  assert.equal((await cajero('GET', '/api/reports/income-statement')).status, 403);
  assert.equal((await cajero('POST', '/api/cash/open', { opening_amount: 50000 })).status, 201);
});

test('bloqueo tras 5 intentos fallidos y mensaje genérico', async () => {
  const c = client();
  const unknown = await c('POST', '/api/auth/login', { username: 'noexiste', password: 'x' });
  const wrong = await c('POST', '/api/auth/login', { username: 'maria', password: 'incorrecta' });
  assert.equal(unknown.body.error, wrong.body.error); // no revela si el usuario existe
  for (let i = 0; i < 4; i++) await c('POST', '/api/auth/login', { username: 'maria', password: 'incorrecta' });
  const locked = await c('POST', '/api/auth/login', { username: 'maria', password: 'Caja-Zoe-4521' });
  assert.equal(locked.status, 423);

  const users = (await admin('GET', '/api/users')).body;
  const maria = users.find((u) => u.username === 'maria');
  await admin('PATCH', `/api/users/${maria.id}`, { unlock: true });
  assert.equal((await c('POST', '/api/auth/login', { username: 'maria', password: 'Caja-Zoe-4521' })).status, 200);
});

test('desactivar usuario cierra sus sesiones; no se puede quitar el último admin', async () => {
  const c = client();
  await c('POST', '/api/auth/login', { username: 'maria', password: 'Caja-Zoe-4521' });
  const users = (await admin('GET', '/api/users')).body;
  const maria = users.find((u) => u.username === 'maria');
  const ruben = users.find((u) => u.username === 'ruben');
  await admin('PATCH', `/api/users/${maria.id}`, { active: false });
  assert.equal((await c('GET', '/api/products')).status, 401);
  assert.equal((await admin('PATCH', `/api/users/${ruben.id}`, { role: 'cajero' })).status, 409);
});

test('la base guarda solo hashes (ni contraseñas ni tokens en claro)', () => {
  const db = getDb();
  const users = db.prepare('SELECT password_hash FROM users').pluck().all();
  assert.ok(users.every((h) => h.startsWith('scrypt$')));
  const tokens = db.prepare('SELECT token_hash FROM sessions').pluck().all();
  assert.ok(tokens.every((t) => /^[0-9a-f]{64}$/.test(t)));
});

test('bitácora registra eventos de seguridad', async () => {
  const log = (await admin('GET', '/api/audit')).body.map((a) => a.action);
  for (const a of ['setup_admin', 'user_created', 'login', 'account_locked', 'password_changed', 'user_updated', 'cash_open']) {
    assert.ok(log.includes(a), a);
  }
});

test('logout invalida la sesión', async () => {
  assert.equal((await admin('POST', '/api/auth/logout')).status, 200);
  assert.equal((await admin('GET', '/api/users')).status, 401);
});
