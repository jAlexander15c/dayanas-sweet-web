import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createInventoryService } from '../src/inventory-service.mjs';
import { createShopifyClient } from '../src/shopify-client.mjs';
import { harness, production, creation, mutations, jwt, productId } from './helpers.mjs';
import { sampleProduct } from './shopify-fixture.mjs';

const staff = { staffId: '123', token: jwt() };
function wrappedService(h, intercept) {
  const waits = [];
  const fetchImpl = (url, init) => intercept(url, init, () => h.mock.fetch(url, init));
  const service = createInventoryService({ store: h.store, clientFactory: (sessionToken, staffId) => createShopifyClient({ env: h.env, sessionToken, staffId, fetchImpl, sleep: async ms => waits.push(ms) }) });
  return { service, waits };
}
function idempotencyResponse(code, shape) {
  return Response.json(shape === 'userErrors' ? { data: { inventoryAdjustQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ field: null, code, message: 'private-debug' }] } } } : { errors: [{ message: 'private-debug', extensions: { code } }], ...(shape === 'partial' ? { data: { inventoryAdjustQuantities: { inventoryAdjustmentGroup: null, userErrors: [] } } } : {}) });
}

for (const shape of ['userErrors', 'extensions', 'partial']) {
  test(`H1 A: concurrent ${shape} recupera la suma original con misma clave tras esperar`, async t => {
    const h = harness(); t.after(() => h.db.close());
    let concurrent = false;
    const { service, waits } = wrappedService(h, (url, init, next) => {
      const body = String(url).includes('graphql') ? JSON.parse(init.body) : {};
      if (concurrent && body.query?.startsWith('mutation InventoryProduction')) {
        concurrent = false; h.mock.state.calls.push(body);
        return idempotencyResponse('IDEMPOTENCY_CONCURRENT_REQUEST', shape);
      }
      return next();
    });
    const input = production(); h.mock.state.loseAfterApply = true;
    assert.equal((await service.execute(input, staff)).body.state, 'uncertain');
    concurrent = true;
    assert.equal((await service.execute(input, staff)).status, 200);
    assert.deepEqual(waits, [2000]);
    assert.equal(h.mock.state.applied, 1);
    assert.equal(h.mock.state.product.variants.nodes[0].inventoryItem.inventoryLevels.nodes[0].quantities[0].quantity, 10);
    assert.equal(mutations(h).length, 3);
    for (const mutation of mutations(h)) assert.deepEqual(mutation, mutations(h)[0]);
    assert.equal(h.store.get(input.operationId).state, 'succeeded');
  });
  for (const code of ['IDEMPOTENCY_CONCURRENT_REQUEST', 'IDEMPOTENCY_KEY_PARAMETER_MISMATCH']) {
    test(`H1: ${code} persistente en ${shape} nunca termina failed`, async t => {
      const h = harness(); t.after(() => h.db.close());
      const { service, waits } = wrappedService(h, (url, init, next) => {
        const body = String(url).includes('graphql') ? JSON.parse(init.body) : {};
        if (body.query?.startsWith('mutation InventoryProduction')) { h.mock.state.calls.push(body); return idempotencyResponse(code, shape); }
        return next();
      });
      const input = production(); const result = await service.execute(input, staff);
      const concurrent = code === 'IDEMPOTENCY_CONCURRENT_REQUEST';
      assert.equal(result.body.code, 'REVIEW_REQUIRED'); assert.equal(result.body.state, 'uncertain');
      assert.equal(result.body.retryable, concurrent);
      assert.equal(h.store.get(input.operationId).state, 'uncertain');
      assert.equal(h.store.history()[0].steps[0].result, 'uncertain');
      assert.equal(service.history()[0].retryable, concurrent);
      assert.deepEqual(waits, concurrent ? [2000] : []);
      assert.equal(mutations(h).length, concurrent ? 2 : 1);
      assert.ok(mutations(h).every(m => m.variables.key === input.operationId));
      assert.ok(!result.body.message.includes('private-debug'));
      if (concurrent) assert.match(result.body.message, /Shopify aún está guardando este cambio\. Espera un momento y pulsa Reintentar; no lo hagas de nuevo\./);
      else { await service.execute(input, staff); assert.equal(mutations(h).length, 1); }
    });
  }
}

