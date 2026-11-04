// Local UI contract test with synthetic responses. No Shopify or email calls.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {renderAdminPage} from '../services/celebraciones/src/admin-page.mjs';
const require=createRequire(resolve(process.env.DS_QA_ROOT||'.','qa-runtime.cjs'));
const {chromium}=require('playwright');const browser=await chromium.launch({channel:'chrome',headless:true});
const output=resolve(process.env.TEMP||'.','dayanas-admin-audit');mkdirSync(output,{recursive:true});
try{
 for(const width of [1440,390]){
  let retries=0;const errors=[];
  const snapshot={id:'old-request',reference:'DS-000001',version:2,status:'reserved',contact:{name:'Ana',email:'ana@example.test',phone:'5551234567'},pickup:{label:'Houston'},requestText:'Pastel',acceptedProposal:{version:1,totalCents:10000,baseCents:10000,surchargeCents:0,display:'total',canPrepare:'Pastel',changes:'',reply:'Propuesta'},pendingProposal:null,payments:[],comments:[],history:[],billing:{proposalVersion:1,currency:'USD',totalCents:10000,taxCents:0,netPaidCents:0,balanceDueCents:10000},payment:{stage:'balance',reviewRequired:false},permissions:{canComment:true,canAccept:false,canPrepare:false,canPropose:true},notifications:[{id:'notice-failed',kind:'comment',status:'failed'},{id:'notice-unknown',kind:'propose',status:'unknown'}]};
  const html=await(renderAdminPage({shop:'test.myshopify.com',clientId:'test'})).text();
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://panel.test/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname;
   if(path==='/admin')return route.fulfill({contentType:'text/html',body:html});
   if(path.startsWith('/admin/assets/'))return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(`services/celebraciones/src/${path.split('/').at(-1)}`,'utf8')});
   if(path==='/admin/calendar')return route.fulfill({json:{days:[]}});
   if(path==='/admin/requests')return route.fulfill({json:url.searchParams.has('cursor')||url.searchParams.has('q')?{requests:[snapshot],nextCursor:null}:{requests:[{...snapshot,id:'recent-request',reference:'DS-000101'}],nextCursor:'50'}});
   if(path.endsWith('/email-retry')){retries++;snapshot.version++;snapshot.notifications[0].status='pending';}
   if(path.endsWith('/payment-sync')){snapshot.version++;snapshot.billing.netPaidCents=6000;snapshot.billing.balanceDueCents=4000;snapshot.permissions.canPrepare=true;}
   return route.fulfill({json:snapshot});
  });
  await page.route('https://cdn.shopify.com/**',route=>route.fulfill({contentType:'text/javascript',body:'window.shopify={idToken:async()=>"test-token"};'}));
  await page.goto('https://panel.test/admin');await page.locator('#ds-more').click();await page.locator('#ds-requests button').nth(1).waitFor();
  assert.equal(await page.locator('#ds-requests button').count(),2);assert.equal(await page.locator('#ds-more').isVisible(),false);
  await page.locator('#ds-search').fill('DS-000001');await page.locator('#ds-search-form button').click();
  await page.waitForFunction(()=>document.querySelectorAll('#ds-requests button').length===1);
  assert.equal(await page.locator('#ds-requests button').count(),1);await page.locator('#ds-requests button').click();await page.locator('#ds-detail').waitFor({state:'visible'});
  assert.equal(await page.locator('#ds-preparing').isDisabled(),true);
  assert.equal(await page.locator('#ds-notifications button').count(),1,'unknown has no blind retry');
  await page.locator('#ds-notifications button').click();await page.waitForFunction(()=>document.querySelector('#ds-notifications').innerText.includes('Pendiente de envío'));assert.equal(retries,1);
  assert.equal(await page.locator('#ds-notifications button').count(),0);assert.match(await page.locator('#ds-notifications').innerText(),/Pendiente de envío/);
  await page.locator('#ds-payment-sync').click();await page.waitForFunction(()=>!document.querySelector('#ds-preparing').disabled);assert.equal(await page.locator('#ds-preparing').isEnabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve(output,`panel-${width}.png`),fullPage:true});
  await page.locator('#ds-back-to-list').click();assert.equal(await page.locator('#ds-detail').isVisible(),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,pagination:true,search:true,failedEmailRetry:true,ambiguousEmailProtected:true,preparationFundsGuard:true}));await page.close();
 }
}finally{await browser.close();}
