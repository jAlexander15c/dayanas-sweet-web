// Fase 4 de diseño: renderiza el Liquid real del inicio con la tanda cerrada (D03), el bloque único de
// recomendaciones de la ficha (D09) y «Cómo funciona» en la solicitud de pastel (D11).
// Shopify se sustituye solo en sus etiquetas y filtros propios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { registerPaginate, registerImageTag } from './helpers/shopify-liquid.mjs';

const qaRequire = createRequire(resolve(process.env.DS_QA_ROOT || '.', 'orders-test-runtime.cjs'));
let Liquid;
try { ({ Liquid } = qaRequire('liquidjs')); } catch { Liquid = null; }
const rendered = (name, fn) => test(name, { skip: !Liquid && 'liquidjs no disponible' }, fn);
const read = path => readFileSync(path, 'utf8');
const schemaOf = source => JSON.parse(source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)[1]);
const withoutSchema = source => source.replace(/{%-?\s*schema\s*-?%}[\s\S]*?{%-?\s*endschema\s*-?%}/, '');
const defaults = items => Object.fromEntries(items.filter(item => item.id && 'default' in item).map(item => [item.id, item.default]));
const readJson = path => JSON.parse(read(path).replace(/^\/\*[\s\S]*?\*\//, ''));

function engine(globals) {
  const liquid = new Liquid({ root: resolve('snippets'), extname: '.liquid', globals });
  registerPaginate(liquid);
  registerImageTag(liquid);
  liquid.registerFilter('asset_url', name => `/assets/${name}`);
  liquid.registerFilter('image_url', (image, ...args) => `/images/${image.id}?width=${args[0]?.[1] || 1440}`);
  liquid.registerFilter('default_errors', errors => `<ul><li>${errors.email}</li></ul>`);
  liquid.registerFilter('t', key => key);
  return liquid;
}

// ---------- D03 · inicio con la tanda cerrada ----------
const openSettings = { ds_batch_open: true, ds_batch_close: 'viernes 6, 8 p. m. Houston', ds_batch_ship: 'lunes 9' };
async function renderHome(settings = {}, overrides = {}) {
  const source = read('sections/ds-redesign-home.liquid');
  const config = schemaOf(source);
  const context = {
    settings, form: {}, routes: { all_products_collection_url: '/collections/all' },
    pages: { 'pasteles-personalizados': { url: '/pages/pasteles-personalizados' } },
    section: {
      id: 'qa-home', settings: { ...defaults(config.settings), ...overrides },
      blocks: config.presets[0].blocks.map((block, index) => ({ id: `category-${index}`, type: block.type, settings: { ...defaults(config.blocks[0].settings), ...block.settings } })),
    },
  };
  // LiquidJS no tiene la etiqueta form de Shopify: se reemplaza por un form con el mismo id que Shopify le pondría.
  const markup = withoutSchema(source)
    .replace(/{%-?\s*form\s+'customer'[\s\S]*?-?%}/, '<form id="{{ newsletter_id }}" data-test-shopify-customer>')
    .replace(/{%-?\s*endform\s*-?%}/, '</form>');
  return engine(context).parseAndRender(markup, context);
}
const hero = html => html.match(/<section class="ds-r-hero[\s\S]*?<\/section>/)[0];

rendered('D03: con la tanda cerrada, el aviso va antes de los botones y enlaza al formulario de correo', async () => {
  const html = await renderHome();
  const top = hero(html);
  assert.match(top, /class="ds-r-hero ds-r-hero--closed"/);
  const notice = top.match(/<div class="ds-r-hero-notice">([\s\S]*?)<\/div>/);
  assert.ok(notice, 'falta el aviso');
  assert.match(notice[1], /<p>Los pedidos están cerrados por ahora\. Te avisamos por correo cuando abra la próxima tanda\.<\/p>/);
  assert.match(notice[1], /<a href="#ds-r-newsletter-qa-home">Avísame cuando abra<\/a>/);
  assert.ok(top.indexOf('ds-r-hero-notice') < top.indexOf('ds-r-hero-actions'), 'el aviso debe ir antes de los botones');
  assert.match(html, /<form id="ds-r-newsletter-qa-home" data-test-shopify-customer>/, 'el destino del enlace existe');
});

rendered('D03: con la tanda abierta no hay aviso; «Cotiza tu pastel» es secundario en los dos estados', async () => {
  const open = hero(await renderHome(openSettings));
  assert.doesNotMatch(open, /ds-r-hero--closed|ds-r-hero-notice/);
  for (const top of [open, hero(await renderHome())]) {
    const cta = top.match(/<a class="ds-r-button[^"]*" href="\/pages\/pasteles-personalizados">[\s\S]*?<\/a>/)?.[0] || '';
    assert.match(cta, /class="ds-r-button ds-r-button--secondary"/);
    assert.doesNotMatch(cta, /ds-r-light-icon/, 'la flecha blanca no se vería sobre fondo blanco');
    assert.match(top, /<a class="ds-r-button" href="#menu">Descubre el menú<img class="ds-r-light-icon"/);
  }
});

rendered('D03: el aviso usa los textos del editor del tema, escapados', async () => {
  const top = hero(await renderHome({}, { hero_closed_text: 'Cerrado <b>hoy</b> & mañana', hero_closed_link: 'Avísame <ya>' }));
  assert.match(top, /<p>Cerrado &lt;b&gt;hoy&lt;\/b&gt; &amp; mañana<\/p>/);
  assert.match(top, />Avísame &lt;ya&gt;<\/a>/);
});

test('D03: el aviso ensancha la portada en vez de recortarla y su enlace mide al menos 44 px', () => {
  const css = read('assets/ds-redesign.css');
  assert.match(css, /\.ds-r-hero\.ds-r-hero--closed\{height:auto;min-height:500px\}/);
  assert.match(css, /\.ds-r-hero--closed \.ds-r-hero-inner\{height:auto\}/);
  assert.match(css, /\.ds-r-hero-notice a\{min-height:44px/);
  assert.match(css, /@media\(max-width:600px\)\{\.ds-r-hero\.ds-r-hero--closed\{min-height:0\}/);
  assert.match(css, /@media\(forced-colors:active\)\{\.ds-r-button\.ds-r-button--secondary\{border:2px solid ButtonText\}\}/, 'en alto contraste el borde por box-shadow desaparece');
});

// ---------- D09 · un solo bloque de recomendaciones en la ficha ----------
async function renderRail({ templateName = 'product', current = 1, collection, all, limit = 4 } = {}) {
  const source = read('sections/ds-product-rail.liquid');
  const product = id => ({ id, title: `Producto ${id}` });
  const context = {
    template: { name: templateName }, product: product(current),
    collections: { all: { url: '/collections/all', products: all.map(product) } },
    routes: { all_products_collection_url: '/collections/all' },
    settings: {},
    section: { id: 'rail', settings: { ...defaults(schemaOf(source).settings), limit, collection: collection && { url: '/collections/mas-vendidos', products: collection.map(product) } } },
  };
  const markup = withoutSchema(source)
    .replace(/{%\s*render 'ds-product-card'[^%]*%}/, '<i data-card="{{ rail_product.id }}"></i>')
    .replace(/{%-?\s*render\s+'([\w-]+)'[\s\S]*?-?%}/g, '<i data-test-render="$1"></i>');
  return engine(context).parseAndRender(markup, context);
}
const cards = html => [...html.matchAll(/data-card="(\d+)"/g)].map(m => Number(m[1]));

rendered('D09: la ficha muestra hasta 4 productos de la colección, sin el que se está viendo', async () => {
  assert.deepEqual(cards(await renderRail({ collection: [1, 2, 3, 4, 5, 6], all: [1, 2, 3, 4, 5, 6] })), [2, 3, 4, 5]);
  assert.deepEqual(cards(await renderRail({ current: 9, collection: [6, 5], all: [1, 2, 3] })), [6, 5], 'con productos en la colección no se mezcla el resto del menú');
});

rendered('D09: si la colección no deja productos, la ficha usa el resto del menú en vez del aviso de menú vacío', async () => {
  for (const collection of [[], [1]]) {
    const html = await renderRail({ collection, all: [1, 2, 3] });
    assert.deepEqual(cards(html), [2, 3]);
    assert.doesNotMatch(html, /data-test-render="ds-batch-text"/);
    assert.match(html, /href="\/collections\/all"/, '«Ver todo» lleva al menú completo');
  }
  const empty = await renderRail({ collection: [], all: [1] });
  assert.deepEqual(cards(empty), []);
  assert.match(empty, /data-test-render="ds-batch-text"/, 'sin ningún otro producto queda el aviso');
});

rendered('D09: fuera de la ficha, una colección vacía conserva el aviso de menú vacío', async () => {
  const html = await renderRail({ templateName: 'index', collection: [], all: [1, 2, 3] });
  assert.deepEqual(cards(html), []);
  assert.match(html, /data-test-render="ds-batch-text"/);
});

test('D09: la plantilla de producto tiene un solo bloque de recomendaciones, de 4 productos', () => {
  const template = readJson('templates/product.json');
  assert.ok(!('related-products' in template.sections));
  assert.deepEqual(template.order, ['main', 'disclosures', 'ds-bestsellers']);
  const rail = template.sections['ds-bestsellers'];
  assert.equal(rail.type, 'ds-product-rail');
  assert.equal(rail.settings.collection, 'mas-vendidos');
  assert.equal(rail.settings.limit, 4);
});

// ---------- D11 · «Cómo funciona» en la solicitud de pastel ----------
async function renderRequest(overrides = {}) {
  const source = read('sections/ds-celebracion-solicitud.liquid');
  const settings = Object.fromEntries(schemaOf(source).settings.filter(s => s.id).map(s => [s.id, s.default ?? '']));
  const context = {
    section: { id: 'req', settings: { ...settings, service_enabled: true, guest_enabled: true, ...overrides } },
    customer: null, routes: { storefront_login_url: '/account/login', root_url: '/' }, request: { path: '/pages/pasteles-personalizados' },
  };
  // liquidjs no conoce {% form %} de Shopify (casilla de novedades): se sustituye por un <form> simple.
  const markup = withoutSchema(source).replace(/{%-?\s*form\s+'customer'[\s\S]*?-?%}/, '<form>').replace(/{%-?\s*endform\s*-?%}/, '</form>');
  return engine(context).parseAndRender(markup, context);
}
const how = html => html.match(/<section class="ds-request__how"[\s\S]*?<\/section>/)?.[0] || '';

rendered('D11: «Cómo funciona» va entre la introducción y el formulario, con los tres pasos y la anticipación', async () => {
  const html = await renderRequest();
  const block = how(html);
  assert.ok(block, 'falta el bloque');
  assert.ok(html.indexOf('ds-request__intro') < html.indexOf('ds-request__how'));
  assert.ok(html.indexOf('ds-request__how') < html.indexOf('data-live'));
  assert.match(block, /aria-labelledby="DSRequestHow-req"/);
  assert.match(block, /<h2 id="DSRequestHow-req">Cómo funciona<\/h2>/);
  assert.equal((block.match(/<li>/g) || []).length, 3);
  assert.match(block, /<ol role="list">/, 'Safari conserva la lista aunque no tenga viñetas');
  for (const text of ['Cuéntanos tu idea', 'Recibes la cotización', 'En menos de 12 horas', 'Aceptas y reservas', 'anticipo del 60 %', 'Fulshear, TX', '7 días o más', 'desde 24 horas']) assert.ok(block.includes(text), text);
});

rendered('D11: con el servicio apagado o el título vacío no se muestra; los textos se escapan', async () => {
  assert.equal(how(await renderRequest({ service_enabled: false })), '');
  assert.equal(how(await renderRequest({ how_title: '' })), '');
  const block = how(await renderRequest({ how_step1_text: 'Idea <b>&</b>', how_lead: '' }));
  assert.match(block, /Idea &lt;b&gt;&amp;&lt;\/b&gt;/);
  assert.doesNotMatch(block, /ds-request__how-lead/);
});

test('D11: los datos del bloque coinciden con los del servicio y del formulario', () => {
  const liquid = read('sections/ds-celebracion-solicitud.liquid');
  const js = read('assets/ds-celebracion-solicitud.js');
  assert.match(js, /urgent: at - now < 168 \* 3600000/, '7 días = 168 horas');
  assert.match(liquid, /Personalizados normales: desde 7 días\. Entre 24 horas y menos de 7 días: solicitud urgente/);
  assert.match(liquid, /"id": "pickup_address"[^}]*"default": "Fulshear, TX/);
  assert.match(js, /8:00 a\. m\. a 6:00 p\. m\./);
  assert.match(read('services/celebraciones/src/shopify-payments.mjs'), /fullBase \* 60n \+ 99n\) \/ 100n/, 'anticipo del 60 %');
});
