import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { verifyAdminSession, verifyAppProxy, verifyWebhook } from '../src/shopify-auth.mjs';

const secret = 'test-only-shared-secret';
const shop = 'example-sweets.myshopify.com';
const nowSeconds = 1_800_000_000;
const options = { secret, shop, nowSeconds };
const authRequired = { code: 'AUTH_REQUIRED' };

// Sign independently with Node crypto; canonical fixture strings are hand written.
function proxy(query = '', canonical = '', overrides = {}) {
  const values = { shop, customer: '9007199254740993', timestamp: nowSeconds, ...overrides };
  const parameters = new URLSearchParams({
    shop: values.shop,
    logged_in_customer_id: values.customer,
    path_prefix: '/apps/celebraciones',
    timestamp: String(values.timestamp),
  });
  const message = `${canonical}logged_in_customer_id=${values.customer}path_prefix=/apps/celebracionesshop=${values.shop}timestamp=${values.timestamp}`;
  const signature = createHmac('sha256', secret).update(message).digest('hex');
  return new URL(`https://backend.example/proxy?${query}${parameters}&signature=${signature}`);
}

test('proxy authenticates decoded parameters, comma-grouped repeats and unknown fields', async () => {
  const url = proxy('extra=1&extra=2&gift=Feliz+cumple%21&', 'extra=1,2gift=Feliz cumple!');
  assert.deepEqual(await verifyAppProxy(url, options), { shop, customerId: '9007199254740993' });
  assert.deepEqual(await verifyAppProxy(url.href, options), { shop, customerId: '9007199254740993' });
});

test('proxy sorts whole decoded key=value strings as Shopify does', async () => {
  const url = proxy('a=2&a%21=1&', 'a!=1a=2');
  assert.deepEqual(await verifyAppProxy(url, options), { shop, customerId: '9007199254740993' });
});

test('proxy decodes percent encoded names and values exactly once', async () => {
  const url = proxy('ex%74ra=%252F%2B%26%3D&', 'extra=%2F+&=');
  assert.deepEqual(await verifyAppProxy(url, options), { shop, customerId: '9007199254740993' });
});

test('proxy rejects a tampered parameter and wrong secret', async () => {
  const url = proxy();
  url.searchParams.set('logged_in_customer_id', '1');
  await assert.rejects(verifyAppProxy(url, options), authRequired);
  await assert.rejects(verifyAppProxy(proxy(), { ...options, secret: 'wrong' }), authRequired);
});

for (const field of ['shop', 'timestamp', 'logged_in_customer_id', 'signature', 'path_prefix']) {
  test(`proxy rejects duplicate critical field ${field}, including encoded names`, async () => {
    const url = proxy();
    url.search += `&%${field.charCodeAt(0).toString(16)}${field.slice(1)}=${encodeURIComponent(url.searchParams.get(field))}`;
    await assert.rejects(verifyAppProxy(url, options), authRequired);
  });
}

test('proxy rejects another shop even when the signature is valid', async () => {
  await assert.rejects(verifyAppProxy(proxy('', '', { shop: 'other.myshopify.com' }), options), authRequired);
});

for (const customer of ['', 'abc', '1.5', '-1', '1e3', ' 12', '12,13']) {
  test(`proxy rejects invalid customer ID ${JSON.stringify(customer)}`, async () => {
    await assert.rejects(verifyAppProxy(proxy('', '', { customer }), options), authRequired);
  });
}

for (const offset of [-300, 60]) {
  test(`proxy accepts timestamp boundary ${offset}`, async () => {
    assert.equal((await verifyAppProxy(proxy('', '', { timestamp: nowSeconds + offset }), options)).customerId, '9007199254740993');
  });
}

for (const timestamp of [nowSeconds - 301, nowSeconds + 61, '', 'NaN', '1e9', '-1', '1800000000.5', '99999999999999999']) {
  test(`proxy rejects invalid or out-of-window timestamp ${JSON.stringify(timestamp)}`, async () => {
    await assert.rejects(verifyAppProxy(proxy('', '', { timestamp }), options), authRequired);
  });
}

test('proxy respects a custom replay window', async () => {
  await assert.rejects(verifyAppProxy(proxy('', '', { timestamp: nowSeconds - 11 }), { ...options, maxAgeSeconds: 10 }), authRequired);
});

for (const field of ['shop', 'timestamp', 'logged_in_customer_id', 'signature']) {
  test(`proxy rejects missing ${field}`, async () => {
    const url = proxy();
    url.searchParams.delete(field);
    await assert.rejects(verifyAppProxy(url, options), authRequired);
  });
}

