import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const customer = { shop: 'dayanas.myshopify.com', customerId: 'customer-1' };
const staff = { shop: customer.shop, staffId: 'baker-1', role: 'staff' };
const input = { requestText: 'Pastel de chocolate', pickup: { label: 'Viernes, Houston' } };
const proposal = {
  baseCents: 15000, surchargeCents: 2000, display: 'breakdown',
  canPrepare: 'Chocolate para 20 personas', changes: 'Flores adicionales', reply: 'Podemos prepararlo.',
};
const code = expected => error => error.code === expected;

// Adapter contract bridge only; this does not run Cloudflare Workers or model its concurrency.
// Real SQLite supplies persistence and rollback; storage owns the transaction boundary.
async function fixture(t) {
  const { createDurableStore } = await import('../src/durable-store.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  t.after(() => db.close());
  const storage = {
    sql: {
      exec(query, ...bindings) {
        assert.doesNotMatch(query, /(?:^|;)\s*(?:PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i,
          'Durable storage SQL must leave configuration and transactions to its runtime');
        if (!bindings.length && !/^\s*SELECT\b/i.test(query)) {
          db.exec(query);
          return { toArray: () => [], rowsWritten: 0 };
        }
        const statement = db.prepare(query);
        if (/^\s*SELECT\b/i.test(query)) {
          const rows = statement.all(...bindings);
          return { toArray: () => rows, rowsWritten: 0 };
        }
        const result = statement.run(...bindings);
        return { toArray: () => [], rowsWritten: result.changes };
      },
    },
    transactionSync(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        assert.ok(!result || typeof result.then !== 'function', 'transaction callback must be synchronous');
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db, open: () => createDurableStore(storage), store: createDurableStore(storage) };
}

test('Durable SQL preserves staff alerts, read state and queued email on recreation',async t=>{
 const {store,open}=await fixture(t);const {id}=store.createRequest(customer,input,'alert-create');
 store.comment(customer,id,'Pregunta','alert-comment');
 const restored=open(),result=restored.listStaffAlerts(staff);assert.equal(result.unread,1);
 restored.readStaffAlert(staff,result.alerts[0].id);assert.equal(open().listStaffAlerts(staff).unread,0);
 assert.ok(open().nextStaffAlertDue(staff.shop));
});

test('Durable SQL preserves delivery terms, reservation, staff receipt and idempotency on recreation',async t=>{
 const {store,open}=await fixture(t);
 const {id}=store.createRequest(customer,input,'create-delivery');
 store.propose(staff,id,{...proposal,paymentMode:'delivery'},'quote-delivery');
 store.accept(customer,id,1,'accept-delivery');
 const reopened=open();assert.equal(reopened.getTracking(customer,id).status,'reserved');
 assert.equal(reopened.getTracking(customer,id).payment.stage,'delivery');
 reopened.setStatus(staff,id,'ready','ready-delivery');
 const receipt=reopened.recordDeliveryPayment(staff,id,1,'receipt-delivery');
 assert.equal(receipt.billing.netPaidCents,17000);assert.equal(receipt.billing.source,'staff');
 const retry=open().recordDeliveryPayment(staff,id,1,'receipt-delivery');
 assert.equal(retry.payments.length,1);assert.equal(retry.payment.stage,'paid');
});

test('Durable SQL adapter persists snapshots and operation keys across store recreation', async t => {
  const { store, open } = await fixture(t);
  const created = store.createRequest(customer, input, 'create');
  assert.match(created.id, /^[0-9a-f-]{36}$/);
  assert.equal(created.version, 1);
  assert.equal(created.status, 'requested');
  assert.deepEqual(created.payments, []);
  const commented = store.comment(customer, created.id, '  Sin nueces  ', 'comment');
  assert.equal(commented.comments[0].text, 'Sin nueces');
  store.close();
  store.close();
  const reopened = open();
  assert.deepEqual(reopened.getTracking(customer, created.id), commented);
  assert.deepEqual(reopened.createRequest(customer, input, 'create'), commented);
  assert.deepEqual(reopened.comment(customer, created.id, '  Sin nueces  ', 'comment'), commented);
  assert.throws(() => reopened.comment(customer, created.id, 'Otro', 'comment'), code('CONFLICT'));
  assert.throws(() => reopened.accept(customer, created.id, 1, 'comment'), code('CONFLICT'));
  assert.equal(reopened.comment(staff, created.id, 'Detalle', 'comment').comments[1].author, 'Pastelera');
});

test('Durable SQL adapter preserves ownership, validation and staff permission boundaries', async t => {
  const { store } = await fixture(t);
  const { id } = store.createRequest(customer, input, 'create');
  for (const actor of [
    { ...customer, customerId: 'customer-2' },
    { ...customer, shop: 'other.myshopify.com' },
    { ...staff, shop: 'other.myshopify.com' },
  ]) {
    for (const action of [
      () => store.getTracking(actor, id),
      () => store.comment(actor, id, 'Hola', 'comment'),
      () => store.accept(actor, id, 1, 'accept'),
      () => store.propose(actor, id, proposal, 'proposal'),
      () => store.setStatus(actor, id, 'ready', 'status'),
    ]) assert.throws(action, code('NOT_FOUND'));
  }
  assert.throws(() => store.getTracking(null, id), code('AUTH_REQUIRED'));
  assert.throws(() => store.createRequest(customer, { ...input, payments: [] }, 'bad'), code('VALIDATION'));
  assert.throws(() => store.comment(customer, id, ' ', 'bad'), code('VALIDATION'));
  assert.throws(() => store.comment(customer, id, 'Hola', '../bad'), code('VALIDATION'));
  assert.throws(() => store.propose(customer, id, proposal, 'proposal'), code('CONFLICT'));
  assert.throws(() => store.setStatus(staff, id, 'reserved', 'status'), code('VALIDATION'));
  assert.throws(() => store.setStatus(staff, id, 'preparing', 'status'), code('CONFLICT'));
  assert.equal(store.getTracking(customer, id).version, 1);
});

test('Durable SQL adapter enforces current proposal versions without fabricating payments or reservations', async t => {
  const { store } = await fixture(t);
  const { id } = store.createRequest(customer, input, 'create');
  const first = store.propose(staff, id, proposal, 'proposal-1');
  assert.equal(first.pendingProposal.totalCents, 17000);
  assert.deepEqual(first.permissions, { canComment: true, canAccept: false,canPrepare:false,canPropose:true });
  assert.equal(store.getTracking(customer, id).permissions.canAccept, true);
  store.propose(staff, id, { ...proposal, baseCents: 16000 }, 'proposal-2');
  assert.throws(() => store.accept(customer, id, 1, 'accept'), code('CONFLICT'));
  assert.throws(() => store.accept(staff, id, 2, 'accept'), code('CONFLICT'));
  const accepted = store.accept(customer, id, 2, 'accept');
  assert.equal(accepted.acceptedProposal.version, 2);
  assert.equal(accepted.acceptedProposal.totalCents, 18000);
  assert.equal(accepted.pendingProposal, null);
  assert.equal(accepted.status, 'quoted');
  assert.deepEqual(accepted.payments, []);
  assert.deepEqual(accepted.history, [{ version: 1, status: 'quoted', totalCents: 17000, reply: proposal.reply, paymentMode:'deposit' }]);
  assert.deepEqual(store.accept(customer, id, 2, 'accept'), accepted);
});

test('Durable SQL transaction rolls back snapshot and idempotency key on SQLite failure', async t => {
  const { store, db } = await fixture(t);
  const { id } = store.createRequest(customer, input, 'create');
  db.exec(`CREATE TRIGGER fail_operation BEFORE INSERT ON operations
    WHEN NEW.operation_id = 'rollback' BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  assert.throws(() => store.comment(customer, id, 'Sin persistir', 'rollback'), code('UNAVAILABLE'));
  assert.equal(store.getTracking(customer, id).version, 1);
  assert.deepEqual(store.getTracking(customer, id).comments, []);
  assert.throws(() => store.createRequest(customer, input, 'rollback'), code('UNAVAILABLE'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM requests').get().count, 1);
  db.exec('DROP TRIGGER fail_operation');
  assert.equal(store.comment(customer, id, 'Sin persistir', 'rollback').version, 2);
  assert.equal(store.createRequest(customer, input, 'rollback').version, 1);
});

test('Durable SQL adapter retains confirmed payments and closes fresh mutations when ready', async t => {
  const { store, db, open } = await fixture(t);
  const { id } = store.createRequest(customer, input, 'create');
  store.propose(staff, id, { ...proposal, surchargeCents: 0 }, 'proposal-1');
  store.accept(customer, id, 1, 'accept-1');
  // Trusted payment fixture: no public store method may create payments or reservations.
  const snapshot = store.getTracking(customer, id);
  snapshot.status = 'reserved';
  snapshot.payments = [{ id: 'confirmed-1', amountCents: 9000, status: 'confirmed' }];
  snapshot.billing={proposalVersion:1,totalCents:15000,netPaidCents:9000,balanceDueCents:6000};snapshot.payment={url:null,stage:'balance',reviewRequired:false};
  db.prepare('UPDATE requests SET snapshot=? WHERE shop=? AND id=?')
    .run(JSON.stringify(snapshot), customer.shop, id);
  store.setStatus(staff, id, 'preparing', 'preparing');
  store.propose(staff, id, proposal, 'proposal-2');
  const accepted = store.accept(customer, id, 2, 'accept-2');
  assert.equal(accepted.status, 'preparing');
  assert.equal(accepted.acceptedProposal.totalCents - accepted.payments[0].amountCents, 8000);
  store.propose(staff, id, { ...proposal, baseCents: 7000, surchargeCents: 0 }, 'proposal-3');
  const reduced = store.accept(customer, id, 3, 'accept-3');
  assert.equal(reduced.status, 'preparing');
  assert.deepEqual(reduced.payments, [{ id: 'confirmed-1', amountCents: 9000, status: 'confirmed' }]);
  assert.equal(reduced.payments[0].amountCents - reduced.acceptedProposal.totalCents, 2000);
  assert.throws(()=>store.setStatus(staff,id,'ready','unreconciled-ready'),code('CONFLICT'));
  const trusted={...reduced,billing:{proposalVersion:3,totalCents:7000,netPaidCents:7000,balanceDueCents:0},payments:[{id:'confirmed-1',amountCents:7000,status:'confirmed'}],payment:{url:null,stage:'paid',reviewRequired:false}};
  db.prepare('UPDATE requests SET snapshot=? WHERE shop=? AND id=?').run(JSON.stringify(trusted),customer.shop,id);
  const ready = store.setStatus(staff, id, 'ready', 'ready');
  assert.deepEqual(ready.permissions, { canComment: false, canAccept: false,canPrepare:false,canPropose:false });
  assert.deepEqual(open().accept(customer, id, 3, 'accept-3'),store.getTracking(customer,id));
  for (const action of [
    () => store.comment(customer, id, 'Nuevo', 'new-comment'),
    () => store.propose(staff, id, proposal, 'new-proposal'),
    () => store.accept(customer, id, 3, 'new-accept'),
    () => store.setStatus(staff, id, 'preparing', 'new-status'),
  ]) assert.throws(action, code('CONFLICT'));
  assert.equal(store.getTracking(customer, id).version, ready.version);
});

test('Durable SQL guest creation, quota, access and email claims persist across adapter recreation',async t=>{
 const {store,open,db}=await fixture(t),shop=customer.shop,capability='ab'.repeat(32),now=1800000000000;
 const contact={name:'Ana',email:'ana@example.test',phone:'5551234567'},options={encryptedAccess:'sealed',now};
 const a=store.createGuestRequest({shop},input,contact,capability,'create',options);
 const reopened=open();assert.equal(reopened.createGuestRequest({shop},input,contact,capability,'create',options).id,a.id);
 assert.equal(reopened.getTracking(reopened.authenticateGuest(shop,a.id,capability),a.id).reference,'DS-000001');
 assert.equal(reopened.claimGuestEmail(shop,a.id,now).attempts,1);
 assert.equal(open().claimGuestEmail(shop,a.id,now),null);
 assert.equal(open().getGuestEmailJobs(shop,now+60001,2).length,0);
 assert.equal(open().getTracking(open().authenticateGuest(shop,a.id,capability),a.id).emailStatus,'unknown');
 db.exec("CREATE TRIGGER fail_guest_outbox BEFORE INSERT ON guest_email_jobs BEGIN SELECT RAISE(ABORT,'failed'); END");
 assert.throws(()=>reopened.createGuestRequest({shop},input,contact,capability,'second',options),code('UNAVAILABLE'));
 db.exec('DROP TRIGGER fail_guest_outbox');
 assert.equal(open().createGuestRequest({shop},input,contact,capability,'second',options).reference,'DS-000002');
});
