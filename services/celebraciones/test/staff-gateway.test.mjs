import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createStore} from '../src/store.mjs';
import {createHandler} from '../src/http.mjs';
import {handleStaffGateway,portalStaffActor} from '../src/staff-gateway.mjs';
import {createPortalApi} from '../src/admin-ui.js';
import {renderAdminPage} from '../src/admin-page.mjs';
import {buildStaffMessage} from '../src/staff-alerts.mjs';
import {renderEmailHtml} from '../src/resend-email.mjs';
const shop='sweet.myshopify.com',actor={shop,userId:randomUUID(),name:'Dayana',roles:['celebraciones'],aud:'celebraciones',sessionVersion:1};
function setup(t){const store=createStore(':memory:');t.after(()=>store.close());const config={shop,secret:'fixture',clientId:'app',staffIds:[],storefrontOrigin:'https://sweet.test'};const customer={shop,customerId:'7'};const request=store.createRequest(customer,{requestText:'Pastel',pickup:{label:'Recoger'}},'create');return {store,config,customer,id:request.id};}
test('gateway validates audience, shop, user, version and explicit module permission',()=>{
 assert.equal(portalStaffActor(actor,shop).staffId,`user:${actor.userId}`);
 for(const patch of [{shop:'other.myshopify.com'},{aud:'inventario'},{roles:['inventario']},{roles:['admin']},{sessionVersion:0},{userId:'9'},{name:null}])assert.throws(()=>portalStaffActor({...actor,...patch},shop),{code:'AUTH_REQUIRED'});
});
test('trusted RPC reuses proposals and audit while public HTTP cannot impersonate staff',async t=>{
 const options=setup(t),{id,store,config}=options;
 const call=(method,path,body)=>handleStaffGateway({actor,method,path,body},options);
 assert.equal((await call('GET','/requests')).status,200);
 const response=await call('POST',`/requests/${id}/proposals`,{proposal:{baseCents:6000,surchargeCents:0,display:'total',canPrepare:'Pastel',changes:'',reply:'Listo',paymentMode:'delivery'},operationId:'quote'});
 assert.equal(response.status,200);assert.equal(response.body.pendingProposal.totalCents,6000);
 const handler=createHandler({store,config});
 for(const path of ['/admin/requests','/staffHandle','/admin/session']) {
  const r=await handler(new Request('https://fixture.test'+path,{headers:{'X-Staff-Id':`user:${actor.userId}`,'X-Portal-Actor':JSON.stringify(actor)}}));
  assert.ok([401,404].includes(r.status));
 }
 assert.equal((await handleStaffGateway({actor:{...actor,roles:['inventario']},method:'GET',path:'/requests'},options)).status,401);
 for(const path of ['/../proxy/requests','//evil.test','/requests?actor=staff','/email-test','/requests/x/accept'])assert.ok((await call('POST',path,{})).status>=400);
 assert.equal((await call('POST','/calendar',{body:'x'.repeat(33000)})).status,422);
});
test('photos cross RPC only after authorization as a bounded image payload',async t=>{
 const options=setup(t);const {store,customer,id}=options;
 const snapshot=store.addPhoto(customer,id,{name:'ref.png',mimeType:'image/png',bytes:Uint8Array.from([137,80,78,71,13,10,26,10])},'photo');
 const photoId=snapshot.attachments[0].id;
 const response=await handleStaffGateway({actor,method:'GET',path:`/requests/${id}/photos/${photoId}`},options);
 assert.equal(response.status,200);assert.equal(response.body.mimeType,'image/png');assert.equal(Buffer.from(response.body.base64,'base64').length,8);
});
test('portal transport uses parent session API and preserves methods, errors and image bytes',async()=>{
 const calls=[];const api=createPortalApi(async(path,body)=>{calls.push({path,body});if(path.includes('photos'))return {mimeType:'image/png',base64:'iVBORw0KGgo='};return {requests:[]};});
 assert.deepEqual(await api('/admin/requests?q=Ana'),{requests:[]});
 await api('/admin/calendar',{date:'2026-12-01',closed:true,operationId:'day'});
 assert.deepEqual(calls[0],{path:'celebraciones/requests?q=Ana',body:{method:'GET',body:null}});
 assert.equal(calls[1].body.method,'POST');
 const photo=await api('/admin/requests/id/photos/photo',undefined,true);assert.equal(photo.type,'image/png');assert.equal(photo.size,8);
 await assert.rejects(()=>createPortalApi(async()=>{throw {code:'AUTH_REQUIRED'};})('/admin/requests'),{code:'AUTH_REQUIRED'});
 await assert.rejects(()=>api('https://other.test/admin/requests'),{code:'VALIDATION'});
});
test('portal shell has no App Bridge or private data and links stay under the store',async()=>{
 const response=renderAdminPage({shop,clientId:'app',portal:true});const html=await response.text();
 assert.ok(!html.includes('app-bridge.js'));assert.ok(!html.includes('shopify-api-key'));
 assert.match(html,/data-ds-portal="true"/);assert.match(html,/\/apps\/inventario\/assets\/celebraciones.js/);
 assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
 const job={id:randomUUID(),requestId:randomUUID(),kind:'comment',reference:'DS-000123'};
 const mime=buildStaffMessage(job,{shop,clientId:'app',portalEnabled:true});const text=Buffer.from(mime.split('\r\n\r\n')[1],'base64').toString();
 assert.match(text,/https:\/\/dayanassweet.com\/apps\/inventario#celebraciones\//);assert.ok(!text.includes('admin.shopify.com'));
 assert.match(renderEmailHtml({subject:'Nuevo mensaje',text}),/Abrir en el panel/);
});
