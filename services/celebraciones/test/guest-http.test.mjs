import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createStore } from '../src/store.mjs';
import { createHandler } from '../src/http.mjs';
const config={secret:'test-guest-secret',shop:'guest.myshopify.com',storefrontOrigin:'https://bakery.test',guestEnabled:true};
const capability='ab'.repeat(32),contact={name:'Ana',email:'ana@example.test',phone:'5551234567'};
const body={input:{requestText:'Chocolate',pickup:{label:'Houston'}},contact,capability,operationId:'create',website:''};
function signed(path,body={},opts={}){
 const url=new URL(`https://backend.test/proxy${path}`);
 for(const [key,value]of Object.entries({shop:config.shop,logged_in_customer_id:'',path_prefix:'/apps/celebraciones',timestamp:String(Math.floor(Date.now()/1000)),...opts.query}))url.searchParams.set(key,value);
 url.searchParams.set('signature',createHmac('sha256',config.secret).update([...url.searchParams].map(([k,v])=>`${k}=${v}`).sort().join('')).digest('hex'));
 return new Request(url,{method:opts.method||'POST',headers:{Origin:opts.origin||config.storefrontOrigin,'Content-Type':'application/json','CF-Connecting-IP':opts.ip||'192.0.2.1'},body:opts.method==='GET'?undefined:JSON.stringify(body)});
}
function fixture(t,extra={}){const store=createStore(':memory:');t.after(()=>store.close());let wakes=0;const handler=createHandler({store,config,guestEmail:{seal:async()=> 'encrypted',wake:async()=>{wakes++;}},...extra});return {store,handler,get wakes(){return wakes;}};}
test('anonymous signed guest creates private tracking while authenticated routes still require login',async t=>{
 const f=fixture(t);const created=await f.handler(signed('/guest/requests',body));assert.equal(created.status,200);const a=await created.json();assert.equal(a.reference,'DS-000001');assert.equal(a.emailStatus,'pending');assert.equal(f.wakes,1);
 const track=`/guest/requests/${a.id}/tracking`;
 assert.equal((await f.handler(signed(track,{capability}))).status,200);
 assert.equal((await f.handler(signed(track,{capability:'cd'.repeat(32)}))).status,404);
 assert.equal((await f.handler(signed('/requests',{}, {method:'GET'}))).status,401);
 assert.equal((await f.handler(signed('/guest/requests',{}, {method:'GET'}))).status,404);
 assert.equal((await f.handler(signed(track,{capability},{origin:'https://evil.test'}))).status,403);
 assert.equal((await f.handler(signed(track,{capability},{query:{capability}}))).status,401);
 const commented=await f.handler(signed(`/guest/requests/${a.id}/comments`,{capability,text:'Flores',operationId:'comment'}));assert.equal(commented.status,200);assert.equal((await commented.json()).comments[0].text,'Flores');
 const disabled=createHandler({store:f.store,config:{...config,guestEnabled:false}});
 assert.equal((await disabled(signed('/guest/requests',body))).status,503);
 assert.equal((await disabled(signed('/guest/calendar'))).status,503);
 assert.equal((await disabled(signed(track,{capability}))).status,200);
});
test('guest creation fails closed on mail setup, honeypot and body actor',async t=>{
 const f=fixture(t);
 for(const patch of [{website:'bot'},{actor:{role:'staff'}},{contact:{...contact,email:'bad'}}])assert.equal((await f.handler(signed('/guest/requests',{...body,...patch}))).status,422);
 const unavailable=fixture(t,{guestEmail:undefined});assert.equal((await unavailable.handler(signed('/guest/requests',body))).status,503);
});
test('guest quota allows distinct recipients through the same Shopify proxy peer',async t=>{
 const f=fixture(t);
 for(let i=0;i<6;i++){
  const response=await f.handler(signed('/guest/requests',{...body,contact:{...contact,email:`guest-${i}@example.test`},operationId:`a${i}`}));
  assert.equal(response.status,200);
 }
});
test('guest quota binds normalized recipient across changing proxy headers and replays are free',async t=>{
 const f=fixture(t);
 for(let i=0;i<5;i++){
  const request=signed('/guest/requests',{...body,contact:{...contact,email:i%2?'  Ana@Example.Test  ':contact.email},operationId:`a${i}`},{ip:`192.0.2.${i+1}`});
  request.headers.set('X-Forwarded-For',`203.0.113.${i+1}`);
  assert.equal((await f.handler(request)).status,200);
 }
 assert.equal((await f.handler(signed('/guest/requests',{...body,operationId:'a0'},{ip:'198.51.100.10'}))).status,200);
 const sixth=signed('/guest/requests',{...body,contact:{...contact,email:' ANA@EXAMPLE.TEST '},operationId:'six'},{ip:'198.51.100.11'});
 sixth.headers.set('X-Forwarded-For','203.0.113.99');
 assert.equal((await f.handler(sixth)).status,429);
});
test('guest POST photos enforce private reads, decoded limit, magic bytes, operation replay and three-photo cap',async t=>{
 const f=fixture(t), a=await (await f.handler(signed('/guest/requests',body))).json();
 const photo={capability,name:'reference.jpg',mimeType:'image/jpeg',base64:Buffer.from([255,216,255,224,1]).toString('base64'),operationId:'photo'};
 const path=`/guest/requests/${a.id}/photos`;
 const result=await f.handler(signed(path,photo));assert.equal(result.status,200);const snapshot=await result.json();
 assert.equal((await f.handler(signed(path,photo))).status,200);
 const read=await f.handler(signed(`${path}/${snapshot.attachments[0].id}`,{capability}));assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'private, no-store');assert.deepEqual(new Uint8Array(await read.arrayBuffer()),new Uint8Array([255,216,255,224,1]));
 assert.equal((await f.handler(signed(`${path}/${snapshot.attachments[0].id}`,{capability:'cd'.repeat(32)}))).status,404);
 assert.equal((await f.handler(signed(path,{...photo,operationId:'invalid',base64:Buffer.from('not an image').toString('base64')}))).status,422);
 const large=Buffer.alloc(2097153,255).toString('base64');assert.equal((await f.handler(signed(path,{...photo,operationId:'large',base64:large}))).status,413);
 for(const operationId of ['photo2','photo3'])assert.equal((await f.handler(signed(path,{...photo,operationId}))).status,200);
 assert.equal((await f.handler(signed(path,{...photo,operationId:'photo4'}))).status,409);
});
