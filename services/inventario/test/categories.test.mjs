import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness, creation, editing, mutations, jwt, productId } from './helpers.mjs';
import { categoryId, sampleCategory } from './shopify-fixture.mjs';
import { categorySnapshot, categoryIds } from '../src/categories.mjs';
import { REQUIRED_SCOPES, createShopifyClient } from '../src/shopify-client.mjs';
import { createInventoryService } from '../src/inventory-service.mjs';

const photo = { type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
const categoryInput = (overrides = {}) => ({ action: 'category_create', operationId: crypto.randomUUID(), title: 'Tortas de prueba', description: 'Para compartir', altText: 'Torta de chocolate', photo, ...overrides });
const editInput = (h, overrides = {}) => categoryInput({ action: 'category_edit', categoryId, expectedCategory: categorySnapshot(h.mock.state.collections[0]), title: h.mock.state.collections[0].title, photo: null, orden: 1, ...overrides });
const close = (t, h) => t.after(() => h.db.close());

test('crear categoría manual con foto, tres metafields públicos y publicación Online Store; recibo idempotente', async t => {
  const h = harness(); close(t, h);
  const input = categoryInput();
  const responses = await Promise.all([h.call('/api/operations', input), h.call('/api/operations', input)]);
  assert.equal(responses[0].status, 200);
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  const ms = mutations(h);
  const definitions = ms.filter(m => m.query.includes('metafieldDefinitionCreate'));
  assert.equal(definitions.length, 3);
  assert.deepEqual(definitions.map(m => [m.variables.definition.key, m.variables.definition.type, m.variables.definition.ownerType, m.variables.definition.access.storefront]), [['categoria', 'boolean', 'COLLECTION', 'PUBLIC_READ'], ['en_inicio', 'boolean', 'COLLECTION', 'PUBLIC_READ'], ['orden', 'number_integer', 'COLLECTION', 'PUBLIC_READ']]);
  const create = ms.find(m => m.query.includes('collectionCreate')).variables.collection;
  assert.equal(create.sources, undefined);
  assert.equal(create.image.altText, 'Torta de chocolate');
  assert.deepEqual(create.metafields.map(m => [m.namespace, m.key, m.value]), [['dayana', 'categoria', 'true'], ['dayana', 'en_inicio', 'true'], ['dayana', 'orden', '2']]);
  assert.equal(h.mock.state.published.length, 1);
  assert.match(h.mock.state.published[0].id, /Collection/);
  assert.equal(h.store.history()[0].after.published, true);
  assert.equal(ms.filter(m => m.query.includes('collectionCreate')).length, 1);
  assert.ok(ms.every(m => !m.query.includes('@idempotent')));
});

test('definiciones existentes se reutilizan; se habilita lectura storefront si falta', async t => {
  const h = harness(); close(t, h);
  await h.call('/api/operations', categoryInput());
  h.mock.state.definitions[0].access.storefront = 'NONE';
  h.mock.state.calls = [];
  assert.equal((await h.call('/api/operations', categoryInput({ title: 'Galletas' }))).status, 200);
  assert.equal(mutations(h).filter(m => m.query.includes('metafieldDefinitionCreate')).length, 0);
  assert.equal(mutations(h).filter(m => m.query.includes('metafieldDefinitionUpdate')).length, 1);
  assert.equal(h.mock.state.definitions[0].access.storefront, 'PUBLIC_READ');
});

test('definición con tipo incompatible bloquea sin crear colección', async t => {
  const h = harness(); close(t, h);
  h.mock.state.definitions = [{ key: 'categoria', type: { name: 'single_line_text_field' }, access: { storefront: 'PUBLIC_READ' } }];
  const r = await h.call('/api/operations', categoryInput());
  assert.equal(r.status, 409); assert.equal((await r.json()).code, 'CATEGORY_DEFINITION_CONFLICT');
  assert.equal(mutations(h).length, 0);
});

test('bloquea título duplicado normalizado incluso si la colección no es categoría', async t => {
  const h = harness(); close(t, h);
  h.mock.state.collections[0].categoria = null;
  const r = await h.call('/api/operations', categoryInput({ title: '  BROWNIES   de prueba  ' }));
  assert.equal(r.status, 409); assert.equal((await r.json()).code, 'CATEGORY_EXISTS'); assert.equal(mutations(h).length, 0);
});

test('respuesta perdida en collectionCreate requiere revisión y bloquea recrear con otro operationId', async t => {
  const h = harness(); close(t, h);
  h.mock.state.loseRoot = 'collectionCreate';
  const input = categoryInput();
  const r = await h.call('/api/operations', input);
  assert.equal(r.status, 502); const body = await r.json(); assert.equal(body.code, 'REVIEW_REQUIRED'); assert.equal(body.retryable, false);
  const count = mutations(h).length;
  assert.equal((await h.call('/api/operations', input)).status, 409); assert.equal(mutations(h).length, count);
  assert.equal((await h.call('/api/operations', categoryInput())).status, 409);
  assert.equal(mutations(h).length, count);
  assert.equal(h.mock.state.collections.filter(c => c.title === input.title).length, 1);
});

test('editar categoría compara con lo leído, conserva foto y permite ocultar de portada', async t => {
  const h = harness(); close(t, h);
  const stale = editInput(h); h.mock.state.collections[0].enInicio.value = 'false';
  assert.equal((await h.call('/api/operations', stale)).status, 409); assert.equal(mutations(h).length, 0);
  const r = await h.call('/api/operations', editInput(h, { enInicio: false, altText: 'Caja abierta de brownies' }));
  assert.equal(r.status, 200);
  const data = mutations(h).find(m => m.query.includes('collectionUpdate')).variables.input;
  assert.equal(data.image.src, undefined);
  assert.equal(data.image.id, h.mock.state.collections[0].image.id);
  assert.equal(data.image.altText, 'Caja abierta de brownies');
  assert.equal(data.metafields.find(m => m.key === 'en_inicio').value, 'false');
});

test('subir/bajar orden compara toda la lista, normaliza posiciones y audita cada paso', async t => {
  const h = harness(); close(t, h);
  const second = sampleCategory({ id: 'gid://shopify/Collection/702', title: 'Tortas', orden: { value: '1' } });
  h.mock.state.collections.push(second);
  const categories = (await (await h.call('/api/categories')).json()).categories;
  const input = { action: 'category_order', operationId: crypto.randomUUID(), categoryId: second.id, direction: -1, expectedCategories: categories.map(categorySnapshot) };
  assert.equal((await h.call('/api/operations', input)).status, 200);
  assert.equal(second.orden.value, '1'); assert.equal(h.mock.state.collections[0].orden.value, '2');
  assert.equal(h.store.history()[0].before.length, 2);
  assert.equal(h.store.history()[0].after[0].id, second.id);
  assert.equal((await h.call('/api/operations', { ...input, operationId: crypto.randomUUID() })).status, 409);
});

test('crear producto exige categoría válida y la asigna; las colecciones automáticas no sirven', async t => {
  const h = harness(); close(t, h);
  assert.equal((await h.call('/api/operations', creation({ categoryId: undefined }))).status, 400);
  assert.equal((await h.call('/api/operations', creation({ categoryId: 'gid://shopify/Collection/999' }))).status, 400);
  h.mock.state.collections[0].sources = [{ __typename: 'CollectionConditionsSource', inclusion: { conditions: [{ id: 'automatic' }] } }];
  assert.equal((await h.call('/api/operations', creation())).status, 400);
  assert.equal(mutations(h).length, 0);
  h.mock.state.collections[0].sources = [];
  assert.equal((await h.call('/api/operations', creation())).status, 200);
  assert.deepEqual(categoryIds(h.mock.state.product), [categoryId]);
});

test('cambiar categoría agrega la nueva, quita anteriores y conserva colecciones ajenas', async t => {
  const h = harness(); close(t, h);
  const second = sampleCategory({ id: 'gid://shopify/Collection/702', title: 'Tortas' }); h.mock.state.collections.push(second);
  h.mock.state.product.collections.nodes = [sampleCategory(), { id: 'gid://shopify/Collection/799', title: 'Promociones', categoria: null }];
  const input = editing(h, { categoryId: second.id }); input.expectedProduct.categoryIds = [categoryId];
  assert.equal((await h.call('/api/operations', input)).status, 200);
  assert.deepEqual(categoryIds(h.mock.state.product), [second.id]);
  assert.ok(h.mock.state.product.collections.nodes.some(c => c.title === 'Promociones'));
  const membership = mutations(h).filter(m => /collection(Add|Remove)Products/.test(m.query));
  assert.equal(membership.length, 2); assert.equal(membership[0].variables.id, second.id); assert.equal(membership[1].variables.id, categoryId);
});

test('categoría cambiada concurrentemente bloquea la edición antes de mutar', async t => {
  const h = harness(); close(t, h);
  const input = editing(h, { categoryId }); input.expectedProduct.categoryIds = [];
  h.mock.state.product.collections.nodes.push(sampleCategory());
  const r = await h.call('/api/operations', input); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'PRODUCT_CHANGED'); assert.equal(mutations(h).length, 0);
});

