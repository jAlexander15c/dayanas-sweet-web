import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.mjs';
import { createPaymentScheduler } from '../src/payment-scheduler.mjs';

const { createPaymentService } = await import('../src/payment-service.mjs').catch(() => ({}));
const shop = 'sweet.myshopify.com';
const customer = { shop, customerId: '7' }, staff = { shop, role: 'staff', staffId: '9' };
const gid = (type, id = 1) => `gid://shopify/${type}/${id}`;
const proposal = total => ({ baseCents: total, surchargeCents: 0, display: 'total', canPrepare: 'Pastel en caja', changes: '', reply: 'Listo' });

function setup(t, { durable = false, mode = 'TEST', urgent = false, clock = Date.now, onDiagnostic, totalCents=15000 } = {}) {
  let path = ':memory:', directory;
  if (durable) { directory = mkdtempSync(join(tmpdir(), 'sweet-payments-')); path = join(directory, 'db.sqlite'); }
  const stores = [], open = () => { const value = createStore(path); stores.push(value); return value; };
  const store = open(); t.after(() => { stores.forEach(value => value.close()); if(directory)rmSync(directory,{recursive:true,force:true}); });
  const details = { pickupAt: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) + 'T16:00:00Z', urgent, tiers: [{ diameter: 6, sponges: ['Vainilla', 'Vainilla'], fillings: ['Fresa', 'Fresa'] }], coating: 'Crema', decorations: [] };
  const request = store.createRequest(customer, { requestText: 'Pastel', pickup: { label: 'Recogida' }, details }, 'create');
  store.propose(staff, request.id, proposal(totalCents), 'quote'); store.accept(customer, request.id, 1, 'accept');
  const calls = [];
  let draft = null, order = null, calculated = null;
  function preview(){const total=calculated.lineItems.reduce((sum,line)=>sum+line.quantity*line.baseCents-(line.discountCents||0),0);return{id:gid('CalculatedOrder'),subtotalCents:total,totalCents:total,outstandingCents:total-order.netPaymentCents,taxLines:[],lineItems:calculated.lineItems.map(line=>({...line,id:line.id.replace('/LineItem/','/CalculatedLineItem/'),discounts:(line.discounts||[]).map(discount=>({...discount,kind:'CalculatedManualDiscountApplication',applicationId:`gid://shopify/CalculatedManualDiscountApplication/discount-${line.id.split('/').at(-1)}`}))}))};}
  const client = {
    async checkConfiguration(){return {currency:'USD',scopes:['write_draft_orders','read_orders','write_order_edits','read_customers','write_orders'],locations:[]};},
    async createDepositDraft(input) {
      calls.push(['createDepositDraft', input]);
      assert.ok(store.getPaymentContext(customer, request.id).state.phase === 'draft-create', 'attempt must be committed before remote create');
      const amount = urgent ? totalCents : Number((BigInt(totalCents)*60n+99n)/100n);
      draft = { id: gid('DraftOrder'), customerId: gid('Customer', 7), orderId: null, status: 'OPEN', currency: 'USD', subtotalCents: amount, taxCents: 0, totalCents: amount, discountCents: 0, shippingCents: 0, taxesIncluded: false, tags: ['ds-celebraciones', `ds-request:${request.id}`, 'ds-version:1', `ds-operation:${input.operationId}`], invoiceUrl: `https://${shop}/invoice/one`, lineItems: [{ id: gid('DraftOrderLineItem'), title: `${urgent ? 'Pago completo' : 'Anticipo'} pastel [${request.id}/v1]`, quantity: 1, baseCents: amount }] };
      return structuredClone(draft);
    },
    async findDraftByOperation() { calls.push(['findDraftByOperation']); return draft ? [structuredClone(draft)] : []; },
    async getDraft() { calls.push(['getDraft']); return structuredClone(draft); },
    async getOrder() { calls.push(['getOrder']); const value=structuredClone(order);if(value)value.transactions=value.transactions.map(item=>({manualPaymentGateway:false,gateway:'shopify_payments',...item}));return value; },
    async reopenOrder(id){calls.push(['reopenOrder',id]);assert.equal(store.getPaymentContext(customer,request.id).state.phase,'order-open');assert.equal(id,order.id);order.closed=false;return{orderId:id,closed:false};},
    async readCalculatedOrder(){calls.push(['readCalculatedOrder']);const value=preview();return{...value,originalOrderId:order.id,addedLineItems:value.lineItems.filter(line=>line.title.startsWith('Saldo pastel ['))};},
    async getAdditionalPaymentUrl() { calls.push(['getAdditionalPaymentUrl']); return `https://${shop}/balance/one`; },
    async beginOrderEdit() { calls.push(['beginOrderEdit']); calculated = structuredClone(order); return preview(); },
    async removeLine({ lineItemId }) { calls.push(['removeLine']); const id = lineItemId.replace('/CalculatedLineItem/', '/LineItem/');if(calculated.lineItems.some(line=>line.id===id&&line.editableQuantity===0))throw Object.assign(new Error('Fulfilled quantity cannot be removed'),{code:'VALIDATION'}); calculated.lineItems = calculated.lineItems.filter(line => line.id !== id); return preview(); },
    async addCustomBalance(input) { calls.push(['addCustomBalance', input]); calculated.lineItems.push({ id: gid('LineItem', 2 + calls.length), title: `Saldo pastel [${request.id}/v${input.proposalVersion}]`, quantity: 1, baseCents: input.baseCents }); return { lineItemId: gid('CalculatedLineItem', 2), calculatedOrder: preview() }; },
    async setCustomPriceDiscount(input){calls.push(['setCustomPriceDiscount',input]);assert.equal(store.getPaymentContext(customer,request.id).state.phase,'edit-discount');const line=calculated.lineItems.find(line=>line.id.replace('/LineItem/','/CalculatedLineItem/')===input.lineItemId);assert.ok(line);assert.equal(!!input.discountApplicationId,!!line.discountCents);line.discountCents=input.discountCents;line.discounts=[{amountCents:input.discountCents,kind:'ManualDiscountApplication',applicationId:null,description:`Ajuste de precio aceptado: propuesta ${input.proposalVersion}`,targetType:'LINE_ITEM',valueType:'MoneyV2',valueCents:input.discountCents}];return preview();},
    async commitOrderEdit() { calls.push(['commitOrderEdit']);if(order.closed)throw Object.assign(new Error('Archived order'),{code:'VALIDATION'}); const live={transactions:order.transactions,receivedCents:order.receivedCents,refundedCents:order.refundedCents,netPaymentCents:order.netPaymentCents,closed:order.closed};order=Object.assign(calculated,live);order.discountCents=order.lineItems.reduce((sum,line)=>sum+(line.discountCents||0),0); order.subtotalCents = order.totalCents = order.lineItems.reduce((sum, line) => sum + line.quantity * line.baseCents-(line.discountCents||0), 0); order.outstandingCents = order.totalCents - order.netPaymentCents; order.fullyPaid = order.outstandingCents <= 0; return { orderId: order.id }; },
  };
  const service = createPaymentService({ store, client, mode, storefrontOrigin: `https://${shop}`,now:clock,onDiagnostic });
  function paid(amount = urgent ? totalCents : Number((BigInt(totalCents)*60n+99n)/100n)) {
    draft.orderId = gid('Order'); draft.status = 'COMPLETED';
    order = { id: gid('Order'), customerId: gid('Customer', 7), test: true, currency: 'USD', tags: [...draft.tags], subtotalCents: amount, taxCents: 0, totalCents: amount, netPaymentCents: amount, receivedCents: amount, refundedCents: 0, outstandingCents: 0, fullyPaid: true, discountCents: 0, shippingCents: 0, closed: false, cancelledAt: null, taxesIncluded: false, lineItems: draft.lineItems.map(line => ({ ...line, id: gid('LineItem') })), transactions: [{ id: gid('OrderTransaction'), kind: 'SALE', status: 'SUCCESS', test: true, amountCents: amount, currency: 'USD', parentId: null }] };
  }
  return { store, open, path, id: request.id, client, service, calls, paid, get draft() { return draft; }, get order() { return order; } };
}

test('creates one durable deposit checkout and GET tracking never performs network mutations', async t => {
  assert.equal(typeof createPaymentService, 'function');
  const f = setup(t);
  const snapshot = await f.service.pay(customer, f.id, 'pay-one');
  assert.equal(snapshot.payment.stage, 'deposit'); assert.equal(snapshot.payment.url, `https://${shop}/invoice/one`);
  assert.equal(snapshot.status, 'quoted'); assert.deepEqual(snapshot.payments, []);
  await f.service.pay(customer, f.id, 'pay-one'); await f.service.pay(customer, f.id, 'pay-two');
  f.store.getTracking(customer, f.id);
  assert.equal(f.calls.filter(([name]) => name === 'createDepositDraft').length, 1);
});

