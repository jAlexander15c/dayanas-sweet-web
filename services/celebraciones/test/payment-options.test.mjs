import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { createPaymentService } from '../src/payment-service.mjs';

const shop='sweet.myshopify.com', customer={shop,customerId:'7'}, staff={shop,role:'staff',staffId:'9'};
const proposal=(paymentMode,total=15000)=>({baseCents:total,surchargeCents:0,display:'total',canPrepare:'Pastel',changes:'',reply:'Propuesta',...(paymentMode?{paymentMode}:{})});
function setup(t,mode,urgent=false){
  const store=createStore(':memory:');t.after(()=>store.close());
  const details={pickupAt:new Date(Date.now()+14*86400000).toISOString().slice(0,10)+'T16:00:00Z',urgent,tiers:[{diameter:6,sponges:['Vainilla','Vainilla'],fillings:['Fresa','Fresa']}],coating:'Crema',decorations:[]};
  const {id}=store.createRequest(customer,{requestText:'Pastel',pickup:{label:'Recogida'},details},'create');
  store.propose(staff,id,proposal(mode),'quote');
  return {store,id,accept:()=>store.accept(customer,id,1,'accept')};
}
test('staff chooses each mode for normal and urgent quotes; old payloads retain default',t=>{
  for(const urgent of [false,true])for(const mode of ['deposit','full','delivery',undefined]){
    const f=setup(t,mode,urgent),s=f.accept();
    assert.equal(s.acceptedProposal.paymentMode,mode||(urgent?'full':'deposit'));
    if(mode!=='delivery')assert.equal(s.status,'quoted');
    assert.throws(()=>f.store.propose(customer,f.id,proposal('delivery'),'forge'),{code:'CONFLICT'});
    assert.throws(()=>f.store.propose(staff,f.id,proposal('invalid'),'bad'),{code:'VALIDATION'});
  }
});
test('explicit full on normal and deposit on urgent determine actual checkout amount',async t=>{
  for(const [mode,urgent,expected] of [['full',false,15000],['deposit',true,9000]]){
    const f=setup(t,mode,urgent);f.accept();let draft;
    const client={
      async checkConfiguration(){return{currency:'USD',scopes:['write_draft_orders','read_orders','write_order_edits','read_customers','write_orders'],locations:[]}},
      async createDepositDraft(input){
        const full=input.urgent;
        const amount=full?input.baseCents:Math.ceil(input.baseCents*0.6);
        assert.equal(amount,expected);
        draft={id:'gid://shopify/DraftOrder/1',customerId:'gid://shopify/Customer/7',currency:'USD',subtotalCents:amount,totalCents:amount,taxCents:0,discountCents:0,shippingCents:0,orderId:null,status:'OPEN',invoiceUrl:`https://${shop}/invoice`,tags:['ds-celebraciones',`ds-request:${f.id}`,'ds-version:1',`ds-operation:${input.operationId}`],lineItems:[{baseCents:amount,quantity:1,title:`${full?'Pago completo':'Anticipo'} pastel [${f.id}/v1]`}]};return draft;
      },async getDraft(){return draft}
    };
    const service=createPaymentService({store:f.store,client});
    const s=await service.pay(customer,f.id,'pay');
    assert.equal(s.payment.url,`https://${shop}/invoice`);
    assert.equal(f.store.getPaymentContext(customer,f.id).state.initialDepositCents,expected);
    assert.throws(()=>f.store.propose(staff,f.id,proposal(mode==='full'?'deposit':'full'),'switch'),{code:'CHECKOUT_PENDING'});
  }
});
test('delivery reserves without payment, permits ready, blocks online checkout and records one receipt',async t=>{
  const f=setup(t,'delivery');let s=f.accept();
  assert.equal(s.status,'reserved');assert.equal(s.payment.stage,'delivery');assert.equal(s.billing.netPaidCents,0);assert.equal(s.billing.balanceDueCents,15000);
  const service=createPaymentService({store:f.store,client:new Proxy({},{get(){throw Error('No Shopify calls for delivery')}})});
  await assert.rejects(service.pay(customer,f.id,'pay'),{code:'CONFLICT'});
  assert.equal((await service.sync(customer,f.id,'sync')).payment.stage,'delivery');
  assert.equal(f.store.setStatus(staff,f.id,'ready','ready').status,'ready');
  assert.throws(()=>f.store.recordDeliveryPayment(customer,f.id,1,'fake'),{code:'AUTH_REQUIRED'});
  s=f.store.recordDeliveryPayment(staff,f.id,1,'received');
  assert.equal(s.billing.netPaidCents,15000);assert.equal(s.billing.balanceDueCents,0);assert.equal(s.billing.source,'staff');assert.equal(s.payment.stage,'paid');
  assert.equal(s.payments.length,1);assert.equal(s.payments[0].source,'staff');
  assert.equal(f.store.recordDeliveryPayment(staff,f.id,1,'received').payments.length,1);
  assert.throws(()=>f.store.recordDeliveryPayment(staff,f.id,1,'double-click'),{code:'CONFLICT'});
});
test('delivery price updates retain receipts and reject pending or stale collection',t=>{
  const f=setup(t,'delivery');f.accept();
  f.store.propose(staff,f.id,proposal('delivery',17000),'adjust');
  assert.throws(()=>f.store.recordDeliveryPayment(staff,f.id,1,'premature'),{code:'CONFLICT'});
  f.store.accept(customer,f.id,2,'accept2');
  assert.throws(()=>f.store.recordDeliveryPayment(staff,f.id,1,'stale'),{code:'CONFLICT'});
  f.store.recordDeliveryPayment(staff,f.id,2,'receive');
  f.store.propose(staff,f.id,proposal('delivery',18000),'adjust2');
  let s=f.store.accept(customer,f.id,3,'accept3');assert.equal(s.billing.netPaidCents,17000);assert.equal(s.billing.balanceDueCents,1000);
  s=f.store.recordDeliveryPayment(staff,f.id,3,'receive2');assert.equal(s.payments.length,2);assert.equal(s.payments[1].amountCents,1000);
  f.store.propose(staff,f.id,proposal('delivery',16000),'reduce');
  s=f.store.accept(customer,f.id,4,'accept4');assert.equal(s.billing.overpaymentCents,2000);assert.equal(s.payment.stage,'review');
  assert.throws(()=>f.store.setStatus(staff,f.id,'ready','ready'),{code:'CONFLICT'});
});
test('accepted delivery mode is locked and cannot reserve a closed pickup date',t=>{
  const f=setup(t,'delivery');f.accept();
  assert.throws(()=>f.store.propose(staff,f.id,proposal('full'),'switch'),{code:'CONFLICT'});
  const g=setup(t,'delivery');
  const date=g.store.getTracking(customer,g.id).details.pickupAt.slice(0,10);
  g.store.setCalendar(staff,date,true,'close');
  assert.throws(()=>g.accept(),{code:'CONFLICT'});
});