test('CAS de categorías también protege una edición de precio sin cambiar la categoría', async t => {
  const h = harness(); close(t, h);
  const input = editing(h, { price: '18.00' });
  h.mock.state.product.collections.nodes.push(sampleCategory());
  assert.equal((await h.call('/api/operations', input)).status, 409);
  assert.equal(mutations(h).length, 0);
});

test('fallo de lectura después de asignar categoría exige revisión sin repetir la asignación', async t => {
  const h = harness(); close(t, h);
  let assigned = false;
  const service = createInventoryService({ store: h.store, clientFactory: (token, staffId) => {
    const client = h.clientFactory(token, staffId);
    return { ...client, async addProducts(...args) { const result = await client.addProducts(...args); assigned = true; return result; }, async product(...args) { if (assigned) throw Object.assign(Error('Read failed'), { code: 'SHOPIFY_QUERY_FAILED', status: 502 }); return client.product(...args); } };
  } });
  const input = editing(h, { categoryId });
  const result = await service.execute(input, { staffId: '123', token: jwt() });
  assert.equal(result.status, 502); assert.equal(result.body.state, 'uncertain'); assert.equal(result.body.retryable, false);
  const count = mutations(h).length;
  assert.equal((await service.execute(input, { staffId: '123', token: jwt() })).status, 409);
  assert.equal(mutations(h).length, count);
});