test('paid deposit reserves request, adds balance once to same order and reconciles final customer payment', async t => {
  const f = setup(t); await f.service.pay(customer, f.id, 'pay'); f.paid();
  const snapshot = await f.service.sync(customer, f.id, 'sync');
  assert.equal(snapshot.status, 'reserved'); assert.equal(snapshot.billing.totalCents, 15000); assert.equal(snapshot.billing.netPaidCents, 9000); assert.equal(snapshot.billing.balanceDueCents, 6000);
  assert.equal(snapshot.payment.stage, 'balance'); assert.equal(snapshot.payment.url, `https://${shop}/balance/one`);
  await f.service.sync(customer, f.id, 'sync'); await f.service.sync(customer, f.id, 'sync-two');
  assert.equal(f.calls.filter(([name]) => name === 'addCustomBalance').length, 1);
  f.order.transactions.push({ id: gid('OrderTransaction', 2), kind: 'CAPTURE', status: 'SUCCESS', test: true, amountCents: 6000, currency: 'USD', parentId: null });
  f.order.netPaymentCents = f.order.receivedCents = 15000; f.order.outstandingCents = 0; f.order.fullyPaid = true;
  const paid = await f.service.sync(customer, f.id, 'final');
  assert.equal(paid.payment.stage, 'paid'); assert.equal(paid.billing.balanceDueCents, 0);
  assert.equal(f.store.setStatus(staff, f.id, 'preparing', 'prepare').status, 'preparing');
  assert.equal(f.store.setStatus(staff, f.id, 'ready', 'ready').status, 'ready');
});

test('urgent initial payment uses 100 percent and never adds a balance line', async t => {
  const f = setup(t, { urgent: true }); await f.service.pay(customer, f.id, 'pay'); f.paid();
  const snapshot = await f.service.sync(customer, f.id, 'sync');
  assert.equal(snapshot.payment.stage, 'paid'); assert.equal(snapshot.status, 'reserved'); assert.equal(f.calls.filter(([name]) => name === 'addCustomBalance').length, 0);
});

test('verified staged initial balance is committed once after opaque-ID response failure without adding again',async t=>{
  const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();
  const add=f.client.addCustomBalance;
  f.client.addCustomBalance=async input=>{await add(input);throw Object.assign(new Error('opaque response'),{code:'PAYMENT_REVIEW'});};
  assert.equal((await f.service.sync(customer,f.id,'first')).payment.stage,'review');
  const read=f.client.readCalculatedOrder;
  f.client.readCalculatedOrder=async()=>{const value=await read();return {...value,lineItems:value.lineItems.filter(line=>!line.title.startsWith('Saldo pastel ['))};};
  const result=await f.service.sync(customer,f.id,'recover');
  assert.equal(result.payment.stage,'balance');assert.equal(result.billing.balanceDueCents,6000);
  await f.service.sync(customer,f.id,'again');
  assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,1);
  assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,1);
});

test('a pending transaction discovered after staged recovery keeps payment synchronization pending',async t=>{
  const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();
  const add=f.client.addCustomBalance;
  f.client.addCustomBalance=async input=>{await add(input);throw Object.assign(new Error('lost'),{code:'PAYMENT_REVIEW'});};
  await f.service.sync(customer,f.id,'first');
  const read=f.client.readCalculatedOrder;
  f.client.readCalculatedOrder=async()=>{const value=await read();return {...value,lineItems:value.lineItems.filter(line=>!line.title.startsWith('Saldo pastel ['))};};
  const commit=f.client.commitOrderEdit;
  f.client.commitOrderEdit=async()=>{const value=await commit();f.order.transactions.push({id:gid('OrderTransaction',5),kind:'CAPTURE',status:'PENDING',test:true,amountCents:6000,currency:'USD'});return value;};
  const result=await f.service.sync(customer,f.id,'recover');
  assert.equal(result.payment.stage,'syncing');assert.equal(result.payment.url,null);
});

test('staged recovery never commits after the initial deposit has been refunded',async t=>{
  const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();
  const add=f.client.addCustomBalance;
  f.client.addCustomBalance=async input=>{await add(input);throw Object.assign(new Error('lost'),{code:'PAYMENT_REVIEW'});};
  await f.service.sync(customer,f.id,'first');
  f.order.transactions.push({id:gid('OrderTransaction',3),kind:'REFUND',status:'SUCCESS',test:true,amountCents:1000,currency:'USD',parentId:gid('OrderTransaction')});
  f.order.refundedCents=1000;f.order.netPaymentCents=8000;f.order.outstandingCents=1000;f.order.fullyPaid=false;
  const read=f.client.readCalculatedOrder;
  f.client.readCalculatedOrder=async()=>{const value=await read();return {...value,outstandingCents:7000,lineItems:value.lineItems.filter(line=>!line.title.startsWith('Saldo pastel ['))};};
  const result=await f.service.sync(customer,f.id,'recover');
  assert.equal(result.payment.stage,'review');
  assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,0);
});

test('parallel calls across two services on same durable database create only one draft', async t => {
  const f = setup(t, { durable: true });
  const second = createPaymentService({ store: f.open(), client: f.client, mode: 'TEST' });
  await Promise.all([f.service.pay(customer, f.id, 'pay-a'), second.pay(customer, f.id, 'pay-b')]);
  assert.equal(f.calls.filter(([name]) => name === 'createDepositDraft').length, 1);
});

test('lost draft response is recovered by unique operation marker, never by repeating create', async t => {
  const f = setup(t, { durable: true }); const create = f.client.createDepositDraft;
  f.client.createDepositDraft = async input => { await create(input); throw Object.assign(new Error('secret private@example.test'), { code: 'PAYMENT_REVIEW' }); };
  const ambiguous = await f.service.pay(customer, f.id, 'pay'); assert.equal(ambiguous.payment.reviewRequired, true);
  const reopened = createPaymentService({ store: f.open(), client: f.client, mode: 'TEST' });
  const recovered = await reopened.sync(customer, f.id, 'recover');
  assert.equal(recovered.payment.stage, 'deposit');
  assert.equal(f.calls.filter(([name]) => name === 'createDepositDraft').length, 1);
});

test('an absent draft after timeout remains in review through retries and service restart', async t => {
  const f = setup(t, { durable: true });
  let attempted = 0; f.client.createDepositDraft = async () => { attempted++; throw Object.assign(new Error('lost'), { code: 'PAYMENT_REVIEW' }); };
  await f.service.pay(customer, f.id, 'pay');
  const restarted = createPaymentService({ store: f.open(), client: f.client, mode: 'TEST' });
  for (const operationId of ['recover', 'retry', 'retry-two']) assert.equal((await restarted.sync(customer, f.id, operationId)).payment.stage, 'review');
  assert.equal(attempted, 1);
});

test('cross-customer access and false order attribution never reserve a cake', async t => {
  const f = setup(t); await assert.rejects(f.service.pay({ shop, customerId: '8' }, f.id, 'attack'), { code: 'NOT_FOUND' });
  await f.service.pay(customer, f.id, 'pay'); f.paid(); f.order.customerId = gid('Customer', 8);
  const result = await f.service.sync(customer, f.id, 'sync');
  assert.equal(result.payment.stage, 'review'); assert.equal(result.status, 'quoted'); assert.deepEqual(result.payments, []);
});

for (const [name, change] of [
  ['wrong tags', order => { order.tags = ['ds-celebraciones']; }],
  ['wrong currency', order => { order.currency = 'EUR'; }],
  ['live money in test mode', order => { order.test = false; }],
  ['authorization without payment', order => { order.transactions[0].kind = 'AUTHORIZATION'; }],
  ['mismatched totals', order => { order.netPaymentCents = 9001; }],
  ['tax unexpectedly collected', order => { order.taxCents = 630; }],
  ['duplicate transaction ID', order => { order.transactions.push({ ...order.transactions[0] }); }],
  ['manual payment marked paid',order=>{order.transactions[0].manualPaymentGateway=true;order.transactions[0].gateway='manual';}],
]) test(`${name} cannot be attributed as a confirmed deposit`, async t => {
  const f = setup(t); await f.service.pay(customer, f.id, 'pay'); f.paid(); change(f.order);
  const result = await f.service.sync(customer, f.id, 'sync');
  assert.equal(result.payment.stage, 'review'); assert.equal(result.status, 'quoted'); assert.equal(f.calls.filter(([method]) => method === 'beginOrderEdit').length, 0);
});

test('refunds reduce actual received net, failed captures and authorization never add money', async t => {
  const f = setup(t); await f.service.pay(customer, f.id, 'pay'); f.paid();
  await f.service.sync(customer,f.id,'initial-sync');
  f.order.transactions.push({ id: gid('OrderTransaction', 2), kind: 'REFUND', status: 'SUCCESS', test: true, amountCents: 1000, currency: 'USD', parentId: gid('OrderTransaction') });
  f.order.transactions.push({ id: gid('OrderTransaction', 3), kind: 'CAPTURE', status: 'FAILURE', test: true, amountCents: 5000, currency: 'USD', parentId: null });
  f.order.netPaymentCents = 8000; f.order.refundedCents = 1000; f.order.outstandingCents = 7000; f.order.fullyPaid = false;
  const result = await f.service.sync(customer, f.id, 'sync');
  assert.equal(result.billing.netPaidCents, 8000); assert.equal(result.billing.balanceDueCents, 7000);
  assert.equal(result.payments.reduce((sum, payment) => sum + payment.amountCents, 0), 8000);
});

