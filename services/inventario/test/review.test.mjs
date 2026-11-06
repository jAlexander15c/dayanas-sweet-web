import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from '../src/shopify-auth.mjs';
import { createInventoryService } from '../src/inventory-service.mjs';
import { createShopifyClient } from '../src/shopify-client.mjs';
import { formattedDescription, operation, fingerprint } from '../src/validation.mjs';
import { harness, editing, production, correction, creation, mutations, jwt, testEnv, productId } from './helpers.mjs';

for (const html of ['<p>Texto<br>otra línea</p>', '<p><strong>Texto</strong> <a href="https://example.com">enlace</a></p><ul><li>Lista</li></ul>']) {
  for (const change of [{ status: 'ARCHIVED' }, { price: '20.00' }, { photos: [{ type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }] }]) {
    test(`editar ${Object.keys(change)[0]} conserva HTML ${html.includes('strong') ? 'con formato' : 'simple'}`, async () => {
      const h = harness(); h.mock.state.product.descriptionHtml = html;
      const result = await h.call('/api/operations', editing(h, change));
      assert.equal(result.status, 200); assert.equal(h.mock.state.product.descriptionHtml, html);
      for (const m of mutations(h).filter(m => m.query.includes('productUpdate'))) assert.equal(Object.hasOwn(m.variables.product, 'descriptionHtml'), false);
      assert.equal(h.store.history()[0].before.descriptionHtml, html); h.db.close();
    });
  }
}
test('solo envía descripción simple cuando se declara un cambio; formato es solo lectura incluso con cliente manipulado', async () => {
  const h = harness();
  assert.equal((await h.call('/api/operations', editing(h, { description: 'Nueva\nlínea', descriptionChanged: true }))).status, 200);
  assert.equal(h.mock.state.product.descriptionHtml, '<p>Nueva<br>línea</p>');
  h.mock.state.product.descriptionHtml = '<p><b>Importante</b></p>';
  assert.equal((await h.call('/api/operations', editing(h, { description: 'Otra', descriptionChanged: true }))).status, 200);
  assert.equal(h.mock.state.product.descriptionHtml, '<p><b>Importante</b></p>');
  assert.equal(formattedDescription('<p>Simple<br/>texto</p>'), false);
  assert.equal(formattedDescription('<p class="x">Texto</p>'), true); h.db.close();
});
test('una descripción larga con formato no impide editar otro campo', async () => {
  const h = harness(); h.mock.state.product.descriptionHtml = `<p><strong>${'x'.repeat(6000)}</strong></p>`;
  h.mock.state.product.description = 'x'.repeat(6000);
  assert.equal((await h.call('/api/operations', editing(h, { price: '13.00' }))).status, 200);
  assert.equal(h.mock.state.product.descriptionHtml.length, 6024); h.db.close();
});
test('HTML anterior queda en el checkpoint durable antes de enviar productUpdate', async () => {
  const h = harness(), input = editing(h, { status: 'ARCHIVED' });
  const service = createInventoryService({ store: h.store, clientFactory: (token, id) => {
    const client = h.clientFactory(token, id);
    return { ...client, update(...args) {
      assert.equal(h.store.event(input.operationId).before.descriptionHtml, input.expectedProduct.descriptionHtml);
      return client.update(...args);
    } };
  } });
  assert.equal((await service.execute(input, { staffId: '123', token: jwt() })).status, 200); h.db.close();
});

