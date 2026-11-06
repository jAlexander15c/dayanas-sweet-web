// Local workerd + synthetic Shopify only. No real shop requests are permitted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { jwt } from './helpers.mjs';
import { testEnv } from './shopify-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const worker = await unstable_dev('test/runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 38763, inspectorPort: 0, vars: testEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } });
let browser;
try {
  await worker.fetch('/__test/tag-category-fixtures');
  browser = await chromium.launch({ ...(process.env.UI_BUNDLED_CHROMIUM ? {} : { channel: 'chrome' }), headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(15_000);
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  const asset = await readFile('../../assets/ds-r-brownie-category.png');
  const origin = `http://${worker.address}:${worker.port}`;
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url === 'https://cdn.shopify.com/shopifycloud/app-bridge.js') return route.fulfill({ contentType: 'text/javascript', body: `window.shopify={idToken:async()=>${JSON.stringify(jwt({ exp: Math.floor(Date.now() / 1000) + 600 }))}}` });
    if (url.startsWith('https://cdn.shopify.com/test/')) return route.fulfill({ contentType: 'image/png', body: asset });
    if (url.startsWith(origin)) return route.continue();
    external.push(url); return route.abort();
  });
  const evidence = resolve('../../docs/inventario/evidence'); await mkdir(evidence, { recursive: true });
  const capture = async (name, fullPage = true) => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: resolve(evidence, `${name}.png`), fullPage });
  };
  const calls = async () => (await (await worker.fetch('/__test/calls')).json()).filter(c => c.query.startsWith('mutation'));
  const adopt = async title => {
    await page.getByRole('button', { name: `Usar ${title} como categoría`, exact: true }).click();
    await page.locator('#category-editor').getByRole('heading', { name: title, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Revisar categoría', exact: true }).click();
  };
  const save = async () => {
    await page.getByRole('button', { name: 'Confirmar y guardar', exact: true }).click();
    await page.locator('#confirmation').waitFor({ state: 'hidden' });
    await page.locator('#feedback').filter({ hasText: 'Guardado en Shopify' }).waitFor();
  };
  await page.goto(origin);
  await page.getByRole('button', { name: 'Categorías', exact: true }).click();
  await page.locator('#collection-list').getByRole('heading', { name: 'Galletas', exact: true }).waitFor();
  assert.equal(await page.locator('#collection-list article').count(), 7);
  assert.equal(await page.locator('#collection-list').getByText(/Automática por etiqueta «.+»: se puede usar como categoría/).count(), 5);
  assert.equal(await page.locator('#collection-list').getByRole('button', { name: /^Usar .+ como categoría$/ }).count(), 6);
  const complex = page.locator('#collection-list article').filter({ hasText: 'Más vendidos' });
  assert.match(await complex.innerText(), /Automática: no se puede usar como categoría/);
  assert.equal(await complex.getByRole('button').count(), 0);
  assert.match(await page.locator('#collection-list article').filter({ hasText: 'Página de inicio' }).innerText(), /Sin foto/);
  assert.equal((await calls()).length, 0);
  await capture('tag-categories-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 }); await capture('tag-categories-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await adopt('Galletas');
  assert.match(await page.locator('#summary').innerText(), /Los productos entran a esta categoría con la etiqueta «galletas»/);
  await capture('tag-category-confirmation-mobile', false); await save();
  await adopt('Brownies'); await save();
  await adopt('Página de inicio');
  assert.match(await page.locator('#summary').innerText(), /Sin foto: en la portada se verá el nombre sobre color/);
  await save();
  await page.getByRole('button', { name: 'Productos', exact: true }).click();
  await page.locator('#products .category-name').filter({ hasText: 'Galletas' }).waitFor();
  await page.getByLabel('Ver productos sin categoría').check();
  await page.getByRole('heading', { name: 'No encontramos ese producto', exact: true }).waitFor();
  await page.getByLabel('Ver productos sin categoría').uncheck();
  await page.getByRole('button', { name: 'Editar producto', exact: true }).click();
  await page.getByLabel('Categoría', { exact: true }).selectOption({ label: 'Brownies' });
  await page.getByRole('button', { name: 'Revisar cambio', exact: true }).click();
  assert.match(await page.locator('#summary').innerText(), /etiqueta «brownies»/);
  assert.match(await page.locator('#summary').innerText(), /Se quitará la etiqueta «galletas»/);
  await save();
  assert.match(await page.locator('#feedback').innerText(), /Puede tardar unos segundos en aparecer en la categoría/);
  await page.locator('#products .category-name').filter({ hasText: 'Brownies' }).waitFor();
  await capture('tag-product-mobile');
  const ms = await calls();
  assert.deepEqual(ms.filter(m => m.query.includes('tagsAdd')).map(m => m.variables.tags), [['brownies']]);
  // Remove the exact stored tag (fixture uses uppercase), while matching categories case-insensitively.
  assert.deepEqual(ms.filter(m => m.query.includes('tagsRemove')).map(m => m.variables.tags), [['GALLETAS']]);
  assert.equal(ms.some(m => /collectionAddProducts|collectionRemoveProducts/.test(m.query)), false);
  for (const update of ms.filter(m => m.query.includes('collectionUpdate'))) assert.deepEqual(Object.keys(update.variables.input).sort(), ['id', 'metafields']);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('Etiquetas UI OK: 390×844 y 1440×1000; 5 automáticas por etiqueta + Más vendidos compleja sin botón + Página de inicio manual sin foto; adopción y resumen; producto categorizado por etiqueta y filtro; cambio Galletas→Brownies con tagsAdd/tagsRemove sin mutar pertenencias ni reglas; aviso asíncrono; 0 errores JS; 0 llamadas reales a Shopify.');
} finally { await browser?.close(); await worker.stop(); }