test('sync before payment intent has no remote calls and accepted tracking enables the deposit CTA',async t=>{
 const f=setup(t);const value=await f.service.sync(customer,f.id,'mount-sync');
 assert.equal(f.calls.length,0);assert.deepEqual(value.payment,{url:null,stage:'deposit',reviewRequired:false});
});

test('a completed authorization without captured funds cannot trigger an order edit',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();
 f.order.transactions[0].kind='AUTHORIZATION';f.order.receivedCents=f.order.netPaymentCents=0;f.order.outstandingCents=9000;f.order.fullyPaid=false;
 const value=await f.service.sync(customer,f.id,'sync');assert.equal(f.calls.filter(([name])=>name==='beginOrderEdit').length,0);assert.equal(value.billing,undefined);assert.equal(value.status,'quoted');
});

test('a bad created draft is quarantined and never duplicated on subsequent sync',async t=>{
 const f=setup(t);const create=f.client.createDepositDraft;
 f.client.createDepositDraft=async input=>{const draft=await create(input);draft.customerId=gid('Customer',8);return draft;};
 assert.equal((await f.service.pay(customer,f.id,'pay')).payment.reviewRequired,true);
 await f.service.sync(customer,f.id,'sync');assert.equal(f.calls.filter(([name])=>name==='createDepositDraft').length,1);
});

test('a pending payment suppresses edit, checkout URL and ready transition', async t => {
  const f = setup(t); await f.service.pay(customer, f.id, 'pay'); f.paid();
  f.order.transactions.push({ id: gid('OrderTransaction', 2), kind: 'CAPTURE', status: 'PENDING', test: true, amountCents: 6000, currency: 'USD', parentId: null });
  const snapshot = await f.service.sync(customer, f.id, 'sync');
  assert.equal(snapshot.payment.url, null); assert.notEqual(snapshot.payment.stage, 'paid'); assert.equal(f.calls.filter(([method]) => method === 'beginOrderEdit').length, 0);
  assert.throws(() => f.store.setStatus(staff, f.id, 'ready', 'fake-ready'), { code: 'CONFLICT' });
});

test('failed live authorization before a successful test deposit does not hide received money on a closed order',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();
 f.order.closed=true;f.client.reopenOrder=async id=>({orderId:id,closed:true});
 f.order.transactions.unshift({id:gid('OrderTransaction',2),kind:'AUTHORIZATION',status:'FAILURE',test:false,amountCents:9000,currency:'USD',parentId:null});
 const result=await f.service.sync(customer,f.id,'sync');
 assert.equal(result.payments.reduce((sum,payment)=>sum+payment.amountCents,0),9000);
 assert.equal(result.payments.length,1);assert.equal(result.payments[0].id,gid('OrderTransaction'));
 assert.equal(result.status,'reserved');assert.equal(result.payment.stage,'review');assert.equal(result.payment.url,null);
 assert.equal(f.calls.filter(([method])=>method==='beginOrderEdit').length,0);
});

for(const status of ['FAILURE','ERROR'])test(`failed financial attempts in a previous gateway mode (${status}) are ignored`,async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();
 f.order.transactions.unshift({id:gid('OrderTransaction',2),kind:'SALE',status,test:false,amountCents:9000,currency:'USD',parentId:null});
 const result=await f.service.sync(customer,f.id,'sync');
 assert.equal(result.billing.netPaidCents,9000);assert.equal(result.billing.balanceDueCents,6000);assert.equal(result.payment.stage,'balance');
});

for(const status of ['SUCCESS','PENDING','AWAITING_RESPONSE','UNKNOWN'])test(`effective or unresolved financial transactions retain strict gateway mode validation (${status})`,async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();
 f.order.transactions.push({id:gid('OrderTransaction',2),kind:'CAPTURE',status,test:false,amountCents:6000,currency:'USD',parentId:null});
 if(status==='SUCCESS'){f.order.receivedCents=f.order.netPaymentCents=15000;f.order.outstandingCents=-6000;f.order.fullyPaid=true;}
 const result=await f.service.sync(customer,f.id,'sync');
 assert.equal(result.payment.stage,'review');assert.equal(result.payment.url,null);assert.equal(f.calls.filter(([method])=>method==='beginOrderEdit').length,0);
});

test('a pending test payment still blocks edits when earlier nonfinancial attempts used live mode',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();
 f.order.transactions.unshift({id:gid('OrderTransaction',2),kind:'AUTHORIZATION',status:'FAILURE',test:false,amountCents:9000,currency:'USD',parentId:null});
 f.order.transactions.push({id:gid('OrderTransaction',3),kind:'CAPTURE',status:'PENDING',test:true,amountCents:6000,currency:'USD',parentId:null});
 const result=await f.service.sync(customer,f.id,'sync');
 assert.equal(result.payment.stage,'syncing');assert.equal(result.payment.url,null);assert.equal(result.payments.reduce((sum,payment)=>sum+payment.amountCents,0),9000);
 assert.equal(f.calls.filter(([method])=>method==='beginOrderEdit').length,0);
});

test('an accepted increase with an earlier unpaid checkout keeps its lines and adds only the new difference', async t => {
  const f = setup(t); await f.service.pay(customer, f.id, 'pay'); f.paid(); await f.service.sync(customer, f.id, 'sync');
  const originalLines=structuredClone(f.order.lineItems);
  f.store.propose(staff, f.id, proposal(17000), 'adjust');
  const accepted = f.store.accept(customer, f.id, 2, 'accept-adjust');
  assert.equal(accepted.payment.url, null);
  const result = await f.service.sync(customer, f.id, 'sync-adjust');
  assert.equal(result.payment.stage,'balance');assert.equal(result.billing.totalCents,17000);assert.equal(result.billing.netPaidCents,9000);assert.equal(result.billing.balanceDueCents,8000);
  assert.deepEqual(f.order.lineItems.slice(0,2),originalLines);assert.equal(f.order.lineItems[2].baseCents,2000);
  await f.service.sync(customer,f.id,'retry-adjust');
  assert.equal(f.calls.filter(([method]) => method === 'addCustomBalance').length, 2);assert.equal(f.calls.filter(([method])=>method==='removeLine').length,0);
});

test('a reduction with an earlier unpaid checkout uses a verified fixed discount on the same order',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'sync');
 f.store.propose(staff,f.id,proposal(13000),'reduce');f.store.accept(customer,f.id,2,'accept-reduce');
 const result=await f.service.sync(customer,f.id,'sync-reduce');assert.equal(result.payment.stage,'balance');assert.equal(result.billing.balanceDueCents,4000);
 assert.equal(f.order.totalCents,13000);assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,1);assert.equal(f.calls.filter(([name])=>name==='setCustomPriceDiscount').length,1);
});

test('an old checkout payment arriving during a new increase updates actual received money without a second add',async t=>{
 const f=setup(t,{totalCents:10000});await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial-balance');
 f.order.transactions.push({id:gid('OrderTransaction',2),kind:'SALE',status:'SUCCESS',test:true,amountCents:4000,currency:'USD',parentId:null});f.order.netPaymentCents=f.order.receivedCents=10000;f.order.outstandingCents=0;f.order.fullyPaid=true;
 await f.service.sync(customer,f.id,'paid-100');
 f.store.propose(staff,f.id,proposal(11000),'quote-110');f.store.accept(customer,f.id,2,'accept-110');await f.service.sync(customer,f.id,'sync-110');
 const oldLines=structuredClone(f.order.lineItems);
 f.store.propose(staff,f.id,proposal(12000),'quote-120');f.store.accept(customer,f.id,3,'accept-120');
 const commit=f.client.commitOrderEdit;
 f.client.commitOrderEdit=async id=>{const value=await commit(id);f.order.transactions.push({id:gid('OrderTransaction',3),kind:'CAPTURE',status:'SUCCESS',test:true,amountCents:1000,currency:'USD',parentId:null});f.order.netPaymentCents=f.order.receivedCents=11000;f.order.outstandingCents=1000;f.order.fullyPaid=false;return value;};
 const result=await f.service.sync(customer,f.id,'sync-120');
 assert.equal(result.billing.totalCents,12000);assert.equal(result.billing.netPaidCents,11000);assert.equal(result.billing.balanceDueCents,1000);assert.equal(result.payment.stage,'balance');
 assert.deepEqual(f.order.lineItems.slice(0,3),oldLines);assert.deepEqual(f.order.lineItems.map(line=>line.baseCents),[6000,4000,1000,1000]);
 await f.service.sync(customer,f.id,'sync-120');await f.service.sync(customer,f.id,'retry-120');
 assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,3);assert.equal(f.calls.filter(([name])=>name==='removeLine').length,0);
 assert.equal(result.payments.reduce((sum,payment)=>sum+payment.amountCents,0),11000);
});

