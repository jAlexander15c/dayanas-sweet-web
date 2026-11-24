// Fase 2 de diseño: renderiza el Liquid real de la categoría vacía (D05), la solicitud de pastel (D21)
// y las fotos de respaldo (D22). Shopify se sustituye solo en sus etiquetas y filtros propios.
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
const withoutSchema = source => source.replace(/{%-?\s*schema\s*-?%}[\s\S]*?{%-?\s*endschema\s*-?%}/, '');

function engine(options = {}) {
  const liquid = new Liquid({ root: resolve('snippets'), extname: '.liquid', ...options });
  registerPaginate(liquid);
  registerImageTag(liquid);
  liquid.registerFilter('asset_url', name => `/cdn/shop/t/1/assets/${name}?v=1`);
  liquid.registerFilter('stylesheet_tag', () => '');
  liquid.registerFilter('standard_event_data', () => '{}');
  liquid.registerFilter('t', key => key);
  return liquid;
}

// ---------- D05 · categoría vacía ----------
async function renderGrid(collection, paginate = { pages: 1, current_page: 1 }) {
  const markup = withoutSchema(read('sections/main-collection-product-grid.liquid'))
    .replace(/{%-?\s*style\s*-?%}[\s\S]*?{%-?\s*endstyle\s*-?%}/, '')
    .replace(/{%-?\s*render\s+'([\w-]+)'[\s\S]*?-?%}/g, '<div data-test-render="$1"></div>');
  return engine().parseAndRender(markup, {
    collection: { id: 1, url: `/collections/${collection.handle}`, filters: [], products: [], products_count: 0, all_products_count: 0, ...collection },
    section: { id: 'grid', settings: { enable_filtering: true, enable_sorting: true, filter_type: 'horizontal', products_per_page: 16, columns_mobile: '2', columns_desktop: 4, image_shape: 'default', quick_add: 'none', padding_top: 36, padding_bottom: 36, color_scheme: 'scheme-1' } },
    settings: { animations_reveal_on_scroll: false },
    routes: { all_products_collection_url: '/collections/all', root_url: '/' },
    paginate,
  });
}
const facets = html => html.includes('data-test-render="facets"');

rendered('D05: categoría sin productos ni filtros: explica, ofrece dos salidas y oculta la barra de filtros', async () => {
  const html = await renderGrid({ title: 'Galletas', handle: 'galletas' });
  assert.match(html, /class="ds-collection-empty"/);
  assert.match(html, /Por ahora no hay galletas en el menú/);
  assert.match(html, /<a class="ds-collection-empty__primary" href="\/collections\/all">Ver todo el menú<\/a>/);
  assert.match(html, /<a class="ds-collection-empty__secondary" href="\/#ds-r-email" data-ds-r-signup>Dejar mi correo<\/a>/);
  assert.equal(facets(html), false);
  assert.doesNotMatch(html, /sections\.collection_template\.empty/);
  assert.match(html, /id="product-grid"/, 'facets.js sigue encontrando el contenedor de la grilla');
});

rendered('D05: filtros sin resultados conservan el mensaje de Shopify y la barra para quitarlos', async () => {
  for (const filters of [[{ active_values: [{}], type: 'list' }], [{ active_values: [], type: 'price_range', min_value: { value: 5 }, max_value: { value: null } }]]) {
    const html = await renderGrid({ title: 'Galletas', handle: 'galletas', filters });
    assert.match(html, /sections\.collection_template\.empty/);
    assert.match(html, /sections\.collection_template\.use_fewer_filters_html/);
    assert.equal(facets(html), true);
    assert.doesNotMatch(html, /ds-collection-empty/);
  }
});

rendered('D05: con productos no cambia nada; en /collections/all no se ofrece volver al mismo menú; el nombre se escapa', async () => {
  const full = await renderGrid({ title: 'Galletas', handle: 'galletas', products: [{ id: 7 }], products_count: 1, all_products_count: 1 });
  assert.equal(facets(full), true);
  assert.doesNotMatch(full, /ds-collection-empty/);
  assert.match(full, /data-test-render="ds-product-card"/);
  const all = await renderGrid({ title: 'Productos', handle: 'all' });
  assert.doesNotMatch(all, /Ver todo el menú/);
  assert.match(all, /Dejar mi correo/);
  assert.match(await renderGrid({ title: 'Café & <Té>', handle: 'cafe' }), /no hay café &amp; &lt;té&gt; en el menú/);
});

