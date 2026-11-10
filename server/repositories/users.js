'use strict';
const PUBLIC_COLS = `id, name, username, role, active, must_change_password, failed_attempts, locked_until,
                     last_login_at, password_changed_at, created_at`;

module.exports = (db) => ({
  countWithPassword() {
    return db.prepare('SELECT COUNT(*) FROM users WHERE password_hash IS NOT NULL').pluck().get();
  },
  countActiveAdmins() {
    return db.prepare("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1").pluck().get();
  },
  byUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  },
  byId(id) {
    return db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`).get(id);
  },
  list() {
    return db.prepare(`SELECT ${PUBLIC_COLS} FROM users ORDER BY active DESC, name`).all();
  },
  insert(u) {
    return db.prepare(`INSERT INTO users (name, username, role, password_hash, must_change_password, password_changed_at)
                       VALUES (@name, @username, @role, @password_hash, @must_change_password, @password_changed_at)`)
      .run(u).lastInsertRowid;
  },
  update(id, fields) {
    const allowed = ['name', 'role', 'active'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return;
    db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
  },
  setPassword(id, hash, mustChange, now) {
    db.prepare(`UPDATE users SET password_hash = ?, must_change_password = ?, password_changed_at = ?,
                failed_attempts = 0, locked_until = NULL WHERE id = ?`).run(hash, mustChange ? 1 : 0, now, id);
  },
  registerFailure(id, lockUntil) {
    db.prepare(`UPDATE users SET failed_attempts = failed_attempts + 1,
                locked_until = CASE WHEN failed_attempts + 1 >= @max THEN @lockUntil ELSE locked_until END
                WHERE id = @id`).run({ id, lockUntil, max: 5 });
  },
  registerSuccess(id, now) {
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now, id);
  },
  unlock(id) {
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(id);
  },

  // ---- Sesiones ----
  insertSession(s) {
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
                VALUES (@token_hash, @user_id, @created_at, @last_seen_at, @expires_at, @ip, @user_agent)`).run(s);
  },
  sessionByHash(tokenHash) {
    return db.prepare(`SELECT s.id AS session_id, s.last_seen_at, s.expires_at, u.id, u.name, u.username, u.role,
                              u.active, u.must_change_password
                       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(tokenHash);
  },
  touchSession(id, now) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, id);
  },
  deleteSession(id) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  },
  deleteUserSessions(userId, exceptId = 0) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, exceptId);
  },
  purgeSessions(now, idleMs) {
    return db.prepare('DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?').run(now, now - idleMs).changes;
  },

  // ---- Auditoría ----
  audit(entry) {
    db.prepare(`INSERT INTO audit_log (user_id, username, action, detail, ip, created_at)
                VALUES (@user_id, @username, @action, @detail, @ip, @created_at)`)
      .run({ user_id: null, username: null, detail: null, ip: null, ...entry });
  },
  auditList(limit = 200) {
    return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
  },
});
