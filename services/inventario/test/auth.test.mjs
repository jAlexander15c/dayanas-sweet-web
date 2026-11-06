import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, jwt } from './helpers.mjs';
for (const [label, token] of [
  ['firma incorrecta', () => jwt({}, 'wrong')], ['expirado', () => jwt({ exp: Math.floor(Date.now() / 1000) - 20 })],
  ['otra tienda', () => jwt({ dest: 'https://otra.myshopify.com' })], ['otra audiencia', () => jwt({ aud: 'other-app' })],
  ['emisor incorrecto', () => jwt({ iss: 'https://otra.myshopify.com/admin' })], ['todavía no válido', () => jwt({ nbf: Math.floor(Date.now() / 1000) + 60 })],
  ['algoritmo incorrecto', () => jwt({}, undefined, { alg: 'none' })], ['malformado', () => 'abc.def.ghi'],
]) test(`rechaza token ${label} sin llamar Shopify`, async () => { const h = harness(); const r = await h.call('/api/products', null, token()); assert.equal(r.status, 401); assert.equal(h.mock.state.calls.length, 0); h.db.close(); });
test('staff no autorizado y lista vacía deniegan todo', async () => {
  for (const [env, token] of [[{}, jwt({ sub: '999' })], [{ INVENTARIO_STAFF_IDS: '' }, jwt()]]) { const h = harness(env); assert.equal((await h.call('/api/products', null, token)).status, 403); h.db.close(); }
});
test('session devuelve identidad y comprobación de permisos sin credenciales', async () => { const h = harness(); const r = await h.call('/api/session'); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { staffId: '123', staffName: 'Pastelera de prueba', missingScopes: [], warning: '' }); h.db.close(); });
test('deshabilitado por defecto; rutas desconocidas también exigen autenticación', async () => {
  const h = harness({ SERVICE_ENABLED: 'false' }); assert.equal((await h.call('/api/products')).status, 503); assert.equal((await h.call('/api/unknown', null, 'wrong')).status, 401); assert.equal(h.mock.state.calls.length, 0); h.db.close();
});
