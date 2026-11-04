import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { createStore } from '../src/store.mjs';

const customer = { shop: 'dayanas.myshopify.com', customerId: 'customer-1' };
const other = { ...customer, customerId: 'customer-2' };
const staff = { shop: customer.shop, staffId: 'baker-1', role: 'staff' };
const input = { requestText: 'Pastel de chocolate', pickup: { label: 'Viernes, Houston' } };
const proposal = {
  baseCents: 15000, surchargeCents: 2000, display: 'breakdown',
  canPrepare: 'Chocolate para 20 personas', changes: 'Flores adicionales', reply: 'Podemos prepararlo.',
};
const code = (expected) => (error) => error.code === expected;

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'celebraciones-store-'));
  const path = join(directory, 'tracking.sqlite');
  const stores = [];
  const open = () => { const store = createStore(path); stores.push(store); return store; };
  t.after(() => {
    for (const store of stores) store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { path, open, store: open() };
}

// Direct trusted fixture only: the public store deliberately has no payment API.
function seedReserved(path, id) {
  const db = new DatabaseSync(path);
  try {
    const row = db.prepare('SELECT snapshot FROM requests WHERE shop=? AND id=?').get(customer.shop, id);
    const snapshot = JSON.parse(row.snapshot);
    snapshot.status = 'reserved';
    snapshot.payments = [{ id: 'confirmed-payment-1', amountCents: 9000, status: 'confirmed' }];
    snapshot.billing={proposalVersion:snapshot.acceptedProposal.version,totalCents:snapshot.acceptedProposal.totalCents,netPaidCents:9000,balanceDueCents:snapshot.acceptedProposal.totalCents-9000};
    snapshot.payment={url:null,stage:'balance',reviewRequired:false};
    snapshot.version += 1;
    db.prepare('UPDATE requests SET snapshot=?, version=? WHERE shop=? AND id=?')
      .run(JSON.stringify(snapshot), snapshot.version, customer.shop, id);
  } finally { db.close(); }
}

test('creates an opaque owned snapshot and persists confirmed changes across reopen', (t) => {
  const { store, open } = fixture(t);
  const created = store.createRequest(customer, input, 'create-1');
  assert.match(created.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...created, id: 'opaque' }, {
    id: 'opaque', version: 1, status: 'requested', ...input,
    acceptedProposal: null, pendingProposal: null, payments: [], comments: [], history: [],
    permissions: { canComment: true, canAccept: false },
  });
  const commented = store.comment(customer, created.id, '  Sin nueces  ', 'comment-1');
  assert.equal(commented.version, 2);
  assert.equal(commented.comments[0].text, 'Sin nueces');
  assert.equal(commented.comments[0].author, 'Cliente');
  store.close();
  assert.deepEqual(open().getTracking(customer, created.id), commented);
});

test('never exposes or mutates another customer or shop request', (t) => {
  const { store } = fixture(t);
  const { id } = store.createRequest(customer, input, 'create');
  for (const actor of [other, { ...customer, shop: 'other.myshopify.com' }, { ...staff, shop: 'other.myshopify.com' }]) {
    for (const operation of [
      () => store.getTracking(actor, id),
      () => store.comment(actor, id, 'Cambio', 'comment'),
      () => store.accept(actor, id, 1, 'accept'),
      () => store.propose(actor, id, proposal, 'propose'),
      () => store.setStatus(actor, id, 'ready', 'status'),
    ]) assert.throws(operation, code('NOT_FOUND'));
  }
  assert.throws(() => store.getTracking(null, id), code('AUTH_REQUIRED'));
  assert.throws(() => store.getTracking({ shop: customer.shop, role: 'staff' }, id), code('AUTH_REQUIRED'));
  assert.equal(store.getTracking(customer, id).version, 1);
});

test('idempotent creation and comments survive retries and reject changed action or payload', (t) => {
  const { store, open } = fixture(t);
  const initial = store.createRequest(customer, input, 'create');
  store.comment(customer, initial.id, 'Hola', 'shared');
  const retry = store.createRequest(customer, input, 'create');
  assert.equal(retry.id, initial.id);
  assert.equal(retry.comments.length, 1);
  assert.throws(() => store.createRequest(customer, { ...input, requestText: 'Otro' }, 'create'), code('CONFLICT'));
  assert.equal(open().comment(customer, initial.id, 'Hola', 'shared').comments.length, 1);
  assert.throws(() => store.comment(customer, initial.id, 'Otro', 'shared'), code('CONFLICT'));
  assert.throws(() => store.accept(customer, initial.id, 1, 'shared'), code('CONFLICT'));
  // Principal scopes keys, so the same operation ID by staff is a separate intent.
  assert.equal(store.comment(staff, initial.id, 'Hola', 'shared').comments.length, 2);
});

