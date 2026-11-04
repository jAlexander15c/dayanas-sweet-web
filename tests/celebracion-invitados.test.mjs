import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const capability = 'ab'.repeat(32);
function submission(fetch) {
  const window = { crypto: webcrypto, fetch, btoa: value => Buffer.from(value, 'binary').toString('base64') };
  vm.runInNewContext(readFileSync('assets/ds-celebracion-solicitud.js', 'utf8'), { window, URL, Uint8Array, Intl, Date });
  return window.DSCelebracionSolicitud;
}
function transport(fetch) {
  const context = { fetch, URL, URLSearchParams, AbortController, setTimeout, clearTimeout };
  vm.runInNewContext(readFileSync('assets/ds-celebracion-servicio.js', 'utf8'), context);
  return context.DSTrackingService;
}
const contact = { name: 'Sofía', email: 'sofia@example.com', phone: '(281) 555-0123' };
const input = { requestText: 'Mi pastel' };
const photo = { name: 'foto.png', type: 'image/png', size: 4, lastModified: 1, arrayBuffer: async () => Uint8Array.from([137,80,78,71]).buffer };
test('guest persists capability and immutable creation intent before a lost response, including photo operations', async () => {
  const api = submission(); let saved, first;
  const initial = api.createController({ create: async body => { first = structuredClone(body); assert.equal(saved.intent.capability, body.capability); throw Error('lost'); } }, () => {}, value => { saved = structuredClone(value); }, null, { guest: true });
  assert.equal(await initial.submit(input, [photo], contact), false);
  assert.match(first.capability, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.contact, contact);
  assert.equal(first.website, '');
  const photoOperation = saved.photos[0].operationId;
  const uploads = []; let created = 0;
  const recovered = api.createController({ create: async body => { created++; assert.deepEqual(structuredClone(body), first); return { id: 'guest-1', reference: 'DS-000001', emailStatus: 'pending', contact }; }, upload: async (...args) => uploads.push(args) }, () => {}, value => { saved = structuredClone(value); }, saved, { guest: true });
  assert.equal(await recovered.submit({ requestText: 'changed' }, []), false);
  assert.equal(recovered.state.id, 'guest-1');
  assert.equal(await recovered.submit(null, [photo]), true);
  assert.equal(created, 1);
  assert.equal(uploads[0][2], photoOperation);
  assert.equal(uploads[0][3], first.capability);
  assert.equal(recovered.state.snapshot.reference, 'DS-000001');
});
test('guest transport uses JSON POST for public calendar, creation and base64 photo upload', async () => {
  const calls = [];
  const api = submission(async (path, options) => { calls.push({path,options}); return Response.json({ id: 'guest-1' }); });
  const service = api.createService('/apps/celebraciones', { guest: true });
  await service.calendar(); await service.create({input,contact,capability,operationId:'create-1',website:''}); await service.upload('guest-1',photo,'photo-1',capability);
  assert.deepEqual(calls.map(c => c.path), ['/apps/celebraciones/guest/calendar','/apps/celebraciones/guest/requests','/apps/celebraciones/guest/requests/guest-1/photos']);
  assert.ok(calls.every(c => c.options.method === 'POST' && !c.path.includes(capability)));
  assert.deepEqual(JSON.parse(calls[2].options.body), { capability, name:'foto.png', mimeType:'image/png', base64:'iVBORw==', operationId:'photo-1' });
});
test('all guest tracking operations and private photo reads send capability only in POST body', async () => {
  const calls = [];
  const api = transport(async (path,options) => { calls.push({path,options}); return path.endsWith('/photos/photo-1') ? new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}}) : Response.json({id:'guest-1'}); });
  const service = api.createHttpService('/apps/celebraciones',capability);
  await service.getTracking('guest-1'); await service.postComment('guest-1','Hola','comment-1'); await service.acceptProposal('guest-1',2,'accept-1'); await service.startPayment('guest-1','pay-1'); await service.syncPayment('guest-1','sync-1');
  const blob = await service.getPhoto('guest-1','photo-1');
  assert.equal(blob.type,'image/png');
  assert.ok(calls.every(c => c.options.method==='POST' && JSON.parse(c.options.body).capability===capability && !c.path.includes(capability)));
  assert.equal(calls[0].path,'/apps/celebraciones/guest/requests/guest-1/tracking');
  assert.throws(() => api.createHttpService('/apps/celebraciones','bad'));
});
test('capture removes fragment immediately and recovers access only for its request from session storage', () => {
  const api = transport(); const values = new Map(); const storage = {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  let clean;
  const access = api.captureAccess({href:`https://dayanassweet.com/pages/seguimiento?solicitud=guest-1#acceso=${capability}`},{replaceState:(_state,_title,url)=>{clean=url;}},storage);
  assert.equal(access.capability, capability); assert.equal(clean,'/pages/seguimiento?solicitud=guest-1');
  assert.equal(api.captureAccess({href:'https://dayanassweet.com/pages/seguimiento?solicitud=guest-1'},{},storage).capability,capability);
  assert.equal(api.captureAccess({href:'https://dayanassweet.com/pages/seguimiento?solicitud=guest-2'},{},storage).capability,null);
});
test('private photo blobs are revoked on replacement/exit and late responses cannot recreate a cleared image', async () => {
  const context = { Intl, URL };
  vm.runInNewContext(readFileSync('assets/ds-celebracion-seguimiento.js','utf8'), context);
  const node = () => ({ children: [], append(...items) { this.children.push(...items); }, prepend(item) { this.children.unshift(item); }, replaceChildren() { this.children=[]; } });
  const container=node(); container.ownerDocument={createElement:node};
  const revoked=[]; let sequence=0, resolve;
  const urls={createObjectURL:()=>`blob:private-${++sequence}`,revokeObjectURL:url=>revoked.push(url)};
  let waiting=false;
  const service={getPhoto:async()=>waiting?await new Promise(done=>{resolve=done;}):new Blob(['photo'],{type:'image/png'})};
  const gallery=context.DSTracking.createPhotoGallery(container,service,'guest-1',urls);
  await gallery.render([{id:'photo-1',name:'foto.png',mimeType:'image/png'}]);
  assert.equal(container.children[0].children[0].src,'blob:private-1');
  await gallery.render([]); assert.deepEqual(revoked,['blob:private-1']);
  waiting=true;
  const pending=gallery.render([{id:'photo-2',name:'otra.png',mimeType:'image/png'}]);
  gallery.clear(); resolve(new Blob(['photo'],{type:'image/png'})); await pending;
  assert.equal(sequence,1); assert.equal(container.children.length,0);
});
test('guest contact validation and honeypot reject before sending and guest service exposes no listing', async () => {
  const api=submission();
  assert.throws(()=>api.validContact({...contact,email:'invalid'}));
  assert.throws(()=>api.validContact({...contact,phone:'12'}));
  let calls=0;
  const controller=api.createController({create:async()=>{calls++;}},()=>{},()=>{},null,{guest:true});
  assert.equal(await controller.submit(input,[],contact,'https://spam.example'),false); assert.equal(calls,0);
  assert.equal(api.createService('/apps/celebraciones',{guest:true}).list,undefined);
});
test('malformed fragment is cleared and never falls back to a stored or authenticated capability', () => {
  const api=transport(); let cleared=false;
  const access=api.captureAccess({href:'https://dayanassweet.com/pages/seguimiento?solicitud=guest-1#acceso=bad'}, {replaceState:()=>{cleared=true;}}, {getItem:()=>capability});
  assert.equal(cleared,true); assert.equal(access.invalid,true); assert.equal(access.capability,null);
});
test('quota errors show a wait message and preserve the durable operation for a later retry', async () => {
  const api=submission(async()=>Response.json({code:'RATE_LIMITED'},{status:429}));
  const controller=api.createController(api.createService('/apps/celebraciones',{guest:true}),()=>{},()=>{},null,{guest:true});
  assert.equal(await controller.submit(input,[],contact),false);
  assert.equal(controller.state.errorCode,'RATE_LIMITED');
  assert.match(controller.state.error,/l.mite temporal.*m.s tarde/);
  assert.ok(controller.state.intent.operationId);
});
