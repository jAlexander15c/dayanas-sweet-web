import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, creation, editing, mutations, productId } from './helpers.mjs';
import { sampleCategory, tagSources, categoryId } from './shopify-fixture.mjs';
import { classifyCollection, categorySnapshot, categoryIds } from '../src/categories.mjs';
import { createShopifyClient, REQUIRED_SCOPES } from '../src/shopify-client.mjs';
import { createInventoryService } from '../src/inventory-service.mjs';

const manualId = 'gid://shopify/Collection/702';
function setup(t, tag = 'galletas') {
  const h = harness(); t.after(() => h.db.close());
  h.mock.state.collections = [sampleCategory({ title: 'Galletas', sources: tagSources(tag) }), sampleCategory({ id: manualId, title: 'Página de inicio', image: null })];
  return h;
}
const change = fn => { const sources = tagSources(); fn(sources[0], sources); return sources; };
const cases = [
  ['manual sin fuentes', [], 'manual'],
  ['manual con selección de productos', [{ __typename: 'CollectionConditionsSource', inclusion: { conditions: [], selections: { nodes: [{}] } } }], 'manual'],
  ['manual conserva criterio anterior de selecciones excluidas', [{ __typename: 'CollectionConditionsSource', inclusion: { conditions: [] }, exclusion: { conditions: [], selections: { nodes: [{}] } } }], 'manual'],
  ['etiqueta igual', tagSources(), 'tag'],
  ['exclusión por condición', change(s => s.exclusion.conditions.push({ id: 'excluded' })), 'automatic'],
  ['exclusión manual', change(s => s.exclusion.selections.nodes.push({})), 'automatic'],
  ['dos condiciones', change(s => s.inclusion.conditions.push(s.inclusion.conditions[0])), 'automatic'],
  ['dos valores en una condición', change(s => s.inclusion.conditions[0].values.push('brownies')), 'automatic'],
  ['condición no etiqueta', change(s => s.inclusion.conditions[0].__typename = 'CollectionSourceInclusionConditionProductTitle'), 'automatic'],
  ['relación distinta de igual', change(s => s.inclusion.conditions[0].relation = 'NOT_TAGGED_WITH'), 'automatic'],
  ['selección manual adicional', change(s => s.inclusion.selections.nodes.push({})), 'automatic'],
  ['selecciones con página adicional', change(s => s.inclusion.selections.pageInfo.hasNextPage = true), 'automatic'],
  ['subcolección', [{ __typename: 'CollectionSubCollectionsSource' }], 'automatic'],
  ['subcolección adicional a etiqueta', change((s, sources) => sources.push({ __typename: 'CollectionSubCollectionsSource' })), 'automatic'],
  ['dos fuentes de etiqueta', [...tagSources(), ...tagSources()], 'automatic'],
  ['etiqueta vacía', tagSources(''), 'automatic'],
];
for (const [name, sources, kind] of cases) test(`clasificación pura: ${name}`, () => {
  const c = sampleCategory({ sources }); const before = structuredClone(c);
  assert.deepEqual(classifyCollection(c), { kind, tag: kind === 'tag' ? 'galletas' : null });
  assert.deepEqual(c, before);
});

test('API expone kind/tag, consulta tipo/relación/values/selecciones y conserva scopes', async t => {
  const h = setup(t);
  h.mock.state.collections[0].categoria = null;
  const data = await (await h.call('/api/categories')).json();
  assert.equal(data.collections[0].kind, 'tag'); assert.equal(data.collections[0].tag, 'galletas');
  assert.equal(data.categories[0].kind, 'manual'); assert.equal(data.categories[0].tag, null);
  const q = h.mock.state.calls.find(c => c.query.includes('query InventoryCollections')).query;
  assert.match(q, /CollectionSourceInclusionConditionProductTag \{ relation values \}/);
  assert.match(q, /selections\(first: 1\)/);
  assert.deepEqual(REQUIRED_SCOPES, ['read_products', 'write_products', 'read_inventory', 'write_inventory', 'read_locations', 'write_files', 'read_publications', 'write_publications']);
});

