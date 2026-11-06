// Local only: real workerd RPC + Durable SQLite, no outbound Shopify/Resend calls.
// Run npm run check:cloudflare first to regenerate the dry-run bundle.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createHmac,randomUUID} from 'node:crypto';
const shop='fixture.myshopify.com',secret='local-fixture-only';
const actor={shop,userId:randomUUID(),name:'Fixture',roles:['celebraciones'],aud:'celebraciones',sessionVersion:1};
const script=readFileSync(fileURLToPath(new URL('../.wrangler/dry-run/cloudflare-worker.js',import.meta.url)),'utf8')
 .replace(/import (adminJavaScript|adminCss) from "\.\/([^"]+)";/g,(_,name,file)=>`const ${name}=${JSON.stringify(readFileSync(fileURLToPath(new URL('../.wrangler/dry-run/'+file,import.meta.url)),'utf8'))};`);
const mf=new Miniflare(convertV4MiniflareOptions({workers:[
 {name:'caller',modules:true,script:`export default {async fetch(request,env){const data=await request.json();if(new URL(request.url).pathname==='/seed')return env.BACKEND.fetch(data.url,data.init);return Response.json(await env.CELEBRACIONES.handle(data));}}`,compatibilityDate:'2026-11-03',serviceBindings:{BACKEND:'celebraciones',CELEBRACIONES:{name:'celebraciones',entrypoint:'StaffGateway'}}},
 {name:'celebraciones',modules:true,script,compatibilityDate:'2026-11-03',compatibilityFlags:['nodejs_compat'],durableObjects:{CELEBRATIONS:{className:'CelebrationStore',useSQLite:true}},bindings:{SHOPIFY_SHOP:shop,SHOPIFY_APP_SECRET:secret,SHOPIFY_CLIENT_ID:'fixture',STOREFRONT_ORIGIN:'https://fixture.test',SERVICE_ENABLED:'true',EXTERNAL_STAFF_ENABLED:'true',PAYMENTS_ENABLED:'false'},outboundService:()=>{throw Error('No outbound calls in gateway fixture');}}
]}));
try {
 const worker=await mf.getWorker('celebraciones');
 const url=new URL('https://fixture.test/proxy/requests');for(const [key,value]of Object.entries({shop,logged_in_customer_id:'7',path_prefix:'/apps/celebraciones',timestamp:String(Math.floor(Date.now()/1000))}))url.searchParams.set(key,value);
 url.searchParams.set('signature',createHmac('sha256',secret).update([...url.searchParams].map(([k,v])=>`${k}=${v}`).sort().join('')).digest('hex'));
 const day=new Date(Date.now()+10*86400000);day.setUTCHours(18,0,0,0);
 const seedInit={method:'POST',headers:{Origin:'https://fixture.test','Content-Type':'application/json'},body:JSON.stringify({input:{requestText:'Fixture',pickup:{label:'Recoger'},details:{pickupAt:day.toISOString(),urgent:false,tiers:[{diameter:8,sponges:['Vainilla','Vainilla'],fillings:['Guayaba','Guayaba']}],coating:'Merengue',decorations:[]}},operationId:'create'})};
 const created=await mf.dispatchFetch('https://caller.test/seed',{method:'POST',body:JSON.stringify({url:url.href,init:seedInit})});
 assert.equal(created.status,200,await created.clone().text());const {id}=await created.json();
 const rpc=async input=>await (await mf.dispatchFetch('https://caller.test',{method:'POST',body:JSON.stringify(input)})).json();
 const list=await rpc({actor,method:'GET',path:'/requests'});assert.equal(list.status,200);assert.equal(list.body.requests.length,1);
 assert.equal((await rpc({actor:{...actor,roles:['inventario']},method:'GET',path:'/requests'})).status,401);
 const quote=await rpc({actor,method:'POST',path:`/requests/${id}/proposals`,body:{operationId:'quote',proposal:{baseCents:6000,surchargeCents:0,display:'total',canPrepare:'Pastel',changes:'',reply:'Listo',paymentMode:'delivery'}}});assert.equal(quote.status,200);
 assert.equal((await worker.fetch('https://fixture.test/admin/requests',{headers:{'X-Portal-Actor':JSON.stringify(actor)}})).status,401);
 assert.equal((await worker.fetch('https://fixture.test/staffHandle')).status,404);
 console.log('PASS: named RPC entrypoint -> Durable SQLite, authorized request/proposal, module denial and no public identity bypass. No outbound calls.');
} finally {await mf.dispose();}