test('proposal versions increase independently and stale acceptance never applies', (t) => {
  const { store } = fixture(t);
  const { id } = store.createRequest(customer, input, 'create');
  store.comment(customer, id, 'Detalle', 'comment');
  const first = store.propose(staff, id, proposal, 'p1');
  assert.equal(first.status, 'quoted');
  assert.equal(first.pendingProposal.version, 1);
  assert.equal(first.pendingProposal.totalCents, 17000);
  assert.deepEqual(first.permissions, { canComment: true, canAccept: false,canPrepare:false,canPropose:true });
  assert.equal(store.getTracking(customer, id).permissions.canAccept, true);
  const second = store.propose(staff, id, { ...proposal, baseCents: 16000 }, 'p2');
  assert.equal(second.pendingProposal.version, 2);
  assert.deepEqual(second.history, [{ version: 1, status: 'quoted', totalCents: 17000, reply: proposal.reply }]);
  assert.throws(() => store.accept(customer, id, 1, 'stale'), code('CONFLICT'));
  assert.equal(store.getTracking(customer, id).pendingProposal.totalCents, 18000);
  const accepted = store.accept(customer, id, 2, 'accept');
  assert.equal(accepted.acceptedProposal.version, 2);
  assert.equal(accepted.pendingProposal, null);
  assert.equal(accepted.status, 'quoted');
  assert.deepEqual(accepted.payments, []);
  assert.deepEqual(store.accept(customer, id, 2, 'accept'), accepted);
  assert.throws(() => store.accept(customer, id, 1, 'accept'), code('CONFLICT'));
  assert.equal(store.propose(staff, id, proposal, 'p3').pendingProposal.version, 3);
});

test('staff cannot accept, customers cannot propose or force a reservation', (t) => {
  const { store } = fixture(t);
  const { id } = store.createRequest(customer, input, 'create');
  store.propose(staff, id, proposal, 'p');
  assert.throws(() => store.accept(staff, id, 1, 'a'), code('CONFLICT'));
  assert.throws(() => store.propose(customer, id, proposal, 'p'), code('CONFLICT'));
  assert.throws(() => store.setStatus(customer, id, 'ready', 's'), code('CONFLICT'));
  assert.throws(() => store.setStatus(staff, id, 'reserved', 's'), code('VALIDATION'));
  assert.throws(() => store.setStatus(staff, id, 'preparing', 's'), code('CONFLICT'));
  assert.throws(() => store.setStatus(staff, id, 'ready', 's'), code('CONFLICT'));
  assert.throws(() => store.createRequest(staff, input, 'c'), code('CONFLICT'));
});

test('accepting adjustments preserves payment IDs, amounts and operational progress', (t) => {
  const { store, path } = fixture(t);
  const { id } = store.createRequest(customer, input, 'create');
  store.propose(staff, id, { ...proposal, surchargeCents: 0 }, 'p1');
  store.accept(customer, id, 1, 'a1');
  seedReserved(path, id);
  store.setStatus(staff,id,'preparing','prepare');
  const pending = store.propose(staff, id, proposal, 'p2');
  assert.equal(pending.acceptedProposal.totalCents, 15000);
  assert.equal(pending.status, 'preparing');
  const accepted = store.accept(customer, id, 2, 'a2');
  assert.equal(accepted.status, 'preparing');
  assert.equal(accepted.acceptedProposal.totalCents - accepted.payments[0].amountCents, 8000);
  store.propose(staff, id, { ...proposal, baseCents: 7000, surchargeCents: 0 }, 'p3');
  const reduced = store.accept(customer, id, 3, 'a3');
  assert.equal(reduced.status, 'preparing');
  assert.deepEqual(reduced.payments, [{ id: 'confirmed-payment-1', amountCents: 9000, status: 'confirmed' }]);
  assert.equal(reduced.payments[0].amountCents - reduced.acceptedProposal.totalCents, 2000);
});