test('adoptar etiqueta solo envía metafields/imagen y preserva reglas; operationId idempotente', async t => {
  const h = setup(t); const c = h.mock.state.collections[0]; c.categoria = null;
  const sources = structuredClone(c.sources);
  const input = { action: 'category_adopt', operationId: crypto.randomUUID(), categoryId, expectedCategory: categorySnapshot(c), altText: 'Galletas en caja', enInicio: true };
  const r = await h.call('/api/operations', input); assert.equal(r.status, 200); const result = await r.json();
  assert.deepEqual(await (await h.call('/api/operations', input)).json(), result);
  const updates = mutations(h).filter(c => c.query.includes('collectionUpdate'));
  assert.equal(updates.length, 1); assert.deepEqual(Object.keys(updates[0].variables.input).sort(), ['id', 'image', 'metafields']);
  assert.deepEqual(c.sources, sources); assert.equal(result.after.kind, 'tag'); assert.equal(result.after.tag, 'galletas');
});

test('crear en etiqueta usa tagsAdd exacto, sin collectionAddProducts ni esperar pertenencia; recibo', async t => {
  const h = setup(t, 'Galletas'); const input = creation({ categoryId });
  const r = await h.call('/api/operations', input); const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body));
  assert.match(body.message, /Puede tardar unos segundos en aparecer en la categoría/);
  const ms = mutations(h); const add = ms.find(m => m.query.includes('tagsAdd'));
  assert.deepEqual(add.variables, { id: productId, tags: ['Galletas'] });
  assert.equal(ms.some(m => m.query.includes('collectionAddProducts')), false);
  assert.deepEqual(h.mock.state.product.collections.nodes, []);
  assert.deepEqual(categoryIds((await (await h.call('/api/product?id=' + encodeURIComponent(productId))).json()).product), [categoryId]);
  const n = ms.length; assert.deepEqual(await (await h.call('/api/operations', input)).json(), body); assert.equal(mutations(h).length, n);
});

test('cambiar de manual a etiqueta añade etiqueta y quita pertenencia manual', async t => {
  const h = setup(t); h.mock.state.product.collections.nodes = [structuredClone(h.mock.state.collections[1])];
  const r = await h.call('/api/operations', editing(h, { categoryId })); assert.equal(r.status, 200, JSON.stringify(await r.json()));
  assert.deepEqual(h.mock.state.product.tags, ['galletas']); assert.deepEqual(h.mock.state.product.collections.nodes, []);
  const ms = mutations(h); assert.equal(ms.filter(m => m.query.includes('tagsAdd')).length, 1); assert.equal(ms.filter(m => m.query.includes('collectionAddProducts')).length, 0);
  assert.equal(ms.find(m => m.query.includes('collectionRemoveProducts')).variables.id, manualId);
});

test('cambiar de etiqueta a manual quita solo esa etiqueta y acepta pertenencia automática atrasada', async t => {
  const h = setup(t); h.mock.state.product.tags = ['GALLETAS', 'orgánico']; h.mock.state.product.collections.nodes = [structuredClone(h.mock.state.collections[0])];
  const r = await h.call('/api/operations', editing(h, { categoryId: manualId })); assert.equal(r.status, 200, JSON.stringify(await r.json()));
  assert.deepEqual(h.mock.state.product.tags, ['orgánico']);
  assert.equal(mutations(h).find(m => m.query.includes('tagsRemove')).variables.tags[0], 'GALLETAS'); // removes the stored spelling, not the rule's
  assert.equal(mutations(h).filter(m => m.query.includes('collectionRemoveProducts')).length, 0);
  assert.equal(mutations(h).find(m => m.query.includes('collectionAddProducts')).variables.id, manualId);
});

test('no quita etiqueta compartida por otra categoría elegida, sin distinguir mayúsculas', async t => {
  const h = setup(t); h.mock.state.product.tags = ['GALLETAS'];
  h.mock.state.collections.push(sampleCategory({ id: 'gid://shopify/Collection/703', title: 'Regalos', sources: tagSources('Galletas') }));
  const r = await h.call('/api/operations', editing(h, { categoryId: h.mock.state.collections[2].id })); assert.equal(r.status, 200, JSON.stringify(await r.json()));
  assert.equal(mutations(h).filter(m => /tagsAdd|tagsRemove|collectionAddProducts|collectionRemoveProducts/.test(m.query)).length, 0);
  assert.deepEqual(h.mock.state.product.tags, ['GALLETAS']);
});

