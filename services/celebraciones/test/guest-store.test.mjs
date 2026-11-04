import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStoreWithDatabase } from '../src/store-core.mjs';
import { createStore } from '../src/store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
const shop='guest.myshopify.com', contact={name:'Ana',email:'ana@example.test',phone:'+1 555 123 4567'};
const input={requestText:'Chocolate',pickup:{label:'Houston'}};
const capability='ab'.repeat(32), options={encryptedAccess:'sealed-ciphertext',now:1800000000000};
const code=expected=>error=>error.code===expected;
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());const open=()=>createStoreWithDatabase(db);return {db,open,store:open()};}
test('guest creation is atomic, hash-only, numbered and replayable across restart',t=>{
 const {db,store,open}=fixture(t);
 const old=store.createRequest({shop,customerId:'1'},input,'old');
 const a=store.createGuestRequest({shop},input,contact,capability,'create',options);
 assert.equal(a.reference,'DS-000001');assert.deepEqual(a.contact,contact);assert.equal(a.emailStatus,'pending');
 const allRows=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(({name})=>db.prepare(`SELECT * FROM ${name}`).all());
 assert.ok(!JSON.stringify(allRows).includes(capability),'capability must never persist as plaintext');
 const reopened=open(), actor=reopened.authenticateGuest(shop,a.id,capability);
 assert.equal(reopened.getTracking(actor,a.id).reference,a.reference);
 assert.equal(reopened.createGuestRequest({shop},input,contact,capability,'create',{...options,encryptedAccess:'different-encryption'}).id,a.id);
 assert.equal(reopened.getPaymentContext(actor,a.id).customerId,null);
 assert.equal(reopened.getTracking({shop,customerId:'1'},old.id).id,old.id);
 assert.throws(()=>reopened.createGuestRequest({shop},{...input,requestText:'Changed'},contact,capability,'create',options),code('CONFLICT'));
 assert.throws(()=>reopened.authenticateGuest(shop,a.id,'cd'.repeat(32)),code('NOT_FOUND'));
 assert.throws(()=>reopened.authenticateGuest('other.myshopify.com',a.id,capability),code('NOT_FOUND'));
 assert.throws(()=>reopened.getTracking({shop,customerId:contact.email},a.id),code('NOT_FOUND'));
 assert.throws(()=>reopened.getTracking(actor,old.id),code('NOT_FOUND'));
 assert.equal(reopened.listRequests({shop,customerId:'1'}).length,1);
 assert.equal(reopened.listRequests({shop,role:'staff',staffId:'9'}).length,2);
 assert.ok(!JSON.stringify(a).includes('sealed-ciphertext'));
});
test('durable guest quotas survive restart and replays do not consume quota',t=>{
 const {store,open}=fixture(t);
 for(let i=0;i<5;i++)store.createGuestRequest({shop},input,contact,capability,`a${i}`,options);
 const reopened=open();
 assert.equal(reopened.createGuestRequest({shop},input,contact,capability,'a0',options).reference,'DS-000001');
 assert.throws(()=>reopened.createGuestRequest({shop},input,contact,capability,'six',options),code('RATE_LIMITED'));
 assert.equal(reopened.createGuestRequest({shop},input,contact,capability,'later',{...options,now:options.now+3600000}).reference,'DS-000006');
 for(let i=6;i<100;i++)reopened.createGuestRequest({shop},input,{...contact,email:`guest-${i}@example.test`},capability,`b${i}`,options);
 assert.throws(()=>open().createGuestRequest({shop},input,{...contact,email:'new-recipient@example.test'},capability,'global',options),code('RATE_LIMITED'));
});
test('store derives recipient quota from validated normalized contact and ignores caller rate keys',t=>{
 const {store,open,db}=fixture(t);
 for(let i=0;i<5;i++)store.createGuestRequest({shop},input,{...contact,email:i%2?' Ana@Example.Test ':contact.email},capability,`a${i}`,{...options,rateKey:`untrusted-${i}`});
 assert.throws(()=>open().createGuestRequest({shop},input,{...contact,email:'ANA@EXAMPLE.TEST'},capability,'six',{...options,rateKey:'new-key'}),code('RATE_LIMITED'));
 assert.equal(store.createGuestRequest({shop},input,contact,capability,'a0',options).reference,'DS-000001');
 assert.equal(store.createGuestRequest({shop},input,{...contact,email:'Other@Example.Test'},capability,'other',options).contact.email,'Other@Example.Test');
 const keys=db.prepare('SELECT DISTINCT rate_key FROM guest_creations').all();
 assert.equal(keys.length,2);assert.ok(keys.every(({rate_key})=>/^[a-f0-9]{64}$/.test(rate_key)));
});
test('guest outbox claims persist, bounded retry recovers crashes as unknown without duplicate delivery',t=>{
 const {store,open}=fixture(t), now=options.now;
 const a=store.createGuestRequest({shop},input,contact,capability,'create',options);
 assert.equal(store.nextGuestEmailDue(shop),now);
 assert.equal(store.getGuestEmailJobs(shop,now,2)[0].encryptedAccess,'sealed-ciphertext');
 assert.equal(store.claimGuestEmail(shop,a.id,now).attempts,1);
 assert.equal(open().claimGuestEmail(shop,a.id,now),null);
 assert.equal(store.nextGuestEmailDue(shop),now+60000);
 store.finishGuestEmail(shop,a.id,{status:'pending',nextAttemptAt:now+120000,now:now+1});
 assert.equal(store.getGuestEmailJobs(shop,now+1000,2).length,0);
 assert.equal(open().claimGuestEmail(shop,a.id,now+120000).attempts,2);
 assert.equal(open().getGuestEmailJobs(shop,now+180001,2).length,0);
 assert.equal(store.getTracking(store.authenticateGuest(shop,a.id,capability),a.id).emailStatus,'unknown');
 assert.equal(store.nextGuestEmailDue(shop),null);
 assert.equal(store.claimGuestEmail(shop,a.id,now+360000),null);
});
test('invalid contact, capability and missing encrypted access leave no request or consumed number',t=>{
 const {store}=fixture(t);
 for(const patch of [{contact:{...contact,email:'invalid'}},{contact:{...contact,email:'ana@ejemplo.éxito'}},{contact:{...contact,name:'\r\nHeader'}},{capability:'short'},{capability:capability.toUpperCase()},{options:{...options,encryptedAccess:''}}]){
  assert.throws(()=>store.createGuestRequest({shop},input,patch.contact||contact,patch.capability||capability,'bad',patch.options||options),code('VALIDATION'));
 }
 assert.equal(store.createGuestRequest({shop},input,contact,capability,'valid',options).reference,'DS-000001');
});

