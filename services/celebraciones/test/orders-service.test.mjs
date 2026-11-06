import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createShopifyAdminTransport } from '../src/shopify-payments.mjs';
import { createShopifyOrdersClient } from '../src/orders-shopify.mjs';
import { createOrdersStore } from '../src/orders-store.mjs';
import { createOrdersService, MESSAGES } from '../src/orders-service.mjs';
import { handleStaffGateway, portalOrdersActor, trustedPortalActor } from '../src/staff-gateway.mjs';
import { cancellableOrder, createFakeShopify } from './fake-shopify-orders.mjs';

const SHOP = 'dayanas-test.myshopify.com';
const USER = '11111111-2222-4333-8444-555555555555';
const actor = (roles, extra = {}) => ({ shop: SHOP, aud: 'pedidos', userId: USER, name: 'Dayana', roles, sessionVersion: 1, ...extra });
const ADMIN = actor(['admin'], { stepUp: true });
const INVENTARIO = actor(['inventario']);
const op = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function memorySql() {
  const db = new DatabaseSync(':memory:');
  return {
    all: (query, ...bindings) => db.prepare(query).all(...bindings),
    run: (query, ...bindings) => { if (bindings.length) db.prepare(query).run(...bindings); else db.exec(query); },
    transaction: fn => { db.exec('BEGIN'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } },
  };
}
function setup(options) {
  const fake = createFakeShopify(options);
  const transport = createShopifyAdminTransport({ shop: SHOP, clientId: 'client', secret: 'secret', fetchImpl: fake.fetch, timeoutMs: 2000 });
  const store = createOrdersStore(memorySql());
  let clock = Date.parse('2026-11-06T15:20:00Z');
  const service = createOrdersService({ client: createShopifyOrdersClient({ transport }), store, now: () => clock });
  const call = (method, path, body, who = ADMIN) => handleStaffGateway({ actor: who, method, path, body }, { config: { shop: SHOP }, ordersService: service });
  return { fake, store, call, advance: ms => { clock += ms; } };
}
// Inventario sets stockVerified only after checking stock itself, when Celebraciones asks for it.
const STOCKED = { ...ADMIN, stockVerified: true };
const mutations = fake => fake.calls.filter(name => /^Panel(MarkAsPaid|Refund|Cancel|Fulfill|Ready|Edit)/.test(name)).length;

test('list groups open orders, sums the bake list and excludes Celebraciones and shipped orders', async () => {
  const { call } = setup();
  const { status, body } = await call('GET', '/orders', undefined, INVENTARIO);
  assert.equal(status, 200);
  assert.deepEqual(body.counts, { preparar: 3, listo: 1, entregado: 0 });
  const byName = Object.fromEntries(body.orders.map(order => [order.name, order]));
  assert.equal(byName['#1042'].delivery, 'shipping');
  assert.equal(byName['#1043'].delivery, 'pickup');
  assert.equal(byName['#1043'].outstandingCents, 3600);
  assert.equal(byName['#1045'].stage, 'listo');
  assert.equal(byName['#1044'].celebraciones, true);
  assert.equal(byName['#1042'].customer, 'Ana R.');
  assert.equal(body.bake.orders, 2);
  assert.deepEqual(body.bake.products, [{ title: 'Galletas surtidas', quantity: 3 }, { title: 'Brownie Box', quantity: 1 }, { title: 'Galletas de avena', quantity: 1 }]);
});

test('detail shows customer, totals, balance, timeline and internal note with version control', async () => {
  const { call } = setup();
  const detail = await call('GET', '/orders/1043', undefined, INVENTARIO);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.customer.name, 'Beatriz Luna');
  assert.equal(detail.body.outstandingCents, 3600);
  assert.equal(detail.body.lines[0].variantId, 'gid://shopify/ProductVariant/501');
  assert.ok(detail.body.timeline.some(event => event.title === 'Pedido recibido en la tienda'));
  assert.ok(detail.body.timeline.some(event => event.title === 'Pago: efectivo al retirar'));
  assert.deepEqual(detail.body.note, { text: '', version: 0, staffName: null, updatedAt: null });
  const saved = await call('POST', '/orders/1043/note', { text: ' Viene su hermana ', version: 0 }, INVENTARIO);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.note.text, 'Viene su hermana');
  assert.equal(saved.body.note.version, 1);
  const stale = await call('POST', '/orders/1043/note', { text: 'Otra', version: 0 }, INVENTARIO);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'NOTE_CONFLICT');
  assert.equal(stale.body.note.text, 'Viene su hermana');
  assert.equal((await call('POST', '/orders/1043/note', { text: 'x'.repeat(2001), version: 1 }, INVENTARIO)).status, 422);
});

