import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { staffHarness, staffEnv, password, master } from './staff-helpers.mjs';
import { createStaffIdentity, recoveryMessage } from '../src/staff-identity.mjs';
import { sha256 } from '../src/staff-crypto.mjs';
const HOUR = 3600000;
const fails = fn => assert.rejects(fn, e => e.code === 'LOGIN_FAILED');
async function deadline(promise) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('response waited for provider/queue')), 200); })]); } finally { clearTimeout(timer); } }

test('I1: 50 fallos anónimos permiten login correcto de un usuario activo', async () => {
  const h = staffHarness(); await h.activate();
  for (let i = 0; i < 50; i++) await fails(() => h.identity.handle('login', { username: `missing${i}`, password: 'mal' }));
  assert.ok((await h.identity.handle('login', { username: 'dayana', password })).session);
});

test('I2: bloqueo local y global se comprueban antes de PBKDF2, con el mismo error', async t => {
  const h = staffHarness(), user = await h.activate();
  for (const key of [`login:user:${user.user.id}`, 'login:global']) h.store.put('login_attempts', { hash: await sha256(key), failures: 50, window_at: h.now(), locked_until: h.now() + 900000 });
  let hashes = 0;
  t.mock.method(crypto.subtle, 'deriveBits', () => { hashes++; throw Error('PBKDF2 must not run'); });
  let message;
  for (const username of ['dayana', 'missing']) await assert.rejects(() => h.identity.handle('login', { username, password }), e => { assert.equal(e.code, 'LOGIN_FAILED'); if (message) assert.equal(e.message, message); message = e.message; return true; });
  assert.equal(hashes, 0);
});

test('I2: Worker dirige identidad e inventario a DOs distintos y conserva el DO original', async () => {
  const source = await readFile(new URL('../src/cloudflare-worker.mjs', import.meta.url), 'utf8');
  const stubDeclaration = source.match(/^const identityStub = .+;$/m)?.[0] || '';
  const worker = new Function('verifyAppProxy', 'authenticate', 'portalHeaders', 'securityHeaders', 'errorResult', `${stubDeclaration}\nreturn ${source.slice(source.indexOf('export default ') + 'export default '.length)}`)(async () => {}, async () => ({}), () => ({}), () => ({}), e => { throw e; });
  const calls = [], namespace = label => ({ idFromName: name => name, get: id => ({ fetch: async () => { calls.push([label, id]); return Response.json({}); } }) });
  const env = { ...staffEnv, INVENTARIO: namespace('inventory'), IDENTITY: namespace('identity') };
  for (const path of ['/proxy/api/login', '/proxy/api/inventory/products', '/api/staff/users', '/api/products', '/api/staff/connect']) await worker.fetch(new Request('https://worker.test' + path, { method: 'POST' }), env);
  assert.deepEqual(calls, [['identity', `identity:${env.SHOPIFY_SHOP}`], ['inventory', env.SHOPIFY_SHOP], ['identity', `identity:${env.SHOPIFY_SHOP}`], ['inventory', env.SHOPIFY_SHOP], ['inventory', env.SHOPIFY_SHOP]]);
});

test('I2: validar sesión no espera la cola de un login que está calculando PBKDF2', async t => {
  const h = staffHarness(), user = await h.activate();
  let release, started;
  const hashing = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const original = crypto.subtle.deriveBits.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'deriveBits', async (...args) => { started(); await gate; return original(...args); });
  const pending = h.identity.handle('login', { username: 'dayana', password });
  try { await hashing; assert.equal((await deadline(h.identity.authenticate(user.session))).userId, user.user.id); }
  finally { release(); await pending; }
});

test('I3: recover responde igual con proveedor detenido y libera la cola', async () => {
  const h = staffHarness(), login = await h.activate(), tasks = [];
  let release, started;
  const sending = new Promise(resolve => { started = resolve; }), provider = new Promise(resolve => { release = resolve; });
  const identity = createStaffIdentity({ env: staffEnv, store: h.store, now: h.now, waitUntil: task => tasks.push(task), sendEmail: async () => { started(); await provider; } });
  try {
    const times = [];
    for (const identifier of ['dayana', 'missing']) { const begin = performance.now(); assert.deepEqual(await deadline(identity.handle('recover', { identifier })), { message: recoveryMessage }); times.push(performance.now() - begin); }
    await deadline(sending);
    assert.ok(Math.abs(times[0] - times[1]) < 100, String(times));
    await deadline(identity.authenticate(login.session));
    assert.equal((await deadline(identity.handle('users', { session: login.session }))).users.length, 1);
  } finally { release(); await Promise.all(tasks); }
});

test('I3: invitación informa el envío sin retener cola y cancelar durante envío no revive enlace', async () => {
  const h = staffHarness(), login = await h.activate(); const invited = await h.invite('maria', ['inventario']);
  let release, started, mail;
  const sending = new Promise(resolve => { started = resolve; }), provider = new Promise(resolve => { release = resolve; });
  const identity = createStaffIdentity({ env: staffEnv, store: h.store, now: h.now, sendEmail: async data => { mail = data; started(); await provider; } });
  const pending = identity.handle('resend-invitation', { userId: invited.user.id }, master);
  try {
    await sending; await deadline(identity.authenticate(login.session));
    await deadline(identity.handle('cancel-invitation', { userId: invited.user.id }, master));
  } finally { release(); await pending.catch(() => {}); }
  const token = new URL(mail.text.match(/https:\/\/\S+/)[0]).hash.slice('#invitacion='.length);
  await assert.rejects(() => identity.handle('accept-invitation', { token, password }), e => e.code === 'INVITATION_INVALID');
});