test('guest identity cannot be forged through an authenticated owner sentinel or copied actor',t=>{
 const {store}=fixture(t),a=store.createGuestRequest({shop},input,contact,capability,'a',options);
 const actor=store.authenticateGuest(shop,a.id,capability);
 assert.throws(()=>store.getTracking({...actor},a.id),code('AUTH_REQUIRED'));
 assert.throws(()=>store.getTracking({shop,customerId:`guest:${a.id}`},a.id),code('NOT_FOUND'));
 assert.equal(store.listRequests({shop,customerId:`guest:${a.id}`}).length,0);
 assert.throws(()=>store.listRequests(actor),code('AUTH_REQUIRED'));
});

test('outbox terminal states clear the encrypted access and failed delivery stops after three attempts',t=>{
 const {store,open,db}=fixture(t),now=options.now;
 const a=store.createGuestRequest({shop},input,contact,capability,'a',options);
 for(let i=0;i<3;i++){
  assert.equal(open().claimGuestEmail(shop,a.id,now+i*120000).attempts,i+1);
  store.finishGuestEmail(shop,a.id,{status:'pending',now:now+i*120000+1,nextAttemptAt:now+(i+1)*120000});
 }
 assert.equal(store.getTracking(store.authenticateGuest(shop,a.id,capability),a.id).emailStatus,'failed');
 assert.equal(store.nextGuestEmailDue(shop),null);assert.equal(store.claimGuestEmail(shop,a.id,now+360000),null);
 assert.equal(db.prepare('SELECT encrypted_access FROM guest_email_jobs WHERE request_id=?').get(a.id).encrypted_access,'');
 const b=store.createGuestRequest({shop},input,contact,capability,'b',options);
 store.claimGuestEmail(shop,b.id,now);store.finishGuestEmail(shop,b.id,{status:'sent',now:now+1});
 assert.equal(open().getTracking(open().authenticateGuest(shop,b.id,capability),b.id).emailStatus,'sent');
 assert.equal(store.getGuestEmailJobs(shop,now+86400000,2).length,0);
});