test('H1: respuesta incierta del primer intento no reintenta producción con clave nueva aunque haya una venta', async t => {
  const h = harness(); t.after(() => h.db.close());
  h.mock.state.loseAfterApply = true; const input = production();
  assert.equal((await h.service.execute(input, staff)).body.state, 'uncertain');
  assert.equal(mutations(h).length, 1);
  h.mock.state.product.variants.nodes[0].inventoryItem.inventoryLevels.nodes[0].quantities[0].quantity--;
  assert.equal((await h.service.execute(input, staff)).status, 200);
  assert.equal(h.mock.state.applied, 1); assert.equal(mutations(h).length, 2);
  assert.deepEqual(mutations(h)[0], mutations(h)[1]);
});

test('H2 G: create aplicado con respuesta perdida bloquea otro título normalizado y encuentra su borrador', async t => {
  const h = harness(); t.after(() => h.db.close());
  let lose = true;
  const { service } = wrappedService(h, async (url, init, next) => {
    const result = await next();
    if (lose && String(url).includes('graphql') && JSON.parse(init.body).query.startsWith('mutation InventoryCreate')) { lose = false; throw Error('lost'); }
    return result;
  });
  const first = await service.execute(creation(), staff);
  assert.equal(first.body.state, 'uncertain'); assert.equal(first.body.productId, null);
  const second = await service.execute(creation({ title: '  NUEVO   brownie  ' }), staff);
  assert.equal(second.body.code, 'RECENT_DRAFT'); assert.equal(second.body.productId, productId);
  assert.match(second.body.message, /Shopify/);
  assert.equal(mutations(h).filter(m => m.query.includes('productCreate')).length, 1);
  assert.ok(h.mock.state.calls.some(c => c.variables.query === 'title:NUEVO* title:brownie*'));
});

test('H2: create incierto sin productId bloquea aunque búsqueda todavía no encuentre el borrador', async t => {
  const h = harness(); t.after(() => h.db.close()); h.mock.state.failTransport = true;
  assert.equal((await h.service.execute(creation(), staff)).body.state, 'uncertain');
  h.mock.state.failTransport = false;
  const result = await h.service.execute(creation(), staff);
  assert.equal(result.body.code, 'RECENT_DRAFT'); assert.match(result.body.message, /Shopify/);
  assert.equal(mutations(h).filter(m => m.query.includes('productCreate')).length, 1);
});

test('H2: busca todas las páginas y bloquea DRAFT exacto aun fuera de auditoría', async t => {
  const h = harness(); t.after(() => h.db.close());
  const { service } = wrappedService(h, (url, init, next) => {
    const body = String(url).includes('graphql') ? JSON.parse(init.body) : {};
    if (body.query?.startsWith('query InventorySearch')) {
      h.mock.state.calls.push(body);
      const p = sampleProduct(); p.title = body.variables.after ? 'NUEVO BROWNIE' : 'Nuevo brownie grande';
      return Response.json({ data: { products: { nodes: [p], pageInfo: { hasNextPage: !body.variables.after, endCursor: body.variables.after ? null : 'next' } } } });
    }
    return next();
  });
  assert.equal((await service.execute(creation(), staff)).body.code, 'RECENT_DRAFT');
  assert.equal(mutations(h).length, 0);
});

test('H3 B: borrador reciente eliminado no bloquea nueva creación', async t => {
  const h = harness(); t.after(() => h.db.close());
  assert.equal((await h.service.execute(creation(), staff)).status, 200);
  h.mock.state.product.id = 'gid://shopify/Product/999';
  // El producto restante no es el borrador borrado ni tiene su título.
  h.mock.state.product.title = 'Otro producto';
  assert.equal((await h.service.execute(creation(), staff)).status, 200);
  assert.equal(mutations(h).filter(m => m.query.includes('productCreate')).length, 2);
});

