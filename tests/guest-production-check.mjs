// Authorized end-to-end commissioning. Creates a labelled QA request and unpaid draft.
// Does not submit payment, print private links, or persist credentials.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(resolve(process.env.DS_QA_ROOT,'qa-runtime.cjs'));
const {chromium}=require('playwright');
const output='docs/qa-cotizacion-invitados';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results={};let step='start';
const adminTab='65108f35-91df-4e33-b8b6-ffa63b3db01c';
function orca(command){return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`orca ${command} --json`],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
async function admin(path,body){
 orca(`reload --page ${adminTab}`);orca(`wait --page ${adminTab} --selector iframe`);
 const r=orca(`eval --page ${adminTab} --expression "new URL(document.querySelector('iframe').src).searchParams.get('id_token')"`);
 assert.equal(r.ok,true);let token=r.result.result;
 try{const response=await fetch('https://dayanas-celebraciones.dayanas-celebraciones-service.workers.dev/admin'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,200,`admin ${path} HTTP ${response.status}`);return response.json();}finally{token=null;}
}
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.name));
 if(process.env.DS_QA_LINK){
  const link=new URL(process.env.DS_QA_LINK);delete process.env.DS_QA_LINK;
  results.requestId=link.searchParams.get('solicitud');results.reference='DS-000001';
  link.searchParams.set('preview_theme_id','189886300464');await page.goto(link.href);
  await page.locator('[data-comment-input]').waitFor({state:'visible'});
  results.photo=true;results.reload=true;results.privateAccess=true;
 }else{
 step='form';await page.goto('https://dayanassweet.com/pages/pasteles-personalizados?preview_theme_id=189886300464');
 await page.locator('[data-next]').click();
 await page.locator('[data-files]').setInputFiles({name:'QA-prueba-no-preparar.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=','base64')});
 await page.locator('textarea[data-comments]').fill('PRUEBA QA AUTORIZADA: no preparar, no reservar, no cobrar. Validación técnica de cotización invitada.');
 await page.locator('[data-next]').click();
 await page.locator('[data-date]').fill(new Date(Date.now()+10*86400000).toISOString().slice(0,10));
 await page.locator('[data-time]').fill('12:00');
 await page.locator('[data-contact-name]').fill('PRUEBA QA — NO PREPARAR');
 await page.locator('[data-contact-email]').fill('info@dayanassweet.com');
 await page.locator('[data-contact-phone]').fill('2025550100');
 await page.screenshot({path:`${output}/real-contacto-1440.png`,fullPage:true});
 await page.locator('[data-next]').click();
 step='create';await page.locator('[data-step="3"] input[type="checkbox"]').check();await page.locator('[data-next]').click();
 await page.locator('[data-success]').waitFor({state:'visible',timeout:30000});
 results.reference=await page.locator('[data-reference]').innerText();
 const link=await page.locator('[data-success-link]').getAttribute('href');
 const tracking=new URL(link,page.url());results.requestId=tracking.searchParams.get('solicitud');
 assert.match(tracking.hash,/#acceso=[a-f0-9]{64}$/);
 console.log(JSON.stringify({step:'created',...results}));
 await page.locator('[data-success-link]').click();step='tracking';
 await page.locator('[data-comment-input]').waitFor({state:'visible'});assert.equal(new URL(page.url()).hash,'');
 await page.locator('[data-comment-input]').fill('QA cliente: comprobación de conversación privada.');await page.locator('[data-send]').click();
 await page.getByText('QA cliente: comprobación de conversación privada.',{exact:true}).waitFor();
 await page.reload();await page.getByText('QA cliente: comprobación de conversación privada.',{exact:true}).waitFor();
 await page.locator('img[src^="blob:"]').first().waitFor();results.photo=true;results.reload=true;
 const isolated=await browser.newContext();const denied=await isolated.newPage();await denied.goto(page.url());await denied.locator('[data-status-message]').waitFor({state:'visible'});assert.equal(await denied.locator('[data-comment-input]').isVisible(),false);await isolated.close();results.privateAccess=true;
 }
 step='admin-reply';await admin(`/requests/${results.requestId}/comments`,{text:'QA Dayana: recibimos la referencia. Prueba técnica, no preparar ni cobrar.',operationId:'qa-staff-reply'});
 step='proposal';await admin(`/requests/${results.requestId}/proposals`,{proposal:{baseCents:10000,surchargeCents:0,display:'total',canPrepare:'PRUEBA QA: pastel simulado, no preparar.',changes:'',reply:'Cotización técnica de USD 100. No realizar pago.'},operationId:'qa-proposal'});
 await page.reload();await page.locator('[data-accept]').waitFor({state:'visible'});
 await page.screenshot({path:`${output}/real-propuesta-1440.png`,fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:`${output}/real-propuesta-390.png`,fullPage:true});
 step='accept';await page.locator('[data-accept]').click();await page.locator('[data-pay]').waitFor({state:'visible'});
 step='payment-link';await page.locator('[data-pay]').click();await page.locator('[data-payment-link]').waitFor({state:'visible',timeout:30000});
 const invoice=await page.locator('[data-payment-link]').getAttribute('href');assert.equal(new URL(invoice).protocol,'https:');
 const snapshot=await admin(`/requests/${results.requestId}`);results.emailStatus=snapshot.emailStatus;results.paymentStage=snapshot.payment.stage;results.status=snapshot.status;
 assert.equal(snapshot.status,'quoted');assert.equal(snapshot.payment.stage,'deposit');
 step='checkout';const checkout=await context.newPage();await checkout.goto(invoice);await checkout.waitForLoadState('domcontentloaded');
 await checkout.screenshot({path:`${output}/real-checkout-390.png`,fullPage:true});
 const text=await checkout.locator('body').innerText();
 results.checkoutHasPayment=/Payment|Pago|Pagar|Pay now|Pay deposit/i.test(text);results.checkoutHasDeposit=/60[.,]00/.test(text);assert.equal(results.checkoutHasPayment,true);assert.equal(results.checkoutHasDeposit,true);
 results.checkoutOpened=true;results.charged=false;results.pageErrors=errors;assert.deepEqual(errors,[]);
 await admin(`/requests/${results.requestId}/comments`,{text:'QA FINALIZADA: checkout revisado sin pagar. No preparar ni cobrar esta solicitud de prueba.',operationId:'qa-complete'});
 writeFileSync(`${output}/production-browser-results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}catch(error){console.error(JSON.stringify({step,...results,error:error.name,message:error.message.replace(/https?:\/\/\S+/g,'[URL omitted]')}));process.exitCode=1;}
finally{await browser.close();}
