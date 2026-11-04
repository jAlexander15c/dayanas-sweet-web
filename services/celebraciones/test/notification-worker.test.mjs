import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const shop='sweet.myshopify.com',secret='test-secret',clientId='test-client';
function proxy(path,body){
 const url=new URL(`https://local.test/proxy/guest/requests${path}`);
 for(const [key,value] of Object.entries({shop,logged_in_customer_id:'',path_prefix:'/apps/celebraciones',timestamp:String(Math.floor(Date.now()/1000))}))url.searchParams.set(key,value);
 const plain=[...url.searchParams].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('');
 url.searchParams.set('signature',createHmac('sha256',secret).update(plain).digest('hex'));
 return [url.href,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://dayanassweet.com'},body:JSON.stringify(body)}];
}
function admin(id,action,body){
 const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
 const data=Buffer.from(JSON.stringify({aud:clientId,sub:'9',dest:`https://${shop}`,iss:`https://${shop}/admin`,iat:now,nbf:now,exp:now+60})).toString('base64url');
 const signature=createHmac('sha256',secret).update(`${header}.${data}`).digest('base64url');
 return [`https://local.test/admin/requests/${id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${header}.${data}.${signature}`},body:JSON.stringify(body)}];
}
test('actual Worker queues staff events, persists alarms and delivers guest links through Resend in workerd',async()=>{
 const dir=fileURLToPath(new URL('../src/',import.meta.url));
 const bundled=await build({stdin:{contents:`import worker,{CelebrationStore} from './cloudflare-worker.mjs';
 export default worker;
 export class TestStore extends CelebrationStore {
 async fetch(request){if(new URL(request.url).pathname==='/test/alarm'){const scheduled=(await this.ctx.storage.getAlarm())!==null;await this.alarm();return Response.json({scheduled});}return super.fetch(request);}
 }`,resolveDir:dir},bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*','cloudflare:*'],plugins:[{name:'admin-text',setup(build){build.onLoad({filter:/admin-ui\.(js|css)$/},args=>({contents:readFileSync(args.path,'utf8'),loader:'text'}));}}]});
 const sent=[];
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{modules:true,compatibilityDate:'2026-11-03',compatibilityFlags:['nodejs_compat'],script:bundled.outputFiles[0].text,
  bindings:{SHOPIFY_SHOP:shop,SHOPIFY_APP_SECRET:secret,SHOPIFY_CLIENT_ID:clientId,SHOPIFY_STAFF_IDS:'9',STOREFRONT_ORIGIN:'https://dayanassweet.com',SERVICE_ENABLED:'true',GUEST_ENABLED:'true',PAYMENTS_ENABLED:'false',GUEST_ACCESS_KEY:Buffer.alloc(32,7).toString('base64'),RESEND_API_KEY:'re_test'},
  durableObjects:{CELEBRATIONS:{className:'TestStore',useSQLite:true}},
  outboundService:async request=>{assert.equal(request.url,'https://api.resend.com/emails');sent.push(await request.json());return Response.json({id:'accepted'});}
 }]}));
 try{
  const capability='ab'.repeat(32),pickupAt=new Date(Date.now()+20*86400000);pickupAt.setUTCHours(18,0,0,0);
  const created=await mf.dispatchFetch(...proxy('',{input:{requestText:'Pastel',pickup:{label:'Houston'},details:{pickupAt:pickupAt.toISOString(),urgent:false,tiers:[{diameter:6,sponges:['Vainilla','Vainilla'],fillings:['Fresa','Fresa']}],coating:'Crema',decorations:[]}},contact:{name:'Ana',email:'ana@example.test',phone:'5551234567'},capability,operationId:'create',website:''}));
  assert.equal(created.status,200);const request=await created.json();
  const ns=await mf.getDurableObjectNamespace('CELEBRATIONS'),stub=ns.get(ns.idFromName(shop));
  await stub.fetch('https://local.test/test/alarm');assert.equal(sent.length,1);
  const body={proposal:{baseCents:10000,surchargeCents:0,display:'total',canPrepare:'Sí',changes:'',reply:'Propuesta'},operationId:'proposal'};
  assert.equal((await mf.dispatchFetch(...admin(request.id,'proposals',body))).status,200);
  assert.equal((await mf.dispatchFetch(...admin(request.id,'proposals',body))).status,200);
  assert.equal((await (await stub.fetch('https://local.test/test/alarm')).json()).scheduled,true);
  assert.equal(sent.length,2);assert.match(sent[1].subject,/Nueva propuesta/);
  const token=sent[1].text.match(/#acceso=([a-f0-9]{64})/)[1];
  assert.equal((await mf.dispatchFetch(...proxy(`/${request.id}/tracking`,{capability:token}))).status,200);
  assert.equal((await mf.dispatchFetch(...admin(request.id,'comments',{text:'Actualización',operationId:'message'}))).status,200);
  assert.equal((await (await stub.fetch('https://local.test/test/alarm')).json()).scheduled,true);
  assert.equal(sent.length,3);assert.match(sent[2].subject,/Nuevo mensaje/);
 }finally{await mf.dispose();}
});
