// Synthetic email previews only. Never load or persist real access links here.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildQuoteMessage,buildNotificationMessage} from '../services/celebraciones/src/quote-email.mjs';
import {renderEmailHtml} from '../services/celebraciones/src/resend-email.mjs';
const require=createRequire(resolve(process.env.DS_QA_ROOT||'.','qa-runtime.cjs'));
const {chromium}=require('playwright');
const output=resolve(process.env.TEMP||'.','dayanas-email-preview');mkdirSync(output,{recursive:true});
const job={id:'12cfa899-12aa-4c21-8234-4a1234567890',requestId:'12cfa899-12aa-4c21-8234-4a1234567890',reference:'DS-000002',isGuest:true,contact:{name:'Dayana',email:'preview@example.test'}};
const capability='ab'.repeat(32),origin='https://dayanassweet.com';
const samples=[['recibida',buildQuoteMessage(job,capability,origin)],...['propose','comment','preparing','ready'].map(kind=>[kind,buildNotificationMessage({...job,event:{kind:['preparing','ready'].includes(kind)?'setStatus':kind,status:kind}},capability,origin)])];
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const [name,message] of samples){
  const subject=message.match(/^Subject: (.+)$/m)[1].trim(),text=Buffer.from(message.split('\r\n\r\n')[1],'base64').toString('utf8');
  const html=renderEmailHtml({subject,text});writeFileSync(resolve(output,`${name}.html`),html);
  for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:1000}});
   await page.route('**/*',route=>route.abort());await page.setContent(html);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await page.locator('a').count(),1);
   assert.equal(await page.locator('a').getAttribute('href'),text.match(/^https:\/\/\S+$/m)[0]);
   assert.ok(!(await page.locator('body').innerText()).includes(capability));
   assert.match(await page.locator('h1').innerText(),/solicitud|propuesta|mensaje|preparación|listo/i);
   await page.screenshot({path:resolve(output,`${name}-${width}.png`),fullPage:true});await page.close();
  }
 }
 console.log('10 email previews passed: 5 events at 390 and 1440 px; exact private link, no overflow, no visible access token.');
}finally{await browser.close();}
