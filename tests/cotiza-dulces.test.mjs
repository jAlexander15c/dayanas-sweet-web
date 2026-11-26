import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readShopifyJson} from './helpers/shopify-json.mjs';
import {registerPaginate, registerImageTag} from './helpers/shopify-liquid.mjs';

// «Cotiza tus dulces»: venta por cotización (ajuste ds_quote_mode). Contrato: docs/contratos/cotiza-tus-dulces.md, parte A.
// Las aserciones de fuente no dependen de liquidjs; los renders se omiten si no está disponible.
let Liquid;
try { ({Liquid} = createRequire(resolve(process.env.DS_QA_ROOT || '.', 'cotiza-test-runtime.cjs'))('liquidjs')); } catch { /* solo fuente */ }
const rendered = (name, fn) => test(name, {skip: !Liquid && 'liquidjs no disponible'}, fn);
const read = path => readFileSync(path, 'utf8');
const schemaOf = source => JSON.parse(source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)[1]);
const withoutSchema = source => source.replace(/{%-?\s*schema\s*-?%}[\s\S]*?{%-?\s*endschema\s*-?%}/, '');
const defaults = items => Object.fromEntries(items.filter(item => item.id && 'default' in item).map(item => [item.id, item.default]));
const clean = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const quoteSettings = {ds_quote_mode: true, ds_batch_open: true, ds_batch_close: 'viernes 6', ds_batch_ship: 'lunes 9', ds_low_stock: 5, ds_whatsapp: '+1 (346) 234-8436', social_instagram_link: 'https://www.instagram.com/dayanasweet02/'};
const pages = {'pasteles-personalizados': {url: '/pages/pasteles-personalizados'}};
const routes = {root_url: '/', all_products_collection_url: '/collections/all', cart_url: '/cart', search_url: '/search', account_url: '/account'};

function engine(globals) {
  const liquid = new Liquid({root: resolve('snippets'), extname: '.liquid', globals});
  registerPaginate(liquid);
  registerImageTag(liquid);
  liquid.registerFilter('asset_url', name => `/assets/${name}`);
  liquid.registerFilter('image_url', image => `/images/${image.id}`);
  liquid.registerFilter('default_errors', errors => `<ul><li>${errors.email}</li></ul>`);
  liquid.registerFilter('t', key => key);
  return liquid;
}
const renderSnippet = (name, context) => engine(context).renderFile(name, context);
const renderSection = (name, context) => engine(context).parseAndRender(withoutSchema(read(`sections/${name}.liquid`)), context);

// ---------- A1 · ajustes ----------
test('A1: ds_quote_mode y ds_whatsapp abren el grupo «DS · Pedidos y envíos»; los valores guardados solo en current', () => {
  const schema = readShopifyJson('config/settings_schema.json');
  const group = schema.find(item => item.name === 'DS · Pedidos y envíos');
  assert.ok(group);
  const [first, second] = group.settings;
  assert.deepEqual({type: first.type, id: first.id, label: first.label, default: first.default}, {type: 'checkbox', id: 'ds_quote_mode', label: 'Venta por cotización', default: false});
  assert.equal(first.info, 'Oculta precios, carrito y avisos de tanda, y muestra los botones para cotizar. Desactívalo para volver a vender por tandas.');
  assert.deepEqual({type: second.type, id: second.id, label: second.label, placeholder: second.placeholder}, {type: 'text', id: 'ds_whatsapp', label: 'WhatsApp (solo números, con código de país)', placeholder: '13462348436'});
  const data = readShopifyJson('config/settings_data.json');
  assert.equal(data.current.ds_quote_mode, true);
  assert.equal(data.current.ds_whatsapp, '13462348436');
  assert.equal(data.current.social_instagram_link, 'https://www.instagram.com/dayanasweet02/');
  for (const [name, preset] of Object.entries(data.presets || {})) assert.ok(!('ds_quote_mode' in preset) && !('ds_whatsapp' in preset), name);
});

// ---------- A2 · estado de tanda ----------
rendered('A2: con ds_quote_mode la tanda siempre está cerrada, aunque ds_batch_open esté activo', async () => {
  assert.equal((await renderSnippet('ds-batch-state', {settings: quoteSettings})).trim(), '1');
  assert.equal((await renderSnippet('ds-batch-state', {settings: {...quoteSettings, ds_quote_mode: false}})).trim(), '');
});

