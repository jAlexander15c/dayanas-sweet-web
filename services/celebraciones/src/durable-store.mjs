import { createStoreWithDatabase } from './store-core.mjs';

/** SQLite-backed Durable Object storage; requires nodejs_compat for the shared crypto API. */
export function createDurableStore(storage) {
  const db = {
    exec(query) { storage.sql.exec(query); },
    prepare(query) {
      return {
        get(...bindings) { return storage.sql.exec(query, ...bindings).toArray()[0]; },
        all(...bindings) { return storage.sql.exec(query, ...bindings).toArray(); },
        run(...bindings) { return { changes: storage.sql.exec(query, ...bindings).rowsWritten }; },
      };
    },
    // The Durable Object runtime owns the storage lifecycle.
    close() {},
  };
  return createStoreWithDatabase(db, { transaction: fn => storage.transactionSync(fn) });
}
