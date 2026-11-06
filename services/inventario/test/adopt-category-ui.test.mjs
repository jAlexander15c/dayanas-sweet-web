import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { sampleCategory } from './shopify-fixture.mjs';
async function ui({ publicationAvailable = true, count = 2, image = true } = {}) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { hidden: true, value: '', textContent: '', innerHTML: '', checked: false,
      elements: { photo: { files: [] }, altText: {} }, data: {}, reportValidity: () => true,
      classList: { toggle() {} }, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; },
      showModal() { this.open = true; }, close() { this.open = false; } });
    return elements.get(selector);
  };
  const collections = Array.from({ length: count }, (_, i) => sampleCategory({ id: `gid://shopify/Collection/${800 + i}`, title: `Colección ${i}`,
    categoria: null, manual: i !== 1, publishedOnPublication: publicationAvailable ? false : null, ...(!image ? { image: null } : {}) }));
  const sandbox = vm.createContext({ URL, Intl, crypto, setTimeout,
    FormData: class { constructor(form) { this.form = form; } get(key) { return this.form.data[key] ?? null; } },
    document: { querySelector: element }, window: { shopify: { idToken: async () => 'synthetic' } },
    fetch: async path => {
      if (path === '/api/session') return Response.json({ staffId: '123' });
      if (path === '/api/locations') return Response.json({ locations: [] });
      if (path.startsWith('/api/products')) return Response.json({ nodes: [], pageInfo: { hasNextPage: false } });
      if (path === '/api/categories') return Response.json({ categories: [sampleCategory()], collections, publicationAvailable });
      throw Error(path);
    } });
  await vm.runInContext(await readFile(new URL('../src/admin-ui.js', import.meta.url), 'utf8'), sandbox);
  return { elements, sandbox };
}

test('UI lista manual/automática, foto, cantidad, publicación y pagina cada 100', async () => {
  const { elements, sandbox } = await ui({ count: 102 });
  vm.runInContext('renderCategories()', sandbox);
  const html = elements.get('#collection-list').innerHTML;
  assert.equal((html.match(/<article/g) || []).length, 100);
  assert.match(html, /Usar Colección 0 como categoría/);
  assert.doesNotMatch(html, /Usar Colección 1 como categoría/);
  assert.match(html, /Automática: no se puede usar como categoría/);
  assert.match(html, /0 productos/); assert.match(html, /No se ve en la tienda/);
  assert.match(html, /alt="Brownies en caja"/);
  assert.equal(elements.get('#collections-next').hidden, false);
  elements.get('#collections-next').onclick();
  assert.equal((elements.get('#collection-list').innerHTML.match(/<article/g) || []).length, 2);
  assert.match(elements.get('#collections-page').textContent, /101–102 de 102/);
  assert.equal(elements.get('#collections-next').hidden, true);
  elements.get('#collections-previous').onclick();
  assert.match(elements.get('#collections-page').textContent, /1–100 de 102/);
});

test('UI adopción precarga alt, portada sí, orden final y publicación desmarcada; resumen y payload', async () => {
  const { elements, sandbox } = await ui();
  vm.runInContext('openAdoption(storeCollections[0])', sandbox);
  const fields = elements.get('#category-fields').innerHTML;
  assert.match(fields, /name="altText" value="Brownies en caja" required/);
  assert.match(fields, /value="true" selected/); assert.match(fields, /name="orden" value="2"/);
  assert.match(fields, /Hoy no se ve en la tienda. ¿Publicarla también\?/);
  assert.match(fields, /type="checkbox" name="publish">/);
  assert.doesNotMatch(fields, /name="title"|name="description"|checked/);
  const form = elements.get('#category-form');
  form.data = { altText: 'Caja abierta', enInicio: 'true', orden: '2' };
  await form.listeners.submit({ preventDefault() {}, target: form });
  assert.equal(vm.runInContext('pending.action', sandbox), 'category_adopt');
  assert.equal(vm.runInContext('pending.publish', sandbox), false);
  assert.match(elements.get('#summary').innerHTML, /seguirá sin verse en la tienda/);
  assert.match(elements.get('#summary').innerHTML, /Caja abierta/);
  const operationId = vm.runInContext('pending.operationId', sandbox);
  form.data.publish = 'on';
  await form.listeners.submit({ preventDefault() {}, target: form });
  assert.equal(vm.runInContext('pending.publish', sandbox), true);
  assert.notEqual(vm.runInContext('pending.operationId', sandbox), operationId);
  assert.match(elements.get('#summary').innerHTML, /se publicará también/);
});

