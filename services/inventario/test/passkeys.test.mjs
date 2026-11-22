// Passkeys (Face ID / huella): a software authenticator signs with real P-256 and RSA keys, so the
// server-side checks run exactly as with a phone. Nothing here talks to a network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { staffHarness, password, master } from './staff-helpers.mjs';
import { decodeCbor, derToRaw } from '../src/webauthn.mjs';

const ORIGIN = 'https://dayanassweet.com', RP_ID = 'dayanassweet.com';
const b64u = bytes => Buffer.from(bytes).toString('base64url');
const fails = (fn, code) => assert.rejects(fn, e => e.code === code);

// Minimal CBOR encoder for the fixtures (unsigned/negative ints, bytes, text, arrays, maps).
function cbor(value) {
  const head = (major, n) => n < 24 ? Buffer.from([major << 5 | n]) : n < 256 ? Buffer.from([major << 5 | 24, n]) : n < 65536 ? Buffer.from([major << 5 | 25, n >> 8, n & 255]) : Buffer.from([major << 5 | 26, n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  if (Number.isInteger(value)) return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') { const bytes = Buffer.from(value); return Buffer.concat([head(3, bytes.length), bytes]); }
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}
const u16 = n => Buffer.from([n >> 8, n & 255]);
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

function authenticator({ kind = 'ec', counter = 0, rpId = RP_ID } = {}) {
  const pair = kind === 'ec' ? generateKeyPairSync('ec', { namedCurve: 'P-256' }) : generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = pair.publicKey.export({ format: 'jwk' }), id = randomBytes(32);
  const cose = kind === 'ec'
    ? new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]])
    : new Map([[1, 3], [3, -257], [-1, Buffer.from(jwk.n, 'base64url')], [-2, Buffer.from(jwk.e, 'base64url')]]);
  const authData = (flags, rest = Buffer.alloc(0), rp = rpId) => Buffer.concat([createHash('sha256').update(rp).digest(), Buffer.from([flags]), u32(counter), rest]);
  return {
    id: b64u(id),
    setCounter(value) { counter = value; },
    create(options, { flags = 0x45, origin = ORIGIN, rp = rpId, challenge = options.challenge } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
      const attested = Buffer.concat([Buffer.alloc(16), u16(id.length), id, cbor(cose)]);
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(flags, attested, rp)]]));
      return { credentialId: b64u(id), clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject) };
    },
    get(options, { flags = 0x05, origin = ORIGIN, rp = rpId, type = 'webauthn.get', userHandle, credentialId = b64u(id) } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type, challenge: options.challenge, origin }));
      const data = authData(flags, Buffer.alloc(0), rp);
      const signature = sign('sha256', Buffer.concat([data, createHash('sha256').update(clientDataJSON).digest()]), pair.privateKey);
      return { credentialId, clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(data), signature: b64u(signature), ...(userHandle ? { userHandle } : {}) };
    },
  };
}

async function enrolled(kind = 'ec') {
  const h = staffHarness(), signedIn = await h.activate(), device = authenticator({ kind });
  const options = await h.identity.handle('passkey-register-options', { session: signedIn.session, password });
  const result = await h.identity.handle('passkey-register', { session: signedIn.session, label: 'iPhone de Dayana', ...device.create(options) });
  return { h, signedIn, device, options, result };
}
const login = async (h, device, extra = {}) => h.identity.handle('passkey-login', device.get(await h.identity.handle('passkey-options', {}), extra));

test('passkeys: activar con sesión y contraseña; entrar con Face ID o huella crea una sesión normal', async () => {
  const { h, signedIn, options, result, device } = await enrolled();
  assert.equal(options.rp.id, RP_ID); assert.equal(options.authenticatorSelection.userVerification, 'required');
  assert.equal(options.user.id, b64u(Buffer.from(signedIn.user.id))); assert.equal(options.user.name, 'dayana');
  assert.deepEqual(result.passkeys.map(p => p.label), ['iPhone de Dayana']);
  const row = h.store.all('passkeys')[0];
  assert.equal(row.user_id, signedIn.user.id); assert.ok(!JSON.stringify(row).includes(password));
  const session = await login(h, device, { userHandle: options.user.id });
  assert.equal(session.user.username, 'dayana'); assert.equal(session.session.length, 43);
  assert.equal((await h.identity.authenticate(session.session)).userId, signedIn.user.id);
  assert.ok(h.store.all('passkeys')[0].last_used_at);
  // The device must not appear twice for the same person.
  assert.deepEqual((await h.identity.handle('passkey-register-options', { session: signedIn.session, password })).excludeCredentials, [{ type: 'public-key', id: device.id }]);
});

