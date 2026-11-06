import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createPortalHandler } from '../src/portal-handler.mjs';
import { renderAdminPage } from '../src/admin-page.mjs';
import { staffHarness, staffEnv, signedProxy, password } from './staff-helpers.mjs';
// The real Celebraciones gateway and orders service, over a simulated Shopify (no network).
import { handleStaffGateway } from '../../celebraciones/src/staff-gateway.mjs';
import { createShopifyAdminTransport } from '../../celebraciones/src/shopify-payments.mjs';
import { createShopifyOrdersClient } from '../../celebraciones/src/orders-shopify.mjs';
import { createOrdersStore } from '../../celebraciones/src/orders-store.mjs';
import { createOrdersService } from '../../celebraciones/src/orders-service.mjs';
import { createFakeShopify } from '../../celebraciones/test/fake-shopify-orders.mjs';

const op = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function memorySql() {
  const db = new DatabaseSync(':memory:');
  return {
    all: (query, ...bindings) => db.prepare(query).all(...bindings),
    run: (query, ...bindings) => { if (bindings.length) db.prepare(query).run(...bindings); else db.exec(query); },
    transaction: fn => { db.exec('BEGIN'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } },
  };
}
async function setup({ stock = new Map([['gid://shopify/ProductVariant/506', 5], ['gid://shopify/ProductVariant/503', 4]]) } = {}) {
  const h = staffHarness();
  const fake = createFakeShopify();
  const transport = createShopifyAdminTransport({ shop: staffEnv.SHOPIFY_SHOP, clientId: 'client', secret: 'secret', fetchImpl: fake.fetch });
  const ordersService = createOrdersService({ client: createShopifyOrdersClient({ transport }), store: createOrdersStore(memorySql()) });
  const forwarded = [];
  const env = { ...staffEnv, CELEBRACIONES: { handle: async input => { forwarded.push(JSON.parse(JSON.stringify(input))); return handleStaffGateway(input, { config: { shop: staffEnv.SHOPIFY_SHOP }, ordersService }); } } };
  let stockReads = 0;
  const clientFactory = () => ({
    variantsWithStock: async () => [{ id: 'gid://shopify/ProductVariant/506', productTitle: 'Galletas', title: 'Snickerdoodle', priceCents: 1200, available: 5 }],
    variantStock: async ids => { stockReads++; return new Map(ids.map(id => [id, stock.get(id) || 0])); },
  });
  const handler = createPortalHandler({ env, identity: h.identity, offline: { get: async () => 'synthetic' }, clientFactory });
  const call = async (path, data) => { const response = await handler(new Request(signedProxy('/proxy/api/' + path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })); return { status: response.status, body: await response.json() }; };
  return { h, fake, forwarded, call, stockReads: () => stockReads };
}

test('Pedidos se ve con inventario o admin; celebraciones solo no lo ve ni lo puede pedir', async () => {
  const { h, call } = await setup();
  const admin = await h.activate('dayana', ['admin']);
  const kitchen = await h.activate('cocina', ['inventario']);
  const events = await h.activate('eventos', ['celebraciones']);
  assert.equal((await call('pedidos/orders', { session: events.session })).status, 403);
  assert.equal((await call('pedidos/orders/1042', { session: events.session })).status, 403);
  assert.equal((await call('pedidos/orders', {})).status, 401);
  const list = await call('pedidos/orders', { session: kitchen.session });
  assert.equal(list.status, 200);
  assert.ok(list.body.orders.length >= 3);
  assert.equal((await call('pedidos/orders', { session: admin.session })).status, 200);
  assert.equal((await call('pedidos/orders/1042/archive', { session: admin.session, body: {} })).status, 404);
  assert.equal((await call('pedidos/orders', { session: admin.session, actor: { roles: ['admin'], stepUp: true } })).status, 400);
  const html = await renderAdminPage(staffEnv, { portal: true }).text();
  assert.match(html, /<button id="pedidos" hidden>Pedidos<\/button>/);
  assert.match(html, /\/apps\/inventario\/assets\/orders-ui\.js/);
  assert.doesNotMatch(html, /<script>(?!<)/);
  assert.doesNotMatch(await renderAdminPage(staffEnv).text(), /orders-ui\.js|id="pedidos"/);
});

