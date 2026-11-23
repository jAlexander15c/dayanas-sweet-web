import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createShopifyAdminTransport } from '../src/shopify-payments.mjs';
import { createShopifyOrdersClient } from '../src/orders-shopify.mjs';
import { createOrdersStore } from '../src/orders-store.mjs';
import { createOrdersService } from '../src/orders-service.mjs';
import { createChargesService, CREATE_SETTLE_MS, localDay } from '../src/charges-service.mjs';
import { handleStaffGateway } from '../src/staff-gateway.mjs';
import { createFakeShopify } from './fake-shopify-orders.mjs';

const SHOP = 'dayanas-test.myshopify.com';
const USER = '11111111-2222-4333-8444-555555555555';
const actor = (roles, extra = {}) => ({ shop: SHOP, aud: 'pedidos', userId: USER, name: 'Dayana', roles, sessionVersion: 1, ...extra });
const ADMIN = actor(['admin'], { stepUp: true });
const op = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOUR = 3_600_000, DAY = 24 * HOUR;

function memorySql() {
  const db = new DatabaseSync(':memory:');
  return {
    all: (query, ...bindings) => db.prepare(query).all(...bindings),
    run: (query, ...bindings) => { if (bindings.length) db.prepare(query).run(...bindings); else db.exec(query); },
    transaction: fn => { db.exec('BEGIN'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } },
  };
}
function setup() {
  const fake = createFakeShopify();
  const transport = createShopifyAdminTransport({ shop: SHOP, clientId: 'client', secret: 'secret', fetchImpl: fake.fetch, timeoutMs: 2000 });
  const client = createShopifyOrdersClient({ transport }), store = createOrdersStore(memorySql());
  let clock = Date.parse('2026-11-06T15:20:00Z');
  const now = () => clock;
  const charges = createChargesService({ client, store, now });
  const orders = createOrdersService({ client, store, now, shop: SHOP });
  const call = (method, path, body, who = ADMIN) => handleStaffGateway({ actor: who, method, path, body }, { config: { shop: SHOP }, ordersService: orders, chargesService: charges });
  return { fake, store, charges, call, advance: ms => { clock += ms; } };
}
const cobro = (n, extra = {}) => ({ operationId: op(n), kind: 'cobro', name: 'Mariela Vera', email: 'Mariela@Ejemplo.com', lines: [{ title: 'Torta 30 personas', cents: 3000 }, { title: 'Envío', cents: 500 }], ...extra });
const cotizacion = (n, expiresOn = '2026-11-08', extra = {}) => cobro(n, { kind: 'cotizacion', expiresOn, message: 'Hola Mariela, aquí está tu cotización.', ...extra });
const creates = fake => fake.count('PanelChargeCreate');

test('cobro: one draft with custom lines, the invoice email and the payment link', async () => {
  const { fake, call } = setup();
  const result = await call('POST', '/orders/charges/create', cobro(1));
  assert.equal(result.status, 200);
  assert.deepEqual([result.body.charge.status, result.body.charge.totalCents, result.body.charge.kind], ['enviado', 3500, 'cobro']);
  assert.match(result.body.charge.invoiceUrl, /^https:\/\/shop\.test\/invoices\/\d+$/);
  assert.equal(creates(fake), 1);
  const [draft] = fake.drafts.values();
  assert.deepEqual(draft.tags, ['ds-cobro', 'ds-tipo:cobro', `ds-operation:${op(1)}`]);
  assert.equal(draft.email, 'mariela@ejemplo.com');
  assert.deepEqual(draft.input.lineItems.map(line => [line.title, line.originalUnitPriceWithCurrency.amount, line.taxable, line.requiresShipping]), [['Torta 30 personas', '30.00', false, false], ['Envío', '5.00', false, false]]);
  assert.deepEqual(draft.customAttributes, [{ key: 'Clienta', value: 'Mariela Vera' }]);
  assert.deepEqual(fake.invoices.map(invoice => [invoice.to, invoice.subject]), [['mariela@ejemplo.com', "Tu cobro de Dayana's Sweet"]]);
  assert.equal(fake.count('PanelChargeComplete'), 0, 'never completes a draft by itself');
});

