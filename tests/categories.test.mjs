import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {registerPaginate, registerImageTag} from './helpers/shopify-liquid.mjs';

const source = readFileSync('snippets/ds-category-grid.liquid', 'utf8');
const css = readFileSync('assets/ds-categories.css', 'utf8');
const home = readFileSync('sections/ds-redesign-home.liquid', 'utf8');
const listing = readFileSync('sections/main-list-collections.liquid', 'utf8');
test('changed theme files are UTF-8 without BOM, replacement characters or damaged accents', () => {
  const files = ['assets/ds-categories.css', 'docs/categorias.md', 'locales/es.default.json', 'locales/en.default.json',
    'sections/ds-redesign-home.liquid', 'sections/main-list-collections.liquid', 'snippets/ds-category-grid.liquid',
    'templates/list-collections.json', 'tests/categories.test.mjs', 'tests/redesign-home.test.mjs', 'tests/helpers/shopify-liquid.mjs'];
  for (const file of files) {
    const bytes = readFileSync(file);
    const content = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    assert.notEqual(bytes.subarray(0, 3).toString('hex'), 'efbbbf', file);
    assert.doesNotMatch(content, /[a-z]\?[a-z]|\uFFFD/i, file);
  }
});
let Liquid;
try { ({ Liquid } = createRequire(resolve(process.env.DS_QA_ROOT || '.', 'category-runtime.cjs'))('liquidjs')); }
catch {
  try { ({ Liquid } = createRequire(join(tmpdir(), 'ds-category-liquid-tests', 'package.json'))('liquidjs')); }
  catch { /* Static checks still run without installing a runtime dependency. */ }
}

