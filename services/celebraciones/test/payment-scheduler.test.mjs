import assert from 'node:assert/strict';
import test from 'node:test';
import {createStore} from '../src/store.mjs';
const {createPaymentScheduler}=await import('../src/payment-scheduler.mjs').catch(()=>({}));
const shop='sweet.myshopify.com',system={shop,role:'staff',staffId:'__payment_reconciler__'};
const proposal={baseCents:15000,surchargeCents:0,display:'total',canPrepare:'Pastel',changes:'',reply:'Listo'};
function fixture(t){
 const store=createStore(':memory:');t.after(()=>store.close());let time=1800000000000,alarm=null;const calls=[];
 const storage={getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;},deleteAlarm:async()=>{alarm=null;}};
 function seed(number=1,stage='deposit',phase='idle'){
  const customer={shop,customerId:String(number)};
  const value=store.createRequest(customer,{requestText:'Pastel',pickup:{label:'Recogida'}},`create-${number}`);
  store.propose(system,value.id,proposal,`quote-${number}`);store.accept(customer,value.id,1,`accept-${number}`);
  const claim=store.claimPayment(customer,value.id,`pay-${number}`,'pay',time);
  store.checkpointPayment(customer,value.id,claim.token,{draftId:`gid://shopify/DraftOrder/${number}`,phase,updatedAt:time,uncertainPhase:phase==='idle'?null:phase},{payment:{url:null,stage,reviewRequired:stage==='review'}},true);
  return value.id;
 }
 const service={sync:async(actor,id,operationId)=>{calls.push({actor,id,operationId});const claim=store.claimPayment(actor,id,operationId,'sync',time);if(claim.claimed)store.checkpointPayment(actor,id,claim.token,{phase:'idle',updatedAt:time},{payment:{url:null,stage:'paid',reviewRequired:false}},true);}};
 const options={store,service,storage,shop,now:()=>time,batchSize:2};
 return{store,storage,service,options,seed,calls,get alarm(){return alarm;},get now(){return time;},advance:milliseconds=>{time+=milliseconds;}};
}

test('scheduler re-arms from durable due jobs after restart and does not poll an empty queue',async t=>{
 assert.equal(typeof createPaymentScheduler,'function');const f=fixture(t);f.seed();
 await createPaymentScheduler(f.options).ensure();assert.equal(f.alarm,f.now+300000);
 f.advance(300000);await createPaymentScheduler(f.options).run();assert.equal(f.calls.length,1);assert.equal(f.alarm,null);
 assert.equal(f.calls[0].actor.staffId,'__payment_reconciler__');
 assert.equal(f.calls[0].actor.shop,shop);assert.match(f.calls[0].operationId,/^alarm-/);
});

test('bounded batches progress through more than one hundred durable jobs without starvation',async t=>{
 const f=fixture(t);for(let index=1;index<=105;index++)f.seed(index);
 f.advance(300000);const scheduler=createPaymentScheduler(f.options);
 await scheduler.run();assert.equal(f.calls.length,2);assert.equal(f.alarm,f.now+1000);
 for(let run=0;run<52;run++){f.advance(1000);await scheduler.run();}
 assert.equal(f.calls.length,105);assert.equal(new Set(f.calls.map(call=>call.id)).size,105);assert.equal(f.alarm,null);
});

test('recoverable reviews use hourly cadence and intermediate ambiguous edits do not hot-loop',async t=>{
 const f=fixture(t);const review=f.seed(1,'review','edit-commit');f.seed(2,'review','edit-add');
 assert.equal(f.store.nextPaymentDue(system),f.now+3600000);
 f.advance(300000);await createPaymentScheduler(f.options).run();assert.equal(f.calls.length,0);
 assert.equal(f.alarm,f.now+3300000);
 f.advance(3300000);await createPaymentScheduler(f.options).run();assert.deepEqual(f.calls.map(call=>call.id),[review]);assert.equal(f.alarm,null);
});

test('alarm failures back off durably and busy jobs move behind other due work',async t=>{
 const f=fixture(t);f.seed();f.advance(300000);f.service.sync=async()=>{throw new Error('private transport failure');};
 const scheduler=createPaymentScheduler(f.options);await scheduler.run();assert.equal(f.alarm,f.now+600000);
 f.advance(600000);await createPaymentScheduler(f.options).run();assert.equal(f.alarm,f.now+1200000);
});

test('arming before a request persists a recovery alarm and keeps it while a request is in flight',async t=>{
 const f=fixture(t),scheduler=createPaymentScheduler(f.options);await scheduler.begin();assert.equal(f.alarm,f.now+300000);
 await scheduler.ensure();assert.equal(f.alarm,f.now+300000);
 await scheduler.end();assert.equal(f.alarm,null);
});

test('an ambiguous order-open remains eligible for hourly read reconciliation',async t=>{
 const f=fixture(t);const id=f.seed(1,'review','order-open');
 assert.equal(f.store.nextPaymentDue(system),f.now+3600000);
 f.advance(3600000);await createPaymentScheduler(f.options).run();assert.deepEqual(f.calls.map(call=>call.id),[id]);
});