for(const archived of [false,true])test(`an old balance paid during add is reconciled before validating preview and commits the same session (autoarchive=${archived})`,async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial-balance');
 f.store.propose(staff,f.id,proposal(17000),'quote-170');f.store.accept(customer,f.id,2,'accept-170');
 const add=f.client.addCustomBalance;
 f.client.addCustomBalance=async input=>{const value=await add(input);f.order.transactions.push({id:gid('OrderTransaction',2),kind:'SALE',status:'SUCCESS',test:true,amountCents:6000,currency:'USD',parentId:null});f.order.netPaymentCents=f.order.receivedCents=15000;f.order.outstandingCents=0;f.order.fullyPaid=true;f.order.closed=archived;value.calculatedOrder.outstandingCents=2000;return value;};
 const result=await f.service.sync(customer,f.id,'sync-170');
 assert.equal(result.payment.stage,'balance');assert.equal(result.billing.totalCents,17000);assert.equal(result.billing.netPaidCents,15000);assert.equal(result.billing.balanceDueCents,2000);
 assert.equal(f.calls.filter(([name])=>name==='beginOrderEdit').length,2);assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,2);assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,2);assert.equal(f.calls.filter(([name])=>name==='reopenOrder').length,archived?1:0);
 await f.service.sync(customer,f.id,'retry-170');assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,2);
});

test('an increase after full payment preserves existing commercial lines and adds only the difference', async t => {
  const f = setup(t); await f.service.pay(customer, f.id, 'pay'); f.paid(); await f.service.sync(customer, f.id, 'sync');
  f.order.transactions.push({ id: gid('OrderTransaction', 2), kind: 'SALE', status: 'SUCCESS', test: true, amountCents: 6000, currency: 'USD', parentId: null });
  f.order.netPaymentCents = f.order.receivedCents = 15000; f.order.outstandingCents = 0; f.order.fullyPaid = true;
  await f.service.sync(customer, f.id, 'paid');
  f.order.lineItems.forEach(line=>{line.editableQuantity=0;});
  const originalLines=structuredClone(f.order.lineItems);
  f.store.propose(staff, f.id, proposal(17000), 'adjust'); f.store.accept(customer, f.id, 2, 'accept-adjust');
  const result = await f.service.sync(customer, f.id, 'sync-adjust');
  assert.equal(result.billing.netPaidCents, 15000); assert.equal(result.billing.balanceDueCents, 2000); assert.equal(result.payment.stage, 'balance');
  assert.equal(f.order.lineItems.reduce((sum, line) => sum + line.quantity * line.baseCents, 0), 17000);
  assert.equal(f.calls.filter(([method]) => method === 'removeLine').length, 0);
  assert.deepEqual(f.order.lineItems.slice(0,2),originalLines);
  assert.equal(f.order.lineItems[2].baseCents,2000);
});

test('successive fulfilled-order increases 100 to 110 to 120 retain 60 and 40 and add 10 each time',async t=>{
 const f=setup(t,{totalCents:10000});await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial-balance');
 function settle(amount,transactionId){
  const due=amount-f.order.netPaymentCents;
  f.order.transactions.push({id:gid('OrderTransaction',transactionId),kind:'SALE',status:'SUCCESS',test:true,amountCents:due,currency:'USD',parentId:null});
  f.order.netPaymentCents=f.order.receivedCents=amount;f.order.outstandingCents=0;f.order.fullyPaid=true;f.order.closed=true;
  f.order.lineItems.forEach(line=>{line.editableQuantity=0;});
 }
 settle(10000,2);await f.service.sync(customer,f.id,'paid-100');
 const originalLines=structuredClone(f.order.lineItems);
 assert.deepEqual(originalLines.map(line=>line.baseCents),[6000,4000]);
 for(const [version,target,operation]of [[2,11000,'increase-110'],[3,12000,'increase-120']]){
  f.store.propose(staff,f.id,proposal(target),`proposal-${version}`);f.store.accept(customer,f.id,version,`accept-${version}`);
  const result=await f.service.sync(customer,f.id,operation);
  assert.equal(result.payment.stage,'balance');assert.equal(result.billing.balanceDueCents,1000);assert.equal(result.billing.netPaidCents,target-1000);
  const added=f.calls.filter(([name])=>name==='addCustomBalance').length;
  await f.service.sync(customer,f.id,operation);await f.service.sync(customer,f.id,`${operation}-retry`);
  assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,added);
  assert.deepEqual(f.order.lineItems.slice(0,2),originalLines);
  assert.equal(f.order.lineItems.at(-1).baseCents,1000);
  if(version===2){settle(11000,3);await f.service.sync(customer,f.id,'paid-110');}
 }
 assert.deepEqual(f.order.lineItems.map(line=>line.baseCents),[6000,4000,1000,1000]);
 assert.equal(f.calls.filter(([name])=>name==='removeLine').length,0);
 assert.equal(f.calls.filter(([name])=>name==='createDepositDraft').length,1);
 assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,3);
});

test('a decrease discounts fulfilled lines and exposes credit without inventing a refund',async t=>{
 const f=setup(t,{totalCents:10000});await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial-balance');
 f.order.transactions.push({id:gid('OrderTransaction',2),kind:'SALE',status:'SUCCESS',test:true,amountCents:4000,currency:'USD',parentId:null});
 f.order.netPaymentCents=f.order.receivedCents=10000;f.order.outstandingCents=0;f.order.fullyPaid=true;f.order.lineItems.forEach(line=>{line.editableQuantity=0;});
 await f.service.sync(customer,f.id,'paid');const originalLines=structuredClone(f.order.lineItems);
 f.store.propose(staff,f.id,proposal(9000),'decrease');f.store.accept(customer,f.id,2,'accept-decrease');
 await f.service.sync(customer,f.id,'sync-decrease');const result=await f.service.sync(customer,f.id,'review-decrease');
 assert.equal(result.payment.stage,'review');assert.equal(result.payment.url,null);assert.equal(result.payments.reduce((sum,payment)=>sum+payment.amountCents,0),10000);
 assert.equal(f.order.totalCents,9000);assert.equal(f.order.refundedCents,0);assert.deepEqual(f.order.lineItems.map(({id,title,quantity,baseCents})=>({id,title,quantity,baseCents})),originalLines.map(({id,title,quantity,baseCents})=>({id,title,quantity,baseCents})));
 assert.equal(result.billing.overpaymentCents,1000);assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,2);assert.equal(f.calls.filter(([name])=>name==='removeLine').length,0);
});

test('successive pending-balance reductions update owned fixed discounts and preserve all lines',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');const original=f.order.lineItems.map(line=>({...line,editableQuantity:0}));f.order.lineItems=structuredClone(original);
 for(const [version,total]of [[2,13000],[3,12000]]){
  f.store.propose(staff,f.id,proposal(total),`reduce-${version}`);f.store.accept(customer,f.id,version,`accept-${version}`);
  const result=await f.service.sync(customer,f.id,`sync-${version}`);assert.equal(result.payment.stage,'balance');assert.equal(result.billing.totalCents,total);assert.equal(result.billing.balanceDueCents,total-9000);
  const count=f.calls.filter(([name])=>name==='setCustomPriceDiscount').length;await f.service.sync(customer,f.id,`retry-${version}`);assert.equal(f.calls.filter(([name])=>name==='setCustomPriceDiscount').length,count);
 }
 const discounts=f.calls.filter(([name])=>name==='setCustomPriceDiscount').map(([,input])=>input);assert.equal(discounts.length,2);assert.equal(discounts[0].discountCents,2000);assert.equal(discounts[1].discountCents,3000);assert.ok(discounts[1].discountApplicationId);
 assert.deepEqual(f.order.lineItems.map(line=>line.id),original.map(line=>line.id));assert.equal(f.calls.filter(([name])=>name==='removeLine').length,0);
 f.store.propose(staff,f.id,proposal(14000),'increase');f.store.accept(customer,f.id,4,'accept-increase');const increase=await f.service.sync(customer,f.id,'increase-sync');assert.equal(increase.billing.totalCents,14000);assert.equal(increase.billing.balanceDueCents,5000);assert.equal(f.order.lineItems.at(-1).baseCents,2000);
});

for(const target of [9000,7000])test(`reduction to ${target} shows exact received money and requires a real refund for credit`,async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');
 f.store.propose(staff,f.id,proposal(target),'reduce');f.store.accept(customer,f.id,2,'accept-reduce');
 const result=await f.service.sync(customer,f.id,'reduce-sync');assert.equal(result.billing.totalCents,target);assert.equal(result.billing.netPaidCents,9000);assert.equal(result.billing.balanceDueCents,0);assert.equal(result.billing.overpaymentCents,9000-target);assert.equal(result.payment.url,null);assert.equal(result.payment.stage,target===9000?'paid':'review');
 if(target<9000){assert.throws(()=>f.store.setStatus(staff,f.id,'ready','ready'),{code:'CONFLICT'});f.order.transactions.push({id:gid('OrderTransaction',2),kind:'REFUND',status:'SUCCESS',test:true,amountCents:2000,currency:'USD',parentId:gid('OrderTransaction')});f.order.refundedCents=2000;f.order.netPaymentCents=7000;f.order.outstandingCents=0;f.order.fullyPaid=true;assert.equal((await f.service.sync(customer,f.id,'real-refund')).payment.stage,'paid');}
 assert.equal(f.calls.filter(([name])=>name==='createDepositDraft').length,1);
});

