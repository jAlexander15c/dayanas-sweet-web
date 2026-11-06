import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryService } from '../src/inventory-service.mjs';
import { harness, editing, jwt, mutations, productId } from './helpers.mjs';

const staff = { staffId: '123', token: jwt() };
function serviceWith(h, overrides) {
  return createInventoryService({ store: h.store, clientFactory: (...args) => {
    const client = h.clientFactory(...args);
    return { ...client, ...overrides(client) };
  } });
}

test('F2: editar solo nombre no escribe precio ni SKU aunque cambien durante el guardado', async t => {
  const h = harness(); t.after(() => h.db.close());
  const input = editing(h, { title: 'Nuevo nombre' });
  const service = serviceWith(h, client => ({ async update(...args) {
    const result = await client.update(...args);
    h.mock.state.product.variants.nodes[0].price = '99.00';
    h.mock.state.product.variants.nodes[0].sku = 'OTRO';
    return result;
  } }));
  const result = await service.execute(input, staff);
  assert.equal(result.status, 200);
  assert.equal(h.mock.state.product.title, 'Nuevo nombre');
  assert.equal(h.mock.state.product.variants.nodes[0].price, '99.00');
  assert.equal(h.mock.state.product.variants.nodes[0].sku, 'OTRO');
  assert.equal(mutations(h).filter(m => m.query.includes('productVariantsBulkUpdate')).length, 0);
});

test('F2: precio concurrente entre escrituras detiene el precio solicitado sin sobrescribirlo', async t => {
  const h = harness(); t.after(() => h.db.close());
  const service = serviceWith(h, client => ({ async update(...args) {
    const result = await client.update(...args);
    h.mock.state.product.variants.nodes[0].price = '99.00';
    return result;
  } }));
  const result = await service.execute(editing(h, { title: 'Nuevo nombre', price: '20.00' }), staff);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'PRODUCT_CHANGED');
  assert.equal(h.mock.state.product.variants.nodes[0].price, '99.00');
  assert.equal(mutations(h).filter(m => m.query.includes('productVariantsBulkUpdate')).length, 0);
});

test('F2: relee el nombre después de subir fotos antes de escribirlo', async t => {
  const h = harness(); t.after(() => h.db.close());
  const service = serviceWith(h, client => ({ async upload(...args) {
    const result = await client.upload(...args);
    h.mock.state.product.title = 'Nombre concurrente';
    return result;
  } }));
  const photo = { type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
  const result = await service.execute(editing(h, { title: 'Nuevo nombre', photos: [photo] }), staff);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'PRODUCT_CHANGED');
  assert.equal(h.mock.state.product.title, 'Nombre concurrente');
  assert.equal(mutations(h).filter(m => m.query.includes('productUpdate(')).length, 0);
});

test('F2: cambiar solo precio conserva un SKU concurrente sin incluirlo en la escritura', async t => {
  const h = harness(); t.after(() => h.db.close());
  let reads = 0;
  const service = serviceWith(h, client => ({ async product(...args) {
    if (++reads === 2) h.mock.state.product.variants.nodes[0].sku = 'CONCURRENTE';
    return client.product(...args);
  } }));
  const result = await service.execute(editing(h, { price: '20.00' }), staff);
  assert.equal(result.status, 200);
  const write = mutations(h).find(m => m.query.includes('productVariantsBulkUpdate'));
  assert.equal(write.variables.variants[0].price, '20.00');
  assert.equal(Object.hasOwn(write.variables.variants[0].inventoryItem || {}, 'sku'), false);
  assert.equal(h.mock.state.product.variants.nodes[0].sku, 'CONCURRENTE');
});

for (const field of ['title', 'sku']) test(`F4: expectativas exactas de ${field} con espacios permiten editar`, async t => {
  const h = harness(); t.after(() => h.db.close());
  if (field === 'title') h.mock.state.product.title = ' Brownie ';
  else h.mock.state.product.variants.nodes[0].sku = ' B-1 ';
  const result = await h.call('/api/operations', editing(h, { title: 'Nuevo nombre' }));
  assert.equal(result.status, 200);
  assert.equal(h.mock.state.product.title, 'Nuevo nombre');
  if (field === 'sku') {
    assert.equal(h.mock.state.product.variants.nodes[0].sku, ' B-1 ');
    assert.equal(mutations(h).filter(m => m.query.includes('productVariantsBulkUpdate')).length, 0);
  }
});

test('F8: elimina título archivado de 255 caracteres y conserva confirmación, estado y autorización', async t => {
  const h = harness(); t.after(() => h.db.close());
  h.mock.state.product.title = 'A'.repeat(255);
  h.mock.state.product.status = 'ARCHIVED';
  const input = () => ({ action: 'delete', operationId: crypto.randomUUID(), productId, confirmTitle: 'A'.repeat(255) });
  assert.equal((await h.call('/api/operations', { ...input(), confirmTitle: 'A'.repeat(254) })).status, 400);
  assert.equal((await h.call('/api/operations', input(), jwt({ sub: '999' }))).status, 403);
  h.mock.state.product.status = 'ACTIVE';
  assert.equal((await h.call('/api/operations', input())).status, 409);
  h.mock.state.product.status = 'ARCHIVED';
  assert.equal((await h.call('/api/operations', { ...input(), confirmTitle: 'A'.repeat(256) })).status, 400);
  assert.equal((await h.call('/api/operations', input())).status, 200);
  assert.equal(mutations(h).filter(m => m.query.includes('productDelete')).length, 1);
});
