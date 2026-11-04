import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
const context = { console, URL, crypto: { randomUUID: () => `op-${Math.random().toString(36).slice(2)}` } };
vm.createContext(context);
const path = 'assets/ds-celebracion-seguimiento.js';
if (existsSync(path)) vm.runInContext(readFileSync(path, 'utf8'), context);
const api = context.DSTracking;
const proposal = (totalCents = 15000, version = 1) => ({ version, totalCents, baseCents: totalCents, surchargeCents: 0, display: 'total', canPrepare: 'Pastel', changes: 'Flores', reply: 'Propuesta' });
const snapshot = () => ({ id: 'cake-1', version: 1, status: 'reserved', pickup: { label: '14 noviembre' }, requestText: 'Rosa', acceptedProposal: proposal(), pendingProposal: proposal(17000, 2), payments: [{ id: 'p1', amountCents: 9000, status: 'confirmed' }], comments: [], history: [], permissions: { canComment: true, canAccept: true } });
test('API de seguimiento disponible', () => assert.equal(typeof api?.createController, 'function'));

test('contra entrega muestra la deuda sin checkout y actualiza mediante lectura',async()=>{
  const s=snapshot();s.acceptedProposal.paymentMode='delivery';s.pendingProposal=null;s.payments=[];
  s.payment={url:null,stage:'delivery',reviewRequired:false};let reads=0,pays=0;
  const c=api.createController('cake-1',{getTracking:async()=>{reads++;return s},startPayment:async()=>{pays++},syncPayment:async()=>{throw Error('No Shopify sync')}});
  assert.equal(await c.load(),true);assert.equal(await c.startPayment(),false);assert.equal(await c.syncPayment(),true);
  assert.equal(reads,2);assert.equal(pays,0);assert.match(api.terms(s,s.acceptedProposal),/contra entrega/);assert.match(api.terms(s,s.acceptedProposal),/150/);
});

test('condiciones explícitas prevalecen sobre urgencia y rechazan modalidades desconocidas',async()=>{
  const s=snapshot();s.details={urgent:true};s.payments=[];s.pendingProposal.paymentMode='deposit';
  assert.equal(api.paymentMode(s,s.pendingProposal),'deposit');assert.match(api.terms(s,s.pendingProposal),/60 %/);
  s.details.urgent=false;s.pendingProposal.paymentMode='full';assert.match(api.terms(s,s.pendingProposal),/completo anticipado/);
  s.pendingProposal.paymentMode='invalid';const c=api.createController('cake-1',{getTracking:async()=>s});assert.equal(await c.load(),false);
});

