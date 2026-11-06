import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, creation, editing, mutations, productId, jwt } from './helpers.mjs';
import { categoryId, sampleCategory } from './shopify-fixture.mjs';
import { categorySnapshot, categoryIds } from '../src/categories.mjs';
import { createInventoryService } from '../src/inventory-service.mjs';
import { REQUIRED_SCOPES, createShopifyClient } from '../src/shopify-client.mjs';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { sampleProduct, locationId } from './shopify-fixture.mjs';
const photo = { type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
const create = (extra = {}) => ({ action: 'category_create', operationId: crypto.randomUUID(), title: 'Galletas', description: '', altText: 'Galletas en caja', photo, ...extra });
const edit = (h, extra = {}) => create({ action: 'category_edit', categoryId, expectedCategory: categorySnapshot(h.mock.state.collections[0]), title: h.mock.state.collections[0].title.trim(), photo: null, ...extra });
function setup(t) { const h = harness(); t.after(() => h.db.close()); return h; }
test('probe: creación ACTIVE cuya publicación falla no duplica producto ni existencias al reintentar', async t => {
  const h = setup(t); h.mock.state.rejectRoot = 'publishablePublish';
  assert.equal((await h.call('/api/operations', creation({ status: 'ACTIVE', confirmActive: true }))).status, 422);
  assert.equal(h.mock.state.product.status, 'ACTIVE'); h.mock.state.rejectRoot = null;
  const r = await h.call('/api/operations', creation({ status: 'ACTIVE', confirmActive: true }));
  assert.equal(r.status, 409); assert.equal((await r.json()).productId, productId);
  assert.equal(mutations(h).filter(m => m.query.includes('productCreate')).length, 1); assert.equal(h.mock.state.applied, 1);
});
test('historial con productId bloquea cualquier estado salvo ARCHIVED aunque cambie el título', async t => {
  const h = setup(t); await h.call('/api/operations', creation());
  h.mock.state.product.title = 'Renombrado'; h.mock.state.product.status = 'UNLISTED';
  assert.equal((await h.call('/api/operations', creation())).status, 409);
  h.mock.state.product.status = 'ARCHIVED'; assert.equal((await h.call('/api/operations', creation())).status, 200);
});
test('búsqueda exacta también bloquea ACTIVE ajeno al historial', async t => {
  const h = setup(t); h.mock.state.product.title = 'Nuevo brownie'; h.mock.state.product.status = 'ACTIVE';
  assert.equal((await h.call('/api/operations', creation())).status, 409); assert.equal(mutations(h).length, 0);
});
test('probe: editar precio ACTIVE no consulta publicaciones ni vuelve a publicar', async t => {
  const h = setup(t); h.mock.state.product.status = 'ACTIVE'; h.mock.state.publications = [];
  assert.equal((await h.call('/api/operations', editing(h, { price: '13.00' }))).status, 200);
  assert.equal(h.mock.state.published.length, 0); assert.ok(!h.mock.state.calls.some(c => c.query.includes('InventoryPublications')));
});
test('activar un producto ya publicado no repite publishablePublish', async t => {
  const h = setup(t); h.mock.state.product.publishedOnPublication = true;
  assert.equal((await h.call('/api/operations', editing(h, { status: 'ACTIVE', confirmActive: true }))).status, 200);
  assert.equal(h.mock.state.published.length, 0);
});
test('probe: CAS conserva espacios y saltos exactos al editar y ordenar, título 255 y alt 512', async t => {
  const h = setup(t); const c = h.mock.state.collections[0];
  c.title = 'x'.repeat(253) + ' \n'; c.descriptionHtml += '\n'; c.image.altText = 'a'.repeat(510) + ' \n';
  assert.equal((await h.call('/api/operations', edit(h, { title: 'Nombre nuevo' }))).status, 200);
  c.title += ' '; c.descriptionHtml += '\n'; c.image.altText += '\n';
  h.mock.state.collections.push(sampleCategory({ id: 'gid://shopify/Collection/702', title: 'Z', orden: { value: '2' } }));
  const cats = (await (await h.call('/api/categories')).json()).categories;
  assert.equal((await h.call('/api/operations', { action: 'category_order', operationId: crypto.randomUUID(), categoryId: cats[1].id, direction: -1, expectedCategories: cats.map(categorySnapshot) })).status, 200);
});
test('probe: creación incierta que la relectura no encuentra libera el nombre; descripción vacía envía cadena vacía', async t => {
  const h = setup(t); h.mock.state.loseRoot = 'collectionCreate';
  assert.equal((await h.call('/api/operations', create())).status, 502);
  h.mock.state.collections = h.mock.state.collections.filter(c => c.title !== 'Galletas');
  assert.equal((await h.call('/api/operations', create())).status, 200);
  const m = mutations(h).find(m => m.query.includes('collectionCreate'));
  assert.equal((m.variables.collection || m.variables.input).descriptionHtml, '');
});
test('historial de creación exitosa reciente relee ID ausente de la lista para evitar duplicar', async t => {
  const h = setup(t); await h.call('/api/operations', create());
  const saved = h.mock.state.collections.pop();
  const service = createInventoryService({ store: h.store, clientFactory: (token, id) => ({ ...h.clientFactory(token, id), collection: async () => saved }) });
  assert.equal((await service.execute(create(), { staffId: '123', token: jwt() })).status, 409);
  const expired = createInventoryService({ store: h.store, now: () => new Date(Date.now() + 86_400_001).toISOString(), clientFactory: h.clientFactory });
  assert.equal((await expired.execute(create(), { staffId: '123', token: jwt() })).status, 200);
});
test('categoría no publicada se muestra y reparar publicación es idempotente con resumen auditable', async t => {
  const h = setup(t); h.mock.state.collections[0].publishedOnPublication = false;
  const c = (await (await h.call('/api/categories')).json()).categories[0]; assert.equal(c.publishedOnPublication, false);
  const input = { action: 'category_publish', operationId: crypto.randomUUID(), categoryId };
  const r = await h.call('/api/operations', input); assert.equal(r.status, 200); assert.equal((await r.json()).after.published, true);
  assert.equal((await h.call('/api/operations', input)).status, 200);
  assert.equal((await h.call('/api/operations', { ...input, operationId: crypto.randomUUID() })).status, 200);
  assert.equal(h.mock.state.published.length, 1); assert.equal(h.store.history()[0].after.published, true);
});
test('colecciones automáticas se excluyen de lista, categoryIds y edición', async t => {
  const h = setup(t); const c = h.mock.state.collections[0];
  c.sources = [{ __typename: 'CollectionConditionsSource', inclusion: { conditions: [{ id: 'condition' }] } }]; h.mock.state.product.collections.nodes = [c];
  assert.deepEqual(categoryIds(h.mock.state.product), []);
  assert.deepEqual((await (await h.call('/api/categories')).json()).categories, []);
  assert.equal((await h.call('/api/operations', edit(h))).status, 400);
});
test('descripción con formato se conserva; editar sin foto envía id, sin URL CDN', async t => {
  const h = setup(t); h.mock.state.collections[0].descriptionHtml = '<p><strong>Especial</strong></p>\n';
  assert.equal((await h.call('/api/operations', edit(h, { description: 'Ataque al formato' }))).status, 200);
  const data = mutations(h).find(m => m.query.includes('collectionUpdate')).variables.input;
  assert.equal(data.descriptionHtml, undefined); assert.equal(data.image.id, h.mock.state.collections[0].image.id); assert.ok(data.image.id); assert.equal(data.image.src, undefined);
});
test('descripción demasiado larga y orden inválido devuelven errores claros', async t => {
  const h = setup(t);
  assert.match((await (await h.call('/api/operations', create({ description: 'x'.repeat(501) }))).json()).message, /500/);
  assert.match((await (await h.call('/api/operations', create({ orden: 0 }))).json()).message, /Escribe un número de orden desde 1/);
});
test('orden con fallo parcial conserva pasos y reabrir permite completar sin repetición ciega', async t => {
  const h = setup(t); h.mock.state.collections.push(sampleCategory({ id: 'gid://shopify/Collection/702', title: 'Tortas', orden: { value: '2' } }));
  let writes = 0;
  const service = createInventoryService({ store: h.store, clientFactory: (token, id) => {
    const c = h.clientFactory(token, id); return { ...c, updateCollection: async data => { if (++writes === 2) throw Object.assign(Error('Fallo parcial'), { status: 422, code: 'SHOPIFY_REJECTED' }); return c.updateCollection(data); } };
  } });
  const input = { action: 'category_order', operationId: crypto.randomUUID(), categoryId: 'gid://shopify/Collection/702', direction: -1, expectedCategories: h.mock.state.collections.map(categorySnapshot) };
  const r = await service.execute(input, { staffId: '123', token: jwt() }); assert.equal(r.status, 422); assert.ok(r.body.steps.some(s => s.label.startsWith('Ordenar') && s.result === 'succeeded'));
  const count = mutations(h).length; await service.execute(input, { staffId: '123', token: jwt() }); assert.equal(mutations(h).length, count);
  const stale = await service.execute({ ...input, operationId: crypto.randomUUID() }, { staffId: '123', token: jwt() }); assert.equal(stale.status, 409);
  const cats = (await (await h.call('/api/categories')).json()).categories;
  const retry = await h.call('/api/operations', { ...input, operationId: crypto.randomUUID(), categoryId: cats[1].id, expectedCategories: cats.map(categorySnapshot) }); assert.equal(retry.status, 200);
  assert.deepEqual(h.mock.state.collections.map(c => c.orden.value).sort(), ['1', '2']);
});
test('scopes se comparan en sesión y el aviso nombra los permisos faltantes sin impedir inventario', async t => {
  const h = setup(t); h.mock.state.scopes = REQUIRED_SCOPES.filter(s => !s.includes('publications'));
  const session = await (await h.call('/api/session')).json();
  assert.deepEqual(session.missingScopes, ['read_publications', 'write_publications']); assert.match(session.warning, /read_publications.*write_publications/);
  assert.equal((await h.call('/api/products')).status, 200);
});
test('canal español se identifica por handle online_store y las consultas usan API vigente', async t => {
  const h = setup(t); h.mock.state.publications = [{ id: 'gid://shopify/Publication/801', name: 'Tienda online', channels: { nodes: [{ handle: 'online_store' }], pageInfo: { hasNextPage: false } } }];
  assert.equal((await h.call('/api/operations', create())).status, 200);
  const queries = h.mock.state.calls.map(c => c.query).join('\n');
  assert.match(queries, /collectionCreate\(collection: \$collection\)/); assert.match(queries, /CollectionCreateInput/); assert.match(queries, /sources/); assert.doesNotMatch(queries, /ruleSet|nodes \{ id name \}/);
});
async function ui({ failCategories = false, warning = '', publicationAvailable = true } = {}) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { hidden: true, value: '', textContent: '', innerHTML: '', checked: false, classList: { toggle() {} }, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, showModal() { this.open = true; }, close() { this.open = false; }, append() {} });
    return elements.get(selector);
  };
  const product = { ...sampleProduct(), collections: { nodes: [] } };
  const sandbox = vm.createContext({ URL, Intl, crypto, setTimeout, document: { querySelector: element, createElement: () => ({}) }, window: { shopify: { idToken: async () => 'synthetic' } }, fetch: async path => {
    if (path === '/api/session') return Response.json({ staffId: '123', warning });
    if (path === '/api/locations') return Response.json({ locations: [{ id: locationId }] });
    if (path === '/api/categories') return failCategories ? Response.json({ message: 'Falta read_publications' }, { status: 403 }) : Response.json({ categories: [sampleCategory({ publishedOnPublication: publicationAvailable ? false : null })], publicationAvailable, warning: publicationAvailable ? '' : 'Publicación no disponible; revisa canales y permisos.' });
    if (path.startsWith('/api/products?')) return Response.json({ nodes: [product], pageInfo: { hasNextPage: false } });
    throw Error(path);
  } });
  await vm.runInContext(await readFile(new URL('../src/admin-ui.js', import.meta.url), 'utf8'), sandbox);
  return { elements, sandbox };
}
test('UI arranca inventario y producción/corrección aunque /api/categories falle, con aviso en Categorías', async () => {
  const { elements, sandbox } = await ui({ failCategories: true, warning: 'Faltan permisos: read_publications, write_publications' });
  assert.equal(elements.get('#workspace').hidden, false); assert.match(elements.get('#products').innerHTML, /Agregar producción/); assert.match(elements.get('#products').innerHTML, /Corregir existencias/);
  assert.match(elements.get('#scope-warning').textContent, /read_publications/);
  await vm.runInContext("document.querySelector('#categories').listeners.click()", sandbox);
  assert.equal(elements.get('#categories-view').hidden, false); assert.match(elements.get('#category-warning').textContent, /Falta read_publications/);
  await vm.runInContext("openEditor('edit', {id:'gid://shopify/Product/101',title:'Caja',status:'ACTIVE',description:'',descriptionHtml:'',collections:{nodes:[]},variants:{nodes:[{price:'12.00',sku:''}]}})", sandbox);
  assert.match(elements.get('#editor-fields').innerHTML, /No cambiar categoría/);
});
test('UI categoría no publicada muestra reparación con resumen y descripción con formato solo lectura', async () => {
  const { elements, sandbox } = await ui();
  await vm.runInContext('renderCategories(); categories[0].descriptionHtml = "<p><strong>Especial</strong></p>"; openCategory(categories[0])', sandbox);
  assert.match(elements.get('#category-list').innerHTML, /No se ve en la tienda/); assert.match(elements.get('#category-list').innerHTML, /Publicar en la tienda/);
  assert.match(elements.get('#category-list').innerHTML, /aria-label="Editar Brownies de prueba"/); assert.match(elements.get('#category-list').innerHTML, /aria-label="Subir Brownies de prueba"/);
  assert.match(elements.get('#category-fields').innerHTML, /readonly/); assert.match(elements.get('#category-fields').innerHTML, /Esta descripción tiene formato/);
  await vm.runInContext("document.querySelector('#category-list').listeners.click({target:{closest:()=>({dataset:{category:'0',kind:'publish'}})}})", sandbox);
  assert.equal(vm.runInContext('pending.action', sandbox), 'category_publish'); assert.match(elements.get('#summary').innerHTML, /Publicar en la tienda/);
});
test('publicación aplicada con respuesta perdida se repara sin volver a publicar ni crear categoría', async t => {
  const h = setup(t); h.mock.state.loseRoot = 'publishablePublish';
  assert.equal((await h.call('/api/operations', create())).status, 502);
  const receipt = h.store.history()[0]; assert.ok(receipt.categoryId);
  assert.equal((await h.call('/api/operations', { action: 'category_publish', operationId: crypto.randomUUID(), categoryId: receipt.categoryId })).status, 200);
  assert.equal(h.mock.state.published.length, 1); assert.equal(mutations(h).filter(m => m.query.includes('collectionCreate')).length, 1);
});
test('fallo al releer una creación reciente no libera el nombre ni crea otra', async t => {
  const h = setup(t); await h.call('/api/operations', create()); h.mock.state.collections.pop();
  const service = createInventoryService({ store: h.store, clientFactory: (token, id) => ({ ...h.clientFactory(token, id), collection: async () => { throw Object.assign(Error('No se pudo leer'), { status: 502, code: 'SHOPIFY_QUERY_FAILED' }); } }) });
  assert.equal((await service.execute(create(), { staffId: '123', token: jwt() })).status, 502);
  assert.equal(mutations(h).filter(m => m.query.includes('collectionCreate')).length, 1);
});
test('categoría creada con publicación rechazada también relee el ID antes de recrear', async t => {
  const h = setup(t); h.mock.state.rejectRoot = 'publishablePublish';
  assert.equal((await h.call('/api/operations', create())).status, 422);
  const saved = h.mock.state.collections.pop(); h.mock.state.rejectRoot = null;
  const service = createInventoryService({ store: h.store, clientFactory: (token, id) => ({ ...h.clientFactory(token, id), collection: async () => saved }) });
  assert.equal((await service.execute(create(), { staffId: '123', token: jwt() })).status, 409);
  assert.equal(mutations(h).filter(m => m.query.includes('collectionCreate')).length, 1);
});
test('identificación de Tienda online pagina también canales dentro de una publicación', async t => {
  const h = setup(t);
  const client = createShopifyClient({ env: h.env, sessionToken: jwt(), staffId: '123', fetchImpl: (url, init) => {
    if (!String(url).includes('graphql')) return h.mock.fetch(url, init);
    const { query } = JSON.parse(init.body);
    if (query.includes('InventoryPublications')) return Response.json({ data: { publications: { nodes: [{ id: 'gid://shopify/Publication/801', channels: { nodes: [{ handle: 'other' }], pageInfo: { hasNextPage: true, endCursor: 'next' } } }], pageInfo: { hasNextPage: false } } } });
    if (query.includes('InventoryPublicationChannels')) return Response.json({ data: { publication: { channels: { nodes: [{ handle: 'online_store' }], pageInfo: { hasNextPage: false } } } } });
    throw Error(query);
  } });
  assert.equal(await client.onlineStorePublication(), 'gid://shopify/Publication/801');
});

