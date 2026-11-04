// Isolated local preview of real panel/tracking assets. No Shopify traffic or credentials.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {renderAdminPage} from '../services/celebraciones/src/admin-page.mjs';
import {createStore} from '../services/celebraciones/src/store.mjs';

const store=createStore(':memory:'),shop='fixture.myshopify.com';
const staff={shop,role:'staff',staffId:'9'},customer={shop,customerId:'7'};
const {id}=store.createRequest(customer,{requestText:'Pastel de vainilla con flores. Datos ficticios para prueba local.',pickup:{label:'Recogida de prueba'}},'create');
store.propose(staff,id,{baseCents:15000,surchargeCents:0,display:'total',canPrepare:'Pastel de vainilla con flores de fondant.',changes:'Sin cambios.',reply:'Prepararemos tu pastel.',paymentMode:'deposit'},'quote');
const shell=(await renderAdminPage({clientId:'fixture',shop}).text()).replace('<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>','<script>window.shopify={idToken:async()=>"local-fixture"};const originalInterval=window.setInterval;window.setInterval=(fn,ms)=>{if(ms===30000)window.fixturePollAlerts=fn;return originalInterval(fn,ms)}</script>');
const liquid=readFileSync('sections/ds-celebracion-seguimiento.liquid','utf8');
const schema=JSON.parse(liquid.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
const settings=Object.fromEntries(schema.settings.filter(s=>s.id).map(s=>[s.id,s.default||'']));
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const markup=liquid.slice(liquid.indexOf('<section'),liquid.indexOf('{% schema %}')).replace(/{{ section.id }}/g,'fixture').replace(/{{ section.settings.(\w+)(?: \| escape)? }}/g,(_,key)=>escape(settings[key])).replace(/{{ shop.(?:permanent_domain|domain) \| escape }}/g,shop);
const tracking=`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/ds-celebracion-seguimiento.css"><body style="margin:0">${markup}<script src="/assets/ds-celebracion-seguimiento.js"></script><script>
const call=async(action,body)=>{const r=await fetch('/fixture/'+action,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw await r.json();return r.json()};
window.controller=DSTracking.mountTracking(document.querySelector('[data-ds-tracking]'),{getTracking:()=>call('snapshot'),acceptProposal:(_,version,operationId)=>call('accept',{version,operationId}),syncPayment:()=>call('snapshot')},${JSON.stringify(id)});
</script></body></html>`;
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(shell);return}
  if(path==='/tracking'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(tracking);return}
  const files={'/admin/assets/admin-ui.js':'services/celebraciones/src/admin-ui.js','/admin/assets/admin-ui.css':'services/celebraciones/src/admin-ui.css','/assets/ds-celebracion-seguimiento.js':'assets/ds-celebracion-seguimiento.js','/assets/ds-celebracion-seguimiento.css':'assets/ds-celebracion-seguimiento.css'};
  if(files[path]){res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');res.end(readFileSync(files[path]));return}
  if(path.startsWith(`/admin/requests/${id}/photos/`)){const photo=store.getPhoto(staff,id,path.split('/').at(-1));res.setHeader('Content-Type',photo.mimeType);res.end(photo.bytes);return}
  let input='';for await(const chunk of req)input+=chunk;const body=input?JSON.parse(input):{};
  let result;
  if(path==='/admin/staff-alerts')result=req.method==='POST'?store.readStaffAlert(staff,body.id):store.listStaffAlerts(staff);
  else if(path==='/admin/requests')result={requests:store.listRequests(staff)};
  else if(path==='/admin/calendar')result={days:[]};
  else if(path===`/admin/requests/${id}`)result=store.getTracking(staff,id);
  else if(path===`/admin/requests/${id}/proposals`)result=store.propose(staff,id,body.proposal,body.operationId);
  else if(path===`/admin/requests/${id}/status`)result=store.setStatus(staff,id,body.status,body.operationId);
  else if(path===`/admin/requests/${id}/delivery-payment`)result=store.recordDeliveryPayment(staff,id,body.proposalVersion,body.operationId);
  else if(path==='/fixture/snapshot')result=store.getTracking(customer,id);
  else if(path==='/fixture/accept')result=store.accept(customer,id,body.version,body.operationId);
  else{res.writeHead(404);res.end();return}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 }catch(error){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({code:error.code||'UNAVAILABLE'}))}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browserPath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(browserPath,'Chrome or Edge required');