test('cotización: expiry date in the email; a repeat only re-reads the draft (no create, no email)', async () => {
  const { fake, call } = setup();
  const first = await call('POST', '/orders/charges/create', cotizacion(2));
  assert.equal(first.status, 200);
  assert.equal(first.body.charge.expiresOn, '2026-11-08');
  assert.match(fake.invoices[0].customMessage, /Hola Mariela[\s\S]*vale hasta el 8 de noviembre de 2026/);
  assert.equal(fake.invoices[0].subject, "Tu cotización de Dayana's Sweet");
  const calls = fake.calls.length;
  const again = await call('POST', '/orders/charges/create', cotizacion(2));
  assert.deepEqual(again.body.charge, first.body.charge);
  assert.deepEqual(fake.calls.slice(calls), ['PanelCharge'], 'the repeat re-reads the draft by ID and nothing else');
  assert.deepEqual([creates(fake), fake.invoices.length], [1, 1]);
  const reused = await call('POST', '/orders/charges/create', cotizacion(2, '2026-11-09'));
  assert.deepEqual([reused.status, reused.body.code, reused.body.final], [409, 'OPERATION_REUSED', true]);
});

test('lost answer of the create: the retry finds the draft by its tag and only sends what is missing', async () => {
  const { fake, call } = setup();
  fake.next('PanelChargeCreate', 'lost');
  const lost = await call('POST', '/orders/charges/create', cobro(3));
  assert.deepEqual([lost.status, lost.body.state, lost.body.final], [502, 'uncertain', undefined]);
  const retry = await call('POST', '/orders/charges/create', cobro(3));
  assert.equal(retry.status, 200);
  assert.equal(fake.drafts.size, 1);
  assert.equal(fake.invoices.length, 1);
});

test('create without answer and never found: a quick retry waits, a later one closes as unconfirmed and never creates (revisión R1)', async () => {
  const { fake, call, advance } = setup();
  fake.next('PanelChargeCreate', 'down');
  assert.equal((await call('POST', '/orders/charges/create', cobro(4))).status, 502);
  const early = await call('POST', '/orders/charges/create', cobro(4));
  assert.deepEqual([early.status, early.body.state], [202, 'processing']);
  advance(CREATE_SETTLE_MS + 1000);
  const late = await call('POST', '/orders/charges/create', cobro(4));
  assert.deepEqual([late.status, late.body.code, late.body.final], [409, 'CREATE_UNCONFIRMED', true]);
  assert.deepEqual([creates(fake), fake.drafts.size], [1, 0], 'only the original attempt; the admin decides with a new key');
  assert.equal((await call('POST', '/orders/charges/create', cobro(4))).body.code, 'CREATE_UNCONFIRMED', 'the closed receipt answers repeats');
  assert.equal((await call('POST', '/orders/charges/create', cobro(5))).status, 200, 'a new key creates normally');
});

test('lost create whose draft was voided in another tab: the retry never re-creates it (revisión R1)', async () => {
  const { fake, call, advance } = setup();
  fake.next('PanelChargeCreate', 'lost');
  assert.equal((await call('POST', '/orders/charges/create', cobro(50))).status, 502);
  const [draft] = (await call('GET', '/orders/charges')).body.charges;
  assert.equal((await call('POST', `/orders/charges/${draft.id}/void`, { operationId: op(51) })).status, 200);
  advance(CREATE_SETTLE_MS + 60_000);
  const retry = await call('POST', '/orders/charges/create', cobro(50));
  assert.deepEqual([retry.status, retry.body.code], [409, 'CREATE_UNCONFIRMED']);
  assert.deepEqual([creates(fake), fake.drafts.size, fake.invoices.length], [1, 0, 0]);
});

