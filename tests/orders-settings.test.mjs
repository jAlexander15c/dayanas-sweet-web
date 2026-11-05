import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readShopifyJson} from './helpers/shopify-json.mjs';

// Test tooling can live outside the theme. See docs/pedidos-envios.md.
const qaRequire = createRequire(resolve(process.env.DS_QA_ROOT || '.', 'orders-test-runtime.cjs'));
const {Liquid} = qaRequire('liquidjs');
const engine = (settings, extra) => new Liquid({root:resolve('snippets'), extname:'.liquid', globals:{settings,product:extra.product,cart:extra.cart,section:extra.section,collection:extra.collection,routes:extra.routes}});
const openSettings = {
  ds_batch_open:true,
  ds_batch_close:'viernes 6 de noviembre, 8 p. m. hora de Houston',
  ds_batch_ship:'lunes 9 de noviembre',
  ds_batch_closed_text:'Volveremos a abrir pedidos. Déjanos tu correo.'
};
const product = {type:'Brownies', tags:[], selected_or_first_available_variant:{available:true, inventory_management:'shopify', inventory_policy:'deny', inventory_quantity:20}};
const snippet = (name, settings={}, extra={}) => engine(settings,extra).renderFile(name, {settings,...extra});
const section = (name, settings={}, extra={}) => {
  const context={settings,section:{id:'qa',settings:{show_batch:true,title:'Pedidos y envíos'},blocks:[]},...extra};
  return engine(settings,context).parseAndRender(
    readFileSync(`sections/${name}.liquid`,'utf8').replace(/{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}/,''),context
  );
};
const clean = html => html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();