const profile=mkdtempSync(join(tmpdir(),'ds-payment-options-'));
const child=spawn(browserPath,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
let socket;
try{
 const portFile=join(profile,'DevToolsActivePort');
 for(let n=0;n<100&&!existsSync(portFile);n++)await delay(100);
 const port=readFileSync(portFile,'utf8').split('\n')[0];
 const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
 socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
 let seq=0;const pending=new Map(),errors=[];
 socket.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);const cb=pending.get(m.id);if(cb){pending.delete(m.id);cb(m)}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(Error(`Timeout ${method}`)),10000);pending.set(id,m=>{clearTimeout(timer);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result)});socket.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 const until=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await delay(50)}throw Error(`Condition timeout: ${expression}`)};
 await call('Runtime.enable');await call('Page.enable');
 const fixturePng=await evaluate(`(()=>{const c=document.createElement('canvas');c.width=1200;c.height=900;const x=c.getContext('2d');x.fillStyle='#fae5ed';x.fillRect(0,0,1200,900);x.fillStyle='#b72956';x.fillRect(300,350,600,300);x.fillStyle='#fff7fa';x.beginPath();x.ellipse(600,350,300,90,0,0,Math.PI*2);x.fill();x.fillStyle='#3a2430';x.font='36px Arial';x.textAlign='center';x.fillText('Referencia ficticia · prueba de ampliación',600,160);return c.toDataURL('image/png').split(',')[1]})()`);
 store.addPhoto(customer,id,{name:'Referencia de prueba.png',mimeType:'image/png',bytes:Buffer.from(fixturePng,'base64')},'photo');
 const viewport=async width=>call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
 const panel=async()=>{await call('Page.navigate',{url:origin});await until(`!!document.querySelector('#ds-requests button') && !document.querySelector('#ds-refresh').disabled`);await evaluate(`document.querySelector('#ds-requests button').click()`);await until(`!document.querySelector('#ds-detail').hidden && !document.querySelector('#ds-refresh').disabled`)};
 const output='docs/maquetas-celebraciones/qa/payment-options';mkdirSync(output,{recursive:true});
 async function capture(name){await delay(100);const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:!name.startsWith('alerts')});writeFileSync(`${output}/${name}.png`,Buffer.from(r.data,'base64'))}
 await viewport(1280);await panel();
 store.comment(customer,id,'Consulta de prueba para la pastelera','customer-notice');
 await evaluate(`document.querySelector('[name=reply]').value='Borrador conservado';document.querySelector('[name=reply]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#ds-alert-refresh').click()`);
 await until(`document.querySelector('#ds-alert-count').textContent==='1 sin leer' && !document.querySelector('#ds-alert-refresh').disabled`);
 assert.equal(await evaluate(`document.querySelector('[name=reply]').value`),'Borrador conservado');
 await evaluate(`document.querySelector('#ds-staff-alerts-card').scrollIntoView({block:'start'})`);await capture('alerts-desktop');
 await viewport(390);await capture('alerts-mobile');
 assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'alerts mobile overflow');
 await evaluate(`Array.from(document.querySelectorAll('#ds-staff-alerts button')).find(b=>b.textContent==='Marcar le'+String.fromCharCode(237)+'do').click()`);
 await until(`document.querySelector('#ds-alert-count').textContent==='0 sin leer' && !document.querySelector('#ds-alert-refresh').disabled`);
 await evaluate(`document.querySelector('#ds-staff-alerts button').click()`);
 await until(`document.activeElement===document.querySelector('#ds-request-title') && !document.querySelector('#ds-refresh').disabled`);
 assert.equal(await evaluate(`document.querySelector('[name=reply]').value`),'Borrador conservado');
 await viewport(1280);

 store.comment(customer,id,'Segunda consulta','customer-notice-2');
 await evaluate(`document.querySelector('[name=reply]').focus();window.fixturePollAlerts()`);
 await until(`document.querySelector('#ds-alert-count').textContent==='1 sin leer'`);
 assert.equal(await evaluate(`document.activeElement===document.querySelector('[name=reply]')`),true,'background alerts preserve focus');
 assert.equal(await evaluate(`document.querySelector('[name=reply]').value`),'Borrador conservado','background alerts preserve draft');
 await until(`!!document.querySelector('#ds-photos button')`);
 await evaluate(`document.querySelector('#ds-photos button').click()`);
 assert.equal(await evaluate(`document.querySelector('#ds-photo-dialog').open`),true);
 assert.equal(await evaluate(`document.querySelector('#ds-photo-full').getAttribute('src').startsWith('blob:')`),true);
 await capture('photo-desktop');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await until(`!document.querySelector('#ds-photo-dialog').open`);
 await until(`document.activeElement===document.querySelector('#ds-photos button')`);
 assert.equal(await evaluate(`document.activeElement===document.querySelector('#ds-photos button')`),true,'focus returns to thumbnail');
 await viewport(390);await evaluate(`document.querySelector('#ds-photos button').click()`);
 assert.equal(await evaluate(`document.querySelector('#ds-photo-dialog').getBoundingClientRect().width<=innerWidth`),true);
 await capture('photo-mobile');
 await evaluate(`document.querySelector('#ds-photo-zoom').click()`);
 assert.equal(await evaluate(`document.querySelector('#ds-photo-zoom').getAttribute('aria-pressed')`),'true');
 assert.equal(await evaluate(`document.querySelector('#ds-photo-view').scrollWidth>document.querySelector('#ds-photo-view').clientWidth`),true,'original photo can be panned on mobile');
 await evaluate(`document.querySelector('#ds-photo-close').click()`);
 assert.equal(await evaluate(`document.querySelector('#ds-photo-dialog').open`),false);
 await viewport(1280);
 for(const mode of ['full','deposit','delivery']){
  await evaluate(`{const select=document.querySelector('[name=paymentMode]');select.value=${JSON.stringify(mode)};select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#ds-proposal-form').requestSubmit()}`);
  await until(`document.querySelector('#ds-feedback').textContent.startsWith('Propuesta enviada.') && !document.querySelector('#ds-refresh').disabled`);
  assert.equal(store.getTracking(staff,id).pendingProposal.paymentMode,mode);
  assert.equal(await evaluate(`document.activeElement===document.querySelector('#ds-feedback')`),true,'proposal confirmation receives focus');
  assert.equal(await evaluate(`(()=>{const r=document.querySelector('#ds-feedback').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`),true,'proposal confirmation is visible');
 }
 assert.match(await evaluate(`document.querySelector('#ds-price-preview').textContent`),/contra entrega/);
 await evaluate(`document.querySelector('#ds-proposal-form').scrollIntoView({block:'center'})`);await capture('panel-desktop');
 await viewport(390);
 assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'panel mobile overflow');
 await evaluate(`document.querySelector('#ds-proposal-form').scrollIntoView({block:'center'})`);await capture('panel-mobile');
 await call('Page.navigate',{url:origin+'/tracking'});await until(`!!window.controller?.state.snapshot && !window.controller.state.busy`);
 assert.match(await evaluate(`document.querySelector('[data-pending-balance]').textContent`),/contra entrega/);
 await evaluate(`document.querySelector('[data-accept]').click()`);await until(`window.controller.state.snapshot.status==='reserved' && !window.controller.state.busy`);
 assert.equal(store.getTracking(customer,id).billing.netPaidCents,0);
 assert.equal(await evaluate(`document.querySelector('[data-pay]').hidden && document.querySelector('[data-payment-link]').hidden`),true);
 assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'tracking mobile overflow');
 await capture('tracking-mobile');await viewport(1280);await capture('tracking-desktop');
 await panel();assert.equal(await evaluate(`document.querySelector('[name=paymentMode]').disabled`),true);
 assert.equal(await evaluate(`document.querySelector('#ds-ready').disabled`),false);
 await evaluate(`document.querySelector('#ds-ready').click()`);await until(`document.querySelector('#ds-status').textContent==='Listo para recoger' && !document.querySelector('#ds-refresh').disabled`);
 assert.equal(store.getTracking(staff,id).payment.stage,'delivery');
 await evaluate(`document.querySelector('#ds-delivery-form').scrollIntoView({block:'center'})`);await capture('receipt-desktop');
 await viewport(390);await evaluate(`document.querySelector('#ds-delivery-form').scrollIntoView({block:'center'})`);await capture('receipt-mobile');
 await evaluate(`document.querySelector('[name=received]').checked=true;document.querySelector('#ds-delivery-form').requestSubmit()`);
 await until(`document.querySelector('#ds-billing-note').textContent.includes('registrado por la pastelera') && !document.querySelector('#ds-refresh').disabled`);
 assert.equal(store.getTracking(staff,id).payment.stage,'paid');assert.equal(store.getTracking(staff,id).payments.length,1);
 await call('Page.navigate',{url:origin+'/tracking'});await until(`window.controller?.state.snapshot?.payment.stage==='paid' && !window.controller.state.busy`);
 assert.match(await evaluate(`document.querySelector('[data-payment-note]').textContent`),/registrado por Dayana/);
 assert.deepEqual(errors,[]);
 console.log('PASS: desktop 1280 / mobile 390, photo opening/zoom/pan/close/Escape/focus, three proposal modes, customer acceptance, delivery reservation, no checkout, ready unpaid, staff receipt and customer confirmation; no runtime errors.');
 console.log(`Screenshots: ${output}`);
}finally{socket?.close();child.kill();await new Promise(resolve=>server.close(resolve));store.close()}
