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

const window = { crypto: { randomUUID }, Intl, Date, structuredClone };
vm.runInNewContext(readFileSync('assets/ds-celebracion-solicitud.js', 'utf8'), { window, Intl, Date, URL, setTimeout });
const api = window.DSCelebracionSolicitud;
const input = { requestText: 'Mi pastel', pickup: { label: 'Recogida solicitada' }, details: {} };
const file = (name = 'foto.png') => ({ name, type: 'image/png', size: 120, lastModified: 123 });

test('Houston convierte verano/invierno y rechaza hora inexistente por DST', () => {
  assert.equal(api.pickupInfo('2027-07-10', '10:30', 0).pickupAt, '2027-07-10T15:30:00.000Z');
  assert.equal(api.pickupInfo('2027-01-10', '10:30', 0).pickupAt, '2027-01-10T16:30:00.000Z');
  assert.throws(() => api.pickupInfo('2027-03-14', '02:30', 0));
  assert.throws(() => api.pickupInfo('2027-02-30', '10:30', 0));
});
test('plazos desde inicio solicitado: menos de24h rechazado, 24h urgente, 7d normal', () => {
  const at = Date.parse('2027-01-10T16:30:00Z');
  assert.throws(() => api.pickupInfo('2027-01-10', '10:30', at - 24 * 3600000 + 1));
  assert.equal(api.pickupInfo('2027-01-10', '10:30', at - 24 * 3600000).urgent, true);
  assert.equal(api.pickupInfo('2027-01-10', '10:30', at - 168 * 3600000).urgent, false);
});
test('recogida diaria08:00–18:00 inclusive, fecha cerrada no seleccionable', () => {
  assert.equal(api.pickupInfo('2027-07-10', '08:00', 0).pickupAt, '2027-07-10T13:00:00.000Z');
  assert.equal(api.pickupInfo('2027-07-10', '18:00', 0).pickupAt, '2027-07-10T23:00:00.000Z');
  assert.throws(() => api.pickupInfo('2027-07-10', '07:59', 0));
  assert.throws(() => api.pickupInfo('2027-07-10', '18:01', 0));
  assert.throws(() => api.pickupInfo('2027-07-10', '19:00', 0));
  assert.throws(() => api.pickupInfo('2027-07-10', '10:00', 0, ['2027-07-10']));
  assert.equal(api.pickupInfo('2027-07-11', '10:00', 0, ['2027-07-10']).urgent, false);
});
test('calendario solo admite fechas y estados de cierre válidos', () => {
  assert.deepEqual(Array.from(api.validateCalendar({ days: [{ date: '2027-07-10', closed: true }, { date: '2027-07-11', closed: false }] })), ['2027-07-10']);
  assert.throws(() => api.validateCalendar({}));
  assert.throws(() => api.validateCalendar({ days: [{ date: '2027-02-30', closed: true }] }));
  assert.throws(() => api.validateCalendar({ days: [{ date: '2027-07-10', closed: 'false' }] }));
});
test('hasta tres fotos JPEG/PNG/WEBP de2MB, sin SVG ni archivos vacíos', () => {
  assert.equal(api.validatePhotos([file(), file(), file()]).length, 3);
  assert.throws(() => api.validatePhotos([file(), file(), file(), file()]));
  assert.throws(() => api.validatePhotos([{ ...file(), type: 'image/svg+xml' }]));
  assert.throws(() => api.validatePhotos([{ ...file(), size: 2097153 }]));
  assert.throws(() => api.validatePhotos([{ ...file(), size: 0 }]));
});
test('reintento de creación conserva payload y operationId aunque cambie selección', async () => {
  const calls = [];
  const service = { async create(body) { calls.push(structuredClone(body)); if (calls.length === 1) throw Error('offline'); return { id: 'request-1' }; }, async upload() {} };
  const controller = api.createController(service);
  assert.equal(await controller.submit(input, []), false);
  assert.equal(await controller.submit({ ...input, requestText: 'Cambio' }, []), true);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(controller.state.id, 'request-1');
});
test('fallo foto conserva ID y solo reintenta foto pendiente con misma operación', async () => {
  let creates = 0;
  const uploads = [], saved = [];
  const service = { async create() { creates++; return { id: 'request-2' }; }, async upload(id, photo, op) { uploads.push([id, photo.name, op]); if (uploads.length === 2) throw Error('offline'); } };
  const controller = api.createController(service, () => {}, record => saved.push(record));
  assert.equal(await controller.submit(input, [file('a.png'), file('b.png')]), false);
  assert.equal(controller.state.id, 'request-2');
  assert.equal(await controller.submit(input, []), true);
  assert.equal(creates, 1);
  assert.deepEqual(uploads[1], uploads[2]);
  assert.equal(uploads.filter(u => u[1] === 'a.png').length, 1);
  assert.equal(saved.at(-1), null);
});
test('recuperación tras recargar permite adjuntar pendientes sin crear solicitud', async () => {
  const recovery = { id: 'request-3', photos: [{ ...file(), operationId: 'photo-op', done: false }] };
  let upload;
  const controller = api.createController({ create() { assert.fail('no crear otra'); }, async upload(...args) { upload = args; } }, () => {}, () => {}, recovery);
  assert.equal(await controller.submit(input, []), false);
  assert.equal(await controller.submit(input, [file()]), true);
  assert.equal(upload[0], recovery.id);
  assert.equal(upload[2], 'photo-op');
});
test('no se duplica envío concurrente', async () => {
  let finish, calls = 0;
  const controller = api.createController({ create: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = controller.submit(input, []);
  assert.equal(await controller.submit(input, []), false);
  finish({ id: 'request-4' });
  assert.equal(await first, true);
  assert.equal(calls, 1);
});
test('validación rechazada permite editar expresamente sin reutilizar operación anterior', async () => {
  const calls = [];
  const controller = api.createController({ async create(body) { calls.push(body); if (calls.length === 1) throw Object.assign(Error('Revisa'), { code: 'VALIDATION' }); return { id: 'request-6' }; } });
  assert.equal(await controller.submit(input, []), false);
  assert.equal(controller.edit(), true);
  assert.equal(await controller.submit({ ...input, requestText: 'Corregido' }, []), true);
  assert.notEqual(calls[0].operationId, calls[1].operationId);
  assert.equal(calls[1].input.requestText, 'Corregido');
});
test('fallo ambiguo no permite editar intención con una solicitud posiblemente creada', async () => {
  const controller = api.createController({ async create() { throw Error('timeout'); } });
  await controller.submit(input, []);
  assert.equal(controller.edit(), false);
});
test('transporte usa proxy mismo origen y sube binario con nombre codificado', async () => {
  const calls = [];
  window.fetch = async (...args) => { calls.push(args); return { ok: true, json: async () => ({ id: 'request-5' }) }; };
  const service = api.createService('/apps/celebraciones');
  await service.create({ input, operationId: 'abc' });
  const photo = file('mi fotoñ.png');
  await service.upload('request-5', photo, 'photo-op');
  await service.calendar();
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0][1].body), { input, operationId: 'abc' });
  assert.equal(calls[1][0], '/apps/celebraciones/requests/request-5/photos');
  assert.equal(calls[1][1].body, photo);
  assert.equal(calls[1][1].headers['X-File-Name'], encodeURIComponent(photo.name));
  assert.equal(calls[1][1].headers['X-Operation-Id'], 'photo-op');
  assert.equal(calls[2][0], '/apps/celebraciones/calendar');
  assert.equal(calls[2][1].credentials, 'same-origin');
  assert.throws(() => api.createService('https://evil.example'));
});

