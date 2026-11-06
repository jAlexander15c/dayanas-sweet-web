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
