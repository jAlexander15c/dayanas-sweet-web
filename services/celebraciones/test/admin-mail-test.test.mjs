import test from 'node:test';
import assert from 'node:assert/strict';
const {createAdminMailTest}=await import('../src/admin-mail-test.mjs').catch(()=>({}));
test('explicit Resend retry reuses operation only within bounded idempotency window',async()=>{
 let time=100000,calls=0,saved;
 const run=createAdminMailTest({transport:'resend',storage:{get:async()=>saved,put:async(_k,v)=>{saved=v;}},lock:fn=>fn(),now:()=>time,send:async()=>{calls++;return {status:'unknown'};}});
 await run('same');await run('same');assert.equal(calls,1);
 time+=60000;await run('same');assert.equal(calls,2);
 time+=23*3600000;await run('same');assert.equal(calls,2);
});
test('cooldown conflict is returned outside the Durable Object lock without resetting it',async()=>{
 let saved={operationId:'prior',at:100000,status:'sent'},lockRejected=false;
 const run=createAdminMailTest({storage:{get:async()=>saved,put:async(_k,v)=>{saved=v;}},lock:async fn=>{try{return await fn();}catch(e){lockRejected=true;throw e;}},send:async()=>assert.fail('must not send'),now:()=>100001});
 await assert.rejects(()=>run('next'),{code:'CONFLICT'});assert.equal(lockRejected,false);
});
test('commissioning providers have separate durable records and preserve previous evidence',async()=>{
 const records=new Map([['admin-mail-test-v1',{operationId:'smtp-test',at:100000,status:'pending',attempts:3}]]);
 let calls=0;const run=createAdminMailTest({storage:{get:async k=>records.get(k),put:async(k,v)=>records.set(k,v)},lock:fn=>fn(),send:async()=>{calls++;return {status:'sent'};},now:()=>100001,transport:'resend'});
 assert.equal((await run('resend-test')).status,'sent');await run('resend-test');assert.equal(calls,1);
 assert.equal(records.get('admin-mail-test-v1').operationId,'smtp-test');assert.equal(records.get('admin-mail-test-v1-resend').status,'sent');
});
test('authorized test uses fixed mailbox and stable message; concurrent/repeated operation sends once',async()=>{
 assert.equal(typeof createAdminMailTest,'function');let saved,tail=Promise.resolve(),calls=0;
 const storage={get:async()=>saved,put:async(_key,value)=>{saved=value;}};
 const lock=fn=>{const p=tail.then(fn);tail=p.catch(()=>{});return p;};
 const run=createAdminMailTest({storage,lock,send:async value=>{calls++;assert.equal(value.recipient,'info@dayanassweet.com');assert.match(value.message,/Subject: Prueba de correo/);return {status:'sent'};},now:()=>100000});
 const values=await Promise.all([run('qa-test'),run('qa-test')]);
 assert.equal(calls,1);assert.equal((await run('qa-test')).status,'sent');assert.ok(values.some(value=>value.status==='sent'));
 await assert.rejects(()=>run('different-test'),{code:'CONFLICT'});await assert.rejects(()=>run('bad\r\nid'),{code:'VALIDATION'});
});
test('crash or ambiguous SMTP result stays unknown and is never automatically retried',async()=>{
 let saved,calls=0;const storage={get:async()=>saved,put:async(_key,value)=>{saved=value;}};
 const options={storage,lock:fn=>fn(),send:async()=>{calls++;throw Error('private raw server reply');},now:()=>100000};
 assert.deepEqual(await createAdminMailTest(options)('test'),{status:'unknown'});
 assert.deepEqual(await createAdminMailTest(options)('test'),{status:'unknown'});assert.equal(calls,1);assert.ok(!JSON.stringify(saved).includes('private'));
});
test('known pre-acceptance failures retry after cooldown at most three times',async()=>{
 let saved,calls=0,time=100000;const storage={get:async()=>saved,put:async(_key,value)=>{saved=value;}};
 const diagnostic={phase:'connect',failure:'transport',responseCode:null,code:null};
 const run=createAdminMailTest({storage,lock:fn=>fn(),now:()=>time,send:async({onDiagnostic})=>{calls++;onDiagnostic(diagnostic);return {status:'pending'};}});
 assert.deepEqual(await run('retry'),{status:'pending',diagnostic});
 await run('retry');assert.equal(calls,1);
 time+=60000;await run('retry');assert.equal(calls,2);
 time+=60000;await run('retry');assert.equal(calls,3);
 time+=60000;await run('retry');assert.equal(calls,3);
});