test('Shopify rejecting the create before applying it is final, not pending', async () => {
  const { fake, call } = setup();
  fake.next('PanelChargeCreate', 'reject');
  const rejected = await call('POST', '/orders/charges/create', cobro(52));
  assert.deepEqual([rejected.body.code, rejected.body.final], ['SHOPIFY_REJECTED', true]);
  assert.equal(fake.drafts.size, 0);
  // Errores de GraphQL sin datos (p. ej. THROTTLED): Shopify no aplicó nada; también es definitivo.
  fake.next('PanelChargeCreate', 'throttled');
  const throttled = await call('POST', '/orders/charges/create', cobro(53));
  assert.deepEqual([throttled.status, throttled.body.code, throttled.body.final], [503, 'SHOPIFY_REJECTED', true]);
  assert.equal(fake.drafts.size, 0);
});

test('invoice email unconfirmed: the charge exists, the email is never sent twice (revisión F2)', async () => {
  const { fake, call } = setup();
  // El envío no se aplicó: el cobro igual existe y la pantalla pide mandar el enlace.
  fake.next('PanelChargeInvoice', 'down');
  const first = await call('POST', '/orders/charges/create', cobro(5));
  assert.deepEqual([first.status, first.body.email, first.body.charge.status, typeof first.body.charge.invoiceUrl], [200, 'unconfirmed', 'abierto', 'string']);
  const retry = await call('POST', '/orders/charges/create', cobro(5));
  assert.equal(retry.body.email, 'unconfirmed');
  assert.deepEqual([creates(fake), fake.invoices.length, fake.count('PanelChargeInvoice')], [1, 0, 1], 'never a second invoice call');
  // El envío se aplicó pero su respuesta se perdió (o llegó tarde): la relectura lo confirma; un reintento no lo repite.
  fake.next('PanelChargeInvoice', 'lost');
  const late = await call('POST', '/orders/charges/create', cobro(6));
  assert.deepEqual([late.status, late.body.email], [200, 'sent']);
  await call('POST', '/orders/charges/create', cobro(6));
  assert.equal(fake.invoices.filter(item => item.to === 'mariela@ejemplo.com').length, 1);
  // El envío sigue en curso (todavía OPEN) y la relectura falla: la operación queda pendiente.
  // El reintento ve OPEN y aun así no vuelve a enviar: la intención ya quedó guardada.
  fake.next('PanelChargeInvoice', 'down');
  fake.next('PanelCharge', 'down');
  const pending = await call('POST', '/orders/charges/create', cobro(7));
  assert.equal(pending.body.final, undefined);
  const invoiceCalls = fake.count('PanelChargeInvoice');
  const again = await call('POST', '/orders/charges/create', cobro(7));
  assert.deepEqual([again.status, again.body.email], [200, 'unconfirmed']);
  assert.equal(fake.count('PanelChargeInvoice'), invoiceCalls, 'no second invoice while the first may still be in flight');
});

test('create applied but invisible to search for longer than the wait: the direct read finds it (revisión F1)', async () => {
  const { fake, call, advance } = setup();
  fake.next('PanelChargeCreate', 'lost');
  assert.equal((await call('POST', '/orders/charges/create', cobro(40))).status, 502);
  for (const id of fake.drafts.keys()) fake.unindexed.add(id);
  advance(CREATE_SETTLE_MS + 61_000);
  const retry = await call('POST', '/orders/charges/create', cobro(40));
  assert.deepEqual([retry.status, retry.body.email], [200, 'sent']);
  assert.deepEqual([creates(fake), fake.drafts.size, fake.invoices.length], [1, 1, 1]);
});

test('draft ID known: retries read it by ID and never create, even after the wait (revisión F1)', async () => {
  const { fake, call, advance } = setup();
  // Se crea el borrador; el correo no se confirma y la relectura falla: queda pendiente con el ID guardado.
  fake.next('PanelChargeInvoice', 'lost');
  fake.next('PanelCharge', 'down');
  const first = await call('POST', '/orders/charges/create', cobro(41));
  assert.equal(first.body.final, undefined);
  for (const id of fake.drafts.keys()) fake.unindexed.add(id);
  advance(CREATE_SETTLE_MS * 3);
  const retry = await call('POST', '/orders/charges/create', cobro(41));
  assert.deepEqual([retry.status, retry.body.email], [200, 'sent']);
  assert.deepEqual([creates(fake), fake.count('PanelChargeInvoice'), fake.count('PanelChargeByOperation')], [1, 1, 0]);
});