test('passkeys: también acepta claves RSA (algunos Windows y Android)', async () => {
  const { h, device } = await enrolled('rsa');
  assert.equal(h.store.all('passkeys')[0].alg, -257);
  assert.equal((await login(h, device)).user.username, 'dayana');
});

test('passkeys: activar exige sesión y la contraseña correcta, con el mismo bloqueo que el login', async () => {
  const h = staffHarness(), signedIn = await h.activate();
  await fails(() => h.identity.handle('passkey-register-options', { password }), 'SESSION_REQUIRED');
  await fails(() => h.identity.handle('passkey-register-options', { session: signedIn.session }), 'PASSWORD_REQUIRED');
  for (let n = 0; n < 4; n++) await fails(() => h.identity.handle('passkey-register-options', { session: signedIn.session, password: 'otra-cosa-123' }), 'PASSWORD_INVALID');
  assert.equal(h.store.all('passkeys').length, 0);
  // Fifth miss: sessions end, exactly like five wrong passwords in Pedidos.
  await fails(() => h.identity.handle('passkey-register-options', { session: signedIn.session, password: 'otra-cosa-123' }), 'PASSWORD_INVALID');
  await fails(() => h.identity.handle('session', { session: signedIn.session }), 'SESSION_REQUIRED');
  await fails(() => h.identity.handle('login', { username: 'dayana', password }), 'LOGIN_FAILED');
});

test('passkeys: el desafío es firmado, de un solo uso, de 5 minutos y ligado a la persona', async () => {
  const h = staffHarness(), dayana = await h.activate(), maria = await h.activate('maria', ['inventario']), device = authenticator();
  const forMaria = await h.identity.handle('passkey-register-options', { session: maria.session, password });
  await fails(() => h.identity.handle('passkey-register', { session: dayana.session, ...device.create(forMaria) }), 'PASSKEY_EXPIRED');
  const options = await h.identity.handle('passkey-register-options', { session: dayana.session, password });
  const forged = Buffer.from(options.challenge, 'base64url').toString().replace(/\.[^.]+$/, '.AAAA');
  await fails(() => h.identity.handle('passkey-register', { session: dayana.session, ...device.create(options, { challenge: b64u(Buffer.from(forged)) }) }), 'PASSKEY_EXPIRED');
  h.advance(5 * 60000 + 1);
  await fails(() => h.identity.handle('passkey-register', { session: dayana.session, ...device.create(options) }), 'PASSKEY_EXPIRED');
  const fresh = await h.identity.handle('passkey-register-options', { session: dayana.session, password });
  await h.identity.handle('passkey-register', { session: dayana.session, ...device.create(fresh) });
  await fails(() => h.identity.handle('passkey-register', { session: dayana.session, ...authenticator().create(fresh) }), 'PASSKEY_EXPIRED');
  // Asking for login options stores nothing; only a completed login records its challenge.
  const before = h.store.all('passkey_challenges').length;
  for (let n = 0; n < 20; n++) await h.identity.handle('passkey-options', {});
  assert.equal(h.store.all('passkey_challenges').length, before);
  const loginOptions = await h.identity.handle('passkey-options', {}), assertion = device.get(loginOptions);
  await h.identity.handle('passkey-login', assertion);
  await fails(() => h.identity.handle('passkey-login', assertion), 'PASSKEY_FAILED');
  h.advance(5 * 60000 + 1);
  await h.identity.handle('passkey-options', {});
  assert.equal(h.store.all('passkey_challenges').length, 0, 'used challenges are purged after they expire');
});

