// Local-only review harness. Renders actual Liquid and runs the real HTTP/store
// with synthetic Shopify signatures. No Shopify calls, mail or real payments.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHmac} from 'node:crypto';
import {createStore} from '../services/celebraciones/src/store.mjs';
import {createHandler} from '../services/celebraciones/src/http.mjs';
const qaRequire=createRequire(resolve(process.env.DS_QA_ROOT||'.','qa-runtime.cjs'));
const {Liquid}=qaRequire('liquidjs');
const port=Number(process.env.DS_QA_PORT||8793),origin=`http://127.0.0.1:${port}`;
const shop='test-bakery.myshopify.com',secret='local-preview-not-a-real-key';
const store=createStore(':memory:');
const handler=createHandler({store,config:{secret,shop,clientId:'qa',storefrontOrigin:origin,guestEnabled:true,staffIds:['9'],requireDetails:true},guestEmail:{seal:async()=> 'local-test-ciphertext',wake:async()=>{}}});
const engine=new Liquid({root:resolve('snippets'),extname:'.liquid'});
engine.registerFilter('asset_url',value=>`/assets/${value}`);
engine.registerFilter('stylesheet_tag',value=>`<link rel="stylesheet" href="${value}">`);
async function page(name,authenticated=false){
 const source=readFileSync(`sections/${name}.liquid`,'utf8'),schema=JSON.parse(source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)[1]);
 const settings=Object.fromEntries(schema.settings.filter(s=>s.id).map(s=>[s.id,s.default??'']));
 Object.assign(settings,{service_enabled:true,guest_enabled:true,proxy_path:'/apps/celebraciones',tracking_page:{url:'/pages/seguimiento-de-tu-pastel'}});
 const body=await engine.parseAndRender(source.replace(/{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}/,''),{section:{id:'qa',settings},customer:authenticated?{id:'1'}:null,routes:{storefront_login_url:'/login'}});
 return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA local · Celebraciones</title><style>body{margin:0}button,input{font:inherit}</style></head><body>${body}</body></html>`;
}
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/assets/')&&/^\/assets\/[a-zA-Z0-9.-]+$/.test(url.pathname)){
   res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(readFileSync('.'+url.pathname));return;
  }
  if(url.pathname.startsWith('/apps/celebraciones/')){
   const proxy=new URL(origin+url.pathname.replace('/apps/celebraciones','/proxy'));
   for(const [k,v] of Object.entries({shop,logged_in_customer_id:url.pathname.includes('/guest/')?'':'1',path_prefix:'/apps/celebraciones',timestamp:String(Math.floor(Date.now()/1000))}))proxy.searchParams.set(k,v);
   proxy.searchParams.set('signature',createHmac('sha256',secret).update([...proxy.searchParams].map(([k,v])=>`${k}=${v}`).sort().join('')).digest('hex'));
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const headers=new Headers(req.headers);headers.set('cf-connecting-ip','127.0.0.1');
   const response=await handler(new Request(proxy,{method:req.method,headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await page(url.pathname.includes('seguimiento')?'ds-celebracion-seguimiento':'ds-celebracion-solicitud',url.searchParams.has('authenticated')));
 }catch{res.writeHead(500);res.end('Local preview error');}
}).listen(port,'127.0.0.1',()=>console.log(`Local preview ${origin} — synthetic data only`));