for (const signature of ['', 'x'.repeat(64), 'a'.repeat(63), 'a'.repeat(66)]) {
  test(`proxy rejects malformed signature ${signature.length}`, async () => {
    const url = proxy();
    url.searchParams.set('signature', signature);
    await assert.rejects(verifyAppProxy(url, options), authRequired);
  });
}

for (const invalid of [undefined, null, {}, { ...options, secret: '' }, { ...options, secret: ' ' }, { ...options, shop: 'https://example-sweets.myshopify.com' }, { ...options, shop: 'example.com' }, { ...options, nowSeconds: NaN }, { ...options, maxAgeSeconds: -1 }]) {
  test(`proxy fails closed with invalid configuration ${JSON.stringify(invalid)}`, async () => {
    await assert.rejects(verifyAppProxy(proxy(), invalid), authRequired);
  });
}

test('proxy rejects malformed URLs with AUTH_REQUIRED', async () => {
  await assert.rejects(verifyAppProxy('not a URL', options), authRequired);
});

const rawBody = new TextEncoder().encode('{ "message": "Feliz cumpleaños 🎂" }\n');
const webhookHmac = createHmac('sha256', secret).update(rawBody).digest('base64');

test('webhook verifies exact raw UTF-8 bytes and Uint8Array subviews', async () => {
  assert.equal(await verifyWebhook(rawBody, webhookHmac, secret), true);
  const padded = new Uint8Array(rawBody.length + 2);
  padded.set(rawBody, 1);
  assert.equal(await verifyWebhook(padded.subarray(1, -1), webhookHmac, secret), true);
});

test('webhook rejects changed body or wrong secret', async () => {
  assert.equal(await verifyWebhook(rawBody.subarray(0, -1), webhookHmac, secret), false);
  assert.equal(await verifyWebhook(rawBody, webhookHmac, 'wrong'), false);
});

test('webhook returns false for malformed signatures, input or secret', async () => {
  for (const hmac of [undefined, null, '', '!', 'a'.repeat(44), webhookHmac.slice(1), `${webhookHmac}\n`]) {
    assert.equal(await verifyWebhook(rawBody, hmac, secret), false);
  }
  assert.equal(await verifyWebhook('{}', webhookHmac, secret), false);
  assert.equal(await verifyWebhook(rawBody, webhookHmac, ''), false);
});

const clientId = 'test-client-id';
const claims = { iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: clientId, sub: '123', exp: nowSeconds + 60, nbf: nowSeconds - 1, iat: nowSeconds - 1 };
const adminOptions = { ...options, clientId };
function adminToken(overrides = {}, header = { alg: 'HS256', typ: 'JWT' }) {
  const parts = [header, { ...claims, ...overrides }].map(value => Buffer.from(JSON.stringify(value)).toString('base64url'));
  const message = parts.join('.');
  return `${message}.${createHmac('sha256', secret).update(message).digest('base64url')}`;
}

test('admin session authenticates an embedded Shopify staff session', async () => {
  assert.deepEqual(await verifyAdminSession(adminToken(), adminOptions), { shop, staffId: '123' });
});

for (const invalid of [
  { aud: 'other-app' }, { aud: [clientId] }, { dest: 'https://other.myshopify.com' },
  { dest: `http://${shop}` }, { dest: `https://${shop}/extra` }, { iss: `https://${shop}/admin/extra` },
  { iss: 'https://other.myshopify.com/admin' }, { exp: nowSeconds }, { exp: '1800000060' },
  { nbf: nowSeconds + 1 }, { iat: nowSeconds + 1 }, { iat: undefined }, { nbf: undefined },
  { sub: '' }, { sub: 'staff' }, { sub: 123 },
]) {
  test(`admin session rejects invalid claims ${JSON.stringify(invalid)}`, async () => {
    await assert.rejects(verifyAdminSession(adminToken(invalid), adminOptions), authRequired);
  });
}

test('admin session rejects algorithm confusion, tampering, malformed tokens and invalid config', async () => {
  await assert.rejects(verifyAdminSession(adminToken({}, { alg: 'none' }), adminOptions), authRequired);
  const token = adminToken();
  await assert.rejects(verifyAdminSession(`${token.slice(0, -2)}aa`, adminOptions), authRequired);
  for (const invalid of [undefined, '', 'a.b.c', `${token}.extra`]) {
    await assert.rejects(verifyAdminSession(invalid, adminOptions), authRequired);
  }
  await assert.rejects(verifyAdminSession(token, { ...adminOptions, clientId: '' }), authRequired);
  await assert.rejects(verifyAdminSession(token, { ...adminOptions, secret: 'wrong' }), authRequired);
});
