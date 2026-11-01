// Generates a local review page from the actual schema and Liquid snippets.
// It does not create an admin panel or save anything to Shopify.
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const qaRequire=createRequire(resolve(process.env.DS_QA_ROOT||'.','orders-test-runtime.cjs'));
const {Liquid}=qaRequire('liquidjs');
const schema=JSON.parse(readFileSync('config/settings_schema.json','utf8'));
const group=schema.find(item=>item.settings?.some(setting=>setting.id==='ds_batch_open'));
const defaults=Object.fromEntries(schema.flatMap(item=>item.settings||[]).filter(item=>item.id&&'default' in item).map(item=>[item.id,item.default]));
const current={...defaults,...JSON.parse(readFileSync('config/settings_data.json','utf8')).current};
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const product={type:'Brownies',tags:[],selected_or_first_available_variant:{available:true,inventory_management:'shopify',inventory_policy:'deny',inventory_quantity:20}};
async function render(settings,name,sectionFile=false,extra={}) {
  const section={id:'qa',settings:{show_batch:true,title:'Así llega tu antojo.'},blocks:[]};
  const context={settings,product,section,cart:{items:[{id:1}]},collection:{title:'Menú',handle:'all',description:''},...extra};
  const engine=new Liquid({root:resolve('snippets'),extname:'.liquid',globals:context});
  if(!sectionFile)return engine.renderFile(name,context);
  return engine.parseAndRender(readFileSync(`sections/${name}.liquid`,'utf8').replace(/{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}/,''),context);
}
const controls=group.settings.slice(0,group.settings.findIndex(item=>item.type==='header')).map(item=>{
  if(item.type==='paragraph')return `<p class="help">${esc(item.content)}</p>`;
  const id=esc(item.id),value=current[item.id]??'';
  const control=item.type==='checkbox'?`<input id="${id}" type="checkbox" disabled ${value?'checked':''}>`:
    item.type==='textarea'?`<textarea id="${id}" readonly rows="3">${esc(value)}</textarea>`:
    `<input id="${id}" type="text" value="${esc(value)}" placeholder="${esc(item.placeholder||'Sin definir')}" readonly>`;
  return `<div class="field ${item.type==='checkbox'?'switch':''}"><label for="${id}">${esc(item.label)}</label>${control}${item.info?`<p class="help">${esc(item.info)}</p>`:''}</div>`;
}).join('');
const examples=[
  {title:'1. Estado inicial · fechas pendientes',note:'Los pedidos permanecen cerrados y se ocultan las fechas.',settings:current},
  {title:'2. Próxima apertura anunciada',note:'Ejemplo de prueba. La fecha informa; el interruptor sigue apagado.',settings:{...current,ds_batch_start:'jueves 5 de noviembre, 6 p. m., hora de Houston'}},
  {title:'3. Pedidos abiertos con fechas',note:'Fechas de ejemplo, no configuradas para una venta real.',settings:{...current,ds_batch_open:true,ds_batch_close:'viernes 6 de noviembre, 8 p. m., hora de Houston',ds_batch_ship:'lunes 9 de noviembre'}}
];
let examplesHtml='';
for(const example of examples) {
  const home=await render(example.settings,'ds-batch',true);
  const p=await render(example.settings,'ds-product-batch');
  const cart=await render(example.settings,'ds-cart-batch');
  const productHasText=p.replace(/<[^>]*>/g,'').trim();
  examplesHtml+=`<section class="example"><h2>${esc(example.title)}</h2><p class="help">${esc(example.note)}</p><div class="sample"><h3>Portada</h3>${home}</div><div class="sample"><h3>Fechas en la ficha de producto</h3>${productHasText?p:'<p class="help">Sin fechas publicadas.</p>'}</div><div class="sample"><h3>Aviso del carrito</h3>${cart}</div></section>`;
}
const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Pedidos y envíos · revisión local</title><link rel="stylesheet" href="../assets/fonts/fonts.css"><style>
:root{font-family:Montserrat,Arial,sans-serif;color:#3a2430;background:#fff7fa}*{box-sizing:border-box}body{margin:0}header{padding:24px 4%;border-bottom:1px solid #e5c8d4;background:#fff}header p{margin:10px 0 0;max-width:80ch;font-size:13px;line-height:1.7}h1{font-size:27px;margin:0}main{display:grid;grid-template-columns:minmax(290px,360px) minmax(0,1fr);gap:28px;padding:28px 4%;max-width:1440px;margin:auto}aside,.example{border:1px solid #e5c8d4;border-radius:16px;background:white;padding:24px;min-width:0}aside{align-self:start}h2{font-size:19px;margin:0 0 12px;line-height:1.5}h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#b42c57}.help{font-size:12px;line-height:1.65;color:#634954}.field{margin-top:22px}label{font-size:13px;font-weight:700;display:block;margin-bottom:9px}input[type=text],textarea{font:inherit;width:100%;border:1px solid #b99aa9;border-radius:7px;padding:11px;font-size:12px;line-height:1.6;background:#fff7fa;color:#3a2430}input::placeholder{color:#79616c}textarea{resize:vertical}.switch{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.switch label{margin:0}.switch .help{flex-basis:100%;margin:0}.switch input{width:19px;height:19px;accent-color:#d03a67}.example{margin-bottom:20px}.sample{padding:4px 0 12px;border-bottom:1px solid #f0dfe6}.sample:last-child{border:0;padding-bottom:0}.sample h3{margin:14px 0}.ds-batch h2{font-family:'DM Serif Display',Georgia,serif;font-size:29px;letter-spacing:-.03em}.ds-batch__closed{background:#f8d4e3;padding:15px;border-radius:9px;font-size:13px;line-height:1.7}.ds-pbatch__dates{list-style:none;padding:0;margin:14px 0;display:flex;flex-wrap:wrap;gap:10px}.ds-pbatch__dates li{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:1.7;background:#fff7fa;padding:12px;border-radius:8px;flex:1 1 210px}.ds-ico{width:20px;height:20px;stroke:currentColor;stroke-width:1.6;fill:none;flex:none;color:#b42c57}.ds-cart-batch{display:flex;gap:9px;align-items:flex-start;font-size:13px;line-height:1.8;margin:0}.ds-steps:empty{display:none}.badge{display:inline-block;font-size:11px;font-weight:700;color:#b42c57;background:#fff0f5;padding:6px 10px;border-radius:99px;margin-bottom:10px}@media(max-width:750px){main{grid-template-columns:1fr;padding:20px 16px;gap:20px}header{padding:24px 20px}h1{font-size:23px}aside,.example{padding:20px}h2{font-size:17px}}
</style></head><body><header><span class="badge">Muestra local · solo lectura</span><h1>Pedidos y envíos</h1><p>Controles definidos para el editor privado de Shopify y ejemplos renderizados desde el Liquid del tema. Esta página permite revisar el trabajo; no guarda fechas en Shopify y no sustituye una prueba en el editor real.</p></header><main><aside><h2>${esc(group.name)}</h2>${controls}<p class="help">Las opciones avanzadas existentes quedan debajo de estos controles en Shopify.</p></aside><div>${examplesHtml}</div></main></body></html>`;
const output=resolve('docs/redesign/opcion-1/qa/pedidos-envios.html');
writeFileSync(output,html,'utf8');
console.log(output);
