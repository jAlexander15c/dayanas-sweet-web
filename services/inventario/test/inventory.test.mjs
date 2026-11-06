import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, production, correction, creation, mutations, productId, variantId, locationId, jwt, editing } from './helpers.mjs';
test('producción suma available con delta, received e idempotent; nunca set', async () => {
  const h = harness(), input = production();
  const r = await h.call('/api/operations', input); assert.equal(r.status, 200);
  const [m] = mutations(h); assert.match(m.query, /inventoryAdjustQuantities/); assert.match(m.query, /@idempotent\(key: \$key\)/);
  assert.equal(m.variables.input.name, 'available'); assert.equal(m.variables.input.reason, 'received'); assert.equal(m.variables.input.changes[0].delta, 6); assert.equal(m.variables.input.changes[0].changeFromQuantity, 4); assert.equal(m.variables.key, input.operationId);
  assert.ok(!h.mock.state.calls.some(c => c.query.includes('inventorySetQuantities')));
  assert.deepEqual((await r.json()).after, { available: 10 });
  const [event] = h.store.history(); assert.equal(event.result, 'succeeded'); assert.equal(event.staffId, '123'); assert.equal(event.staffName, 'Pastelera de prueba'); assert.equal(event.shopifyAdjustmentId, 'gid://shopify/InventoryAdjustmentGroup/601'); assert.deepEqual(event.before, { available: 4 }); h.db.close();
});
test('corrección usa on_hand y comparación, sin adjust', async () => {
  const h = harness(); const r = await h.call('/api/operations', correction()); assert.equal(r.status, 200);
  const [m] = mutations(h); assert.match(m.query, /inventorySetQuantities/); assert.match(m.query, /@idempotent/); assert.equal(m.variables.input.name, 'on_hand'); assert.equal(m.variables.input.reason, 'correction'); assert.equal(m.variables.input.quantities[0].changeFromQuantity, 6); assert.equal(m.variables.input.quantities[0].quantity, 5); assert.equal(m.variables.input.ignoreCompareQuantity, undefined); assert.ok(!mutations(h).some(c => c.query.includes('inventoryAdjustQuantities'))); h.db.close();
});
test('cambio concurrente en Shopify devuelve 409, conteo actual y no reintenta', async () => {
  const h = harness(); h.mock.state.stale = true;
  const input = correction(); const r = await h.call('/api/operations', input); assert.equal(r.status, 409); assert.equal((await r.json()).current, 7);
  assert.equal(mutations(h).length, 1); assert.equal(h.store.history()[0].result, 'failed'); assert.equal(h.store.history()[0].reason, 'Una caja dañada');
  const replay = await h.call('/api/operations', input); assert.equal(replay.status, 409); assert.equal(mutations(h).length, 1); h.db.close();
});
test('conteo ya cambió al confirmar: 409 antes de mutar', async () => { const h = harness(); const r = await h.call('/api/operations', correction({ expected: 3 })); assert.equal(r.status, 409); assert.equal((await r.json()).current, 6); assert.equal(mutations(h).length, 0); h.db.close(); });
test('mismo operationId secuencial y paralelo ejecuta exactamente una mutación', async () => {
  for (const parallel of [false, true]) {
    const h = harness(), input = production();
    const results = parallel ? await Promise.all([h.call('/api/operations', input), h.call('/api/operations', input)]) : [await h.call('/api/operations', input), await h.call('/api/operations', input)];
    assert.equal(results[0].status, 200); assert.deepEqual(await results[0].json(), await results[1].json()); assert.equal(mutations(h).length, 1); assert.equal(h.store.history().length, 1); h.db.close();
  }
});
test('un operationId no puede cambiar de datos o personal', async () => { const h = harness({ INVENTARIO_STAFF_IDS: '123,999' }); const input = production(); await h.call('/api/operations', input); assert.equal((await h.call('/api/operations', { ...input, quantity: 8 })).status, 409); assert.equal((await h.call('/api/operations', input, jwt({ sub: '999' }))).status, 409); assert.equal(mutations(h).length, 1); h.db.close(); });
test('pending reciente impide repetir sin enviar mutaciones', async () => {
  const h = harness(), input = production();
  const { operation, fingerprint } = await import('../src/validation.mjs'); const normalized = operation(input);
  h.store.begin(input.operationId, await fingerprint(normalized), '123', new Date().toISOString(), { id: crypto.randomUUID(), result: 'pending' });
  const r = await h.call('/api/operations', input); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'REVIEW_REQUIRED'); assert.equal(mutations(h).length, 0); h.db.close();
});
test('creación DRAFT con inventario rastreado, precio, SKU y cajas iniciales', async () => {
  const h = harness(); h.mock.state.activateNeeded = true;
  const input = creation(); const r = await h.call('/api/operations', input); assert.equal(r.status, 200);
  const ms = mutations(h); assert.equal(ms[0].variables.product.status, 'DRAFT'); assert.equal(ms[1].variables.variants[0].inventoryItem.tracked, true); assert.equal(ms[1].variables.variants[0].price, '15.00'); assert.equal(ms[1].variables.variants[0].inventoryItem.sku, 'BROWNIE');
  assert.match(ms[2].query, /inventoryActivate.*@idempotent/); assert.match(ms[3].query, /inventoryAdjustQuantities/); assert.equal(ms[3].variables.input.changes[0].delta, 8); assert.equal(h.store.history()[0].after.status, 'DRAFT'); h.db.close();
});
test('edición multivariante rechaza precio y código antes de mutar', async () => {
  const h = harness(); h.mock.state.product.variants.nodes.push(structuredClone(h.mock.state.product.variants.nodes[0]));
  const input = editing(h, { title: 'Caja', description: '', price: '10.00', sku: '', status: 'DRAFT' });
  assert.equal((await h.call('/api/operations', input)).status, 400); assert.equal(mutations(h).length, 0); h.db.close();
});
test('pasar a ACTIVE requiere confirmación explícita y es el último paso', async () => {
  const h = harness(); const input = editing(h, { title: 'Caja', description: '', price: '10.00', sku: 'X', status: 'ACTIVE' });
  assert.equal((await h.call('/api/operations', input)).status, 400); assert.equal(mutations(h).length, 0);
  const r = await h.call('/api/operations', { ...input, operationId: crypto.randomUUID(), confirmActive: true }); assert.equal(r.status, 200); assert.equal(mutations(h).at(-2).variables.product.status, 'ACTIVE'); assert.match(mutations(h).at(-1).query, /publishablePublish/); h.db.close();
});
test('falla Shopify: auditoría registra fallo y repetir no reintenta', async () => {
  const h = harness(); h.mock.state.rejectMutation = true; const input = production();
  assert.equal((await h.call('/api/operations', input)).status, 422); assert.equal((await h.call('/api/operations', input)).status, 422); assert.equal(mutations(h).length, 1); const event = h.store.history()[0]; assert.equal(event.result, 'failed'); assert.equal(event.error.code, 'SHOPIFY_REJECTED'); assert.equal(event.operationId, input.operationId); h.db.close();
});
test('respuesta perdida conserva uncertain al reconsultar con la misma clave', async () => { const h = harness(); h.mock.state.failTransport = true; const input = production(); assert.equal((await h.call('/api/operations', input)).status, 502); assert.equal((await h.call('/api/operations', input)).status, 502); assert.equal(mutations(h).length, 2); assert.equal(mutations(h)[0].variables.key, mutations(h)[1].variables.key); assert.equal(h.store.history()[0].result, 'uncertain'); h.db.close(); });
test('sin rutas HTTP DELETE; delete sin nombre de confirmación se rechaza', async () => {
  const h = harness(); for (const path of ['/api/products', '/api/product', '/api/operations']) assert.equal((await h.call(path, null, jwt(), 'DELETE')).status, 404);
  assert.equal((await h.call('/api/operations', { ...production(), action: 'delete' })).status, 400); assert.equal(mutations(h).length, 0); h.db.close();
});
test('ids deben pertenecer a un producto y tienda consultados en este shop', async () => {
  const h = harness(); assert.equal((await h.call('/api/operations', production({ productId: 'gid://shopify/Product/999' }))).status, 404);
  assert.equal((await h.call('/api/operations', production({ variantId: 'gid://shopify/ProductVariant/999' }))).status, 400);
  assert.equal((await h.call('/api/operations', production({ locationId: 'gid://shopify/Location/999' }))).status, 400); assert.equal(mutations(h).length, 0); h.db.close();
});
test('fotos usan staged upload y media, sin volver a asociar al repetir UUID', async () => {
  const h = harness();
  const input = creation({ photos: [{ type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }] });
  assert.equal((await h.call('/api/operations', input)).status, 200);
  const ms = mutations(h); const upload = ms.find(m => m.query.includes('stagedUploadsCreate')); assert.equal(upload.variables.input[0].resource, 'IMAGE');
  assert.equal(ms.find(m => m.variables.media?.length).variables.media[0].mediaContentType, 'IMAGE'); assert.match(ms.find(m => m.variables.media?.length).variables.media[0].originalSource, /^https:\/\/shopify-staged-uploads/);
  await h.call('/api/operations', input); assert.equal(mutations(h).length, ms.length);
  assert.ok(!JSON.stringify(h.store.history()).includes(input.photos[0].data)); h.db.close();
});
test('fallo parcial de creación identifica producto y pasos guardados/fallidos', async () => {
  const h = harness(); h.mock.state.rejectRoot = 'productVariantsBulkUpdate';
  const r = await h.call('/api/operations', creation()); assert.equal(r.status, 422);
  const result = await r.json(); assert.equal(result.productId, productId); assert.deepEqual(result.steps.map(s => s.result), ['succeeded', 'failed']); assert.match(result.message, /Algunos pasos ya se guardaron/);
  const [event] = h.store.history(); assert.equal(event.result, 'failed'); assert.equal(event.productId, productId); assert.equal(event.steps[0].label, 'Crear borrador'); assert.equal(event.steps[1].result, 'failed'); h.db.close();
});

