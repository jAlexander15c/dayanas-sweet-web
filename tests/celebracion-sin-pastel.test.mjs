// «Cotiza tus dulces», parte B: cotización sin pastel, postres o salados, ?agregar= y casilla de novedades.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createStore } from '../services/celebraciones/src/store.mjs';
import { renderFixture } from './helpers/celebracion-fixture.mjs';

const window = { crypto: { randomUUID }, Intl, Date, structuredClone };
vm.runInNewContext(readFileSync('assets/ds-celebracion-solicitud.js', 'utf8'), { window, Intl, Date, URL, URLSearchParams, setTimeout });
const api = window.DSCelebracionSolicitud;
const section = readFileSync('sections/ds-celebracion-solicitud.liquid', 'utf8');
const script = readFileSync('assets/ds-celebracion-solicitud.js', 'utf8');

const future = new Date(Date.now() + 9 * 86400000); future.setUTCHours(18, 0, 0, 0);
const date = { pickupAt: future.toISOString(), urgent: false, label: 'Fecha de prueba · Houston' };
const base = { diameter: 8, tiers: [{ sponges: ['Vainilla', 'Chocolate'], fillings: ['Guayaba', 'Nutella'] }], coating: 'Buttercream', decorations: ['Flores de fondant'], comments: '' };
const customer = { shop: 'bakery.myshopify.com', customerId: '1' };
// El JS corre en otro contexto de vm: sus arreglos tienen otro prototipo, así que se comparan como datos.
const plain = value => JSON.parse(JSON.stringify(value));

test('sin pastel: no envía datos del pastel y los postres o salados van en el texto para Dayana', () => {
  const input = api.buildInput({ ...base, cake: false, extras: '  Croquetas: 30  ' }, date);
  assert.deepEqual(plain(input.details), { pickupAt: date.pickupAt, urgent: false, tiers: [], coating: '', decorations: [], cake: false, extras: 'Croquetas: 30' });
  assert.match(input.requestText, /^Sin pastel: solo postres o salados\.\nPostres o salados: Croquetas: 30\n/);
  assert.doesNotMatch(input.requestText, /Cobertura|Piso 1/);
});

test('con pastel: el texto de siempre, más la línea de extras solo si hay', () => {
  const plain = api.buildInput({ ...base, cake: true, extras: '' }, date);
  assert.match(plain.requestText, /^Pastel personalizado redondo\.\nPiso 1: 8 pulgadas/);
  assert.doesNotMatch(plain.requestText, /Postres o salados/);
  assert.equal(plain.details.cake, true);
  const extra = api.buildInput({ ...base, cake: true, extras: 'Brownie Box: 12' }, date);
  assert.match(extra.requestText, /Decoraciones: Flores de fondant\.\nPostres o salados: Brownie Box: 12\nRecogida solicitada/);
});

test('contrato: el servicio acepta lo que arma el formulario, con y sin pastel', () => {
  const store = createStore(':memory:');
  try {
    for (const [key, selection] of [['con', { ...base, cake: true, extras: '' }], ['con-extras', { ...base, cake: true, extras: 'Pastelitos: 24' }], ['sin', { ...base, cake: false, extras: 'Croquetas: 30' }]]) {
      const input = plain(api.buildInput(selection, date));
      assert.deepEqual(store.createRequest(customer, input, key).details, input.details);
    }
    const empty = plain(api.buildInput({ ...base, cake: false, extras: '   ' }, date));
    assert.throws(() => store.createRequest(customer, empty, 'vacio'), e => e.code === 'VALIDATION');
  } finally { store.close(); }
});

test('?agregar= se limpia: sin caracteres de control, espacios normalizados y tope de 200', () => {
  assert.equal(api.prefillText('?agregar=Brownie%20Box%20%E2%80%93%20Almendras%20%26%20Chocolate'), 'Brownie Box – Almendras & Chocolate');
  assert.equal(api.prefillText('?agregar=%0A%3Cb%3EHola%3C%2Fb%3E%09%20mundo%20'), '<b>Hola</b> mundo');
  assert.equal(api.prefillText('?agregar=' + 'a'.repeat(300)).length, 200);
  assert.equal(api.prefillText(''), '');
  assert.equal(api.prefillText('?otra=1'), '');
  // El valor se asigna como texto (textarea.value y textContent), nunca como HTML.
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML/);
});

test('el formulario pregunta por el pastel y oculta sus campos sin él', () => {
  assert.match(section, /¿Tu pedido incluye pastel\?/);
  assert.match(section, /data-cake="true" aria-pressed="true">Sí, con pastel</);
  assert.match(section, /data-cake="false" aria-pressed="false">Sin pastel, solo postres o salados</);
  assert.match(section, /<div data-cake-fields>[\s\S]*data-floors="1"[\s\S]*data-coating[\s\S]*<\/div>\s*<\/section>/);
  assert.match(section, /<div data-cake-decorations>[\s\S]*data-decoration="2"[\s\S]*<\/div>/);
  assert.match(section, /<textarea data-extras rows="4" maxlength="2000"/);
  assert.match(script, /extras\.required = !value/);
});

test('casilla de novedades: desmarcada, y el formulario de clientas solo se envía si la marcan', () => {
  assert.match(section, /<input type="checkbox" data-newsletter>Quiero recibir novedades y ofertas/);
  assert.doesNotMatch(section, /data-newsletter checked/);
  assert.match(section, /<div data-newsletter-form hidden>\s*\{%- form 'customer' -%\}\s*<input type="hidden" name="contact\[tags\]" value="newsletter">/);
  assert.match(script, /if \(!newsletterSent && q\('\[data-newsletter\]'\)\?\.checked\)/);
  assert.match(script, /\/challenge\\b/);
});

