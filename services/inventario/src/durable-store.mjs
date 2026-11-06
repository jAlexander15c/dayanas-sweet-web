// Only operation receipts and immutable audit events. Never a product/stock cache.
export function createDurableStore(storage) {
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS operations (
    operation_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, staff_id TEXT NOT NULL,
    state TEXT NOT NULL, response TEXT, created_at TEXT NOT NULL
  )`);
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS audit (
    id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, event TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
  return {
    get(id) { return storage.sql.exec('SELECT * FROM operations WHERE operation_id = ?', id).toArray()[0]; },
    event(id) { const row = storage.sql.exec('SELECT event FROM audit WHERE operation_id = ?', id).toArray()[0]; return row && JSON.parse(row.event); },
    checkpoint(id, event) { storage.sql.exec('UPDATE audit SET event = ? WHERE operation_id = ?', JSON.stringify(event), id); },
    begin(id, fingerprint, staffId, date, event) {
      storage.transactionSync(() => {
        storage.sql.exec('INSERT INTO operations VALUES (?, ?, ?, ?, NULL, ?)', id, fingerprint, staffId, 'pending', date);
        storage.sql.exec('INSERT INTO audit VALUES (?, ?, ?, ?)', event.id, id, JSON.stringify(event), date);
      });
    },
    finish(id, state, result, event) {
      storage.transactionSync(() => {
        storage.sql.exec('UPDATE operations SET state = ?, response = ? WHERE operation_id = ?', state, JSON.stringify(result), id);
        storage.sql.exec('UPDATE audit SET event = ? WHERE operation_id = ?', JSON.stringify(event), id);
      });
    },
    history() { return storage.sql.exec('SELECT event FROM audit ORDER BY created_at DESC, rowid DESC LIMIT 100').toArray().map(row => JSON.parse(row.event)); },
  };
}
