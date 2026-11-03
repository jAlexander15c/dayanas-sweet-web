import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAdminPage } from '../src/admin-page.mjs';
import { createAdminApi, createOperationBook, paymentSummary, parseDollars, calendarInput, canMarkReady, paymentConnectionSummary } from '../src/admin-ui.js';

test('public shell escapes the app key, contains no request data and restricts framing to its exact shop', async () => {
  const response = renderAdminPage({ clientId: '\"><script>alert(1)</script>&', shop: 'test-bakery.myshopify.com' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /text\/html; charset=utf-8/);
  const policy = response.headers.get('content-security-policy');
  assert.match(policy, /frame-ancestors https:\/\/test-bakery\.myshopify\.com https:\/\/admin\.shopify\.com(?:;|$)/);
  assert.ok(!policy.includes('*.myshopify.com'));
  const html = await response.text();
  assert.ok(html.includes('name="shopify-api-key" content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;"'));
  assert.ok(html.includes('https://cdn.shopify.com/shopifycloud/app-bridge.js'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('acceptedProposal'));
  assert.ok(!html.includes('payments:'));
});

test('invalid configured shop never becomes a frame ancestor or reflected markup', async () => {
  for (const shop of ['evil.test', 'test.myshopify.com https://evil.test', 'https://test.myshopify.com', 'test.myshopify.com; frame-ancestors *', '\"><script>bad</script>']) {
    const response = renderAdminPage({ clientId: 'app', shop });
    assert.equal(response.status, 503);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.ok(!(await response.text()).includes(shop));
  }
});

test('admin API obtains a fresh App Bridge token for each private request and denies unauthenticated access', async () => {
  const calls = []; let tokens = 0;
  const api = createAdminApi({
    shopify: { idToken: async () => `session-${++tokens}` },
    fetch: async (url, options) => { calls.push({ url, options }); return Response.json({ requests: [] }); },
  });
  assert.deepEqual(await api('/admin/requests'), { requests: [] });
  await api('/admin/requests/abc/comments', { text: 'Hola', operationId: 'intent-1' });
  assert.deepEqual(calls.map(call => call.options.headers.Authorization), ['Bearer session-1', 'Bearer session-2']);
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { text: 'Hola', operationId: 'intent-1' });
  const denied = createAdminApi({ shopify: { idToken: async () => 'token' }, fetch: async () => Response.json({ code: 'AUTH_REQUIRED' }, { status: 403 }) });
  await assert.rejects(denied('/admin/requests'), { code: 'AUTH_REQUIRED' });
  await assert.rejects(createAdminApi({ shopify: null })('/admin/requests'), { code: 'AUTH_REQUIRED' });
});

test('failed mutation retries keep their operation ID while changed intent or success generates a new ID', () => {
  let count = 0;
  const book = createOperationBook(() => `uuid-${++count}`);
  assert.equal(book.get('request/comments', { text: 'Rosas' }), 'uuid-1');
  assert.equal(book.get('request/comments', { text: 'Rosas' }), 'uuid-1');
  assert.equal(book.get('request/comments', { text: 'Flores' }), 'uuid-2');
  book.complete('request/comments');
  assert.equal(book.get('request/comments', { text: 'Flores' }), 'uuid-3');
});

test('payments use accepted total only, preserve deposits and expose overpayment without inventing a refund', () => {
  const payments = [{ id: 'p1', amountCents: 9000, status: 'confirmed' }];
  assert.deepEqual(paymentSummary({ acceptedProposal: { totalCents: 15000 }, pendingProposal: { totalCents: 17000 }, payments }), { total: 15000, received: 9000, balance: 6000, credit: 0 });
  assert.deepEqual(paymentSummary({ acceptedProposal: { totalCents: 7000 }, payments }), { total: 7000, received: 9000, balance: 0, credit: 2000 });
  assert.deepEqual(paymentSummary({ acceptedProposal: null, payments }), { total: null, received: 9000, balance: null, credit: 0 });
});

test('billing supplies tax-inclusive totals and authoritative paid amount and balance instead of proposal arithmetic', () => {
  const snapshot = {
    acceptedProposal: { version: 1, totalCents: 15000 }, pendingProposal: { version: 2, totalCents: 17000 },
    payments: [{ id: 'legacy', amountCents: 9000, status: 'confirmed' }],
    billing: { proposalVersion: 1, totalCents: 16238, taxCents: 1238, netPaidCents: 9738, balanceDueCents: 6500, currency: 'USD' },
  };
  assert.deepEqual(paymentSummary(snapshot), { total: 16238, received: 9738, balance: 6500, credit: 0 });
  assert.equal(snapshot.acceptedProposal.totalCents, 15000);
});

test('invalid billing fails closed instead of presenting an estimated balance as authoritative', () => {
  const billing = { proposalVersion: 1, totalCents: 16238, taxCents: 1238, netPaidCents: 9738, balanceDueCents: 6500, currency: 'USD' };
  for (const change of [{ currency: 'EUR' }, { taxCents: -1 }, { taxCents: 17000 }, { balanceDueCents: 6500.5 }, { balanceDueCents: 6000 }, { netPaidCents: Number.MAX_SAFE_INTEGER + 1 }, { proposalVersion: 0 }, { proposalVersion: 1.5 }, { proposalVersion: undefined }, { overpaymentCents: 1 }]) {
    assert.throws(() => paymentSummary({ acceptedProposal: { version: 1, totalCents: 15000 }, payments: [], billing: { ...billing, ...change } }), { code: 'UNAVAILABLE' });
  }
});

test('billing from an older accepted proposal preserves actual receipts without inventing a new tax-inclusive balance', () => {
  const snapshot = {
    acceptedProposal: { version: 2, totalCents: 17000 }, payments: [],
    billing: { proposalVersion: 1, totalCents: 16238, taxCents: 1238, netPaidCents: 9738, balanceDueCents: 6500, currency: 'USD' },
  };
  assert.deepEqual(paymentSummary(snapshot), { total: 17000, received: 9738, balance: null, credit: 0 });
});

test('ready requires an accepted proposal, current fully paid Shopify billing and no pending review or proposal', () => {
  const snapshot = {
    status: 'reserved', acceptedProposal: { version: 1, totalCents: 15000 }, pendingProposal: null, payments: [],
    billing: { proposalVersion: 1, totalCents: 15000, taxCents: 0, netPaidCents: 15000, balanceDueCents: 0, currency: 'USD' },
    payment: { stage: 'paid', url: null, reviewRequired: false },
  };
  assert.equal(canMarkReady(snapshot), true);
  for (const change of [{ billing: undefined }, { billing: { ...snapshot.billing, proposalVersion: 2 } }, { pendingProposal: { version: 2 } }, { payment: { ...snapshot.payment, stage: 'syncing' } }, { payment: { ...snapshot.payment, reviewRequired: true } }, { status: 'quoted' }]) {
    assert.equal(canMarkReady({ ...snapshot, ...change }), false);
  }
});

test('prices convert decimal USD to integer cents and reject invalid, negative or excessive values', () => {
  assert.equal(parseDollars('170.25'), 17025);
  assert.equal(parseDollars('0'), 0);
  assert.equal(parseDollars('0.01'), 1);
  for (const value of ['', '-1', '1.005', 'NaN', '1e3', '1000000.01']) assert.throws(() => parseDollars(value), { code: 'VALIDATION' });
});

test('calendar changes accept actual dates and booleans without timezone rollover', () => {
  assert.deepEqual(calendarInput({ date: '2028-02-29', closed: true }), { date: '2028-02-29', closed: true });
  assert.deepEqual(calendarInput({ date: '2026-11-14', closed: false }), { date: '2026-11-14', closed: false });
  for (const input of [{ date: '2026-02-29', closed: true }, { date: '2026-11-31', closed: false }, { date: '11/14/2026', closed: true }, { date: '', closed: true }, { date: '2026-11-14', closed: 'false' }]) {
    assert.throws(() => calendarInput(input), { code: 'VALIDATION' });
  }
});

test('payment connection diagnostic reports actual scopes and locations without copying extra secret fields', () => {
  const result = paymentConnectionSummary({ configured: true, mode: 'live', currency: 'USD', scopes: ['read_orders'], missingScopes: ['read_customers'], locations: [{ id: 'gid://shopify/Location/1', name: '<img onerror=bad()>', isActive: true }], accessToken: 'do-not-display-this' });
  assert.match(result.message, /faltan permisos/);
  assert.ok(result.details.includes('Permisos pendientes: read_customers'));
  assert.ok(result.details.some(line => line.includes('<img onerror=bad()>')));
  assert.ok(!JSON.stringify(result).includes('do-not-display-this'));
  assert.match(paymentConnectionSummary({ configured: false, mode: 'disabled' }).message, /no están configurados/);
  assert.throws(() => paymentConnectionSummary({ configured: true, mode: 'live', currency: 'USD' }), { code: 'UNAVAILABLE' });
});

test('failed payment diagnostic exposes only allowlisted stage, HTTP status and code, never raw errors or secrets', () => {
  const base = { configured: false, mode: 'live', currency: null, scopes: [], locations: [], missingScopes: [] };
  const result = paymentConnectionSummary({ ...base, accessToken: 'secret-value', diagnostic: { stage: 'token', httpStatus: 401, code: 'invalid_client', message: 'raw-private-message', error_description: 'secret-value' } });
  assert.match(result.message, /conexión.*falló/i);
  assert.deepEqual(result.details, ['Etapa: token', 'HTTP: 401', 'Código: invalid_client']);
  assert.ok(!JSON.stringify(result).includes('secret-value'));
  assert.ok(!JSON.stringify(result).includes('raw-private-message'));
  const graph = paymentConnectionSummary({ ...base, diagnostic: { stage: 'graphql', httpStatus: 200, code: 'undefinedField' } });
  assert.deepEqual(graph.details, ['Etapa: graphql', 'HTTP: 200', 'Código: undefinedField']);
  const unknown = paymentConnectionSummary({ ...base, mode: 'secret-value', diagnostic: { stage: 'raw-private-message', httpStatus: '401 secret-value', code: 'raw-private-message' } });
  assert.deepEqual(unknown.details, ['Etapa: no identificada', 'HTTP: no disponible', 'Código: unknown']);
  for (const httpStatus of [99, 600, 401.5, null]) {
    const invalidStatus = paymentConnectionSummary({ ...base, diagnostic: { stage: null, httpStatus, code: 'unknown' } });
    assert.ok(invalidStatus.details.includes('HTTP: no disponible'));
  }
});
