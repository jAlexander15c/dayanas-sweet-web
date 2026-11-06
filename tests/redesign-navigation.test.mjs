import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vm from 'node:vm';

const qaRequire = createRequire(resolve(process.env.DS_QA_ROOT || '.', 'navigation-test-runtime.cjs'));
const {Liquid} = qaRequire('liquidjs');
const source = path => existsSync(path) ? readFileSync(path, 'utf8') : '';
const routes = {root_url:'/es/', search_url:'/es/search', account_url:'/es/account', cart_url:'/es/cart'};
async function render(name, extra={}) {
  const template = source(`sections/ds-redesign-${name}.liquid`);
  const schema = template.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/);
  const defaults = Object.fromEntries((schema ? JSON.parse(schema[1]).settings : []).filter(item => item.id && 'default' in item).map(item => [item.id, item.default]));
  const context = {routes, settings:{}, cart:{item_count:3}, shop:{name:"Dayana's Sweet", customer_accounts_enabled:true, policies:[]}, section:{id:'qa-header',settings:defaults}, ...extra};
  const engine = new Liquid({root:resolve('snippets'), extname:'.liquid', globals:context});
  engine.registerFilter('asset_url', value => `/assets/${value}`);
  engine.registerFilter('image_url', value => `/images/${value}`);
  engine.registerFilter('t', (value, args) => value === 'sections.header.cart_count' ? `${args?.[1] || 3} artículos` : 'Carrito');
  return engine.parseAndRender(template.replace(/{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}/, ''),context);
}
const anchor = (html, id) => html.match(new RegExp(`<a\\b(?=[^>]*id="${id}")[^>]*>[\\s\\S]*?<\\/a>`))?.[0] || '';

test('navigation uses localized Shopify destinations and a real GET product search', async () => {
  const html = await render('header');
  assert.match(html, /href="\/es\/"[^>]*aria-label=/);
  assert.match(html, /href="\/es\/#menu"/);
  assert.match(html, /href="\/es\/pages\/contact"/);
  assert.match(html, /href="\/es\/account"/);
  assert.match(html, /<form[^>]*action="\/es\/search"[^>]*method="get"/);
  assert.match(html, /name="q"[^>]*type="search"/);
  assert.match(html, /type="hidden" name="type" value="product"/);
  assert.doesNotMatch(html, /dayanassweet\.com|target="_blank"/);
});

test('disabled customer accounts disappear from desktop and mobile navigation', async () => {
  const html = await render('header', {shop:{name:'DS', customer_accounts_enabled:false}});
  assert.match(html, /ds-r-site-header/);
  assert.doesNotMatch(html, /href="\/es\/account"/);
});

test('contact resolves correctly for Shopify locale roots without a trailing slash', async () => {
  for (const name of ['header', 'footer']) {
    const html = await render(name, {routes:{...routes, root_url:'/es'}});
    assert.match(html, /href="\/es\/pages\/contact"/);
    assert.doesNotMatch(html, /\/espages\/contact/);
  }
});

test('how-to CTA stays closed until the shared state permits ordering', async () => {
  const closed = await render('header');
  assert.match(closed, /href="\/es\/#ds-r-email"[^>]*data-ds-r-signup/);
  assert.match(closed, /Así llega tu antojo\./);
  assert.match(closed, /El retiro normalmente está listo en 24 horas; espera nuestro aviso antes de venir\. Los pasteles personalizados se retiran en la fecha acordada\. USPS Ground Advantage estima 2–5 días hábiles desde que recibe el paquete, sin garantía de fecha de entrega\./);
  const open = await render('header', {settings:{ds_batch_open:true, ds_batch_close:'viernes', ds_batch_ship:'lunes'}});
  assert.doesNotMatch(open, /data-ds-r-signup/);
  assert.match(open, /href="\/es\/#menu"[^>]*data-ds-r-close-link[^>]*>Elegir mis favoritos/);
});

test('footer renders only actual policies and the merchant name without prototype copy', async () => {
  const html = await render('footer', {shop:{name:'Mi pastelería & tú', policies:[{title:'Privacidad', url:'/es/policies/privacy-policy'}, {title:'Sin publicar', url:''}]}});
  assert.match(html, /Mi pastelería &amp; tú/);
  assert.match(html, /href="\/es\/policies\/privacy-policy"/);
  assert.match(html, /href="\/es\/pages\/contact"/);
  assert.doesNotMatch(html, /Sin publicar|Prototipo|no registra suscripciones/);
});

