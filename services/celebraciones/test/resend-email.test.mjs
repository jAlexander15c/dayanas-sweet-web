import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createQuoteEmail,buildQuoteMessage} from '../src/quote-email.mjs';
const {createResendTransport}=await import('../src/resend-email.mjs').catch(()=>({}));
const capability='ab'.repeat(32);
const job={id:'12cfa899-12aa-4c21-8234-4a1234567890',reference:'DS-000001',contact:{name:'Ana',email:'ana@example.com'}};
const message=buildQuoteMessage(job,capability,'https://dayanassweet.com');
test('Resend adapter constructs requests supported by the actual Workers runtime',async()=>{
 const source=readFileSync(new URL('../src/resend-email.mjs',import.meta.url),'utf8');
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{modules:true,compatibilityDate:'2026-11-03',compatibilityFlags:['nodejs_compat'],script:`import {Buffer} from 'node:buffer';\n${source}\nexport default {async fetch(){const send=createResendTransport({apiKey:'re_test',fetchImpl:async(url,init)=>{new Request(url,init);return Response.json({id:'accepted'});}});return Response.json(await send(${JSON.stringify({recipient:job.contact.email,message})}));}};`}]}));
 try{assert.deepEqual(await (await mf.dispatchFetch('http://localhost/')).json(),{status:'sent'});}finally{await mf.dispose();}
});
test('Resend sends private plain text over HTTPS with stable idempotency and fixed sender',async()=>{
 assert.equal(typeof createResendTransport,'function');const calls=[];
 const send=createResendTransport({apiKey:'re_test_secret',fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json({id:'email-accepted'});}});
 assert.deepEqual(await send({recipient:job.contact.email,message}),{status:'sent'});
 await send({recipient:job.contact.email,message});
 const {url,init}=calls[0],body=JSON.parse(init.body);
 assert.equal(url,'https://api.resend.com/emails');assert.equal(init.redirect,'manual');
 assert.equal(init.headers.Authorization,'Bearer re_test_secret');
 assert.equal(init.headers['Idempotency-Key'],calls[1].init.headers['Idempotency-Key']);
 assert.equal(body.from,"Dayana's Sweet <info@dayanassweet.com>");assert.deepEqual(body.to,[job.contact.email]);
 assert.equal(body.reply_to,'info@dayanassweet.com');assert.equal(body.subject,'Recibimos tu solicitud DS-000001');
 assert.match(body.text,/#acceso=abab/);assert.match(body.text,/todavía no reserva/);assert.equal(body.html,undefined);
});
test('Resend keeps uncertain acceptance unknown, retries only rate rejection and hides provider replies',async()=>{
 assert.equal(typeof createResendTransport,'function');
 for(const [code,status] of [[200,'unknown'],[401,'failed'],[403,'failed'],[422,'failed'],[429,'pending'],[409,'unknown'],[500,'unknown'],[302,'unknown']]) {
  const send=createResendTransport({apiKey:'re_private',fetchImpl:async()=>Response.json({message:'private reply'}, {status:code})});
  assert.deepEqual(await send({recipient:job.contact.email,message}),{status});
 }
 const send=createResendTransport({apiKey:'re_private',fetchImpl:async()=>{throw Error('secret');}});
 assert.deepEqual(await send({recipient:job.contact.email,message}),{status:'unknown'});
});
test('invalid message, recipient or key cannot invoke Resend',async()=>{
 assert.equal(typeof createResendTransport,'function');assert.throws(()=>createResendTransport({apiKey:''}));
 let calls=0;const send=createResendTransport({apiKey:'re_test',fetchImpl:async()=>{calls++;return Response.json({id:'x'});}});
 assert.deepEqual(await send({recipient:'bad\r\nBcc:x',message}),{status:'failed'});
 assert.deepEqual(await send({recipient:job.contact.email,message:'arbitrary'}),{status:'failed'});
 assert.equal(calls,0);
});
test('encrypted quote delivery accepts Resend transport without an SMTP password',async()=>{
 let captured;const email=createQuoteEmail({key:Buffer.alloc(32,7).toString('base64'),storefrontOrigin:'https://dayanassweet.com',send:async value=>{captured=value;return {status:'sent'};}});
 const result=await email.deliver({...job,encryptedAccess:await email.seal(capability)});
 assert.equal(result.status,'sent');assert.equal(captured.recipient,job.contact.email);assert.match(captured.message,/DS-000001/);
});
test('timeout aborts request and never claims acceptance or schedules a blind resend',async()=>{
 let signal;const send=createResendTransport({apiKey:'re_test',timeoutMs:10,fetchImpl:async(_url,init)=>{signal=init.signal;return new Promise(()=>{});}});
 assert.deepEqual(await send({recipient:job.contact.email,message}),{status:'unknown'});assert.equal(signal.aborted,true);
});
test('staff commissioning message uses the same Resend transport once',async()=>{
 const {createAdminMailTest}=await import('../src/admin-mail-test.mjs');let saved,calls=0;
 const send=createResendTransport({apiKey:'re_test',fetchImpl:async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert.deepEqual(body.to,['info@dayanassweet.com']);assert.match(body.subject,/Prueba/);return Response.json({id:'accepted'});}});
 const run=createAdminMailTest({storage:{get:async()=>saved,put:async(_key,value)=>{saved=value;}},lock:fn=>fn(),send});
 assert.deepEqual(await run('resend-qa-20261103'),{status:'sent'});await run('resend-qa-20261103');assert.equal(calls,1);
});
