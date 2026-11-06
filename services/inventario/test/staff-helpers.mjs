import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { createStaffStore } from '../src/staff-store.mjs';
import { createStaffIdentity } from '../src/staff-identity.mjs';
import { testEnv } from './shopify-fixture.mjs';
export const staffEnv = { ...testEnv, EXTERNAL_LOGIN_ENABLED: 'true', PORTAL_PUBLIC_URL: 'https://dayanassweet.com/apps/inventario', INVENTARIO_CODE_KEY: 'synthetic-code-hmac-key-32-characters-long', INVENTARIO_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'), RESEND_API_KEY: 'synthetic-resend-only' };
export const password = 'Masa-de-galletas-2026!';
export const master = { master: true, staffId: '123' };
export function staffHarness() {
  const db = new DatabaseSync(':memory:');
  const storage = { sql: { exec(query, ...bindings) { const statement = db.prepare(query); if (/^\s*SELECT/i.test(query)) return { toArray: () => statement.all(...bindings) }; statement.run(...bindings); return { toArray: () => [] }; } }, transactionSync(fn) { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } } };
  const store = createStaffStore(storage), emails = [];
  let time = 1800000000000, emailFailure = false;
  const pending = new Set();
  const waitUntil = task => { pending.add(task); void task.finally(() => pending.delete(task)); };
  const flush = async () => { while (pending.size) await Promise.all([...pending]); };
  const identity = createStaffIdentity({ env: staffEnv, store, now: () => time, waitUntil, sendEmail: async data => { if (emailFailure) throw Object.assign(Error('No se pudo enviar el correo.'), { code: 'EMAIL_FAILED', status: 502 }); emails.push(data); } });
  async function invite(username = 'dayana', roles = ['admin', 'inventario']) { return identity.handle('invite', { username, name: `Nombre ${username}`, email: `${username}@example.test`, roles }, master); }
  const invitation = () => new URL(emails.at(-1).text.match(/https:\/\/\S+/)[0]).hash.slice('#invitacion='.length);
  const code = () => emails.at(-1).text.match(/\b\d{6}\b/)[0];
  async function activate(username = 'dayana', roles = ['admin', 'inventario']) { await invite(username, roles); return identity.handle('accept-invitation', { token: invitation(), password }); }
  return { db, storage, store, emails, identity, invite, invitation, code, activate, flush, now: () => time, advance: ms => { time += ms; }, emailFailure: value => { emailFailure = value; } };
}
export function signedProxy(path = '/proxy', env = staffEnv, overrides = {}, now = Date.now()) {
  const url = new URL(path, 'https://worker.test');
  for (const [key, value] of Object.entries({ shop: env.SHOPIFY_SHOP, timestamp: String(Math.floor(now / 1000)), logged_in_customer_id: '', path_prefix: '/apps/inventario', ...overrides })) url.searchParams.set(key, value);
  const grouped = new Map(); for (const [key, value] of url.searchParams) grouped.set(key, [...(grouped.get(key) || []), value]);
  const message = [...grouped].map(([key, values]) => `${key}=${values.join(',')}`).sort().join('');
  url.searchParams.set('signature', createHmac('sha256', env.SHOPIFY_APP_SECRET).update(message).digest('hex'));
  return url.href;
}