test('a pending quote retried after its expiry day never creates or invoices an expired quote (revisión R2)', async () => {
  const { fake, call, advance } = setup();
  fake.next('PanelChargeCreate', 'down');
  assert.equal((await call('POST', '/orders/charges/create', cotizacion(42, '2026-11-07'))).status, 502);
  advance(2 * DAY);
  const retry = await call('POST', '/orders/charges/create', cotizacion(42, '2026-11-07'));
  assert.deepEqual([retry.status, retry.body.code], [409, 'CREATE_UNCONFIRMED']);
  assert.deepEqual([creates(fake), fake.drafts.size, fake.invoices.length], [1, 0, 0]);
});

test('the cron keeps its place: an expired quote after 2,000 charges is reached on the next run (revisión R3)', async () => {
  const { fake, charges, advance } = setup();
  const filler = id => ({ id: String(id), status: 'COMPLETED', email: 'x@y.z', createdAt: '2026-11-01T12:00:00Z', tags: ['ds-cobro', 'ds-tipo:cobro'], customAttributes: [], lines: [{ title: 'Galletas', cents: 1000 }] });
  for (let i = 0; i < 2000; i++) fake.drafts.set(String(10_000 + i), filler(10_000 + i));
  fake.drafts.set('20000', { ...filler(20000), status: 'OPEN', tags: ['ds-cobro', 'ds-tipo:cotizacion', 'ds-vence:2026-11-07'] });
  advance(3 * DAY);
  assert.deepEqual(await charges.expire(), { expired: 0 }, 'the first run stops after 40 pages');
  assert.deepEqual(await charges.expire(), { expired: 1 }, 'the next run continues where it stopped');
  assert.equal(fake.drafts.has('20000'), false);
  assert.deepEqual(await charges.expire(), { expired: 0 }, 'a finished sweep starts again from the beginning');
});

test('stored receipts carry no name, email, concept or link (revisión F3)', async () => {
  const { store, call } = setup();
  const created = await call('POST', '/orders/charges/create', cobro(43, { name: 'Clienta Secreta', email: 'secreta@ejemplo.com', lines: [{ title: 'Torta de Secreta', cents: 2000 }] }));
  assert.equal(created.body.charge.name, 'Clienta Secreta');
  const saved = JSON.stringify(store.getOperation(op(43)));
  for (const value of ['Secreta', 'secreta@ejemplo.com', 'invoices/']) assert.doesNotMatch(saved, new RegExp(value, 'i'));
  // Una repetición sigue mostrando el enlace: lo vuelve a leer de Shopify.
  const again = await call('POST', '/orders/charges/create', cobro(43, { name: 'Clienta Secreta', email: 'secreta@ejemplo.com', lines: [{ title: 'Torta de Secreta', cents: 2000 }] }));
  assert.equal(again.body.charge.invoiceUrl, created.body.charge.invoiceUrl);
});

test('a retry of a quote that crosses midnight into its last day still reconciles (revisión F7)', async () => {
  const { fake, call, advance } = setup();
  // 6 nov 15:20 UTC: válida hasta el 7. Se pierde la respuesta; el reintento llega el 7.
  fake.next('PanelCharge', 'down');
  const first = await call('POST', '/orders/charges/create', cotizacion(44, '2026-11-07'));
  assert.equal(first.body.final, undefined);
  advance(DAY);
  const retry = await call('POST', '/orders/charges/create', cotizacion(44, '2026-11-07'));
  assert.deepEqual([retry.status, retry.body.charge.expiresOn], [200, '2026-11-07']);
  assert.equal(creates(fake), 1);
  // Una operación nueva con la misma fecha ya no vale (vence hoy).
  assert.equal((await call('POST', '/orders/charges/create', cotizacion(45, '2026-11-07'))).status, 422);
});