// ---------- A3 · mensajes de tanda ----------
rendered('A3: anuncios, bloque de tandas, fechas, ficha y barra fija no imprimen nada en modo cotización', async () => {
  const product = {title: 'Pastel', available: true, type: 'Brownies', tags: [], selected_or_first_available_variant: {available: false, price: 500, inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 2}};
  const announce = await renderSection('ds-announcement', {settings: quoteSettings, section: {id: 'qa', settings: {marquee_speed: 45}, blocks: [{settings: {text: 'Pedidos hasta el [cierre]', show_when: 'always'}}]}});
  assert.equal(announce.trim(), '');
  const batch = await renderSection('ds-batch', {settings: quoteSettings, section: {id: 'qa', settings: {title: 'Tandas', text: '<p>Horneamos por tandas</p>', color_scheme: 'scheme-1'}, blocks: []}});
  assert.equal(batch.trim(), '');
  assert.equal((await renderSnippet('ds-order-dates', {settings: quoteSettings})).trim(), '');
  const productBatch = clean(await renderSnippet('ds-product-batch', {settings: quoteSettings, product, section: {id: 'qa'}}));
  assert.doesNotMatch(productBatch, /Agotado|Quedan|Pedidos hasta|tanda/i);
  assert.equal((await renderSnippet('ds-sticky-buy', {settings: quoteSettings, product, section: {id: 'qa'}})).trim(), '');
  const hero = await renderSection('ds-collection-hero', {settings: quoteSettings, collection: {title: 'Postres', handle: 'postres', description: ''}, routes, section: {id: 'qa', settings: {show_batch: true, all_title: 'Todo', fallback_text: '<p>Envío el [envio]</p>'}, blocks: []}});
  assert.doesNotMatch(hero, /ds-chero__batch|Fechas de pedidos|Pedidos hasta|Envío el/);
});

rendered('A3: las preguntas frecuentes sobre tandas se omiten y las demás se mantienen', async () => {
  const blocks = [
    {settings: {question: '¿Por qué se agota un producto?', answer: '<p>Cada tanda tiene cupos.</p>'}},
    {settings: {question: '¿Cuándo puedo pedir?', answer: '<p>Mientras esté abierto.</p>', closed_answer: '<p>La tanda ya cerró.</p>'}},
    {settings: {question: '¿Cómo conservo los postres?', answer: '<p>En la nevera, hasta tres días.</p>'}},
  ];
  const html = await renderSection('ds-faq', {settings: quoteSettings, section: {id: 'qa', settings: {title: 'Antes de pedir', text: ''}, blocks}});
  assert.match(html, /¿Cómo conservo los postres\?/);
  assert.doesNotMatch(html, /agota|tanda|Mientras esté abierto/i);
});

rendered('A3: el carrito dice «Ahora trabajamos por cotización.» con enlace a la página', async () => {
  const html = clean(await renderSnippet('ds-cart-batch', {settings: quoteSettings, pages, cart: {items: [{id: 1}]}}));
  assert.match(html, /Ahora trabajamos por cotización\. Cotiza tus dulces/);
  const raw = await renderSnippet('ds-cart-batch', {settings: quoteSettings, pages, cart: {items: [{id: 1}]}});
  assert.match(raw, /<a href="\/pages\/pasteles-personalizados">Cotiza tus dulces<\/a>/);
  assert.doesNotMatch(raw, /Antes de pagar|Tanda|Preparamos/);
});

test('A3: las tarjetas no muestran precio ni estados de tanda y enlazan con «Ver y cotizar»', () => {
  const dsCard = read('snippets/ds-product-card.liquid');
  assert.match(dsCard, /if settings\.ds_quote_mode\s+assign sold_out = false/);
  assert.match(dsCard, /{%-? unless settings\.ds_quote_mode -%}\s*<span class="ds-card__price">/);
  assert.match(dsCard, /{%-? if settings\.ds_quote_mode -%}\s*<a class="ds-add" href="{{ product\.url }}"[^>]*>Ver y cotizar<\/a>\s*{%-? elsif card_quick_add == 'standard' -%}/);
  const card = read('snippets/card-product.liquid');
  assert.equal((card.match(/unless settings\.ds_quote_mode -%}{% render 'price'/g) || []).length, 4);
  assert.equal((card.match(/if settings\.ds_quote_mode -%}\s*{%- elsif card_product\.available == false -%}/g) || []).length, 2);
  assert.match(card, /{% if settings\.ds_quote_mode %}\s*<div class="quick-add">\s*<a class="quick-add__submit button button--full-width button--secondary" href="{{ card_product\.url }}"[^>]*>\s*Ver y cotizar\s*<\/a>\s*<\/div>\s*{% elsif ds_closed == '1' %}\s*<p class="ds-pbatch__stock is-out">Tanda cerrada<\/p>/);
});