test('roles: inventario ships and notes but money is 403 without any Shopify call; audiences never mix', async () => {
  const { call, fake } = setup();
  const before = fake.calls.length;
  for (const [path, body] of [['cash', { operationId: op(1), expectedAmountCents: 3600 }], ['refund-preview', { lines: [] , refundShipping: false }], ['cancel', { operationId: op(2), reason: 'CUSTOMER', refund: false, restock: true, notify: false }]]) {
    const response = await call('POST', `/orders/1043/${path}`, body, INVENTARIO);
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'ROLE_REQUIRED');
  }
  const noStepUp = await call('POST', '/orders/1043/cash', { operationId: op(3), expectedAmountCents: 3600 }, actor(['admin']));
  assert.deepEqual([noStepUp.status, noStepUp.body.code], [403, 'STEP_UP_REQUIRED']);
  assert.equal(fake.calls.length, before);
  assert.equal((await call('GET', '/orders', undefined, actor(['celebraciones']))).status, 401);
  assert.equal((await call('GET', '/orders', undefined, { ...INVENTARIO, aud: 'celebraciones' })).status, 401);
  assert.equal((await call('GET', '/orders', undefined, { ...ADMIN, password: 'x' })).status, 401);
  assert.equal((await call('GET', '/orders', undefined, { ...ADMIN, stepUp: 'yes' })).status, 401);
  assert.equal((await call('POST', '/orders/1043/cash', { operationId: op(4), expectedAmountCents: 3600, password: 'x' })).status, 422);
  assert.equal((await call('GET', '/requests', undefined, ADMIN)).status, 401);
  assert.equal((await call('DELETE', '/orders/1043', undefined, ADMIN)).status, 404);
  assert.equal((await call('POST', '/orders/1043/archive', { operationId: op(5) })).status, 404);
  assert.throws(() => trustedPortalActor({ path: '/orders', actor: { ...ADMIN, aud: 'celebraciones' } }, SHOP));
  assert.equal(portalOrdersActor(INVENTARIO, SHOP).stepUp, false);
  assert.equal(fake.calls.length, before);
});

test('cash uses the balance Shopify reports and rejects a changed amount without calling Shopify money APIs', async () => {
  const { call, fake } = setup();
  const changed = await call('POST', '/orders/1043/cash', { operationId: op(10), expectedAmountCents: 3500 });
  assert.deepEqual([changed.status, changed.body.code, changed.body.currentCents], [409, 'AMOUNT_CHANGED', 3600]);
  assert.equal(fake.moneyCalls, 0);
  const paid = await call('POST', '/orders/1043/cash', { operationId: op(11), expectedAmountCents: 3600 });
  assert.equal(paid.status, 200);
  assert.equal(fake.order(1043).totalOutstandingSet.shopMoney.amount, '0.00');
  const detail = await call('GET', '/orders/1043');
  const entry = detail.body.timeline.find(event => event.panel);
  assert.deepEqual([entry.title, entry.by, entry.amountCents, entry.state], ['Cobró en efectivo $36.00', 'Dayana', 3600, 'ok']);
  const nothing = await call('POST', '/orders/1043/cash', { operationId: op(12), expectedAmountCents: 3600 });
  assert.equal(nothing.body.code, 'NOTHING_DUE');
});

test('idempotency: a double tap produces exactly one Shopify money call and one record', async () => {
  const { call, fake, store } = setup();
  const body = { operationId: op(20), expectedAmountCents: 3600 };
  const [first, second] = await Promise.all([call('POST', '/orders/1043/cash', body), call('POST', '/orders/1043/cash', body)]);
  assert.deepEqual([first.status, second.status], [200, 200]);
  assert.deepEqual(first, second);
  assert.equal(fake.count('PanelMarkAsPaid'), 1);
  assert.equal(fake.moneyCalls, 1);
  assert.equal(store.history('1043').length, 1);
});

test('idempotency: lost response after Shopify applied cash is reconciled by reading, never resent', async () => {
  const { call, fake, store } = setup();
  fake.next('PanelMarkAsPaid', 'lost');
  const body = { operationId: op(30), expectedAmountCents: 3600 };
  const lost = await call('POST', '/orders/1043/cash', body);
  assert.deepEqual([lost.status, lost.body.code, lost.body.state, lost.body.retryable], [502, 'REVIEW_REQUIRED', 'uncertain', true]);
  assert.equal(fake.moneyCalls, 1, 'the first attempt reached Shopify');
  assert.equal(store.getOperation(op(30)).state, 'pending');
  const retry = await call('POST', '/orders/1043/cash', body);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.reconciled, true);
  assert.equal(fake.count('PanelMarkAsPaid'), 1);
  assert.equal(fake.moneyCalls, 1);
  assert.equal(store.history('1043').length, 1);
  assert.deepEqual(await call('POST', '/orders/1043/cash', body), retry);
});