// Run the real UI script with a minimal DOM/form surface; all API calls stay local.
async function uiReview({ action = 'create', events = [], productResponse, searchNodes = [], quantity = '5', title = ' NUEVO   brownie ' } = {}) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { textContent: '', innerHTML: '', value: '', classList: { toggle() {} }, addEventListener() {}, append() {}, reportValidity: () => true, showModal() { this.open = true; }, elements: { photos: { files: [] } } });
    return elements.get(selector);
  };
  const calls = [];
  const sandbox = vm.createContext({ console, URL, Intl, crypto, setTimeout, document: { querySelector: element, createElement: () => ({ append() {} }) }, window: { shopify: { idToken: async () => 'synthetic' } }, FormData: class { get(key) { return { title, description: '', price: '15', sku: '', quantity, reason: 'Conteo' }[key]; } }, fetch: async path => {
    calls.push(path);
    if (path === '/api/session') return Response.json({ staffId: '123' });
    if (path === '/api/locations') return Response.json({ locations: [{ id: 'gid://shopify/Location/401' }] });
    if (path === '/api/categories') return Response.json({ categories: [] });
    if (path === '/api/history') return Response.json({ events });
    if (path.startsWith('/api/product?')) return productResponse;
    if (path.startsWith('/api/products?')) return Response.json({ nodes: searchNodes, pageInfo: { hasNextPage: false } });
    throw Error('Unexpected local API call: ' + path);
  } });
  await vm.runInContext(await readFile(new URL('../src/admin-ui.js', import.meta.url), 'utf8'), sandbox);
  const product = sampleProduct();
  // Physical=10, available=4, committed=2: four additional boxes are unavailable.
  product.variants.nodes[0].inventoryItem.inventoryLevels.nodes[0].quantities[1].quantity = 10;
  sandbox.fixture = { action, product: action === 'create' ? null : product, variant: product.variants.nodes[0], level: product.variants.nodes[0].inventoryItem.inventoryLevels.nodes[0] };
  await vm.runInContext('context = fixture; review({ preventDefault() {} })', sandbox);
  return { elements, calls };
}

test('H4 UI: disponibles usa conteo menos todos los no disponibles, no solo committed', async () => {
  const { elements } = await uiReview({ action: 'correction' });
  assert.match(elements.get('#summary').innerHTML, /Disponibles quedarán en -1/);
});
test('H2 UI: create incierto sin ID bloquea confirmación aunque no aparezca en búsqueda', async () => {
  const { elements, calls } = await uiReview({ events: [{ action: 'create', result: 'uncertain', productId: null, date: new Date().toISOString(), change: { title: 'Nuevo brownie' } }] });
  assert.match(elements.get('#editor-error')?.textContent || '', /Shopify/);
  assert.equal(elements.get('#confirmation')?.open, undefined);
  assert.ok(calls.some(path => path.startsWith('/api/products?q=')));
});
test('H3 UI: 404 PRODUCT_NOT_FOUND en candidato eliminado permite confirmar', async () => {
  const { elements } = await uiReview({ title: 'Nuevo brownie', events: [{ action: 'create', result: 'succeeded', productId, date: new Date().toISOString(), change: { title: 'Nuevo brownie' } }], productResponse: Response.json({ code: 'PRODUCT_NOT_FOUND', message: 'No existe' }, { status: 404 }) });
  assert.equal(elements.get('#confirmation')?.open, true);
});
test('H2 UI: buscar duplicados respeta límite de búsqueda de 100 caracteres para títulos de 200', async () => {
  const { elements, calls } = await uiReview({ title: 'a'.repeat(200) });
  assert.equal(elements.get('#confirmation')?.open, true);
  for (const path of calls.filter(path => path.startsWith('/api/products?q='))) {
    assert.ok(new URL(path, 'https://panel.test').searchParams.get('q').length <= 100);
  }
});
test('UI bloquea coincidencia ACTIVE exacta aunque no esté en el historial', async () => {
  const { elements } = await uiReview({ title: 'Nuevo brownie', searchNodes: [{ ...sampleProduct(), title: 'Nuevo brownie', status: 'ACTIVE' }] });
  assert.match(elements.get('#editor-error').textContent, /producto reciente/);
  assert.equal(elements.get('#confirmation')?.open, undefined);
});
