'use strict';
const crypto = require('node:crypto');

// scrypt: función de derivación "memoria-dura", incluida en Node (sin dependencias nativas extra).
// Formato guardado: scrypt$N$r$p$salt$hash  (base64)
const N = 32768, R = 8, P = 1, KEYLEN = 64;
const maxmem = (n, r) => 128 * n * r * 2;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !stored || !stored.startsWith('scrypt$')) return false;
  const [, n, r, p, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: maxmem(Number(n), Number(r)) });
  return crypto.timingSafeEqual(actual, expected);
}

// Hash ficticio para igualar tiempos cuando el usuario no existe (evita descubrir usuarios válidos)
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

const COMMON = new Set(['contraseña', 'contrasena', 'password', 'password1', '1234567890', '12345678910',
  'qwertyuiop', 'zoecloset', 'zoecloset1', 'zoecloset123', 'honduras', 'honduras1', 'honduras123',
  'tegucigalpa', 'sanpedrosula', 'administrador', 'admin12345', 'abc1234567']);

/** Política: 10-128 caracteres, letras y números, no contiene el usuario, no es común. */
function validatePassword(password, username = '') {
  const pw = typeof password === 'string' ? password : '';
  const errors = [];
  if (pw.length < 10) errors.push('Mínimo 10 caracteres');
  if (pw.length > 128) errors.push('Máximo 128 caracteres');
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(pw) || !/\d/.test(pw)) errors.push('Debe combinar letras y números');
  const low = pw.toLowerCase();
  if (username && username.length >= 3 && low.includes(username.toLowerCase())) errors.push('No debe contener el nombre de usuario');
  if (COMMON.has(low) || /^(.)\1+$/.test(low)) errors.push('Contraseña demasiado común');
  return errors;
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Contraseña temporal legible para entregar a un usuario nuevo (debe cambiarla al entrar). */
function tempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const pick = (n) => Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `${pick(4)}-${pick(4)}-${crypto.randomInt(1000, 9999)}`;
}

module.exports = { hashPassword, verifyPassword, validatePassword, newToken, sha256, tempPassword, DUMMY_HASH };