test('both sections use the shared grid and provide editor controls and 12 fallback blocks', () => {
  for (const section of [home, listing]) {
    assert.match(section, /render 'ds-category-grid'/);
    assert.match(section, /ds-categories\.css/);
    const schema = JSON.parse(section.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
    assert.equal(schema.max_blocks, 12);
    assert.equal(schema.blocks[0].limit, 12);
    for (const id of ['hide_empty', 'show_count']) {
      assert.equal(schema.settings.find(setting => setting.id === id).default, false);
    }
  }
});

test('Liquid statically enforces metafields, ordering, pagination and named single-link list items', () => {
  assert.match(source, /paginate collections by 250/);
  assert.match(source, /if home_only and category\.metafields\.ds\.en_inicio\.value != true/);
  assert.match(source, /sort_natural: 'title'/);
  assert.match(source, /metafields\.ds\.orden\.value/);
  assert.match(source, /category_keys \| split: '\|' \| sort/);
  assert.match(source, /elsif configured == false or home_only/);
  assert.match(source, /<ul[^>]*role="list"[^>]*aria-labelledby=/);
  for (const item of source.matchAll(/<li\b[\s\S]*?<\/li>/g)) {
    assert.equal((item[0].match(/<a\b/g) || []).length, 1);
    assert.match(item[0], /aria-label="{{ category(?:\.title|_title) \| escape }}"/);
  }
  assert.match(source, /ds-r-cookies-category\.png/);
  assert.match(source, /ds-r-brownie-category\.png/);
});

test('responsive rules, keyboard focus, reduced motion and gradient text contrast', () => {
  for (const pattern of [/repeat\(3, minmax\(0, 1fr\)\)/, /data-category-count="1"/, /data-category-count="2"/, /max-width: 989px/, /max-width: 600px/, /focus-visible/, /prefers-reduced-motion/, /min-height: 44px/, /overflow-wrap: anywhere/]) assert.match(css, pattern);
  const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  const luminance = linear(1 - .65);
  assert.ok(1.05 / (luminance + .05) >= 4.5);
  assert.match(css, /linear-gradient\(to bottom, transparent, rgb\(0 0 0 \/ 65%\) 70px\)/);
  assert.doesNotMatch(css, /background: #3a2430/);
  assert.doesNotMatch(css, /heading :is\(h1, h2\)/);
});

// Keep the actual template loops and filters; the shared Shopify paginate tag
// renders a single-page fixture. Real pagination needs a storefront preview.
async function render(categories = [], options = {}) {
  const engine = new Liquid();
  registerPaginate(engine);
  registerImageTag(engine);
  engine.registerFilter('image_url', image => `/images/${image.id}.jpg`);
  engine.registerFilter('asset_url', name => `/assets/${name}`);
  engine.registerFilter('t', (_key, ...args) => `${args.find(arg => Array.isArray(arg) && arg[0] === 'count')?.[1]} productos`);
  const collections = [...categories];
  for (const category of categories) collections[category.handle] = category;
  return engine.parseAndRender(source, {
    collections, paginate: { pages: 1 }, blocks: [], heading_id: 'category-heading',
    home_only: true,
    routes: { all_products_collection_url: '/collections/all' }, ...options,
  });
}
const category = (title, order, extra = {}) => ({
  title, handle: title.toLowerCase().replaceAll(' ', '-'), url: `/collections/${title.toLowerCase()}`,
  metafields: { ds: { categoria: { value: true }, en_inicio: { value: true }, orden: { value: order } } },
  all_products_count: 1, products: [{ available: true }], ...extra,
});
const rendered = (name, fn) => test(name, { skip: !Liquid && 'liquidjs unavailable; static checks only' }, fn);
const names = html => [...html.matchAll(/<a[^>]+aria-label="([^"]+)"/g)].map(match => match[1]);

rendered('filters categories and home visibility; numeric order then natural title, including 2 before 10', async () => {
  const html = await render([
    category('Galletas', 10), category('Enlatados', 2), category('Brownies', 2),
    category('Oculta', 1, { metafields: { ds: { categoria: { value: true }, en_inicio: { value: false } } } }),
    category('Promociones', 1, { metafields: { ds: { categoria: { value: false }, en_inicio: { value: true } } } }),
    category('Sin configurar', 1, { metafields: {} }),
  ]);
  assert.deepEqual(names(html), ['Brownies', 'Enlatados', 'Galletas']);
});

rendered('homepage falls back to manual blocks when configured categories are hidden', async () => {
  const blocks = [{ type: 'category', settings: { title: 'Manual' } }];
  assert.deepEqual(names(await render([], { blocks })), ['Manual']);
  assert.deepEqual(names(await render([category('Hidden', 1, { metafields: { ds: { categoria: { value: true }, en_inicio: { value: false } } } })], { blocks })), ['Manual']);
});

rendered('shows empty/sold-out categories by default and optionally hides unavailable products', async () => {
  const categories = [category('Disponible', 1), category('Agotada', 2, { products: [{ available: false }] }), category('Vacía', 3, { products: [] })];
  assert.equal(names(await render(categories)).length, 3);
  assert.deepEqual(names(await render(categories, { hide_empty: true })), ['Disponible']);
  assert.deepEqual(names(await render(categories.slice(1), { hide_empty: true, blocks: [{ type: 'category', settings: { title: 'Manual' } }] })), []);
});

rendered('semantic single-link cards, escaped name, actual image alt and optional count', async () => {
  const html = await render([category('Café & té', 1, { image: { id: 1, alt: 'Frascos artesanales', width: 800, height: 800 } })], { show_count: true });
  assert.match(html, /<ul[^>]+aria-labelledby="category-heading"/);
  assert.equal((html.match(/<li\b/g) || []).length, 1);
  assert.equal((html.match(/<a\b/g) || []).length, 1);
  assert.deepEqual(names(html), ['Café &amp; té']);
  assert.match(html, /alt="Frascos artesanales"/);
  assert.match(html, /1 productos/);
  assert.doesNotMatch(await render([category('Brownies', 1)]), /ds-r-category-count|class="ds-r-category-photo"/);
  assert.match(await render([category('Brownies', 1, { image: { id: 1, alt: 'Brownies' } })]), /alt=""/);
});

rendered('listing includes categories excluded from home and uses h2 headings with responsive images', async () => {
  const categories = [category('Solo menú', 1, {metafields: {ds: {categoria: {value: true}, en_inicio: {value: false}}}, image: {id: 'menu', alt: 'Foto'}})];
  assert.deepEqual(names(await render(categories)), []);
  const html = await render(categories, {home_only: false, heading_tag: 'h2'});
  assert.deepEqual(names(html), ['Solo menú']);
  assert.match(html, /<h2>Solo menú<\/h2>/);
  assert.match(html, /srcset="[^"]+400w[^"]+1600w"/);
  assert.match(html, /sizes="/);
  assert.match(html, /<span>Ver Solo menú<img/);
  assert.match(listing, /heading_tag: 'h2'/);
});

rendered('listing offers the full menu when configured categories are all unavailable', async () => {
  const html = await render([category('Vacía', 1, {products: []})], {home_only: false, hide_empty: true, blocks: [{type: 'category', settings: {title: 'Manual'}}]});
  assert.deepEqual(names(html), []);
  assert.doesNotMatch(html, /<ul/);
  assert.match(html, /href="\/collections\/all">Ver todo el menú<\/a>/);
});

rendered('manual cards preserve image overrides, fallback assets, positions and editable links', async () => {
  const blocks = [
    {type: 'category', settings: {title: 'Manual', collection: category('Real', 1, {image: {id: 'collection'}}), fallback_image: 'cookies', link_label: 'Explorar'}},
    {type: 'category', settings: {title: 'Propia', image: {id: 'custom', alt: 'Alt de imagen'}, image_alt: 'Alt del editor', fallback_image: 'brownies', link_label: 'Elegir'}},
  ];
  const html = await render([], {blocks});
  assert.match(html, /ds-r-category ds-r-cookies/);
  assert.match(html, /ds-r-cookies-category\.png/);
  assert.match(html, /\/images\/custom/);
  assert.match(html, /alt="Alt del editor"/);
  assert.doesNotMatch(html, /\/images\/collection|ds-r-brownie-category\.png/);
  assert.match(html, /<span>Explorar<img/);
  assert.match(html, /<span>Elegir<img/);
  assert.doesNotMatch(html, /ds-r-category-auto-grid|ds-r-category-auto"/);
  assert.match(await render([], {blocks: [{type: 'category', settings: {title: 'Brownies', fallback_image: 'brownies'}}]}), /ds-r-brownie-category\.png/);
});

rendered('negative order is clamped to zero and missing orders sort last', async () => {
  assert.deepEqual(names(await render([category('Positiva', 2), category('Negativa', -3), category('Cero', 0), category('Ausente', undefined)])), ['Cero', 'Negativa', 'Positiva', 'Ausente']);
});

for (const count of [1, 2, 3, 5, 12]) {
  rendered(`renders all ${count} categories without a hard-coded limit`, async () => {
    const html = await render(Array.from({ length: count }, (_, index) => category(`Categoría ${index + 1}`, index + 1)));
    assert.equal(names(html).length, count);
    assert.match(html, new RegExp(`data-category-count="${count}"`));
  });
}