test('passkeys: rechaza otro sitio, otra app, sin verificación biométrica, firma ajena o contador que retrocede', async () => {
  const { h, device, options } = await enrolled();
  const other = authenticator();
  await fails(() => login(h, device, { origin: 'https://evil.example' }), 'PASSKEY_FAILED');
  await fails(() => login(h, device, { rp: 'evil.example' }), 'PASSKEY_FAILED');
  await fails(() => login(h, device, { type: 'webauthn.create' }), 'PASSKEY_FAILED');
  await fails(() => login(h, device, { flags: 0x01 }), 'PASSKEY_FAILED');
  await fails(() => login(h, other, { credentialId: device.id }), 'PASSKEY_FAILED');
  await fails(() => login(h, device, { userHandle: b64u(Buffer.from('otra-persona')) }), 'PASSKEY_FAILED');
  await fails(() => h.identity.handle('passkey-login', { credentialId: device.id, clientDataJSON: '%%%', authenticatorData: '', signature: '' }), 'PASSKEY_FAILED');
  device.setCounter(5); assert.ok(await login(h, device));
  device.setCounter(5); await fails(() => login(h, device), 'PASSKEY_FAILED');
  device.setCounter(6); assert.ok(await login(h, device, { userHandle: options.user.id }));
  // Activation also checks origin, relying party and user verification.
  const { h: h2, signedIn } = await enrolled();
  const fresh = authenticator(), next = () => h2.identity.handle('passkey-register-options', { session: signedIn.session, password });
  await fails(async () => h2.identity.handle('passkey-register', { session: signedIn.session, ...fresh.create(await next(), { origin: 'https://evil.example' }) }), 'PASSKEY_INVALID');
  await fails(async () => h2.identity.handle('passkey-register', { session: signedIn.session, ...fresh.create(await next(), { rp: 'evil.example' }) }), 'PASSKEY_INVALID');
  await fails(async () => h2.identity.handle('passkey-register', { session: signedIn.session, ...fresh.create(await next(), { flags: 0x41 }) }), 'PASSKEY_INVALID');
  assert.equal(h2.store.all('passkeys').length, 1);
});

test('passkeys: quitar un aparato, desactivar a la persona o recuperar la contraseña los borra', async () => {
  const { h, signedIn, device } = await enrolled();
  const maria = await h.activate('maria', ['inventario']);
  await fails(() => h.identity.handle('passkey-remove', { session: maria.session, credentialId: device.id }), 'VALIDATION');
  assert.deepEqual((await h.identity.handle('passkeys', { session: signedIn.session })).passkeys.map(p => p.id), [device.id]);
  assert.equal((await h.identity.handle('users', { session: signedIn.session })).users.find(u => u.username === 'dayana').passkeys, 1);
  assert.deepEqual((await h.identity.handle('passkey-remove', { session: signedIn.session, credentialId: device.id })).passkeys, []);
  await fails(() => login(h, device), 'PASSKEY_FAILED');

  const again = await enrolled();
  const mariaUser = (await again.h.activate('maria', ['inventario'])).user;
  const mariaDevice = authenticator(), mariaSession = (await again.h.identity.handle('login', { username: 'maria', password })).session;
  await again.h.identity.handle('passkey-register', { session: mariaSession, ...mariaDevice.create(await again.h.identity.handle('passkey-register-options', { session: mariaSession, password })) });
  await again.h.identity.handle('update-user', { userId: mariaUser.id, status: 'disabled' }, master);
  await fails(() => login(again.h, mariaDevice), 'PASSKEY_FAILED');
  await again.h.identity.handle('update-user', { userId: mariaUser.id, status: 'active' }, master);
  await fails(() => login(again.h, mariaDevice), 'PASSKEY_FAILED');
  assert.equal(again.h.store.all('passkeys').filter(p => p.user_id === mariaUser.id).length, 0);

  await again.h.identity.handle('recover', { identifier: 'dayana' }); await again.h.flush();
  await again.h.identity.handle('reset-password', { identifier: 'dayana', code: again.h.code(), password: 'Nueva-masa-de-galletas-2027!' });
  await fails(() => login(again.h, again.device), 'PASSKEY_FAILED');
});

test('webauthn: CBOR y firmas DER se leen de forma estricta', () => {
  assert.deepEqual(decodeCbor(cbor(new Map([[1, 2], [-1, 'a']]))).value, new Map([[1, 2], [-1, 'a']]));
  assert.throws(() => decodeCbor(Buffer.from([0x5f])), { code: 'PASSKEY_INVALID' });
  assert.throws(() => decodeCbor(Buffer.from([0x42, 1])), { code: 'PASSKEY_INVALID' });
  assert.throws(() => decodeCbor(Buffer.from([0xa2, 1, 1, 1, 2])), { code: 'PASSKEY_INVALID' });
  const r = Buffer.alloc(33, 1); r[0] = 0; const s = Buffer.from([7]);
  const raw = derToRaw(Buffer.concat([Buffer.from([0x30, 2 + r.length + 2 + s.length, 0x02, r.length]), r, Buffer.from([0x02, s.length]), s]));
  assert.equal(raw.length, 64); assert.equal(raw[0], 1); assert.equal(raw[63], 7);
  assert.throws(() => derToRaw(Buffer.from([0x30, 3, 2, 1, 1])), { code: 'PASSKEY_INVALID' });
});