for(const interrupted of ['discount','commit'])test(`an ambiguous ${interrupted} response recovers a reduction after restart without repeating it`,async t=>{
 const f=setup(t,{durable:true});await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');
 f.store.propose(staff,f.id,proposal(13000),'reduce');f.store.accept(customer,f.id,2,'accept-reduce');
 const method=interrupted==='discount'?'setCustomPriceDiscount':'commitOrderEdit',original=f.client[method];
 f.client[method]=async input=>{const value=await original(input);throw Object.assign(new Error('lost response'),{code:'PAYMENT_REVIEW'});};
 assert.equal((await f.service.sync(customer,f.id,'first')).payment.stage,'review');
 f.client[method]=original;
 const recovered=await createPaymentService({store:f.open(),client:f.client,mode:'TEST'}).sync(customer,f.id,'recover');
 assert.equal(recovered.payment.stage,'balance');assert.equal(recovered.billing.totalCents,13000);assert.equal(f.calls.filter(([name])=>name==='setCustomPriceDiscount').length,1);assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,2);
 await f.service.sync(customer,f.id,'again');assert.equal(f.calls.filter(([name])=>name==='setCustomPriceDiscount').length,1);
});

for(const paymentStatus of ['SUCCESS','PENDING'])test(`old checkout ${paymentStatus} during reduction preserves real money and the existing edit`,async t=>{
 let time=Date.now(),alarm=null;
 const f=setup(t,{durable:true,clock:()=>time});await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');
 f.store.propose(staff,f.id,proposal(13000),'reduce');f.store.accept(customer,f.id,2,'accept-reduce');
 const discount=f.client.setCustomPriceDiscount;f.client.setCustomPriceDiscount=async input=>{const value=await discount(input);f.order.transactions.push({id:gid('OrderTransaction',2),kind:'SALE',status:paymentStatus,test:true,amountCents:6000,currency:'USD'});if(paymentStatus==='SUCCESS'){f.order.receivedCents=f.order.netPaymentCents=15000;f.order.outstandingCents=0;f.order.fullyPaid=true;f.order.closed=true;}return value;};
 let result=await f.service.sync(customer,f.id,'reduce-sync');
 if(paymentStatus==='PENDING'){
  assert.equal(result.payment.stage,'syncing');assert.equal(result.payment.url,null);f.order.transactions[1].status='SUCCESS';f.order.receivedCents=f.order.netPaymentCents=15000;f.order.outstandingCents=0;f.order.fullyPaid=true;f.order.closed=true;
  const reopened=f.open(),service=createPaymentService({store:reopened,client:f.client,mode:'TEST',now:()=>time});const storage={getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;},deleteAlarm:async()=>{alarm=null;}};
  const scheduler=createPaymentScheduler({store:reopened,service,storage,shop,now:()=>time});await scheduler.ensure();assert.ok(alarm!==null);time=alarm;await scheduler.run();result=reopened.getTracking(customer,f.id);
 }
 assert.equal(result.payment.stage,'review');assert.equal(result.payment.url,null);assert.equal(result.billing.totalCents,13000);assert.equal(result.billing.netPaidCents,15000);assert.equal(result.billing.overpaymentCents,2000);assert.equal(f.order.refundedCents,0);
 assert.equal(f.calls.filter(([name])=>name==='setCustomPriceDiscount').length,1);assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,2);assert.equal(f.calls.filter(([name])=>name==='reopenOrder').length,1);
 assert.throws(()=>f.store.setStatus(staff,f.id,'ready','ready'),{code:'CONFLICT'});
});

test('a matching discount name without durable line ownership is rejected',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');
 const line=f.order.lineItems[1];line.discountCents=1000;line.discounts=[{amountCents:1000,kind:'ManualDiscountApplication',applicationId:null,description:'Ajuste de precio aceptado: propuesta 2',targetType:'LINE_ITEM',valueType:'MoneyV2',valueCents:1000}];f.order.discountCents=1000;f.order.subtotalCents=f.order.totalCents=14000;f.order.outstandingCents=5000;
 const count=f.calls.filter(([name])=>name==='beginOrderEdit').length;assert.equal((await f.service.sync(customer,f.id,'spoof')).payment.stage,'review');assert.equal(f.calls.filter(([name])=>name==='beginOrderEdit').length,count);
});

for(const alteration of ['amount','kind','identity','description'])test(`owned price discounts reject external ${alteration} changes`,async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');f.store.propose(staff,f.id,proposal(13000),'reduce');f.store.accept(customer,f.id,2,'accept-reduce');await f.service.sync(customer,f.id,'reduce-sync');
 const line=f.order.lineItems.find(line=>line.discountCents);if(alteration==='amount')line.discounts[0].valueCents++;if(alteration==='kind')line.discounts[0].kind='DiscountCodeApplication';if(alteration==='identity')line.id=gid('LineItem',999);if(alteration==='description')line.discounts[0].description='Other adjustment';
 assert.equal((await f.service.sync(customer,f.id,'tampered')).payment.stage,'review');
});

test('a partially staged multi-line reduction stays in review without replaying its mutation',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');f.store.propose(staff,f.id,proposal(7000),'reduce');f.store.accept(customer,f.id,2,'accept-reduce');
 const discount=f.client.setCustomPriceDiscount;f.client.setCustomPriceDiscount=async input=>{await discount(input);throw Object.assign(new Error('lost'),{code:'PAYMENT_REVIEW'});};
 for(const operation of ['first','retry'])assert.equal((await f.service.sync(customer,f.id,operation)).payment.stage,'review');assert.equal(f.calls.filter(([name])=>name==='setCustomPriceDiscount').length,1);assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,1);assert.equal(f.order.totalCents,15000);
});

test('a reduction uses exact cents across multiple fulfilled lines',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');f.order.lineItems.forEach(line=>{line.editableQuantity=0;});f.store.propose(staff,f.id,proposal(6999),'reduce');f.store.accept(customer,f.id,2,'accept-reduce');
 const value=await f.service.sync(customer,f.id,'reduce-sync');assert.equal(value.billing.totalCents,6999);assert.equal(value.billing.overpaymentCents,2001);assert.deepEqual(f.calls.filter(([name])=>name==='setCustomPriceDiscount').map(([,input])=>input.discountCents),[6000,2001]);assert.equal(f.calls.filter(([name])=>name==='removeLine').length,0);
});

test('an interrupted reduction cannot commit after a different proposal is accepted',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');f.store.propose(staff,f.id,proposal(13000),'reduce');f.store.accept(customer,f.id,2,'accept-reduce');
 const discount=f.client.setCustomPriceDiscount;f.client.setCustomPriceDiscount=async input=>{await discount(input);throw Object.assign(new Error('lost'),{code:'PAYMENT_REVIEW'});};await f.service.sync(customer,f.id,'stage');
 f.store.propose(staff,f.id,proposal(12000),'new-reduce');f.store.accept(customer,f.id,3,'accept-new');
 assert.equal((await f.service.sync(customer,f.id,'recover')).payment.stage,'review');assert.equal(f.order.totalCents,15000);assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,1);assert.equal(f.calls.filter(([name])=>name==='setCustomPriceDiscount').length,1);
});

test('a missing calculated application identity never adds a second discount to an owned line',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');f.store.propose(staff,f.id,proposal(13000),'reduce');f.store.accept(customer,f.id,2,'accept-reduce');await f.service.sync(customer,f.id,'reduce-sync');
 f.store.propose(staff,f.id,proposal(12000),'reduce-again');f.store.accept(customer,f.id,3,'accept-again');const begin=f.client.beginOrderEdit;f.client.beginOrderEdit=async()=>{const value=await begin();value.lineItems.forEach(line=>line.discounts?.forEach(discount=>{discount.applicationId=null;}));return value;};
 assert.equal((await f.service.sync(customer,f.id,'sync-again')).payment.stage,'review');assert.equal(f.order.totalCents,13000);assert.equal(f.calls.filter(([name])=>name==='setCustomPriceDiscount').length,1);
});

test('price below money received is represented without refund and remains in review', async t => {
  const f = setup(t); await f.service.pay(customer, f.id, 'pay'); f.paid();
  f.store.propose(staff, f.id, proposal(7000), 'adjust'); f.store.accept(customer, f.id, 2, 'accept-adjust');
  const result = await f.service.sync(customer, f.id, 'sync-adjust');
  assert.equal(result.billing.netPaidCents, 9000); assert.equal(result.billing.overpaymentCents, 2000); assert.equal(result.payment.url, null);
  assert.equal(result.payment.reviewRequired, true);
});

test('lost edit commit response is reconciled without committing or adding the balance again', async t => {
  const f = setup(t); await f.service.pay(customer, f.id, 'pay'); f.paid(); const commit = f.client.commitOrderEdit;
  f.client.commitOrderEdit = async id => { await commit(id); throw Object.assign(new Error('timeout'), { code: 'PAYMENT_REVIEW' }); };
  assert.equal((await f.service.sync(customer, f.id, 'sync')).payment.stage, 'review');
  const recovered = await f.service.sync(customer, f.id, 'recover');
  assert.equal(recovered.payment.stage, 'balance');
  assert.equal(f.calls.filter(([method]) => method === 'commitOrderEdit').length, 1);
  assert.equal(f.calls.filter(([method]) => method === 'addCustomBalance').length, 1);
});

