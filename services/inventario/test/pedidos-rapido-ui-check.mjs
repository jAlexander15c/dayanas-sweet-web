// Pedidos (fase 2b) en Chrome real: Activos/Historial, «Listo para retirar» y «Entregado» desde la tarjeta
// (con saldo avisa, no bloquea), «Todos los retiros están listos» sin avisar dos veces y cancelados al historial.
// Uso: node test/pedidos-rapido-ui-check.mjs <ruta a playwright>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { staffEnv, signedProxy, password } from './staff-helpers.mjs';
import { jwt } from './helpers.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const worker = await unstable_dev('test/pedidos-runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 38773, inspectorPort: 0, vars: staffEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } });
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

  // 1. Pestañas: Activos (Por preparar, Listos) e Historial (Entregados, Cancelados).
  const page = await newPage(admin.body.session);
  await page.goto(`${origin}/apps/inventario#pedidos`);
  await page.getByRole('button', { name: 'Activos · 7', exact: true }).waitFor();
  check('Activos e Historial con sus cifras', await page.getByRole('button', { name: 'Historial · 0', exact: true }).isVisible() && await page.getByRole('button', { name: 'Por preparar · 6', exact: true }).isVisible() && await page.getByRole('button', { name: 'Listos · 1', exact: true }).isVisible());
  check('retiros con botón rápido; envíos sin él', await card(page, '#1043').getByRole('button', { name: 'Listo para retirar: pedido #1043' }).isVisible() && await card(page, '#1042').locator('[data-quick]').count() === 0);
  await screenshots(page, 'activos');

  // 2. «Todos los retiros están listos»: otra pantalla marca #1044 mientras tanto; no se le vuelve a avisar.
  await page.getByRole('button', { name: 'Todos los retiros están listos (2)' }).click();
  check('el lote nombra a las clientas y avisa el saldo', await sheet(page).getByText('#1043 · Beatriz L.').isVisible() && await sheet(page).getByText('saldo por cobrar', { exact: false }).isVisible());
  await screenshots(page, 'lote');
  const other = await newPage(admin.body.session);
  await other.goto(`${origin}/apps/inventario#pedidos`);
  await card(other, '#1044').getByRole('button', { name: 'Listo para retirar: pedido #1044' }).click();
  check('rápido en Celebraciones: avisa que se cobra allá', await sheet(other).getByText('Este pedido se cobra desde Celebraciones', { exact: false }).isVisible());
  await sheet(other).getByRole('button', { name: 'Marcar listo para retirar' }).click();
  await other.getByText('#1044: listo para retirar.').waitFor();
  check('rápido: vuelve a la lista con #1044 en Listos', await other.getByRole('button', { name: 'Listos · 2', exact: true }).isVisible());
  await sheet(page).getByRole('button', { name: 'Marcar 2 listos' }).click();
  await sheet(page).getByRole('button', { name: 'Cerrar' }).waitFor();
  const states = Object.fromEntries(await sheet(page).locator('[data-bulk]').evaluateAll(rows => rows.map(row => [row.dataset.bulk, row.querySelector('[data-bulk-state]').textContent])));
  check('lote: #1043 listo; #1044 no se repite', states['1043'] === 'Listo' && states['1044'] === 'Ya no está por preparar', JSON.stringify(states));
  await sheet(page).getByRole('button', { name: 'Cerrar' }).click();
  await page.getByText('1 listo, 1 ya no estaban por preparar.').waitFor();
  check('después del lote: Listos · 3 y sin botón de lote', await page.getByRole('button', { name: 'Listos · 3', exact: true }).isVisible() && await page.getByRole('button', { name: /Todos los retiros/ }).count() === 0);

  // 3. «Entregado» desde la tarjeta con saldo: avisa y deja marcar.
  await page.getByRole('button', { name: 'Listos · 3', exact: true }).click();
  await card(page, '#1043').getByRole('button', { name: 'Entregado: pedido #1043' }).click();
  check('Entregado con saldo: aviso sin casilla obligatoria', await sheet(page).getByText('Saldo por cobrar: $36.00. Marcarlo entregado no registra el pago: cóbralo al entregarlo.').isVisible() && await sheet(page).locator('input[type=checkbox]').count() === 0);
  await screenshots(page, 'entregado-saldo');
  await sheet(page).getByRole('button', { name: 'Marcar entregado' }).click();
  await page.getByText('#1043: entregado.').waitFor();
  check('Entregado: sale de Activos', await page.getByRole('button', { name: 'Activos · 6', exact: true }).isVisible() && await page.getByRole('button', { name: 'Historial · 1', exact: true }).isVisible());

  // 4. Cancelado (por la API, con la contraseña de la administradora) aparece en el historial, sin acciones.
  const operationId = crypto.randomUUID();
  let cancel;
  for (let attempt = 0; attempt < 5; attempt++) {
    cancel = await page.evaluate(([id, pw]) => window.inventarioPortal.request('pedidos/orders/1046/cancel', { password: pw, body: { operationId: id, reason: 'CUSTOMER', refund: false, restock: true, notify: false } }).catch(e => ({ error: e.code })), [operationId, password]);
    if (cancel?.state !== 'processing') break;
  }
  check('cancelación de prueba aplicada', !cancel?.error && cancel?.state !== 'processing', JSON.stringify(cancel));
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('button', { name: 'Historial · 2', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelados · 1', exact: true }).click();
  check('Historial › Cancelados: #1046 sin botón rápido', await card(page, '#1046').isVisible() && await card(page, '#1046').locator('[data-quick]').count() === 0);
  await page.getByRole('button', { name: 'Entregados · 1', exact: true }).click();
  check('Historial › Entregados: #1043', await card(page, '#1043').isVisible() && await card(page, '#1043').locator('[data-quick]').count() === 0);
  await screenshots(page, 'historial');
  await page.getByRole('button', { name: 'Activos · 5', exact: true }).click();
  check('Activos sin el cancelado', await page.getByRole('button', { name: 'Por preparar · 3', exact: true }).isVisible() && await card(page, '#1046').count() === 0);

  // 5. «Hoy» no cuenta el cancelado ni el entregado como cobro pendiente activo.
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await page.locator('#today-pedidos .today-foot').getByText(/Actualizado/).waitFor();
  check('Hoy: 3 por preparar', (await page.locator('#today-pedidos .today-stat strong').first().textContent()) === '3');
  check('sin errores de JavaScript', !errors.length, errors.join(' | '));
} finally { await browser?.close(); await worker.stop(); }
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`);
assert.ok(results.every(r => r.ok), 'pedidos-rapido-ui-check con fallos');
console.log(`pedidos-rapido-ui-check: ${results.length}/${results.length} PASS`);