test('the cron reaches every expired quote beyond the first page (revisión F4)', async () => {
  const { fake, call, charges, advance } = setup();
  assert.equal((await call('POST', '/orders/charges/create', cotizacion(46, '2026-11-08'))).status, 200);
  for (let i = 0; i < 55; i++) assert.equal((await call('POST', '/orders/charges/create', cobro(100 + i))).status, 200);
  const listed = await call('GET', '/orders/charges');
  assert.deepEqual([listed.body.charges.length, listed.body.complete], [50, false]);
  advance(3 * DAY);
  assert.deepEqual(await charges.expire(), { expired: 1 });
  assert.equal([...fake.drafts.values()].filter(d => d.tags.includes('ds-tipo:cotizacion')).length, 0);
});

test('a paid charge whose order lost the tags is still recognized through the draft link (revisión F8)', async () => {
  const { fake, call, charges } = setup();
  const created = await call('POST', '/orders/charges/create', cobro(47));
  const orderId = fake.payDraft(created.body.charge.id, { copyTags: false });
  const before = await call('GET', '/orders');
  assert.equal(before.body.orders.find(order => order.id === orderId).charge, null, 'without tags and before the link: unknown');
  await charges.expire();
  const after = await call('GET', '/orders');
  assert.equal(after.body.orders.find(order => order.id === orderId).charge, 'cobro');
  assert.equal((await call('GET', `/orders/${orderId}`)).body.charge, 'cobro');
  assert.ok(!JSON.stringify(after.body.bake).includes('Torta 30 personas'));
});

test('void racing a payment: Shopify may delete the completed draft; the paid order stays (riesgo residual F5)', async () => {
  const { fake, call } = setup();
  const created = await call('POST', '/orders/charges/create', cobro(48));
  // Simula el pago justo después de la lectura y antes del borrado.
  fake.next('PanelChargeDelete', 'pay-first');
  const voided = await call('POST', `/orders/charges/${created.body.charge.id}/void`, { operationId: op(49) });
  const paidOrder = [...fake.state.values()].find(order => order.tags.includes(`ds-operation:${op(48)}`));
  assert.equal(voided.status, 200);
  assert.ok(paidOrder, 'the paid order is kept in Shopify and shows in Pedidos');
});

test('validation rejects before any Shopify call', async () => {
  const { fake, call } = setup();
  const cases = [
    cobro(10, { lines: [] }), cobro(11, { lines: [{ title: 'Torta', cents: 0 }] }), cobro(12, { lines: [{ title: 'Torta', cents: 500_001 }] }),
    cobro(13, { lines: [{ title: '   ', cents: 1000 }] }), cobro(14, { email: 'sin-arroba' }), cobro(15, { name: '' }),
    cobro(16, { lines: Array.from({ length: 11 }, () => ({ title: 'Línea', cents: 100 })) }), cobro(17, { kind: 'regalo' }),
    cotizacion(18, null), cotizacion(19, '2026-11-06'), cotizacion(20, '2027-01-06'), cotizacion(21, '2026-02-30'), cobro(22, { expiresOn: '2026-11-08' }),
    cobro(23, { message: 'x'.repeat(501) }), { ...cobro(24), operationId: 'no-es-uuid' },
  ];
  for (const body of cases) {
    const result = await call('POST', '/orders/charges/create', body);
    assert.deepEqual([result.status, result.body.final], [422, true], JSON.stringify(body).slice(0, 80));
  }
  assert.equal(fake.calls.filter(name => name.startsWith('PanelCharge')).length, 0);
});

test('gateway: only the admin, with the password, creates or voids; the list needs the admin role', async () => {
  const { fake, call } = setup();
  const inventario = actor(['inventario']), adminNoStepUp = actor(['admin']);
  assert.equal((await call('GET', '/orders/charges', undefined, inventario)).status, 403);
  assert.equal((await call('POST', '/orders/charges/create', cobro(30), inventario)).status, 403);
  const noPassword = await call('POST', '/orders/charges/create', cobro(31), adminNoStepUp);
  assert.deepEqual([noPassword.status, noPassword.body.code], [403, 'STEP_UP_REQUIRED']);
  assert.equal((await call('POST', '/orders/charges/create', { ...cobro(32), password: 'x' })).status, 422);
  assert.equal((await call('POST', '/orders/charges/1/delete', { operationId: op(33) })).status, 404);
  assert.equal(fake.drafts.size, 0);
  const list = await call('GET', '/orders/charges', undefined, adminNoStepUp);
  assert.deepEqual([list.status, list.body.charges, list.body.today], [200, [], '2026-11-06']);
});