test('crash between draft response and saving its ID never repeats draft creation',async t=>{
 const f=setup(t,{durable:true});let interrupted=false;
 const crashingStore={...f.store,checkpointPayment(...args){if(!interrupted&&args[3].draftId){interrupted=true;throw new Error('process interruption');}return f.store.checkpointPayment(...args);}};
 const service=createPaymentService({store:crashingStore,client:f.client,mode:'TEST'});
 assert.equal((await service.pay(customer,f.id,'pay')).payment.reviewRequired,true);
 const recovered=await createPaymentService({store:f.open(),client:f.client,mode:'TEST'}).sync(customer,f.id,'recover');
 assert.equal(recovered.payment.stage,'deposit');assert.equal(f.calls.filter(([name])=>name==='createDepositDraft').length,1);
});

test('uncertain intermediate order edits require review and never repeat any mutation',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();
 const add=f.client.addCustomBalance;f.client.addCustomBalance=async input=>{await add(input);throw Object.assign(new Error('lost'),{code:'PAYMENT_REVIEW'});};
 assert.equal((await f.service.sync(customer,f.id,'sync')).payment.reviewRequired,true);
 const result=await f.service.sync(customer,f.id,'retry');assert.equal(result.payment.reviewRequired,true);
 assert.equal(f.calls.filter(([name])=>name==='beginOrderEdit').length,1);assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,1);assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,0);
});

test('missing customer permission blocks checkout before any draft attempt',async t=>{
 const f=setup(t);f.client.checkConfiguration=async()=>({currency:'USD',scopes:['write_draft_orders','read_orders','write_order_edits','write_orders'],locations:[]});
 const diagnostic=await f.service.checkConfiguration();assert.equal(diagnostic.configured,false);assert.deepEqual(diagnostic.missingScopes,['read_customers']);
 await assert.rejects(f.service.pay(customer,f.id,'pay'),{code:'UNAVAILABLE'});assert.equal(f.calls.length,0);
});

test('unexpected tax or total in calculated preview prevents committing the edit',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();const add=f.client.addCustomBalance;
 f.client.addCustomBalance=async input=>{const value=await add(input);value.calculatedOrder.taxLines=[{amountCents:1}];value.calculatedOrder.totalCents++;return value;};
 const value=await f.service.sync(customer,f.id,'sync');assert.equal(value.payment.reviewRequired,true);assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,0);
});

test('durable alarms reserve after deposit and reconcile final balance when the browser never returns',async t=>{
 let time=Date.now(),alarm=null;
 const f=setup(t,{durable:true,clock:()=>time});
 const storage={getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;},deleteAlarm:async()=>{alarm=null;}};
 let scheduler=createPaymentScheduler({store:f.store,service:f.service,storage,shop,now:()=>time});
 await scheduler.begin();await f.service.pay(customer,f.id,'pay');await scheduler.end();
 assert.equal(alarm,time+300000);f.paid();time+=300000;
 // Simulate an evicted Durable Object with SQL and its alarm surviving.
 const reopened=f.open(),service=createPaymentService({store:reopened,client:f.client,mode:'TEST',now:()=>time});
 scheduler=createPaymentScheduler({store:reopened,service,storage,shop,now:()=>time});
 await scheduler.ensure();await scheduler.run();
 const reserved=reopened.getTracking(customer,f.id);assert.equal(reserved.status,'reserved');assert.equal(reserved.payment.stage,'balance');assert.equal(reserved.billing.netPaidCents,9000);
 f.order.transactions.push({id:gid('OrderTransaction',2),kind:'CAPTURE',status:'SUCCESS',test:true,amountCents:6000,currency:'USD',parentId:null});
 f.order.netPaymentCents=f.order.receivedCents=15000;f.order.outstandingCents=0;f.order.fullyPaid=true;
 time+=300000;await scheduler.run();
 const completed=reopened.getTracking(customer,f.id);assert.equal(completed.payment.stage,'paid');assert.equal(completed.billing.balanceDueCents,0);assert.equal(alarm,null);
 assert.equal(f.calls.filter(([name])=>name==='createDepositDraft').length,1);assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,1);
});

test('failed preflight returns a safe diagnostic while keeping checkout disabled',async t=>{
 const f=setup(t);
 f.client.checkConfiguration=async()=>{throw Object.assign(new Error('test-secret private@example.test'),{diagnostic:{stage:'token',httpStatus:400,code:'shop_not_permitted',raw:'private@example.test'},cause:'test-token'});};
 const result=await f.service.checkConfiguration();
 assert.deepEqual(result,{configured:false,mode:'TEST',currency:null,scopes:[],locations:[],missingScopes:[],diagnostic:{stage:'token',httpStatus:400,code:'shop_not_permitted'}});
 assert.doesNotMatch(JSON.stringify(result),/test-secret|private@|test-token|raw|cause/);
 await assert.rejects(f.service.pay(customer,f.id,'pay'),{code:'UNAVAILABLE'});assert.equal(f.calls.length,0);
});

test('preflight sanitizes untrusted diagnostic fields and never forwards unknown errors',async t=>{
 const f=setup(t);
 f.client.checkConfiguration=async()=>{throw Object.assign(new Error('private@example.test'),{diagnostic:{stage:'private@example.test',httpStatus:1000,code:'private@example.test'}});};
 const result=await f.service.checkConfiguration();
 assert.deepEqual(result.diagnostic,{stage:null,httpStatus:null,code:'unknown'});assert.equal(result.configured,false);assert.equal(result.currency,null);
});

test('staff diagnostic reports a closed-order stop without IDs, money, URLs or customer text',async t=>{
 const logs=[],f=setup(t,{onDiagnostic:value=>logs.push(value)});await f.service.pay(customer,f.id,'pay');f.paid();f.order.closed=true;f.client.reopenOrder=async id=>({orderId:id,closed:true});
 const result=await f.service.sync(customer,f.id,'sync');assert.equal(result.payment.stage,'review');
 assert.deepEqual(logs,[{phase:'verify-opened-order',uncertainPhase:'order-open',reason:'ORDER_STILL_CLOSED',diagnostic:{stage:null,httpStatus:null,code:'unknown'}}]);
 assert.doesNotMatch(JSON.stringify(logs),/gid:|https:|9000|15000|customer|Pastel/);
});

test('staff diagnostic distinguishes a rejected edit begin from an ambiguous add without retrying either',async t=>{
 for(const [method,phase,errorCode,uncertainPhase]of [['beginOrderEdit','edit-begin','VALIDATION',null],['addCustomBalance','edit-add','PAYMENT_REVIEW','edit-add']]){
  const logs=[],f=setup(t,{onDiagnostic:value=>logs.push(value)});await f.service.pay(customer,f.id,'pay');f.paid();let attempts=0;
  f.client[method]=async()=>{attempts++;throw Object.assign(new Error('test-token private@example.test'),{code:errorCode,diagnostic:{stage:'graphql',httpStatus:200,code:'ACCESS_DENIED',raw:'test-token'},payload:'private@example.test'});};
  await f.service.sync(customer,f.id,'sync');
  assert.deepEqual(logs[0],{phase,uncertainPhase,reason:errorCode==='VALIDATION'?'VALIDATION_ERROR':'PAYMENT_REVIEW',diagnostic:{stage:'graphql',httpStatus:200,code:'ACCESS_DENIED'}});
  assert.doesNotMatch(JSON.stringify(logs),/test-token|private@|payload|raw/);
  if(uncertainPhase){await f.service.sync(customer,f.id,'retry');assert.equal(attempts,1);assert.equal(logs.at(-1).reason,'STAGED_EDIT_INSPECTED');assert.equal(logs.at(-1).uncertainPhase,'edit-add');}
 }
});

test('staff diagnostic separates calculated totals from a missing or untrusted payment URL',async t=>{
 for(const reason of ['CALCULATED_MISMATCH','PAYMENT_URL_MISSING','PAYMENT_URL_UNTRUSTED']){
  const logs=[],f=setup(t,{onDiagnostic:value=>logs.push(value)});await f.service.pay(customer,f.id,'pay');f.paid();
  if(reason==='CALCULATED_MISMATCH'){const add=f.client.addCustomBalance;f.client.addCustomBalance=async input=>{const value=await add(input);value.calculatedOrder.totalCents++;return value;};}
  else f.client.getAdditionalPaymentUrl=async()=>reason==='PAYMENT_URL_MISSING'?null:'https://shopify.com/private-token';
  const result=await f.service.sync(customer,f.id,'sync');assert.equal(result.payment.stage,'review');assert.equal(logs.at(-1).reason,reason);
  assert.doesNotMatch(JSON.stringify(logs),/https:|private-token|gid:/);
 }
});

test('throwing diagnostic callbacks never affect reconciliation or its persisted outcome',async t=>{
 const f=setup(t,{onDiagnostic:()=>{throw new Error('logger failure');}});await f.service.pay(customer,f.id,'pay');f.paid();f.order.closed=true;f.client.reopenOrder=async id=>({orderId:id,closed:true});
 const result=await f.service.sync(customer,f.id,'sync');assert.equal(result.payment.stage,'review');assert.equal(result.payments[0].amountCents,9000);assert.equal(result.status,'reserved');
});

