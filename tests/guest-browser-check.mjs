// Run against tests/guest-preview-server.mjs; all data is synthetic and local.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(resolve(process.env.DS_QA_ROOT||'.','qa-runtime.cjs'));
const {chromium}=require('playwright');
const origin='http://127.0.0.1:8793',output='docs/qa-cotizacion-invitados';
mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try {
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  await context.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('blob:')?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.locator('[data-live]').waitFor({state:'visible'});
  await page.locator('[data-next]').click();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=','base64');
  await page.locator('[data-files]').setInputFiles({name:'referencia.png',mimeType:'image/png',buffer:png});
  await page.locator('textarea[data-comments]').fill('Prueba local: flores rosadas.');
  await page.locator('[data-next]').click();
  const future=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
  await page.locator('[data-date]').fill(future);await page.locator('[data-time]').fill('12:00');
  await page.locator('[data-contact-name]').fill('Cliente de prueba');
  await page.locator('[data-contact-email]').fill('cliente@example.com');
  await page.locator('[data-contact-phone]').fill('5551234567');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${output}/contacto-${width}.png`,fullPage:true});
  await page.locator('[data-next]').click();await page.locator('[data-step="3"] input[type="checkbox"]').check();await page.locator('[data-next]').click();
  await page.locator('[data-success]').waitFor({state:'visible'});
  const reference=await page.locator('[data-reference]').innerText();assert.match(reference,/^DS-\d{6}$/);
  const link=await page.locator('[data-success-link]').getAttribute('href');assert.match(link,/#acceso=[a-f0-9]{64}$/);
  assert.match(await page.locator('[data-email-status]').innerText(),/preparando/);
  await page.screenshot({path:`${output}/confirmacion-${width}.png`,fullPage:true});
  await page.locator('[data-success-link]').click();
  await page.locator('[data-comment-input]').waitFor({state:'visible'});
  assert.equal(new URL(page.url()).hash,'');
  await page.locator('[data-comment-input]').fill('Comentario privado de prueba');await page.locator('[data-send]').click();
  await page.getByText('Comentario privado de prueba',{exact:true}).waitFor();
  await page.reload();await page.getByText('Comentario privado de prueba',{exact:true}).waitFor();
  const images=await page.locator('img[src^="blob:"]').count();assert.ok(images>0,'private photo displayed');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${output}/seguimiento-${width}.png`,fullPage:true});
  const isolated=await browser.newContext();const denied=await isolated.newPage();await denied.goto(page.url());
  await denied.locator('[data-status-message]').waitFor({state:'visible'});
  assert.equal(await denied.locator('[data-comment-input]').isVisible(),false);
  await isolated.close();assert.deepEqual(errors,[]);results.push({width,reference,creation:true,photo:true,comment:true,reload:true,fragmentRemoved:true,isolatedWithoutLink:true,noOverflow:true,pageErrors:errors});
  await context.close();
 }
 writeFileSync(`${output}/browser-results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
