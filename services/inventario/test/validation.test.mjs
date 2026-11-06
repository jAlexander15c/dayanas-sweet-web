import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, production, correction, creation, mutations } from './helpers.mjs';
for (const [label, input] of [
  ['cero producción', () => production({ quantity: 0 })], ['negativo', () => production({ quantity: -1 })], ['fracción', () => production({ quantity: 1.2 })], ['cadena', () => production({ quantity: '2' })], ['enorme', () => production({ quantity: 2147483648 })],
  ['motivo vacío', () => correction({ reason: ' ' })], ['cantidad negativa contada', () => correction({ quantity: -1 })], ['falta comparación', () => correction({ expected: undefined })],
  ['GID incorrecto', () => production({ productId: 'gid://shopify/Order/1' })], ['UUID inválido', () => production({ operationId: 'abc' })],
  ['precio negativo', () => creation({ price: '-1.00' })], ['precio sin decimales', () => creation({ price: '1' })], ['precio excesivos decimales', () => creation({ price: '1.234' })], ['precio numérico', () => creation({ price: 1 })],
  ['SKU largo', () => creation({ sku: 'x'.repeat(101) })], ['nombre largo', () => creation({ title: 'x'.repeat(201) })], ['nombre vacío', () => creation({ title: '' })], ['descripción larga', () => creation({ description: 'x'.repeat(5001) })], ['nuevo ACTIVE', () => creation({ status: 'ACTIVE' })],
  ['foto falsa', () => creation({ photos: [{ type: 'image/png', data: btoa('not a photo of anything') }] })], ['foto SVG', () => creation({ photos: [{ type: 'image/svg+xml', data: btoa('<svg></svg>') }] })],
]) test(`valida ${label} sin mutar`, async () => { const h = harness(); assert.equal((await h.call('/api/operations', input())).status, 400); assert.equal(mutations(h).length, 0); h.db.close(); });
test('descripción es texto y se escapa antes de enviar HTML a Shopify', async () => { const h = harness(); assert.equal((await h.call('/api/operations', creation({ description: '<script>alert(1)</script>' }))).status, 200); assert.match(mutations(h)[0].variables.product.descriptionHtml, /&lt;script&gt;/); h.db.close(); });
test('lee productos, tiendas e historial con cabeceras privadas y CSP', async () => {
  const h = harness(); for (const path of ['/api/products', '/api/locations', '/api/history']) { const r = await h.call(path); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.match(r.headers.get('content-security-policy'), /frame-ancestors https:\/\/admin.shopify.com https:\/\/inventario-test.myshopify.com/); } h.db.close();
});