// ---------- A4 · ficha ----------
test('A4: la ficha oculta precio y cantidad y reemplaza buy-buttons en modo cotización', () => {
  const main = read('sections/main-product.liquid');
  assert.match(main, /when 'price' -%}\s*{%- if settings\.ds_quote_mode -%}[\s\S]*?{%- else -%}\s*<div id="price-{{ section\.id }}"/);
  assert.match(main, /when 'quantity_selector' -%}\s*{%- if settings\.ds_quote_mode -%}[\s\S]*?{%- else -%}\s*<div\s+id="Quantity-Form-{{ section\.id }}"/);
  assert.match(main, /when 'buy_buttons' -%}\s*{%- if settings\.ds_quote_mode -%}\s*{%- render 'ds-quote-buttons', block: block, product: product -%}\s*{%- else -%}\s*{%- render 'buy-buttons'/);
  assert.match(main, /when 'variant_picker'/);
  assert.match(main, /when 'ds_topping'/);
});

rendered('A4: ds-quote-buttons enlaza a la página con ?agregar= y a WhatsApp con solo dígitos', async () => {
  const product = {title: 'Pastel & café'};
  const html = await renderSnippet('ds-quote-buttons', {settings: quoteSettings, pages, product, block: {}});
  assert.match(html, /href="\/pages\/pasteles-personalizados\?agregar=Pastel(\+|%20)%26(\+|%20)caf%C3%A9"/);
  assert.match(html, /Agrégalo a tu cotización/);
  assert.match(html, /Lo anotamos en tu solicitud\. Dayana te envía el precio en la cotización, en menos de 12 horas\./);
  assert.match(html, /href="https:\/\/wa\.me\/13462348436\?text=Hola%2C(\+|%20)quiero(\+|%20)preguntar(\+|%20)por(\+|%20)Pastel(\+|%20)%26(\+|%20)caf%C3%A9"[^>]*target="_blank"[^>]*rel="noopener"/);
  assert.match(html, />Pregúntanos por WhatsApp</);
  const noWhatsapp = await renderSnippet('ds-quote-buttons', {settings: {ds_quote_mode: true}, pages, product, block: {}});
  assert.doesNotMatch(noWhatsapp, /wa\.me/);
  assert.match(noWhatsapp, /Agrégalo a tu cotización/);
  const noPage = await renderSnippet('ds-quote-buttons', {settings: quoteSettings, pages: {}, product, block: {}});
  assert.doesNotMatch(noPage, /Agrégalo a tu cotización|Lo anotamos/);
  assert.match(noPage, /wa\.me\/13462348436/);
});

// ---------- A5 · inicio ----------
async function renderHome(settings, blocks) {
  const source = read('sections/ds-redesign-home.liquid');
  const config = schemaOf(source);
  const context = {
    settings, pages, routes, form: {},
    section: {id: 'qa-home', settings: defaults(config.settings), blocks: blocks.map((block, index) => ({id: `b${index}`, type: 'category', settings: {...defaults(config.blocks[0].settings), ...block}}))},
  };
  const markup = withoutSchema(source).replace(/{%-?\s*form\s+'customer'[\s\S]*?-?%}/, '<form id="{{ newsletter_id }}" data-test-shopify-customer>').replace(/{%-?\s*endform\s*-?%}/, '</form>');
  return engine(context).parseAndRender(markup, context);
}
const homeBlocks = [
  {url: '/pages/pasteles-personalizados', title: 'Pasteles de cumpleaños', link_label: 'Cotiza tu pastel', fallback_image: 'pastel', image_alt: ''},
  {title: 'Salados', link_label: 'Ver salados', fallback_image: 'plain', image_alt: ''},
];