test('UI permite sin foto, exige alt al elegir archivo y vuelve a permitir sin foto al quitarlo', async () => {
  const { elements, sandbox } = await ui({ image: false });
  vm.runInContext('openAdoption(storeCollections[0])', sandbox);
  const fields = elements.get('#category-fields').innerHTML;
  assert.match(fields, /Sin foto: en la portada se verá el nombre sobre color/);
  assert.doesNotMatch(fields, /name="altText"[^>]*required|name="photo"[^>]*required/);
  const form = elements.get('#category-form');
  form.elements.photo.files = [{}]; form.elements.photo.onchange();
  assert.equal(form.elements.altText.required, true);
  assert.equal(elements.get('#adoption-no-photo').hidden, true);
  form.elements.photo.files = []; form.elements.photo.onchange();
  assert.equal(form.elements.altText.required, false);
  form.data = { altText: '', enInicio: 'true', orden: '2' };
  await form.listeners.submit({ preventDefault() {}, target: form });
  assert.equal(vm.runInContext('pending.photo', sandbox), null);
  assert.match(elements.get('#summary').innerHTML, /Sin foto: en la portada se verá el nombre sobre color/);
});

test('UI mantiene adopción habilitada con publicationAvailable=false y omite publicar', async () => {
  const { elements, sandbox } = await ui({ publicationAvailable: false });
  vm.runInContext('renderCategories(); openAdoption(storeCollections[0])', sandbox);
  assert.match(elements.get('#collection-list').innerHTML, /Usar Colección 0 como categoría/);
  assert.doesNotMatch(elements.get('#category-fields').innerHTML, /name="publish"/);
  assert.match(elements.get('#category-fields').innerHTML, /Publicación sin comprobar/);
});

test('UI ofrece adoptar etiqueta, informa cómo entran productos y usa categorías calculadas por servidor', async () => {
  const { elements, sandbox } = await ui();
  vm.runInContext("storeCollections[0].kind = 'tag'; storeCollections[0].manual = false; storeCollections[0].tag = 'galletas'; renderCategories(); openAdoption(storeCollections[0])", sandbox);
  assert.match(elements.get('#collection-list').innerHTML, /Automática por etiqueta «galletas»: se puede usar como categoría/);
  assert.match(elements.get('#collection-list').innerHTML, /Usar Colección 0 como categoría/);
  const form = elements.get('#category-form'); form.data = { altText: 'Caja', enInicio: 'true', orden: '2' };
  await form.listeners.submit({ preventDefault() {}, target: form });
  assert.match(elements.get('#summary').innerHTML, /Los productos entran a esta categoría con la etiqueta «galletas»/);
  assert.match(elements.get('#summary').innerHTML, /Puede tardar unos segundos en aparecer en la categoría/);
  assert.equal(vm.runInContext("productCategories({categories: [{id: 'tag-category', title: 'Galletas'}], collections: {nodes: []}})[0].title", sandbox), 'Galletas');
  assert.match(vm.runInContext("categoryChangeNotice({categories:[{id:'old',kind:'tag',tag:'galletas'}]}, {id:'new',kind:'manual'})", sandbox), /Se quitará la etiqueta «galletas»/);
  assert.doesNotMatch(vm.runInContext("categoryChangeNotice({categories:[{id:'old',kind:'tag',tag:'GALLETAS'}]}, {id:'new',kind:'tag',tag:'galletas'})", sandbox), /Se quitará/);
});