for (const failure of ['missing_channel', 'missing_scope']) test(`categorías disponibles sin publicaciones: ${failure}`, async t => {
  const h = setup(t);
  h.mock.state.publications = [];
  if (failure === 'missing_scope') h.mock.state.publicationsDenied = true;
  const response = await h.call('/api/categories');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.categories[0].publishedOnPublication, null);
  assert.equal(result.publicationAvailable, false);
  assert.match(result.warning, /canales y permisos/);
  assert.equal((await h.call('/api/operations', creation())).status, 200);
  assert.deepEqual(categoryIds(h.mock.state.product), [categoryId]);
  assert.equal((await h.call('/api/operations', editing(h, { price: '19.00', categoryId }))).status, 200);
  const before = mutations(h).length;
  assert.ok([403, 422].includes((await h.call('/api/operations', create())).status));
  assert.ok([403, 422].includes((await h.call('/api/operations', { action: 'category_publish', operationId: crypto.randomUUID(), categoryId })).status));
  assert.equal(mutations(h).length, before);
});

for (const published of [false, true]) test(`editar categoría conserva publicación ${published} sin consultar canal`, async t => {
  const h = setup(t);
  h.mock.state.collections[0].publishedOnPublication = published;
  h.mock.state.publications = [];
  assert.equal((await h.call('/api/operations', edit(h, { enInicio: false }))).status, 200);
  assert.equal(h.mock.state.collections[0].publishedOnPublication, published);
  assert.equal(h.mock.state.published.length, 0);
  assert.ok(!h.mock.state.calls.some(c => /InventoryPublication/.test(c.query)));
  assert.equal(h.store.history()[0].after.published, undefined);
});