test('idempotency: same operation id with different content is 409 without another Shopify call', async () => {
  const { call, fake, store } = setup();
  assert.equal((await call('POST', '/orders/1043/cash', { operationId: op(40), expectedAmountCents: 3600 })).status, 200);
  const reused = await call('POST', '/orders/1043/cash', { operationId: op(40), expectedAmountCents: 3700 });
  assert.deepEqual([reused.status, reused.body.code], [409, 'OPERATION_REUSED']);
  const otherOrder = await call('POST', '/orders/1042/refund', { operationId: op(40), lines: [], restock: false, refundShipping: false, extraCents: 100, reason: 'other', notify: false, expectedTotalCents: 100 });
  assert.equal(otherOrder.status, 409);
  assert.equal(fake.moneyCalls, 1);
  assert.equal(store.history('1043').length, 1);
  assert.equal(store.history('1042').length, 0);
});

test('Celebraciones orders reject every money action but allow viewing, note and pickup steps', async () => {
  const { call, fake } = setup();
  const bodies = {
    cash: { operationId: op(50), expectedAmountCents: 15000 },
    refund: { operationId: op(51), lines: [{ lineItemId: 'gid://shopify/LineItem/31', quantity: 1 }], restock: false, refundShipping: false, extraCents: 0, reason: 'other', notify: false, expectedTotalCents: 15000 },
    edit: { operationId: op(52), changes: [{ lineItemId: 'gid://shopify/LineItem/31', variantId: null, fromQuantity: 1, quantity: 0 }], additions: [], notify: false },
    cancel: { operationId: op(53), reason: 'CUSTOMER', refund: false, restock: false, notify: false },
  };
  for (const [action, body] of Object.entries(bodies)) {
    const response = await call('POST', `/orders/1044/${action}`, body);
    assert.deepEqual([response.status, response.body.code, response.body.message], [409, 'CELEBRACIONES_ORDER', MESSAGES.celebraciones], action);
  }
  assert.equal(mutations(fake), 0);
  assert.equal((await call('POST', '/orders/1044/ready', { operationId: op(54) }, INVENTARIO)).status, 200);
  assert.equal((await call('POST', '/orders/1044/note', { text: 'Torta en la nevera', version: 0 }, INVENTARIO)).status, 200);
});

test('refund: Shopify computes the amount, the cap is what is refundable and a lost response is reconciled', async () => {
  const { call, fake, store } = setup();
  const lines = [{ lineItemId: 'gid://shopify/LineItem/11', quantity: 1 }];
  const preview = await call('POST', '/orders/1042/refund-preview', { lines, refundShipping: false, extraCents: 500 });
  assert.equal(preview.status, 200);
  assert.deepEqual([preview.body.amountCents, preview.body.totalCents, preview.body.maximumCents, preview.body.overLimit], [2400, 2900, 8500, false]);
  const over = await call('POST', '/orders/1042/refund', { operationId: op(60), lines, restock: false, refundShipping: false, extraCents: 9000, reason: 'damaged', notify: false, expectedTotalCents: 11400 });
  assert.deepEqual([over.status, over.body.code, over.body.maximumCents], [422, 'REFUND_LIMIT', 8500]);
  const tooMany = await call('POST', '/orders/1042/refund', { operationId: op(61), lines: [{ lineItemId: 'gid://shopify/LineItem/11', quantity: 3 }], restock: false, refundShipping: false, extraCents: 0, reason: 'damaged', notify: false, expectedTotalCents: 7200 });
  assert.equal(tooMany.status, 422);
  assert.equal(fake.count('PanelRefund'), 0);
  fake.next('PanelRefund', 'lost');
  const body = { operationId: op(62), lines, restock: true, refundShipping: false, extraCents: 500, reason: 'damaged', notify: true, expectedTotalCents: 2900 };
  const lost = await call('POST', '/orders/1042/refund', body);
  assert.equal(lost.body.state, 'uncertain');
  const retry = await call('POST', '/orders/1042/refund', body);
  assert.deepEqual([retry.status, retry.body.reconciled], [200, true]);
  assert.equal(fake.count('PanelRefund'), 1);
  assert.equal(fake.moneyCalls, 1);
  const raw = fake.raw(1042);
  assert.equal(raw.refunds.length, 1);
  assert.equal(raw.refundedCents, 2900);
  assert.match(raw.refunds[0].note, /^Llegó dañado \(panel 00000000\)$/);
  assert.equal(store.getOperation(op(62)).amountCents, 2900);
});

