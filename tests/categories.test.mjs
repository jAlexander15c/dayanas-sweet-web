import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const source = readFileSync('snippets/ds-category-grid.liquid', 'utf8');
const css = readFileSync('assets/ds-categories.css', 'utf8');
const home = readFileSync('sections/ds-redesign-home.liquid', 'utf8');
const listing = readFileSync('sections/main-list-collections.liquid', 'utf8');
let Liquid;
try { ({ Liquid } = await import('liquidjs')); }
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
  assert.match(source, /categoria\.value == true and category\.metafields\.ds\.en_inicio\.value == true/);
  assert.match(source, /sort_natural: 'title'/);
  assert.match(source, /metafields\.ds\.orden\.value/);
  assert.match(source, /category_keys \| split: '\|' \| sort/);
  assert.match(source, /if configured[\s\S]*else[\s\S]*for block in blocks/);
  assert.match(source, /<ul[^>]*role="list"[^>]*aria-labelledby=/);
  for (const item of source.matchAll(/<li\b[\s\S]*?<\/li>/g)) {
    assert.equal((item[0].match(/<a\b/g) || []).length, 1);
    assert.match(item[0], /aria-label="{{ category(?:\.title|_title) \| escape }}"/);
  }
  assert.doesNotMatch(source, /ds-r-(cookies|brownie)-category\.png/);
});

test('responsive rules, keyboard focus, reduced motion and opaque text contrast', () => {
  for (const pattern of [/repeat\(3, minmax\(0, 1fr\)\)/, /data-category-count="1"/, /data-category-count="2"/, /max-width: 989px/, /max-width: 600px/, /focus-visible/, /prefers-reduced-motion/, /min-height: 44px/, /overflow-wrap: anywhere/]) assert.match(css, pattern);
  const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  const luminance = [0x3a, 0x24, 0x30].map(v => linear(v / 255)).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  assert.ok(1.05 / (luminance + .05) >= 4.5);
  assert.match(css, /background: #3a2430;\s*color: #fff/);
});

// LiquidJS does not implement Shopify's paginate/image_url/t tags. Keep the
// actual template loops and filters; replace only the Shopify pagination wrapper
// with a single-page fixture. Real Shopify pagination needs a storefront preview.
async function render(categories = [], options = {}) {
  const engine = new Liquid();
  engine.registerFilter('image_url', image => `/images/${image.id}.jpg`);
  engine.registerFilter('t', (_key, ...args) => `${args.find(arg => Array.isArray(arg) && arg[0] === 'count')?.[1]} productos`);
  const collections = [...categories];
  for (const category of categories) collections[category.handle] = category;
  const singlePage = source.replace(/{%- paginate collections by 250 -%}/, '').replace(/{%- endpaginate -%}/, '');
  return engine.parseAndRender(singlePage, {
    collections, paginate: { pages: 1 }, blocks: [], heading_id: 'category-heading',
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

rendered('fallback only without metadata, never when all configured categories are hidden', async () => {
  const blocks = [{ type: 'category', settings: { title: 'Manual' } }];
  assert.deepEqual(names(await render([], { blocks })), ['Manual']);
  assert.deepEqual(names(await render([category('Hidden', 1, { metafields: { ds: { categoria: { value: true }, en_inicio: { value: false } } } })], { blocks })), []);
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
  assert.doesNotMatch(await render([category('Brownies', 1)]), /ds-category-count|<img/);
  assert.match(await render([category('Brownies', 1, { image: { id: 1, alt: 'Brownies' } })]), /alt=""/);
});

for (const count of [1, 2, 3, 5, 12]) {
  rendered(`renders all ${count} categories without a hard-coded limit`, async () => {
    const html = await render(Array.from({ length: count }, (_, index) => category(`Categoría ${index + 1}`, index + 1)));
    assert.equal(names(html).length, count);
    assert.match(html, new RegExp(`data-category-count="${count}"`));
  });
}
