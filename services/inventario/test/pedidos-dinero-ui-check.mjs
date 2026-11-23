// Errores de dinero de Pedidos (revisión Codex P01–P06) en Chrome real: contraseña corregible en la hoja (P03),
// cálculo de reembolso sin respuestas viejas (P05), aviso de la edición conservado (P04), stock solo de lo no
// despachado (P01), «Para hornear» parcial avisado (P02) y cancelación sin reembolso con salida a Shopify (P06).
// Uso: node test/pedidos-dinero-ui-check.mjs <ruta a playwright>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { staffEnv, signedProxy, password } from './staff-helpers.mjs';
import { jwt } from './helpers.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const worker = await unstable_dev('test/pedidos-runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 38776, inspectorPort: 0, vars: staffEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } });
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
      await page.screenshot({ path: resolve(evidence, `pedidos-dinero-${name}-${label}.png`), fullPage: true });
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
  const bodies = path => { const list = []; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(path)) { const sent = JSON.parse(request.postData() || '{}'); list.push(sent.body || sent); } }); return list; };
  const editPosts = bodies('/api/pedidos/orders/1042/edit'), refundPosts = bodies('/api/pedidos/orders/1042/refund');
  const shop = () => worker.fetch('/__test/pedidos').then(r => r.json());

  // P03 · Editar: contraseña equivocada → se corrige en la misma hoja, mismo cambio y misma clave.
  await page.goto(`${origin}/apps/inventario#pedidos/1042/editar`);
  await page.getByRole('heading', { name: 'Editar #1042' }).waitFor();
  check('editar: la pantalla ya no pide la contraseña', await page.locator('#pedidos-view input[type=password]').count() === 0);
  await page.locator('.edit-line', { hasText: 'Galletas surtidas' }).getByRole('button', { name: 'Quitar una' }).click();
  await page.getByRole('button', { name: 'Guardar cambios del pedido' }).click();
  await page.getByRole('heading', { name: 'Revisa el cambio del pedido' }).waitFor();
  await sheet(page).getByLabel('Tu contraseña').fill('contraseña-equivocada');
  await sheet(page).getByRole('button', { name: 'Guardar cambios del pedido' }).click();
  await page.locator('#sheet-error').filter({ hasText: /contraseña/i }).waitFor();
  check('editar: tras el error la hoja deja escribir la contraseña de nuevo', await sheet(page).getByLabel('Tu contraseña').isEditable() && await sheet(page).getByLabel('Tu contraseña').inputValue() === '');
  await screenshots(page, 'editar-contrasena');
  await sheet(page).getByLabel('Tu contraseña').fill(password);
  await sheet(page).getByRole('button', { name: 'Guardar cambios del pedido' }).click();
  await page.getByText('Pedido editado.', { exact: false }).waitFor();
  let state = await shop();
  check('editar: un solo cambio aplicado, con la misma clave en los dos intentos', state.forwarded.filter(input => input.path.endsWith('/edit')).length === 1 && editPosts.length === 2 && !!editPosts[0].operationId && editPosts[0].operationId === editPosts[1].operationId, JSON.stringify(editPosts.map(b => b.operationId)));

  // P05 · Reembolsar: una respuesta vieja del cálculo no habilita «Revisar» con opciones anteriores.
  let entered, release, holding = true;
  const held = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  await page.route('**/apps/inventario/api/pedidos/orders/1042/refund-preview', async route => {
    if (!holding) return route.fallback();
    holding = false;
    const response = await worker.fetch(signedProxy('/proxy/api/pedidos/orders/1042/refund-preview'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: route.request().postData() });
    const data = Buffer.from(await response.arrayBuffer()); entered(); await gate;
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: data });
  });
  await page.evaluate(() => { location.hash = 'pedidos/1042/reembolsar'; });
  await page.getByRole('heading', { name: 'Reembolsar #1042' }).waitFor();
  check('reembolsar: la pantalla ya no pide la contraseña', await page.locator('#pedidos-view input[type=password]').count() === 0);
  await page.getByLabel('Cantidad a devolver de Galletas surtidas').selectOption('1');
  await held;
  await page.getByLabel('Avisar a la clienta por correo').uncheck();
  release();
  await page.waitForTimeout(120);
  check('reembolsar: la respuesta vieja no habilita «Revisar»', await page.locator('#refund-review').isDisabled());
  await page.getByRole('button', { name: 'Revisar y reembolsar $24.00' }).waitFor();
  await page.getByRole('button', { name: 'Revisar y reembolsar $24.00' }).click();
  await page.getByRole('heading', { name: 'Revisa el reembolso' }).waitFor();
  check('reembolsar: la revisión refleja la elección actual (sin aviso)', !(await sheet(page).textContent()).includes('se avisa a la clienta'));

  // P03 · Reembolsar: contraseña equivocada, se corrige en la hoja; un solo reembolso, misma clave.
  await sheet(page).getByLabel('Tu contraseña').fill('otra-equivocada');
  await sheet(page).getByRole('button', { name: 'Reembolsar $24.00', exact: true }).click();
  await page.locator('#sheet-error').filter({ hasText: /contraseña/i }).waitFor();
  await sheet(page).getByLabel('Tu contraseña').fill(password);
  await sheet(page).getByRole('button', { name: 'Reembolsar $24.00', exact: true }).click();
  await page.getByText('Reembolso de $24.00 registrado.').waitFor();
  state = await shop();
  check('reembolsar: un solo reembolso en Shopify, misma clave, sin aviso a la clienta', state.calls.filter(c => c === 'PanelRefund').length === 1 && refundPosts.length === 2 && !!refundPosts[0].operationId && refundPosts[0].operationId === refundPosts[1].operationId && refundPosts[1].notify === false, JSON.stringify(refundPosts));
  // P04 · Editar: el aviso desmarcado sobrevive a los cambios y no se promete enlace de pago.
  const edit1043 = bodies('/api/pedidos/orders/1043/edit');
  await page.evaluate(() => { location.hash = 'pedidos/1043/editar'; });
  await page.getByRole('heading', { name: 'Editar #1043' }).waitFor();
  await page.getByLabel('Avisar a la clienta del cambio por correo').uncheck();
  await page.getByRole('button', { name: 'Agregar producto' }).click();
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.locator('.edit-line', { hasText: 'Agregada' }).getByRole('button', { name: 'Agregar una' }).click();
  check('editar: el aviso sigue desmarcado tras cambiar cantidades', !(await page.getByLabel('Avisar a la clienta del cambio por correo').isChecked()));
  const note = await page.locator('#edit-money').textContent();
  check('editar: sin aviso no promete enlace y dice cuánto queda por cobrar', /no recibirá enlace de pago/.test(note) && /Quedan \$\d+\.\d\d por cobrar/.test(note), note);
  await screenshots(page, 'editar-sin-aviso');
  await page.getByRole('button', { name: 'Guardar cambios del pedido' }).click();
  await page.getByRole('heading', { name: 'Revisa el cambio del pedido' }).waitFor();
  check('editar: la revisión dice que no se avisa', (await sheet(page).textContent()).includes('No se avisa a la clienta.'));
  await sheet(page).getByLabel('Tu contraseña').fill(password);
  await sheet(page).getByRole('button', { name: 'Guardar cambios del pedido' }).click();
  await page.getByText(/Pedido editado\. Quedan \$\d+\.\d\d por cobrar/).waitFor();
  check('editar: se envió sin aviso a la clienta', edit1043.length === 1 && edit1043[0].notify === false, JSON.stringify(edit1043));
  // P01 · Reembolsar un pedido despachado: la casilla explica que no vuelve al stock y el recibo no lo afirma.
  await page.evaluate(() => { location.hash = 'pedidos/1045/reembolsar'; });
  await page.getByRole('heading', { name: 'Reembolsar #1045' }).waitFor();
  check('reembolso despachado: cada producto dice que no vuelve al stock', (await page.locator('.refund-line').allTextContents()).every(text => text.includes('despachada: no vuelve al stock')));
  await page.getByLabel('Cantidad a devolver de Brownie Box').selectOption('1');
  await page.getByText('Lo elegido ya se despachó: no vuelve al stock.').waitFor();
  check('reembolso despachado: «Regresar al stock» desactivado', await page.locator('#refund-restock').isDisabled() && !(await page.locator('#refund-restock').isChecked()));
  await screenshots(page, 'reembolso-despachado');
  await page.getByRole('button', { name: /Revisar y reembolsar \$/ }).click();
  await page.getByRole('heading', { name: 'Revisa el reembolso' }).waitFor();
  check('reembolso despachado: la revisión no promete stock', !(await sheet(page).textContent()).includes('al stock'));
  await sheet(page).getByLabel('Tu contraseña').fill(password);
  await sheet(page).getByRole('button', { name: /^Reembolsar \$/ }).click();
  await page.getByText(/Reembolso de \$\d+\.\d\d registrado\./).waitFor();
  check('reembolso despachado: el historial no dice que regresó al stock', !(await page.locator('#pedidos-view').textContent()).includes('regresó al stock'));

  // P06 · Cancelar sin reembolsar: aviso en la hoja; en el detalle y en Historial, lo pagado sin devolver y el enlace a Shopify.
  await page.evaluate(() => { location.hash = 'pedidos/1046'; });
  await page.getByRole('heading', { name: 'Pedido #1046' }).waitFor();
  await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  await sheet(page).getByRole('heading', { name: 'Cancelar pedido' }).waitFor();
  check('cancelar: el aviso aparece solo al desmarcar el reembolso', await page.locator('#cancel-refund-note').isHidden());
  await sheet(page).locator('#cancel-refund').uncheck();
  check('cancelar: al desmarcar avisa que el dinero queda sin devolver', /pagados sin devolver/.test(await page.locator('#cancel-refund-note').textContent()) && await page.locator('#cancel-refund-note').isVisible());
  await screenshots(page, 'cancelar-sin-reembolso');
  await sheet(page).getByLabel('Tu contraseña').fill(password);
  await sheet(page).getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  const retry = sheet(page).getByRole('button', { name: 'Reintentar', exact: true });
  await Promise.race([page.getByText('Pedido cancelado.').waitFor(), retry.waitFor()]);
  if (await retry.isVisible()) { await retry.click(); await page.getByText('Pedido cancelado.').waitFor(); }
  await page.getByText(/pagados sin devolver\. El panel no reembolsa pedidos cancelados/).waitFor();
  const link = page.getByRole('link', { name: 'Reembolsar en Shopify' });
  check('cancelado: enlace al pedido en el admin de Shopify, en otra pestaña', /^https:\/\/admin\.shopify\.com\/store\/[^/]+\/orders\/1046$/.test(await link.getAttribute('href')) && await link.getAttribute('target') === '_blank');
  await screenshots(page, 'cancelado-sin-devolver');
  await page.evaluate(() => { location.hash = 'pedidos'; });
  await page.getByRole('button', { name: /^Historial/ }).click();
  await page.getByRole('button', { name: /^Cancelados/ }).click();
  check('Historial: el cancelado lleva «Sin devolver»', /Sin devolver \$\d+\.\d\d/.test(await card(page, '#1046').textContent()));

  check('sin errores de JavaScript', !errors.length, errors.join(' | '));
} finally { await browser?.close(); await worker.stop(); }
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`);
assert.ok(results.every(r => r.ok), 'pedidos-dinero-ui-check con fallos');
console.log(`pedidos-dinero-ui-check: ${results.length}/${results.length} PASS`);
