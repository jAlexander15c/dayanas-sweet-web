import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, production, correction } from './helpers.mjs';

// D18: el Historial muestra el nombre del producto en producción y correcciones.
for (const [label, input, before, after] of [['producción', production, { available: 4 }, { available: 10 }], ['corrección', correction, { on_hand: 6 }, { on_hand: 5 }]]) {
  test(`${label}: el cambio guarda el nombre del producto junto al antes y el después`, async () => {
    const h = harness();
    const response = await h.call('/api/operations', input());
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const [event] = h.service.history();
    assert.equal(event.productTitle, 'Caja de prueba');
    assert.deepEqual([event.before, event.after], [before, after]);
  });
}