// Render only the assigned section in memory. This exercises its real DOM/CSS/JS,
// with an isolated service stub, and does not replace Shopify's Liquid renderer.
export function renderFixture() {
  const source = readFileSync('sections/ds-celebracion-solicitud.liquid', 'utf8');
  const schema = JSON.parse(source.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  const settings = Object.fromEntries(schema.settings.filter(s => s.id).map(s => [s.id, s.default ?? '']));
  let markup = source.slice(source.indexOf('<section'), source.indexOf('{% schema %}'));
  markup = markup.replace(/data-customer="[\s\S]*?" data-customer-key/, 'data-customer="true" data-customer-key');
  markup = markup.replace(/<div class="ds-request__note" data-gate[\s\S]*?<\/div>/, '<div data-gate></div>');
  markup = markup.replace(/{% assign ds_diameters[\s\S]*?{% endfor %}/, [6, 8, 10, 12, 14, 16].map(d => `<button type="button" data-diameter="${d}" aria-pressed="${d === 8}">${d}″</button>`).join(''));
  markup = markup.replace(/{{ section.settings.tracking_page.url \| escape }}/g, '/pages/seguimiento');
  markup = markup.replace(/{{ section.settings.service_enabled }}/g, 'true');
  markup = markup.replace(/{{ section.settings.(\w+) \| escape }}/g, (_, key) => settings[key]);
  markup = markup.replace(/{{ section.id }}/g, 'test-section').replace(/{{ customer.id }}/g, '123');
  markup = markup.replace(/{{ customer.name \| escape }}/g, 'Cliente de prueba').replace(/{{ customer.email \| escape }}/g, 'prueba@example.test');
  markup = markup.replace(/{{ routes.account_login_url }}/g, '/account/login').replace(/{{ ds_login_return_url }}/g, '%2Fpages%2Fsolicitud');
  markup = markup.replace(/{%[\s\S]*?%}/g, '');
  return `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${readFileSync('assets/ds-celebracion-solicitud.css', 'utf8')}</style></head><body>${markup}<script>
    window.serviceCalls = []; window.failPhoto = true; window.calendarDays = []; window.failCalendar = false;
    window.fetch = async (url, options = {}) => {
      window.serviceCalls.push({url, options});
      if (url.endsWith('/calendar')) { if(window.failCalendar)throw Error('Calendar offline'); return {ok:true, json:async()=>({days:window.calendarDays})}; }
      if (!options.method) return {ok:true, json:async()=>({requests:[]})};
      if (url.endsWith('/photos') && window.failPhoto) { window.failPhoto=false; throw Error('Offline'); }
      return {ok:true, json:async()=>({id:'browser-request-1'})};
    };
  </script><script>${readFileSync('assets/ds-celebracion-solicitud.js', 'utf8')}</script></body></html>`;
}
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
test('navegador: wizard, sabores por piso, fotos/reintento, bloqueo al enviar y responsive320/390/1180', { skip: !browserPath, timeout: 30000 }, async () => {
  const fixture = renderFixture();
  const server = createServer((_, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(fixture); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = mkdtempSync(join(tmpdir(), 'ds-request-tests-'));
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
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, r => r.error ? reject(Error(JSON.stringify(r.error))) : resolve(r.result)); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    for (let i = 0; i < 100; i++) { if (await evaluate('!!window.DSCelebracionSolicitud && !!document.querySelector("[data-ds-request]").dataset.mounted')) break; await delay(30); }
    assert.equal(await evaluate('document.querySelector("[data-live]").hidden'), false);
    for (const width of [1180, 390, 320]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `overflow ${width}`);
    }
    const result = await evaluate(`(async () => {
      const q = s => document.querySelector(s), click = s => q(s).click(), change = el => el.dispatchEvent(new Event('change', {bubbles:true}));
      click('[data-floors="2"]');
      const second = q('[data-flavors]').children[1].querySelector('select'); second.value='Fresa'; change(second);
      click('[data-floors="1"]'); click('[data-floors="2"]');
      const preserved = q('[data-flavors]').children[1].querySelector('select').value==='Fresa';
      click('[data-next]');
      const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array([137,80,78,71])], 'mi referencia.png', {type:'image/png',lastModified:123}));
      q('[data-files]').files=transfer.files; change(q('[data-files]'));
      q('[data-comments]').value='<img src=x onerror=alert(1)> Mi pastel'; q('[data-comments]').dispatchEvent(new Event('input',{bubbles:true}));
      click('[data-next]');
      const future = new Date(Date.now()+10*86400000); q('[data-date]').value=future.toISOString().slice(0,10); q('[data-time]').value='10:00';
      const requestedDay=q('[data-date]').value;
      q('[data-time]').value='18:01'; click('[data-next]');
      const hoursBlocked=!q('[data-step="2"]').hidden && q('[data-date-status]').textContent.includes('18:00');
      q('[data-time]').value='10:00';
      window.calendarDays=[{date:requestedDay,closed:true}]; click('[data-calendar-retry]'); await new Promise(resolve=>setTimeout(resolve,30)); click('[data-next]');
      const closedBlocked=!q('[data-step="2"]').hidden && q('[data-date-status]').textContent.includes('cerró');
      window.failCalendar=true; click('[data-calendar-retry]'); await new Promise(resolve=>setTimeout(resolve,30)); click('[data-next]');
      const calendarFailureBlocked=!q('[data-step="2"]').hidden && q('[data-date-status]').textContent.includes('calendario');
      window.failCalendar=false; window.calendarDays=[]; click('[data-calendar-retry]'); await new Promise(resolve=>setTimeout(resolve,30));
      click('[data-next]');
      const safe = q('[data-review]').textContent.includes('<img') && !q('[data-review] img');
      q('[data-confirm]').checked=true; click('[data-next]');
      await new Promise(resolve=>setTimeout(resolve,30));
      const partial = !q('[data-created]').hidden && !q('[data-retry]').hidden && q('[data-comments]').disabled;
      click('[data-retry]'); await new Promise(resolve=>setTimeout(resolve,30));
      const creates = window.serviceCalls.filter(c=>c.options.method==='POST'&&!c.url.endsWith('/photos'));
      const uploads = window.serviceCalls.filter(c=>c.url.endsWith('/photos'));
      const body=JSON.parse(creates[0].options.body);
      return {preserved,safe,partial,hoursBlocked,closedBlocked,calendarFailureBlocked,success:!q('[data-success]').hidden,creates:creates.length,uploads:uploads.length,samePhotoOp:uploads[0].options.headers['X-Operation-Id']===uploads[1].options.headers['X-Operation-Id'],diameters:body.input.details.tiers.map(t=>t.diameter),tracking:q('[data-success-link]').getAttribute('href'),recoveryCleared:sessionStorage.length===0};
    })()`);
    assert.deepEqual(result, { preserved: true, safe: true, partial: true, hoursBlocked: true, closedBlocked: true, calendarFailureBlocked: true, success: true, creates: 1, uploads: 2, samePhotoOp: true, diameters: [null, null], tracking: '/pages/seguimiento?solicitud=browser-request-1', recoveryCleared: true });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-next]")).animationName'), 'none');
  } finally { socket?.close(); child.kill(); server.close(); }
});