test('ready blocks fresh mutations but recognizes earlier successful retries', (t) => {
  const { store, path } = fixture(t);
  const { id } = store.createRequest(customer, input, 'create');
  store.comment(customer, id, 'Hola', 'comment');
  store.propose(staff, id, proposal, 'propose');
  store.accept(customer, id, 1, 'accept');
  seedReserved(path, id);
  assert.throws(()=>store.setStatus(staff,id,'ready','unpaid-ready'),code('CONFLICT'));
  const trustedDb=new DatabaseSync(path);
  const trusted=store.getTracking(customer,id);
  trusted.payments=[{id:'confirmed-payment-1',amountCents:trusted.acceptedProposal.totalCents,status:'confirmed'}];
  trusted.billing={proposalVersion:1,totalCents:trusted.acceptedProposal.totalCents,netPaidCents:trusted.acceptedProposal.totalCents,balanceDueCents:0};
  trusted.payment={url:null,stage:'paid',reviewRequired:false};
  trustedDb.prepare('UPDATE requests SET snapshot=? WHERE shop=? AND id=?').run(JSON.stringify(trusted),customer.shop,id);trustedDb.close();
  const ready = store.setStatus(staff, id, 'ready', 'ready');
  assert.deepEqual(ready.permissions, { canComment: false, canAccept: false,canPrepare:false,canPropose:false });
  assert.equal(store.comment(customer, id, 'Hola', 'comment').status, 'ready');
  assert.equal(store.accept(customer, id, 1, 'accept').status, 'ready');
  assert.equal(store.propose(staff, id, proposal, 'propose').status, 'ready');
  assert.equal(store.setStatus(staff, id, 'ready', 'ready').version, ready.version);
  for (const operation of [
    () => store.comment(customer, id, 'Otro', 'new-comment'),
    () => store.comment(staff, id, 'Otro', 'new-comment'),
    () => store.propose(staff, id, proposal, 'new-proposal'),
    () => store.accept(customer, id, 1, 'new-accept'),
    () => store.setStatus(staff, id, 'preparing', 'backwards'),
  ]) assert.throws(operation, code('CONFLICT'));
  assert.equal(store.getTracking(customer, id).version, ready.version);
});

test('rejects invalid and client-controlled fields without persisting changes', (t) => {
  const { store } = fixture(t);
  for (const value of [
    { ...input, payments: [] }, { ...input, status: 'reserved' },
    { ...input, customerId: 'other' }, { ...input, pickup: { label: 'Friday', date: 'x' } },
    { ...input, requestText: ' '.repeat(10) }, { ...input, requestText: 'x'.repeat(6001) },
  ]) assert.throws(() => store.createRequest(customer, value, 'bad'), code('VALIDATION'));
  const { id } = store.createRequest(customer, input, 'create');
  for (const value of ['', ' ', 'x'.repeat(2001), null, {}]) {
    assert.throws(() => store.comment(customer, id, value, 'bad'), code('VALIDATION'));
  }
  for (const operationId of ['', 'x'.repeat(101), '../bad', null]) {
    assert.throws(() => store.comment(customer, id, 'Hola', operationId), code('VALIDATION'));
  }
  for (const value of [
    { ...proposal, baseCents: -1 }, { ...proposal, baseCents: 1.1 },
    { ...proposal, baseCents: Number.MAX_SAFE_INTEGER },
    { ...proposal, baseCents: 100000000, surchargeCents: 1 },
    { ...proposal, display: 'hidden' }, { ...proposal, canPrepare: true },
    { ...proposal, reply: 'x'.repeat(2001) }, { ...proposal, totalCents: 1 },
    { ...proposal, version: 100 },
  ]) assert.throws(() => store.propose(staff, id, value, 'bad'), code('VALIDATION'));
  assert.throws(() => store.accept(customer, id, 1.5, 'bad'), code('VALIDATION'));
  assert.equal(store.getTracking(customer, id).version, 1);
  // A failed operation does not consume its key.
  assert.equal(store.comment(customer, id, 'Válido', 'bad').version, 2);
});

test('returned snapshots cannot mutate stored state', (t) => {
  const { store } = fixture(t);
  const created = store.createRequest(customer, input, 'create');
  created.status = 'reserved';
  created.pickup.label = 'Alterado';
  created.payments.push({ id: 'inventado', amountCents: 100, status: 'confirmed' });
  const loaded = store.getTracking(customer, created.id);
  assert.equal(loaded.status, 'requested');
  assert.equal(loaded.pickup.label, 'Viernes, Houston');
  assert.deepEqual(loaded.payments, []);
});