test('creación exitosa renombrada permite volver a usar nombre anterior', async t => {
  const h = setup(t);
  assert.equal((await h.call('/api/operations', create())).status, 200);
  const saved = h.mock.state.collections.at(-1);
  saved.title = 'Cookies';
  assert.equal((await h.call('/api/operations', create())).status, 200);
  assert.equal(mutations(h).filter(m => m.query.includes('collectionCreate')).length, 2);
  // El título actual normalizado sigue bloqueando aunque no salga en el listado.
  const fresh = h.mock.state.collections.pop();
  fresh.title = '  GALLETAS  ';
  const service = createInventoryService({ store: h.store, clientFactory: (token, id) => ({ ...h.clientFactory(token, id), collection: async () => fresh }) });
  assert.equal((await service.execute(create(), { staffId: '123', token: jwt() })).status, 409);
});

test('UI muestra aviso en producto y deshabilita únicamente acciones de publicación', async () => {
  const { elements, sandbox } = await ui({ publicationAvailable: false });
  await vm.runInContext("renderCategories(); openEditor('create')", sandbox);
  const fields = elements.get('#editor-fields').innerHTML;
  assert.match(fields, /Publicación no disponible/);
  assert.match(fields, /Brownies de prueba/);
  assert.match(fields, /id="inline-category" disabled/);
  assert.match(fields, /value="ACTIVE" disabled/);
  assert.doesNotMatch(fields, /id="product-category"[^>]*disabled/);
  assert.equal(elements.get('#new-category').disabled, true);
  assert.match(elements.get('#category-list').innerHTML, /Publicación sin comprobar/);
  assert.match(elements.get('#category-list').innerHTML, /button disabled>Publicar/);
  assert.doesNotMatch(vm.runInContext('categorySaveNotice(true)', sandbox), /se publicará/);
  assert.match(vm.runInContext('categorySaveNotice(false)', sandbox), /se publicará/);
});