test('refund sent before Shopify answered (network down) is resent with the same idempotency key once', async () => {
  const { call, fake } = setup();
  fake.next('PanelRefund', 'down');
  const body = { operationId: op(70), lines: [], restock: false, refundShipping: true, extraCents: 0, reason: 'customer', notify: false, expectedTotalCents: 900 };
  assert.equal((await call('POST', '/orders/1042/refund', body)).status, 502);
  assert.equal(fake.moneyCalls, 0);
  assert.equal((await call('POST', '/orders/1042/refund', body)).status, 200);
  assert.equal(fake.moneyCalls, 1);
  assert.equal(fake.raw(1042).refundedCents, 900);
});

test('cancel: a shipped order is rejected with the refund advice; an open order is cancelled once', async () => {
  const { call, fake } = setup();
  const shipped = await call('POST', '/orders/1045/cancel', { operationId: op(80), reason: 'CUSTOMER', refund: true, restock: true, notify: true });
  assert.deepEqual([shipped.status, shipped.body.code, shipped.body.message], [409, 'ORDER_SHIPPED', MESSAGES.shipped]);
  assert.equal(fake.count('PanelCancel'), 0);
  const body = { operationId: op(81), reason: 'INVENTORY', refund: true, restock: true, notify: true };
  fake.next('PanelCancel', 'lost');
  assert.equal((await call('POST', '/orders/1042/cancel', body)).body.state, 'uncertain');
  // The job is still running and its id was lost: the retry must not resend orderCancel.
  const early = await call('POST', '/orders/1042/cancel', body);
  assert.deepEqual([early.status, early.body.state, early.body.retryable], [202, 'processing', true]);
  assert.equal(fake.count('PanelCancel'), 1);
  fake.runJobs();
  const retry = await call('POST', '/orders/1042/cancel', body);
  assert.deepEqual([retry.status, retry.body.reconciled], [200, true]);
  assert.equal(fake.count('PanelCancel'), 1);
  const raw = fake.raw(1042);
  assert.ok(raw.cancelledAt);
  assert.equal(raw.refundedCents, raw.receivedCents);
  assert.deepEqual(raw.cancelInput.refundMethod, { originalPaymentMethodsRefund: true });
  assert.equal(raw.cancelInput.restock, true);
  assert.equal(raw.cancelInput.notifyCustomer, true);
  const list = await call('GET', '/orders');
  assert.ok(!list.body.orders.some(order => order.name === '#1042'));
});

