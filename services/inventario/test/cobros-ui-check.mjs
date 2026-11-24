// Cobros en Chrome real: crear un cobro y una cotización, contraseña equivocada corregida en la hoja
// (un solo borrador, misma clave), copiar el enlace, anular, el pedido pagado en Pedidos con su
// etiqueta y fuera de «Para hornear», y que el rol inventario no vea «Cobros».
// Uso: node test/cobros-ui-check.mjs <ruta a playwright>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { staffEnv, signedProxy, password } from './staff-helpers.mjs';
import { jwt } from './helpers.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const worker = await unstable_dev('test/pedidos-runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 38777, inspectorPort: 0, vars: staffEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true } });
const storageKey = 'dayanas.inventario.session';
const results = [], check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
let browser;
try {
  browser = await chromium.launch({ ...(process.env.UI_BUNDLED_CHROMIUM ? {} : { channel: 'chrome' }), headless: true });
  const origin = `http://${worker.address}:${worker.port}`, evidence = resolve('../../docs/inventario/evidence'), errors = [];
  await mkdir(evidence, { recursive: true });
  const api = async (path, body) => { const response = await worker.fetch(signedProxy('/proxy/api/' + path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const emails = () => worker.fetch('/__test/emails').then(r => r.json());
  const shop = () => worker.fetch('/__test/cobros').then(r => r.json());
  async function newPage(session) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    context.setDefaultTimeout(15000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
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
          small: [...document.querySelectorAll('#cobros-view button, #cobros-view a, #cobros-view input, dialog[open] button, dialog[open] input')].filter(visible).filter(n => n.getBoundingClientRect().height < 43.5).map(n => n.textContent.trim() || n.getAttribute('aria-label') || n.id) };
      });
      check(`${name} ${width}px: sin desborde y táctiles ≥44`, l.overflowX <= 0 && !l.small.length, JSON.stringify(l));
      await page.screenshot({ path: resolve(evidence, `cobros-${name}-${label}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  const sheet = page => page.locator('#cobros-sheet');
  const view = page => page.locator('#cobros-view');

  // Administradora y una cuenta de cocina (rol inventario).
  const embedded = await newPage(); await embedded.goto(origin); await embedded.getByRole('button', { name: 'Usuarios', exact: true }).click();
  await embedded.getByLabel('Nombre', { exact: true }).fill('Dayana'); await embedded.getByLabel('Usuario', { exact: true }).fill('dayana'); await embedded.getByLabel('Correo', { exact: true }).fill('dayana@example.test');
  await embedded.getByRole('button', { name: 'Enviar invitación', exact: true }).click(); await embedded.getByText('Invitación enviada. Vence en 48 horas.', { exact: true }).waitFor();
  await embedded.getByRole('button', { name: 'Conectar acceso externo', exact: true }).click(); await embedded.getByText('Acceso externo conectado a Shopify.', { exact: true }).waitFor();
  const token = mail => new URL(mail.text.match(/https:\/\/\S+/)[0]).hash.slice('#invitacion='.length);
  const admin = await api('accept-invitation', { token: token((await emails()).at(-1)), password });
  assert.equal(admin.status, 200);
  assert.equal((await api('invite', { session: admin.body.session, username: 'cocina', name: 'cocina', email: 'cocina@example.test', roles: ['inventario'] })).status, 200);
  const kitchen = await api('accept-invitation', { token: token((await emails()).at(-1)), password });

  const page = await newPage(admin.body.session);
  const createPosts = []; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/pedidos/charges/create')) createPosts.push(JSON.parse(request.postData() || '{}').body); });

  // Desde «Más»: la lista vacía y el formulario.
  await page.goto(`${origin}/apps/inventario`);
  // Al terminar de cargar, el portal abre «Hoy» y cierra los menús: se espera antes de abrir «Más».
  await page.waitForFunction(() => document.querySelector('#hoy')?.getAttribute('aria-current') === 'page');
  await page.getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('button', { name: 'Cobros', exact: true }).click();
  await page.getByRole('heading', { name: 'Cobros', exact: true }).waitFor();
  await page.getByText('No hay cobros esperando pago.').waitFor();
  check('«Más» abre Cobros con la lista vacía', true);
  await page.getByRole('button', { name: 'Nuevo cobro', exact: true }).click();
  await page.getByRole('heading', { name: 'Nuevo cobro' }).waitFor();
  check('cobro directo: sin «Válida hasta»', await page.getByLabel('Válida hasta').count() === 0);

  // Validación local: sin llamar al servidor.
  await page.getByRole('button', { name: 'Revisar y enviar' }).click();
  check('sin nombre: avisa y no abre la hoja', (await page.locator('#cobro-error').textContent()).includes('nombre') && !(await sheet(page).isVisible()));

  // Cotización de dos líneas.
  await page.getByRole('button', { name: 'Cotización', exact: true }).click();
  const expires = await page.getByLabel('Válida hasta').inputValue();
  const storeToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  check('cotización: vence a los 7 días por defecto', expires === new Date(Date.parse(`${storeToday}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10), expires);
  await page.getByLabel('Nombre de la clienta').fill('Mariela Vera');
  await page.getByLabel('Correo').fill('mariela@ejemplo.com');
  await page.getByLabel('Concepto').first().fill('Torta 30 personas');
  await page.getByLabel('Monto').first().fill('75');
  await page.getByRole('button', { name: '+ Agregar línea' }).click();
  await page.getByLabel('Concepto').nth(1).fill('Envío');
  await page.getByLabel('Monto').nth(1).fill('10,00');
  check('total calculado', (await page.locator('#cobro-total').textContent()) === '$85.00');
  {
    // D17: en el celular el concepto va a lo ancho y el monto debajo; en escritorio, una sola fila.
    const geometry = () => page.evaluate(() => {
      const line = document.querySelector('.cobro-line'), [concept, amount] = line.querySelectorAll('input'), remove = line.querySelector('button');
      const r = el => el.getBoundingClientRect();
      return { line: Math.round(r(line).width), concept: Math.round(r(concept).width), sameRow: Math.abs(r(concept).top - r(amount).top) < 2, removeBesideAmount: Math.abs(r(remove).bottom - r(amount).bottom) < 4, removeWidth: Math.round(r(remove).width) };
    });
    const mobile = await geometry();
    check('D17 390px: concepto a lo ancho, monto y quitar debajo', mobile.concept >= mobile.line * 0.9 && !mobile.sameRow && mobile.removeBesideAmount && mobile.removeWidth >= 44, JSON.stringify(mobile));
    check('D17: la etiqueta dice la moneda', await page.getByText('Monto (USD)', { exact: true }).count() === 2);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const desktop = await geometry();
    check('D17 1440px: concepto, monto y quitar en una fila', desktop.sameRow && desktop.removeBesideAmount, JSON.stringify(desktop));
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await page.getByLabel('Mensaje para la clienta').fill('Hola Mariela, aquí está tu cotización.');
  await screenshots(page, 'formulario');
  await page.getByRole('button', { name: 'Revisar y enviar' }).click();
  await sheet(page).getByRole('heading', { name: 'Revisa la cotización' }).waitFor();
  check('revisión: líneas, total y correo', /Torta 30 personas\s*\$75\.00[\s\S]*Envío\s*\$10\.00[\s\S]*\$85\.00[\s\S]*mariela@ejemplo\.com/.test(await sheet(page).textContent()));
  await sheet(page).getByLabel('Tu contraseña').fill('contraseña-equivocada');
  await sheet(page).getByRole('button', { name: 'Enviar cotización $85.00' }).click();
  await sheet(page).getByText(/contraseña/i).filter({ hasText: /no es correcta|incorrecta|equivocada/i }).first().waitFor();
  await screenshots(page, 'contrasena');
  check('contraseña equivocada: nada llegó a Shopify', (await shop()).creates === 0);
  await sheet(page).getByLabel('Tu contraseña').fill(password);
  await sheet(page).getByRole('button', { name: 'Enviar cotización $85.00' }).click();
  await page.getByRole('heading', { name: 'Cotización enviada' }).waitFor();
  const state = await shop();
  check('un solo borrador con su factura', state.creates === 1 && state.invoices.length === 1 && state.invoices[0].to === 'mariela@ejemplo.com', JSON.stringify(state.invoices));
  check('misma clave tras la contraseña corregida', createPosts.length === 2 && createPosts[0].operationId && createPosts[0].operationId === createPosts[1].operationId);
  check('líneas enviadas en centavos', JSON.stringify(createPosts[1].lines) === JSON.stringify([{ title: 'Torta 30 personas', cents: 7500 }, { title: 'Envío', cents: 1000 }]));
  const url = await page.locator('.cobro-url').inputValue();
  await page.getByRole('button', { name: 'Copiar enlace' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  check('«Copiar enlace» copia el enlace de pago', copied === url && /invoices\/\d+$/.test(url), String(copied));
  await screenshots(page, 'enviado');

  // Revisión F6: tras «Reintentar», un rechazo definitivo (422 o 5xx con final:true) deja la hoja con «Cerrar» y Escape.
  for (const [label, finalStatus] of [['422 tras 202', 422], ['502 final', 502]]) {
    await page.getByRole('link', { name: 'Volver a Cobros' }).click().catch(() => {});
    await page.evaluate(() => { location.hash = 'cobros/nuevo'; });
    await page.getByRole('heading', { name: 'Nuevo cobro' }).waitFor();
    await page.getByLabel('Nombre de la clienta').fill('Prueba Final');
    await page.getByLabel('Correo').fill('final@ejemplo.com');
    await page.getByLabel('Concepto').first().fill('Galletas');
    await page.getByLabel('Monto').first().fill('20');
    let posts = 0;
    await page.route('**/api/pedidos/charges/create', route => {
      posts++;
      if (finalStatus === 422 && posts === 1) return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ code: 'PROCESSING', state: 'processing', message: 'Shopify todavía no confirma el cobro.' }) });
      return route.fulfill({ status: finalStatus, contentType: 'application/json', body: JSON.stringify({ code: finalStatus === 422 ? 'VALIDATION' : 'REVIEW_REQUIRED', final: true, message: 'Rechazo definitivo de prueba.' }) });
    });
    await page.getByRole('button', { name: 'Revisar y enviar' }).click();
    await sheet(page).getByLabel('Tu contraseña').fill(password);
    await sheet(page).getByRole('button', { name: /^Enviar cobro/ }).click();
    if (finalStatus === 422) await sheet(page).getByRole('button', { name: 'Reintentar' }).click();
    await sheet(page).getByText('Rechazo definitivo de prueba.').waitFor();
    const state = await page.evaluate(() => ({ close: [...document.querySelectorAll('#cobros-sheet button')].filter(b => !b.hidden && b.getClientRects().length).map(b => b.textContent) }));
    check(`F6 ${label}: queda solo «Cerrar», sin reintentar`, JSON.stringify(state.close) === '["Cerrar"]', JSON.stringify(state));
    await page.keyboard.press('Escape');
    check(`F6 ${label}: Escape cierra la hoja`, await page.locator('#cobros-sheet').evaluate(d => !d.open));
    await page.unroute('**/api/pedidos/charges/create');
    check(`F6 ${label}: ${finalStatus === 422 ? 'dos envíos (202 y rechazo)' : 'un solo envío'}`, posts === (finalStatus === 422 ? 2 : 1), String(posts));
  }

  // Un cobro directo cuyo correo no se pudo confirmar (y que después se anula).
  await worker.fetch('/__test/pedidos-next?op=PanelChargeInvoice&mode=down');
  await page.evaluate(() => { location.hash = 'cobros'; });
  await page.locator('.cobro-card', { hasText: 'Mariela Vera' }).waitFor();
  await page.getByRole('button', { name: 'Nuevo cobro', exact: true }).click();
  await page.getByRole('heading', { name: 'Nuevo cobro' }).waitFor();
  check('formulario nuevo: vacío tras un envío', (await page.getByLabel('Nombre de la clienta').inputValue()) === '' && await page.getByLabel('Válida hasta').count() === 0);
  await page.getByLabel('Nombre de la clienta').fill('Carlos Ruiz');
  await page.getByLabel('Correo').fill('carlos@ejemplo.com');
  await page.getByLabel('Concepto').first().fill('Caja de galletas personalizada');
  await page.getByLabel('Monto').first().fill('40');
  await page.getByRole('button', { name: 'Revisar y enviar' }).click();
  await sheet(page).getByLabel('Tu contraseña').fill(password);
  await sheet(page).getByRole('button', { name: 'Enviar cobro $40.00' }).click();
  await page.getByRole('heading', { name: 'Cobro enviado' }).waitFor();
  check('correo sin confirmar: lo avisa y ofrece el enlace', /No pudimos confirmar que el correo salió/.test(await view(page).textContent()) && await page.getByRole('button', { name: 'Copiar enlace' }).isVisible());
  check('correo sin confirmar: nunca se reenvía', (await shop()).invoices.filter(item => item.to === 'carlos@ejemplo.com').length === 0);
  await page.getByRole('link', { name: 'Volver a Cobros' }).click();
  await page.locator('.cobro-card', { hasText: 'Carlos Ruiz' }).waitFor();
  check('lista: dos cobros abiertos', await page.locator('.cobro-card').count() === 2 && /Abiertos \(2\)/.test(await view(page).textContent()));
  await screenshots(page, 'lista');
  await page.locator('.cobro-card', { hasText: 'Carlos Ruiz' }).getByRole('button', { name: 'Anular' }).click();
  await sheet(page).getByRole('heading', { name: 'Anular el cobro' }).waitFor();
  await sheet(page).getByLabel('Tu contraseña').fill(password);
  await sheet(page).getByRole('button', { name: 'Anular', exact: true }).click();
  await page.getByText('Cobro anulado.').waitFor();
  check('anular: el borrador ya no existe', (await shop()).drafts.length === 1);
  await page.getByRole('button', { name: /^Vencidos y anulados/ }).click();
  check('anulado: aparece en «Vencidos y anulados»', /Anulado/.test(await page.locator('.cobro-card').first().textContent()));

  // La clienta paga la cotización: queda en «Pagados» y aparece en Pedidos con su etiqueta, fuera de «Para hornear».
  const paid = (await shop()).drafts[0];
  const { orderId } = await worker.fetch(`/__test/cobros-pay?id=${paid.id}`).then(r => r.json());
  await page.evaluate(() => { location.hash = 'pedidos'; });
  await page.evaluate(() => { location.hash = 'cobros'; });
  await page.getByRole('button', { name: /^Pagados/ }).click();
  await page.locator('.cobro-card', { hasText: 'Mariela Vera' }).getByRole('link', { name: /Ver pedido/ }).click();
  await page.getByRole('heading', { name: `Pedido #${orderId}` }).waitFor();
  check('pagado: el enlace lleva al pedido, con la etiqueta «Cotización»', /Cotización/.test(await page.locator('#pedidos-view').textContent()));
  await page.evaluate(() => { location.hash = 'pedidos'; });
  await page.locator('#pedidos-view .order-card', { hasText: new RegExp(`#${orderId}(?!\d)`) }).waitFor();
  check('Pedidos: la tarjeta lleva «Cotización»', /Cotización/.test(await page.locator('#pedidos-view .order-card', { hasText: new RegExp(`#${orderId}(?!\d)`) }).textContent()));
  const bake = await page.locator('#pedidos-view section.bake').textContent();
  check('«Para hornear» y la hoja de empaque no incluyen el cobro', bake.includes('Hoja de empaque') && !bake.includes('Torta 30 personas') && !new RegExp(`#${orderId}(?!\d)`).test(bake), bake.slice(0, 300));

  // Cocina (rol inventario): no ve «Cobros» y la API responde 403.
  const kitchenPage = await newPage(kitchen.body.session);
  await kitchenPage.goto(`${origin}/apps/inventario#cobros`);
  await kitchenPage.getByRole('button', { name: 'Más', exact: true }).click();
  check('inventario: «Cobros» no aparece en «Más»', !(await kitchenPage.locator('#cobros').isVisible()) && await kitchenPage.locator('#cobros-view').isHidden());
  check('inventario: la API de cobros responde 403', (await api('pedidos/charges', { session: kitchen.body.session })).status === 403);

  check('sin errores de JavaScript', !errors.length, errors.join(' | '));
} finally {
  await browser?.close();
  await worker.stop();
}
for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.ok || !result.detail ? '' : ` — ${result.detail}`}`);
const failed = results.filter(result => !result.ok).length;
console.log(`cobros-ui-check: ${results.length - failed}/${results.length} ${failed ? 'FAIL' : 'PASS'}`);
process.exit(failed ? 1 : 0);
