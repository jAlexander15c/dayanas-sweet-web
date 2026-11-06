// Pedidos (portal): lista, detalle y acciones a–g en el navegador contra un Worker local con la pasarela
// real de Celebraciones y un Shopify simulado. 390×844 y 1440×1000, táctiles ≥44 px, sin errores JS.
// Uso: NODE_PATH=<carpeta con playwright> node test/pedidos-ui-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { staffEnv, signedProxy, password } from './staff-helpers.mjs';
import { jwt } from './helpers.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const worker = await unstable_dev('test/pedidos-runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 38771, inspectorPort: 0, vars: staffEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } });
const storageKey = 'dayanas.inventario.session';
let browser;
try {
  browser = await chromium.launch({ ...(process.env.UI_BUNDLED_CHROMIUM ? {} : { channel: 'chrome' }), headless: true });
  const origin = `http://${worker.address}:${worker.port}`, evidence = resolve(process.env.PORTAL_UI_EVIDENCE_DIR || '../../docs/inventario/evidence'), errors = [];
  await mkdir(evidence, { recursive: true });
  const api = async (path, body) => { const response = await worker.fetch(signedProxy('/proxy/api/' + path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const state = () => worker.fetch('/__test/pedidos').then(r => r.json());
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
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} cabe en ${width}px`);
      const overflow = await page.evaluate(() => [...document.querySelectorAll('dialog[open], dialog[open] *, #pedidos-view, #pedidos-view *')].filter(n => n.getClientRects().length && n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'auto' && !['SELECT', 'INPUT', 'TEXTAREA'].includes(n.tagName)).map(n => n.className || n.tagName));
      assert.deepEqual(overflow, [], `${name}: nada se desborda en ${width}px`);
      const small = await page.locator('button:visible, #pedidos-view a:visible, dialog[open] a:visible').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().height < 44).map(n => n.textContent.trim() || n.getAttribute('aria-label')));
      assert.deepEqual(small, [], `${name}: táctiles de 44 px`);
      await page.screenshot({ path: resolve(evidence, `pedidos-${name}-${label}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  const sheetOpen = page => page.locator('#order-sheet').evaluate(d => d.open);

  // Primera administradora (llave maestra en Shopify) y acceso externo conectado.
  const embedded = await newPage(); await embedded.goto(origin); await embedded.getByRole('button', { name: 'Usuarios', exact: true }).click();
  await embedded.getByLabel('Nombre', { exact: true }).fill('Dayana'); await embedded.getByLabel('Usuario', { exact: true }).fill('dayana'); await embedded.getByLabel('Correo', { exact: true }).fill('dayana@example.test');
  await embedded.getByRole('button', { name: 'Enviar invitación', exact: true }).click(); await embedded.getByText('Invitación enviada. Vence en 48 horas.', { exact: true }).waitFor();
  await embedded.getByRole('button', { name: 'Conectar acceso externo', exact: true }).click(); await embedded.getByText('Acceso externo conectado a Shopify.', { exact: true }).waitFor();
  const token = mail => new URL(mail.text.match(/https:\/\/\S+/)[0]).hash.slice('#invitacion='.length);
  const admin = await api('accept-invitation', { token: token((await emails()).at(-1)), password });
  assert.equal(admin.status, 200);
  assert.ok(admin.body.user.roles.includes('admin'));
  async function member(username, roles) {
    assert.equal((await api('invite', { session: admin.body.session, username, name: username === 'cocina' ? 'Rosa' : 'Eventos', email: `${username}@example.test`, roles })).status, 200);
    const accepted = await api('accept-invitation', { token: token((await emails()).at(-1)), password });
    assert.equal(accepted.status, 200); return accepted.body.session;
  }
  const kitchenSession = await member('cocina', ['inventario']), eventsSession = await member('eventos', ['celebraciones']);

  // a) Lista: «Para hornear», filtros, búsqueda e insignias.
  const page = await newPage(admin.body.session);
  await page.goto(`${origin}/apps/inventario`);
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('heading', { name: 'Para hornear' }).waitFor();
  await page.getByText('Suma de los pedidos sin despachar ni retirar.').waitFor();
  await page.getByText('pedidos en total').waitFor();
  await page.getByRole('button', { name: 'Por preparar · 4' }).waitFor();
  await page.getByRole('button', { name: 'Listos · 1' }).waitFor();
  await page.getByRole('button', { name: 'Entregados · 0' }).waitFor();
  assert.equal(await page.getByLabel('Buscar pedido').getAttribute('placeholder'), 'Número, nombre o correo');
  const first = page.locator('.order-card', { hasText: '#1042 · Ana R.' });
  await first.getByText('Envío USPS', { exact: true }).waitFor(); await first.getByText('Pagado', { exact: true }).waitFor();
  const pickup = page.locator('.order-card', { hasText: '#1043 · Beatriz L.' });
  await pickup.getByText('Retiro en Fulshear').waitFor(); await pickup.getByText('Efectivo pendiente').waitFor();
  await page.getByRole('button', { name: 'Ver detalle por sabor y hoja de empaque' }).click();
  await page.getByRole('heading', { name: 'Hoja de empaque' }).waitFor();
  await screenshots(page, 'lista');
  await page.getByRole('button', { name: 'Listos · 1' }).click();
  await page.locator('.order-card', { hasText: '#1045' }).getByText('Envío USPS · gratis').waitFor();
  await page.getByLabel('Buscar pedido').fill('bea@example');
  await page.getByText('1 resultado en todos los pedidos.').waitFor();
  await page.getByLabel('Buscar pedido').fill('1043');
  await page.locator('.order-card', { hasText: '#1043' }).click();

  // b) Detalle: cliente, productos, saldo, historial y nota interna.
  await page.getByRole('heading', { name: 'Pedido #1043' }).waitFor();
  await page.getByRole('link', { name: 'Volver a pedidos' }).waitFor();
  await page.getByText('Saldo por cobrar').waitFor();
  await page.getByText('Pago: efectivo al retirar', { exact: false }).waitFor();
  await page.getByText('Cobrar, editar, reembolsar y cancelar: solo la administradora, con su contraseña.').waitFor();
  assert.equal(await page.getByLabel('Nota interna').getAttribute('placeholder'), 'Solo la ve el personal');
  await page.getByLabel('Nota interna').fill('Viene su hermana a recoger.');
  await page.getByRole('button', { name: 'Guardar nota' }).click(); await page.getByText('Nota guardada.').waitFor();
  await screenshots(page, 'detalle');

  // d) Cobré en efectivo: saldo de Shopify; respuesta perdida -> solo «Reintentar» con la misma clave.
  await page.getByRole('button', { name: 'Cobré en efectivo' }).click();
  await page.getByText('Saldo exacto que calcula Shopify. No se puede cambiar.').waitFor();
  await page.getByText('Se pide en cada cobro, reembolso, edición o cancelación.').waitFor();
  await page.getByLabel('Tu contraseña').fill('contraseña-equivocada');
  await page.getByRole('button', { name: 'Registrar $36.00' }).click();
  await page.getByText('Contraseña incorrecta.', { exact: false }).waitFor();
  assert.equal((await state()).moneyCalls, 0, 'contraseña equivocada: Shopify no se toca');
  const cashIds = [];
  page.on('request', r => { if (r.url().endsWith('/api/pedidos/orders/1043/cash')) cashIds.push(JSON.parse(r.postData()).body.operationId); });
  let firstStatus, release;
  await page.route('**/apps/inventario/api/pedidos/orders/1043/cash', async route => {
    const saved = await worker.fetch(signedProxy('/proxy/api/pedidos/orders/1043/cash'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: route.request().postData() });
    firstStatus = saved.status; await saved.arrayBuffer();
    await new Promise(r => { release = r; }); await route.abort().catch(() => {});
  });
  await page.getByLabel('Tu contraseña').fill(password);
  await page.getByRole('button', { name: 'Registrar $36.00' }).click();
  await page.getByText('No pudimos confirmar si se guardó', { exact: false }).waitFor({ timeout: 40000 });
  assert.equal(firstStatus, 200, 'el primer intento sí llegó a Shopify');
  assert.equal(await page.locator('#sheet-back').isHidden(), true, 'sin Volver');
  await page.keyboard.press('Escape'); assert.equal(await sheetOpen(page), true, 'Escape no descarta el intento');
  await screenshots(page, 'efectivo-sin-confirmar');
  await page.unroute('**/apps/inventario/api/pedidos/orders/1043/cash'); release?.();
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await page.getByText('Cobro registrado.').waitFor();
  assert.equal(cashIds.length, 2); assert.equal(cashIds[0], cashIds[1], 'misma clave al reintentar');
  let shop = await state();
  assert.equal(shop.calls.filter(c => c === 'PanelMarkAsPaid').length, 1); assert.equal(shop.moneyCalls, 1);
  assert.ok(shop.forwarded.every(input => !JSON.stringify(input).includes(password)), 'la contraseña nunca llega a Celebraciones');
  assert.ok(shop.forwarded.filter(input => input.path.endsWith('/cash')).every(input => input.actor.stepUp === true));
  await page.getByText('Cobró en efectivo $36.00 · Dayana', { exact: false }).waitFor();

  // c) Retiro en Fulshear: «Listo para retirar» y luego «Entregado».
  await page.getByRole('button', { name: 'Listo para retirar' }).click();
  await page.getByText('Shopify le avisa a la clienta que su pedido ya está listo en Fulshear. Al entregarlo, se marca «Entregado».').waitFor();
  await screenshots(page, 'listo-para-retirar');
  await page.getByRole('button', { name: 'Marcar listo para retirar' }).click(); await page.getByText('Pedido listo para retirar.').waitFor();

  // f) Editar: solo variantes con stock, resumen antes de guardar.
  await page.getByRole('button', { name: 'Editar pedido' }).click();
  await page.getByRole('heading', { name: 'Editar #1043' }).waitFor();
  await page.getByText('Cambia sabores o cantidades antes de preparar. Solo se ofrece lo que tiene stock en esta tanda.').waitFor();
  await page.locator('.edit-line', { hasText: 'Galletas de avena' }).getByRole('button', { name: 'Agregar una' }).click();
  await page.getByRole('button', { name: 'Agregar producto' }).click();
  assert.deepEqual(await page.locator('#add-variant option').allTextContents(), ['Galletas · Snickerdoodle — $12.00 (quedan 5)'], 'solo lo que tiene stock');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.getByText('Agregada · quedan 5 en stock').waitFor();
  await page.getByRole('heading', { name: 'Resumen del cambio' }).waitFor();
  await page.getByText('+ 1 Galletas de avena · Caja de 6').waitFor();
  await page.getByText('Si el total sube, Shopify le envía a la clienta un enlace para pagar la diferencia. Si baja, el panel ofrece el reembolso de la diferencia.').waitFor();
  await page.getByLabel('Tu contraseña').fill(password);
  await screenshots(page, 'editar');
  await page.getByRole('button', { name: 'Guardar cambios del pedido' }).click();
  await page.getByRole('heading', { name: 'Revisa el cambio del pedido' }).waitFor();
  await page.locator('#order-sheet').getByRole('button', { name: 'Guardar cambios del pedido' }).click();
  await page.getByText('Pedido editado.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Entregado', exact: true }).click();
  await page.getByRole('button', { name: 'Marcar entregado' }).click(); await page.getByText('Pedido entregado.').waitFor();

  // Celebraciones: ver, anotar y retiro sí; dinero no.
  await page.evaluate(() => { location.hash = 'pedidos/1044'; });
  await page.getByRole('heading', { name: 'Pedido #1044' }).waitFor();
  await page.getByText('Este pedido se cobra desde Celebraciones').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Cobré en efectivo' }).count(), 0);
  const forcedCash = await page.evaluate(() => window.inventarioPortal.request('pedidos/orders/1044/cash', { password: 'x', body: { operationId: crypto.randomUUID(), expectedAmountCents: 15000 } }).catch(e => e.status));
  assert.equal(forcedCash, 401);

  // c) Despachar: primero sin permisos de Shopify (aviso claro), luego con número de seguimiento.
  await page.evaluate(() => { location.hash = 'pedidos/1042'; });
  await page.getByRole('heading', { name: 'Pedido #1042' }).waitFor();
  await worker.fetch('/__test/pedidos-next?op=PanelFulfillmentOrders&mode=denied');
  await page.getByRole('button', { name: 'Marcar despachado' }).click();
  await page.getByText('Pedido #1042 · Envío USPS').waitFor();
  await page.getByLabel('Número de seguimiento').fill('9400 1000 0000 0000 0000 00');
  await page.getByText('Lo envía Shopify con su plantilla de envío.').waitFor();
  await page.getByText('Se despachan las 3 unidades del pedido: 2 Galletas surtidas, 1 Brownie Box.').waitFor();
  await page.getByRole('button', { name: 'Confirmar despacho' }).click();
  await page.getByText('Falta un permiso de Shopify para despachar desde el panel. Mientras tanto, despacha desde el admin de Shopify.').waitFor();
  await screenshots(page, 'despachar-sin-permiso');
  await page.getByRole('button', { name: 'Confirmar despacho' }).click();
  await page.getByText('Pedido despachado.').waitFor();
  await page.getByText('9400 1000 0000 0000 0000 00', { exact: false }).first().waitFor();

  // g) Cancelar: un pedido despachado no se cancela; se ofrece reembolsar.
  assert.equal(await page.getByRole('button', { name: 'Cancelar pedido' }).count(), 0);
  await page.getByText('Un pedido despachado ya no se cancela: se reembolsa.').waitFor();

  // e) Reembolso parcial por línea, con tope de Shopify y resumen antes de confirmar.
  await page.getByRole('button', { name: 'Reembolsar' }).click();
  await page.getByRole('heading', { name: 'Reembolsar #1042' }).waitFor();
  await page.getByText('Elige qué se devuelve. Shopify calcula el monto; nunca puede pasar de lo que la clienta pagó.').waitFor();
  await page.getByLabel('Cantidad a devolver de Galletas surtidas').selectOption('1');
  await page.locator('#refund-total', { hasText: '$24.00' }).waitFor();
  await page.getByText('Máximo $85.00').waitFor();
  await page.getByLabel('Monto adicional').fill('100');
  await page.getByText('Pasa del máximo que se puede devolver ($85.00).').waitFor();
  assert.equal(await page.getByRole('button', { name: /Revisar y reembolsar/ }).isDisabled(), true, 'nunca más de lo reembolsable');
  await page.getByLabel('Monto adicional').fill('5');
  await page.getByRole('button', { name: 'Revisar y reembolsar $29.00' }).waitFor();
  await page.getByLabel('Motivo').selectOption('damaged');
  await page.getByLabel('Tu contraseña').fill(password);
  await screenshots(page, 'reembolso');
  await page.getByRole('button', { name: 'Revisar y reembolsar $29.00' }).click();
  await page.getByRole('heading', { name: 'Revisa el reembolso' }).waitFor();
  await page.locator('#order-sheet').getByRole('button', { name: 'Reembolsar $29.00', exact: true }).click();
  await page.getByText('Reembolso de $29.00 registrado.').waitFor();

  shop = await state();
  assert.equal(shop.calls.filter(c => c === 'PanelRefund').length, 1);

  // g) Cancelar un pedido abierto: motivo, reembolso, stock y aviso, con contraseña.
  await page.evaluate(() => { location.hash = 'pedidos/1046'; });
  await page.getByRole('heading', { name: 'Pedido #1046' }).waitFor();
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await page.getByText('Pedido #1046 · Elena Vidal · $37.00').waitFor();
  await page.getByText('Reembolsar $37.00 a la forma de pago original').waitFor();
  await page.getByText('Regresar las cajas al stock').waitFor();
  await page.getByText('Un pedido despachado ya no se cancela: se reembolsa. La cancelación no se puede deshacer.').waitFor();
  await page.getByLabel('Motivo').selectOption('INVENTORY');
  await page.getByLabel('Tu contraseña').fill(password);
  await screenshots(page, 'cancelar');
  await page.locator('#order-sheet').getByRole('button', { name: 'Cancelar pedido' }).click();
  await page.getByText('Pedido cancelado.').waitFor();
  await page.getByText('Este pedido está cancelado.').waitFor();
  assert.equal((await state()).calls.filter(c => c === 'PanelCancel').length, 1);

  // Rol inventario: ve, anota y despacha; el dinero queda oculto y el servidor responde 403.
  const kitchen = await newPage(kitchenSession);
  await kitchen.goto(`${origin}/apps/inventario#pedidos/1045`);
  await kitchen.getByRole('heading', { name: 'Pedido #1045' }).waitFor();
  for (const name of ['Cobré en efectivo', 'Editar pedido', 'Reembolsar', 'Cancelar pedido']) assert.equal(await kitchen.getByRole('button', { name, exact: true }).count(), 0, name);
  assert.equal(await kitchen.evaluate(() => window.inventarioPortal.request('pedidos/orders/1045/refund', { password: 'x', body: { operationId: crypto.randomUUID() } }).catch(e => e.status)), 403);
  await screenshots(kitchen, 'detalle-inventario');

  // Rol celebraciones solo: no ve «Pedidos».
  const events = await newPage(eventsSession);
  await events.goto(`${origin}/apps/inventario`);
  await events.getByRole('button', { name: 'Celebraciones', exact: true }).waitFor();
  assert.equal(await events.locator('#pedidos').isHidden(), true);

  assert.deepEqual(errors, []);
  console.log('PASS pedidos-ui-check: lista, detalle, nota, efectivo con respuesta perdida (1 cobro, misma clave), retiro listo/entregado, edición con stock, Celebraciones sin dinero, despacho con aviso de permiso, reembolso con tope, cancelación, roles; 390/1440 sin desbordes, 44 px, 0 errores JS.');
} finally { await browser?.close(); await worker.stop(); }
