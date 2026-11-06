// Operations receipts and internal notes for the staff orders panel.
// Stores no customer data: only order ids, staff ids/names, amounts and the
// exact Shopify mutation plan (order/line/variant ids, quantities, amounts).

/** Adapter over a Durable Object's SQLite storage. */
export function sqlFromStorage(storage) {
  return {
    all: (query, ...bindings) => storage.sql.exec(query, ...bindings).toArray(),
    run: (query, ...bindings) => { storage.sql.exec(query, ...bindings); },
    transaction: fn => storage.transactionSync(fn),
  };
}

export function createOrdersStore(sql) {
  sql.run(`CREATE TABLE IF NOT EXISTS order_operations (
    operation_id TEXT PRIMARY KEY, action TEXT NOT NULL, order_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending','succeeded','failed')), plan TEXT, response TEXT,
    staff_id TEXT NOT NULL, staff_name TEXT NOT NULL, amount_cents INTEGER, summary TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, progress TEXT)`);
  // Tables created before `progress` existed get the column once; a duplicate-column error means it is there.
  try { sql.run('ALTER TABLE order_operations ADD COLUMN progress TEXT'); } catch { /* already present */ }
  sql.run('CREATE INDEX IF NOT EXISTS order_operations_order ON order_operations (order_id, created_at)');
  sql.run(`CREATE TABLE IF NOT EXISTS order_notes (
    order_id TEXT PRIMARY KEY, text TEXT NOT NULL, version INTEGER NOT NULL,
    staff_id TEXT NOT NULL, staff_name TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
  const read = row => row && ({
    operationId: row.operation_id, action: row.action, orderId: row.order_id, fingerprint: row.fingerprint, state: row.state,
    plan: row.plan ? JSON.parse(row.plan) : null, response: row.response ? JSON.parse(row.response) : null,
    staffId: row.staff_id, staffName: row.staff_name, amountCents: row.amount_cents, summary: row.summary,
    createdAt: row.created_at, updatedAt: row.updated_at, progress: row.progress ? JSON.parse(row.progress) : {},
  });
  return Object.freeze({
    getOperation: id => read(sql.all('SELECT * FROM order_operations WHERE operation_id = ?', id)[0]),
    begin({ operationId, action, orderId, fingerprint, plan, staffId, staffName, amountCents, summary, at }) {
      sql.run(`INSERT INTO order_operations (operation_id, action, order_id, fingerprint, state, plan, staff_id, staff_name, amount_cents, summary, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`, operationId, action, orderId, fingerprint, JSON.stringify(plan), staffId, staffName, amountCents ?? null, summary, at, at);
    },
    finish(operationId, { state, response, amountCents, summary, at }) {
      sql.run(`UPDATE order_operations SET state = ?, response = ?, amount_cents = COALESCE(?, amount_cents), summary = COALESCE(?, summary), updated_at = ?
        WHERE operation_id = ? AND state = 'pending'`, state, JSON.stringify(response), amountCents ?? null, summary ?? null, at, operationId);
    },
    /** Progress of a pending write (last attempt time, Shopify job id). Ignored once the operation is final. */
    progress(operationId, patch, at) {
      sql.transaction(() => {
        const row = sql.all("SELECT progress FROM order_operations WHERE operation_id = ? AND state = 'pending'", operationId)[0];
        if (!row) return;
        const next = { ...(row.progress ? JSON.parse(row.progress) : {}), ...patch };
        sql.run("UPDATE order_operations SET progress = ?, updated_at = ? WHERE operation_id = ? AND state = 'pending'", JSON.stringify(next), at, operationId);
      });
    },
    history: orderId => sql.all(`SELECT * FROM order_operations WHERE order_id = ? ORDER BY created_at DESC LIMIT 100`, orderId).map(read),
    readyOrders(orderIds) {
      if (!orderIds.length) return new Set();
      const rows = sql.all(`SELECT DISTINCT order_id FROM order_operations WHERE action = 'ready' AND state = 'succeeded' AND order_id IN (${orderIds.map(() => '?').join(',')})`, ...orderIds);
      return new Set(rows.map(row => row.order_id));
    },
    getNote(orderId) {
      const row = sql.all('SELECT * FROM order_notes WHERE order_id = ?', orderId)[0];
      return row ? { text: row.text, version: row.version, staffName: row.staff_name, updatedAt: row.updated_at } : { text: '', version: 0, staffName: null, updatedAt: null };
    },
    /** Compare-and-set on version: returns the saved note, or null when someone saved first. */
    saveNote(orderId, { text, version, staffId, staffName, at }) {
      return sql.transaction(() => {
        const current = sql.all('SELECT version FROM order_notes WHERE order_id = ?', orderId)[0]?.version ?? 0;
        if (current !== version) return null;
        sql.run(`INSERT INTO order_notes (order_id, text, version, staff_id, staff_name, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(order_id) DO UPDATE SET text = excluded.text, version = excluded.version, staff_id = excluded.staff_id, staff_name = excluded.staff_name, updated_at = excluded.updated_at`,
        orderId, text, version + 1, staffId, staffName, at);
        return { text, version: version + 1, staffName, updatedAt: at };
      });
    },
  });
}