test('SQLite failure rolls back both snapshot and operation key', (t) => {
  const { store, path } = fixture(t);
  const { id } = store.createRequest(customer, input, 'create');
  const db = new DatabaseSync(path);
  try {
    db.exec(`CREATE TRIGGER fail_operation BEFORE INSERT ON operations
      WHEN NEW.operation_id = 'rollback' BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
    assert.throws(() => store.comment(customer, id, 'No debe quedar', 'rollback'), code('UNAVAILABLE'));
    assert.equal(store.getTracking(customer, id).version, 1);
    assert.deepEqual(store.getTracking(customer, id).comments, []);
    db.exec('DROP TRIGGER fail_operation');
    assert.equal(store.comment(customer, id, 'No debe quedar', 'rollback').version, 2);
  } finally { db.close(); }
});

test('independent SQLite connections serialize concurrent writes without losing comments', async (t) => {
  const { store, path } = fixture(t);
  const { id } = store.createRequest(customer, input, 'create');
  const storeUrl = new URL('../src/store.mjs', import.meta.url).href;
  const gate = new SharedArrayBuffer(4);
  const workers = Array.from({ length: 4 }, (_, index) => new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { createStore } = await import(workerData.storeUrl);
      const store = createStore(workerData.path);
      parentPort.postMessage('ready');
      Atomics.wait(new Int32Array(workerData.gate), 0, 0);
      try { store.comment(workerData.actor, workerData.id, 'Mensaje ' + workerData.index, 'parallel-' + workerData.index); }
      finally { store.close(); }
    })().catch(error => { throw error; });
  `, { eval: true, workerData: { storeUrl, path, gate, id, actor: customer, index } }));
  t.after(async () => { await Promise.all(workers.map(worker => worker.terminate())); });
  const exits = workers.map(worker => new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', value => value === 0 ? resolve() : reject(new Error(`Worker exit ${value}`)));
  }));
  await Promise.all(workers.map(worker => new Promise(resolve => worker.once('message', resolve))));
  Atomics.store(new Int32Array(gate), 0, 1);
  Atomics.notify(new Int32Array(gate), 0, workers.length);
  await Promise.all(exits);
  const snapshot = store.getTracking(customer, id);
  assert.equal(snapshot.version, 5);
  assert.deepEqual(snapshot.comments.map(comment => comment.text).sort(), ['Mensaje 0', 'Mensaje 1', 'Mensaje 2', 'Mensaje 3']);
  assert.equal(new Set(snapshot.comments.map(comment => comment.id)).size, 4);
});

test('concurrent acceptance retries and proposal replacement produce one coherent outcome', async (t) => {
  const { store, path } = fixture(t);
  const { id } = store.createRequest(customer, input, 'create');
  store.propose(staff, id, proposal, 'initial-proposal');
  const gate = new SharedArrayBuffer(4);
  const jobs = [
    { action: 'accept', actor: customer, payload: 1, operationId: 'one-acceptance' },
    { action: 'accept', actor: customer, payload: 1, operationId: 'one-acceptance' },
    { action: 'propose', actor: staff, payload: { ...proposal, baseCents: 18000 }, operationId: 'replace' },
  ];
  const workers = jobs.map(job => new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { createStore } = await import(workerData.storeUrl);
      const store = createStore(workerData.path);
      parentPort.postMessage({ ready: true });
      Atomics.wait(new Int32Array(workerData.gate), 0, 0);
      try {
        const { action, actor, payload, operationId } = workerData.job;
        store[action](actor, workerData.id, payload, operationId);
        parentPort.postMessage({ result: 'success' });
      } catch(error) { parentPort.postMessage({ result: error.code }); }
      finally { store.close(); }
    })().catch(error => { throw error; });
  `, { eval: true, workerData: {
    storeUrl: new URL('../src/store.mjs', import.meta.url).href, path, gate, id, job,
  } }));
  t.after(async () => { await Promise.all(workers.map(worker => worker.terminate())); });
  const results = workers.map(worker => new Promise((resolve, reject) => {
    worker.on('message', message => { if (message.result) resolve(message.result); });
    worker.once('error', reject);
  }));
  await Promise.all(workers.map(worker => new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  })));
  Atomics.store(new Int32Array(gate), 0, 1);
  Atomics.notify(new Int32Array(gate), 0, workers.length);
  const [first, retry, replacement] = await Promise.all(results);
  assert.equal(replacement, 'success');
  assert.equal(first, retry);
  assert.ok(['success', 'CONFLICT'].includes(first));
  const current = store.getTracking(customer, id);
  assert.equal(current.pendingProposal.version, 2);
  assert.equal(current.pendingProposal.totalCents, 20000);
  assert.equal(current.acceptedProposal?.version ?? null, first === 'success' ? 1 : null);
  assert.equal(current.version, first === 'success' ? 4 : 3);
  assert.equal(current.history.length, 1);
  assert.equal(current.status, 'quoted');
});