test('errors GraphQL con data de mutación es uncertain; nunca failed', async () => {
  const h = harness(); h.mock.state.graphqlCode = 'INTERNAL_SERVER_ERROR'; h.mock.state.partialData = true;
  const result = await h.call('/api/operations', production());
  assert.equal(result.status, 502); assert.equal((await result.json()).state, 'uncertain');
  assert.equal(h.store.history()[0].result, 'uncertain'); assert.equal(h.store.history()[0].steps[0].result, 'uncertain'); h.db.close();
});
test('THROTTLED reintenta una vez tras esperar con la misma clave y variables', async () => {
  const h = harness(); const input = production(); h.mock.state.graphqlCode = 'THROTTLED';
  const waits = [];
  const client = createShopifyClient({ env: h.env, sessionToken: jwt(), staffId: '123', fetchImpl: h.mock.fetch, sleep: async ms => waits.push(ms) });
  await client.adjust({ inventoryItemId: h.mock.state.product.variants.nodes[0].inventoryItem.id, locationId: input.locationId, expected: 4, delta: 6, key: input.operationId });
  assert.deepEqual(waits, [1000]); assert.equal(mutations(h).length, 2); assert.deepEqual(mutations(h)[0], mutations(h)[1]); assert.equal(h.mock.state.applied, 1); h.db.close();
});
test('THROTTLED persistente tiene código propio y mensaje seguro', async () => {
  const h = harness(); h.mock.state.graphqlCode = 'THROTTLED'; h.mock.state.keepGraphqlCode = true;
  const response = await h.call('/api/operations', production()); assert.equal(response.status, 503);
  assert.deepEqual((await response.json()).message, 'Shopify está ocupado, intenta en unos segundos');
  assert.equal(h.store.history()[0].error.code, 'THROTTLED'); assert.equal(mutations(h).length, 2); h.db.close();
});
test('ACCESS_DENIED se devuelve 403 sin revelar errores de GraphQL', async () => {
  const h = harness(); h.mock.state.graphqlCode = 'ACCESS_DENIED';
  const response = await h.call('/api/operations', production()); assert.equal(response.status, 403);
  const body = await response.json(); assert.equal(body.code, 'ACCESS_DENIED'); assert.match(body.message, /permisos/); assert.ok(!body.message.includes('private-debug')); h.db.close();
});

for (const makeInput of [production, correction]) test(`${makeInput.name}: respuesta perdida después de aplicar se resuelve tras reiniciar con misma clave sin doble mutación`, async () => {
  const h = harness(); const input = makeInput(); h.mock.state.loseAfterApply = true;
  const first = await h.call('/api/operations', input); assert.equal(first.status, 502);
  assert.equal((await first.json()).retryable, true); assert.equal(h.mock.state.applied, 1);
  const restarted = createInventoryService({ store: h.store, clientFactory: h.clientFactory });
  const replay = await restarted.execute(input, { staffId: '123', token: jwt() });
  assert.equal(replay.status, 200); assert.equal(h.mock.state.applied, 1);
  assert.deepEqual(mutations(h)[0], mutations(h)[1]); assert.equal(h.store.history().length, 1); assert.equal(h.store.history()[0].result, 'succeeded'); h.db.close();
});
test('pending colgado con checkpoint se reintenta tras 2 min y deja el mismo recibo confirmado', async () => {
  const h = harness(), input = production();
  h.mock.state.loseAfterApply = true; await h.call('/api/operations', input);
  const row = h.store.get(input.operationId), event = h.store.event(input.operationId);
  const oldDate = new Date(Date.now() - 121_000).toISOString(); event.date = oldDate;
  h.db.prepare('UPDATE operations SET state = ?, response = NULL, created_at = ? WHERE operation_id = ?').run('pending', oldDate, input.operationId);
  h.store.checkpoint(input.operationId, event);
  const restarted = createInventoryService({ store: h.store, clientFactory: h.clientFactory });
  assert.equal(restarted.history()[0].result, 'uncertain'); assert.equal(restarted.history()[0].retryable, true);
  assert.equal((await restarted.execute(input, { staffId: row.staff_id, token: jwt() })).status, 200);
  assert.equal(h.mock.state.applied, 1); h.db.close();
});
test('pending antes de enviar inventario también permite recuperar con la misma operación después de reiniciar', async () => {
  const h = harness(), input = production(); const normalized = operation(input);
  const date = new Date(Date.now() - 121_000).toISOString();
  h.store.begin(input.operationId, await fingerprint(normalized), '123', date, { id: crypto.randomUUID(), operationId: input.operationId, action: 'production', productId: input.productId, variantId: input.variantId, locationId: input.locationId, staffId: '123', date, result: 'pending', steps: [], retryInput: normalized });
  const restarted = createInventoryService({ store: h.store, clientFactory: h.clientFactory });
  assert.equal(restarted.history()[0].retryable, true); assert.equal(h.store.get(input.operationId).state, 'uncertain');
  assert.equal((await restarted.execute(input, { staffId: '123', token: jwt() })).status, 200);
  assert.equal(mutations(h)[0].variables.key, input.operationId); assert.equal(h.mock.state.applied, 1); h.db.close();
});
test('recuperación de respuesta perdida consulta la mutación original aunque el producto ya no esté disponible', async () => {
  const h = harness(), input = production(); h.mock.state.loseAfterApply = true; await h.call('/api/operations', input);
  h.mock.state.product.id = 'gid://shopify/Product/999';
  assert.equal((await h.call('/api/operations', input)).status, 200); assert.equal(h.mock.state.applied, 1); h.db.close();
});
test('incierto no se reenvía pasadas 24 horas ni con otros datos', async () => {
  const h = harness(), input = production(); h.mock.state.loseAfterApply = true; await h.call('/api/operations', input);
  const restarted = createInventoryService({ store: h.store, clientFactory: h.clientFactory, now: () => new Date(Date.now() + 86_400_001).toISOString() });
  assert.equal((await restarted.execute(input, { staffId: '123', token: jwt() })).body.retryable, false);
  await assert.rejects(restarted.execute({ ...input, quantity: 9 }, { staffId: '123', token: jwt() }), e => e.code === 'OPERATION_REUSED');
  assert.equal(mutations(h).length, 1); h.db.close();
});
test('producto incierto no se vuelve a crear; no existe @idempotent en productCreate', async () => {
  const h = harness(); h.mock.state.graphqlCode = 'INTERNAL_SERVER_ERROR'; h.mock.state.partialData = true;
  const input = creation(); assert.equal((await h.call('/api/operations', input)).status, 502);
  assert.equal((await h.call('/api/operations', input)).status, 409); assert.equal(mutations(h).length, 1); h.db.close();
});
test('creación con errors generales conserva productId del resultado parcial para abrir el borrador', async () => {
  const h = harness(); h.mock.state.graphqlCode = 'INTERNAL_SERVER_ERROR'; h.mock.state.partialData = true; h.mock.state.partialProductId = productId;
  const response = await h.call('/api/operations', creation()); assert.equal(response.status, 502);
  const body = await response.json(); assert.equal(body.state, 'uncertain'); assert.equal(body.productId, productId);
  assert.equal(h.store.history()[0].productId, productId); h.db.close();
});

