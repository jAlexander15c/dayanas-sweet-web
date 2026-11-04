import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStoreWithDatabase } from '../src/store-core.mjs';
import { createQuoteEmail } from '../src/quote-email.mjs';
import { createResendTransport } from '../src/resend-email.mjs';
const notifications=await import('../src/notification-email.mjs').catch(()=>({}));
const shop='sweet.myshopify.com',staff={shop,role:'staff',staffId:'1'},customer={shop,customerId:'2'};
const contact={name:'Ana',email:'ana@example.test',phone:'5551234567'},capability='ab'.repeat(32);
const input={requestText:'Chocolate',pickup:{label:'Houston'}};
const proposal={baseCents:10000,surchargeCents:0,display:'total',canPrepare:'Sí',changes:'',reply:'Propuesta de prueba'};
function setup(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());const store=createStoreWithDatabase(db);const request=store.createGuestRequest({shop},input,contact,capability,'create',{encryptedAccess:'cipher',now:Date.now()});return {db,store,request};}
test('staff events are atomically queued once; customer actions, replays and rejected changes send nothing',t=>{
 const {store,request,db}=setup(t);
 store.propose(staff,request.id,proposal,'proposal');store.propose(staff,request.id,proposal,'proposal');
 store.comment(staff,request.id,'Te escribo','message');
 store.comment(store.authenticateGuest(shop,request.id,capability),request.id,'Gracias','reply');
 assert.throws(()=>store.setStatus(staff,request.id,'ready','invalid'));
 const jobs=store.getNotificationJobs(shop,Date.now()+1);
 assert.equal(jobs.length,2);assert.deepEqual(jobs.map(j=>j.event.kind).sort(),['comment','propose']);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notification_jobs').get().n,2);
 db.exec("CREATE TRIGGER reject_notice BEFORE INSERT ON notification_jobs BEGIN SELECT RAISE(ABORT, 'test'); END");
 assert.throws(()=>store.comment(staff,request.id,'Should roll back','rollback'));
 assert.equal(store.getTracking(staff,request.id).comments.length,2);
});
test('Resend notifications include working isolated guest links, preserve original access and deduplicate concurrent runners',async t=>{
 const {store,request,db}=setup(t),sent=[];
 const email=createQuoteEmail({key:Buffer.alloc(32,7).toString('base64'),storefrontOrigin:'https://dayanassweet.com',send:createResendTransport({apiKey:'re_test',fetchImpl:async(_url,init)=>{sent.push(JSON.parse(init.body));return Response.json({id:'delivered'});}})});
 store.propose(staff,request.id,proposal,'proposal');
 const run=()=>notifications.runNotificationJobs({store,shop,email});
 await Promise.all([run(),run()]);assert.equal(sent.length,1);
 assert.match(sent[0].subject,/propuesta/i);assert.deepEqual(sent[0].to,[contact.email]);
 const token=sent[0].text.match(/#acceso=([a-f0-9]{64})/)[1];
 assert.equal(store.getTracking(store.authenticateGuest(shop,request.id,token),request.id).id,request.id);
 assert.equal(store.getTracking(store.authenticateGuest(shop,request.id,capability),request.id).id,request.id);
 assert.throws(()=>store.authenticateGuest('other.myshopify.com',request.id,token));
 const rows=db.prepare('SELECT * FROM notification_jobs').all();assert.ok(!JSON.stringify(rows).includes(token));
 assert.equal(store.nextNotificationDue(shop),null);
 db.prepare('UPDATE guest_access SET revoked_at=1 WHERE request_id=?').run(request.id);
 assert.throws(()=>store.authenticateGuest(shop,request.id,token));
});
test('account customers receive authenticated tracking links; recipient is resolved from stored Shopify identity',async t=>{
 const {store}=setup(t),sent=[],ids=[];
 const request=store.createRequest(customer,input,'account');store.comment(staff,request.id,'Actualización','message');
 const email=createQuoteEmail({key:Buffer.alloc(32,7).toString('base64'),storefrontOrigin:'https://dayanassweet.com',send:async value=>{sent.push(value);return {status:'sent'};}});
 await notifications.runNotificationJobs({store,shop,email,resolveCustomer:async id=>{ids.push(id);return {name:'Cliente',email:'account@example.test'};}});
 assert.deepEqual(ids,['2']);assert.equal(sent[0].recipient,'account@example.test');
 const body=Buffer.from(sent[0].message.split('\r\n\r\n')[1],'base64').toString();
 assert.match(body,new RegExp(request.id));assert.ok(!body.includes('#acceso='));
});
test('ambiguous sends are not replayed and known temporary failures have bounded retries',async t=>{
 const {store,request}=setup(t);let now=Date.now()+10,calls=0;
 store.comment(staff,request.id,'Mensaje','message');
 const email=createQuoteEmail({key:Buffer.alloc(32,7).toString('base64'),storefrontOrigin:'https://dayanassweet.com',send:async()=>{calls++;return {status:'pending'};}});
 for(let i=0;i<4;i++){await notifications.runNotificationJobs({store,shop,email,now:()=>now});now+=1000000;}
 assert.equal(calls,3);assert.equal(store.nextNotificationDue(shop),null);
 store.comment(staff,request.id,'Otro','message2');
 const uncertain={...email,deliverNotification:async()=>{calls++;return {status:'unknown'};}};
 await notifications.runNotificationJobs({store,shop,email:uncertain,now:()=>now});
 await notifications.runNotificationJobs({store,shop,email:uncertain,now:()=>now+1000000});assert.equal(calls,4);
});
test('preparing and ready events are queued with their original state, only after valid transitions',t=>{
 const {db,store,request}=setup(t);
 const snapshot=store.getTracking(staff,request.id);
 snapshot.status='reserved';snapshot.acceptedProposal={version:1,totalCents:10000};
 snapshot.billing={proposalVersion:1,balanceDueCents:0,netPaidCents:10000,totalCents:10000};
 snapshot.payment={stage:'paid',reviewRequired:false};
 db.prepare('UPDATE requests SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),request.id);
 store.setStatus(staff,request.id,'preparing','prepare');store.setStatus(staff,request.id,'ready','ready');
 assert.deepEqual(store.getNotificationJobs(shop,Date.now()+10).map(j=>j.event.status),['preparing','ready']);
});
test('claimed notices survive restart as unknown rather than being delivered twice',t=>{
 const {db,store,request}=setup(t);store.comment(staff,request.id,'Mensaje','message');
 const now=Date.now()+10,job=store.getNotificationJobs(shop,now)[0];store.claimNotification(shop,job.id,now);
 const reopened=createStoreWithDatabase(db);
 assert.deepEqual(reopened.getNotificationJobs(shop,now+60001),[]);
 assert.equal(db.prepare('SELECT status FROM notification_jobs WHERE id=?').get(job.id).status,'unknown');
 assert.equal(reopened.nextNotificationDue(shop),null);
});
test('revoked guest access prevents notification delivery',async t=>{
 const {db,store,request}=setup(t);store.comment(staff,request.id,'Mensaje','message');
 db.prepare('UPDATE guest_access SET revoked_at=1 WHERE request_id=?').run(request.id);
 await notifications.runNotificationJobs({store,shop,email:{deliverNotification(){assert.fail('must not send');}}});
 assert.equal(db.prepare('SELECT status FROM notification_jobs').get().status,'failed');
});
