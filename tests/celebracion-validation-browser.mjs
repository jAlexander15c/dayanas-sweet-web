// Local preview only; synthetic data and no real mail or payments.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {renderAdminPage} from '../services/celebraciones/src/admin-page.mjs';
const require=createRequire(resolve(process.env.DS_QA_ROOT||'.','qa-runtime.cjs'));
const {chromium}=require('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const output=resolve(process.env.TEMP||'.','dayanas-validation-qa');mkdirSync(output,{recursive:true});
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:8793');await page.locator('[data-next]').click();await page.locator('[data-next]').click();await page.locator('[data-next]').click();
  assert.equal(await page.locator('[aria-invalid="true"]').count(),5,'all missing contact/date fields marked together');
  assert.equal(await page.locator('[data-field-error]:visible').count(),5);
  assert.equal(await page.locator('[data-comments]').getAttribute('required'),null);
  await page.screenshot({path:resolve(output,`missing-${width}.png`),fullPage:true});
  const day=new Date(Date.now()+20*86400000).toISOString().slice(0,10);
  for(const [field,value] of [['date',day],['time','10:00'],['contact-name','Ana'],['contact-email','ana@example.test'],['contact-phone','123']])await page.locator(`[data-${field}]`).fill(value);
  await page.locator('[data-next]').click();assert.equal(await page.locator('[data-contact-phone]').getAttribute('aria-invalid'),'true');
  await page.locator('[data-contact-phone]').fill('5551234567');await page.locator('[data-next]').click();
  assert.equal(await page.locator('[data-step="3"]').isVisible(),true,'empty notes accepted');
  await page.locator('[data-next]').click();assert.equal(await page.locator('[data-confirm]').getAttribute('aria-invalid'),'true');
  await page.locator('[data-confirm]').check();assert.equal(await page.locator('[aria-invalid="true"]').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const snapshot={id:'test-request',version:1,status:'requested',pickup:{label:'Recogida de prueba'},requestText:'Pastel de prueba',payments:[],comments:[],history:[],acceptedProposal:null,pendingProposal:null,permissions:{canComment:true}};
  const html=await (renderAdminPage({shop:'test.myshopify.com',clientId:'test'})).text();
  await page.route('https://panel.test/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/admin')return route.fulfill({contentType:'text/html',body:html});
   if(path.startsWith('/admin/assets/'))return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(`services/celebraciones/src/${path.split('/').at(-1)}`,'utf8')});
   return route.fulfill({json:path==='/admin/requests'?{requests:[snapshot]}:path==='/admin/calendar'?{days:[]}:snapshot});
  });
  await page.route('https://cdn.shopify.com/**',route=>route.fulfill({contentType:'text/javascript',body:'window.shopify={idToken:async()=>"test-token"};'}));
  await page.goto('https://panel.test/admin');await page.locator('#ds-requests button').click();
  await page.locator('[name="canPrepare"]').fill('Borrador conservado');
  await page.locator('#ds-back-to-list').click();assert.equal(await page.locator('#ds-detail').isVisible(),false);
  await page.locator('#ds-requests button').click();assert.equal(await page.locator('[name="canPrepare"]').inputValue(),'Borrador conservado');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve(output,`back-${width}.png`),fullPage:true});assert.deepEqual(errors,[]);await page.close();
  console.log(JSON.stringify({width,requiredFields:true,inlineErrors:true,optionalNotes:true,backPreservesDraft:true,noOverflow:true}));
 }
}finally{await browser.close();}
