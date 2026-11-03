import { DatabaseSync } from 'node:sqlite';
import { createStoreWithDatabase } from './store-core.mjs';

/** Local SQLite persistence. Callers must authenticate actors before invoking this API. */
export function createStore(path) {
  try {
    const db = new DatabaseSync(path);
    try {
      db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
      `);
    } catch (error) { db.close(); throw error; }
    return createStoreWithDatabase(db);
  } catch {
    throw Object.assign(new Error('UNAVAILABLE'), { code: 'UNAVAILABLE' });
  }
}
