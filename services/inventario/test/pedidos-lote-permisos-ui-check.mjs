// Lote «Todos los retiros están listos» mientras Dayana guarda sus propios permisos (verificación Codex P2):
// la misma persona con la misma sesión renueva sus datos a mitad del lote; el lote termina y la hoja se puede cerrar.
// Uso: node test/pedidos-lote-permisos-ui-check.mjs <ruta a playwright>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { staffEnv, signedProxy, password } from './staff-helpers.mjs';
import { jwt } from './helpers.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const worker = await unstable_dev('test/pedidos-runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 38775, inspectorPort: 0, vars: staffEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } });
const storageKey = 'dayanas.inventario.session';
const results = [], check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
let browser;
try {
  browser = await chromium.launch({ ...(process.env.UI_BUNDLED_CHROMIUM ? {} : { channel: 'chrome' }), headless: true });
  const origin = `http://${worker.address}:${worker.port}`, evidence = resolve('../../docs/inventario/evidence'), errors = [];
  await mkdir(evidence, { recursive: true });
  const api = async (path, body) => { const response = await worker.fetch(signedProxy('/proxy/api/' + path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const emails = () => worker.fetch('/__test/emails').then(r => r.json());
  async function newPage(session) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    context.setDefaultTimeout(15000);
    if (session) await context.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [storageKey, JSON.stringify({ session, expiresAt: Date.now() + 3600000 })]);
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.href === 'https://cdn.shopify.com/shopifycloud/app-bridge.js') return route.fulfill({ contentType: 'text/javascript', body: `window.shopify={idToken:async()=>${JSON.stringify(jwt({ exp: Math.floor(Date.now() / 1000) + 600 }))}};` });
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/apps/inventario')) return route.continue();
      const path = '/proxy' + url.pathname.slice('/apps/inventario'.length) + url.search;
      const response = await worker.fetch(signedProxy(path), { method: request.method(), headers: { 'Content-Type': request.headers()['content-type'] || 'application/json' }, ...(request.postData() ? { body: request.postData() } : {}) });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    return page;
  }
  async function screenshots(page, name) {
    for (const [label, width, height] of [['mobile', 390, 844], ['desktop', 1440, 1000]]) {
      await page.setViewportSize({ width, height });
      const l = await page.evaluate(() => {
        const visible = n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
        return { overflowX: document.documentElement.scrollWidth - innerWidth,
          small: [...document.querySelectorAll('#pedidos-view button, #pedidos-view a, dialog[open] button')].filter(visible).filter(n => n.getBoundingClientRect().height < 43.5).map(n => n.textContent.trim() || n.getAttribute('aria-label')) };
      });
      check(`${name} ${width}px: sin desborde y táctiles ≥44`, l.overflowX <= 0 && !l.small.length, JSON.stringify(l));
      await page.screenshot({ path: resolve(evidence, `pedidos-rapido-${name}-${label}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  const card = (page, name) => page.locator('.order-card', { hasText: name });
  const sheet = page => page.locator('#order-sheet');

  // Administradora (llave maestra en Shopify) y acceso externo conectado.
  const embedded = await newPage(); await embedded.goto(origin); await embedded.getByRole('button', { name: 'Usuarios', exact: true }).click();
  await embedded.getByLabel('Nombre', { exact: true }).fill('Dayana'); await embedded.getByLabel('Usuario', { exact: true }).fill('dayana'); await embedded.getByLabel('Correo', { exact: true }).fill('dayana@example.test');
  await embedded.getByRole('button', { name: 'Enviar invitación', exact: true }).click(); await embedded.getByText('Invitación enviada. Vence en 48 horas.', { exact: true }).waitFor();
  await embedded.getByRole('button', { name: 'Conectar acceso externo', exact: true }).click(); await embedded.getByText('Acceso externo conectado a Shopify.', { exact: true }).waitFor();
  const token = mail => new URL(mail.text.match(/https:\/\/\S+/)[0]).hash.slice('#invitacion='.length);
  const admin = await api('accept-invitation', { token: token((await emails()).at(-1)), password });
  assert.equal(admin.status, 200);

  const page = await newPage(admin.body.session);
  // Se retienen la respuesta de «Guardar permisos» y la del primer «listo» (#1043).
  let enteredUpdate, releaseUpdate, enteredReady, releaseReady;
  const updateHeld = new Promise(resolve => { enteredUpdate = resolve; }), updateGate = new Promise(resolve => { releaseUpdate = resolve; });
  const readyHeld = new Promise(resolve => { enteredReady = resolve; }), readyGate = new Promise(resolve => { releaseReady = resolve; });
  const hold = (path, entered, gate) => page.route(`**/apps/inventario/api/${path}`, async route => {
    const response = await worker.fetch(signedProxy(`/proxy/api/${path}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: route.request().postData() });
    const data = Buffer.from(await response.arrayBuffer()); entered(); await gate;
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: data });
  });
  await hold('update-user', enteredUpdate, updateGate);
  await hold('pedidos/orders/1043/ready', enteredReady, readyGate);
  await page.goto(`${origin}/apps/inventario#pedidos`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#bulk-ready').waitFor();
  await page.locator('#users').click();
  const ownCard = page.locator('.user-card').filter({ has: page.getByRole('heading', { name: 'Dayana', exact: true }) });
  await ownCard.getByRole('button', { name: 'Editar permisos' }).click();
  await page.locator('.user-card input[value="celebraciones"]').check();
  await page.evaluate(() => { window.__antes = window.inventarioPortal.user(); });
  await page.getByRole('button', { name: 'Guardar permisos' }).click();
  await updateHeld;
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('button', { name: 'Todos los retiros están listos (2)' }).click();
  await sheet(page).getByRole('button', { name: 'Marcar 2 listos' }).click();
  await readyHeld;
  releaseUpdate();
  await page.waitForFunction(() => window.inventarioPortal.user() !== window.__antes);
  releaseReady();
  await sheet(page).getByRole('button', { name: 'Cerrar' }).waitFor();
  const states = Object.fromEntries(await sheet(page).locator('[data-bulk]').evaluateAll(rows => rows.map(row => [row.dataset.bulk, row.querySelector('[data-bulk-state]').textContent])));
  check('misma persona renovada: el lote termina (#1043 y #1044 listos)', states['1043'] === 'Listo' && states['1044'] === 'Listo', JSON.stringify(states));
  const ready = (await worker.fetch('/__test/pedidos').then(r => r.json())).forwarded.filter(input => input.path.endsWith('/ready'));
  check('un envío por pedido, sin repetir', ready.length === 2 && new Set(ready.map(input => input.path)).size === 2, JSON.stringify(ready.map(input => input.path)));
  check('«Cerrar» habilitado', await sheet(page).getByRole('button', { name: 'Cerrar' }).isEnabled());
  await sheet(page).getByRole('button', { name: 'Cerrar' }).click();
  // Guardar permisos vuelve a Usuarios al terminar (comportamiento previo a esta rama); el resultado se mira en Pedidos.
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('button', { name: 'Listos · 3', exact: true }).waitFor();
  check('la hoja se cierra y Pedidos muestra los 2 en Listos', !(await sheet(page).evaluate(dialog => dialog.open)) && await page.getByRole('button', { name: 'Listos · 3', exact: true }).isVisible() && await card(page, '#1044').isHidden());
  check('sin errores de JavaScript', !errors.length, errors.join(' | '));
} finally { await browser?.close(); await worker.stop(); }
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`);
assert.ok(results.every(r => r.ok), 'pedidos-lote-permisos-ui-check con fallos');
console.log(`pedidos-lote-permisos-ui-check: ${results.length}/${results.length} PASS`);