test('inventario ve, anota y despacha; las acciones de dinero responden 403 sin tocar Shopify ni la contraseña', async () => {
  const { h, call, fake, forwarded } = await setup();
  await h.activate('dayana', ['admin']);
  const kitchen = await h.activate('cocina', ['inventario']);
  assert.equal((await call('pedidos/orders/1043/note', { session: kitchen.session, body: { text: 'Pasa el sábado', version: 0 } })).status, 200);
  const shipped = await call('pedidos/orders/1042/fulfill', { session: kitchen.session, body: { operationId: op(1), trackingNumber: '9400100000000', carrier: 'USPS', notify: true } });
  assert.equal(shipped.status, 200);
  const before = forwarded.length;
  for (const action of ['cash', 'refund', 'edit', 'cancel', 'refund-preview']) {
    const response = await call(`pedidos/orders/1043/${action}`, { session: kitchen.session, password, body: { operationId: op(2) } });
    assert.deepEqual([response.status, response.body.code], [403, 'ROLE_REQUIRED'], action);
  }
  assert.equal((await call('pedidos/variants', { session: kitchen.session })).status, 403);
  assert.equal(forwarded.length, before);
  assert.equal(fake.moneyCalls, 0);
  assert.ok(forwarded.every(input => input.actor.aud === 'pedidos' && input.actor.stepUp === undefined));
});

test('admin sin contraseña o con contraseña equivocada: 401 sin llamar a Shopify y los fallos cuentan para el bloqueo del login', async () => {
  const { h, call, fake, forwarded } = await setup();
  const admin = await h.activate('dayana', ['admin', 'inventario']);
  const body = { operationId: op(10), expectedAmountCents: 3600 };
  const missing = await call('pedidos/orders/1043/cash', { session: admin.session, body });
  assert.deepEqual([missing.status, missing.body.code], [401, 'PASSWORD_REQUIRED']);
  for (let attempt = 0; attempt < 3; attempt++) {
    const wrong = await call('pedidos/orders/1043/cash', { session: admin.session, password: 'no-es-la-clave', body });
    assert.deepEqual([wrong.status, wrong.body.code], [401, 'PASSWORD_INVALID']);
  }
  assert.equal(forwarded.length, 0);
  assert.equal(fake.calls.length, 0);
  // 3 fallos de confirmación + 2 de login = 5: el acceso queda pausado 15 minutos.
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(h.identity.handle('login', { username: 'dayana', password: 'otra-mala' }), error => error.code === 'LOGIN_FAILED');
  await assert.rejects(h.identity.handle('login', { username: 'dayana', password }), error => error.code === 'LOGIN_FAILED');
  h.advance(15 * 60000 + 1);
  const fresh = await h.identity.handle('login', { username: 'dayana', password });
  assert.ok(fresh.session);
});

test('cinco contraseñas equivocadas en Pedidos pausan el acceso y cierran las sesiones', async () => {
  const { h, call, fake } = await setup();
  const admin = await h.activate('dayana', ['admin']);
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await call('pedidos/orders/1043/cash', { session: admin.session, password: 'mala', body: { operationId: op(20), expectedAmountCents: 3600 } })).status, 401);
  const after = await call('pedidos/orders', { session: admin.session });
  assert.deepEqual([after.status, after.body.code], [401, 'SESSION_REQUIRED']);
  await assert.rejects(h.identity.handle('login', { username: 'dayana', password }), error => error.code === 'LOGIN_FAILED');
  assert.equal(fake.calls.length, 0);
});

