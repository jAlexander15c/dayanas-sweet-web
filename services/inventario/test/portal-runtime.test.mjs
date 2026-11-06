import test from 'node:test';
import assert from 'node:assert/strict';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { staffEnv, signedProxy, password } from './staff-helpers.mjs';
import { jwt, productId, variantId, locationId } from './helpers.mjs';
test('portal workerd/SQLite: firma en HTML/assets/API, llave Shopify, email, offline, operación y auditoría', { timeout: 60000 }, async () => {
  const worker = await unstable_dev('test/portal-runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 0, inspectorPort: 0, vars: staffEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } });
  try {
    const portal = (action, body = {}) => worker.fetch(signedProxy('/proxy/api/' + action), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const embedded = (action, body = {}) => worker.fetch('/api/staff/' + action, { method: 'POST', headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await worker.fetch('/__test/disabled')).status, 503);
    for (const path of ['/proxy', '/proxy/assets/staff-ui.js', '/proxy/api/login']) assert.equal((await worker.fetch(path)).status, 401);
    const shell = await worker.fetch(signedProxy('/proxy')); assert.equal(shell.status, 200); assert.match(shell.headers.get('content-security-policy'), /default-src 'none'/); assert.equal(shell.headers.get('x-robots-tag'), 'noindex, nofollow');
    const html = await shell.text(); assert.match(html, /http-equiv="Content-Security-Policy"/); assert.doesNotMatch(html, /app-bridge|fonts.googleapis/); assert.match(html, /\/apps\/inventario\/assets\/staff-ui.js/);
    for (const asset of ['staff-ui.js', 'admin-ui.js', 'admin-ui.css']) assert.equal((await worker.fetch(signedProxy('/proxy/assets/' + asset))).status, 200);
    assert.equal((await embedded('invite', { username: 'dayana', name: 'Dayana', email: 'dayana@example.test', roles: ['admin', 'inventario'] })).status, 200);
    const emails = await (await worker.fetch('/__test/emails')).json(); const token = new URL(emails[0].text.match(/https:\/\/\S+/)[0]).hash.slice('#invitacion='.length);
    const accepted = await portal('accept-invitation', { token, password }); assert.equal(accepted.status, 200); const login = await accepted.json();
    assert.equal((await portal('inventory/products', { session: login.session })).status, 503);
    assert.equal((await embedded('connect')).status, 200);
    assert.equal((await portal('inventory/products', { session: login.session, params: { q: 'Caja' } })).status, 200);
    const ownership = await (await worker.fetch('/__test/storage')).json();
    for (const table of ['operations', 'audit', 'offline_credentials']) assert.ok(ownership.inventory.includes(table), table);
    assert.equal(ownership.inventory.includes('users'), false);
    for (const table of ['users', 'sessions', 'recovery_codes', 'login_attempts']) assert.ok(ownership.identity.includes(table), table);
    assert.equal(ownership.identity.includes('operations'), false); assert.equal(ownership.identity.includes('offline_credentials'), false);
    const changed = await portal('inventory/operations', { session: login.session, body: { operationId: crypto.randomUUID(), action: 'production', productId, variantId, locationId, quantity: 2, expected: 4 } }); assert.equal(changed.status, 200);
    const history = await (await portal('inventory/history', { session: login.session })).json(); assert.equal(history.events[0].staffId, `user:${login.user.id}`); assert.equal(history.events[0].staffName, 'Dayana');
    // I3 in real workerd: the provider takes 300 ms; neither response nor queue waits for it.
    const times = [], replies = [];
    for (const identifier of ['dayana', 'missing']) { const begin = performance.now(); const response = await portal('recover', { identifier }); replies.push(await response.json()); times.push(performance.now() - begin); assert.equal(response.status, 200); }
    assert.deepEqual(replies[0], replies[1]); assert.ok(Math.max(...times) < 200, String(times)); assert.ok(Math.abs(times[0] - times[1]) < 100, String(times));
    const queueBegin = performance.now(); assert.equal((await embedded('users')).status, 200); assert.ok(performance.now() - queueBegin < 200);
    console.log(`I3 workerd: recover existente/inexistente ${times.map(t => t.toFixed(1)).join('/')} ms; proveedor simulado 300 ms, cola libre.`);
    assert.equal((await portal('logout', { session: login.session })).status, 200); assert.equal((await portal('session', { session: login.session })).status, 401);
    const expired = await portal('inventory/products', { session: login.session }); assert.equal(expired.status, 401); assert.equal((await expired.json()).code, 'SESSION_REQUIRED');
  } finally { await worker.stop(); }
});