test('paginación completa: publicaciones, colecciones, definiciones y pertenencias de productos', async t => {
  const h = harness(); close(t, h);
  const seen = [];
  const client = createShopifyClient({ env: h.env, sessionToken: jwt(), staffId: '123', sleep: async () => {}, fetchImpl: (url, init) => {
    if (!String(url).includes('graphql.json')) return h.mock.fetch(url, init);
    const { query, variables } = JSON.parse(init.body);
    const after = variables.after;
    const page = { hasNextPage: !after, endCursor: after ? null : 'next' };
    seen.push([query.split('(')[0], after]);
    if (query.includes('query InventoryPublications')) return Response.json({ data: { publications: { nodes: [{ id: after ? 'gid://shopify/Publication/802' : 'gid://shopify/Publication/801', channels: { nodes: [{ handle: after ? 'online_store' : 'other' }], pageInfo: { hasNextPage: false } } }], pageInfo: page } } });
    if (query.includes('query InventoryCollections')) return Response.json({ data: { collections: { nodes: [sampleCategory({ id: after ? 'gid://shopify/Collection/702' : categoryId, title: after ? 'A' : 'Z', orden: { value: '1' } })], pageInfo: page } } });
    if (query.includes('query InventoryCategoryDefinitions')) return Response.json({ data: { metafieldDefinitions: { nodes: after ? [['categoria', 'boolean'], ['en_inicio', 'boolean'], ['orden', 'number_integer']].map(([key, type]) => ({ id: `definition-${key}`, key, type: { name: type }, access: { storefront: 'PUBLIC_READ' } })) : [], pageInfo: page } } });
    if (query.includes('query InventorySearch')) return Response.json({ data: { products: { nodes: [{ ...h.mock.state.product, collections: { nodes: [{ id: 'gid://shopify/Collection/799', title: 'Promociones', categoria: null }], pageInfo: { hasNextPage: true, endCursor: 'members' } } }], pageInfo: { hasNextPage: false } } } });
    if (query.includes('query InventoryMembership')) return Response.json({ data: { product: { collections: { nodes: [sampleCategory()], pageInfo: { hasNextPage: false } } } } });
    throw Error('Unexpected GraphQL request');
  } });
  assert.equal(await client.onlineStorePublication(), 'gid://shopify/Publication/802');
  assert.deepEqual((await client.categories()).categories.map(c => c.title), ['A', 'Z']);
  await client.ensureCategoryDefinitions();
  assert.deepEqual(categoryIds((await client.search()).nodes[0]), [categoryId]);
  assert.ok(seen.some(([name, after]) => name.includes('InventoryMembership') && after === 'members'));
  assert.equal(mutations(h).length, 0);
});

