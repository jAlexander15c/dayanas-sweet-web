// Fase 1 de la revisión del panel: comprueba que R01, R02, R04 y R09 quedaron corregidos. Worker/DO locales; Shopify y Resend sintéticos.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { staffEnv, signedProxy, password } from './staff-helpers.mjs';
import { jwt } from './helpers.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const worker = await unstable_dev('test/portal-runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 38763, inspectorPort: 0, vars: staffEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } });
let browser;
try {
  browser = await chromium.launch({ ...(process.env.UI_BUNDLED_CHROMIUM ? {} : { channel: 'chrome' }), headless: true });
  const origin = `http://${worker.address}:${worker.port}`, evidence = resolve(process.env.PORTAL_UI_EVIDENCE_DIR || '../../docs/inventario/evidence'), errors = [];
  await mkdir(evidence, { recursive: true });
  async function newPage() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    context.setDefaultTimeout(15000); const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.href === 'https://cdn.shopify.com/shopifycloud/app-bridge.js') return route.fulfill({ contentType: 'text/javascript', body: `window.shopify={idToken:async()=>${JSON.stringify(jwt({ exp: Math.floor(Date.now() / 1000) + 600 }))}};` });
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/apps/inventario')) return route.continue();
      const path = '/proxy' + url.pathname.slice('/apps/inventario'.length) + url.search;
      if (path.startsWith('/proxy/api/')) {
        assert.equal(request.method(), 'POST'); assert.equal(request.headers()['content-type'], 'application/json'); assert.equal(request.headers().authorization, undefined);
      }
      const response = await worker.fetch(signedProxy(path), { method: request.method(), headers: { 'Content-Type': request.headers()['content-type'] || 'application/json' }, ...(request.postData() ? { body: request.postData() } : {}) });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    return page;
  }
  async function screenshots(page, name) {
    for (const [label, width, height] of [['mobile', 390, 844], ['desktop', 1440, 1000]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' fits viewport');
      const small = await page.locator('button:visible').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().height < 44).map(n => n.textContent));
      assert.deepEqual(small, [], '44px targets');
      await page.screenshot({ path: resolve(evidence, `portal-${name}-${label}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  const embedded = await newPage(); await embedded.goto(origin); await embedded.getByRole('button', { name: 'Agregar producción', exact: true }).waitFor();
  await embedded.getByRole('button', { name: 'Usuarios', exact: true }).click(); await embedded.getByText('Invitar al primer administrador').waitFor();
  await screenshots(embedded, 'primer-usuario');
  await embedded.getByLabel('Nombre', { exact: true }).fill('Dayana de prueba'); await embedded.getByLabel('Usuario', { exact: true }).fill('dayana'); await embedded.getByLabel('Correo', { exact: true }).fill('dayana@example.test');
  await embedded.getByRole('button', { name: 'Enviar invitación', exact: true }).click(); await embedded.getByText('Invitación enviada. Vence en 48 horas.', { exact: true }).waitFor();
  const emails = () => worker.fetch('/__test/emails').then(r => r.json());
  const invitation = new URL((await emails())[0].text.match(/https:\/\/\S+/)[0]).hash;
  const portal = await newPage(); await portal.goto(`${origin}/apps/inventario${invitation}`); await portal.getByLabel('Usuario', { exact: true }).waitFor();
  await portal.waitForFunction(() => document.querySelector('[name=username]').value === 'dayana');
  assert.equal(new URL(portal.url()).hash, '');
  assert.equal(await portal.locator('meta[http-equiv="Content-Security-Policy"]').count(), 1);
  assert.equal(await portal.locator('script[src*="app-bridge"]').count(), 0);
  await screenshots(portal, 'invitacion');
  await portal.getByLabel('Contraseña', { exact: true }).fill(password); await portal.getByLabel('Repite la contraseña', { exact: true }).fill(password);
  await portal.getByRole('button', { name: 'Crear contraseña y entrar', exact: true }).click();
  await portal.getByText('Conecta el acceso externo desde Shopify.', { exact: true }).waitFor();
  await embedded.getByRole('button', { name: 'Conectar acceso externo', exact: true }).click(); await embedded.getByText('Acceso externo conectado a Shopify.', { exact: true }).waitFor();
  await portal.getByRole('button', { name: 'Productos', exact: true }).click(); await portal.getByRole('button', { name: 'Agregar producción', exact: true }).waitFor();
  await screenshots(portal, 'panel');
  // R01: guardado correcto + recarga fallida no deja el conteo anterior como vigente.
  await portal.route('**/apps/inventario/api/inventory/products', route => route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: 'Fallo de recarga de prueba' } }));
  await portal.getByRole('button', { name: 'Agregar producción', exact: true }).click();
  await portal.getByLabel('¿Cuántas cajas preparaste?').fill('6');
  await portal.getByRole('button', { name: 'Revisar cambio' }).click();
  await portal.getByRole('button', { name: 'Confirmar y guardar' }).click();
  await portal.locator('#feedback').filter({ hasText: 'No pudimos actualizar la lista' }).waitFor();
  assert.match(await portal.locator('#feedback').textContent(), /Guardado en Shopify/);
  assert.equal(await portal.locator('.stock-number').count(), 0, 'no queda un conteo antiguo a la vista');
  await portal.locator('.stale-list').waitFor();
  await screenshots(portal, 'fase1-r01-lista-desactualizada');
  await portal.unroute('**/apps/inventario/api/inventory/products');
  await portal.getByRole('button', { name: 'Buscar', exact: true }).click();
  await portal.waitForFunction(() => document.querySelector('.stock-number')?.textContent === '10');
  // R09: el filtro secundario tiene un área táctil de 44 px.
  assert.ok(await portal.locator('label.filter').evaluate(n => n.getBoundingClientRect().height) >= 44);
  // R02: sesión caducada con la confirmación abierta -> ninguna capa encima del acceso y foco en el usuario.
  await portal.getByRole('button', { name: 'Agregar producción', exact: true }).click();
  await portal.getByLabel('¿Cuántas cajas preparaste?').fill('1');
  await portal.getByRole('button', { name: 'Revisar cambio' }).click();
  await portal.route('**/apps/inventario/api/inventory/operations', route => route.fulfill({ status: 401, json: { code: 'SESSION_REQUIRED', message: 'Entra otra vez para continuar.' } }));
  await portal.getByRole('button', { name: 'Confirmar y guardar' }).click();
  await portal.getByRole('heading', { name: 'Entrar al panel' }).waitFor();
  assert.equal(await portal.locator('dialog[open]').count(), 0);
  assert.equal(await portal.evaluate(() => document.activeElement?.getAttribute('name')), 'username');
  await screenshots(portal, 'fase1-r02-acceso-sin-capas');
  await portal.unroute('**/apps/inventario/api/inventory/operations');
  // R04: una entrada colgada se corta con aviso y el botón vuelve a estar disponible.
  let release;
  await portal.route('**/apps/inventario/api/login', async route => { await new Promise(r => { release = r; }); await route.abort().catch(() => {}); });
  await portal.getByLabel('Usuario', { exact: true }).fill('dayana');
  await portal.getByLabel('Contraseña', { exact: true }).fill(password);
  await portal.getByRole('button', { name: 'Entrar', exact: true }).click();
  await portal.getByText('La conexión tardó demasiado', { exact: false }).waitFor({ timeout: 40000 });
  assert.equal(await portal.getByRole('button', { name: 'Entrar', exact: true }).isDisabled(), false);
  await screenshots(portal, 'fase1-r04-plazo');
  release?.();
  assert.deepEqual(errors, []);
  console.log('PASS fase1-ui-check: R01 lista desactualizada sin conteo antiguo, R02 sin capas y foco, R04 plazo de 30 s, R09 44 px; 390/1440.');
} finally { await browser?.close(); await worker.stop(); }