test('A5: el esquema del inicio trae los ajustes de cotización con sus valores por defecto', () => {
  const config = schemaOf(read('sections/ds-redesign-home.liquid'));
  const expected = {
    quote_title: 'Dulces cubanos para cada', quote_title_em: 'celebración.',
    quote_text: 'Pasteles de cumpleaños, postres y salados cubanos, hechos a mano en Fulshear.',
    quote_cta: 'Cotiza tus dulces', quote_secondary: 'Mira lo que preparamos', quote_note: 'Te enviamos tu cotización en menos de 12 horas.',
    steps_title: 'Así se cotiza',
    step_1: '<strong>Cuéntanos tu pastel</strong> y, si quieres, los postres o salados que quieras sumar.',
    step_2: '<strong>Dayana te envía la cotización</strong> en menos de 12 horas.',
    step_3: '<strong>Aceptas y reservas tu fecha.</strong> Recoges en Fulshear, TX.',
    quote_menu_text: 'Mira lo que preparamos y súmalo a la cotización de tu pastel.',
    contact_title: '¿Prefieres escribirnos?', contact_text: 'Respondemos en menos de 1 hora.',
    news_title: 'Novedades y ofertas', news_text: 'Sabores nuevos, fechas especiales y ofertas, directo a tu correo.',
    news_button: 'Suscribirme', news_note: 'Puedes darte de baja cuando quieras.', news_success: '¡Listo! Te escribiremos con novedades y ofertas.',
  };
  const actual = defaults(config.settings);
  for (const [id, value] of Object.entries(expected)) assert.equal(actual[id], value, id);
  for (const id of ['step_1', 'step_2', 'step_3']) assert.equal(config.settings.find(item => item.id === id).type, 'inline_richtext');
  const blockSettings = config.blocks[0].settings;
  assert.deepEqual(blockSettings.find(item => item.id === 'url'), {type: 'url', id: 'url', label: 'Enlace si no hay colección'});
  assert.deepEqual(blockSettings.find(item => item.id === 'fallback_image').options.map(option => option.value), ['cookies', 'brownies', 'pastel', 'plain']);
});

test('A5: index.json reemplaza galletas y brownies por pasteles, postres, salados y jugos', () => {
  const template = readShopifyJson('templates/index.json');
  const home = template.sections.redesign;
  assert.deepEqual(home.block_order, ['pasteles', 'postres', 'salados', 'jugos']);
  const pick = id => home.blocks[id].settings;
  assert.deepEqual(pick('pasteles'), {url: 'shopify://pages/pasteles-personalizados', title: 'Pasteles de cumpleaños', link_label: 'Cotiza tu pastel', image_alt: '', fallback_image: 'pastel'});
  assert.equal(pick('postres').collection, 'postres');
  assert.equal(pick('postres').link_label, 'Ver postres');
  assert.equal(pick('postres').fallback_image, 'plain');
  assert.equal(pick('salados').collection, 'salados');
  assert.equal(pick('salados').link_label, 'Ver salados');
  assert.equal(pick('jugos').collection, 'jugos-y-bebidas');
  assert.equal(pick('jugos').title, 'Jugos y bebidas');
  assert.equal(pick('jugos').link_label, 'Ver jugos y bebidas');
  assert.ok(!home.blocks.cookies && !home.blocks.brownies);
});

rendered('A5: el inicio en modo cotización muestra titular, pasos, menú, contacto y novedades sin precios ni tandas', async () => {
  const html = await renderHome(quoteSettings, homeBlocks);
  const text = clean(html);
  assert.match(html, /<h1[^>]*>Dulces cubanos para cada <em>celebración\.<\/em><\/h1>/);
  assert.match(text, /Pasteles de cumpleaños, postres y salados cubanos, hechos a mano en Fulshear\./);
  assert.match(html, /<a class="ds-r-button" href="\/pages\/pasteles-personalizados">Cotiza tus dulces<img/);
  assert.match(html, /<a class="ds-r-button ds-r-button--secondary" href="#menu">Mira lo que preparamos<\/a>/);
  assert.match(text, /Te enviamos tu cotización en menos de 12 horas\./);
  assert.doesNotMatch(html, /ds-r-hero--closed|ds-r-hero-notice|ds-r-batch|Ver todo el menú|ds-r-menu-all/);
  assert.match(html, /ds-r-hero--quote/);
  assert.match(html, /<h2[^>]*>Así se cotiza<\/h2>\s*<ol role="list">/);
  assert.equal((html.match(/ds-r-quote-step-num/g) || []).length, 3);
  assert.match(html, /<strong>Cuéntanos tu pastel<\/strong>/);
  assert.match(text, /Mira lo que preparamos y súmalo a la cotización de tu pastel\./);
  assert.doesNotMatch(text, /tanda|cerrado|agotado|\$\d/i);
  // Cuadrícula por bloques: el bloque con enlace siempre se ve; el que no tiene colección ni enlace se oculta.
  assert.match(html, /aria-label="Pasteles de cumpleaños"/);
  assert.match(html, /href="\/pages\/pasteles-personalizados" aria-label="Pasteles de cumpleaños"/);
  assert.match(html, /ds-r-cupcake\.png/);
  assert.doesNotMatch(html, /aria-label="Salados"/);
  assert.match(html, /ds-r-category-blocks/);
});