test('an unconfigured store stays closed instead of silently allowing orders', async () => {
  assert.equal((await snippet('ds-batch-state')).trim(),'1');
});
test('the schema defaults render a closed launch with no dates of a previous sale', async () => {
  const schema=readShopifyJson('config/settings_schema.json');
  const defaults=Object.fromEntries(schema.flatMap(group=>group.settings||[]).filter(item=>item.id&&'default' in item).map(item=>[item.id,item.default]));
  assert.equal((await snippet('ds-batch-state',defaults)).trim(),'1');
  const output=clean(await snippet('ds-product-batch',defaults,{product,section:{id:'qa'}}));
  assert.doesNotMatch(output,/octubre|Pedidos hasta|Horneamos el|Despacho/);
});
test('the manual switch stays closed even when the date fields are complete', async () => {
  assert.equal((await snippet('ds-batch-state',{...openSettings,ds_batch_open:false})).trim(),'1');
});
test('orders stay closed until both the cutoff and shipping date are provided', async () => {
  for(const missing of ['ds_batch_close','ds_batch_ship']) {
    assert.equal((await snippet('ds-batch-state',{...openSettings,[missing]:''})).trim(),'1',missing);
  }
});
test('the manual switch opens orders with complete required dates and no exact scheduler', async () => {
  assert.equal((await snippet('ds-batch-state',openSettings)).trim(),'');
});
test('an expired exact cutoff still closes the interface', async () => {
  assert.equal((await snippet('ds-batch-state',{...openSettings,ds_batch_close_at:'2000-01-01T00:00:00-06:00'})).trim(),'1');
});
test('a future exact cutoff preserves an explicitly open interface', async () => {
  assert.equal((await snippet('ds-batch-state',{...openSettings,ds_batch_close_at:'2100-01-01T00:00:00-06:00'})).trim(),'');
});
test('a sentence depending on a pending date is omitted rather than rendered incomplete', async () => {
  assert.equal((await snippet('ds-batch-text',{}, {text:'Pedidos hasta el [cierre]',escape:true})).trim(),'');
});
test('new and legacy shipping placeholders read the same single setting', async () => {
  const result=await snippet('ds-batch-text',openSettings,{text:'Envío [envio] / [despacho]',escape:true});
  assert.equal(result.trim(),'Envío lunes 9 de noviembre / lunes 9 de noviembre');
});
test('administrator dates and the shared closed message are escaped exactly once', async () => {
  const result=await snippet('ds-batch-text',{...openSettings,ds_batch_ship:'<img src=x> & lunes',ds_batch_closed_text:'<b>Cerrado</b> & aviso'}, {text:'[envio] — [mensaje_cerrado]',escape:true});
  assert.equal(result.trim(),'&lt;img src=x&gt; &amp; lunes — &lt;b&gt;Cerrado&lt;/b&gt; &amp; aviso');
});
test('optional preparation date is absent from product and collection when pending', async () => {
  const p=clean(await snippet('ds-product-batch',openSettings,{product,section:{id:'qa'}}));
  const c=clean(await section('ds-collection-hero',openSettings,{collection:{title:'Brownies',handle:'brownies',description:''}}));
  for(const output of [p,c]) {
    assert.match(output,/6 de noviembre/);
    assert.match(output,/9 de noviembre/);
    assert.doesNotMatch(output,/Horneamos el/);
  }
});
test('closed home, product, collection and cart never show pending date rows', async () => {
  const settings={ds_batch_open:false,ds_batch_closed_text:'Estamos preparando la próxima apertura.'};
  const home=await section('ds-batch',settings);
  const p=await snippet('ds-product-batch',settings,{product,section:{id:'qa'}});
  const c=await section('ds-collection-hero',settings,{collection:{title:'Menú',handle:'all',description:''}});
  const cart=await snippet('ds-cart-batch',settings,{cart:{items:[]}});
  for(const output of [home,p,c,cart]) assert.doesNotMatch(clean(output),/Pedidos hasta el|Horneamos el|Despacho|\[(?:apertura|cierre|envio|despacho)\]/);
  for(const output of [home,c,cart]) assert.match(clean(output),/Estamos preparando la próxima apertura/);
});
test('the next opening can be announced while purchases remain closed', async () => {
  const settings={ds_batch_open:false,ds_batch_start:'jueves 5 de noviembre',ds_batch_closed_text:'Pedidos cerrados.'};
  const output=clean(await section('ds-batch',settings));
  assert.match(output,/Apertura.*jueves 5 de noviembre/);
  assert.equal((await snippet('ds-batch-state',settings)).trim(),'1');
});
test('the cart uses the shared shipping date and omits a pending preparation date', async () => {
  const output=clean(await snippet('ds-cart-batch',openSettings,{cart:{items:[{id:1}]}}));
  assert.match(output,/9 de noviembre/);
  assert.doesNotMatch(output,/Horneamos tu pedido el\s+y/);
});
test('the configured FAQ never presents an empty answer when optional dates are pending', async () => {
  const template=readShopifyJson('templates/index.json');
  const configured=Object.values(template.sections).find(item=>item.type==='ds-faq');
  const blocks=configured.block_order.map(id=>({id,settings:configured.blocks[id].settings}));
  const output=await section('ds-faq',openSettings,{section:{id:'qa',settings:configured.settings,blocks}});
  assert.doesNotMatch(output,/class="ds-qa__a rte">\s*<\/div>/);
});
test('an expiring countdown uses the administrators shared closed message', async () => {
  const output=await section('ds-batch',{...openSettings,ds_batch_close_at:'2100-01-01T00:00:00-06:00',ds_batch_closed_text:'Reabrimos pronto & te avisaremos.'});
  const done=output.match(/data-ds-countdown-done hidden>([\s\S]*?)<\/p>/);
  assert.ok(done);
  assert.equal(done[1],'Reabrimos pronto &amp; te avisaremos.');
});
test('an announcement depending only on a pending opening leaves no empty banner', async () => {
  const output=await section('ds-announcement',{ds_batch_open:false},{section:{id:'qa',settings:{marquee_speed:45},blocks:[{settings:{text:'Apertura: [apertura]',show_when:'closed'}}]}});
  assert.equal(output.trim(),'');
});
test('the announcement reads and escapes the administrators closed message', async () => {
  const output=await section('ds-announcement',{ds_batch_open:false,ds_batch_closed_text:'Cerrado <aviso>'},{section:{id:'qa',settings:{marquee_speed:45},blocks:[{settings:{text:'[mensaje_cerrado]',show_when:'closed'}}]}});
  assert.match(output,/Cerrado &lt;aviso&gt;/);
  assert.doesNotMatch(output,/<aviso>/);
});
test('an empty-cart region pre-rendered with items never contains an open shipping notice', async () => {
  const output=await snippet('ds-cart-batch',openSettings,{cart:{items:[{id:1}]},empty_notice:true});
  assert.equal(output.trim(),'');
});
test('a closed empty-cart warning is ready before the last item is removed', async () => {
  const output=await snippet('ds-cart-batch',{...openSettings,ds_batch_open:false},{cart:{items:[{id:1}]},empty_notice:true});
  assert.match(clean(output),/Volveremos a abrir pedidos/);
  assert.doesNotMatch(clean(output),/Enviamos tu pedido/);
});
