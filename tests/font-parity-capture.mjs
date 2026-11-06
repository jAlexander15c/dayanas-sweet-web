// Read-only live capture, then replay the same responses with only local font changes.
// DS_QA_ROOT must contain the official playwright package. No Shopify writes.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(resolve(process.env.DS_QA_ROOT||'.','font-qa.cjs'));
const {chromium}=require('playwright');
const phase=process.argv[2],out=resolve(process.argv[3]||'font-parity');
if(!['before','after'].includes(phase))throw Error('Expected before or after');
mkdirSync(join(out,'cache'),{recursive:true});
const pages=[['inicio','/'],['coleccion','/collections/brownies'],['producto','/products/tomate-confitada'],['contacto','/pages/contact'],['pasteles','/pages/pasteles-personalizados']];
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{
 for(const [name,path] of pages)for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1,locale:'es-US',reducedMotion:'reduce',serviceWorkers:'block'});
  const page=await context.newPage(),fonts=new Map(),errors=[],captures=[];
  await page.clock.setFixedTime(new Date('2026-11-05T16:00:00Z'));
  page.on('response',response=>{
   if(phase==='before'&&response.request().isNavigationRequest()&&response.status()===200)captures.push((async()=>{
    const key=createHash('sha256').update(response.url()).digest('hex');
    writeFileSync(join(out,'cache',key+'.json'),JSON.stringify({url:response.url(),status:response.status(),headers:response.headers(),body:(await response.body()).toString('base64')}));
   })());
  });
  await context.route('**/*',async route=>{
   const req=route.request(),url=req.url(),u=new URL(url);
   if(req.method()!=='GET'||/monorail|analytics|web-pixels|trekkie|shop_events|\/checkouts\/|login_with_shop\/authorize/i.test(url)){await route.abort();return;}
   const key=createHash('sha256').update(url).digest('hex'),file=join(out,'cache',key+'.json');
   try{
    let cached;
    if(existsSync(file))cached=JSON.parse(readFileSync(file,'utf8'));
    if(phase==='after'&&/\/assets\/ds-r-font-[^/]+\.woff2$/.test(u.pathname))cached={status:200,headers:{'content-type':'font/woff2','access-control-allow-origin':'*'},body:readFileSync('assets/'+u.pathname.split('/').at(-1)).toString('base64')};
    if(phase==='before'&&req.isNavigationRequest()&&cached?.status!==200){await route.continue();return;}
    if(!cached){
     if(phase==='after')throw Error('Uncached resource '+url);
     const response=await route.fetch(),body=await response.body();
     cached={url,status:response.status(),headers:response.headers(),body:body.toString('base64')};
     writeFileSync(file,JSON.stringify(cached));
    }
    let body=Buffer.from(cached.body,'base64'),headers={...cached.headers};
    delete headers['content-encoding'];delete headers['content-length'];
    if(phase==='after'){
     if(/\/assets\/ds-redesign\.css$/.test(u.pathname))body=readFileSync('assets/ds-redesign.css');
     if(/\/assets\/ds-r-font-[^/]+\.woff2$/.test(u.pathname))body=readFileSync('assets/'+u.pathname.split('/').at(-1));
     if(req.isNavigationRequest()){
      // Mirrors only the permitted preload block in theme.liquid.
      let html=body.toString();
      const cssHref=html.match(/href="([^"]*\/assets\/ds-redesign\.css[^\"]*)"/)[1].replaceAll('&amp;','&');
      const localLinks=[...readFileSync('layout/theme.liquid','utf8').matchAll(/<link rel="preload" as="font" href="\{\{ '(ds-r-font-[^']+)'[^\n]+/g)];
      const preloads=localLinks.map(m=>`<link rel="preload" as="font" href="${new URL(m[1],new URL(cssHref,url))}" type="font/woff2" crossorigin>`).join('');
      html=html.replace(/<link\b[^>]*rel="preload"[^>]*as="font"[^>]*>/g,'').replace('</head>',preloads+'</head>');
      body=Buffer.from(html);
     }
    }
    if(req.resourceType()==='font'||/\.(?:woff2?|ttf)(?:\?|$)/i.test(url))fonts.set(url,{url,bytes:body.length,signature:body.subarray(0,4).toString('hex')});
    await route.fulfill({status:cached.status,headers,body});
   }catch(error){errors.push(String(error));await route.abort();}
  });
  try{
   const response=await page.goto('https://dayanassweet.com'+path,{waitUntil:'networkidle',timeout:60000});
   if(response.status()!==200)throw Error('Document HTTP '+response.status());
   await page.evaluate(()=>document.fonts.ready);
   await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
   await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=700){scrollTo(0,y);await new Promise(r=>setTimeout(r,70));}scrollTo(0,0);});
   await page.waitForTimeout(500);await page.evaluate(()=>document.fonts.ready);
   const visible=await page.evaluate(()=>[...document.querySelectorAll('h1,h2,h3,p,a,button,label,input,span,em,strong')].filter(e=>{
    const b=e.getBoundingClientRect();return e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&b.width&&b.height&&b.top<innerHeight&&b.bottom>0&&b.left<innerWidth&&b.right>0&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
   }).map((e,i)=>{e.dataset.fontAudit=String(i);const s=getComputedStyle(e);return {id:i,text:e.textContent.trim().slice(0,90),family:s.fontFamily,weight:s.fontWeight,style:s.fontStyle};}));
   const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
   const {root}=await cdp.send('DOM.getDocument');
   for(const item of visible){const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:`[data-font-audit="${item.id}"]`});item.rendered=(await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;}
   const screenshot=join(out,`${name}-${width}-${phase}.png`);await page.screenshot({path:screenshot,fullPage:true});
   const item={name,path,width,screenshot,fontBytes:[...fonts.values()].reduce((n,f)=>n+f.bytes,0),fonts:[...fonts.values()],visible,errors};
   results.push(item);console.log(JSON.stringify({name,width,phase,bytes:item.fontBytes,fonts:fonts.size,errors}));
  }finally{await Promise.all(captures);await context.close();writeFileSync(join(out,phase+'.json'),JSON.stringify(results,null,2));}
 }
}finally{await browser.close();}
