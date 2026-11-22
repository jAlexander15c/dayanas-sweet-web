// Read-only public storefront inventory for this audit. No admin or cart mutations.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = 'https://dayanassweet.com';
const out = new URL('./', import.meta.url);
await mkdir(out, { recursive: true });
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const clean = s => decode(s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
const attrs = s => Object.fromEntries([...s.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1], decode(m[2])]));
const locs = s => [...s.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => decode(m[1]));
const rootXml = await fetch(base + '/sitemap.xml').then(r => r.text());
const maps = await Promise.all(locs(rootXml).filter(u => /sitemap_(products|pages|collections)_/.test(u)).map(u => fetch(u).then(r => r.text())));
const urls = [...new Set([base+'/', base+'/collections/all', ...maps.flatMap(locs), base+'/policies/privacy-policy', base+'/policies/shipping-policy', base+'/policies/refund-policy', base+'/policies/terms-of-service', base+'/auditoria-pagina-inexistente-20261028'])];
const pages = [];
let home = '';
for (let offset = 0; offset < urls.length; offset += 4) {
  pages.push(...await Promise.all(urls.slice(offset, offset + 4).map(async url => {
    const start = performance.now();
    const response = await fetch(url);
    const ttfb = performance.now()-start;
    const html = await response.text();
    if (url === base+'/') home = html;
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '';
    const metadata = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => attrs(m[0]));
    const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0])).find(a => a.rel==='canonical')?.href;
    const structured = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => {try{return JSON.parse(m[1])}catch{return {invalid:true}}});
    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({...attrs(m[1]),text:clean(m[2])})).filter(a=>a.href).map(({href,text})=>({href,text}));
    return {url,status:response.status,bytes:Buffer.byteLength(html),ttfbMs:Math.round(ttfb),totalMs:Math.round(performance.now()-start),title:clean(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]||''),description:metadata.find(a=>a.name==='description')?.content||null,canonical:canonical||null,robots:metadata.find(a=>a.name==='robots')?.content||null,ogImage:metadata.find(a=>a.property==='og:image')?.content||null,h1:[...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>clean(m[1])),mainText:clean(main),structured,links};
  })));
}
const assetNames=['ds-motion.js','global.js','cart.js','product-form.js','product-info.js','ds-premium.css','ds-conversion.css','ds-header-ui.css'];
const assetMatches=[...home.matchAll(/(?:src|href)=["']([^"']*\/assets\/[^"']+)["']/g)].map(m=>decode(m[1]));
const assets=[];
for(const name of assetNames){
  const source=assetMatches.find(u=>u.includes('/'+name+'?'));
  if(!source) {assets.push({name,observedOnHome:false});continue;}
  const url=new URL(source,base).href;
  const response=await fetch(url);const remote=Buffer.from(await response.arrayBuffer());
  const local=await readFile(new URL('../../assets/'+name,import.meta.url));
  const hash=b=>createHash('sha256').update(b.toString().replace(/\r\n/g,'\n')).digest('hex');
  assets.push({name,url,status:response.status,remoteBytes:remote.length,localBytes:local.length,identicalIgnoringCRLF:hash(local)===hash(remote)});
}
const products=await Promise.all(pages.filter(p=>new URL(p.url).pathname.startsWith('/products/')).map(async p=>{
  const r=await fetch(p.url+'.js');const d=await r.json();return {url:p.url,title:d.title,available:d.available,variants:d.variants.map(v=>({id:v.id,available:v.available,inventory_management:v.inventory_management,requires_shipping:v.requires_shipping,weight:v.weight,price:v.price})),images:d.images.length};
}));
const report={capturedAt:new Date().toISOString(),scope:'Public GET requests only; no cart changes, no checkout submission, no admin access',pages,assets,products};
await writeFile(new URL('public-evidence.json',out),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pages:pages.map(({url,status,title,description,ogImage,h1})=>({url,status,title,hasDescription:!!description,hasOgImage:!!ogImage,h1Count:h1.length})),assets,products},null,2));
