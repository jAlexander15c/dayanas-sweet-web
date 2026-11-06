// Fase 1 de la revisión del panel (docs/revision-panel-2026-11-05): R03 en el servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, editing, mutations } from './helpers.mjs';

for (const length of [200, 201, 255]) test(`R03: un nombre existente de ${length} caracteres no bloquea otros cambios`, async () => {
  const h = harness(); h.mock.state.product.title = 'A'.repeat(length);
  const response = await h.call('/api/operations', editing(h, { status: 'ARCHIVED' }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(mutations(h).length > 0, true);
  h.db.close();
});

test('R03: un nombre nuevo de más de 200 caracteres se rechaza con un mensaje claro y sin mutar', async () => {
  const h = harness(); h.mock.state.product.title = 'Galletas';
  const response = await h.call('/api/operations', editing(h, { title: 'B'.repeat(201) }));
  const body = await response.json();
  assert.equal(response.status, 400); assert.equal(body.message, 'El nombre puede tener hasta 200 caracteres.');
  assert.equal(mutations(h).length, 0);
  h.db.close();
});

// R04 (revisión de Codex): el plazo del portal cubre también el cuerpo de la respuesta.
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
test('R04: cabeceras recibidas + cuerpo trabado se cortan con aviso de plazo', async () => {
  const source = await readFile(new URL('../src/staff-ui.js', import.meta.url), 'utf8');
  const nodes = new Map(), node = selector => { if (!nodes.has(selector)) nodes.set(selector, { hidden: false, replaceChildren() {}, remove() {}, focus() {}, querySelectorAll: () => [], classList: { toggle() {} } }); return nodes.get(selector); };
  let jsonStarted = false;
  const fetch = async (url, { signal }) => ({ ok: true, status: 200, json: () => { jsonStarted = true; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); } });
  const context = vm.createContext({ document: { body: { dataset: { portal: 'true' } }, querySelector: node, querySelectorAll: () => [] }, window: {}, location: { hash: '' }, URL, DOMException, AbortController, clearTimeout,
    setTimeout: fn => { setImmediate(fn); return 1; }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, localStorage: { removeItem() {} }, fetch });
  vm.runInContext(source.replace('import.meta.url', "'https://store.test/apps/inventario/assets/staff-ui.js'") + '\n globalThis.call = () => request("session");', context);
  await assert.rejects(context.call(), error => error.code === 'TIMEOUT' && /tardó demasiado/.test(error.message));
  assert.equal(jsonStarted, true, 'el corte ocurrió mientras se leía el cuerpo');
});