test('expired quote: shown as vencida without a link, deleted by the cron; a paid one is never touched', async () => {
  const { fake, call, charges, advance } = setup();
  await call('POST', '/orders/charges/create', cotizacion(40, '2026-11-08'));
  const paid = await call('POST', '/orders/charges/create', cotizacion(41, '2026-11-08', { lines: [{ title: 'Mesa dulce', cents: 9000 }] }));
  const orderId = fake.payDraft(paid.body.charge.id);
  advance(2 * DAY);
  assert.equal(localDay(Date.parse('2026-11-08T15:20:00Z')), '2026-11-08');
  assert.equal((await charges.expire()).expired, 0, 'still valid on its last day');
  advance(DAY);
  const list = (await call('GET', '/orders/charges')).body;
  const byId = Object.fromEntries(list.charges.map(charge => [charge.id, charge]));
  assert.deepEqual([byId[paid.body.charge.id].status, byId[paid.body.charge.id].orderId], ['pagado', orderId]);
  const open = list.charges.find(charge => charge.id !== paid.body.charge.id);
  assert.deepEqual([open.status, open.invoiceUrl], ['vencido', null]);
  assert.equal((await charges.expire()).expired, 1);
  assert.deepEqual([...fake.drafts.keys()], [paid.body.charge.id]);
  const after = (await call('GET', '/orders/charges')).body;
  assert.deepEqual(after.closed.map(record => [record.status, record.totalCents, record.concept]), [['vencido', 3500, 'Torta 30 personas + Envío']]);
  assert.equal(JSON.stringify(after.closed).includes('Mariela'), false, 'closed records keep no customer data');
});

test('void: deletes an unpaid charge, a lost answer is reconciled, a paid charge is refused', async () => {
  const { fake, call } = setup();
  const created = await call('POST', '/orders/charges/create', cobro(50));
  fake.next('PanelChargeDelete', 'lost');
  const lost = await call('POST', `/orders/charges/${created.body.charge.id}/void`, { operationId: op(51) });
  assert.equal(lost.status, 502);
  const retry = await call('POST', `/orders/charges/${created.body.charge.id}/void`, { operationId: op(51) });
  assert.deepEqual([retry.status, retry.body.voided], [200, created.body.charge.id]);
  assert.equal(fake.drafts.size, 0);
  assert.deepEqual((await call('GET', '/orders/charges')).body.closed.map(record => record.status), ['anulado']);
  const paid = await call('POST', '/orders/charges/create', cobro(52));
  fake.payDraft(paid.body.charge.id);
  const refused = await call('POST', `/orders/charges/${paid.body.charge.id}/void`, { operationId: op(53) });
  assert.deepEqual([refused.status, refused.body.code, refused.body.final], [409, 'CHARGE_PAID', true]);
  assert.equal(fake.drafts.size, 1);
});

test('a paid charge shows up in Pedidos with its kind and stays out of «Para hornear»', async () => {
  const { fake, call } = setup();
  const before = (await call('GET', '/orders')).body.bake.products;
  const paid = await call('POST', '/orders/charges/create', cotizacion(60, '2026-11-10', { lines: [{ title: 'Torta 30 personas', cents: 7500 }, { title: 'Envío', cents: 1000 }] }));
  const orderId = fake.payDraft(paid.body.charge.id);
  const list = (await call('GET', '/orders')).body;
  const order = list.orders.find(item => String(item.id) === orderId);
  assert.deepEqual([order.charge, order.stage, order.totalCents], ['cotizacion', 'preparar', 8500]);
  assert.deepEqual(list.bake.products, before);
  assert.equal(list.bake.variants.some(item => /Torta 30|Envío/.test(item.title)), false);
});
