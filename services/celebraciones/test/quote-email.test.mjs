import test from 'node:test';
import assert from 'node:assert/strict';
const {createQuoteEmail, sendSmtp, buildQuoteMessage}=await import('../src/quote-email.mjs').catch(()=>({}));
const key=Buffer.alloc(32,7).toString('base64'), capability='ab'.repeat(32);
const job={id:'12cfa899-12aa-4c21-8234-4a1234567890',reference:'DS-000001',contact:{name:'Ana <script>',email:'ana@example.com',phone:'555'},attempts:1};
function smtp(replies){
 let index=0,closed=false;const writes=[];
 const socket={opened:Promise.resolve(),closed:Promise.resolve(),close(){closed=true;},
 readable:new ReadableStream({pull(controller){const next=replies[index++];if(next===null||next===undefined)controller.close();else controller.enqueue(new TextEncoder().encode(next));}}),
 writable:new WritableStream({write(bytes){writes.push(new TextDecoder().decode(bytes));}})};
 return {socket,writes,get closed(){return closed;}};
}
const greeting=['220 ready\r\n','250-host\r\n250 AUTH LOGIN\r\n','334 user\r\n','334 password\r\n','235 authenticated\r\n','250 sender\r\n','250 recipient\r\n','354 data\r\n'];
test('seals private capability with randomized authenticated encryption and rejects tampering',async()=>{
 assert.equal(typeof createQuoteEmail,'function');
 const email=createQuoteEmail({key,password:'test-password',storefrontOrigin:'https://dayanassweet.com',connect:()=>{throw Error('not called');}});
 const first=await email.seal(capability), second=await email.seal(capability);
 assert.notEqual(first,second);assert.ok(!first.includes(capability));assert.equal(await email.unseal(first),capability);
 await assert.rejects(()=>email.unseal(first.slice(0,-3)+'abc'));await assert.rejects(()=>email.seal('guessable'));
});
test('message uses stable ID and private fragment, contains no photos or comments, blocks header injection',()=>{
 const message=buildQuoteMessage(job,capability,'https://dayanassweet.com');
 assert.match(message,/Message-ID: <quote-12cfa899-12aa-4c21-8234-4a1234567890@dayanassweet.com>/);
 const text=Buffer.from(message.split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString();
 assert.match(text,/#acceso=abab/);assert.match(text,/todavía no reserva/);
 assert.throws(()=>buildQuoteMessage({...job,contact:{...job.contact,email:'a@example.com\r\nBcc:bad@example.com'}},capability,'https://dayanassweet.com'));
});
test('SMTP uses verified TLS fixed Hostinger endpoint, authenticates and marks final 250 accepted',async()=>{
 const f=smtp([...greeting,'250 queued\r\n']);let address,options;
 const result=await sendSmtp({connect:(a,o)=>{address=a;options=o;return f.socket;},password:'test-password',recipient:job.contact.email,message:buildQuoteMessage(job,capability,'https://dayanassweet.com')});
 assert.equal(result.status,'sent');assert.deepEqual(address,{hostname:'smtp.hostinger.com',port:465});assert.equal(options.secureTransport,'on');assert.equal(f.closed,true);
 assert.equal(f.writes[0],'EHLO dayanassweet.com\r\n');assert.ok(f.writes.includes('DATA\r\n'));assert.ok(f.writes.at(-1).endsWith('\r\n.\r\n'));
});
test('lost response after DATA is unknown, explicit 4xx before DATA is retryable, 5xx is permanent',async()=>{
 for(const [replies,status] of [[ [...greeting,null],'unknown'],[['421 temporarily unavailable\r\n'],'pending'],[['550 rejected\r\n'],'failed']]){
  const f=smtp(replies);const result=await sendSmtp({connect:()=>f.socket,password:'test-password',recipient:job.contact.email,message:'safe message'});
  assert.equal(result.status,status);assert.deepEqual(Object.keys(result),['status']);assert.equal(f.closed,true);
 }
});
test('timeout closes socket and does not leak credentials or server diagnostics',async()=>{
 const f=smtp([]);f.socket.readable=new ReadableStream({start(){}});
 const result=await sendSmtp({connect:()=>f.socket,password:'private',recipient:job.contact.email,message:'private',timeoutMs:10});
 assert.deepEqual(result,{status:'pending'});assert.equal(f.closed,true);
});
test('durable runner preserves ambiguous state and retries only known failures within attempt limit',async()=>{
 const finished=[],queue=[{...job,encryptedAccess:'cipher'}];
 const store={getGuestEmailJobs:()=>queue,claimGuestEmail:()=>queue[0],finishGuestEmail:(shop,id,value)=>finished.push(value)};
 const {runQuoteEmailJobs}=await import('../src/quote-email.mjs');
 for(const status of ['sent','unknown','pending']){
  await runQuoteEmailJobs({store,shop:'sweet.myshopify.com',email:{deliver:async()=>({status})},now:()=>1000});
  assert.equal(finished.at(-1).status,status);if(status==='pending')assert.ok(finished.at(-1).nextAttemptAt>1000);
 }
 queue[0].attempts=3;await runQuoteEmailJobs({store,shop:'sweet.myshopify.com',email:{deliver:async()=>({status:'pending'})},now:()=>1000});assert.equal(finished.at(-1).status,'failed');
});

test('real store, encrypted outbox and concurrent runners send a single SMTP message and clear pending job',async t=>{
 const {createStore}=await import('../src/store.mjs');
 const {runQuoteEmailJobs}=await import('../src/quote-email.mjs');
 const store=createStore(':memory:');t.after(()=>store.close());let connections=0;
 const email=createQuoteEmail({key,password:'test-password',storefrontOrigin:'https://dayanassweet.com',connect:()=>{connections++;return smtp([...greeting,'250 queued\r\n']).socket;}});
 const shop='sweet.myshopify.com',now=Date.now();
 const created=store.createGuestRequest({shop},{requestText:'Pastel de prueba',pickup:{label:'Houston'}},{...job.contact,phone:'5551234567'},capability,'create',{encryptedAccess:await email.seal(capability),now});
 assert.equal(created.emailStatus,'pending');
 await Promise.all([runQuoteEmailJobs({store,shop,email}),runQuoteEmailJobs({store,shop,email})]);
 assert.equal(connections,1);assert.equal(store.nextGuestEmailDue(shop),null);
 const snapshot=store.getTracking(store.authenticateGuest(shop,created.id,capability),created.id);
 assert.equal(snapshot.emailStatus,'sent');assert.ok(!JSON.stringify(snapshot).includes(capability));
 assert.deepEqual(store.getGuestEmailJobs(shop,now+100000),[]);
});