test('legacy customer database migrates additively while guest outbox failure rolls back sequence and quotas',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE requests(shop TEXT NOT NULL,id TEXT NOT NULL,customer_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(shop,id))');
 const id='00000000-0000-0000-0000-000000000001';
 const snapshot={id,version:7,status:'requested',...input,acceptedProposal:null,pendingProposal:null,payments:[],comments:[],history:[]};
 db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(shop,id,'123',7,JSON.stringify(snapshot));
 const store=createStoreWithDatabase(db);
 assert.equal(store.getTracking({shop,customerId:'123'},id).version,7);
 db.exec("CREATE TRIGGER fail_guest_outbox BEFORE INSERT ON guest_email_jobs BEGIN SELECT RAISE(ABORT,'outbox unavailable'); END");
 assert.throws(()=>store.createGuestRequest({shop},input,contact,capability,'a',options),code('UNAVAILABLE'));
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM requests').get().n,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_creations').get().n,0);
 db.exec('DROP TRIGGER fail_guest_outbox');
 assert.equal(store.createGuestRequest({shop},input,contact,capability,'a',options).reference,'DS-000001');
 assert.equal(db.prepare('SELECT customer_id FROM requests WHERE id=?').get(id).customer_id,'123');
});

test('parallel guest retries on independent SQLite connections commit one request, number, quota and email',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'guest-concurrency-')),path=join(directory,'db.sqlite'),store=createStore(path);
 t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
 const gate=new SharedArrayBuffer(4);
 const workers=Array.from({length:4},()=>new Worker(`
  const {parentPort,workerData:d}=require('node:worker_threads');
  (async()=>{const {createStore}=await import(d.storeUrl);const store=createStore(d.path);parentPort.postMessage({ready:true});Atomics.wait(new Int32Array(d.gate),0,0);try{const value=store.createGuestRequest({shop:d.shop},d.input,d.contact,d.capability,'same-operation',d.options);parentPort.postMessage({id:value.id,reference:value.reference});}finally{store.close();}})();
 `,{eval:true,workerData:{storeUrl:new URL('../src/store.mjs',import.meta.url).href,path,gate,shop,input,contact,capability,options}}));
 t.after(async()=>{await Promise.all(workers.map(worker=>worker.terminate()));});
 const results=workers.map(worker=>new Promise((resolve,reject)=>{worker.on('message',message=>{if(message.id)resolve(message);});worker.once('error',reject);}));
 await Promise.all(workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);})));Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0,4);
 const snapshots=await Promise.all(results);assert.equal(new Set(snapshots.map(value=>value.id)).size,1);assert.ok(snapshots.every(value=>value.reference==='DS-000001'));
 assert.equal(store.getGuestEmailJobs(shop,options.now,10).length,1);
 assert.equal(store.createGuestRequest({shop},input,contact,capability,'second',options).reference,'DS-000002');
});
