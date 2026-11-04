// Read-only visual check of the unpublished theme; never submits a request.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
const require=createRequire(resolve(process.env.DS_QA_ROOT,'qa-runtime.cjs'));
const {chromium}=require('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try {
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://dayanassweet.com/pages/pasteles-personalizados?preview_theme_id=189886300464');
  await page.locator('[data-next]').click();
  await page.locator('[data-next]').click();
  await page.locator('[data-contact-name]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-contact-email]').isVisible(),true);
  assert.equal(await page.locator('[data-contact-phone]').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`docs/qa-cotizacion-invitados/tema-qa-contacto-${width}.png`,fullPage:true});
  results.push({width,contactFieldsVisible:true,noOverflow:true,pageErrors:errors});
  await context.close();
 }
 writeFileSync('docs/qa-cotizacion-invitados/remote-browser-results.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
} finally {await browser.close();}
