import test from 'node:test';
import assert from 'node:assert/strict';
import { staffHarness, password, master } from './staff-helpers.mjs';
import { hashPassword, verifyPassword, sha256, validatePassword } from '../src/staff-crypto.mjs';
import { recoveryMessage } from '../src/staff-identity.mjs';
const HOUR = 3600000;
const fails = (fn, code) => assert.rejects(fn, e => e.code === code);
test('PBKDF2 SHA256 100000, salts aleatorios y política de contraseñas', async () => {
  const a = await hashPassword(password), b = await hashPassword(password);
  assert.match(a, /^pbkdf2-sha256\$100000\$/); assert.notEqual(a, b);
  assert.equal(await verifyPassword(password, a), true); assert.equal(await verifyPassword('incorrecta', a), false);
  assert.equal(await verifyPassword(password, null), false);
  for (const value of ['corta', 'password123', 'qwerty12345', 'sameusername']) assert.throws(() => validatePassword(value, 'sameusername'));
});
test('bootstrap solo llave Shopify, primer admin por invitación en fragmento; credenciales solo hashes', async () => {
  const h = staffHarness();
  await fails(() => h.identity.handle('invite', { username: 'dayana' }), 'SESSION_REQUIRED');
  await fails(() => h.invite('dayana', ['inventario']), 'VALIDATION');
  const invited = await h.invite(); assert.equal(invited.user.status, 'invited');
  const link = new URL(h.emails[0].text.match(/https:\/\/\S+/)[0]); assert.equal(link.origin, 'https://dayanassweet.com'); assert.equal(link.search, ''); assert.match(link.hash, /^#invitacion=[\w-]{43}$/);
  const token = h.invitation(); const result = await h.identity.handle('accept-invitation', { token, password });
  assert.equal(result.user.status, 'active'); assert.equal(result.expiresAt, h.now() + 12 * HOUR);
  assert.equal(result.session.length, 43); assert.equal(h.store.all('sessions')[0].hash, await sha256(result.session));
  assert.equal(h.store.all('users')[0].created_by, 'shopify:123');
  assert.equal(JSON.stringify(h.store.all('invitations')).includes(token), false); assert.equal(JSON.stringify(h.store.all('users')).includes(password), false);
  await fails(() => h.identity.handle('accept-invitation', { token, password }), 'INVITATION_INVALID');
});
test('invitación vence a las 48h, reenvío revoca anterior, cancelación invalida enlace', async () => {
  const h = staffHarness(); await h.activate(); const user = (await h.invite('maria', ['inventario'])).user;
  const old = h.invitation(); h.advance(48 * HOUR);
  await fails(() => h.identity.handle('accept-invitation', { token: old, password }), 'INVITATION_INVALID');
  await h.identity.handle('resend-invitation', { userId: user.id }, master); const current = h.invitation();
  await h.identity.handle('resend-invitation', { userId: user.id }, master);
  await fails(() => h.identity.handle('accept-invitation', { token: current, password }), 'INVITATION_INVALID');
  const last = h.invitation(); await h.identity.handle('cancel-invitation', { userId: user.id }, master);
  await fails(() => h.identity.handle('accept-invitation', { token: last, password }), 'INVITATION_INVALID');
});
test('aceptaciones paralelas: solo una crea contraseña y sesión', async () => {
  const h = staffHarness(); await h.invite(); const token = h.invitation();
  const results = await Promise.allSettled([1, 2].map(() => h.identity.handle('accept-invitation', { token, password })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(h.store.all('sessions').length, 1);
});
test('login genérico inexistente/incorrecto/desactivado; cinco fallos bloquean 15 min', async () => {
  const h = staffHarness(); await h.activate();
  let generic;
  try { await h.identity.handle('login', { username: 'desconocida', password }); } catch (e) { generic = e.message; }
  for (let i = 0; i < 5; i++) await assert.rejects(() => h.identity.handle('login', { username: 'dayana', password: 'mal' }), e => e.message === generic);
  await assert.rejects(() => h.identity.handle('login', { username: 'dayana', password }), e => e.message === generic);
  h.advance(15 * 60000 - 1); await fails(() => h.identity.handle('login', { username: 'dayana', password }), 'LOGIN_FAILED');
  h.advance(1); assert.ok((await h.identity.handle('login', { username: 'dayana', password })).session);
});
test('login comparte límite por usuario/correo; nombre global no colisiona con límite global', async () => {
  const h = staffHarness(); await h.activate(); await h.activate('global', ['inventario']);
  for (let i = 0; i < 5; i++) await fails(() => h.identity.handle('login', { username: i % 2 ? 'global@example.test' : 'global', password: 'mal' }), 'LOGIN_FAILED');
  await fails(() => h.identity.handle('login', { username: 'global', password }), 'LOGIN_FAILED');
  h.advance(15 * 60000); assert.ok((await h.identity.handle('login', { username: 'global', password })).session);
  for (let i = 0; i < 50; i++) await fails(() => h.identity.handle('login', { username: `unknown${i}`, password }), 'LOGIN_FAILED');
  assert.ok((await h.identity.handle('login', { username: 'dayana', password })).session);
  h.advance(15 * 60000); assert.ok((await h.identity.handle('login', { username: 'dayana', password })).session);
});
for (const [label, advance, keepActive] of [['inactividad 2h', 2 * HOUR, false], ['límite absoluto 12h', 12 * HOUR, true]]) test(`sesión vence por ${label}`, async () => {
  const h = staffHarness(); const login = await h.activate();
  if (keepActive) for (let i = 0; i < 11; i++) { h.advance(HOUR); await h.identity.authenticate(login.session); }
  h.advance(keepActive ? HOUR : advance);
  await fails(() => h.identity.authenticate(login.session), 'SESSION_REQUIRED');
});
test('logout elimina solo esa sesión; modificar contraseña invalida todas', async () => {
  const h = staffHarness(), a = await h.activate(), b = await h.identity.handle('login', { username: 'dayana', password });
  await h.identity.handle('logout', { session: a.session }); await fails(() => h.identity.authenticate(a.session), 'SESSION_REQUIRED'); await h.identity.authenticate(b.session);
  await fails(() => h.identity.handle('change-password', { session: b.session, currentPassword: 'mal', password: password + '2' }), 'LOGIN_FAILED');
  await h.identity.handle('change-password', { session: b.session, currentPassword: password, password: password + '2' });
  await fails(() => h.identity.authenticate(b.session), 'SESSION_REQUIRED');
  await fails(() => h.identity.handle('login', { username: 'dayana', password }), 'LOGIN_FAILED');
  assert.ok((await h.identity.handle('login', { username: 'dayana', password: password + '2' })).session);
});
test('recuperación genérica, seis dígitos, 3/h, dos códigos válidos, HMAC y revocación de sesiones', async () => {
  const h = staffHarness(), a = await h.activate();
  const unknown = await h.identity.handle('recover', { identifier: 'no-existe' });
  await h.identity.handle('recover', { identifier: 'dayana' }); await h.flush(); const first = h.code();
  assert.match(first, /^\d{6}$/); assert.equal(JSON.stringify(h.store.all('recovery_codes')).includes(first), false);
  h.advance(1); assert.deepEqual(await h.identity.handle('recover', { identifier: 'dayana@example.test' }), unknown); await h.flush();
  assert.equal(unknown.message, recoveryMessage);
  const firstSession = await h.identity.handle('reset-password', { identifier: 'dayana', code: first, password });
  h.advance(1); await h.identity.handle('recover', { identifier: 'dayana' }); await h.flush(); const code = h.code();
  await h.identity.handle('recover', { identifier: 'dayana' }); await h.flush(); assert.equal(h.emails.length, 4);
  const next = await h.identity.handle('reset-password', { identifier: 'dayana', code, password: password + '2' });
  await fails(() => h.identity.authenticate(a.session), 'SESSION_REQUIRED'); await h.identity.authenticate(next.session);
  await fails(() => h.identity.authenticate(firstSession.session), 'SESSION_REQUIRED');
  await fails(() => h.identity.handle('reset-password', { identifier: 'dayana', code, password }), 'CODE_INVALID');
  h.advance(HOUR); await h.identity.handle('recover', { identifier: 'dayana' }); await h.flush(); assert.equal(h.emails.length, 5);
});
for (const mode of ['expiry', 'attempts']) test(`recuperación rechaza ${mode === 'expiry' ? 'a los 10 minutos' : 'tras 5 intentos'}`, async () => {
  const h = staffHarness(); await h.activate(); await h.identity.handle('recover', { identifier: 'dayana' }); await h.flush(); const code = h.code();
  if (mode === 'expiry') h.advance(10 * 60000);
  else for (let i = 0; i < 5; i++) await fails(() => h.identity.handle('reset-password', { identifier: 'dayana', code: code === '000000' ? '111111' : '000000', password }), 'CODE_INVALID');
  await fails(() => h.identity.handle('reset-password', { identifier: 'dayana', code, password }), 'CODE_INVALID');
});
test('recuperación con fallo de correo es genérica y cuenta contra 3/h; invitación informa fallo', async () => {
  const h = staffHarness(); await h.activate(); h.emailFailure(true);
  for (let i = 0; i < 4; i++) { h.advance(1); assert.equal((await h.identity.handle('recover', { identifier: 'dayana' })).message, recoveryMessage); await h.flush(); }
  assert.equal(h.store.all('recovery_codes').length, 3);
  assert.equal((await h.identity.handle('recover', { identifier: 'inexistente' })).message, recoveryMessage);
  await fails(() => h.invite('maria', ['inventario']), 'EMAIL_FAILED');
});
test('solo admin gestiona usuarios, nombres/correos únicos; desactivar/reactivar y quitar rol revocan', async () => {
  const h = staffHarness(), a = await h.activate(), b = await h.activate('maria', ['inventario', 'celebraciones']);
  for (const action of ['users', 'invite', 'update-user', 'resend-invitation', 'cancel-invitation']) await fails(() => h.identity.handle(action, { session: b.session }), 'ROLE_REQUIRED');
  await fails(() => h.invite(), 'VALIDATION');
  await h.identity.handle('update-user', { session: a.session, userId: b.user.id, roles: ['inventario'] });
  await fails(() => h.identity.authenticate(b.session), 'SESSION_REQUIRED');
  const c = await h.identity.handle('login', { username: 'maria', password });
  await h.identity.handle('update-user', { userId: b.user.id, status: 'disabled' }, master);
  await fails(() => h.identity.authenticate(c.session), 'SESSION_REQUIRED'); await fails(() => h.identity.handle('login', { username: 'maria', password }), 'LOGIN_FAILED');
  await h.identity.handle('update-user', { userId: b.user.id, status: 'active' }, master);
  assert.ok((await h.identity.handle('login', { username: 'maria', password })).session);
  assert.equal((await h.identity.handle('users', { session: a.session })).users[0].password_hash, undefined);
});
test('último admin activo protegido incluso llave maestra y cambios paralelos', async () => {
  const h = staffHarness(), a = await h.activate();
  for (const change of [{ status: 'disabled' }, { roles: ['inventario'] }]) await fails(() => h.identity.handle('update-user', { userId: a.user.id, ...change }, master), 'VALIDATION');
  const b = await h.activate('otra', ['admin']);
  const results = await Promise.allSettled([a, b].map(u => h.identity.handle('update-user', { userId: u.user.id, status: 'disabled' }, master)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(h.store.all('users').filter(u => u.status === 'active' && JSON.parse(u.roles).includes('admin')).length, 1);
});
test('cancelar y reactivar invitación requiere nuevo enlace; no activa una cuenta sin contraseña', async () => {
  const h = staffHarness(); await h.activate(); const invited = await h.invite('maria', ['inventario']); const old = h.invitation();
  await h.identity.handle('cancel-invitation', { userId: invited.user.id }, master);
  const result = await h.identity.handle('update-user', { userId: invited.user.id, status: 'active' }, master);
  assert.equal(result.user.status, 'invited');
  await fails(() => h.identity.handle('accept-invitation', { token: old, password }), 'INVITATION_INVALID');
  await h.identity.handle('resend-invitation', { userId: invited.user.id }, master);
  assert.equal((await h.identity.handle('accept-invitation', { token: h.invitation(), password })).user.status, 'active');
});
