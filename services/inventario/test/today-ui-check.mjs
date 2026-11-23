// «Hoy» y navegación del portal (fase 2) en Chrome real, contra un Worker local con Shopify simulado.
// Cifras por rol, enlaces, «Reintentar», barra inferior del iPhone, «Más», menú de Cuenta y escritorio.
// Uso: node test/today-ui-check.mjs <ruta a playwright>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unstable_dev } from 'wrangler';
import { testConfig } from './test-config.mjs';
import { staffEnv, signedProxy, password } from './staff-helpers.mjs';
import { jwt } from './helpers.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const worker = await unstable_dev('test/pedidos-runtime-entry.mjs', { config: testConfig(), local: true, persist: false, ip: '127.0.0.1', port: 38772, inspectorPort: 0, vars: staffEnv, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } });
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
  // El servidor de prueba solo conecta los pedidos de Celebraciones; las solicitudes y avisos se simulan (solo lectura).
  const inDays = days => new Date(Date.now() + days * 86400000).toISOString();
  const snapshot = (id, status, name, days) => ({ id, version: 1, status, reference: `DS-00${id.slice(-1)}`, contact: { name }, pickup: { label: 'fecha de prueba' }, details: { pickupAt: inDays(days), urgent: false }, requestText: 'Pastel de prueba', permissions: { canComment: true, canPropose: true, canPrepare: true }, payments: [], comments: [], history: [], notifications: [], attachments: [] });
  const sample = [snapshot('00000000-0000-4000-8000-000000000001', 'requested', 'Lucía', 12), snapshot('00000000-0000-4000-8000-000000000002', 'reserved', 'Marta', 3), snapshot('00000000-0000-4000-8000-000000000003', 'ready', 'Ana', 1)];
  const fakeCelebraciones = page => page.route(/\/apps\/inventario\/api\/celebraciones\/(requests|staff-alerts|calendar)/, route => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith('staff-alerts') ? { alerts: [{ id: 'a1', requestId: sample[0].id, kind: 'request', read: false, reference: 'DS-001', createdAt: new Date().toISOString(), emailStatus: 'sent' }], unread: 1 }
      : path.endsWith('calendar') ? { days: [] } : { requests: sample, nextCursor: null };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  const layout = page => page.evaluate(() => {
    const visible = n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
    return {
      overflowX: document.documentElement.scrollWidth - innerWidth,
      small: [...document.querySelectorAll('button, #today-view a, nav a')].filter(visible).filter(n => n.getBoundingClientRect().height < 43.5).map(n => n.textContent.trim() || n.getAttribute('aria-label')),
    };
  });
  const shot = (page, name) => page.screenshot({ path: resolve(evidence, `hoy-${name}.png`), fullPage: true });
  const nav = (page, name) => page.locator('nav[aria-label="Pantallas"]').getByRole('button', { name, exact: true });

  // Administradora con todos los permisos, cocina (solo inventario) y eventos (solo Celebraciones).
  const embedded = await newPage(); await embedded.goto(origin); await embedded.getByRole('button', { name: 'Usuarios', exact: true }).click();
  await embedded.getByLabel('Nombre', { exact: true }).fill('Dayana'); await embedded.getByLabel('Usuario', { exact: true }).fill('dayana'); await embedded.getByLabel('Correo', { exact: true }).fill('dayana@example.test');
  await embedded.getByRole('button', { name: 'Enviar invitación', exact: true }).click(); await embedded.getByText('Invitación enviada. Vence en 48 horas.', { exact: true }).waitFor();
  await embedded.getByRole('button', { name: 'Conectar acceso externo', exact: true }).click(); await embedded.getByText('Acceso externo conectado a Shopify.', { exact: true }).waitFor();
  const token = mail => new URL(mail.text.match(/https:\/\/\S+/)[0]).hash.slice('#invitacion='.length);
  const admin = await api('accept-invitation', { token: token((await emails()).at(-1)), password });
  assert.equal(admin.status, 200);
  async function member(username, roles) {
    assert.equal((await api('invite', { session: admin.body.session, username, name: username, email: `${username}@example.test`, roles })).status, 200);
    const accepted = await api('accept-invitation', { token: token((await emails()).at(-1)), password });
    assert.equal(accepted.status, 200); return accepted.body.session;
  }
  const allSession = await member('duena', ['inventario', 'celebraciones']), kitchenSession = await member('cocina', ['inventario']), eventsSession = await member('eventos', ['celebraciones']);
  const orders = (await api('pedidos/orders', { session: allSession })).body;

  // 1. Al entrar se abre «Hoy» con las tres partes y las cifras reales de Pedidos.
  const page = await newPage(allSession); await fakeCelebraciones(page);
  await page.goto(`${origin}/apps/inventario`);
  await page.getByRole('heading', { name: 'Hoy', exact: true }).waitFor();
  await page.locator('#today-pedidos .today-foot').getByText(/Actualizado/).waitFor();
  await page.locator('#today-celebraciones .today-foot').getByText(/Actualizado/).waitFor().catch(async error => { throw new Error(`Celebraciones en Hoy: ${await page.locator('#today-celebraciones').textContent()} | ${errors.join(' | ')}`, { cause: error }); });
  check('Hoy: Pedidos, Celebraciones y Productos', await page.locator('#today-pedidos').isVisible() && await page.locator('#today-celebraciones').isVisible() && await page.locator('#today-productos').isVisible());
  const preparar = await page.locator('#today-pedidos .today-stat').first().locator('strong').textContent();
  check('Hoy: «por preparar» coincide con Pedidos', Number(preparar) === orders.counts.preparar, `${preparar} vs ${orders.counts.preparar}`);
  check('Hoy: 1 aviso, 1 por responder', JSON.stringify(await page.locator('#today-celebraciones .today-stat strong').allTextContents()) === '["1","1"]');
  check('Hoy: recogidas de la semana en orden (Ana, Marta) y sin la de 12 días', JSON.stringify((await page.locator('#today-celebraciones .today-list a > span:first-child').allTextContents())) === '["Ana","Marta"]');
  check('Hoy marcado en la barra', await nav(page, 'Hoy').getAttribute('aria-current') === 'page');
  const bar = await page.locator('nav[aria-label="Pantallas"]').evaluate(n => ({ position: getComputedStyle(n).position, bottom: Math.round(innerHeight - n.getBoundingClientRect().bottom) }));
  check('iPhone: barra fija abajo', bar.position === 'fixed' && bar.bottom === 0, JSON.stringify(bar));
  const shown = await page.locator('nav[aria-label="Pantallas"] > button:visible').allTextContents();
  check('iPhone: Hoy, Pedidos, Celebraciones, Productos, Más', JSON.stringify(shown.map(t => t.trim())) === JSON.stringify(['Hoy', 'Pedidos', 'Celebraciones', 'Productos', 'Más']), JSON.stringify(shown));
  let l = await layout(page); check('iPhone: sin desborde y táctiles ≥44', l.overflowX <= 0 && !l.small.length, JSON.stringify(l));
  await shot(page, 'mobile');

  // 2. Una cifra lleva a su sección.
  await page.locator('#today-pedidos .today-stat').first().click();
  await page.getByRole('heading', { name: 'Para hornear' }).waitFor();
  check('cifra de Pedidos abre Pedidos', await page.locator('#today-view').isHidden() && await nav(page, 'Pedidos').getAttribute('aria-current') === 'page');

  // 3. «Más» abre Categorías, Historial y Usuarios; Escape cierra y devuelve el foco.
  await nav(page, 'Más').click();
  check('Más muestra Categorías', await page.getByRole('button', { name: 'Categorías', exact: true }).isVisible());
  await page.keyboard.press('Escape');
  check('Escape cierra Más y vuelve el foco', await page.getByRole('button', { name: 'Categorías', exact: true }).isHidden() && await page.evaluate(() => document.activeElement?.id) === 'more-nav');
  await nav(page, 'Más').click(); await page.getByRole('button', { name: 'Categorías', exact: true }).click();
  await page.locator('#categories-view').waitFor();
  check('Categorías desde Más, «Más» marcado', await page.locator('#categories-view').isVisible() && await page.locator('#more-menu').isHidden() && await nav(page, 'Más').getAttribute('data-current') === 'true');

  // 4. Menú de Cuenta.
  await page.getByRole('button', { name: 'Cuenta', exact: true }).click();
  check('Cuenta muestra Salir y Cambiar contraseña', await page.getByRole('button', { name: 'Salir', exact: true }).isVisible() && await page.getByRole('button', { name: 'Cambiar contraseña', exact: true }).isVisible());
  await shot(page, 'cuenta-mobile');
  await page.mouse.click(195, 500);
  check('tocar fuera cierra Cuenta', await page.getByRole('button', { name: 'Salir', exact: true }).isHidden());

  // 5. Productos desde Hoy y vuelta a Hoy sin dos pantallas a la vez.
  await nav(page, 'Hoy').click(); await page.getByRole('heading', { name: 'Hoy', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ir a Productos', exact: true }).click();
  check('Ir a Productos muestra solo Productos', await page.locator('#workspace').isVisible() && await page.locator('#today-view').isHidden() && await nav(page, 'Productos').getAttribute('aria-current') === 'page');

  // 6. «Reintentar» cuando Pedidos no responde.
  await nav(page, 'Hoy').click(); await page.getByRole('heading', { name: 'Hoy', exact: true }).waitFor();
  await page.route('**/apps/inventario/api/pedidos/orders', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNAVAILABLE', message: 'Shopify no respondió.' }) }));
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await page.locator('#today-pedidos').getByRole('button', { name: 'Reintentar', exact: true }).waitFor();
  check('error de Pedidos: mensaje y Reintentar; el resto sigue', (await page.locator('#today-pedidos [role=alert]').textContent()).includes('Shopify no respondió') && await page.locator('#today-celebraciones .today-stat').count() === 2);
  await page.unroute('**/apps/inventario/api/pedidos/orders');
  await page.locator('#today-pedidos').getByRole('button', { name: 'Reintentar', exact: true }).click();
  await page.locator('#today-pedidos .today-stat').first().waitFor();
  check('Reintentar carga las cifras', true);

  // 7. Escritorio: navegación en fila arriba, sin «Más» ni «Cuenta»; las secciones a la vista.
  await page.setViewportSize({ width: 1440, height: 1000 });
  check('escritorio: Categorías y Salir visibles, sin Más ni Cuenta', await page.getByRole('button', { name: 'Categorías', exact: true }).isVisible() && await page.getByRole('button', { name: 'Salir', exact: true }).isVisible()
    && await nav(page, 'Más').isHidden() && await page.getByRole('button', { name: 'Cuenta', exact: true }).isHidden());
  l = await layout(page); check('escritorio: sin desborde y táctiles ≥44', l.overflowX <= 0 && !l.small.length, JSON.stringify(l));
  await shot(page, 'desktop');

  // 8. Por rol: cocina (solo inventario) y eventos (solo Celebraciones).
  const kitchen = await newPage(kitchenSession);
  await kitchen.goto(`${origin}/apps/inventario`); await kitchen.getByRole('heading', { name: 'Hoy', exact: true }).waitFor();
  check('cocina: Pedidos y Productos, sin Celebraciones', await kitchen.locator('#today-pedidos').isVisible() && await kitchen.locator('#today-productos').isVisible() && await kitchen.locator('#today-celebraciones').count() === 0 && await nav(kitchen, 'Celebraciones').isHidden());
  const events = await newPage(eventsSession); await fakeCelebraciones(events);
  await events.goto(`${origin}/apps/inventario`); await events.getByRole('heading', { name: 'Hoy', exact: true }).waitFor();
  await events.locator('#today-celebraciones .today-foot').getByText(/Actualizado/).waitFor();
  check('eventos: solo Celebraciones, sin Productos ni Más', await events.locator('#today-celebraciones').isVisible() && await events.locator('#today-pedidos').count() === 0 && await nav(events, 'Productos').isHidden() && await nav(events, 'Más').isHidden());
  check('eventos: sin «Elige una sección» encima de Hoy', (await events.locator('#feedback').textContent()).trim() === '');
  await shot(events, 'eventos-mobile');

  // 9. Un enlace de correo a una solicitud abre Celebraciones, no Hoy.
  const link = await newPage(eventsSession); await fakeCelebraciones(link);
  await link.goto(`${origin}/apps/inventario#celebraciones`); await link.locator('#ds-list-title').waitFor();
  check('enlace #celebraciones no pasa por Hoy', await link.locator('#today-view').isHidden() && await nav(link, 'Celebraciones').getAttribute('aria-current') === 'page');
  check('sin errores de JavaScript', !errors.length, errors.join(' | '));
} finally { await browser?.close(); await worker.stop(); }
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`);
assert.ok(results.every(r => r.ok), 'today-ui-check con fallos');
console.log(`today-ui-check: ${results.length}/${results.length} PASS`);