for (const root of ['tagsAdd', 'tagsRemove']) test(`respuesta incierta de ${root}: relectura confirma sin repetir`, async t => {
  const h = setup(t); const removing = root === 'tagsRemove';
  if (removing) h.mock.state.product.tags = ['galletas'];
  h.mock.state.loseRoot = root;
  const input = editing(h, { categoryId: removing ? manualId : categoryId });
  const r = await h.call('/api/operations', input); assert.equal(r.status, 200, JSON.stringify(await r.json()));
  const n = mutations(h).length;
  assert.equal((await h.call('/api/operations', input)).status, 200); assert.equal(mutations(h).length, n);
  assert.equal(mutations(h).filter(m => m.query.includes(root)).length, 1);
});

for (const failure of ['sin aplicar', 'relectura fallida']) test(`etiqueta incierta ${failure}: REVIEW_REQUIRED sin reenvío`, async t => {
  const h = setup(t); let changed = false;
  const clientFactory = () => {
    const real = h.clientFactory('synthetic', '123');
    return { ...real, async tagsAdd(id, tags) { changed = true; if (failure === 'relectura fallida') await real.tagsAdd(id, tags); throw Error('Lost response'); }, async product(id) { if (changed && failure === 'relectura fallida') throw Error('Read failed'); return real.product(id); } };
  };
  const service = createInventoryService({ store: h.store, clientFactory }); const input = editing(h, { categoryId });
  const r = await service.execute(input, { staffId: '123', staffName: 'Test', token: 'synthetic' });
  assert.equal(r.status, 502); assert.equal(r.body.code, 'REVIEW_REQUIRED'); assert.equal(r.body.state, 'uncertain');
  const n = mutations(h).length; assert.equal((await service.execute(input, { staffId: '123', token: 'synthetic' })).body.code, 'REVIEW_REQUIRED'); assert.equal(mutations(h).length, n);
});

test('CAS compara etiquetas exactas leídas antes de cualquier mutación', async t => {
  const h = setup(t); h.mock.state.product.tags = ['otro']; const input = editing(h, { categoryId });
  h.mock.state.product.tags = ['OTRO'];
  const r = await h.call('/api/operations', input); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'PRODUCT_CHANGED'); assert.equal(mutations(h).length, 0);
});

test('rechaza asignar etiqueta sin las etiquetas leídas en la confirmación', async t => {
  const h = setup(t); const input = editing(h, { categoryId }); delete input.expectedProduct.tags;
  const r = await h.call('/api/operations', input); assert.equal(r.status, 400); assert.equal(mutations(h).length, 0);
});

test('CAS vuelve a comparar etiquetas después de guardar otros campos', async t => {
  const h = setup(t); const clientFactory = () => {
    const real = h.clientFactory('synthetic', '123');
    return { ...real, async update(...args) { const result = await real.update(...args); h.mock.state.product.tags.push('externa'); return result; } };
  };
  const service = createInventoryService({ store: h.store, clientFactory });
  const result = await service.execute(editing(h, { categoryId, title: 'Nombre actualizado' }), { staffId: '123', token: 'synthetic' });
  assert.equal(result.status, 409); assert.equal(result.body.code, 'PRODUCT_CHANGED'); assert.equal(mutations(h).some(m => m.query.includes('tagsAdd')), false);
});

test('producto con etiqueta cuenta como categorizado antes de entrar en la colección, filtro y detalle', async t => {
  const h = setup(t); h.mock.state.product.tags = ['GALLETAS'];
  assert.deepEqual(categoryIds(h.mock.state.product, h.mock.state.collections), [categoryId]);
  const data = await (await h.call('/api/products')).json(); assert.deepEqual(categoryIds(data.nodes[0]), [categoryId]);
  assert.equal((await (await h.call('/api/products?uncategorized=true')).json()).nodes.length, 0);
  h.mock.state.product.tags = []; h.mock.state.product.collections.nodes = [structuredClone(h.mock.state.collections[0])];
  assert.deepEqual(categoryIds(h.mock.state.product), [categoryId]);
});
