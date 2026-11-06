// Browser acceptance with the real local Worker/DO; all Shopify/Resend traffic is synthetic.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { staffEnv, signedProxy, password } from './staff-helpers.mjs';
import { jwt } from './helpers.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const worker = await unstable_dev('test/portal-runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 38762, inspectorPort: 0, vars: staffEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } });
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
  await portal.getByRole('button', { name: 'Usuarios', exact: true }).click(); await portal.getByText('Invitar a alguien').waitFor();
  await portal.getByLabel('Nombre', { exact: true }).fill('María de prueba'); await portal.getByLabel('Usuario', { exact: true }).fill('maria'); await portal.getByLabel('Correo', { exact: true }).fill('maria@example.test');
  await portal.getByRole('button', { name: 'Enviar invitación', exact: true }).click(); await portal.getByRole('heading', { name: 'María de prueba' }).waitFor();
  await screenshots(portal, 'usuarios');
  await portal.getByRole('button', { name: 'Salir', exact: true }).click(); await portal.getByRole('heading', { name: 'Entrar al panel' }).waitFor();
  assert.deepEqual(await portal.evaluate(() => [sessionStorage.getItem('dayanas.inventario.session'), localStorage.getItem('dayanas.inventario.session')]), [null, null]);
  await screenshots(portal, 'entrar');
  await portal.getByRole('button', { name: 'Olvidé mi contraseña', exact: true }).click(); await screenshots(portal, 'olvide');
  await portal.getByLabel('Usuario o correo').fill('dayana'); await portal.getByRole('button', { name: 'Enviar código', exact: true }).click(); await portal.getByRole('heading', { name: 'Revisa tu correo' }).waitFor();
  await screenshots(portal, 'codigo');
  const code = (await emails()).at(-1).text.match(/\b\d{6}\b/)[0];
  await portal.getByLabel('Número 1', { exact: true }).fill(code); await portal.getByLabel('Nueva contraseña', { exact: true }).fill(password + '2'); await portal.getByRole('button', { name: 'Guardar y entrar', exact: true }).click(); await portal.getByRole('button', { name: 'Agregar producción', exact: true }).waitFor();
  await portal.getByRole('button', { name: 'Cambiar contraseña', exact: true }).click(); await portal.getByLabel('Contraseña actual').fill(password + '2'); await portal.getByLabel('Nueva contraseña', { exact: true }).fill(password + '3'); await portal.getByRole('button', { name: 'Guardar contraseña', exact: true }).click(); await portal.getByRole('heading', { name: 'Entrar al panel' }).waitFor();
  await portal.getByLabel('Usuario', { exact: true }).fill('dayana'); await portal.getByLabel('Contraseña', { exact: true }).fill(password + '3'); await portal.getByRole('button', { name: 'Entrar', exact: true }).click(); await portal.getByRole('button', { name: 'Agregar producción', exact: true }).waitFor();
  await portal.reload(); await portal.getByRole('button', { name: 'Agregar producción', exact: true }).waitFor();
  // M7: a failed network revocation still forgets this device and remains signed out after reload.
  await portal.route('**/apps/inventario/api/logout', route => route.abort('internetdisconnected'));
  await portal.getByRole('button', { name: 'Salir', exact: true }).click();
  await portal.getByRole('heading', { name: 'Entrar al panel' }).waitFor();
  await portal.getByText('No pudimos confirmar el cierre en el servidor', { exact: false }).waitFor();
  assert.deepEqual(await portal.evaluate(() => [sessionStorage.getItem('dayanas.inventario.session'), localStorage.getItem('dayanas.inventario.session')]), [null, null]);
  await portal.reload(); await portal.getByRole('heading', { name: 'Entrar al panel' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS portal-ui-check: 7 pantallas × 390/1440 px, 44px, CSP, invitación, conexión offline, usuarios, salir (también sin red), recuperación, cambio de contraseña, login y recarga; 14 capturas.');
} finally { await browser?.close(); await worker.stop(); }