test('admin con contraseña correcta: se reenvía stepUp:true y nunca la contraseña; dinero exacto una sola vez', async () => {
  const { h, call, fake, forwarded } = await setup();
  const admin = await h.activate('dayana', ['admin']);
  const data = { session: admin.session, password, body: { operationId: op(30), expectedAmountCents: 3600 } };
  const [first, second] = await Promise.all([call('pedidos/orders/1043/cash', data), call('pedidos/orders/1043/cash', data)]);
  assert.deepEqual([first.status, second.status], [200, 200]);
  assert.equal(fake.count('PanelMarkAsPaid'), 1);
  assert.equal(forwarded.length, 2);
  for (const input of forwarded) {
    assert.equal(input.actor.stepUp, true);
    assert.equal(input.actor.aud, 'pedidos');
    assert.doesNotMatch(JSON.stringify(input), new RegExp(password));
    assert.equal(Object.hasOwn(input.body, 'password'), false);
  }
  assert.equal((await call('pedidos/orders/1043/cash', { ...data, body: { ...data.body, password } })).status, 400);
  const plain = await call('pedidos/orders/1043/note', { session: admin.session, password, body: { text: 'x', version: 0 } });
  assert.equal(plain.status, 200);
  assert.equal(forwarded.at(-1).actor.stepUp, undefined);
});

test('editar: solo variantes con stock; sin stock se rechaza en Inventario antes de Celebraciones', async () => {
  const { h, call, fake, forwarded, stockReads } = await setup({ stock: new Map([['gid://shopify/ProductVariant/506', 0], ['gid://shopify/ProductVariant/503', 4]]) });
  const admin = await h.activate('dayana', ['admin']);
  const variants = await call('pedidos/variants', { session: admin.session });
  assert.equal(variants.status, 200);
  assert.equal(variants.body.variants[0].available, 5);
  const noStock = await call('pedidos/orders/1043/edit', { session: admin.session, password, body: { operationId: op(40), changes: [], additions: [{ variantId: 'gid://shopify/ProductVariant/506', quantity: 1 }], notify: false } });
  assert.deepEqual([noStock.status, noStock.body.code], [409, 'NO_STOCK']);
  const unknown = await call('pedidos/orders/1043/edit', { session: admin.session, password, body: { operationId: op(41), changes: [{ lineItemId: 'gid://shopify/LineItem/22', variantId: null, fromQuantity: 1, quantity: 2 }], additions: [], notify: false } });
  assert.equal(unknown.body.code, 'NO_STOCK');
  assert.equal(forwarded.length, 0);
  const ok = await call('pedidos/orders/1043/edit', { session: admin.session, password, body: { operationId: op(42), changes: [{ lineItemId: 'gid://shopify/LineItem/22', variantId: 'gid://shopify/ProductVariant/503', fromQuantity: 1, quantity: 2 }], additions: [], notify: true } });
  assert.equal(ok.status, 200);
  assert.equal(fake.count('PanelEditCommit'), 1);
  assert.ok(stockReads() >= 2);
});

test('respuesta perdida a través del portal: el reintento con la misma clave concilia sin repetir el cobro', async () => {
  const { h, call, fake } = await setup();
  const admin = await h.activate('dayana', ['admin']);
  fake.next('PanelMarkAsPaid', 'lost');
  const data = { session: admin.session, password, body: { operationId: op(50), expectedAmountCents: 3600 } };
  const lost = await call('pedidos/orders/1043/cash', data);
  assert.deepEqual([lost.status, lost.body.state, lost.body.retryable], [502, 'uncertain', true]);
  const retry = await call('pedidos/orders/1043/cash', data);
  assert.deepEqual([retry.status, retry.body.reconciled], [200, true]);
  assert.equal(fake.count('PanelMarkAsPaid'), 1);
  const reused = await call('pedidos/orders/1043/cash', { ...data, body: { ...data.body, expectedAmountCents: 100 } });
  assert.deepEqual([reused.status, reused.body.code], [409, 'OPERATION_REUSED']);
  assert.equal(fake.moneyCalls, 1);
});