const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
test('navegador: llega desde una ficha, cotiza sin pastel y se suscribe a novedades', { skip: !browserPath, timeout: 30000 }, async () => {
  const fixture = renderFixture({ guest: true });
  const server = createServer((_, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(fixture); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = mkdtempSync(join(tmpdir(), 'ds-request-nocake-'));
  const child = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let socket;
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(portFile); i++) await delay(100);
    assert.ok(existsSync(portFile), 'Chrome no inició');
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    let sequence = 0; const pending = new Map();
    socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, r => r.error ? reject(Error(JSON.stringify(r.error))) : resolve(r.result)); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/pages/pasteles-personalizados?agregar=Brownie%20Box%20%E2%80%93%20Almendras%20%26%20Chocolate` });
    for (let i = 0; i < 100; i++) { if (await evaluate('!!window.DSCelebracionSolicitud && !!document.querySelector("[data-ds-request]").dataset.mounted')) break; await delay(30); }
    const start = await evaluate(`({ extras: document.querySelector('[data-extras]').value, note: document.querySelector('[data-prefill-note]').hidden ? '' : document.querySelector('[data-prefill-note]').textContent })`);
    assert.equal(start.extras, 'Brownie Box – Almendras & Chocolate: ');
    assert.match(start.note, /Ya anotamos «Brownie Box – Almendras & Chocolate»/);
    await evaluate(`document.querySelector('[data-cake="false"]').click()`);
    for (const width of [1180, 390, 320]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `sin pastel, desborde a ${width}`);
    }
    const result = await evaluate(`(async () => {
      const q = s => document.querySelector(s), click = s => q(s).click(), type = (s, v) => { q(s).value = v; q(s).dispatchEvent(new Event('input', {bubbles:true})); };
      const cakeHidden = q('[data-cake-fields]').hidden && q('[data-cake="false"]').getAttribute('aria-pressed') === 'true' && !q('[data-no-cake-note]').hidden;
      const asideNoCake = q('[data-summary]').textContent.includes('Sin pastel');
      click('[data-next]');
      const onIdea = !q('[data-step="1"]').hidden, decorationsHidden = q('[data-cake-decorations]').hidden, required = q('[data-extras]').required;
      type('[data-extras]', '   '); click('[data-next]');
      const emptyBlocked = !q('[data-step="1"]').hidden && q('[data-extras]').getAttribute('aria-invalid') === 'true' && q('[data-extras]').parentElement.textContent.includes('Escribe qué postres o salados');
      type('[data-extras]', 'Brownie Box – Almendras & Chocolate: 12 cajas. Croquetas: 30.'); click('[data-next]');
      q('[data-date]').value = new Date(Date.now()+10*86400000).toISOString().slice(0,10); q('[data-time]').value = '10:00';
      q('[data-contact-name]').value = 'Sofia'; q('[data-contact-email]').value = 'sofia@example.test'; q('[data-contact-phone]').value = '2815550123';
      const newsletterUnchecked = q('[data-newsletter]').checked === false;
      q('[data-newsletter]').checked = true; click('[data-next]');
      const review = q('[data-review]').textContent;
      q('[data-confirm]').checked = true; click('[data-next]');
      for (let i = 0; i < 50 && q('[data-success]').hidden; i++) await new Promise(r => setTimeout(r, 20));
      await new Promise(r => setTimeout(r, 30));
      const create = serviceCalls.find(c => c.url.endsWith('/guest/requests'));
      const body = JSON.parse(create.options.body);
      const contact = serviceCalls.find(c => String(c.url).startsWith('/contact'));
      return { cakeHidden, asideNoCake, onIdea, decorationsHidden, required, emptyBlocked, newsletterUnchecked, review,
        details: body.input.details, requestText: body.input.requestText,
        contact: contact && { email: contact.options.body.get('contact[email]'), tags: contact.options.body.get('contact[tags]'), type: contact.options.body.get('form_type') },
        contactCalls: serviceCalls.filter(c => String(c.url).startsWith('/contact')).length,
        status: q('[data-newsletter-status]').textContent, success: !q('[data-success]').hidden };
    })()`);
    assert.equal(result.cakeHidden, true); assert.equal(result.asideNoCake, true);
    assert.equal(result.onIdea, true); assert.equal(result.decorationsHidden, true); assert.equal(result.required, true);
    assert.equal(result.emptyBlocked, true, 'sin pastel y sin postres no avanza');
    assert.equal(result.newsletterUnchecked, true, 'la casilla empieza desmarcada');
    assert.match(result.review, /Sin pastel/); assert.match(result.review, /Croquetas: 30/);
    assert.equal(result.success, true);
    assert.deepEqual({ ...result.details, pickupAt: 'x' }, { pickupAt: 'x', urgent: false, tiers: [], coating: '', decorations: [], cake: false, extras: 'Brownie Box – Almendras & Chocolate: 12 cajas. Croquetas: 30.' });
    assert.match(result.requestText, /^Sin pastel: solo postres o salados\.\nPostres o salados: Brownie Box/);
    assert.deepEqual(result.contact, { email: 'sofia@example.test', tags: 'newsletter', type: 'customer' });
    assert.equal(result.contactCalls, 1, 'se suscribe una sola vez');
    assert.match(result.status, /^Listo: te escribiremos a sofia@example\.test/);
  } finally {
    socket?.close(); child.kill(); server.close();
  }
});

test('plazo de 12 horas y galería solo con fotos', () => {
  assert.match(section, /cotización en menos de 12 horas/);
  assert.match(section, /\{%- if ds_gallery != blank -%\}/);
  assert.match(section, /"type": "photo"/);
});