test('saldo fiscal usa total Shopify y no resta pago con impuesto al precio base',()=>{
 const s=snapshot();s.payments=[{id:'p1',amountCents:9738,status:'confirmed'}];
 s.billing={proposalVersion:1,totalCents:16238,taxCents:1238,netPaidCents:9738,balanceDueCents:6500,currency:'USD'};
 assert.equal(api.balance(s).totalCents,16238);
 assert.equal(api.balance(s).dueCents,6500);
 assert.equal(api.balance(s,s.pendingProposal).dueCents,null);
 assert.equal(api.balance({...s,billing:{...s.billing,proposalVersion:2}}).dueCents,null);
 assert.throws(()=>api.balance({...s,billing:{...s.billing,balanceDueCents:1}}));
});
test('saldo usa pagos confirmados y conserva diferencia a favor', () => {
  const s = snapshot();
  assert.equal(api.balance(s, s.pendingProposal).dueCents, 8000);
  assert.equal(api.balance(s).dueCents, 6000);
  assert.equal(api.balance(s, proposal(7000)).creditCents, 2000);
  assert.equal(api.balance(s, proposal(7000)).dueCents, 0);
  assert.throws(() => api.balance({ ...s, payments: [{ id: 'p1', amountCents: -1, status: 'confirmed' }] }));
});
test('doble aceptación genera una llamada y solo actualiza al confirmar', async () => {
  let resolve, calls = 0; const s = snapshot();
  const service = { getTracking: async () => s, acceptProposal: () => { calls++; return new Promise(r => resolve = r); } };
  const c = api.createController('cake-1', service); await c.load();
  const first = c.accept(); await c.accept();
  assert.equal(calls, 1); assert.equal(c.state.snapshot.acceptedProposal.totalCents, 15000);
  resolve({ ...s, version: 2, acceptedProposal: s.pendingProposal, pendingProposal: null }); await first;
  assert.equal(c.state.snapshot.acceptedProposal.totalCents, 17000);
  assert.equal(api.balance(c.state.snapshot).dueCents, 8000);
});
test('conflicto no aplica precio propuesto y refresca versión', async () => {
  const s = snapshot(); let loads = 0;
  const c = api.createController('cake-1', { getTracking: async () => (++loads === 1 ? s : { ...s, version: 3, pendingProposal: proposal(18000, 3) }), acceptProposal: async () => { throw { code: 'CONFLICT' }; } });
  await c.load(); await c.accept();
  assert.equal(c.state.snapshot.acceptedProposal.totalCents, 15000);
  assert.equal(c.state.snapshot.pendingProposal.version, 3);
  assert.equal(c.state.error.code, 'CONFLICT');
});
test('reintento de comentario conserva operación tras fallo de red', async () => {
  const ids = []; let count = 0;
  const c = api.createController('cake-1', { getTracking: async () => snapshot(), postComment: async (_id, text, operationId) => { ids.push(operationId); if (++count === 1) throw { code: 'UNAVAILABLE' }; return { ...snapshot(), comments: [{ id: 'c1', author: 'Cliente', text }] }; } });
  await c.load(); assert.equal(await c.comment('  Hola  '), false); assert.equal(await c.comment('Hola'), true);
  assert.equal(ids[0], ids[1]); assert.equal(c.state.snapshot.comments[0].text, 'Hola');
});
test('listo bloquea comentarios y aceptación aunque permisos estén desactualizados', async () => {
  let calls = 0;
  const c = api.createController('cake-1', { getTracking: async () => ({ ...snapshot(), status: 'ready' }), postComment: async () => { calls++; }, acceptProposal: async () => { calls++; } });
  await c.load(); await c.comment('Cambio'); await c.accept(); assert.equal(calls, 0);
});
test('respuesta ajena o importe inválido nunca reemplaza los datos visibles', async () => {
  const c = api.createController('cake-1', { getTracking: async () => ({ ...snapshot(), id: 'other' }) });
  await c.load(); assert.equal(c.state.snapshot, null); assert.ok(c.state.error);
  assert.throws(() => api.balance({ ...snapshot(), acceptedProposal: proposal(0.5) }));
});
test('un pago repetido no puede inflar el importe recibido', () => {
  const s = snapshot(); s.payments.push({ ...s.payments[0] });
  assert.throws(() => api.balance(s));
});
test('aceptar una propuesta no pierde la clave del comentario con respuesta perdida', async () => {
  const ids = []; let attempt = 0;
  const c = api.createController('cake-1', { getTracking: async () => snapshot(), postComment: async (_id, _text, key) => { ids.push(key); if (++attempt === 1) throw { code: 'UNAVAILABLE' }; return snapshot(); }, acceptProposal: async () => snapshot() });
  await c.load(); await c.comment('Flores'); await c.accept(); await c.comment('Flores');
  assert.equal(ids[0], ids[1]);
});

test('el enlace de pago permite solo HTTPS en hosts Shopify o tienda configurados, sin navegación implícita', () => {
  const allowed = ['bakery.myshopify.com', 'dayanassweet.com'];
  for (const url of ['https://bakery.myshopify.com/invoice/123', 'https://dayanassweet.com/123', 'https://checkout.shopify.com/123']) assert.equal(api.paymentUrl(url, allowed), url);
  for (const url of ['http://bakery.myshopify.com/123', 'javascript:alert(1)', '//checkout.shopify.com/123', 'https://checkout.shopify.com.evil.test/123', 'https://other.myshopify.com/123', 'https://evil.shopify.com/123', 'https://user:password@checkout.shopify.com/123', 'https://checkout.shopify.com:444/123']) assert.equal(api.paymentUrl(url, allowed), null);
});

test('pagar evita doble clic y conserva UUID en reintentos incluso al volver a cargar el controlador', async () => {
  const values = new Map(), ids = [], s = { ...snapshot(), pendingProposal: null, payment: { stage: 'deposit', url: null, reviewRequired: false } };
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let resolve;
  const service = { getTracking: async () => s, startPayment: async (_id, operationId) => { ids.push(operationId); throw { code: 'UNAVAILABLE' }; } };
  const options = { storage, shop: 'bakery.myshopify.com' };
  const first = api.createController('cake-1', service, () => {}, options); await first.load(); await first.startPayment();
  const second = api.createController('cake-1', service, () => {}, options); await second.load();
  service.startPayment = (_id, operationId) => { ids.push(operationId); return new Promise(done => { resolve = done; }); };
  const pending = second.startPayment(); assert.equal(await second.startPayment(), false);
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  resolve({ ...s, version: 2, payment: { ...s.payment, url: 'https://checkout.shopify.com/pay' } }); await pending;
  assert.equal(second.state.snapshot.payment.url, 'https://checkout.shopify.com/pay');
  assert.equal(values.size, 0);
});

test('las propuestas pendientes y la revisión bloquean iniciar un pago, sincronizar solo acepta la respuesta del servidor', async () => {
  let paymentCalls = 0; const s = { ...snapshot(), payment: { stage: 'review', url: null, reviewRequired: true } };
  const c = api.createController('cake-1', { getTracking: async () => s, startPayment: async () => { paymentCalls++; }, syncPayment: async () => ({ ...s, version: 2, payment: { stage: 'paid', url: null, reviewRequired: false } }) });
  await c.load(); assert.equal(await c.startPayment(), false); assert.equal(paymentCalls, 0);
  assert.equal(await c.syncPayment(), true); assert.equal(c.state.snapshot.payment.stage, 'paid');
});