test('cancel is asynchronous: a pending job keeps the operation pending, is polled by id and never resent', async () => {
  const { call, fake, store } = setup({ orders: [cancellableOrder()] });
  const body = { operationId: op(82), reason: 'CUSTOMER', refund: true, restock: true, notify: false };
  const first = await call('POST', '/orders/1046/cancel', body);
  assert.deepEqual([first.status, first.body.state, first.body.code], [202, 'processing', 'PROCESSING']);
  assert.equal(fake.raw(1046).cancelledAt, null);
  assert.equal(store.getOperation(op(82)).state, 'pending');
  assert.match(store.getOperation(op(82)).progress.jobId, /^gid:\/\/shopify\/Job\//);
  const detail = await call('GET', '/orders/1046');
  assert.deepEqual([detail.body.cancelPending, detail.body.canCancel, detail.body.cancelled], [true, false, false]);
  const again = await call('POST', '/orders/1046/cancel', body);
  assert.deepEqual([again.status, again.body.state], [202, 'processing']);
  assert.equal(fake.count('PanelCancel'), 1);
  assert.ok(fake.count('PanelJob') >= 2);
  fake.runJobs();
  // Reading the detail settles the job: the cancellation is confirmed by the job and by cancelledAt.
  const settled = await call('GET', '/orders/1046');
  assert.deepEqual([settled.body.cancelled, settled.body.cancelPending], [true, false]);
  assert.equal(store.getOperation(op(82)).state, 'succeeded');
  assert.equal(settled.body.timeline.find(event => event.panel).state, 'ok');
  const replay = await call('POST', '/orders/1046/cancel', body);
  assert.deepEqual([replay.status, replay.body.ok], [200, true]);
  assert.equal(fake.count('PanelCancel'), 1);
  assert.equal(fake.moneyCalls, 1);
});

test('cancel: the job is read before the order, so a job that finishes during the retry is confirmed, not failed', async () => {
  // jobPolls: 1 -> the job finishes exactly when the panel asks for it, after any earlier read of the order.
  const { call, fake, store } = setup({ orders: [cancellableOrder()], jobPolls: 1 });
  const body = { operationId: op(86), reason: 'CUSTOMER', refund: true, restock: true, notify: false };
  assert.equal((await call('POST', '/orders/1046/cancel', body)).status, 202);
  const retry = await call('POST', '/orders/1046/cancel', body);
  assert.deepEqual([retry.status, retry.body.reconciled, retry.body.warning], [200, true, undefined]);
  assert.equal(store.getOperation(op(86)).state, 'succeeded');
  const other = setup({ orders: [cancellableOrder()], jobPolls: 1 });
  assert.equal((await other.call('POST', '/orders/1046/cancel', { ...body, operationId: op(87) })).status, 202);
  const detail = await other.call('GET', '/orders/1046');
  assert.deepEqual([detail.body.cancelled, detail.body.cancelPending], [true, false]);
  assert.equal(other.store.getOperation(op(87)).state, 'succeeded');
  assert.equal(fake.count('PanelCancel') + other.fake.count('PanelCancel'), 2);
});

test('cancel: a job that finishes without cancelling is failed with a clear message and not resent', async () => {
  const { call, fake, store } = setup({ orders: [cancellableOrder()] });
  const body = { operationId: op(83), reason: 'OTHER', refund: false, restock: true, notify: false };
  assert.equal((await call('POST', '/orders/1046/cancel', body)).status, 202);
  fake.runJobs({ cancel: false });
  const result = await call('POST', '/orders/1046/cancel', body);
  assert.deepEqual([result.status, result.body.code], [409, 'CANCEL_FAILED']);
  assert.match(result.body.message, /Revisa el pedido en Shopify antes de repetir/);
  assert.equal(store.getOperation(op(83)).state, 'failed');
  assert.equal((await call('POST', '/orders/1046/cancel', body)).body.code, 'CANCEL_FAILED');
  assert.equal(fake.count('PanelCancel'), 1);
});

test('cancel: cancelled but the refund is not shown yet is reported, never assumed', async () => {
  const { call, fake } = setup({ orders: [cancellableOrder()] });
  const body = { operationId: op(84), reason: 'CUSTOMER', refund: true, restock: true, notify: false };
  assert.equal((await call('POST', '/orders/1046/cancel', body)).status, 202);
  fake.runJobs({ refund: false });
  const result = await call('POST', '/orders/1046/cancel', body);
  assert.equal(result.status, 200);
  assert.equal(result.body.warning, MESSAGES.cancelRefund);
  assert.equal(fake.count('PanelCancel'), 1);
});

test('cancel: time never allows resending a cancellation whose job id was lost (lost or down)', async () => {
  for (const mode of ['lost', 'down']) {
    const { call, fake, advance, store } = setup({ orders: [cancellableOrder()] });
    const body = { operationId: op(85), reason: 'CUSTOMER', refund: false, restock: true, notify: false };
    fake.next('PanelCancel', mode);
    assert.equal((await call('POST', '/orders/1046/cancel', body)).body.state, 'uncertain', mode);
    advance(3 * 60_000); // more than the old 2-minute threshold, the job (if any) still pending
    const later = await call('POST', '/orders/1046/cancel', body);
    assert.deepEqual([later.status, later.body.state, later.body.final], [202, 'processing', undefined], mode);
    advance(6 * 60_000);
    assert.equal((await call('POST', '/orders/1046/cancel', body)).status, 202, mode);
    assert.equal(fake.count('PanelCancel'), 1, mode);
    assert.equal(store.getOperation(op(85)).state, 'pending', mode);
  }
});

test('cancel: an unknown job still not cancelled after 10 minutes is closed as REVIEW_REQUIRED, with no second mutation', async () => {
  const { call, fake, advance, store } = setup({ orders: [cancellableOrder()] });
  const body = { operationId: op(88), reason: 'CUSTOMER', refund: true, restock: true, notify: false };
  fake.next('PanelCancel', 'lost');
  assert.equal((await call('POST', '/orders/1046/cancel', body)).body.state, 'uncertain');
  advance(10 * 60_000 + 1);
  const closed = await call('POST', '/orders/1046/cancel', body);
  assert.deepEqual([closed.status, closed.body.code, closed.body.message, closed.body.final], [409, 'REVIEW_REQUIRED', MESSAGES.cancelUnknown, true]);
  assert.equal(MESSAGES.cancelUnknown, 'No pudimos confirmar la cancelación. Revisa el pedido en Shopify antes de intentarlo de nuevo.');
  assert.equal(store.getOperation(op(88)).state, 'failed');
  assert.deepEqual((await call('POST', '/orders/1046/cancel', body)).body.code, 'REVIEW_REQUIRED');
  assert.equal(fake.count('PanelCancel'), 1);
  // Reading the detail closes it too, without any mutation.
  const other = setup({ orders: [cancellableOrder()] });
  other.fake.next('PanelCancel', 'lost');
  await other.call('POST', '/orders/1046/cancel', { ...body, operationId: op(89) });
  assert.equal((await other.call('GET', '/orders/1046')).body.cancelPending, true);
  other.advance(10 * 60_000 + 1);
  const detail = await other.call('GET', '/orders/1046');
  assert.deepEqual([detail.body.cancelPending, detail.body.canCancel], [false, true]);
  assert.equal(other.store.getOperation(op(89)).state, 'failed');
  assert.equal(other.fake.count('PanelCancel'), 1);
});

test('definitive answers are marked final; pending ones are not', async () => {
  const { call, fake } = setup({ orders: [cancellableOrder()] });
  const rejected = await call('POST', '/orders/1046/cash', { operationId: op(110), expectedAmountCents: 100 });
  assert.deepEqual([rejected.status, rejected.body.final], [409, true]);
  fake.next('PanelCancel', 'lost');
  const lost = await call('POST', '/orders/1046/cancel', { operationId: op(111), reason: 'CUSTOMER', refund: false, restock: true, notify: false });
  assert.deepEqual([lost.status, lost.body.state, lost.body.final], [502, 'uncertain', undefined]);
});

test('edit: changes and additions commit once; lost commit is reconciled; stale quantities are rejected', async () => {
  const { call, fake } = setup();
  const stale = await call('POST', '/orders/1043/edit', { operationId: op(90), changes: [{ lineItemId: 'gid://shopify/LineItem/22', variantId: 'gid://shopify/ProductVariant/503', fromQuantity: 2, quantity: 3 }], additions: [], notify: false }, STOCKED);
  assert.deepEqual([stale.status, stale.body.code], [409, 'ORDER_CHANGED']);
  const wrongVariant = await call('POST', '/orders/1043/edit', { operationId: op(91), changes: [{ lineItemId: 'gid://shopify/LineItem/22', variantId: 'gid://shopify/ProductVariant/999', fromQuantity: 1, quantity: 2 }], additions: [], notify: false }, STOCKED);
  assert.equal(wrongVariant.status, 409);
  fake.next('PanelEditCommit', 'lost');
  const body = { operationId: op(92), changes: [{ lineItemId: 'gid://shopify/LineItem/22', variantId: 'gid://shopify/ProductVariant/503', fromQuantity: 1, quantity: 2 }], additions: [{ variantId: 'gid://shopify/ProductVariant/506', quantity: 1 }], notify: true };
  assert.equal((await call('POST', '/orders/1043/edit', body, STOCKED)).body.state, 'uncertain');
  const retry = await call('POST', '/orders/1043/edit', body, STOCKED);
  assert.deepEqual([retry.status, retry.body.reconciled], [200, true]);
  assert.equal(fake.count('PanelEditCommit'), 1);
  const raw = fake.raw(1043);
  assert.equal(raw.lines.find(line => line.id === '22').current, 2);
  assert.equal(raw.lines.length, 3);
  assert.equal(raw.lastEditNotify, true);
  const shipped = await call('POST', '/orders/1045/edit', { operationId: op(93), changes: [{ lineItemId: 'gid://shopify/LineItem/41', variantId: null, fromQuantity: 2, quantity: 1 }], additions: [], notify: false });
  assert.equal(shipped.status, 422);
});

const EDIT_LOST = { operationId: op(94), changes: [{ lineItemId: 'gid://shopify/LineItem/22', variantId: 'gid://shopify/ProductVariant/503', fromQuantity: 1, quantity: 2 }], additions: [{ variantId: 'gid://shopify/ProductVariant/506', quantity: 2 }], notify: false };
async function lostEdit(tamper) {
  const ctx = setup();
  ctx.fake.next('PanelEditCommit', 'lost');
  assert.equal((await ctx.call('POST', '/orders/1043/edit', EDIT_LOST, STOCKED)).body.state, 'uncertain');
  tamper?.(ctx.fake.raw(1043));
  return { ...ctx, retry: await ctx.call('POST', '/orders/1043/edit', EDIT_LOST, STOCKED) };
}
test('edit reconciliation: every change and addition of the stored plan must match the order', async () => {
  const exact = await lostEdit();
  assert.deepEqual([exact.retry.status, exact.retry.body.reconciled], [200, true]);
  for (const [name, tamper] of [
    ['added line has another variant', raw => { raw.lines.at(-1).variantId = 'gid://shopify/ProductVariant/999'; }],
    ['added line has another quantity', raw => { raw.lines.at(-1).current = 1; }],
    ['changed line ended elsewhere', raw => { raw.lines.find(line => line.id === '22').current = 3; }],
    ['an untouched line changed too', raw => { raw.lines.find(line => line.id === '21').current = 0; }],
    ['a foreign line appeared', raw => { raw.lines.push({ ...raw.lines.at(-1), id: '7777', variantId: 'gid://shopify/ProductVariant/501', current: 1 }); }],
  ]) {
    const { retry, fake, store } = await lostEdit(tamper);
    assert.deepEqual([retry.status, retry.body.code], [409, 'REVIEW_REQUIRED'], name);
    assert.match(retry.body.message, /Revisa el pedido en Shopify antes de repetir/, name);
    assert.equal(store.getOperation(op(94)).state, 'failed', name);
    assert.equal(fake.count('PanelEditCommit'), 1, name);
  }
});

test('edit reconciliation: nothing applied is retried; a partial or mixed state is never inferred as success', async () => {
  const { call, fake } = setup();
  fake.next('PanelEditCommit', 'down');
  assert.equal((await call('POST', '/orders/1043/edit', EDIT_LOST, STOCKED)).body.state, 'uncertain');
  const retry = await call('POST', '/orders/1043/edit', EDIT_LOST, STOCKED);
  assert.equal(retry.status, 200);
  assert.equal(fake.count('PanelEditCommit'), 2);
  const mixed = setup();
  mixed.fake.next('PanelEditCommit', 'down');
  await mixed.call('POST', '/orders/1043/edit', EDIT_LOST, STOCKED);
  mixed.fake.raw(1043).lines.find(line => line.id === '22').current = 2; // the change is there, the addition is not
  const partial = await mixed.call('POST', '/orders/1043/edit', EDIT_LOST, STOCKED);
  assert.deepEqual([partial.status, partial.body.code], [409, 'REVIEW_REQUIRED']);
  assert.equal(mixed.fake.count('PanelEditCommit'), 1);
});

test('edit stock: Celebraciones asks for it only before a new write or a retry, never for an applied receipt', async () => {
  const { call, fake } = setup();
  const body = { ...EDIT_LOST, operationId: op(95) };
  const ask = await call('POST', '/orders/1043/edit', body);
  assert.deepEqual([ask.status, ask.body.code], [409, 'STOCK_CHECK_REQUIRED']);
  assert.equal(fake.calls.length, 0);
  assert.equal((await call('POST', '/orders/1043/edit', body, STOCKED)).status, 200);
  // Same key again, without a new stock check: the stored receipt, no stock needed.
  const receipt = await call('POST', '/orders/1043/edit', body);
  assert.deepEqual([receipt.status, receipt.body.ok], [200, true]);
  assert.equal(fake.count('PanelEditCommit'), 1);
  // A decrease never needs stock.
  const less = await call('POST', '/orders/1043/edit', { operationId: op(96), changes: [{ lineItemId: 'gid://shopify/LineItem/21', variantId: null, fromQuantity: 1, quantity: 0 }], additions: [], notify: false });
  assert.equal(less.status, 200);
  // A pending write whose retry would resend asks for stock again before resending.
  const pending = setup();
  pending.fake.next('PanelEditCommit', 'down');
  await pending.call('POST', '/orders/1043/edit', { ...EDIT_LOST, operationId: op(97) }, STOCKED);
  const retryAsk = await pending.call('POST', '/orders/1043/edit', { ...EDIT_LOST, operationId: op(97) });
  assert.deepEqual([retryAsk.status, retryAsk.body.code], [409, 'STOCK_CHECK_REQUIRED']);
  assert.equal(pending.fake.count('PanelEditCommit'), 1);
});

test('gateway: stockVerified is accepted only as true and only from the trusted actor', async () => {
  assert.equal(portalOrdersActor(STOCKED, SHOP).stockVerified, true);
  assert.equal(portalOrdersActor(ADMIN, SHOP).stockVerified, false);
  assert.throws(() => portalOrdersActor({ ...ADMIN, stockVerified: 'yes' }, SHOP));
  const { call, fake } = setup();
  const sneaky = await call('POST', '/orders/1043/edit', { ...EDIT_LOST, operationId: op(98), stockVerified: true });
  assert.equal(sneaky.body.code, 'STOCK_CHECK_REQUIRED');
  assert.equal(fake.calls.length, 0);
});

test('dispatch with tracking and notify; pickup ready then delivered without a shipping email', async () => {
  const { call, fake } = setup();
  const sent = await call('POST', '/orders/1042/fulfill', { operationId: op(100), trackingNumber: '9400 1000 0000 0000 0000 00', carrier: 'USPS', notify: true }, INVENTARIO);
  assert.equal(sent.status, 200);
  const raw = fake.raw(1042);
  assert.equal(raw.fulfillments[0].trackingInfo[0].number, '9400 1000 0000 0000 0000 00');
  assert.equal(raw.lastFulfillNotify, true);
  assert.equal((await call('POST', '/orders/1043/fulfill', { operationId: op(101), trackingNumber: '9400100000', carrier: 'USPS', notify: true }, INVENTARIO)).body.code, 'PICKUP_ORDER');
  assert.equal((await call('POST', '/orders/1043/ready', { operationId: op(102) }, INVENTARIO)).status, 200);
  assert.equal(fake.raw(1043).readyNotices, 1);
  let list = await call('GET', '/orders', undefined, INVENTARIO);
  assert.equal(list.body.orders.find(order => order.name === '#1043').stage, 'listo');
  assert.equal((await call('POST', '/orders/1043/delivered', { operationId: op(103) }, INVENTARIO)).status, 200);
  assert.equal(fake.raw(1043).lastFulfillNotify, false);
  list = await call('GET', '/orders', undefined, INVENTARIO);
  assert.equal(list.body.orders.find(order => order.name === '#1043').stage, 'entregado');
  assert.equal(list.body.orders.find(order => order.name === '#1042').stage, 'listo');
});

test('missing fulfillment scopes show the clear notice and nothing else breaks', async () => {
  const { call, fake } = setup();
  fake.next('PanelFulfillmentOrders', 'denied');
  const denied = await call('POST', '/orders/1042/fulfill', { operationId: op(110), trackingNumber: '94001000000', carrier: 'USPS', notify: true }, INVENTARIO);
  assert.deepEqual([denied.status, denied.body.code, denied.body.message], [403, 'FULFILLMENT_SCOPE', MESSAGES.fulfillmentScope]);
  fake.next('PanelFulfill', 'denied');
  const deniedWrite = await call('POST', '/orders/1042/fulfill', { operationId: op(111), trackingNumber: '94001000000', carrier: 'USPS', notify: true }, INVENTARIO);
  assert.equal(deniedWrite.body.code, 'FULFILLMENT_SCOPE');
  fake.next('PanelFulfillmentOrders', 'denied');
  assert.equal((await call('POST', '/orders/1043/ready', { operationId: op(112) }, INVENTARIO)).body.code, 'FULFILLMENT_SCOPE');
  assert.equal((await call('GET', '/orders', undefined, INVENTARIO)).status, 200);
  assert.equal((await call('GET', '/orders/1042', undefined, INVENTARIO)).status, 200);
  assert.equal((await call('POST', '/orders/1043/cash', { operationId: op(113), expectedAmountCents: 3600 })).status, 200);
});

test('a definitive Shopify rejection is stored as failed and returned again for the same key', async () => {
  const { call, fake } = setup();
  fake.next('PanelMarkAsPaid', 'reject');
  const body = { operationId: op(120), expectedAmountCents: 3600 };
  const rejected = await call('POST', '/orders/1043/cash', body);
  assert.deepEqual([rejected.status, rejected.body.code], [422, 'SHOPIFY_REJECTED']);
  assert.deepEqual(await call('POST', '/orders/1043/cash', body), rejected);
  assert.equal(fake.count('PanelMarkAsPaid'), 1);
});

test('the orders service never writes to the console', async () => {
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const seen = [];
  for (const key of Object.keys(original)) console[key] = (...args) => seen.push(args);
  try {
    const { call, fake } = setup();
    await call('GET', '/orders');
    await call('GET', '/orders/1042');
    fake.next('PanelMarkAsPaid', 'lost');
    await call('POST', '/orders/1043/cash', { operationId: op(130), expectedAmountCents: 3600 });
    await call('POST', '/orders/1043/cash', { operationId: op(130), expectedAmountCents: 3600 });
    fake.next('PanelOrder', 'down');
    await call('GET', '/orders/1042');
  } finally { Object.assign(console, original); }
  assert.deepEqual(seen, []);
});