test('discount ledger diagnostics identify changed metadata after update without exposing values or retrying mutations',async t=>{
 const logs=[],f=setup(t,{onDiagnostic:value=>logs.push(value)});await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');
 f.store.propose(staff,f.id,proposal(13000),'reduce');f.store.accept(customer,f.id,2,'accept-reduce');await f.service.sync(customer,f.id,'reduce-sync');
 const oldDescription=f.order.lineItems.find(line=>line.discountCents).discounts[0].description;
 f.store.propose(staff,f.id,proposal(12000),'reduce-again');f.store.accept(customer,f.id,3,'accept-again');
 const commit=f.client.commitOrderEdit;f.client.commitOrderEdit=async()=>{const value=await commit();f.order.lineItems.find(line=>line.discountCents).discounts[0].description=oldDescription;return value;};
 logs.length=0;const result=await f.service.sync(customer,f.id,'second-sync');assert.equal(result.payment.stage,'review');
 const diagnostic=logs.at(-1).discountLedger;assert.equal(diagnostic.plannedMatches,false);assert.equal(diagnostic.plannedTargetMatches,true);assert.equal(diagnostic.aggregateMatches,true);assert.equal(diagnostic.planned.descriptionMatches,false);assert.equal(diagnostic.planned.allocatedAmountMatches,true);assert.equal(diagnostic.planned.fixedValueMatches,true);assert.equal(diagnostic.allocationCount,1);
 assert.doesNotMatch(JSON.stringify(logs),/gid:|https:|13000|12000|3000|Ajuste|propuesta|customer|description\":/);
 const attempts=f.calls.filter(([name])=>['setCustomPriceDiscount','commitOrderEdit'].includes(name)).length;await f.service.sync(customer,f.id,'inspect');assert.equal(f.calls.filter(([name])=>['setCustomPriceDiscount','commitOrderEdit'].includes(name)).length,attempts);
});

test('a committed update with zero historical allocation recovers without another update or commit',async t=>{
 const logs=[],f=setup(t,{durable:true,onDiagnostic:value=>logs.push(value)});await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');
 f.store.propose(staff,f.id,proposal(13000),'reduce');f.store.accept(customer,f.id,2,'accept-reduce');await f.service.sync(customer,f.id,'reduce-sync');
 const historical=structuredClone(f.order.lineItems.find(line=>line.discountCents).discounts[0]);historical.amountCents=0;
 f.store.propose(staff,f.id,proposal(12000),'reduce-again');f.store.accept(customer,f.id,3,'accept-again');
 const commit=f.client.commitOrderEdit;f.client.commitOrderEdit=async()=>{await commit();f.order.lineItems.find(line=>line.discountCents).discounts.unshift(historical);throw Object.assign(new Error('lost commit response'),{code:'PAYMENT_REVIEW'});};
 assert.equal((await f.service.sync(customer,f.id,'second-sync')).payment.stage,'review');
 const attempts=f.calls.filter(([name])=>['setCustomPriceDiscount','commitOrderEdit'].includes(name)).length;
 const service=createPaymentService({store:f.open(),client:f.client,mode:'TEST',onDiagnostic:value=>logs.push(value)}),recovered=await service.sync(customer,f.id,'recover');
 assert.equal(recovered.payment.stage,'balance');assert.equal(recovered.billing.totalCents,12000);assert.equal(recovered.billing.netPaidCents,9000);assert.equal(recovered.billing.balanceDueCents,3000);
 await service.sync(customer,f.id,'inspect');assert.equal(f.calls.filter(([name])=>['setCustomPriceDiscount','commitOrderEdit'].includes(name)).length,attempts);
 f.client.commitOrderEdit=commit;
 const begin=f.client.beginOrderEdit;f.client.beginOrderEdit=async()=>{const value=await begin();for(const line of value.lineItems)for(const discount of line.discounts||[])discount.applicationId=discount.amountCents===0?'gid://shopify/CalculatedManualDiscountApplication/historical':'gid://shopify/CalculatedManualDiscountApplication/current';return value;};
 const update=f.client.setCustomPriceDiscount;f.client.setCustomPriceDiscount=async input=>{assert.equal(input.discountApplicationId,'gid://shopify/CalculatedManualDiscountApplication/current');return update(input);};
 f.store.propose(staff,f.id,proposal(11000),'third-reduction');f.store.accept(customer,f.id,4,'accept-third');
 const third=await service.sync(customer,f.id,'third-sync');assert.equal(third.payment.stage,'balance',JSON.stringify(logs));assert.equal(third.billing.totalCents,11000);assert.equal(third.billing.balanceDueCents,2000);
});

for(const amountCents of [-1,0.5,NaN,1])test(`a zero allocation exception never accepts an invalid or foreign positive allocation (${amountCents})`,async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'initial');f.store.propose(staff,f.id,proposal(13000),'reduce');f.store.accept(customer,f.id,2,'accept-reduce');await f.service.sync(customer,f.id,'reduce-sync');
 const line=f.order.lineItems.find(line=>line.discountCents);line.discounts.unshift({...line.discounts[0],amountCents,description:'External discount'});
 const attempts=f.calls.filter(([name])=>['setCustomPriceDiscount','commitOrderEdit'].includes(name)).length;assert.equal((await f.service.sync(customer,f.id,'inspect')).payment.stage,'review');assert.equal(f.calls.filter(([name])=>['setCustomPriceDiscount','commitOrderEdit'].includes(name)).length,attempts);
});

test('uncertain add reads its existing calculated order and reports target flags without any additional mutation',async t=>{
 const logs=[],f=setup(t,{onDiagnostic:value=>logs.push(value)});await f.service.pay(customer,f.id,'pay');f.paid();const add=f.client.addCustomBalance;
 f.client.addCustomBalance=async input=>{await add(input);throw Object.assign(new Error('lost response'),{code:'PAYMENT_REVIEW'});};
 await f.service.sync(customer,f.id,'sync');const before=f.calls.filter(([name])=>['createDepositDraft','beginOrderEdit','addCustomBalance','commitOrderEdit','removeLine'].includes(name)).length;
 logs.length=0;const snapshot=await f.service.sync(customer,f.id,'inspect');
 assert.equal(snapshot.payment.stage,'review');assert.equal(f.store.getPaymentContext(customer,f.id).state.uncertainPhase,'edit-add');
 assert.equal(f.calls.filter(([name])=>name==='readCalculatedOrder').length,1);
 assert.equal(f.calls.filter(([name])=>['createDepositDraft','beginOrderEdit','addCustomBalance','commitOrderEdit','removeLine'].includes(name)).length,before);
 const log=logs.find(value=>value.reason==='STAGED_EDIT_INSPECTED');assert.equal(log.phase,'read-calculated-order');
 assert.deepEqual(log.stagedEdit,{matchesExpectedOrder:true,stagedBalanceCount:1,matchesTarget:true,matchesSubtotal:true,matchesOutstanding:true,matchesTax:true});
 assert.doesNotMatch(JSON.stringify(log),/gid:|https:|9000|15000|6000|title/);
});

test('a closed owned order with confirmed deposit is reopened before adding its balance',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();f.order.closed=true;
 const result=await f.service.sync(customer,f.id,'sync');
 assert.equal(result.payment.stage,'balance');assert.equal(result.billing.netPaidCents,9000);assert.equal(result.billing.balanceDueCents,6000);
 assert.equal(f.calls.filter(([name])=>name==='reopenOrder').length,1);
 assert.ok(f.calls.findIndex(([name])=>name==='reopenOrder')<f.calls.findIndex(([name])=>name==='beginOrderEdit'));
 assert.equal(f.calls.filter(([name])=>name==='createDepositDraft').length,1);
});

test('unauthorized, wrongly attributed, pending or underpaid orders are never reopened',async t=>{
 for(const variant of ['unauthorized','tags','customer','partial','pending']){
  const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();f.order.closed=true;
  if(variant==='unauthorized'){await assert.rejects(f.service.sync({shop,customerId:'8'},f.id,'sync'),{code:'NOT_FOUND'});}
  else{
   if(variant==='tags')f.order.tags=[];
   if(variant==='customer')f.order.customerId=gid('Customer',8);
   if(variant==='partial'){f.order.transactions[0].amountCents=8000;f.order.receivedCents=f.order.netPaymentCents=8000;f.order.outstandingCents=1000;f.order.fullyPaid=false;}
   if(variant==='pending')f.order.transactions.push({id:gid('OrderTransaction',2),kind:'CAPTURE',status:'PENDING',test:true,amountCents:1000,currency:'USD'});
   const result=await f.service.sync(customer,f.id,'sync');assert.equal(result.payment.url,null);
  }
  assert.equal(f.calls.filter(([name])=>name==='reopenOrder').length,0);assert.equal(f.calls.filter(([name])=>name==='beginOrderEdit').length,0);
 }
});