test('M4: seis códigos por 24h incluso al reiniciar identidad; máximo dos vigentes conserva el primero', async () => {
  const h = staffHarness(); await h.activate();
  const recover = async () => { await h.identity.handle('recover', { identifier: 'dayana' }); await h.flush?.(); };
  await recover(); const first = h.code(); h.advance(1); await recover();
  h.advance(1); await recover();
  assert.equal(h.store.all('recovery_codes').filter(r => !r.used_at && r.expires_at > h.now()).length, 2);
  const result = await h.identity.handle('reset-password', { identifier: 'dayana', code: first, password }); assert.ok(result.session);
  // Used codes still count for issuance. Two more hourly windows reach six.
  for (let i = 0; i < 2; i++) { h.advance(HOUR); await recover(); h.advance(10 * 60000); await recover(); }
  const count = h.store.all('recovery_codes').length; assert.equal(count, 6);
  h.advance(HOUR);
  const tasks = [], restarted = createStaffIdentity({ env: staffEnv, store: h.store, now: h.now, sendEmail: async data => h.emails.push(data), waitUntil: p => tasks.push(p) });
  await restarted.handle('recover', { identifier: 'dayana' }); await Promise.all(tasks);
  assert.equal(h.store.all('recovery_codes').length, 6);
  h.advance(24 * HOUR);
  await restarted.handle('recover', { identifier: 'dayana' }); await Promise.all(tasks);
  assert.equal(h.store.all('recovery_codes').filter(r => r.created_at > h.now() - 24 * HOUR).length, 1);
});

test('M4: cinco fallos de reset por usuario persisten al pedir otro código y comparten correo/usuario', async () => {
  const h = staffHarness(); await h.activate();
  await h.identity.handle('recover', { identifier: 'dayana' }); await h.flush?.(); const old = h.code();
  const wrong = old === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await assert.rejects(() => h.identity.handle('reset-password', { identifier: i % 2 ? 'dayana@example.test' : 'dayana', code: wrong, password }), e => e.code === 'CODE_INVALID');
  await h.identity.handle('recover', { identifier: 'dayana' }); await h.flush?.();
  await assert.rejects(() => h.identity.handle('reset-password', { identifier: 'dayana', code: h.code(), password }), e => e.code === 'CODE_INVALID');
  h.advance(15 * 60000);
  await h.identity.handle('recover', { identifier: 'dayana' }); await h.flush?.();
  assert.ok((await h.identity.handle('reset-password', { identifier: 'dayana', code: h.code(), password })).session);
});

test('M5: change-password comparte login:user:<id>; quinto fallo cierra todas las sesiones', async () => {
  const h = staffHarness(), a = await h.activate(), b = await h.identity.handle('login', { username: 'dayana', password });
  for (let i = 0; i < 2; i++) await fails(() => h.identity.handle('login', { username: 'dayana@example.test', password: 'mal' }));
  for (let i = 0; i < 3; i++) await fails(() => h.identity.handle('change-password', { session: a.session, currentPassword: 'mal', password }));
  for (const session of [a.session, b.session]) await assert.rejects(() => h.identity.authenticate(session), e => e.code === 'SESSION_REQUIRED');
  await fails(() => h.identity.handle('login', { username: 'dayana', password }));
  assert.equal(h.store.get('login_attempts', await sha256(`login:user:${a.user.id}`)).failures, 5);
});

test('M6: reenvío de invitación cancelada explica que hay que reactivarla', async () => {
  const h = staffHarness(); await h.activate(); const invited = await h.invite('maria', ['inventario']);
  await h.identity.handle('cancel-invitation', { userId: invited.user.id }, master);
  await assert.rejects(() => h.identity.handle('resend-invitation', { userId: invited.user.id }, master), e => /cancelada/i.test(e.message) && /reactiva/i.test(e.message) && !/ya tiene una contraseña/i.test(e.message));
});

test('M7: Salir elimina sesión local y memoria aun cuando falla la red', async () => {
  const source = await readFile(new URL('../src/staff-ui.js', import.meta.url), 'utf8');
  const nodes = new Map(), node = selector => { if (!nodes.has(selector)) nodes.set(selector, { hidden: false, replaceChildren() {}, remove() {}, querySelectorAll: () => [], classList: { toggle() {} } }); return nodes.get(selector); };
  const values = new Map([['dayanas.inventario.session', 'saved']]);
  const legacy = new Map([['dayanas.inventario.session', 'old']]);
  const context = vm.createContext({ document: { body: { dataset: { portal: 'true' } }, querySelector: node }, window: {}, location: { hash: '' }, URL, sessionStorage: { setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }, localStorage: { removeItem: k => legacy.delete(k) }, fetch: async () => { throw Error('offline'); } });
  vm.runInContext(source.replace('import.meta.url', "'https://store.test/apps/inventario/assets/staff-ui.js'") + '\n globalThis.setup = async () => { credential = {session:"secret"}; currentUser = {name:"Dayana", roles:["inventario"]}; initializeInventory = async () => {}; await showPanel(); }; globalThis.readCredential = () => credential;', context);
  await context.setup(); await node('#sign-out').onclick();
  assert.equal(values.has('dayanas.inventario.session'), false); assert.equal(context.readCredential(), null);
  assert.equal(legacy.has('dayanas.inventario.session'), false);
  assert.equal(node('#panel-view').hidden, true); assert.equal(node('#access-view').hidden, false);
});
