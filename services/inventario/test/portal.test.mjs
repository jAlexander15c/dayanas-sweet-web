import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAppProxy } from '../src/proxy-auth.mjs';
import { createPortalHandler, forwardToCelebraciones } from '../src/portal-handler.mjs';
import { createOfflineToken } from '../src/offline-token.mjs';
import { createStaffEmail } from '../src/staff-email.mjs';
import { createInventoryService } from '../src/inventory-service.mjs';
import { createShopifyClient } from '../src/shopify-client.mjs';
import { decryptToken } from '../src/staff-crypto.mjs';
import { staffHarness, staffEnv, signedProxy, master } from './staff-helpers.mjs';
import { jwt, harness, productId, variantId, locationId } from './helpers.mjs';
const fails = (fn, code) => assert.rejects(fn, e => e.code === code);
test('proxy válido sin customer, repetidos agrupados y ±600s; rechaza alterado, viejo, futuro, otra tienda, duplicados', async () => {
  const now = Date.now();
  await verifyAppProxy(new Request(signedProxy('/proxy?extra=a&extra=b', staffEnv, {}, now)), staffEnv, now);
  for (const offset of [-600, 600]) { const time = Math.floor(now / 1000) * 1000; await verifyAppProxy(new Request(signedProxy('/proxy', staffEnv, {}, time + offset * 1000)), staffEnv, time); }
  const good = signedProxy('/proxy', staffEnv, {}, now), altered = new URL(good); altered.searchParams.set('path_prefix', '/apps/other');
  for (const url of [altered.href, signedProxy('/proxy', staffEnv, { timestamp: String(Math.floor(now / 1000) - 601) }), signedProxy('/proxy', staffEnv, { timestamp: String(Math.floor(now / 1000) + 601) }), signedProxy('/proxy', staffEnv, { shop: 'other.myshopify.com' }), good + '&shop=' + staffEnv.SHOPIFY_SHOP, good + '&signature=' + '0'.repeat(64), 'https://worker.test/proxy?logged_in_customer_id=123']) await fails(() => verifyAppProxy(new Request(url), staffEnv, now), 'AUTH_REQUIRED');
});
test('portal apagado 503; JSON POST y firma obligatorios en cada API; llave maestra Bearer', async () => {
  const h = staffHarness(), make = env => createPortalHandler({ env, identity: h.identity });
  const call = (env, url, method, body, contentType = 'application/json') => make(env)(new Request(url, { method, headers: { 'Content-Type': contentType }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  assert.equal((await call({ ...staffEnv, EXTERNAL_LOGIN_ENABLED: 'false' }, 'https://worker.test/proxy/api/login', 'POST', {})).status, 503);
  assert.equal((await call(staffEnv, 'https://worker.test/proxy/api/login', 'POST', {})).status, 401);
  assert.equal((await call(staffEnv, signedProxy('/proxy/api/login'), 'GET')).status, 405);
  assert.equal((await call(staffEnv, signedProxy('/proxy/api/login'), 'POST', {}, 'text/plain')).status, 400);
  assert.equal((await call(staffEnv, signedProxy('/proxy/api/login'), 'POST', [])).status, 400);
  assert.equal((await make(staffEnv)(new Request('https://worker.test/api/staff/users', { method: 'POST', body: '{}' }))).status, 401);
  const valid = await make(staffEnv)(new Request('https://worker.test/api/staff/users', { method: 'POST', headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' }, body: '{}' }));
  assert.equal(valid.status, 200); assert.deepEqual(await valid.json(), { users: [] });
});
test('inventario exige rol, conserva validaciones y auditoría user:<id>; gateway 501 exige rol/sesión', async () => {
  const h = staffHarness(), inventory = harness(), admin = await h.activate();
  const viewer = await h.activate('solo-admin', ['admin']);
  const other = await h.activate('celebradora', ['celebraciones']);
  let offlineCalls = 0;
  const clientFactory = () => inventory.clientFactory(jwt(), '123');
  const service = createInventoryService({ store: inventory.store, clientFactory });
  const handler = createPortalHandler({ env: staffEnv, identity: h.identity, offline: { get: async () => { offlineCalls++; return 'synthetic'; } }, service, clientFactory });
  const call = (path, data) => handler(new Request(signedProxy('/proxy/api/' + path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
  assert.equal((await call('inventory/products', { session: viewer.session })).status, 403); assert.equal(offlineCalls, 0);
  assert.equal((await call('celebraciones/requests', { session: admin.session })).status, 403);
  assert.equal((await call('celebraciones/requests', {})).status, 401);
  const reserved = await call('celebraciones/requests', { session: other.session }); assert.equal(reserved.status, 501); assert.deepEqual(await reserved.json(), { code: 'NOT_AVAILABLE' });
  assert.equal((await call('celebraciones/requests', { session: other.session, actor: { roles: ['admin'] } })).status, 400);
  // Actual inventory service, SQLite operation receipt and audit; stub only Shopify transport.
  const result = await call('inventory/operations', { session: admin.session, body: { operationId: crypto.randomUUID(), action: 'production', productId, variantId, locationId, quantity: 2, expected: 4 } });
  assert.equal(result.status, 200); const event = service.history()[0]; assert.equal(event.staffId, `user:${admin.user.id}`); assert.equal(event.staffName, admin.user.name);
  await h.identity.handle('update-user', { userId: other.user.id, status: 'disabled' }, master);
  assert.equal((await call('celebraciones/requests', { session: other.session })).status, 401);
});
test('extensión RPC usa identidad servidor, aud, método/ruta/cuerpo; no reenvía firma ni session', async () => {
  const h = staffHarness(); await h.activate(); const login = await h.activate('eventos', ['celebraciones']); let got;
  const env = { ...staffEnv, CELEBRACIONES: { handle: async value => { got = value; return { status: 201, body: { ok: true } }; } } };
  const handler = createPortalHandler({ env, identity: h.identity });
  const response = await handler(new Request(signedProxy('/proxy/api/celebraciones/requests?state=pending'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: login.session, method: 'POST', body: { title: 'Evento' } }) }));
  assert.equal(response.status, 201); assert.equal(got.actor.userId, login.user.id); assert.equal(got.actor.aud, 'celebraciones'); assert.equal(got.actor.shop, staffEnv.SHOPIFY_SHOP); assert.equal(got.path, '/requests?state=pending'); assert.equal(got.method, 'POST'); assert.deepEqual(got.body, { title: 'Evento' }); assert.equal(JSON.stringify(got).includes(login.session), false);
  assert.equal((await forwardToCelebraciones({}, got.actor, 'GET', '/', null)).status, 501);
});
test('offline exchange parámetros oficiales, AES-GCM y refresh serializado con rotación persistida', async () => {
  const h = staffHarness(), requests = [];
  const fetchImpl = async (url, init) => { requests.push(new URLSearchParams(init.body)); assert.equal(url, `https://${staffEnv.SHOPIFY_SHOP}/admin/oauth/access_token`); return Response.json({ access_token: 'offline-' + requests.length, refresh_token: 'refresh-' + requests.length, expires_in: 3600, refresh_token_expires_in: 7776000 }); };
  const options = { env: staffEnv, store: h.store, fetchImpl, now: h.now }, offline = createOfflineToken(options);
  await fails(() => offline.get(), 'RECONNECT_REQUIRED');
  await offline.connect('synthetic-id-token'); assert.equal(requests[0].get('expiring'), '1'); assert.equal(requests[0].get('requested_token_type'), 'urn:shopify:params:oauth:token-type:offline-access-token'); assert.equal(requests[0].get('subject_token_type'), 'urn:ietf:params:oauth:token-type:id_token');
  assert.equal(await offline.get(), 'offline-1'); const row = h.store.all('offline_credentials')[0]; assert.equal(row.ciphertext.includes('offline-1'), false); assert.equal(row.ciphertext.includes('refresh-1'), false);
  assert.equal((await decryptToken(row.ciphertext, staffEnv.INVENTARIO_TOKEN_KEY, staffEnv.SHOPIFY_SHOP)).access_token, 'offline-1');
  await fails(() => decryptToken(row.ciphertext, staffEnv.INVENTARIO_TOKEN_KEY, 'another-shop'), 'RECONNECT_REQUIRED');
  h.advance(3600000); assert.deepEqual(await Promise.all([offline.get(), offline.get()]), ['offline-2', 'offline-2']);
  assert.equal(requests.length, 2); assert.equal(requests[1].get('grant_type'), 'refresh_token'); assert.equal(requests[1].get('refresh_token'), 'refresh-1');
  const restart = createOfflineToken(options); assert.equal(await restart.get(), 'offline-2');
  h.advance(7776000 * 1000); await fails(() => restart.get(), 'RECONNECT_REQUIRED');
});
test('offline: error proveedor, datos incompletos y clave faltante piden reconectar sin tokens en logs', async () => {
  const h = staffHarness(), logs = [], original = console.warn; console.warn = (...args) => logs.push(args);
  try {
    for (const fetchImpl of [async () => { throw Error('sensitive-token'); }, async () => Response.json({ access_token: 'sensitive-token' }), async () => new Response('', { status: 401 })]) await fails(() => createOfflineToken({ env: staffEnv, store: h.store, fetchImpl }).connect('synthetic'), 'RECONNECT_REQUIRED');
    let touched = false;
    await fails(() => createOfflineToken({ env: { ...staffEnv, INVENTARIO_TOKEN_KEY: '' }, store: h.store, fetchImpl: () => { touched = true; } }).connect('synthetic'), 'TOKEN_CONFIG'); assert.equal(touched, false); assert.deepEqual(logs, []);
  } finally { console.warn = original; }
});
test('Resend remitente, texto español, timeout, fallos normalizados; nunca loguea credenciales/destinatarios/códigos', async () => {
  let payload; const logs = [], original = console.warn; console.warn = (...args) => logs.push(args);
  try {
    await createStaffEmail({ env: staffEnv, fetchImpl: async (url, init) => { assert.equal(url, 'https://api.resend.com/emails'); assert.ok(init.signal); payload = JSON.parse(init.body); return Response.json({ id: 'mail' }); } })({ to: 'privado@example.test', subject: 'Invitación', text: 'Código 123456' });
    assert.match(payload.from, /info@dayanassweet.com/); assert.deepEqual(payload.to, ['privado@example.test']);
    for (const fetchImpl of [async () => new Response('', { status: 500 }), async () => { throw Error('privado@example.test 123456 sensitive-token'); }]) await fails(() => createStaffEmail({ env: staffEnv, fetchImpl })({ to: 'privado@example.test', subject: 'Código', text: '123456' }), 'EMAIL_FAILED');
    assert.deepEqual(logs, []);
  } finally { console.warn = original; }
});
test('cliente offline no intercambia token online, 401 pide reconectar y excepciones no filtran secretos en logs', async () => {
  const logs = [], original = console.warn; console.warn = (...args) => logs.push(args);
  try {
    const options = { env: staffEnv, tokenProvider: async () => 'private-offline-token' };
    const client = createShopifyClient({ ...options, fetchImpl: async (url, init) => { assert.match(url, /graphql\.json$/); assert.equal(init.headers['X-Shopify-Access-Token'], 'private-offline-token'); return new Response('', { status: 401 }); } });
    await fails(() => client.locations(), 'RECONNECT_REQUIRED');
    const failing = createShopifyClient({ ...options, fetchImpl: async () => { throw Error('private-offline-token private@example.test 123456'); } });
    await fails(() => failing.locations(), 'REVIEW_REQUIRED');
    assert.deepEqual(logs, [['{"event":"shopify_fetch_failed"}']]);
  } finally { console.warn = original; }
});
