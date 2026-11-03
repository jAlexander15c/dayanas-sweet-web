import assert from 'node:assert/strict';
import test from 'node:test';
import {createHmac} from 'node:crypto';
import {createStore} from '../src/store.mjs';
import {createHandler} from '../src/http.mjs';
const config={shop:'sweet.myshopify.com',secret:'test-only',clientId:'app',storefrontOrigin:'https://sweet.test',staffIds:['9']};
function signed(id,action,body={operationId:'op'},customer='7'){
 const url=new URL(`https://backend.test/proxy/requests/${id}/${action}`);
 for(const[key,value]of Object.entries({shop:config.shop,logged_in_customer_id:customer,path_prefix:'/apps/celebraciones',timestamp:String(Math.floor(Date.now()/1000))}))url.searchParams.set(key,value);
 const plain=[...url.searchParams].map(([key,value])=>`${key}=${value}`).sort().join('');url.searchParams.set('signature',createHmac('sha256',config.secret).update(plain).digest('hex'));
 return new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:config.storefrontOrigin},body:JSON.stringify(body)});
}
test('payment endpoints authenticate ownership, reject supplied money and use operation ID only',async()=>{
 const store=createStore(':memory:');try{
  const owner={shop:config.shop,customerId:'7'},snapshot=store.createRequest(owner,{requestText:'Pastel',pickup:{label:'Recoger'}},'create');
  let calls=0;const paymentService={pay:async(actor,id,operationId)=>{calls++;assert.equal(operationId,'pay');return {...store.getTracking(actor,id),payment:{url:null,stage:'syncing',reviewRequired:false}};},sync:async(actor,id)=>{calls++;return store.getTracking(actor,id);}};
  const handler=createHandler({store,config,paymentService});
  assert.equal((await handler(signed(snapshot.id,'payment',{operationId:'pay'}))).status,200);
  assert.equal(calls,1);
  assert.equal((await handler(signed(snapshot.id,'payment',{operationId:'x',amountCents:1}))).status,422);
  assert.equal((await handler(signed(snapshot.id,'payment-sync',{},'8'))).status,404);
  const response=await handler(signed(snapshot.id,'payment-sync',{operationId:'sync'}));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(calls,2);
  const get=new Request(signed(snapshot.id,'payment').url);assert.equal((await handler(get)).status,200);assert.equal(calls,2);
 }finally{store.close();}
});
test('payment routes remain unavailable until runtime payment integration is explicitly enabled',async()=>{
 const store=createStore(':memory:');try{
  const value=store.createRequest({shop:config.shop,customerId:'7'},{requestText:'Pastel',pickup:{label:'Recoger'}},'create');
  const response=await createHandler({store,config})(signed(value.id,'payment'));
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{code:'UNAVAILABLE'});
 }finally{store.close();}
});

function staffRequest(path,body,staffId='9'){
 const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
 const claims=Buffer.from(JSON.stringify({aud:config.clientId,sub:staffId,dest:`https://${config.shop}`,iss:`https://${config.shop}/admin`,iat:now,nbf:now,exp:now+60})).toString('base64url');
 const token=`${header}.${claims}.${createHmac('sha256',config.secret).update(`${header}.${claims}`).digest('base64url')}`;
 return new Request(`https://backend.test/admin${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
}
test('ready checks fresh financial state every attempt and refuses a newly refunded order',async()=>{
 const store=createStore(':memory:');try{
  const value=store.createRequest({shop:config.shop,customerId:'7'},{requestText:'Pastel',pickup:{label:'Recoger'}},'create');
  const operations=[];const paymentService={sync:async(actor,id,operation)=>{assert.equal(actor.role,'staff');operations.push(operation);return {...store.getTracking(actor,id),payment:{stage:'review',url:null,reviewRequired:true}};}};
  const handler=createHandler({store,config,paymentService});
  for(let i=0;i<2;i++)assert.equal((await handler(staffRequest(`/requests/${value.id}/status`,{status:'ready',operationId:'same-ready'}))).status,409);
  assert.equal(operations.length,2);assert.notEqual(operations[0],operations[1]);
 }finally{store.close();}
});
test('only authenticated staff can inspect the payment preflight',async()=>{
 const store=createStore(':memory:');try{
  let calls=0;const result={configured:true,mode:'TEST',scopes:['read_orders'],locations:[],currency:'USD',missingScopes:[]};
  const handler=createHandler({store,config,paymentService:{checkConfiguration:async()=>{calls++;return result;}}});
  assert.equal((await handler(new Request('https://backend.test/admin/payment-status'))).status,401);
  assert.equal((await handler(staffRequest('/payment-status',undefined,'8'))).status,401);
  const response=await handler(staffRequest('/payment-status'));assert.equal(response.status,200);assert.deepEqual(await response.json(),result);assert.equal(calls,1);
 }finally{store.close();}
});
