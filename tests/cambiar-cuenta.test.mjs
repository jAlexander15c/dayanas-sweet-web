// Cotizar con sesión: la cuenta se ve al principio («Usar otra cuenta» cierra sesión antes de llenar nada) y, en
// «¿Cómo te contactamos?», «Enviar con otro nombre y correo» pasa a invitada sin recargar ni perder selección ni fotos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { registerPaginate, registerImageTag } from './helpers/shopify-liquid.mjs';
import { browserPath, openBrowser } from './helpers/celebracion-browser.mjs';

const qaRequire = createRequire(resolve(process.env.DS_QA_ROOT || '.', 'orders-test-runtime.cjs'));
let Liquid;
try { ({ Liquid } = qaRequire('liquidjs')); } catch { Liquid = null; }
const rendered = (name, fn) => test(name, { skip: !Liquid && 'liquidjs no disponible' }, fn);
const ana = { id: 9, name: 'Ana Prueba', email: 'ana@example.test' };

async function renderRequest(customer, guestEnabled = true) {
  const source = readFileSync('sections/ds-celebracion-solicitud.liquid', 'utf8');
  const schema = JSON.parse(source.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  const settings = Object.fromEntries(schema.settings.filter(s => s.id).map(s => [s.id, s.default ?? '']));
  const markup = source.replace(/{%-?\s*schema\s*-?%}[\s\S]*?{%-?\s*endschema\s*-?%}/, '')
    .replace(/{%-?\s*form\s+'customer'[\s\S]*?-?%}/, '<form>').replace(/{%-?\s*endform\s*-?%}/, '</form>');
  const liquid = new Liquid({ root: resolve('snippets'), extname: '.liquid' });
  registerPaginate(liquid);
  registerImageTag(liquid);
  return liquid.parseAndRender(markup, {
    section: { id: 'req', settings: { ...settings, service_enabled: true, guest_enabled: guestEnabled } },
    customer,
    routes: { storefront_login_url: '/account/login', account_logout_url: '/account/logout', root_url: '/' },
    request: { path: '/pages/pasteles-personalizados' },
  });
}
const tagOf = (html, attr) => html.match(new RegExp(`<[^>]*\\s${attr}(?![\\w-])[^>]*>`))?.[0] || '';

rendered('con sesión: la cuenta y «Usar otra cuenta» van antes de los pasos; el contacto ofrece otro nombre y correo', async () => {
  const html = await renderRequest(ana);
  const banner = html.indexOf('data-account-banner'), steps = html.indexOf('ds-request__steps');
  assert.ok(banner > 0 && banner < steps, 'la cuenta se muestra antes de empezar a llenar');
  assert.match(html, /Vas a cotizar como <strong>Ana Prueba<\/strong>/);
  assert.match(tagOf(html, 'data-switch-account'), /href="\/account\/logout\?return_url=%2Fpages%2Fpasteles-personalizados"/);
  assert.match(html, /Usaremos tu cuenta de Shopify: <strong>Ana Prueba<\/strong>/);
  assert.match(tagOf(html, 'data-use-guest'), /<button type="button"/, 'otro nombre y correo es un botón, no una salida de la página');
  assert.match(tagOf(html, 'data-guest-contact'), /\bhidden\b/, 'el contacto de invitada empieza oculto');
  for (const field of ['data-contact-name', 'data-contact-email', 'data-contact-phone']) assert.doesNotMatch(tagOf(html, field), /\brequired\b/, `${field} no es obligatorio con la cuenta`);
  assert.match(html, /data-use-account>Usar mi cuenta \(Ana Prueba\)/);
  assert.match(tagOf(html, 'data-copy-link'), /\bhidden\b/);
  assert.doesNotMatch(html, /lo que llenaste se borrará/);
});

rendered('con sesión y sin modo invitada: solo «Usar otra cuenta» al principio', async () => {
  const html = await renderRequest(ana, false);
  assert.match(html, /data-switch-account/);
  assert.doesNotMatch(html, /data-use-guest|data-guest-contact|data-copy-link/);
});

rendered('sin sesión: ni cuenta ni cambio; el contacto de invitada visible y obligatorio', async () => {
  const html = await renderRequest(null);
  assert.doesNotMatch(html, /data-account-banner|data-switch-account|data-use-guest|data-use-account|Usaremos tu cuenta/);
  assert.doesNotMatch(tagOf(html, 'data-guest-contact'), /\bhidden\b/);
  for (const field of ['data-contact-name', 'data-contact-email', 'data-contact-phone']) assert.match(tagOf(html, field), /\brequired\b/);
  assert.doesNotMatch(tagOf(html, 'data-copy-link'), /\bhidden\b/);
});

// PNG de 1×1: foto de referencia real para comprobar que sobrevive al cambio de modo.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const fillUntilContact = `
  const q = s => document.querySelector(s), click = s => q(s).click(), type = (s, v) => { q(s).value = v; q(s).dispatchEvent(new Event('input', {bubbles:true})); };
  window.failPhoto = false;
  click('[data-floors="2"]'); q('[data-coating]').value = q('[data-coating]').options[1].value; q('[data-coating]').dispatchEvent(new Event('change'));
  click('[data-next]');
  type('[data-extras]', 'Croquetas: 30'); q('[data-decoration="0"]').checked = true; q('[data-decoration="0"]').dispatchEvent(new Event('change'));
  const bytes = Uint8Array.from(atob('${png}'), c => c.charCodeAt(0)), transfer = new DataTransfer();
  transfer.items.add(new File([bytes], 'idea.png', { type: 'image/png' }));
  q('[data-files]').files = transfer.files; q('[data-files]').dispatchEvent(new Event('change'));
  click('[data-next]');
  q('[data-date]').value = new Date(Date.now()+10*86400000).toISOString().slice(0,10); q('[data-time]').value = '10:00';`;

test('navegador: con sesión, «Enviar con otro nombre y correo» no pierde selección ni fotos y envía como invitada', { skip: !browserPath, timeout: 30000 }, async () => {
  const browser = await openBrowser({ guest: false, guestEnabled: true });
  const { cdp, evaluate } = browser;
  try {
    await browser.open('/pages/pasteles-personalizados');
    for (const width of [1180, 390, 320]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `banner de cuenta sin desborde a ${width}`);
      const target = await evaluate(`(() => { const r = document.querySelector('[data-switch-account]').getBoundingClientRect(); return Math.round(r.height); })()`);
      assert.ok(target >= 40, `«Usar otra cuenta» con área táctil suficiente a ${width} (${target} px)`);
    }
    const result = await evaluate(`(async () => {
      ${fillUntilContact}
      const before = { summary: q('[data-summary]').textContent, photos: q('[data-photos]').children.length, guestHidden: q('[data-guest-contact]').hidden };
      click('[data-use-guest]');
      const switched = { guestVisible: !q('[data-guest-contact]').hidden, accountHidden: q('[data-account-contact]').hidden,
        focus: document.activeElement === q('[data-contact-name]'), required: q('[data-contact-email]').required,
        banner: !q('[data-banner-guest]').hidden && q('[data-banner-account]').hidden,
        summary: q('[data-summary]').textContent, photos: q('[data-photos]').children.length, extras: q('[data-extras]').value };
      // Sin datos de contacto no avanza: ahora son obligatorios.
      click('[data-next]');
      const blocked = !q('[data-step="2"]').hidden;
      q('[data-contact-name]').value = 'Sofia'; q('[data-contact-email]').value = 'sofia@example.test'; q('[data-contact-phone]').value = '2815550123';
      click('[data-next]');
      const review = q('[data-review]').textContent;
      q('[data-confirm]').checked = true; click('[data-next]');
      for (let i = 0; i < 80 && q('[data-success]').hidden; i++) await new Promise(r => setTimeout(r, 20));
      const posts = serviceCalls.filter(c => c.options.method === 'POST' && !String(c.url).endsWith('/calendar'));
      const create = JSON.parse(posts.find(c => c.url.endsWith('/guest/requests')).options.body);
      return { before, switched, blocked, review,
        urls: posts.map(c => c.url.replace(/^.*?(\\/guest)?\\/requests/, (m, g) => (g || '') + '/requests')),
        contact: create.contact, tiers: create.input.details.tiers.length, decorations: create.input.details.decorations, extras: create.input.details.extras,
        photoBody: JSON.parse(posts.find(c => c.url.endsWith('/photos')).options.body).name,
        success: !q('[data-success]').hidden, receipt: !q('[data-guest-receipt]').hidden, copy: !q('[data-copy-link]').hidden };
    })()`);
    assert.equal(result.before.guestHidden, true);
    assert.equal(result.before.photos, 1, 'la foto está elegida antes del cambio');
    assert.deepEqual({ ...result.switched, summary: undefined, extras: undefined }, { guestVisible: true, accountHidden: true, focus: true, required: true, banner: true, summary: undefined, photos: 1, extras: undefined });
    assert.equal(result.switched.summary, result.before.summary, 'el resumen no cambia');
    assert.equal(result.switched.extras, 'Croquetas: 30');
    assert.equal(result.blocked, true, 'como invitada, el contacto es obligatorio');
    assert.match(result.review, /Tu contacto\s*Sofia · sofia@example\.test · 2815550123/);
    assert.match(result.review, /1 seleccionadas/);
    assert.deepEqual(result.urls, ['/guest/requests', '/guest/requests'].map((u, i) => i ? u + '/browser-request-1/photos' : u), 'crea y sube la foto por la ruta de invitada');
    assert.deepEqual(result.contact, { name: 'Sofia', email: 'sofia@example.test', phone: '2815550123' });
    assert.equal(result.tiers, 2); assert.deepEqual(result.decorations, ['Topper personalizado']); assert.equal(result.extras, 'Croquetas: 30');
    assert.equal(result.photoBody, 'idea.png');
    assert.deepEqual({ success: result.success, receipt: result.receipt, copy: result.copy }, { success: true, receipt: true, copy: true });
  } finally {
    browser.close();
  }
});

test('navegador: con sesión se puede volver a «Usar mi cuenta» y se envía con la cuenta', { skip: !browserPath, timeout: 30000 }, async () => {
  const browser = await openBrowser({ guest: false, guestEnabled: true });
  try {
    await browser.open('/pages/pasteles-personalizados');
    const result = await browser.evaluate(`(async () => {
      ${fillUntilContact}
      click('[data-use-guest]'); q('[data-contact-email]').value = 'mal'; click('[data-next]');
      const marked = q('[data-contact-email]').getAttribute('aria-invalid') === 'true';
      click('[data-use-account]');
      const back = { accountVisible: !q('[data-account-contact]').hidden, guestHidden: q('[data-guest-contact]').hidden,
        cleared: q('[data-contact-email]').getAttribute('aria-invalid') !== 'true', required: q('[data-contact-email]').required,
        focus: document.activeElement === q('[data-use-guest]'), photos: q('[data-photos]').children.length };
      click('[data-next]');
      const review = q('[data-review]').textContent;
      q('[data-confirm]').checked = true; click('[data-next]');
      for (let i = 0; i < 80 && q('[data-success]').hidden; i++) await new Promise(r => setTimeout(r, 20));
      const posts = serviceCalls.filter(c => c.options.method === 'POST' && !String(c.url).endsWith('/calendar'));
      return { marked, back, review, guestCalls: posts.filter(c => c.url.includes('/guest/')).length,
        create: JSON.parse(posts.find(c => c.url.endsWith('/requests')).options.body), success: !q('[data-success]').hidden, copy: !q('[data-copy-link]').hidden };
    })()`);
    assert.equal(result.marked, true, 'el correo inválido se marcó como invitada');
    assert.deepEqual(result.back, { accountVisible: true, guestHidden: true, cleared: true, required: false, focus: true, photos: 1 });
    assert.doesNotMatch(result.review, /Tu contacto/);
    assert.equal(result.guestCalls, 0, 'con la cuenta no se usa la ruta de invitada');
    assert.equal(result.create.contact, undefined, 'con la cuenta no se envían datos de contacto');
    assert.equal(result.success, true);
    assert.equal(result.copy, false, 'con la cuenta no se ofrece el enlace privado');
  } finally {
    browser.close();
  }
});