test('la sincronización reintenta su propia operación y nunca confirma un pago por un error de comunicación', async () => {
  const ids = [], s = { ...snapshot(), pendingProposal: null, payment: { stage: 'syncing', url: null, reviewRequired: false } };
  const c = api.createController('cake-1', { getTracking: async () => s, syncPayment: async (_id, key) => { ids.push(key); if (ids.length === 1) throw { code: 'UNAVAILABLE' }; return { ...s, version: 2, payment: { stage: 'review', url: null, reviewRequired: true } }; } });
  await c.load(); assert.equal(await c.syncPayment(), false);
  assert.equal(c.state.snapshot.payment.stage, 'syncing');
  assert.equal(await c.syncPayment(), true); assert.equal(ids[0], ids[1]);
  assert.equal(c.state.snapshot.payment.reviewRequired, true);
});

test('un estado de pago incompleto o desconocido no reemplaza el snapshot confirmado', async () => {
  for (const payment of [{ stage: 'success', url: null, reviewRequired: false }, { stage: 'paid', url: null, reviewRequired: 'false' }, { stage: 'deposit', reviewRequired: false }]) {
    const c = api.createController('cake-1', { getTracking: async () => ({ ...snapshot(), payment }) });
    assert.equal(await c.load(), false); assert.equal(c.state.snapshot, null);
  }
});
test('guest access errors ask for the private link instead of signing into an account', async () => {
  for (const code of ['AUTH_REQUIRED', 'NOT_FOUND']) {
    const c = api.createController('cake-1', { guest: true, getTracking: async () => { throw { code }; } });
    assert.equal(await c.load(), false);
    assert.match(c.state.error.message, /enlace privado completo/);
    assert.doesNotMatch(c.state.error.message, /Inicia sesi/);
  }
});
test('expired pending proposal prevents acceptance even after its loaded permissions become stale', async () => {
  let calls = 0;
  const s = snapshot(); s.pendingProposal.expiresAt = '2000-01-01T00:00:00.000Z';
  const c = api.createController('cake-1', { getTracking: async () => s, acceptProposal: async () => { calls++; return s; } });
  await c.load();
  assert.equal(await c.accept(), false);
  assert.equal(calls, 0);
  assert.equal(c.state.error.code, 'QUOTE_EXPIRED');
  assert.match(c.state.error.message, /venci/);
});
test('new server errors keep a clear message and refresh proposal permissions without changing received payments', async () => {
  for (const code of ['QUOTE_EXPIRED', 'CHECKOUT_PENDING']) {
    const s = snapshot(); let loads = 0;
    const c = api.createController('cake-1', { getTracking: async () => (++loads === 1 ? s : { ...s, version: 2, permissions: { ...s.permissions, canAccept: false } }), acceptProposal: async () => { throw { code }; } });
    await c.load(); assert.equal(await c.accept(), false);
    assert.equal(c.state.error.code, code);
    assert.equal(c.state.snapshot.permissions.canAccept, false);
    assert.equal(api.balance(c.state.snapshot).paidCents, 9000);
    assert.match(c.state.error.message, code === 'QUOTE_EXPIRED' ? /venci/ : /pago.*pendiente/);
  }
});
test('malformed proposal expiration cannot replace a confirmed snapshot', async () => {
  const s = snapshot(); s.pendingProposal.expiresAt = 'tomorrow';
  const c = api.createController('cake-1', { getTracking: async () => s });
  assert.equal(await c.load(), false); assert.equal(c.state.snapshot, null);
});

test('expired initial payment cannot start, but reconciliation and existing balance payments remain available', async () => {
  for (const source of ['proposal', 'pickup']) {
    const s = snapshot(); s.pendingProposal = null; s.payments = [];
    s.payment = { stage: 'deposit', url: 'https://checkout.shopify.com/old', reviewRequired: false };
    if (source === 'proposal') s.acceptedProposal.expiresAt = '2000-01-01T00:00:00.000Z';
    else s.details = { pickupAt: '2000-01-01T00:00:00.000Z' };
    let starts = 0, syncs = 0;
    const c = api.createController('cake-1', { getTracking: async () => s, startPayment: async () => { starts++; return s; }, syncPayment: async () => { syncs++; return s; } });
    await c.load(); assert.equal(await c.startPayment(), false); assert.equal(starts, 0); assert.equal(c.state.error.code, 'QUOTE_EXPIRED');
    assert.equal(await c.syncPayment(), true); assert.equal(syncs, 1); assert.equal(api.balance(c.state.snapshot).dueCents, 15000);
    s.payment.stage = 'balance'; s.payments = [{ id: 'p1', amountCents: 9000, status: 'confirmed' }];
    await c.load(); assert.equal(await c.startPayment(), true); assert.equal(starts, 1); assert.equal(api.balance(c.state.snapshot).dueCents, 6000);
  }
});
