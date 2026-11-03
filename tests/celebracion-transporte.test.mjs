import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
function setup(fetch) {
  const c = { fetch, AbortController, setTimeout, clearTimeout, console }; vm.createContext(c);
  vm.runInContext(readFileSync('assets/ds-celebracion-servicio.js', 'utf8'), c); return c.DSTrackingService;
}
test('transport sends only intent to same-origin proxy, never price or customer identity', async () => {
  const requests = []; const api = setup(async (path, options) => { requests.push({ path, options }); return Response.json({ version: 2 }); });
  const service = api.createHttpService('/apps/celebraciones');
  await service.acceptProposal('cake-1', 3, 'op-1');
  assert.equal(requests[0].path, '/apps/celebraciones/requests/cake-1/accept');
  assert.deepEqual(JSON.parse(requests[0].options.body), { proposalVersion: 3, operationId: 'op-1' });
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].options.redirect, 'error');
});
test('transport rejects foreign origins and path injection', async () => {
  const api = setup(async () => { throw new Error('must not fetch'); });
  assert.throws(() => api.createHttpService('https://other.test/apps/foo'));
  await assert.rejects(api.createHttpService('/apps/celebraciones').getTracking('../other'));
});
test('transport preserves server error code and rejects HTML response', async () => {
  let api = setup(async () => Response.json({ code: 'CONFLICT' }, { status: 409 }));
  await assert.rejects(api.createHttpService('/apps/celebraciones').getTracking('cake-1'), e => e.code === 'CONFLICT');
  api = setup(async () => new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(api.createHttpService('/apps/celebraciones').getTracking('cake-1'), e => e.code === 'UNAVAILABLE');
});

test('payment transport submits only the operation ID for start and reconciliation', async () => {
  const calls = [];
  const api = setup(async (path, options) => { calls.push({ path, options }); return Response.json({ version: 3 }); });
  const service = api.createHttpService('/apps/celebraciones');
  await service.startPayment('cake-1', 'pay-1');
  await service.syncPayment('cake-1', 'sync-1');
  assert.deepEqual(calls.map(call => call.path), ['/apps/celebraciones/requests/cake-1/payment', '/apps/celebraciones/requests/cake-1/payment-sync']);
  assert.deepEqual(calls.map(call => JSON.parse(call.options.body)), [{ operationId: 'pay-1' }, { operationId: 'sync-1' }]);
  assert.ok(calls.every(call => call.options.method === 'POST' && call.options.credentials === 'same-origin'));
});
