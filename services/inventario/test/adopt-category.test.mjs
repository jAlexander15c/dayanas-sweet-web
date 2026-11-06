import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, mutations, jwt, creation } from './helpers.mjs';
import { sampleCategory, categoryId } from './shopify-fixture.mjs';
import { categorySnapshot } from '../src/categories.mjs';
import { createInventoryService } from '../src/inventory-service.mjs';
import { createShopifyClient } from '../src/shopify-client.mjs';
const photo = { type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
function setup(t, extra = {}) {
  const h = harness(); t.after(() => h.db.close());
  Object.assign(h.mock.state.collections[0], { categoria: null, handle: 'brownies', ...extra });
  return h;
}
const adopt = (h, extra = {}) => ({ action: 'category_adopt', operationId: crypto.randomUUID(), categoryId,
  expectedCategory: categorySnapshot(h.mock.state.collections[0]), enInicio: true,
  altText: h.mock.state.collections[0].image?.altText || '', ...extra });

test('lista colecciones sin categoría, manuales y automáticas, con datos y publicación', async t => {
  const h = setup(t);
  h.mock.state.collections.push(sampleCategory({ id: 'gid://shopify/Collection/702', categoria: null, sources: [{ __typename: 'CollectionConditionsSource', inclusion: { conditions: [{ id: 'rule' }] } }] }));
  const result = await (await h.call('/api/categories')).json();
  assert.equal(result.categories.length, 0); assert.equal(result.collections.length, 2);
  assert.equal(result.collections[0].manual, true); assert.equal(result.collections[1].manual, false);
  assert.equal(result.collections[0].image.altText, 'Brownies en caja');
  assert.equal(result.collections[0].productsCount.count, 0);
  assert.equal(result.collections[0].publishedOnPublication, true);
});

for (const extra of [{}, { image: null }]) test(`adopta ${extra.image === null ? 'sin foto' : 'con foto y alt'} sin cambiar contenido; recibo y categorías`, async t => {
  const h = setup(t, extra); const before = structuredClone(h.mock.state.collections[0]);
  const input = adopt(h, extra.image === null ? {} : { altText: 'Caja de brownies abierta' });
  const first = await h.call('/api/operations', input); assert.equal(first.status, 200);
  const body = await first.json(); const count = mutations(h).length;
  assert.deepEqual(await (await h.call('/api/operations', input)).json(), body);
  assert.equal(mutations(h).length, count);
  const update = mutations(h).find(m => m.query.includes('collectionUpdate')).variables.input;
  assert.deepEqual(Object.keys(update).sort(), extra.image === null ? ['id', 'metafields'] : ['id', 'image', 'metafields']);
  if (before.image) assert.deepEqual(update.image, { id: before.image.id, altText: input.altText });
  for (const key of ['title', 'descriptionHtml', 'handle', 'sources']) assert.deepEqual(h.mock.state.collections[0][key], before[key]);
  assert.deepEqual(update.metafields.map(m => m.value), ['true', 'true', '1']);
  assert.equal(h.mock.state.published.length, 0);
  assert.equal((await (await h.call('/api/categories')).json()).categories[0].id, categoryId);
  assert.equal((await (await h.call('/api/categories')).json()).collections.length, 0);
  assert.equal(h.store.history()[0].action, 'category_adopt');
  assert.equal((await h.call('/api/operations', creation())).status, 200);
});

test('sin cambiar alt conserva la imagen sin incluirla en collectionUpdate', async t => {
  const h = setup(t); assert.equal((await h.call('/api/operations', adopt(h))).status, 200);
  assert.equal(mutations(h).find(m => m.query.includes('collectionUpdate')).variables.input.image, undefined);
});

test('adopta sin imagen previa y sube foto con alt obligatorio', async t => {
  const h = setup(t, { image: null });
  assert.equal((await h.call('/api/operations', adopt(h, { photo, altText: 'Brownies nuevos' }))).status, 200);
  const update = mutations(h).find(m => m.query.includes('collectionUpdate')).variables.input;
  assert.match(update.image.src, /^https:/); assert.equal(update.image.altText, 'Brownies nuevos');
});

for (const extra of [{ altText: '   ' }, { image: null, photo, altText: '' }]) test('rechaza alt vacío cuando hay foto', async t => {
  const h = setup(t, extra.image === null ? { image: null } : {});
  assert.equal((await h.call('/api/operations', adopt(h, { altText: extra.altText, ...(extra.photo ? { photo } : {}) }))).status, 400);
  assert.equal(mutations(h).length, 0);
});

test('recuperar desde Historial una foto aplicada no persiste bytes ni repite upload/update', async t => {
  const h = setup(t, { image: null }); h.mock.state.loseRoot = 'collectionUpdate';
  assert.equal((await h.call('/api/operations', adopt(h, { photo, altText: 'Foto nueva' }))).status, 502);
  assert.ok(!JSON.stringify(h.store.history()).includes(photo.data));
  const receipt = h.service.history()[0]; assert.equal(receipt.retryable, true);
  const count = mutations(h).length;
  const restarted = createInventoryService({ store: h.store, clientFactory: h.clientFactory });
  assert.equal((await restarted.execute(receipt.retryInput, { staffId: '123', token: jwt() })).status, 200);
  assert.equal(mutations(h).length, count);
  assert.equal(h.store.history()[0].after.newPhoto, true);
});

test('respuesta perdida antes de aplicar permite reintentar con los mismos datos y operationId', async t => {
  const h = setup(t); h.mock.state.failTransport = true; const input = adopt(h);
  assert.equal((await h.call('/api/operations', input)).status, 502);
  h.mock.state.failTransport = false;
  assert.equal((await h.call('/api/operations', input)).status, 200);
  assert.equal(mutations(h).filter(m => m.query.includes('collectionUpdate')).length, 1);
});

test('recuperación desde Historial respeta persona y recibo; cambiar datos con la clave bloquea', async t => {
  const h = setup(t); const input = adopt(h); h.mock.state.loseRoot = 'collectionUpdate';
  assert.equal((await h.call('/api/operations', input)).status, 502);
  assert.equal((await h.call('/api/operations', { ...input, enInicio: false })).status, 409);
  const resume = h.service.history()[0].retryInput;
  await assert.rejects(h.service.execute(resume, { staffId: '456', token: jwt() }), /otra persona/);
  assert.equal((await h.call('/api/operations', resume)).status, 200);
  const count = mutations(h).length;
  assert.equal((await h.call('/api/operations', resume)).status, 200);
  assert.equal(mutations(h).length, count);
});

test('Historial sin los bytes no reenvía una foto no aplicada ni bloquea la confirmación original', async t => {
  const h = setup(t, { image: null }); const input = adopt(h, { photo, altText: 'Foto nueva' });
  let lost = true;
  const service = createInventoryService({ store: h.store, clientFactory: (token, id) => {
    const client = h.clientFactory(token, id);
    return { ...client, async updateCollection(...args) { if (lost) { lost = false; throw Object.assign(Error('Lost'), { status: 502, code: 'REVIEW_REQUIRED' }); } return client.updateCollection(...args); } };
  } });
  assert.equal((await service.execute(input, { staffId: '123', token: jwt() })).status, 502);
  const count = mutations(h).length;
  const resumed = await service.execute(service.history()[0].retryInput, { staffId: '123', token: jwt() });
  assert.equal(resumed.body.code, 'REVIEW_REQUIRED'); assert.equal(resumed.body.retryable, false);
  assert.equal(mutations(h).length, count); assert.equal(service.history()[0].retryable, false);
  assert.equal((await service.execute(input, { staffId: '123', token: jwt() })).status, 200);
});

test('listado recorre más de 100 colecciones en páginas Shopify de 25', async t => {
  const h = setup(t); const all = Array.from({ length: 126 }, (_, i) => sampleCategory({ id: `gid://shopify/Collection/${2000 + i}`, categoria: null }));
  const pages = [];
  const client = createShopifyClient({ env: h.env, sessionToken: jwt(), staffId: '123', fetchImpl: (url, init) => {
    if (String(url).includes('graphql')) {
      const { query, variables } = JSON.parse(init.body);
      if (query.includes('query InventoryCollections')) {
        assert.match(query, /collections\(first: 25/);
        const start = Number(variables.after || 0), end = start + 25; pages.push(start);
        return Response.json({ data: { collections: { nodes: all.slice(start, end), pageInfo: { hasNextPage: end < all.length, endCursor: String(end) } } } });
      }
    }
    return h.mock.fetch(url, init);
  } });
  const result = await client.categories(); assert.equal(result.collections.length, 126);
  assert.equal(result.collections.at(-1).id, all.at(-1).id);
  assert.deepEqual(pages, [0, 25, 50, 75, 100, 125]);
});

test('respeta portada no y orden elegido; por defecto coloca después del orden máximo', async t => {
  const h = setup(t); h.mock.state.collections.push(sampleCategory({ id: 'gid://shopify/Collection/750', orden: { value: '9' } }));
  const response = await h.call('/api/operations', adopt(h, { enInicio: false }));
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.after.orden, 10); assert.equal(result.after.enInicio, false);
  h.mock.state.collections.push(sampleCategory({ id: 'gid://shopify/Collection/751', categoria: null }));
  assert.equal((await h.call('/api/operations', adopt(h, { categoryId: 'gid://shopify/Collection/751', expectedCategory: categorySnapshot(h.mock.state.collections.at(-1)), orden: 3 }))).status, 200);
  assert.equal(h.mock.state.collections.at(-1).orden.value, '3');
});

test('automática con marca dayana.categoria sigue mostrando la explicación sin adoptar', async t => {
  const h = setup(t, { categoria: { value: 'true' }, sources: [{ __typename: 'OtherSource' }] });
  const result = await (await h.call('/api/categories')).json();
  assert.equal(result.categories.length, 0); assert.equal(result.collections[0].manual, false);
});

test('solicitar publicación sin canal falla antes de adoptar y publicada no se republica', async t => {
  const h = setup(t); const input = adopt(h, { publish: true }); h.mock.state.publications = [];
  assert.equal((await h.call('/api/operations', input)).status, 422);
  assert.equal(mutations(h).length, 0);
  h.mock.state.publications = undefined;
  assert.equal((await h.call('/api/operations', adopt(h, { publish: true }))).status, 200);
  assert.equal(h.mock.state.published.length, 0);
});

for (const changed of ['updatedAt', 'manual', 'category']) test(`CAS 409 si cambió ${changed}`, async t => {
  const h = setup(t); const input = adopt(h);
  if (changed === 'updatedAt') h.mock.state.collections[0].updatedAt = '2026-11-03T15:00:00Z';
  if (changed === 'manual') h.mock.state.collections[0].sources = [{ __typename: 'UnknownSource' }];
  if (changed === 'category') h.mock.state.collections[0].categoria = { value: 'true' };
  const r = await h.call('/api/operations', input); assert.equal(r.status, 409);
  assert.equal((await r.json()).message, 'La colección cambió, revisa y confirma otra vez');
  assert.equal(mutations(h).filter(m => m.query.includes('collectionUpdate')).length, 0);
});

test('CAS relee justo después de preparar campos y subir foto', async t => {
  const h = setup(t); const input = adopt(h, { photo, altText: 'Foto nueva' });
  const service = createInventoryService({ store: h.store, clientFactory: (token, id) => {
    const client = h.clientFactory(token, id);
    return { ...client, async upload(...args) { const r = await client.upload(...args); h.mock.state.collections[0].updatedAt = 'changed'; return r; } };
  } });
  const r = await service.execute(input, { staffId: '123', token: jwt() });
  assert.equal(r.status, 409); assert.equal(mutations(h).filter(m => m.query.includes('collectionUpdate')).length, 0);
});

for (const publish of [false, true]) test(`publicación explícita ${publish}`, async t => {
  const h = setup(t, { publishedOnPublication: false });
  const r = await h.call('/api/operations', adopt(h, { publish })); assert.equal(r.status, 200);
  assert.equal(h.mock.state.published.length, publish ? 1 : 0);
  assert.equal((await r.json()).after.published, publish);
});

test('publicationAvailable=false permite adoptar sin publicar', async t => {
  const h = setup(t); h.mock.state.publicationsDenied = true;
  const list = await (await h.call('/api/categories')).json();
  assert.equal(list.publicationAvailable, false); assert.equal(list.collections[0].publishedOnPublication, null);
  assert.equal((await h.call('/api/operations', adopt(h))).status, 200);
  assert.equal(h.mock.state.published.length, 0);
});

for (const root of ['collectionUpdate', 'publishablePublish']) test(`incierto ${root}: relee al reiniciar y resuelve sin reescribir`, async t => {
  const h = setup(t, { publishedOnPublication: false }); const input = adopt(h, { publish: root === 'publishablePublish', altText: 'Caja abierta' });
  h.mock.state.loseRoot = root;
  const r = await h.call('/api/operations', input); assert.equal(r.status, 502);
  assert.equal((await r.json()).code, 'REVIEW_REQUIRED');
  assert.equal(h.store.history()[0].result, 'uncertain');
  const count = mutations(h).length;
  const service = createInventoryService({ store: h.store, clientFactory: h.clientFactory });
  const retry = await service.execute(input, { staffId: '123', token: jwt() });
  assert.equal(retry.status, 200); assert.equal(mutations(h).length, count);
  assert.equal(h.store.history()[0].result, 'succeeded');
});