test('a lost reopen response is reconciled by GET after restart without a second orderOpen',async t=>{
 const f=setup(t,{durable:true});await f.service.pay(customer,f.id,'pay');f.paid();f.order.closed=true;const reopen=f.client.reopenOrder;
 f.client.reopenOrder=async id=>{await reopen(id);throw Object.assign(new Error('lost response'),{code:'PAYMENT_REVIEW'});};
 assert.equal((await f.service.sync(customer,f.id,'sync')).payment.stage,'review');
 assert.equal(f.store.getPaymentContext(customer,f.id).state.uncertainPhase,'order-open');
 const service=createPaymentService({store:f.open(),client:f.client,mode:'TEST'});
 const recovered=await service.sync(customer,f.id,'recover');
 assert.equal(recovered.payment.stage,'balance');assert.equal(f.calls.filter(([name])=>name==='reopenOrder').length,1);assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,1);
});

test('a still closed order remains in review and subsequent sync never blindly reopens it again',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();f.order.closed=true;let attempts=0;
 f.client.reopenOrder=async id=>{attempts++;return{orderId:id,closed:true};};
 for(const operationId of ['sync','again'])assert.equal((await f.service.sync(customer,f.id,operationId)).payment.stage,'review');
 assert.equal(attempts,1);assert.equal(f.calls.filter(([name])=>name==='beginOrderEdit').length,0);
 assert.equal(f.store.getPaymentContext(customer,f.id).state.uncertainPhase,'order-open');
});

test('reopen is followed by a fresh ownership and payment check before any edit',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();f.order.closed=true;const reopen=f.client.reopenOrder;
 f.client.reopenOrder=async id=>{const result=await reopen(id);f.order.customerId=gid('Customer',8);return result;};
 const result=await f.service.sync(customer,f.id,'sync');assert.equal(result.payment.stage,'review');assert.equal(f.calls.filter(([name])=>name==='beginOrderEdit').length,0);
});

test('production readiness requires write_orders even when every other payment scope exists',async t=>{
 const f=setup(t);f.client.checkConfiguration=async()=>({currency:'USD',scopes:['write_draft_orders','read_orders','write_order_edits','read_customers'],locations:[]});
 const value=await f.service.checkConfiguration();assert.equal(value.configured,false);assert.deepEqual(value.missingScopes,['write_orders']);
 await assert.rejects(f.service.pay(customer,f.id,'pay'),{code:'UNAVAILABLE'});assert.equal(f.calls.length,0);
});

for(const autoarchive of [false,true])test(`pending old balance resumes the same staged increase after restart (autoarchive ${autoarchive})`,async t=>{
 let time=Date.now(),alarm=null;
 const f=setup(t,{durable:true,clock:()=>time});await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'balance');
 f.store.propose(staff,f.id,proposal(17000),'increase');f.store.accept(customer,f.id,2,'accept-increase');
 const add=f.client.addCustomBalance;
 f.client.addCustomBalance=async input=>{const result=await add(input);f.order.transactions.push({id:gid('OrderTransaction',2),kind:'SALE',status:'PENDING',test:true,amountCents:6000,currency:'USD',parentId:null});return result;};
 assert.equal((await f.service.sync(customer,f.id,'stage')).payment.stage,'syncing');
 const pending=await f.service.sync(customer,f.id,'still-pending');assert.equal(pending.payment.stage,'syncing');assert.equal(pending.payment.url,null);
 f.order.transactions[1].status='SUCCESS';f.order.netPaymentCents=f.order.receivedCents=15000;f.order.outstandingCents=0;f.order.fullyPaid=true;f.order.closed=autoarchive;
 const storage={getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;},deleteAlarm:async()=>{alarm=null;}};
 const reopened=f.open(),service=createPaymentService({store:reopened,client:f.client,mode:'TEST',now:()=>time});
 const scheduler=createPaymentScheduler({store:reopened,service,storage,shop,now:()=>time});await scheduler.ensure();assert.ok(alarm!==null);
 time=alarm;await scheduler.run();
 const result=reopened.getTracking(customer,f.id);assert.equal(result.payment.stage,'balance');assert.equal(result.billing.totalCents,17000);assert.equal(result.billing.netPaidCents,15000);assert.equal(result.billing.balanceDueCents,2000);
 assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,2);assert.equal(f.calls.filter(([name])=>name==='beginOrderEdit').length,2);assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,2);
 assert.equal(f.calls.filter(([name])=>name==='reopenOrder').length,autoarchive?1:0);
 await service.sync(customer,f.id,'again');assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,2);
});

test('a staged increase cannot commit for a different accepted proposal version',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'balance');
 f.store.propose(staff,f.id,proposal(17000),'increase');f.store.accept(customer,f.id,2,'accept-increase');
 const add=f.client.addCustomBalance;f.client.addCustomBalance=async input=>{const result=await add(input);f.order.transactions.push({id:gid('OrderTransaction',2),kind:'SALE',status:'PENDING',test:true,amountCents:6000,currency:'USD'});return result;};
 await f.service.sync(customer,f.id,'stage');f.order.transactions[1].status='FAILURE';
 f.store.propose(staff,f.id,proposal(18000),'new-increase');f.store.accept(customer,f.id,3,'accept-new-increase');
 assert.equal((await f.service.sync(customer,f.id,'changed')).payment.stage,'review');assert.equal(f.order.totalCents,15000);assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,1);
});

test('a staged increase survives an ambiguous reopen without adding or opening again',async t=>{
 const f=setup(t,{durable:true});await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'balance');
 f.store.propose(staff,f.id,proposal(17000),'increase');f.store.accept(customer,f.id,2,'accept-increase');
 const add=f.client.addCustomBalance;f.client.addCustomBalance=async input=>{const value=await add(input);f.order.transactions.push({id:gid('OrderTransaction',2),kind:'SALE',status:'SUCCESS',test:true,amountCents:6000,currency:'USD'});f.order.netPaymentCents=f.order.receivedCents=15000;f.order.outstandingCents=0;f.order.fullyPaid=true;f.order.closed=true;return value;};
 const reopen=f.client.reopenOrder;f.client.reopenOrder=async id=>{await reopen(id);throw Object.assign(new Error('lost response'),{code:'PAYMENT_REVIEW'});};
 assert.equal((await f.service.sync(customer,f.id,'stage')).payment.stage,'review');
 const recovered=await createPaymentService({store:f.open(),client:f.client,mode:'TEST'}).sync(customer,f.id,'recover');
 assert.equal(recovered.payment.stage,'balance');assert.equal(recovered.billing.balanceDueCents,2000);assert.equal(f.calls.filter(([name])=>name==='reopenOrder').length,1);
 assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,2);assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,2);
});

test('a staged increase rejects altered calculated line identity without another mutation',async t=>{
 const f=setup(t);await f.service.pay(customer,f.id,'pay');f.paid();await f.service.sync(customer,f.id,'balance');
 f.store.propose(staff,f.id,proposal(17000),'increase');f.store.accept(customer,f.id,2,'accept-increase');
 const add=f.client.addCustomBalance;f.client.addCustomBalance=async input=>{const value=await add(input);f.order.transactions.push({id:gid('OrderTransaction',2),kind:'SALE',status:'PENDING',test:true,amountCents:6000,currency:'USD'});return value;};
 await f.service.sync(customer,f.id,'stage');f.order.transactions[1].status='FAILURE';
 const read=f.client.readCalculatedOrder;f.client.readCalculatedOrder=async()=>{const value=await read();value.lineItems[0].id=gid('CalculatedLineItem',999);return value;};
 assert.equal((await f.service.sync(customer,f.id,'recover')).payment.stage,'review');assert.equal(f.calls.filter(([name])=>name==='commitOrderEdit').length,1);assert.equal(f.calls.filter(([name])=>name==='addCustomBalance').length,2);
});

test('a lost reopen response preserves the earlier staged balance and resumes it without a second add',async t=>{
 const f=setup(t,{durable:true});await f.service.pay(customer,f.id,'pay');f.paid();
 const add=f.client.addCustomBalance;f.client.addCustomBalance=async input=>{await add(input);throw Object.assign(new Error('lost add response'),{code:'PAYMENT_REVIEW'});};
 await f.service.sync(customer,f.id,'stage');f.order.closed=true;
 const reopen=f.client.reopenOrder;f.client.reopenOrder=async id=>{await reopen(id);throw Object.assign(new Error('lost open response'),{code:'PAYMENT_REVIEW'});};
 await f.service.sync(customer,f.id,'open');
 const state=f.store.getPaymentContext(customer,f.id).state;assert.equal(state.uncertainPhase,'order-open');assert.equal(state.orderOpenResumePhase,'edit-add');
 const read=f.client.readCalculatedOrder;f.client.readCalculatedOrder=async()=>{const value=await read();return{...value,lineItems:value.lineItems.filter(line=>!line.title.startsWith('Saldo pastel ['))};};
 const recovered=await createPaymentService({store:f.open(),client:f.client,mode:'TEST'}).sync(customer,f.id,'recover');
 assert.equal(recovered.payment.stage,'balance');assert.equal(recovered.billing.balanceDueCents,6000);
 for(const method of ['createDepositDraft','beginOrderEdit','addCustomBalance','reopenOrder','commitOrderEdit'])assert.equal(f.calls.filter(([name])=>name===method).length,1);
});
