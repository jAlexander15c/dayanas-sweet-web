import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {registerPaginate, registerImageTag} from './helpers/shopify-liquid.mjs';

const qaRequire = createRequire(resolve(process.env.DS_QA_ROOT || '.', 'orders-test-runtime.cjs'));
const {Liquid} = qaRequire('liquidjs');
const source = () => readFileSync('sections/ds-redesign-home.liquid', 'utf8');
const schema = () => JSON.parse(source().match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)[1]);
const defaults = items => Object.fromEntries(items.filter(item => item.id && 'default' in item).map(item => [item.id,item.default]));
const openSettings = {ds_batch_open:true,ds_batch_close:'viernes 6, 8 p. m. Houston',ds_batch_ship:'lunes 9'};
async function render(settings={}, {form={}, blocks, overrides={}}={}) {
  const config = schema();
  const context = {settings, form, routes:{all_products_collection_url:'/collections/all'}, section:{id:'qa-home', settings:{...defaults(config.settings),...overrides}, blocks:blocks || config.presets[0].blocks.map((block,index) => ({id:`category-${index}`,type:block.type,settings:{...defaults(config.blocks[0].settings),...block.settings}}))}};
  const liquid = new Liquid({root:resolve('snippets'),extname:'.liquid',globals:context});
  registerPaginate(liquid);
  registerImageTag(liquid);
  liquid.registerFilter('asset_url', name => `/assets/${name}`);
  liquid.registerFilter('image_url', (image, ...args) => `/images/${image.id}?width=${args[0]?.[1] || 1440}`);
  liquid.registerFilter('default_errors', errors => `<ul><li>${errors.email}</li></ul>`);
  // LiquidJS has no Shopify form tag. Only unwrap the platform-owned boundary;
  // form state is supplied by each test, never inferred from user input.
  const markup = source().replace(/{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}/,'').replace(/{%-?\s*form\s+'customer'[\s\S]*?-?%}/,'<form data-test-shopify-customer>').replace(/{%-?\s*endform\s*-?%}/,'</form>');
  return liquid.parseAndRender(markup,context);
}
const clean = html => html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();

test('approved copy, three hero lines and isolated class names', async () => {
  const output=await render();
  assert.match(output,/<h1[^>]*><span>Un pedacito<\/span><span>de Cuba en<\/span><em>Houston\.<\/em><\/h1>/);
  assert.match(clean(output),/Sabores que te llevan a casa y otros que te invitan a probar algo nuevo\. Todo hecho a mano, por encargo y con nuestro toque\./);
  assert.match(output,/data-ds-r-open="how"/);
  for(const attr of output.matchAll(/class="([^"]+)"/g)) for(const name of attr[1].split(/\s+/)) assert.ok(name.startsWith('ds-r-'),name);
});
test('closed by default with no dates and no fabricated signup success', async () => {
  const output=await render();
  assert.match(clean(output),/Que no se te pase/);
  assert.match(clean(output),/Los pedidos están cerrados\. Déjanos tu correo para saber cuándo abrimos y cuál será la próxima fecha de envío\./);
  assert.doesNotMatch(output,/¡Ya estás|Apertura de pedidos:|Pedidos hasta el|Envío:|<ul[^>]*>\s*<\/ul>/);
});
test('shared closed message and optional opening are escaped and do not open orders', async () => {
  const output=await render({ds_batch_open:false,ds_batch_closed_text:'Cerrado <aviso> & pronto',ds_batch_start:'jueves <5> & mañana'});
  assert.match(output,/Cerrado &lt;aviso&gt; &amp; pronto/);
  assert.match(output,/Apertura de pedidos: jueves &lt;5&gt; &amp; mañana/);
  assert.match(output,/data-test-shopify-customer/);
});
test('open orders show escaped shared dates once and menu CTA instead of newsletter', async () => {
  const output=await render({...openSettings,ds_batch_ship:'lunes <9> & envío',ds_batch_close:'viernes <6> & cierre'});
  assert.match(clean(output),/Ya puedes hacer tu pedido/);
  assert.match(output,/lunes &lt;9&gt; &amp; envío/);
  assert.match(output,/viernes &lt;6&gt; &amp; cierre/);
  assert.equal((output.match(/viernes &lt;6&gt; &amp; cierre/g)||[]).length,1);
  assert.match(output,/>Elegir mis favoritos<img/);
  assert.doesNotMatch(output,/<form|contact\[email\]/);
});
test('incomplete dates keep the interface closed despite the open toggle', async () => {
  for(const missing of ['ds_batch_close','ds_batch_ship']) assert.match(await render({...openSettings,[missing]:''}),/data-test-shopify-customer/);
});
test('native customer form has newsletter payload, unique IDs, real errors and confirmed-only success', async () => {
  assert.match(source(),/{%-?\s*form\s+'customer',\s*id:\s*newsletter_id,\s*class:\s*newsletter_class\s*-?%}/);
  const output=await render({}, {form:{errors:{email:'Correo inválido'}}});
  assert.match(output,/name="contact\[tags\]" value="newsletter"/);
  assert.match(output,/id="ds-r-email" name="contact\[email\]"/);
  assert.match(output,/for="ds-r-email"/);
  assert.match(output,/Correo inválido/);
  assert.doesNotMatch(output,/¡Ya estás/);
  assert.match(await render({}, {form:{'posted_successfully?':true}}),/¡Ya estás en la lista!/);
  assert.match(source(),/assign newsletter_id = 'ds-r-newsletter-' \| append: section.id/);
});
test('categories use actual collections, editable fallback titles and local routes', async () => {
  const output=await render({}, {blocks:[{id:'real',type:'category',settings:{collection:{title:'Especiales <hoy>',url:'/collections/especiales'},title:'Fallback',link_label:'Ver especiales',fallback_image:'cookies',image_alt:'Galletas'}},{id:'empty',type:'category',settings:{title:'Menú de temporada',link_label:'Explorar',fallback_image:'brownies',image_alt:'Brownies'}}]});
  assert.match(output,/href="\/collections\/especiales"/);
  assert.match(output,/<h3>Especiales &lt;hoy&gt;<\/h3>/);
  assert.match(output,/<h3>Menú de temporada<\/h3>/);
  assert.match(output,/href="\/collections\/all"/);
  assert.doesNotMatch(output,/dayanassweet\.com|\$|precio|sold/);
  assert.match(output,/ds-r-cookies-category\.png/);
  assert.match(output,/ds-r-brownie-category\.png/);
});
test('schema supplies editable copy and image settings; images have intrinsic size and accessible text', async () => {
  const config=schema();
  for(const id of ['hero_line_1','hero_line_2','hero_line_3','hero_text','hero_image','closed_title','closed_text','open_title','open_text','signup_success','menu_title','menu_text']) assert.ok(config.settings.some(item=>item.id===id),id);
  assert.ok(config.blocks[0].settings.some(item=>item.type==='collection'));
  const output=await render({}, {overrides:{hero_image:{id:'custom',width:1800,height:700},hero_image_alt:'Foto <propia>'}});
  assert.match(output,/src="\/images\/custom\?width=1440"/);
  assert.match(output,/alt="Foto &lt;propia&gt;"/);
  for(const image of output.matchAll(/<img\b[^>]*>/g)) { assert.match(image[0],/width="\d+"/); assert.match(image[0],/height="\d+"/); assert.match(image[0],/alt="[^"]*"/); }
});