test('producción tolera venta desde abrir formulario y CAS concurrente con claves nuevas solo tras rechazo', async () => {
  const h = harness(); const input = production();
  h.mock.state.product.variants.nodes[0].inventoryItem.inventoryLevels.nodes[0].quantities[0].quantity = 2;
  h.mock.state.stale = true;
  const response = await h.call('/api/operations', input); assert.equal(response.status, 200); assert.deepEqual((await response.json()).after, { available: 9 });
  const ms = mutations(h); assert.equal(ms.length, 2); assert.equal(ms[0].variables.input.changes[0].changeFromQuantity, 2);
  assert.equal(ms[1].variables.input.changes[0].changeFromQuantity, 3); assert.equal(ms[0].variables.key, input.operationId); assert.equal(ms[1].variables.key, `${input.operationId}:cas:1`);
  assert.equal(h.mock.state.applied, 1); h.db.close();
});
test('producción limita CAS a dos reintentos', async () => {
  const h = harness();
  const factory = (sessionToken, staffId) => createShopifyClient({ env: h.env, sessionToken, staffId, fetchImpl: async (url, init) => {
    if (String(url).includes('graphql.json') && JSON.parse(init.body).query.startsWith('mutation')) h.mock.state.stale = true;
    return h.mock.fetch(url, init);
  } });
  const service = createInventoryService({ store: h.store, clientFactory: factory });
  assert.equal((await service.execute(production(), { staffId: '123', token: jwt() })).status, 409);
  assert.equal(mutations(h).length, 3); assert.equal(h.mock.state.applied, 0); h.db.close();
});
test('búsqueda genera prefijos sin comillas y elimina operadores especiales', async () => {
  const h = harness(); await h.call('/api/products?q=' + encodeURIComponent('brownie caja:*" (choco) - OR'));
  const search = h.mock.state.calls.find(c => c.query.includes('query InventorySearch'));
  assert.equal(search.variables.query, 'title:brownie* title:caja* title:choco* title:OR*');
  assert.match(search.query, /descriptionHtml/); h.db.close();
});
for (const field of ['title', 'price', 'sku', 'status', 'descriptionHtml']) test(`edición con CAS detecta cambio en ${field} antes de mutar y devuelve valores actuales`, async () => {
  const h = harness(), input = editing(h);
  if (['price', 'sku'].includes(field)) h.mock.state.product.variants.nodes[0][field] = field === 'price' ? '16.00' : 'OTRO';
  else h.mock.state.product[field] = field === 'status' ? 'ACTIVE' : 'Cambiado';
  const response = await h.call('/api/operations', input); assert.equal(response.status, 409);
  const body = await response.json(); assert.equal(body.code, 'PRODUCT_CHANGED'); assert.ok(body.current[field]); assert.equal(mutations(h).length, 0); h.db.close();
});
test('CAS compara precios y SKU de todas las opciones aunque se editen desde Shopify', async () => {
  const h = harness(); const second = structuredClone(h.mock.state.product.variants.nodes[0]);
  second.id = 'gid://shopify/ProductVariant/202'; h.mock.state.product.variants.nodes.push(second);
  const input = editing(h, { price: undefined, sku: undefined }); second.price = '99.00';
  const response = await h.call('/api/operations', input); assert.equal(response.status, 409);
  assert.equal((await response.json()).current.variants[1].price, '99.00'); assert.equal(mutations(h).length, 0); h.db.close();
});
test('creación parcial ofrece productId y bloquea otro borrador reciente con el mismo título', async () => {
  const h = harness(); h.mock.state.rejectRoot = 'productVariantsBulkUpdate';
  const input = creation(); const first = await h.call('/api/operations', input); assert.equal(first.status, 422); assert.equal((await first.json()).productId, productId);
  h.mock.state.rejectRoot = null;
  const response = await h.call('/api/operations', { ...input, operationId: crypto.randomUUID() });
  assert.equal(response.status, 409); const body = await response.json(); assert.equal(body.code, 'RECENT_DRAFT'); assert.equal(body.productId, productId);
  assert.equal(mutations(h).filter(m => m.query.includes('productCreate')).length, 1); h.db.close();
});

