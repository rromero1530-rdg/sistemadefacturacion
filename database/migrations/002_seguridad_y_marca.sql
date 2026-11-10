-- =====================================================================
-- 002 - Login seguro, sesiones, bitácora de auditoría y marca Zoe Closet
-- =====================================================================

-- El usuario 'admin' sin contraseña de la migración 001 se elimina:
-- el primer administrador se crea en el asistente inicial (solo desde la propia PC).
DELETE FROM users WHERE username = 'admin' AND pin_hash IS NULL;

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until INTEGER;            -- epoch ms
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

-- Sesiones del lado del servidor. Solo se guarda el HASH del token (si alguien copia
-- la base de datos no puede usar las sesiones activas).
CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,     -- epoch ms
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,     -- vencimiento absoluto
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Bitácora de auditoría (inicios de sesión, cambios de usuarios, caja, configuración...)
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  username   TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- Quién registró cada movimiento
ALTER TABLE cash_movements ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE unmet_demand   ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE expenses       ADD COLUMN user_id INTEGER REFERENCES users(id);

UPDATE settings SET value = 'Zoe Closet' WHERE key = 'business_name' AND value = 'Pixel Hardstore';
INSERT OR IGNORE INTO settings (key, value) VALUES ('session_idle_minutes', '30');