test('job de quitar categoría sin confirmar termina incierto y no permite repetir mutaciones', async t => {
  const h = harness(); close(t, h);
  const second = sampleCategory({ id: 'gid://shopify/Collection/702', title: 'Tortas' }); h.mock.state.collections.push(second);
  h.mock.state.product.collections.nodes = [sampleCategory()]; h.mock.state.jobStuck = true;
  const input = editing(h, { categoryId: second.id }); input.expectedProduct.categoryIds = [categoryId];
  assert.equal((await h.call('/api/operations', input)).status, 502);
  assert.equal(h.store.history()[0].result, 'uncertain');
  const count = mutations(h).length; assert.equal((await h.call('/api/operations', input)).status, 409); assert.equal(mutations(h).length, count);
});

test('productos sin categoría incluyen los de colecciones ajenas; filtro respeta la paginación', async t => {
  const h = harness(); close(t, h);
  h.mock.state.product.collections.nodes = [{ id: 'gid://shopify/Collection/799', categoria: null }];
  assert.equal((await (await h.call('/api/products?uncategorized=true')).json()).nodes.length, 1);
  h.mock.state.product.collections.nodes.push(sampleCategory());
  assert.equal((await (await h.call('/api/products?uncategorized=true')).json()).nodes.length, 0);
  assert.equal((await (await h.call('/api/products')).json()).nodes.length, 1);
});

for (const mode of ['create', 'edit']) test(`${mode}: ACTIVE publica en Online Store después del estado y mantiene recibo`, async t => {
  const h = harness(); close(t, h);
  const input = mode === 'create' ? creation({ status: 'ACTIVE', confirmActive: true }) : editing(h, { status: 'ACTIVE', confirmActive: true });
  const r = await h.call('/api/operations', input); assert.equal(r.status, 200);
  assert.equal(h.mock.state.product.status, 'ACTIVE');
  assert.deepEqual(h.mock.state.published, [{ id: productId, publicationId: 'gid://shopify/Publication/801' }]);
  assert.match(mutations(h).at(-1).query, /publishablePublish/);
  const count = mutations(h).length; assert.equal((await h.call('/api/operations', input)).status, 200); assert.equal(mutations(h).length, count);
});

test('canal ausente bloquea antes de mutar; rechazo e incertidumbre de publicación quedan auditados', async t => {
  const h = harness(); close(t, h);
  h.mock.state.publications = [];
  assert.equal((await h.call('/api/operations', editing(h, { status: 'ACTIVE', confirmActive: true }))).status, 422); assert.equal(mutations(h).length, 0);
  h.mock.state.publications = undefined; h.mock.state.rejectRoot = 'publishablePublish';
  assert.equal((await h.call('/api/operations', editing(h, { status: 'ACTIVE', confirmActive: true }))).status, 422);
  assert.equal(h.store.history()[0].steps.at(-1).result, 'failed');
  h.mock.state.rejectRoot = null; h.mock.state.publishUnconfirmed = true;
  h.mock.state.product.status = 'DRAFT';
  const input = editing(h, { status: 'ACTIVE', confirmActive: true });
  assert.equal((await h.call('/api/operations', input)).status, 502); assert.equal(h.store.history()[0].result, 'uncertain');
});

for (const override of [{ altText: '' }, { photo: null }, { orden: 0 }, { enInicio: 'true' }, { description: 'x'.repeat(501) }]) test(`valida categoría ${Object.keys(override)[0]} antes de mutar`, async t => {
  const h = harness(); close(t, h); assert.equal((await h.call('/api/operations', categoryInput(override))).status, 400); assert.equal(mutations(h).length, 0);
});

test('categorías exigen autenticación y lista autorizada; no hay borrado', async t => {
  const h = harness(); close(t, h);
  assert.equal((await h.call('/api/categories', null, jwt({ sub: '999' }))).status, 403);
  assert.equal((await h.call('/api/categories', null, jwt(), 'DELETE')).status, 404);
});

test('lista FINAL de scopes incluye lectura/escritura de publicaciones y está documentada', async () => {
  assert.deepEqual(REQUIRED_SCOPES, ['read_products', 'write_products', 'read_inventory', 'write_inventory', 'read_locations', 'write_files', 'read_publications', 'write_publications']);
  for (const path of ['../../../docs/inventario/README.md', '../../../docs/inventario/VALIDACION.md']) {
    const doc = await readFile(new URL(path, import.meta.url), 'utf8');
    for (const scope of REQUIRED_SCOPES) assert.ok(doc.includes(`\`${scope}\``), `${path}: falta ${scope}`);
  }
});