// A small DOM boundary lets the actual delegated script run without a browser or
// a third-party DOM runtime. Native modal opening/closing and focus are observed.
function harness() {
  const nodes = new Map();
  const listeners = new Map();
  const document = {
    activeElement:null,
    addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); },
    getElementById(id) { return nodes.get(id) || null; },
    querySelector(selector) { return [...nodes.values()].find(node => node.matches(selector)) || null; },
    querySelectorAll(selector) { return [...nodes.values()].filter(node => node.matches(selector)); }
  };
  function dispatch(type, target, extra={}) {
    const event = {type,target,defaultPrevented:false,clientX:-1,clientY:-1,preventDefault(){this.defaultPrevented=true;},...extra};
    for (const listener of listeners.get(type) || []) listener(event);
    return event;
  }
  class Element {
    constructor(id, tag='button', attrs={}) { this.id=id; this.tagName=tag.toUpperCase(); this.attrs={...attrs}; this.dataset={}; this.isConnected=true; this.open=false; this.parentElement=null; this.opens=0; if(id) nodes.set(id,this); }
    matches(selector) {
      return selector.split(',').some(part => {
        part=part.trim();
        if(part.startsWith('#')) return this.id===part.slice(1);
        if(part.includes('dialog') && this.tagName!=='DIALOG') return false;
        if(part.includes('[open]') && !this.open) return false;
        if(part.includes('.ds-r-dialog') && this.attrs.class!=='ds-r-dialog') return false;
        const attr=part.match(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/);
        if(attr && !(attr[1] in this.attrs && (attr[2]===undefined || this.attrs[attr[1]]===attr[2]))) return false;
        return !!attr || part==='dialog' || part==='dialog.ds-r-dialog' || part==='dialog.ds-r-dialog[open]';
      });
    }
    closest(selector) { for(let node=this;node;node=node.parentElement) if(node.matches(selector)) return node; return null; }
    contains(node) { for(;node;node=node.parentElement) if(node===this) return true; return false; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return name in this.attrs; }
    setAttribute(name,value) { this.attrs[name]=String(value); }
    removeAttribute(name) { delete this.attrs[name]; }
    focus() { document.activeElement=this; }
    showModal() { this.open=true; this.opens++; this.focus(); }
    close() { this.open=false; dispatch('close',this); }
    getBoundingClientRect() { return {left:0,right:300,top:0,bottom:300}; }
  }
  const window = {};
  const context=vm.createContext({window,document,HTMLElement:Element,Element,WeakMap,WeakSet,Map,Set,console});
  const run=() => vm.runInContext(source('assets/ds-redesign.js'),context);
  const dialog=id => new Element(id,'dialog',{'class':'ds-r-dialog','data-ds-r-dialog':''});
  return {Element,document,dispatch,run,context,dialog};
}

test('dialogs return focus on Escape and backdrop while clicks inside stay open', () => {
  const h=harness(); const how=h.dialog('DS-R-How');
  const opener=new h.Element('how-trigger','button',{'data-ds-r-open':'how'});
  h.run();
  h.dispatch('click',opener);
  assert.equal(how.open,true,'the how dialog must open');
  h.dispatch('click',how,{clientX:10,clientY:10});
  assert.equal(how.open,true,'dialog padding is not the backdrop');
  h.dispatch('cancel',how);
  assert.equal(how.open,false);
  assert.equal(h.document.activeElement,opener);
  h.dispatch('click',opener);
  h.dispatch('click',how);
  assert.equal(how.open,false);
  assert.equal(h.document.activeElement,opener);
});

test('mobile dialog transitions restore focus to the visible menu trigger and hash links close it', () => {
  const h=harness(); const mobile=h.dialog('DS-R-Mobile'); const how=h.dialog('DS-R-How');
  const toggle=new h.Element('mobile-toggle','button',{'data-ds-r-open':'mobile','aria-expanded':'false'});
  const item=new h.Element('mobile-how','button',{'data-ds-r-open':'how'}); item.parentElement=mobile;
  h.run(); h.dispatch('click',toggle); h.dispatch('click',item);
  assert.equal(mobile.open,false); assert.equal(how.open,true);
  h.dispatch('cancel',how); assert.equal(h.document.activeElement,toggle);
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  h.dispatch('click',toggle);
  const link=new h.Element('menu-link','a',{'data-ds-r-close-link':'',href:'/es/#menu'}); link.parentElement=mobile;
  assert.equal(h.dispatch('click',link).defaultPrevented,false,'hash navigation remains native');
  assert.equal(mobile.open,false);
});

