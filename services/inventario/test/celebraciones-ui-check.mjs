// Recorrido real en Chrome de Celebraciones dentro del portal (sin iframe), con la tienda de Celebraciones en memoria.
// Uso: node test/celebraciones-ui-check.mjs <ruta a playwright>. No usa red ni producción.
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { renderAdminPage } from '../src/admin-page.mjs';
import { createHandler } from '../../celebraciones/src/http.mjs';
import { createStore } from '../../celebraciones/src/store.mjs';
import { renderAdminPage as shopifyAdminPage } from '../../celebraciones/src/admin-page.mjs';

const root = new URL('../../', import.meta.url);
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const out = new URL('../../../docs/inventario/evidence/', import.meta.url);
await mkdir(out, { recursive: true });
const shot = name => new URL(`celebraciones-${name}.png`, out).pathname.replace(/^\/(\w:)/, '$1');

const store = createStore(':memory:'), shop = 'audit.myshopify.com', staff = { shop, role: 'staff', staffId: '9' }, customer = { shop, customerId: '1' };
const at = days => { const d = new Date(Date.now() + days * 86400000); d.setUTCHours(19, 0, 0, 0); return d.toISOString(); };
const make = (text, days, key) => store.createRequest(customer, { requestText: text, pickup: { label: `${days} días · 2:00 p. m. Houston` }, details: { pickupAt: at(days), urgent: false, tiers: [{ diameter: 8, sponges: ['Vainilla', 'Chocolate'], fillings: ['Guayaba', 'Nutella'] }], coating: 'Merengue', decorations: ['Flores de fondant'] } }, key);
const proposal = mode => ({ baseCents: 18000, surchargeCents: 0, display: 'total', canPrepare: 'Pastel de dos pisos para 30 personas.', changes: '', reply: 'Podemos prepararlo para tu fecha.', paymentMode: mode });
const fresh = make('Cumpleaños de mi mamá: pastel de tres leches con fresas, tonos crema y dorado. Sin nueces.', 9, 'r1');
const quoted = make('Pastel de chocolate para 15 personas con letras doradas.', 10, 'r2');
store.propose(staff, quoted.id, proposal('deposit'), 'p2');
const reserved = make('Pastel de vainilla con flores naturales para un bautizo.', 8, 'r3');
store.propose(staff, reserved.id, proposal('delivery'), 'p3'); store.accept(customer, reserved.id, 1, 'a3');
store.comment(customer, reserved.id, '¿Se puede poner una figura dorada con el número 60?', 'c3');

const handler = createHandler({ store, config: { shop, clientId: 'audit', storefrontOrigin: 'https://audit.local' }, trustedStaff: staff });
let html = await renderAdminPage({ PORTAL_PUBLIC_URL: 'https://audit.local/apps/inventario' }, { portal: true }).text();
// Portal sin staff-ui.js: el panel ya está abierto, Celebraciones visible y el hash se reenvía como lo hace staff-ui.
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replace(/<script type="module" src="[^"]*(staff-ui|admin-ui|orders-ui|today-ui)\.js"><\/script>/g, '')
  .replace('id="panel-view" hidden', 'id="panel-view"').replace('id="access-view" ', 'id="access-view" hidden ').replace('<section id="celebraciones-view" hidden>', '<section id="celebraciones-view">').replace('Conectando con Shopify…', '');