rendered('A5: contacto con WhatsApp e Instagram en pestaña nueva y número visible de 10 dígitos', async () => {
  const html = await renderHome(quoteSettings, homeBlocks);
  assert.match(html, /<h2[^>]*>¿Prefieres escribirnos\?<\/h2>/);
  assert.match(html, /<a class="ds-r-contact-link" href="https:\/\/wa\.me\/13462348436" target="_blank" rel="noopener">[\s\S]*?WhatsApp \(346\) 234-8436/);
  assert.match(html, /<a class="ds-r-contact-link" href="https:\/\/www\.instagram\.com\/dayanasweet02\/" target="_blank" rel="noopener">[\s\S]*?Instagram @dayanasweet02/);
  const none = await renderHome({ds_quote_mode: true}, homeBlocks);
  assert.doesNotMatch(none, /ds-r-contact-card|wa\.me|instagram/);
});

rendered('A5: Novedades y ofertas reutiliza el formulario customer con la etiqueta newsletter', async () => {
  const source = read('sections/ds-redesign-home.liquid');
  assert.equal((source.match(/{%-?\s*form\s+'customer'/g) || []).length, 1, 'un solo formulario customer');
  assert.match(source, /{%-?\s*form 'customer', id: newsletter_id, class: newsletter_class %}/);
  const html = await renderHome(quoteSettings, homeBlocks);
  assert.match(html, /<h2[^>]*>Novedades y ofertas<\/h2>/);
  assert.equal((html.match(/data-test-shopify-customer/g) || []).length, 1);
  assert.match(html, /<form id="ds-r-newsletter-qa-home"/);
  assert.match(html, /name="contact\[tags\]" value="newsletter"/);
  assert.match(html, /<label class="ds-r-news-label" for="ds-r-email">/);
  assert.match(html, /<button type="submit">Suscribirme<\/button>/);
  assert.match(clean(html), /Puedes darte de baja cuando quieras\./);
});

rendered('A5: sin modo cotización el inicio sigue igual (tanda cerrada y aviso)', async () => {
  const html = await renderHome({ds_batch_open: false}, homeBlocks);
  assert.match(html, /class="ds-r-hero ds-r-hero--closed"/);
  assert.match(html, /<span>Un pedacito<\/span><span>de Cuba en<\/span><em>Houston\.<\/em>/);
  assert.match(clean(html), /Que no se te pase/);
  assert.match(html, /Ver todo el menú/);
  assert.doesNotMatch(html, /Así se cotiza|ds-r-quote-steps|ds-r-news-card|ds-r-contact-card/);
});

// ---------- A6 · cuadrícula ----------
rendered('A6: use_blocks salta el modo automático; url sin colección siempre visible; hide_empty oculta lo vacío', async () => {
  const category = {title: 'Galletas', handle: 'galletas', url: '/collections/galletas', metafields: {dayana: {categoria: {value: true}, en_inicio: {value: true}, orden: {value: 1}}}, all_products_count: 1, products: [{available: true}]};
  const empty = {title: 'Postres', handle: 'postres', url: '/collections/postres', all_products_count: 0, products: []};
  const jugos = {title: 'Jugos', handle: 'jugos', url: '/collections/jugos', all_products_count: 2, products: [{available: true}], image: {id: 'jugos-img', alt: ''}};
  const collections = [category, empty, jugos];
  for (const item of collections) collections[item.handle] = item;
  const blocks = [
    {type: 'category', settings: {url: '/pages/pasteles-personalizados', title: 'Pasteles', link_label: 'Cotiza', fallback_image: 'pastel'}},
    {type: 'category', settings: {collection: empty, title: 'Postres', link_label: 'Ver postres', fallback_image: 'plain'}},
    {type: 'category', settings: {title: 'Salados', link_label: 'Ver salados', fallback_image: 'plain'}},
    {type: 'category', settings: {collection: jugos, title: 'Jugos', link_label: 'Ver jugos', fallback_image: 'plain'}},
  ];
  const context = {collections, blocks, hide_empty: true, home_only: true, use_blocks: true, heading_id: 'h', paginate: {pages: 1}, routes};
  const html = await renderSnippet('ds-category-grid', context);
  const names = [...html.matchAll(/<a[^>]+aria-label="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(names, ['Pasteles', 'Jugos']);
  assert.match(html, /href="\/pages\/pasteles-personalizados"/);
  assert.match(html, /\/images\/jugos-img/);
  assert.match(html, /ds-r-pastel/);
  assert.match(html, /ds-r-cupcake\.png/);
  const automatic = await renderSnippet('ds-category-grid', {...context, use_blocks: false});
  assert.deepEqual([...automatic.matchAll(/<a[^>]+aria-label="([^"]+)"/g)].map(match => match[1]), ['Galletas']);
});

test('A6: la fuente de la cuadrícula define use_blocks, url y las fotos de respaldo pastel y plain', () => {
  const grid = read('snippets/ds-category-grid.liquid');
  assert.match(grid, /use_blocks == true/);
  assert.match(grid, /block\.settings\.image \| default: category\.image/);
  assert.match(grid, /fallback_image == 'pastel'/);
  assert.match(grid, /fallback_image == 'plain'/);
  assert.match(grid, /ds-r-cupcake\.png/);
  assert.match(read('assets/ds-redesign.css'), /\.ds-r-category-blocks \.ds-r-category\.ds-r-pastel,\.ds-r-category-blocks \.ds-r-category\.ds-r-plain\{background:var\(--blush\)\}/);
});

// ---------- A7 · cabecera ----------
async function renderHeader(settings) {
  const source = read('sections/ds-redesign-header.liquid');
  const config = schemaOf(source);
  const context = {routes, settings, pages, cart: {item_count: 3}, shop: {name: "Dayana's Sweet", customer_accounts_enabled: true}, section: {id: 'qa-header', settings: defaults(config.settings)}};
  return engine(context).parseAndRender(withoutSchema(source), context);
}

rendered('A7: la cabecera muestra «Cotiza tus dulces» y WhatsApp en lugar de «Cómo pedir» y el carrito', async () => {
  const html = await renderHeader(quoteSettings);
  const nav = html.match(/<nav class="ds-r-desktop-nav"[\s\S]*?<\/nav>/)[0];
  assert.match(nav, /href="\/#menu"[^>]*>Menú<\/a>\s*<a href="\/pages\/pasteles-personalizados">Cotiza tus dulces<\/a>/);
  assert.match(nav, /data-ds-r-open="about"[^>]*>Conócenos/);
  assert.match(nav, /href="\/pages\/contact">Contacto<\/a>/);
  assert.doesNotMatch(nav, /Cómo pedir|data-ds-r-open="how"/);
  assert.doesNotMatch(html, /cart-icon-bubble/);
  assert.match(html, /<a class="ds-r-icon-button ds-r-wa-button" href="https:\/\/wa\.me\/13462348436" target="_blank" rel="noopener" aria-label="Escríbenos por WhatsApp">/);
  const withoutWhatsapp = await renderHeader({ds_quote_mode: true});
  assert.doesNotMatch(withoutWhatsapp, /wa\.me|cart-icon-bubble|ds-r-wa-button/);
  const tandas = await renderHeader({});
  assert.match(tandas, /id="cart-icon-bubble"/);
  assert.match(tandas, /data-ds-r-open="how"[^>]*>Cómo pedir/);
  assert.doesNotMatch(tandas, /wa\.me|Cotiza tus dulces/);
});

rendered('A7: «Conócenos» usa el texto de la opción A, en párrafos, en ambos modos', async () => {
  for (const settings of [quoteSettings, {}]) {
    const html = await renderHeader(settings);
    const about = html.match(/<dialog id="DS-R-About"[\s\S]*?<\/dialog>/)[0];
    assert.match(about, /<p>Pastelera cubana\. Empecé de joven en Cuba, inventando dulces con lo poco que había a mano\.<\/p>\s*<p>Cuando la vida nos trajo a Estados Unidos[\s\S]*?me abrió las puertas\.<\/p>\s*<p>Hoy son mis clientes y mis amigos, y me tienen presente en cada celebración\.<\/p>/);
    assert.equal((about.match(/<p>/g) || []).length, 3);
  }
  const header = read('sections/ds-redesign-header.liquid');
  assert.doesNotMatch(header, /Sabores que te llevan a casa/);
  for (const file of ['sections/header-group.json']) assert.doesNotMatch(read(file), /about_body/);
});

test('A7: el ícono de WhatsApp mide 44 px y el CSS respeta movimiento reducido y foco', () => {
  const css = read('assets/ds-redesign.css');
  assert.match(css, /\.ds-r-icon-button\{width:44px;height:44px/);
  assert.match(css, /\.ds-r-site-header \.ds-r-wa-button\{/);
  assert.match(css, /\.ds-quote-buttons a:focus-visible\{outline:3px solid var\(--ink\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.ds-quote-buttons \.ds-r-button/);
  const added = css.slice(css.indexOf('/* Venta por cotización'));
  assert.doesNotMatch(added, /font-weight:\s*(700|800|900)/);
  assert.doesNotMatch(added, /#(?:d03a67|b02c55|fbe3ec|9c7a88|e5c8d4|3a2430)\b/i, 'solo tokens del tema, no los hex de la maqueta');
});

// Hallazgo P1 de la revisión Codex: /cart y el drawer no muestran importes en modo cotización.
rendered('A2b: carrito y drawer sin precios ni total en modo cotización; con tandas siguen igual', async () => {
  const money = value => '$' + (Number(value || 0) / 100).toFixed(2);
  const product = {id: 12, title: 'Brownie', url: '/products/brownie', price: 1200, available: true, has_only_default_variant: true};
  const item = {index: 1, key: 'key', product, url: product.url, quantity: 2, original_price: 1200, final_price: 1200, original_line_price: 2400, final_line_price: 2400,
    variant: {id: 7, price: 1200, quantity_rule: {min: 1, increment: 1, max: null}, quantity_price_breaks: [{minimum_quantity: 5, price: 1000}]}, line_level_discount_allocations: [], properties: []};
  const cart = {items: [item], item_count: 2, total_price: 2400, cart_level_discount_applications: [{title: 'Promo', total_allocated_amount: 300}], currency: {iso_code: 'USD'}};
  for (const quote of [true, false]) {
    const context = {settings: {...quoteSettings, ds_quote_mode: quote, ds_batch_open: !quote, cart_type: 'drawer'}, cart, pages, routes, request: {}, shop: {policies: []},
      section: {id: 'cart', settings: {}, blocks: [{type: 'subtotal', settings: {}}, {type: 'buttons', settings: {}}]}};
    const liquid = engine(context);
    liquid.registerFilter('money', money); liquid.registerFilter('money_with_currency', money);
    for (const path of ['sections/main-cart-items.liquid', 'sections/main-cart-footer.liquid', 'snippets/cart-drawer.liquid']) {
      const source = withoutSchema(read(path)).replace(/{%-?\s*style\s*-?%}/g, '<style>').replace(/{%-?\s*endstyle\s*-?%}/g, '</style>');
      const text = clean((await liquid.parseAndRender(source, context)).replace(/<style[\s\S]*?<\/style>/g, ''));
      if (quote) assert.doesNotMatch(text, /\$\d+\.\d{2}/, `${path}: sin importes en modo cotización`);
      else assert.match(text, /\$24\.00/, `${path}: con tandas, el importe sigue visible`);
    }
  }
});
// Verificación Codex: el bloque de cantidad de featured-product tampoco muestra precio por unidad ni por volumen.
test('A2c: featured-product protege precio, precio por unidad y volumen en modo cotización', () => {
  const source = read('sections/featured-product.liquid');
  assert.match(source, /{%- unless settings\.ds_quote_mode -%}\s*{%- render 'price',/);
  assert.equal(source.match(/{%- if product\.quantity_price_breaks_configured\? and settings\.ds_quote_mode != true -%}/g)?.length, 3);
  assert.doesNotMatch(source, /{%- if product\.quantity_price_breaks_configured\? -%}/);
});