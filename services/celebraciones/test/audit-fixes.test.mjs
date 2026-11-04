import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createStoreWithDatabase} from '../src/store-core.mjs';
const shop='audit.myshopify.com',customer={shop,customerId:'1'},staff={shop,role:'staff',staffId:'9'};
const proposal={baseCents:10000,surchargeCents:0,display:'total',canPrepare:'Pastel',changes:'',reply:'Cotización'};
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());const store=createStoreWithDatabase(db);const date=new Date(Date.now()+12*86400000);date.setUTCHours(18,0,0,0);const input={requestText:'Pastel',pickup:{label:'Houston'},details:{pickupAt:date.toISOString(),urgent:false,tiers:[{diameter:6,sponges:['Vainilla','Vainilla'],fillings:['Fresa','Fresa']}],coating:'Crema',decorations:[]}};return{db,store,input};}
test('proposal expires at pickup and blocks acceptance and first checkout without hiding conversation',t=>{
 const {store,input}=fixture(t);const req=store.createRequest(customer,input,'create');const quoted=store.propose(staff,req.id,proposal,'quote');
 assert.equal(quoted.pendingProposal.expiresAt,input.details.pickupAt);
 const original=Date.now;Date.now=()=>Date.parse(input.details.pickupAt)+1;t.after(()=>{Date.now=original;});
 assert.equal(store.getTracking(customer,req.id).permissions.canAccept,false);
 assert.throws(()=>store.accept(customer,req.id,1,'late'),{code:'QUOTE_EXPIRED'});
 assert.equal(store.comment(customer,req.id,'Necesito cambiar la fecha','message').comments.length,1);
});
test('staff pagination includes every request and searches references without crossing shops',t=>{
 const {store,input}=fixture(t);let oldest;
 for(let i=0;i<105;i++){const r=store.createRequest({...customer,customerId:String(i+1)},input,'create');oldest??=r;}
 let cursor=null,seen=[];do{const page=store.listRequestPage(staff,{cursor,query:''});seen.push(...page.requests.map(r=>r.id));cursor=page.nextCursor;}while(cursor);
 assert.equal(new Set(seen).size,105);assert.ok(seen.includes(oldest.id));
 assert.equal(store.listRequestPage({...staff,shop:'other.myshopify.com'},{query:''}).requests.length,0);
 assert.throws(()=>store.listRequestPage(customer,{}),{code:'AUTH_REQUIRED'});
 assert.equal(store.listRequestPage(staff,{query:oldest.id}).requests[0].id,oldest.id);
});
test('failed notification is visible only to staff and can be retried once per operation; unknown cannot be blindly resent',t=>{
 const {store,input,db}=fixture(t);const req=store.createRequest(customer,input,'create');store.comment(staff,req.id,'Hola','comment');
 const now=Date.now()+1,job=store.getNotificationJobs(shop,now)[0];store.claimNotification(shop,job.id,now);store.finishNotification(shop,job.id,{status:'failed',now:now+1});
 const view=store.getTracking(staff,req.id);assert.equal(view.notifications[0].status,'failed');assert.equal(store.getTracking(customer,req.id).notifications,undefined);
 store.retryNotification(staff,req.id,job.id,'retry');store.retryNotification(staff,req.id,job.id,'retry');
 assert.equal(store.getTracking(staff,req.id).notifications[0].status,'pending');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notification_jobs').get().n,1);
 assert.throws(()=>store.retryNotification(customer,req.id,job.id,'customer'),{code:'AUTH_REQUIRED'});
 db.prepare("UPDATE notification_jobs SET status='unknown' WHERE id=?").run(job.id);
 assert.throws(()=>store.retryNotification(staff,req.id,job.id,'unknown'),{code:'CONFLICT'});
});
test('preparing requires current confirmed deposit and rejects a fully refunded advance',t=>{
 const {store,input,db}=fixture(t);const req=store.createRequest(customer,input,'create');store.propose(staff,req.id,proposal,'quote');store.accept(customer,req.id,1,'accept');
 const snapshot=store.getTracking(staff,req.id);snapshot.status='reserved';snapshot.payment={stage:'balance',reviewRequired:false};snapshot.billing={proposalVersion:1,totalCents:10000,netPaidCents:0,balanceDueCents:10000};
 db.prepare('UPDATE requests SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),req.id);
 assert.throws(()=>store.setStatus(staff,req.id,'preparing','prepare'),{code:'CONFLICT'});
 snapshot.billing.netPaidCents=6000;snapshot.billing.balanceDueCents=4000;db.prepare('UPDATE requests SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),req.id);
 assert.equal(store.setStatus(staff,req.id,'preparing','prepare').status,'preparing');
});