html = html.replace('</head>', `<script>window.inventarioPortal={request:async(path,args)=>{const r=await fetch('/audit-api',{method:'POST',body:JSON.stringify({path,args})});const j=await r.json();if(!r.ok)throw Object.assign(new Error(j.code),{code:j.code});return j;}};addEventListener('hashchange',()=>window.dsCelebraciones?.show(location.hash));addEventListener('load',()=>window.dsCelebraciones?.show(location.hash||'#celebraciones'));</script></head>`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); };
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'audit.local') return route.abort();
    if (url.pathname === '/audit-api') {
      const { path, args } = JSON.parse(route.request().postData());
      const response = await handler(new Request('https://internal/admin/' + path.slice('celebraciones/'.length), { method: args?.method || 'GET', ...(args?.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args.body) } : {}) }));
      return route.fulfill({ status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: Object.fromEntries(response.headers) });
    }
    if (url.pathname === '/admin') return route.fulfill({ contentType: 'text/html', body: (await shopifyAdminPage({ shop, clientId: 'audit' }).text()).replace(/<script src="https:\/\/cdn\.shopify\.com[^>]*><\/script>/, '<script>window.shopify={idToken:async()=>"fixture"};</script>') });
    if (url.pathname.startsWith('/admin/') && !url.pathname.startsWith('/admin/assets/')) {
      const response = await handler(new Request('https://internal' + url.pathname + url.search, { method: route.request().method(), ...(route.request().postData() ? { headers: { 'Content-Type': 'application/json' }, body: route.request().postData() } : {}) }));
      return route.fulfill({ status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: Object.fromEntries(response.headers) });
    }
    if (url.pathname === '/admin/assets/admin-ui.js') return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('celebraciones/src/admin-ui.js', root), 'utf8') });
    if (url.pathname === '/admin/assets/admin-ui.css') return route.fulfill({ contentType: 'text/css', body: await readFile(new URL('celebraciones/src/admin-ui.css', root), 'utf8') });
    if (url.pathname.endsWith('/celebraciones.js')) return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('celebraciones/src/admin-ui.js', root), 'utf8') });
    if (url.pathname.endsWith('/celebraciones.css')) return route.fulfill({ contentType: 'text/css', body: await readFile(new URL('celebraciones/src/admin-ui.css', root), 'utf8') });
    if (url.pathname.endsWith('/admin-ui.css')) return route.fulfill({ contentType: 'text/css', body: await readFile(new URL('inventario/src/admin-ui.css', root), 'utf8') });
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  const layout = () => page.evaluate(() => {
    const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; };
    const small = [...document.querySelectorAll('#ds-app button, #ds-app a, #ds-app input, #ds-app select, #ds-app summary')].filter(visible).filter(el => el.getBoundingClientRect().height < 43.5).map(el => `${el.tagName}:${(el.textContent || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 30)}`);
    const scrollers = [...document.querySelectorAll('#ds-app *')].filter(visible).filter(el => { const s = getComputedStyle(el); return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1; }).map(el => el.id || el.className);
    return { iframes: document.querySelectorAll('iframe').length, overflowX: document.documentElement.scrollWidth - innerWidth, small, scrollers };
  });
  const lum = c => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

  // 1. Lista
  await page.goto('https://audit.local/apps/inventario#celebraciones');
  await page.locator('#ds-requests a').first().waitFor();
  check('lista: 3 solicitudes', await page.locator('#ds-requests a').count() === 3);
  await page.getByRole('button', { name: /^Por responder · 1$/ }).click();
  check('filtro Por responder deja 1', await page.locator('#ds-requests a').count() === 1);
  await page.getByRole('button', { name: /^Todas · 3$/ }).click();
  let l = await layout(); check('lista móvil: sin iframe, sin desborde, un solo desplazamiento, táctiles ≥44', l.iframes === 0 && l.overflowX <= 0 && !l.scrollers.length && !l.small.length, JSON.stringify(l));
  await page.screenshot({ path: shot('lista-mobile'), fullPage: true });

  // 2. Detalle por enlace directo (como desde el correo)
  await page.goto(`https://audit.local/apps/inventario#celebraciones/${fresh.id}`);
  await page.locator('#ds-detail:not([hidden])').waitFor();
  check('detalle: siguiente paso pide propuesta', (await page.locator('#ds-next').textContent()).includes('propuesta'));
  check('detalle móvil: lista oculta', !(await page.locator('#ds-list-pane').isVisible()));
  l = await layout(); check('detalle móvil: sin desborde, un solo desplazamiento, táctiles ≥44', l.overflowX <= 0 && !l.scrollers.length && !l.small.length, JSON.stringify(l));
  await page.screenshot({ path: shot('detalle-mobile'), fullPage: true });
  await page.getByRole('button', { name: 'Preparar propuesta' }).click();
  check('botón principal abre Propuesta', await page.locator('#ds-panel-propuesta').isVisible() && !(await page.locator('#ds-panel-pedido').isVisible()));
  const border = await page.locator('#ds-proposal-form textarea').first().evaluate(n => getComputedStyle(n).borderTopColor);
  const contrast = (1.05) / (lum(border) + 0.05); check('borde de campos ≥3:1 sobre blanco', contrast >= 3, contrast.toFixed(2));
  await page.locator('[name=canPrepare]').fill('Pastel de dos pisos de tres leches con fresas, 30 porciones.');
  check('aviso de borrador sin enviar', await page.locator('#ds-proposal-draft').isVisible());
  await page.locator('[name=reply]').fill('¡Con gusto! Sin nueces, como pediste.');
  await page.locator('[name=baseCents]').fill('180');
  await page.getByRole('button', { name: 'Enviar propuesta' }).click();
  await page.locator('#ds-feedback', { hasText: 'Propuesta enviada' }).waitFor();
  // Captura después del envío: una captura de página completa justo antes de tocar «Enviar» mueve la página en pleno toque (efecto de Playwright).
  await page.screenshot({ path: shot('propuesta-mobile'), fullPage: true });
  check('propuesta enviada y borrador limpio', !(await page.locator('#ds-proposal-draft').isVisible()) && (await page.locator('#ds-status').textContent()) === 'Cotización disponible');

  // 3. Conversación y estados en la reserva contra entrega
  await page.goto(`https://audit.local/apps/inventario#celebraciones/${reserved.id}`);
  await page.locator('#ds-request-title', { hasText: /Solicitud/ }).waitFor();
  await page.getByRole('tab', { name: 'Conversación' }).click();
  check('conversación muestra el mensaje de la clienta', (await page.locator('#ds-thread').textContent()).includes('número 60'));
  await page.locator('#ds-comment-form textarea').fill('¡Claro! La incluyo.');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await page.locator('#ds-thread', { hasText: 'La incluyo' }).waitFor();
  check('mensaje enviado', true);
  await page.getByRole('button', { name: 'Marcar en preparación' }).click();
  await page.locator('#ds-status', { hasText: 'En preparación' }).waitFor();
  check('marcar en preparación', true);
  await page.screenshot({ path: shot('conversacion-mobile'), fullPage: true });

  // 4. Volver, ajustes y escritorio
  await page.getByRole('button', { name: '‹ Celebraciones' }).click();
  await page.locator('#ds-list-pane').waitFor({ state: 'visible' });
  check('volver muestra la lista', await page.locator('#ds-detail').isHidden());
  await page.getByRole('link', { name: /Ajustes/ }).click();
  await page.locator('#ds-calendar-status', { hasText: /Fecha|Sin cierre/ }).waitFor();
  check('ajustes cargan la agenda', true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`https://audit.local/apps/inventario#celebraciones/${quoted.id}`);
  await page.locator('#ds-detail:not([hidden])').waitFor();
  check('escritorio: lista y detalle juntos', await page.locator('#ds-list-pane').isVisible() && await page.locator('#ds-detail').isVisible() && !(await page.locator('#ds-back-to-list').isVisible()));
  l = await layout(); check('escritorio: sin desborde ni zonas con desplazamiento propio', l.overflowX <= 0 && !l.scrollers.length && !l.small.length, JSON.stringify(l));
  await page.screenshot({ path: shot('escritorio'), fullPage: true });

  // 5. Al salir no queda nada de las clientas en la página
  await page.evaluate(() => window.dsCelebraciones.destroy());
  const leftover = await page.locator('#ds-app').textContent();
  check('al salir se borran solicitudes y mensajes', !leftover.includes('tres leches') && !leftover.includes('número 60') && await page.locator('#ds-workspace').isHidden());
  // 6. Misma pantalla dentro del admin de Shopify (App Bridge simulado), con el enlace antiguo ?solicitud=
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`https://audit.local/admin?solicitud=${fresh.id}`);
  await page.locator('#ds-detail:not([hidden])').waitFor();
  check('admin de Shopify: ?solicitud= abre el detalle', page.url().endsWith(`#celebraciones/${fresh.id}`));
  await page.getByRole('button', { name: '‹ Celebraciones' }).click();
  await page.locator('#ds-requests a').first().waitFor();
  l = await layout(); check('admin de Shopify móvil: lista sin desborde, táctiles ≥44', l.overflowX <= 0 && !l.small.length, JSON.stringify(l));
  await page.screenshot({ path: shot('shopify-admin-mobile'), fullPage: true });
  check('sin errores de JavaScript', !errors.length, errors.join(' | '));
} finally { await browser.close(); store.close?.(); }
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`);
assert.ok(results.every(r => r.ok), 'celebraciones-ui-check con fallos');
console.log(`celebraciones-ui-check: ${results.length}/${results.length} PASS`);