test('Escape closes search even when its search input contains text', () => {
  const h=harness(); const search=h.dialog('DS-R-Search');
  const opener=new h.Element('search-trigger','button',{'data-ds-r-open':'search'});
  const input=new h.Element('DS-R-Query','input',{type:'search'}); input.value='brownies'; input.parentElement=search;
  h.run(); h.dispatch('click',opener); input.focus();
  const escape=h.dispatch('keydown',input,{code:'Escape',key:'Escape'});
  assert.equal(search.open,false); assert.equal(escape.defaultPrevented,true);
  assert.equal(h.document.activeElement,opener);
});

test('signup closes the dialog and focuses the existing email, preserving cross-page fallback', () => {
  const h=harness(); const how=h.dialog('DS-R-How');
  const signup=new h.Element('signup','a',{'data-ds-r-signup':'',href:'/es/#ds-r-email'}); signup.parentElement=how;
  const opener=new h.Element('how-trigger','button',{'data-ds-r-open':'how'});
  h.run(); h.dispatch('click',opener);
  assert.equal(h.dispatch('click',signup).defaultPrevented,false,'absent email follows real href');
  const email=new h.Element('ds-r-email','input');
  h.dispatch('click',opener);
  assert.equal(h.dispatch('click',signup).defaultPrevented,true);
  assert.equal(how.open,false); assert.equal(h.document.activeElement,email);
});

test('repeated script loads and editor replacements retain one set of delegated handlers', () => {
  const h=harness(); let how=h.dialog('DS-R-How');
  let opener=new h.Element('how-trigger','button',{'data-ds-r-open':'how'});
  h.run(); h.run(); h.dispatch('shopify:section:load',opener); h.dispatch('click',opener);
  assert.equal(how.opens,1);
  how.isConnected=false; opener.isConnected=false;
  how=h.dialog('DS-R-How'); opener=new h.Element('how-trigger-new','button',{'data-ds-r-open':'how'});
  h.dispatch('shopify:section:load',opener); h.dispatch('click',opener); h.dispatch('cancel',how);
  assert.equal(how.opens,1); assert.equal(h.document.activeElement,opener);
});

test('actual Dawn AJAX replacement preserves the cart link and generic accessible label', async () => {
  const html=await render('header'); const cart=anchor(html,'cart-icon-bubble');
  assert.match(cart, /href="\/es\/cart"/); assert.match(cart,/aria-label="Ver carrito"/);
  assert.match(cart,/ds-r-icon-shopping-bag\.svg/); assert.match(cart,/cart-count-bubble/);
  const h=harness(); const link=new h.Element('cart-icon-bubble','a',{href:'/es/cart','aria-label':'Ver carrito'});
  link.innerHTML=cart; const drawerBody={classList:{contains:()=>false}};
  const drawer={querySelector:()=>drawerBody,getSectionsToRender:()=>[{id:'cart-icon-bubble'}],getSectionInnerHTML:html=>html.match(/<div class="shopify-section">([\s\S]*)<\/div>/)[1],open(){}};
  const definitions=new Map(); Object.assign(h.context,{customElements:{define:(name,ctor)=>definitions.set(name,ctor)},CartItems:class{},setTimeout:()=>{}});
  vm.runInContext(readFileSync('assets/cart-drawer.js','utf8'),h.context);
  const replacement='<span class="svg-wrapper"><svg class="icon icon-cart"></svg></span><span class="visually-hidden">Carrito</span><div class="cart-count-bubble">4</div>';
  definitions.get('cart-drawer').prototype.renderContents.call(drawer,{sections:{'cart-icon-bubble':`<div class="shopify-section">${replacement}</div>`}});
  assert.equal(link.innerHTML,replacement); assert.equal(link.getAttribute('href'),'/es/cart'); assert.equal(link.getAttribute('aria-label'),'Ver carrito');
});

test('cart delegation opens Dawn after editor reload but does not open it twice', () => {
  const h=harness(); const link=new h.Element('cart-icon-bubble','a',{href:'/es/cart'});
  const drawer=new h.Element('cart-drawer','cart-drawer'); let opens=0; drawer.open=trigger=>{assert.equal(trigger,link);opens++;};
  drawer.matches=selector=>selector==='cart-drawer';
  h.run(); h.dispatch('click',link); assert.equal(opens,1);
  h.dispatch('click',link,{defaultPrevented:true}); assert.equal(opens,1);
  h.dispatch('keydown',link,{code:'Space',key:' '}); assert.equal(opens,2);
});
