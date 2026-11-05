import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
function fixture() {
  const source=readFileSync('sections/ds-celebracion-seguimiento.liquid','utf8');
  const schema=JSON.parse(source.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  const settings=Object.fromEntries(schema.settings.filter(s=>s.id).map(s=>[s.id,s.default??'']));
  let markup=source.slice(source.indexOf('<section'),source.indexOf('{% schema %}'));
  markup=markup.replace(/{{ section.settings.service_enabled }}/g,'true').replace(/{{ section.settings.guest_enabled }}/g,'false');
  markup=markup.replace(/{{ section.settings.(\w+) \| escape }}/g,(_,key)=>settings[key]);
  markup=markup.replace(/{{ routes.storefront_login_url \| escape }}/g,'/customer_authentication/login?return_to=%2F');
  markup=markup.replace(/{{ shop.permanent_domain \| escape }}/g,'bakery.myshopify.com').replace(/{{ shop.domain \| escape }}/g,'dayanassweet.com').replace(/{{ section.id }}/g,'tracking-qa');
  const proposal={version:1,totalCents:15000,baseCents:15000,surchargeCents:0,display:'total',canPrepare:'Pastel de referencia',changes:'   ',reply:'Propuesta de prueba',expiresAt:null};
  const snapshot={id:'cake-1',version:1,status:'reserved',pickup:{label:'Recogida de prueba'},requestText:'Un pastel rosa',acceptedProposal:proposal,pendingProposal:{...proposal,version:2,expiresAt:new Date(Date.now()+86400000).toISOString()},payments:[{id:'p1',amountCents:9000,status:'confirmed'}],comments:[],history:[],permissions:{canComment:true,canAccept:true}};
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${readFileSync('assets/ds-celebracion-seguimiento.css','utf8')}</style></head><body>${markup}<script>
    window.__trackingFixtureReady=true;window.trackingFixture=${JSON.stringify(snapshot)};
    window.fixtureMode=new URL(location.href).searchParams.get('mode')||'valid';
    window.fetch=async()=>fixtureMode==='valid'?Response.json(trackingFixture):Response.json({code:'AUTH_REQUIRED'},{status:401});
  </script><script>${readFileSync('assets/ds-celebracion-seguimiento.js','utf8')}</script><script>${readFileSync('assets/ds-celebracion-servicio.js','utf8')}</script></body></html>`;
}
test('browser tracking: login return, guest denial, empty changes and live expiry at desktop/mobile', {skip:!browserPath,timeout:30000}, async t=>{
  const server=createServer((_,response)=>{response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(fixture());});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile=mkdtempSync(join(tmpdir(),'ds-tracking-audit-'));
  const child=spawn(browserPath,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
  let socket;
  try {
    const portFile=join(profile,'DevToolsActivePort');
    for(let i=0;i<100&&!existsSync(portFile);i++)await delay(100);
    assert.ok(existsSync(portFile),'Chrome started');
    const port=readFileSync(portFile,'utf8').split('\n')[0];
    const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
    socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
    await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
    let sequence=0;const pending=new Map();
    socket.addEventListener('message',({data})=>{const message=JSON.parse(data);if(pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}});
    const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,r=>r.error?reject(Error(JSON.stringify(r.error))):resolve(r.result));socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
    const navigate=async suffix=>{
      await evaluate('window.__trackingFixtureReady=false');
      await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/pages/seguimiento-de-tu-pastel?solicitud=cake-1${suffix}`});
      for(let i=0;i<100;i++){if(await evaluate('window.__trackingFixtureReady && !!document.querySelector("[data-ds-tracking]")?.dsTrackingController && !document.querySelector("[data-ds-tracking]").dsTrackingController.state.busy'))break;await delay(20);}
    };
    for(const width of [1440,390]) {
      await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
      await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await navigate('&mode=autherror');
      const auth=await evaluate(`(()=>{const a=document.querySelector('[data-login]'),u=new URL(a.href);return {visible:!a.hidden,returnTo:u.searchParams.get('return_to'),origin:u.origin,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      assert.equal(auth.visible,true);assert.equal(auth.returnTo,'/pages/seguimiento-de-tu-pastel?solicitud=cake-1&mode=autherror');assert.equal(auth.overflow,false);
      const loginShot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(profile,`login-${width}.png`),Buffer.from(loginShot.data,'base64'));
      await evaluate(`fixtureMode='valid';document.querySelector('[data-ds-tracking]').dsTrackingController.load()`);
      assert.equal(await evaluate(`document.querySelector('[data-login]').hidden`),true);
      assert.match(await evaluate(`document.querySelector('[data-pending-changes]').textContent`),/Sin cambios respecto a tu referencia/);
      assert.match(await evaluate(`document.querySelector('[data-changes]').textContent`),/Sin cambios respecto a tu referencia/);
      assert.match(await evaluate(`document.querySelector('[data-pending-expiry]').textContent`),/Vigente hasta.*Houston/);
      const limitedComment = await evaluate(`(async()=>{
        const root=document.querySelector('[data-ds-tracking]'), originalFetch=window.fetch;
        trackingFixture.comments=[{id:'confirmed-comment',author:'Cliente',text:'Comentario confirmado antes del límite'}];
        await root.dsTrackingController.load();
        window.fetch=async(path,options)=>path.endsWith('/comments')?Response.json({code:'RATE_LIMITED'},{status:429}):originalFetch(path,options);
        try {
          document.querySelector('[data-comment-input]').value='Comentario rechazado por el límite';
          document.querySelector('[data-comment-form]').requestSubmit();
          for(let attempt=0;attempt<100 && root.dsTrackingController.state.busy;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
          return {message:document.querySelector('[data-action-message]').textContent,input:document.querySelector('[data-comment-input]').value,comments:document.querySelector('[data-comments]').textContent};
        } finally {window.fetch=originalFetch;}
      })()`);
      assert.equal(limitedComment.message,'Has enviado varios mensajes seguidos. Espera un momento antes de enviar otro. Los mensajes confirmados como enviados ya están en la solicitud.');
      assert.equal(limitedComment.input,'Comentario rechazado por el límite');
      assert.match(limitedComment.comments,/Comentario confirmado antes del límite/);
      assert.doesNotMatch(limitedComment.comments,/Comentario rechazado por el límite/);
      await evaluate(`trackingFixture.pendingProposal.expiresAt=new Date(Date.now()+150).toISOString();document.querySelector('[data-ds-tracking]').dsTrackingController.load()`);
      await delay(230);
      assert.equal(await evaluate(`document.querySelector('[data-accept]').disabled`),true);
      assert.match(await evaluate(`document.querySelector('[data-pending-expiry]').textContent`),/venci.*nueva fecha/);
      assert.equal(await evaluate(`document.querySelector('[data-comment-form]').hidden`),false);
      assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true);
      const expiredShot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(profile,`expired-${width}.png`),Buffer.from(expiredShot.data,'base64'));
      const originalAmounts = await evaluate(`({ paid:document.querySelector('[data-paid]').textContent,balance:document.querySelector('[data-balance]').textContent })`);
      for (const reason of ['CHECKOUT_PENDING', 'QUOTE_EXPIRED']) {
        const review = await evaluate(`(async()=>{
          trackingFixture.payment={stage:'review',reviewRequired:true,url:null,reason:'${reason}'};
          await document.querySelector('[data-ds-tracking]').dsTrackingController.load();
          return {note:document.querySelector('[data-payment-note]').textContent,paid:document.querySelector('[data-paid]').textContent,balance:document.querySelector('[data-balance]').textContent,payHidden:document.querySelector('[data-pay]').hidden,linkHidden:document.querySelector('[data-payment-link]').hidden,commentHidden:document.querySelector('[data-comment-form]').hidden};
        })()`);
        assert.match(review.note, reason === 'CHECKOUT_PENDING' ? /checkout anterior.*pendiente/i : /propuesta venci/);
        assert.match(review.note,/No pagues.*enlace anterior/);
        assert.match(review.note,/Dayana/);
        assert.equal(review.paid,originalAmounts.paid);assert.equal(review.balance,originalAmounts.balance);
        assert.equal(review.payHidden,true);assert.equal(review.linkHidden,true);assert.equal(review.commentHidden,false);
      }

      for (const source of ['proposal', 'pickup']) {
        await evaluate(`(async()=>{
          trackingFixture.pendingProposal=null;trackingFixture.payments=[];
          trackingFixture.acceptedProposal.expiresAt=${source == 'proposal' ? "new Date(Date.now()+200).toISOString()" : 'null'};
          trackingFixture.details={pickupAt:${source == 'pickup' ? "new Date(Date.now()+200).toISOString()" : "new Date(Date.now()+86400000).toISOString()"}};
          trackingFixture.payment={stage:'deposit',reviewRequired:false,url:'https://checkout.shopify.com/initial'};
          await document.querySelector('[data-ds-tracking]').dsTrackingController.load();
        })()`);
        assert.equal(await evaluate(`document.querySelector('[data-payment-link]').hidden`),false,`${source} initially payable`);
        await delay(280);
        const expiredPayment = await evaluate(`({linkHidden:document.querySelector('[data-payment-link]').hidden,href:document.querySelector('[data-payment-link]').getAttribute('href'),payHidden:document.querySelector('[data-pay]').hidden,payDisabled:document.querySelector('[data-pay]').disabled,note:document.querySelector('[data-payment-note]').textContent,syncHidden:document.querySelector('[data-payment-sync]').hidden,syncDisabled:document.querySelector('[data-payment-sync]').disabled,paid:document.querySelector('[data-paid]').textContent,balance:document.querySelector('[data-balance]').textContent})`);
        assert.equal(expiredPayment.linkHidden,true);assert.equal(expiredPayment.href,null);assert.equal(expiredPayment.payHidden,true);assert.equal(expiredPayment.payDisabled,true);
        assert.match(expiredPayment.note,/venci/);assert.match(expiredPayment.note,/No pagues.*enlace anterior/);
        assert.equal(expiredPayment.syncHidden,false);assert.equal(expiredPayment.syncDisabled,false);assert.match(expiredPayment.paid,/0[.,]00/);assert.match(expiredPayment.balance,/150[.,]00/);
        assert.equal(await evaluate(`document.querySelector('[data-ds-tracking]').dsTrackingController.syncPayment()`),true);
        await evaluate(`trackingFixture.payment.stage='balance';trackingFixture.payments=[{id:'p1',amountCents:9000,status:'confirmed'}];document.querySelector('[data-ds-tracking]').dsTrackingController.load()`);
        assert.equal(await evaluate(`document.querySelector('[data-payment-link]').hidden`),false,'existing balance remains payable after deadline');
      }

    }
    await navigate('&mode=guesterror#acceso='+ 'ab'.repeat(32));
    assert.equal(await evaluate(`document.querySelector('[data-login]').hidden`),true);
    assert.match(await evaluate(`document.querySelector('[data-status-message]').textContent`),/enlace privado completo/);
    assert.equal(await evaluate('location.hash'),'');
    t.diagnostic(`Local screenshots: ${profile}`);
  } finally {socket?.close();child.kill();server.close();}
});
