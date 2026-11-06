import test from 'node:test';
import assert from 'node:assert/strict';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { testEnv, productId, variantId, locationId } from './shopify-fixture.mjs';
import { jwt } from './helpers.mjs';
test('Wrangler local: shell, auth, lecturas, producción paralela, conflicto, creación y auditoría SQLite', { timeout: 60_000 }, async () => {
  const worker = await unstable_dev('test/runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 0, inspectorPort: 0, vars: testEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } });
  try {
    const call = (path, body, token = jwt(), method = body ? 'POST' : 'GET') => worker.fetch(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const shell = await worker.fetch('/'); assert.equal(shell.status, 200); assert.match(await shell.text(), /Inventario/); assert.match(shell.headers.get('content-security-policy'), /frame-ancestors/);
    assert.equal((await worker.fetch('/assets/admin-ui.js')).status, 200);
    assert.equal((await worker.fetch('/api/products')).status, 401);
    assert.deepEqual(await (await worker.fetch('/__test/auth-guard')).json(), { status: 401, touches: 0 });
    assert.deepEqual(await (await call('/__test/auth-guard', null, jwt({}, 'wrong'))).json(), { status: 401, touches: 0 });
    assert.deepEqual(await (await call('/__test/auth-guard')).json(), { status: 200, touches: 2 });
    assert.equal((await call('/api/session')).status, 200);
    assert.equal((await call('/api/locations')).status, 200);
    assert.equal((await call('/api/products')).status, 200);
    assert.equal((await call(`/api/product?id=${encodeURIComponent(productId)}`)).status, 200);
    const input = { action: 'production', operationId: crypto.randomUUID(), productId, variantId, locationId, quantity: 6, expected: 4 };
    const responses = await Promise.all([call('/api/operations', input), call('/api/operations', input)]);
    assert.equal(responses[0].status, 200); assert.deepEqual(await responses[0].json(), await responses[1].json());
    const calls = await (await worker.fetch('/__test/calls')).json(); assert.equal(calls.filter(c => c.query.startsWith('mutation')).length, 1);
    await worker.fetch('/__test/stale');
    const conflict = await call('/api/operations', { ...input, action: 'correction', operationId: crypto.randomUUID(), quantity: 5, expected: 12, reason: 'Caja dañada' });
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).current, 13);
    const created = await call('/api/operations', { action: 'create', operationId: crypto.randomUUID(), title: 'Borrador de prueba', description: '', price: '12.00', sku: '', quantity: 2, locationId, categoryId: 'gid://shopify/Collection/701' });
    assert.equal(created.status, 200); assert.equal((await created.json()).after.status, 'DRAFT');
    const { events } = await (await call('/api/history')).json(); assert.equal(events.length, 3); assert.equal(events.filter(e => e.result === 'succeeded').length, 2); assert.equal(events.filter(e => e.result === 'failed').length, 1);
    assert.equal((await call('/api/product', null, jwt(), 'DELETE')).status, 404);
  } finally { await worker.stop(); }
});
