import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createDurableStore } from '../src/durable-store.mjs';
import { createInventoryService } from '../src/inventory-service.mjs';
import { createShopifyClient } from '../src/shopify-client.mjs';
import { createHandler } from '../src/http.mjs';
import { categoryIds } from '../src/categories.mjs';
import { testEnv, createShopifyMock, productId, variantId, locationId, categoryId } from './shopify-fixture.mjs';
export { testEnv, productId, variantId, locationId };
export function jwt(overrides = {}, secret = testEnv.SHOPIFY_APP_SECRET, header = { alg: 'HS256', typ: 'JWT' }) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = [encode(header), encode({ aud: testEnv.SHOPIFY_CLIENT_ID, dest: `https://${testEnv.SHOPIFY_SHOP}`, iss: `https://${testEnv.SHOPIFY_SHOP}/admin`, sub: '123', iat: now - 1, nbf: now - 1, exp: now + 60, ...overrides })].join('.');
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}
export function sqliteStore() {
  const db = new DatabaseSync(':memory:');
  const storage = { sql: { exec(query, ...bindings) {
    const statement = db.prepare(query);
    if (/^\s*SELECT/i.test(query)) return { toArray: () => statement.all(...bindings) };
    const result = statement.run(...bindings);
    return { rowsWritten: result.changes, toArray: () => [] };
  } }, transactionSync(fn) { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  return { store: createDurableStore(storage), db };
}
export function harness(envOverrides = {}) {
  const env = { ...testEnv, ...envOverrides };
  const { store, db } = sqliteStore();
  const mock = createShopifyMock();
  const clientFactory = (sessionToken, staffId) => createShopifyClient({ env, sessionToken, staffId, fetchImpl: mock.fetch, sleep: async () => {} });
  const service = createInventoryService({ store, clientFactory });
  const handler = createHandler({ env, service, clientFactory });
  const call = (path, body, token = jwt(), method = body ? 'POST' : 'GET') => handler(new Request(`https://panel.test${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { env, store, db, mock, service, call, clientFactory };
}
export function production(overrides = {}) { return { action: 'production', operationId: crypto.randomUUID(), productId, variantId, locationId, quantity: 6, expected: 4, ...overrides }; }
export function correction(overrides = {}) { return production({ action: 'correction', quantity: 5, expected: 6, reason: 'Una caja dañada', ...overrides }); }
export function creation(overrides = {}) { return { action: 'create', operationId: crypto.randomUUID(), title: 'Nuevo brownie', description: 'Preparado hoy', price: '15.00', sku: 'BROWNIE', locationId, categoryId, quantity: 8, photos: [], ...overrides }; }
export function editing(h, overrides = {}) {
  const p = h.mock.state.product, v = p.variants.nodes[0];
  return { action: 'edit', operationId: crypto.randomUUID(), productId, title: p.title, description: p.description, status: p.status, price: v.price, sku: v.sku, expectedProduct: { title: p.title, descriptionHtml: p.descriptionHtml, status: p.status, ...(p.variants.nodes.length === 1 ? { price: v.price, sku: v.sku } : { variants: p.variants.nodes.map(v => ({ id: v.id, price: v.price, sku: v.sku ?? '' })) }), categoryIds: categoryIds(p, h.mock.state.collections), tags: [...(p.tags || [])].sort() }, ...overrides };
}
export const mutations = h => h.mock.state.calls.filter(c => c.query.startsWith('mutation'));
