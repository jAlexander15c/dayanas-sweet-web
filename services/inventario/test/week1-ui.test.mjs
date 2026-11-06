import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { sampleProduct } from './shopify-fixture.mjs';

async function ui() {
  const nodes = new Map(), calls = [];
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: '', innerHTML: '', hidden: false, open: false, children: [], elements: { photos: { files: [] } }, classList: { toggle() {} }, addEventListener() {}, reportValidity: () => true, append(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; }, showModal() { this.open = true; }, close() { this.open = false; } });
    return nodes.get(selector);
  };
  let failReload = true;
  const product = sampleProduct();
  const form = { title: 'Nuevo nombre', description: 'Descripción', status: 'DRAFT', price: '12.00', sku: 'CAJA' };
  const sandbox = vm.createContext({ URL, Intl, crypto, setTimeout, fixture: product,
    document: { querySelector: element, createElement: () => ({}) },
    window: { shopify: { idToken: async () => 'synthetic' }, inventarioAccess: { boot() {} } },
    FormData: class { get(key) { return form[key] ?? ''; } },
    fetch: async (path, init) => {
      calls.push({ path, body: init.body && JSON.parse(init.body) });
      if (path === '/api/operations') return Response.json({ message: 'Guardado en Shopify.', steps: [], after: { categoryId: 'gid://shopify/Collection/1' } });
      if (path === '/api/categories') {
        if (failReload) throw Error('Lectura no disponible');
        return Response.json({ categories: [], collections: [] });
      }
      throw Error('Unexpected local API: ' + path);
    } });
  await vm.runInContext(await readFile(new URL('../src/admin-ui.js', import.meta.url), 'utf8'), sandbox);
  return { nodes, calls, sandbox, element, allowReload() { failReload = false; } };
}

test('F2 UI: el resumen de cambio de nombre omite precio y SKU sin cambios', async () => {
  const h = await ui();
  await vm.runInContext("context = {action:'edit', product:fixture}; review({preventDefault(){}})", h.sandbox);
  assert.equal(h.element('#confirmation').open, true);
  assert.equal(vm.runInContext('Object.hasOwn(pending,"price")', h.sandbox), false);
  assert.equal(vm.runInContext('Object.hasOwn(pending,"sku")', h.sandbox), false);
});

test('F5: recibo exitoso se confirma aunque falle la recarga; actualizar no repite la mutación', async () => {
  const h = await ui();
  await vm.runInContext("pending={action:'category_order',operationId:'original'}; $('#confirmation').showModal(); $('#category-editor').showModal(); confirm()", h.sandbox);
  assert.equal(vm.runInContext('pending', h.sandbox), null);
  assert.equal(h.element('#confirmation').open, false);
  assert.match(h.element('#feedback').textContent, /Guardado en Shopify/);
  const notice = h.element('#category-warning');
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /guardado|guardó/i);
  const refresh = notice.children.find(child => child.textContent === 'Actualizar');
  assert.ok(refresh, 'la advertencia visible ofrece actualizar');
  h.allowReload(); await refresh.onclick();
  assert.equal(h.calls.filter(call => call.path === '/api/operations').length, 1);
  assert.equal(notice.hidden, true);
});

test('F8 UI: confirmación permite escribir el título archivado de 255 caracteres', async () => {
  const h = await ui();
  vm.runInContext("fixture.title='A'.repeat(255); fixture.status='ARCHIVED'; openEditor('delete',fixture)", h.sandbox);
  assert.match(h.element('#editor-fields').innerHTML, /name="confirmTitle"[^>]*maxlength="255"/);
});
