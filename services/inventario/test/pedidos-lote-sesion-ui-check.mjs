// Lote «Todos los retiros están listos» y cambio de sesión (revisión Codex P1): si la sesión que confirmó el lote
// sale o caduca a mitad de camino y entra otra persona, los pedidos que faltaban no se envían con la sesión nueva.
// Uso: node test/pedidos-lote-sesion-ui-check.mjs <ruta a playwright>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { staffEnv, signedProxy, password } from './staff-helpers.mjs';
import { jwt } from './helpers.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const worker = await unstable_dev('test/pedidos-runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 38774, inspectorPort: 0, vars: staffEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } });
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

  // Otra persona con inventario («Rosa») que entra en la misma pestaña después.
  assert.equal((await api('invite', { session: admin.body.session, username: 'rosa', name: 'Rosa', email: 'rosa@example.test', roles: ['inventario'] })).status, 200);
  assert.equal((await api('accept-invitation', { token: token((await emails()).at(-1)), password })).status, 200);

  const page = await newPage(admin.body.session);
  // Se retiene la respuesta del primer «listo» (#1043) para cambiar de sesión mientras el lote espera.
  let entered, release;
  const held = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  await page.route('**/apps/inventario/api/pedidos/orders/1043/ready', async route => {
    const response = await worker.fetch(signedProxy('/proxy/api/pedidos/orders/1043/ready'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: route.request().postData() });
    const data = Buffer.from(await response.arrayBuffer()); entered(); await gate;
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: data });
  });
  await page.goto(`${origin}/apps/inventario#pedidos`);
  await page.getByRole('button', { name: 'Todos los retiros están listos (2)' }).click();
  await sheet(page).getByRole('button', { name: 'Marcar 2 listos' }).click();
  await held;
  // La sesión de Dayana se cierra en el servidor; la pestaña lo nota y muestra la entrada.
  assert.equal((await api('logout', { session: admin.body.session })).status, 200);
  await page.evaluate(() => window.inventarioPortal.request('session').catch(error => error.code));
  await page.getByRole('heading', { name: 'Entrar al panel' }).waitFor();
  check('la hoja del lote se cierra al perder la sesión', !(await sheet(page).evaluate(dialog => dialog.open)));
  await page.getByLabel('Usuario', { exact: true }).fill('rosa'); await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForFunction(() => window.inventarioPortal.user()?.name === 'Rosa');
  release();
  await page.waitForTimeout(1500);
  const ready = (await worker.fetch('/__test/pedidos').then(r => r.json())).forwarded.filter(input => input.path.endsWith('/ready'));
  check('solo #1043 se envió, con la sesión de Dayana; #1044 no se envía con la de Rosa', ready.length === 1 && ready[0].path.includes('1043') && ready[0].actor.name !== 'Rosa', JSON.stringify(ready.map(input => ({ path: input.path, actor: input.actor.name }))));
  check('Rosa ve su panel sin la hoja del lote', !(await sheet(page).evaluate(dialog => dialog.open)) && await page.locator('#panel-view').isVisible());
  check('sin errores de JavaScript', !errors.length, errors.join(' | '));
} finally { await browser?.close(); await worker.stop(); }
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`);
assert.ok(results.every(r => r.ok), 'pedidos-lote-sesion-ui-check con fallos');
console.log(`pedidos-lote-sesion-ui-check: ${results.length}/${results.length} PASS`);
