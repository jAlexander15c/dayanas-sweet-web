import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';

const qaRequire = createRequire(resolve(process.env.DS_QA_ROOT || '.', 'orders-test-runtime.cjs'));
const {Liquid} = qaRequire('liquidjs');

const base = {shop:{name:'Dayana’s Sweet'}, request:{page_type:'index', origin:'https://dayanassweet.com', locale:{iso_code:'es'}}, routes:{root_url:'/'}, settings:{}};
const engine = globals => {
  const liquid = new Liquid({root:resolve('snippets'), extname:'.liquid', globals});
  liquid.registerFilter('asset_url', name => `//cdn.shopify.com/assets/${name}`);
  liquid.registerFilter('image_url', () => '//cdn.shopify.com/logo.png');
  return liquid;
};
const blocks = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
const renderBrand = globals => engine(globals).parseAndRender("{% render 'ds-structured-data' %}", globals);

test('portada publica Organization y WebSite enlazados, sin sameAs vacío', async () => {
  const [organization, website] = blocks(await renderBrand(base));
  assert.equal(organization['@type'], 'Organization');
  assert.equal(organization.url, 'https://dayanassweet.com/');
  assert.match(organization.logo, /^https:\/\//);
  assert.equal('sameAs' in organization, false);
  assert.equal(website['@type'], 'WebSite');
  assert.equal(website.publisher['@id'], organization['@id']);
});

test('sameAs solo incluye redes configuradas', async () => {
  const [organization] = blocks(await renderBrand({...base, settings:{social_instagram_link:'https://instagram.com/dayanas', social_facebook_link:''}}));
  assert.deepEqual(organization.sameAs, ['https://instagram.com/dayanas']);
});

test('fuera de la portada no se repite la entidad de marca', async () => {
  assert.deepEqual(blocks(await renderBrand({...base, request:{...base.request, page_type:'collection'}})), []);
});

test('BreadcrumbList coincide con las migas visibles y escapa el título', async () => {
  const source = readFileSync('sections/ds-collection-hero.liquid', 'utf8').replace(/{%\s*schema[\s\S]*$/, '').replace(/{%-?\s*render[^%]*%}/g, '');
  const html = await engine({}).parseAndRender(source, {...base, collection:{handle:'brownies', title:'Brownies "de" casa'}, section:{id:'qa', settings:{}}, canonical_url:'https://dayanassweet.com/collections/brownies'});
  const crumbs = blocks(html).find(block => block['@type'] === 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map(item => item.name), ['Inicio', 'Brownies "de" casa']);
  assert.equal(crumbs.itemListElement[1].item, 'https://dayanassweet.com/collections/brownies');
  assert.match(html, /aria-current="page">Brownies (&quot;|&#34;)de(&quot;|&#34;) casa</);
});

test('el seguimiento de pasteles lleva noindex y las demás páginas no', () => {
  const layout = readFileSync('layout/theme.liquid', 'utf8');
  assert.match(layout, /template\.suffix == 'celebracion-seguimiento'[\s\S]{0,80}<meta name="robots" content="noindex">/);
  assert.equal((layout.match(/name="robots"/g) || []).length, 1);
});