test('límites exp/nbf e iat respetan exactamente tolerancia de 3 segundos', async () => {
  const now = 2_000_000_000;
  for (const [override, accepted] of [[{ exp: now - 3 }, false], [{ exp: now - 2 }, true], [{ nbf: now + 3 }, true], [{ nbf: now + 4 }, false], [{ iat: now + 3 }, true], [{ iat: now + 4 }, false]]) {
    const token = jwt({ iat: now - 60, nbf: now - 60, exp: now + 60, ...override });
    const request = new Request('https://panel.test/api/session', { headers: { Authorization: `Bearer ${token}` } });
    if (accepted) assert.equal((await authenticate(request, testEnv, now)).staffId, '123');
    else await assert.rejects(authenticate(request, testEnv, now), e => e.status === 401);
  }
});
test('token online verifica associated_user, cachea por persona y renueva al vencer', async () => {
  const h = harness(); let time = Date.now(); const now = () => time;
  const make = staffId => createShopifyClient({ env: h.env, sessionToken: jwt({ sub: staffId }), staffId, fetchImpl: h.mock.fetch, now });
  await make('123').locations(); await make('123').locations(); assert.equal(h.mock.state.exchanges, 1);
  await make('999').locations(); assert.equal(h.mock.state.exchanges, 2);
  time += 3_600_001; await make('123').locations(); assert.equal(h.mock.state.exchanges, 3);
  const otherEnv = { ...h.env };
  const bad = createShopifyClient({ env: otherEnv, sessionToken: jwt(), staffId: '123', fetchImpl: async () => Response.json({ access_token: 'private', expires_in: 3600, associated_user: { id: 999 } }) });
  await assert.rejects(bad.locations(), e => e.status === 403); h.db.close();
});
