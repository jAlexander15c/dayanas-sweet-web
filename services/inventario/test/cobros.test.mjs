import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createPortalHandler } from '../src/portal-handler.mjs';
import { staffHarness, staffEnv, signedProxy, password } from './staff-helpers.mjs';
// El gateway y el servicio reales de Celebraciones, sobre un Shopify simulado (sin red).
import { handleStaffGateway } from '../../celebraciones/src/staff-gateway.mjs';
import { createShopifyAdminTransport } from '../../celebraciones/src/shopify-payments.mjs';
import { createShopifyOrdersClient } from '../../celebraciones/src/orders-shopify.mjs';
import { createOrdersStore } from '../../celebraciones/src/orders-store.mjs';
import { createOrdersService } from '../../celebraciones/src/orders-service.mjs';
import { createChargesService } from '../../celebraciones/src/charges-service.mjs';
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
async function setup() {
  const h = staffHarness();
  const fake = createFakeShopify();
  const transport = createShopifyAdminTransport({ shop: staffEnv.SHOPIFY_SHOP, clientId: 'client', secret: 'secret', fetchImpl: fake.fetch });
  const client = createShopifyOrdersClient({ transport }), store = createOrdersStore(memorySql());
  const options = { config: { shop: staffEnv.SHOPIFY_SHOP }, ordersService: createOrdersService({ client, store }), chargesService: createChargesService({ client, store }) };
  const forwarded = [];
  const env = { ...staffEnv, CELEBRACIONES: { handle: async input => { forwarded.push(JSON.parse(JSON.stringify(input))); return handleStaffGateway(input, options); } } };
  const handler = createPortalHandler({ env, identity: h.identity, offline: { get: async () => 'synthetic' }, clientFactory: () => ({}) });
  const call = async (path, data) => { const response = await handler(new Request(signedProxy('/proxy/api/' + path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })); return { status: response.status, body: await response.json() }; };
  return { h, fake, forwarded, call };
}
const cobro = n => ({ operationId: op(n), kind: 'cobro', name: 'Mariela Vera', email: 'mariela@ejemplo.com', lines: [{ title: 'Caja personalizada', cents: 4000 }] });

test('Cobros: solo la administradora ve la lista; inventario y celebraciones reciben 403 sin llegar a Celebraciones', async () => {
  const { h, call, forwarded } = await setup();
  const admin = await h.activate('dayana', ['admin']);
  const kitchen = await h.activate('cocina', ['inventario']);
  const events = await h.activate('eventos', ['celebraciones']);
  const list = await call('pedidos/charges', { session: admin.session });
  assert.deepEqual([list.status, list.body.charges], [200, []]);
  assert.equal(forwarded[0].path, '/orders/charges');
  assert.equal(forwarded[0].actor.stepUp, undefined);
  for (const who of [kitchen, events]) {
    assert.equal((await call('pedidos/charges', { session: who.session })).status, 403);
    assert.equal((await call('pedidos/charges/create', { session: who.session, password, body: cobro(1) })).status, 403);
  }
  assert.equal(forwarded.length, 1);
});

test('Cobros: crear y anular piden la contraseña; nunca se reenvía y una equivocada no llega a Shopify', async () => {
  const { h, call, fake, forwarded } = await setup();
  const admin = await h.activate('dayana', ['admin']);
  const missing = await call('pedidos/charges/create', { session: admin.session, body: cobro(2) });
  assert.deepEqual([missing.status, missing.body.code], [401, 'PASSWORD_REQUIRED']);
  const wrong = await call('pedidos/charges/create', { session: admin.session, password: 'no-es-la-clave', body: cobro(2) });
  assert.deepEqual([wrong.status, wrong.body.code], [401, 'PASSWORD_INVALID']);
  assert.equal(fake.calls.length, 0);
  const created = await call('pedidos/charges/create', { session: admin.session, password, body: cobro(2) });
  assert.deepEqual([created.status, created.body.charge.status, created.body.charge.totalCents], [200, 'enviado', 4000]);
  const again = await call('pedidos/charges/create', { session: admin.session, password, body: cobro(2) });
  assert.deepEqual(again.body.charge, created.body.charge);
  assert.equal(fake.count('PanelChargeCreate'), 1);
  const voided = await call(`pedidos/charges/${created.body.charge.id}/void`, { session: admin.session, password, body: { operationId: op(3) } });
  assert.deepEqual([voided.status, voided.body.voided], [200, created.body.charge.id]);
  for (const input of forwarded.filter(item => item.method === 'POST')) {
    assert.equal(input.actor.stepUp, true);
    assert.doesNotMatch(JSON.stringify(input), new RegExp(password));
  }
  assert.equal((await call('pedidos/charges/create', { session: admin.session, password, body: { ...cobro(4), password } })).status, 400);
  assert.equal((await call('pedidos/charges/12/delete', { session: admin.session, password, body: { operationId: op(5) } })).status, 404);
});