const deletion = (overrides = {}) => ({ action: 'delete', operationId: crypto.randomUUID(), productId, confirmTitle: 'Caja de prueba', ...overrides });
const deletes = h => mutations(h).filter(m => m.query.includes('productDelete'));
test('eliminar: producto no archivado se rechaza sin mutar', async () => {
  const h = harness(); const r = await h.call('/api/operations', deletion());
  assert.equal(r.status, 409); assert.equal((await r.json()).code, 'NOT_ARCHIVED'); assert.equal(deletes(h).length, 0); h.db.close();
});
test('eliminar: nombre distinto se rechaza sin mutar', async () => {
  const h = harness(); h.mock.state.product.status = 'ARCHIVED';
  const r = await h.call('/api/operations', deletion({ confirmTitle: 'Otra caja' }));
  assert.equal(r.status, 400); assert.equal(deletes(h).length, 0); h.db.close();
});
test('eliminar: archivado con nombre (sin importar mayúsculas/espacios) borra una vez y queda en historial', async () => {
  const h = harness(); h.mock.state.product.status = 'ARCHIVED';
  const input = deletion({ confirmTitle: '  caja   DE prueba ' });
  const r = await h.call('/api/operations', input); const body = await r.json();
  assert.equal(r.status, 200); assert.equal(body.message, 'Producto eliminado de Shopify.');
  assert.equal(deletes(h).length, 1); assert.equal(deletes(h)[0].variables.input.id, productId); assert.equal(h.mock.state.deleted, productId);
  assert.equal((await h.call('/api/operations', input)).status, 200); assert.equal(deletes(h).length, 1);
  const event = h.store.history().find(e => e.operationId === input.operationId);
  assert.equal(event.action, 'delete'); assert.equal(event.result, 'succeeded'); assert.equal(event.before.title, 'Caja de prueba'); h.db.close();
});
