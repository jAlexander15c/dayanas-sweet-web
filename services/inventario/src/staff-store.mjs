// All SQL identifiers below are internal constants, never request input.
const columns = {
  users: ['id', 'username', 'name', 'email', 'password_hash', 'roles', 'status', 'session_version', 'created_at', 'created_by', 'last_login_at', 'password_changed_at'],
  sessions: ['hash', 'user_id', 'version', 'created_at', 'last_used_at', 'expires_at'],
  invitations: ['hash', 'user_id', 'expires_at', 'used_at'],
  recovery_codes: ['hash', 'user_id', 'created_at', 'expires_at', 'attempts', 'used_at'],
  login_attempts: ['hash', 'failures', 'window_at', 'locked_until'],
  offline_credentials: ['id', 'ciphertext'],
};
export function createStaffStore(storage, { identity = true, offline = true } = {}) {
  const sql = storage.sql;
  if (identity) {
  sql.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT, roles TEXT NOT NULL, status TEXT NOT NULL, session_version INTEGER NOT NULL, created_at INTEGER NOT NULL, created_by TEXT NOT NULL, last_login_at INTEGER, password_changed_at INTEGER)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS invitations (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS recovery_codes (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL, used_at INTEGER)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS login_attempts (hash TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_at INTEGER NOT NULL, locked_until INTEGER NOT NULL)`);
  for (const table of ['sessions', 'invitations', 'recovery_codes']) sql.exec(`CREATE INDEX IF NOT EXISTS ${table}_user ON ${table}(user_id)`);
  }
  if (offline) sql.exec(`CREATE TABLE IF NOT EXISTS offline_credentials (id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL)`);
  return {
    all(table) { if (!columns[table]) throw Error('Unknown table'); return sql.exec(`SELECT * FROM ${table}`).toArray(); },
    get(table, id) { const fields = columns[table]; if (!fields) throw Error('Unknown table'); return sql.exec(`SELECT * FROM ${table} WHERE ${fields[0]} = ?`, id).toArray()[0]; },
    put(table, row) { const fields = columns[table]; if (!fields) throw Error('Unknown table'); sql.exec(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')}) ON CONFLICT(${fields[0]}) DO UPDATE SET ${fields.slice(1).map(f => `${f}=excluded.${f}`).join(',')}`, ...fields.map(f => row[f] ?? null)); },
    remove(table, id) { const fields = columns[table]; if (!fields) throw Error('Unknown table'); sql.exec(`DELETE FROM ${table} WHERE ${fields[0]} = ?`, id); },
    transaction(fn) { return storage.transactionSync(fn); },
  };
}