rendered('D05: una página fuera de rango de una colección con productos no es una categoría vacía', async () => {
  // Shopify responde 200 con la página vacía en /collections/all?page=99 (revisión Codex task_5f8f3350608f).
  const page99 = await renderGrid({ title: 'Productos', handle: 'all', products: [], products_count: 6, all_products_count: 6 }, { pages: 1, current_page: 99 });
  assert.doesNotMatch(page99, /ds-collection-empty/);
  assert.equal(facets(page99), true);
  assert.match(page99, /sections\.collection_template\.empty/);
  assert.match(page99, /<a class="underlined-link link" href="\/collections\/all">Volver a la primera página<\/a>/);
  // Página 1 vacía con total positivo (p. ej. productos ocultos): mensaje de Shopify, sin enlace a sí misma.
  const firstPage = await renderGrid({ title: 'Brownies', handle: 'brownies', products: [], products_count: 0, all_products_count: 1 });
  assert.doesNotMatch(firstPage, /ds-collection-empty|Volver a la primera página/);
  assert.equal(facets(firstPage), true);
});

// ---------- D21 · solicitud visible desde el HTML ----------
async function renderRequest({ serviceEnabled = true, guestEnabled = true, customer = null } = {}) {
  const source = read('sections/ds-celebracion-solicitud.liquid');
  const schema = JSON.parse(source.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  const settings = Object.fromEntries(schema.settings.filter(s => s.id).map(s => [s.id, s.default ?? '']));
  return engine().parseAndRender(withoutSchema(source), {
    section: { id: 'req', settings: { ...settings, service_enabled: serviceEnabled, guest_enabled: guestEnabled } },
    customer, routes: { storefront_login_url: '/account/login', root_url: '/' }, request: { path: '/pages/pasteles-personalizados' },
  });
}
const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Primera etiqueta con ese atributo (o atributo="valor"); el atributo debe terminar ahí, no ser prefijo de otro.
const tag = (html, attr) => html.match(new RegExp(`<[^>]*\\s${escapeRe(attr)}(?![\\w-])[^>]*>`))?.[0] || '';

rendered('D21: con el servicio activo el primer paso llega visible y el aviso de carga oculto; sin JS queda la nota', async () => {
  for (const options of [{ guestEnabled: true }, { guestEnabled: false, customer: { id: 9, name: 'Ana', email: 'ana@example.test' } }]) {
    const html = await renderRequest(options);
    assert.doesNotMatch(tag(html, 'data-live'), /\bhidden\b/);
    // inert va en los controles, no en [data-live]: un ancestro inert sacaría el aviso del árbol de accesibilidad
    // (verificación Codex task_388520546568).
    assert.doesNotMatch(tag(html, 'data-live'), /\binert\b/);
    const untilMount = [...html.matchAll(/<(\w+)[^>]*\binert data-until-mount\b[^>]*>/g)].map(m => m[0].match(/class="([^"]+)"|data-step="(\d)"/).slice(1).find(Boolean));
    assert.deepEqual(untilMount, ['ds-request__steps', '0', 'ds-request__button', 'ds-request__aside'], 'pasos, paso 1, botón y resumen, inertes hasta montar');
    const beforeNote = html.slice(html.indexOf('<div data-live'), html.indexOf('data-pending-note'));
    const opened = [...beforeNote.matchAll(/<(\w+)\b[^>]*\binert\b[^>]*>/g)].filter(m => (beforeNote.slice(m.index).match(new RegExp(`</${m[1]}>`, 'g')) || []).length < (beforeNote.slice(m.index).match(new RegExp(`<${m[1]}\\b`, 'g')) || []).length);
    assert.equal(opened.length, 0, 'el aviso no puede quedar dentro de un elemento inert');
    assert.match(html, /<p class="ds-request__muted ds-request__pending" data-pending-note role="status">Cargando el formulario…<\/p>/);
    assert.match(html, /<script src="[^"]*ds-celebracion-solicitud\.js[^"]*" defer="defer" onerror="window\.dsRequestLoadFailed\(\)"><\/script>/);
    assert.match(html, /setTimeout\(window\.dsRequestLoadFailed, 15000\)/);
    assert.match(html, /querySelectorAll\('\[data-ds-request\] \[data-pending-note\]:not\(\[hidden\]\)'\)/);
    assert.match(tag(html, 'data-gate'), /\bhidden\b/);
    assert.doesNotMatch(tag(html, 'data-step="0"'), /\bhidden\b/);
    assert.match(tag(html, 'data-step="1"'), /\bhidden\b/);
    assert.match(html, /<noscript><p class="ds-request__muted">Necesitas JavaScript[^<]*<\/p><style>\.ds-request \[data-live\]\{display:none!important\}<\/style><\/noscript>/);
  }
});

rendered('D21: servicio apagado o visitante sin permiso: el aviso sigue visible y el formulario oculto', async () => {
  const off = await renderRequest({ serviceEnabled: false });
  assert.doesNotMatch(tag(off, 'data-gate'), /\bhidden\b/);
  assert.match(tag(off, 'data-live'), /\bhidden\b/);
  const login = await renderRequest({ guestEnabled: false });
  assert.doesNotMatch(tag(login, 'data-gate'), /\bhidden\b/);
  assert.match(login, /Iniciar sesión/);
  assert.doesNotMatch(login, /<div data-live/);
});

test('D21: si el servicio no se puede crear, el JS vuelve a mostrar el aviso y oculta el formulario', () => {
  const js = read('assets/ds-celebracion-solicitud.js');
  assert.match(js, /catch \(_\) \{ const gate = q\('\[data-gate\]'\); gate\.textContent = messages\.UNAVAILABLE; gate\.hidden = false; q\('\[data-live\]'\)\.hidden = true; return; \}/);
  assert.match(js, /q\('\[data-js-note\]'\)\?\.setAttribute\('hidden', ''\);/);
  assert.match(js, /q\('\[data-live\]'\)\.hidden = false;\s*qa\('\[data-until-mount\]'\)\.forEach\(el => \{ el\.removeAttribute\('inert'\); el\.removeAttribute\('data-until-mount'\); \}\);\s*q\('\[data-pending-note\]'\)\?\.setAttribute\('hidden', ''\);/);
});

test('D21: el primer piso y el resumen del HTML coinciden con los valores por defecto del JS', () => {
  const js = read('assets/ds-celebracion-solicitud.js');
  const liquid = read('sections/ds-celebracion-solicitud.liquid');
  assert.match(js, /const selection = \{ diameter: 8, tiers: \[\{ sponges: \['Vainilla', 'Chocolate'\], fillings: \['Guayaba', 'Nutella'\] \}\], coating: 'Buttercream', decorations: \[\]/,
    'si cambian los valores por defecto del JS, actualiza también el primer piso y el resumen del HTML');
  assert.match(js, /const area = q\('\[data-flavors\]'\); area\.replaceChildren\(\);/);
  assert.match(js, /function summarize\(target\) \{\s*target\.replaceChildren\(\);/);
  const flavors = liquid.match(/<div data-flavors>([\s\S]*?)<\/div>\s*<label>Cobertura/)[1];
  assert.deepEqual([...flavors.matchAll(/<label>([^<]+)<select><option selected>([^<]+)<\/option><\/select><\/label>/g)].map(m => `${m[1]}=${m[2]}`), ['Bizcocho 1=Vainilla', 'Bizcocho 2=Chocolate', 'Relleno 1=Guayaba', 'Relleno 2=Nutella']);
  assert.match(flavors, /<legend>Sabores · Piso 1<\/legend><div class="ds-request__two">/);
  assert.match(liquid, /<dl class="ds-request__summary" data-summary><div><dt>Pastel redondo<\/dt><dd>1 piso · 8″<\/dd><\/div><div><dt>Piso 1<\/dt><dd>Vainilla \+ Chocolate · Guayaba \+ Nutella<\/dd><\/div><div><dt>Cobertura<\/dt><dd>Buttercream<\/dd><\/div><div><dt>Decoraciones<\/dt><dd>Sin selección<\/dd><\/div><\/dl>/);
});

// ---------- D22 · fotos de respaldo con tamaños del CDN ----------
const candidates = img => (img.match(/srcset="([^"]+)"/)?.[1] || '').split(', ').map(entry => entry.split(' '));

rendered('D22: el hero de respaldo ofrece tamaños del CDN y sizes medidos, sin perder prioridad', async () => {
  const source = read('sections/ds-redesign-home.liquid');
  const config = JSON.parse(source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)[1]);
  const defaults = Object.fromEntries(config.settings.filter(s => s.id && 'default' in s).map(s => [s.id, s.default]));
  const html = await engine({ globals: { settings: {}, form: {}, routes: { all_products_collection_url: '/collections/all' } } }).parseAndRender(withoutSchema(source).replace(/{%-?\s*form\s+'customer'[\s\S]*?-?%}/, '<form>').replace(/{%-?\s*endform\s*-?%}/, '</form>'), {
    settings: {}, form: {}, routes: { all_products_collection_url: '/collections/all' }, pages: {},
    section: { id: 'home', settings: { ...defaults, hero_image: null }, blocks: config.presets[0].blocks.map((block, i) => ({ id: `b${i}`, ...block, settings: block.settings || {} })) },
  });
  const img = tag(html, 'class="ds-r-hero-photo"');
  assert.deepEqual(candidates(img).map(([, w]) => w), ['600w', '900w', '1200w', '1500w', '1983w']);
  assert.ok(candidates(img).every(([url, w]) => w === '1983w' ? url === '/cdn/shop/t/1/assets/ds-r-hero.png?v=1' : url === `/cdn/shop/t/1/assets/ds-r-hero.png?v=1&amp;width=${parseInt(w)}`));
  assert.match(img, /sizes="\(max-width: 600px\) 600px, \(max-width: 1279px\) 1180px, 100vw"/);
  assert.match(img, /loading="eager" fetchpriority="high"/);
});

rendered('D22: las fotos de respaldo de Galletas y Brownies usan srcset; las de admin no cambian', async () => {
  const category = (title, extra = {}) => ({ title, handle: title.toLowerCase(), url: `/collections/${title.toLowerCase()}`, metafields: { dayana: { categoria: { value: true }, en_inicio: { value: true }, orden: { value: 1 } } }, all_products_count: 1, products: [{ available: true }], ...extra });
  const categories = [category('Galletas'), category('Brownies'), category('Conservas', { image: { id: 5, alt: '', width: 800, height: 800 } })];
  const collections = [...categories];
  for (const c of categories) collections[c.handle] = c;
  const liquid = engine();
  liquid.registerFilter('image_url', image => `/images/${image.id}.jpg`);
  const html = await liquid.parseAndRender(read('snippets/ds-category-grid.liquid'), { collections, blocks: [], heading_id: 'h', home_only: true, routes: { all_products_collection_url: '/collections/all' } });
  const imgs = [...html.matchAll(/<img[^>]*ds-r-category-photo[^>]*>/g)].map(m => m[0]);
  assert.equal(imgs.length, 3);
  for (const asset of ['ds-r-cookies-category.png', 'ds-r-brownie-category.png']) {
    const img = imgs.find(i => i.includes(asset));
    assert.deepEqual(candidates(img).map(([, w]) => w), ['500w', '700w', '1000w', '1400w', '1511w']);
    assert.match(img, /sizes="\(max-width: 430px\) 470px, \(max-width: 600px\) 570px, \(max-width: 989px\) 500px, 680px"/);
    assert.match(img, /loading="lazy"/);
  }
  assert.ok(imgs.some(i => i.includes('/images/5.jpg') && i.includes('sizes="(min-width: 990px) 50vw, (min-width: 601px) 50vw, 100vw"')));
});

// ---------- D04 y D01 · reglas de estilo ----------
test('D04: cuatro categorías en 2×2 solo en escritorio; móvil y tablet conservan sus columnas', () => {
  const css = read('assets/ds-categories.css');
  const four = css.indexOf('[data-category-count="4"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }');
  assert.ok(four > 0);
  assert.ok(four < css.indexOf('@media (max-width: 989px)'), 'las reglas de tablet y móvil van después y ganan');
});

test('D01: letra de apoyo a 14–16 px en aviso, boletín y pie (todas las variantes)', () => {
  const css = read('assets/ds-redesign.css');
  const sizes = sel => [...css.matchAll(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*?font-size:([\\d.]+)px', 'g'))].map(m => Number(m[1]));
  assert.deepEqual(sizes('.ds-r-batch-copy p'), [15, 15, 15]);
  assert.deepEqual(sizes('.ds-r-email-row input'), [16, 16, 16]);
  assert.deepEqual(sizes('.ds-r-email-row button'), [15, 15, 15]);
  assert.deepEqual(sizes('.ds-r-footer'), [14, 14]);
});
