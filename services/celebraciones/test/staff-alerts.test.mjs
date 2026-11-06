import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createStoreWithDatabase} from '../src/store-core.mjs';
import {runStaffAlertJobs,staffRecipient} from '../src/staff-alerts.mjs';
import {createResendTransport} from '../src/resend-email.mjs';
const shop='sweet.myshopify.com',staff={shop,role:'staff',staffId:'9'},customer={shop,customerId:'7'};
function setup(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());const store=createStoreWithDatabase(db);
  const request=store.createRequest(customer,{requestText:'Pastel',pickup:{label:'Recoger'}},'create');
  return {db,store,id:request.id};
}
test('comment burst is limited per request, grouped durably, and payments take priority',async t=>{
 const {db,store,id}=setup(t),time=Date.now();
 for(let n=0;n<5;n++)store.comment(customer,id,`Mensaje ${n}`,`burst-${n}`);
 assert.throws(()=>store.comment(customer,id,'Sexto','burst-5'),{code:'RATE_LIMITED'});
 assert.equal(store.getTracking(customer,id).comments.length,5);
 const restored=createStoreWithDatabase(db);
 restored.comment(customer,id,'Mensaje 0','burst-0');
 assert.throws(()=>restored.comment(customer,id,'Sexto','burst-5'),{code:'RATE_LIMITED'});
 const alerts=restored.listStaffAlerts(staff).alerts;assert.equal(alerts.length,1);assert.equal(alerts[0].commentCount,5);
 assert.equal(restored.claimStaffAlert(shop,time),null);
 db.prepare('INSERT INTO staff_alerts(shop,id,request_id,event_key,event,due_at) VALUES(?,?,?,?,?,?)').run(shop,'00000000-0000-0000-0000-000000000001',id,'payment-test',JSON.stringify({kind:'payment'}),time);
 const deliveryTime=Date.now()+60001;
 assert.equal(restored.claimStaffAlert(shop,deliveryTime).kind,'payment');
 assert.equal(restored.claimStaffAlert(shop,deliveryTime).commentCount,5);
 db.prepare('UPDATE staff_comment_events SET created_at=?').run(time-300001);
 restored.comment(customer,id,'Después de esperar','later');
 assert.equal(restored.getTracking(customer,id).comments.length,6);
});
test('grouping never changes an attempted email and another request has its own quota',t=>{
 const {db,store,id}=setup(t);
 store.comment(customer,id,'Primero','first');
 const claim=store.claimStaffAlert(shop,Date.now()+60001);
 const before=db.prepare('SELECT event FROM staff_alerts WHERE id=?').get(claim.id).event;
 store.comment(customer,id,'Segundo','second');
 assert.equal(db.prepare('SELECT event FROM staff_alerts WHERE id=?').get(claim.id).event,before);
 for(let n=0;n<3;n++)store.comment(customer,id,`Otro ${n}`,`extra-${n}`);
 assert.throws(()=>store.comment(customer,id,'Limite','limit'),{code:'RATE_LIMITED'});
 store.comment(staff,id,'Respuesta de pastelera','staff-reply');
 const other=store.createRequest(customer,{requestText:'Otro pastel',pickup:{label:'Recoger'}},'other');
 store.comment(customer,other.id,'Otra solicitud','other-comment');
 assert.equal(store.getTracking(customer,other.id).comments.length,1);
 assert.equal(store.listStaffAlerts(staff).alerts.find(a=>a.id===claim.id).commentCount,1);
});
test('customer comment queues one private alert, replays and staff replies do not duplicate it',t=>{
  const {store,id}=setup(t);
  store.comment(customer,id,'Hola','comment');store.comment(customer,id,'Hola','comment');
  store.comment(staff,id,'Respuesta','staff');
  let result=store.listStaffAlerts(staff);assert.equal(result.unread,1);assert.equal(result.alerts.length,1);
  assert.throws(()=>store.listStaffAlerts(customer),{code:'AUTH_REQUIRED'});
  assert.equal(store.listStaffAlerts({...staff,shop:'other.myshopify.com'}).unread,0);
  assert.throws(()=>store.readStaffAlert({...staff,shop:'other.myshopify.com'},result.alerts[0].id),{code:'NOT_FOUND'});
  assert.equal(store.readStaffAlert(staff,result.alerts[0].id).unread,0);
  assert.equal(store.readStaffAlert(staff,result.alerts[0].id).unread,0);
  assert.ok(!JSON.stringify(store.getTracking(customer,id)).includes('emailStatus'));
});
test('guest replies also notify staff; an outbox failure rolls back the customer comment',t=>{
  const {db,store}=setup(t),capability='ab'.repeat(32);
  const guest=store.createGuestRequest({shop},{requestText:'Pastel',pickup:{label:'Recoger'}},{name:'Ana',email:'ana@example.test',phone:'5551234567'},capability,'guest',{encryptedAccess:'fixture',now:Date.now()});
  const actor=store.authenticateGuest(shop,guest.id,capability);
  store.comment(actor,guest.id,'Hola','guest-comment');assert.equal(store.listStaffAlerts(staff).unread,1);
  db.exec("CREATE TRIGGER fail_staff_outbox BEFORE UPDATE ON staff_alerts BEGIN SELECT RAISE(ABORT,'failed'); END");
  assert.throws(()=>store.comment(actor,guest.id,'No debe guardarse','failed-comment'),{code:'UNAVAILABLE'});
  assert.equal(store.getTracking(actor,guest.id).comments.length,1);
});
test('verified partial and final payments alert once per transaction, including repeated sync and refunds',t=>{
  const {store,id}=setup(t);
  store.propose(staff,id,{baseCents:10000,surchargeCents:0,display:'total',canPrepare:'Pastel',changes:'',reply:'Si'},'quote');
  store.accept(customer,id,1,'accept');
  let n=0;
  function checkpoint(payments,paid){const claim=store.claimPayment(customer,id,`sync${++n}`,'sync',Date.now());store.checkpointPayment(customer,id,claim.token,{}, {billing:{source:'shopify',proposalVersion:1,totalCents:10000,netPaidCents:paid,balanceDueCents:10000-paid},payments},true);}
  const partial={id:'sale1',amountCents:6000,status:'confirmed'};
  checkpoint([],0);assert.equal(store.listStaffAlerts(staff).unread,0);
  checkpoint([partial],6000);checkpoint([partial],6000);
  checkpoint([{...partial,amountCents:5000}],5000);
  checkpoint([{...partial,amountCents:5000},{id:'sale2',amountCents:5000,status:'confirmed'}],10000);
  const alerts=store.listStaffAlerts(staff).alerts;assert.equal(alerts.length,2);
  assert.deepEqual(alerts.map(a=>a.amountCents),[5000,6000]);assert.equal(alerts[0].balanceDueCents,0);
});
test('durable inbox survives reopen without retroactive comment notifications',t=>{
  const {db,store,id}=setup(t);store.comment(customer,id,'Mensaje','message');
  const restored=createStoreWithDatabase(db);assert.equal(restored.listStaffAlerts(staff).unread,1);
  restored.comment(customer,id,'Mensaje','message');assert.equal(restored.listStaffAlerts(staff).unread,1);
});
test('a confirmed payment awaits reliable billing after interrupted sync, then alerts once',t=>{
  const {store,id}=setup(t);
  store.propose(staff,id,{baseCents:10000,surchargeCents:0,display:'total',canPrepare:'Pastel',changes:'',reply:'Si'},'quote');store.accept(customer,id,1,'accept');
  const payments=[{id:'sale-later',amountCents:6000,status:'confirmed'}];
  let claim=store.claimPayment(customer,id,'first','sync',Date.now());store.checkpointPayment(customer,id,claim.token,{}, {payments},true);
  assert.equal(store.listStaffAlerts(staff).unread,0);
  claim=store.claimPayment(customer,id,'recovery','sync',Date.now());store.checkpointPayment(customer,id,claim.token,{}, {payments,billing:{source:'shopify',totalCents:10000,netPaidCents:6000,balanceDueCents:4000}},true);
  assert.equal(store.listStaffAlerts(staff).unread,1);
});
test('existing pre-feature payments are baselined and never notified retroactively',t=>{
  const {db,store,id}=setup(t);
  const snapshot=store.getTracking(staff,id);snapshot.payments=[{id:'legacy-sale',amountCents:6000,status:'confirmed'}];
  db.prepare('UPDATE requests SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),id);
  db.exec('DROP TABLE staff_alert_migrations; DROP TABLE staff_alert_baseline;');
  createStoreWithDatabase(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM staff_alert_baseline').get().n,1);
  assert.equal(store.listStaffAlerts(staff).unread,0);
});
test('email uses confirmed staff recipient and authenticated admin link, never customer message or capability',async t=>{
  const {store,id}=setup(t);store.comment(customer,id,'PRIVATE-CONTENT','message');let sent;
  await runStaffAlertJobs({store,shop,clientId:'app',now:()=>Date.now()+60001,send:async value=>{sent=value;return {status:'sent'};}});
  assert.equal(sent.recipient,staffRecipient);assert.equal(sent.recipient,'Dayanaoramasgalano@gmail.com');
  const body=Buffer.from(sent.message.split('\r\n\r\n')[1],'base64').toString();
  assert.match(body,/admin\.shopify\.com\/store\/sweet\/apps\/app/);assert.ok(body.includes(id));assert.ok(!body.includes('PRIVATE-CONTENT'));assert.ok(!body.includes('#acceso='));
  assert.equal(store.listStaffAlerts(staff).alerts[0].emailStatus,'sent');
  await runStaffAlertJobs({store,shop,clientId:'app',send:async()=>{throw Error('must not repeat');}});
  assert.equal(store.nextStaffAlertDue(shop),null);
});
test('known email failures retry at most three times, ambiguous sends and expired claims never resend',async t=>{
  const {store,id}=setup(t);let now=Date.now()+1,calls=0;
  store.comment(customer,id,'Uno','one');
  for(let n=0;n<4;n++){await runStaffAlertJobs({store,shop,clientId:'app',now:()=>now,send:async()=>{calls++;return {status:'pending'};}});now+=1000000;}
  assert.equal(calls,3);assert.equal(store.listStaffAlerts(staff).alerts[0].emailStatus,'failed');
  store.comment(customer,id,'Dos','two');
  await runStaffAlertJobs({store,shop,clientId:'app',now:()=>now,send:async()=>{calls++;throw Error('timeout');}});
  await runStaffAlertJobs({store,shop,clientId:'app',now:()=>now+1000000,send:async()=>{calls++;}});assert.equal(calls,4);
  store.comment(customer,id,'Tres','three');assert.ok(store.claimStaffAlert(shop,now));
  assert.equal(store.claimStaffAlert(shop,now+60001),null);assert.equal(store.listStaffAlerts(staff).alerts[0].emailStatus,'unknown');
});
test('staff messages pass existing Resend validation and use stable provider idempotency keys',async t=>{
  const {store,id}=setup(t);store.comment(customer,id,'Nuevo','new');let payload;
  const send=createResendTransport({apiKey:'re_fixture',fetchImpl:async(url,options)=>{payload=JSON.parse(options.body);assert.ok(options.headers['Idempotency-Key']);return new Response(JSON.stringify({id:'sent'}),{status:200});}});
  // Verify through the same transport without sending a real message.
  await runStaffAlertJobs({store,shop,clientId:'app',now:()=>Date.now()+60001,send});
  assert.deepEqual(payload.to,[staffRecipient]);assert.match(payload.html,/Abrir en Shopify/);assert.match(payload.html,/href="https:\/\/admin.shopify.com/);assert.equal(store.listStaffAlerts(staff).alerts[0].emailStatus,'sent');
});
