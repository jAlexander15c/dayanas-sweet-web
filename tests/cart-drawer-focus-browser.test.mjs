import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const browserPath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
const qaRequire = createRequire(resolve(process.env.DS_QA_ROOT || '.', 'cart-focus-runtime.cjs'));
const { Liquid } = qaRequire('liquidjs');

async function fixture(filled) {
  const item = {
    index: 0, key: 'brownie:fixture', quantity: 1, url: '/products/brownie',
    original_price: 1200, final_price: 1200, original_line_price: 1200, final_line_price: 1200,
    product: { title: 'Brownie', has_only_default_variant: true, metafields: {} },
    variant: { id: 123, available: true, quantity_rule: { min: 1, increment: 1, max: null }, quantity_price_breaks: [] },
    properties: {}, line_level_discount_allocations: [],
  };
  const context = {
    cart: filled ? { items: [item], item_count: 1, total_price: 1200, cart_level_discount_applications: [] } : [],
    settings: { ds_batch_open: true, ds_batch_close: '15 de noviembre', ds_batch_ship: '18 de noviembre', cart_color_scheme: 'scheme-2' },
    shop: { customer_accounts_enabled: false, shipping_policy: {} },
    routes: { cart_url: '/cart', all_products_collection_url: '/collections/all' },
  };
  const liquid = new Liquid({ root: resolve('snippets'), extname: '.liquid', globals: context });
  liquid.registerFilter('asset_url', name => `/assets/${name}`);
  liquid.registerFilter('stylesheet_tag', url => `<link rel="stylesheet" href="${url}">`);
  liquid.registerFilter('inline_asset_content', name => readFileSync(`assets/${name}`, 'utf8'));
  liquid.registerFilter('standard_event_data', () => '{}');
  liquid.registerFilter('t', key => key);
  liquid.registerFilter('money', value => `$${(Number(value) / 100).toFixed(2)}`);
  const drawer = await liquid.renderFile('cart-drawer', context);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    ${['base.css', 'component-cart-drawer.css', 'component-cart-items.css', 'ds-conversion.css'].map(name => `<link rel="stylesheet" href="/assets/${name}">`).join('')}
    <script>
      // Only Shopify analytics is replaced. Drawer, cart, focus helpers and markup are real.
      window.StandardEvents={createViewEventElement: Base => class extends Base { connectedCallback() {} dispatchViewEvent() {} }};
      window.routes={cart_url:'/cart'};
    </script>
    ${['constants.js', 'pubsub.js', 'global.js'].map(name => `<script src="/assets/${name}" defer></script>`).join('')}
    </head><body>${drawer}<a id="cart-icon-bubble" href="/cart">Carrito</a><a href="#after">Después del carrito</a>
    <script src="/assets/cart-drawer.js" defer></script>
    <script>addEventListener('DOMContentLoaded',()=>window.fixtureReady=true,{once:true})</script></body></html>`;
}

test('drawer keyboard focus stays modal and returns to its opener at desktop/mobile', { skip: !browserPath, timeout: 45000 }, async t => {
  const pages = { '/empty': await fixture(false), '/filled': await fixture(true) };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://fixture.local').pathname;
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    if (pages[pathname]) { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(pages[pathname]); return; }
    if (/^\/assets\/[a-zA-Z0-9_.-]+$/.test(pathname) && existsSync(`.${pathname}`)) {
      const type = pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'image/svg+xml';
      response.writeHead(200, { 'Content-Type': type }); response.end(readFileSync(`.${pathname}`)); return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = mkdtempSync(join(tmpdir(), 'ds-cart-focus-'));
  const child = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let socket;
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt++) await delay(100);
    assert.ok(existsSync(portFile), 'Chrome started');
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); pending.get(message.id)?.(message); pending.delete(message.id); });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(id, message => { clearTimeout(timer); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const key = async (name, shift = false) => {
      const code = name === 'Tab' ? 9 : 27;
      for (const type of ['keyDown', 'keyUp']) await cdp('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
    };
    const inside = () => evaluate(`!!document.activeElement.closest('.drawer__inner')`);
    for (const width of [390, 1440]) for (const filled of [false, true]) for (const motion of ['no-preference', 'reduce']) {
      await t.test(`${width}px ${filled ? 'with products' : 'empty'} motion=${motion}`, async () => {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
        await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
        await evaluate('window.fixtureReady=false');
        await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/${filled ? 'filled' : 'empty'}` });
        for (let attempt = 0; attempt < 100 && !await evaluate('window.fixtureReady === true'); attempt++) await delay(20);
        assert.equal(await evaluate('window.fixtureReady'), true, 'fixture loaded');
        await evaluate(`document.getElementById('cart-icon-bubble').focus();document.getElementById('cart-icon-bubble').click()`);
        for (let attempt = 0; attempt < 100 && !await inside(); attempt++) await delay(20);
        assert.equal(await inside(), true, 'opening moves focus into the dialog');
        await key('Tab', true);
        assert.equal(await inside(), true, 'Shift+Tab immediately after opening stays in the dialog');
        await key('Tab');
        assert.equal(await evaluate(`document.activeElement.classList.contains('drawer__close')`), true, 'Tab wraps from the last control to close');
        const controlCount = await evaluate(`[...document.querySelector('.drawer__inner').querySelectorAll('a[href],button:not(:disabled),input:not([type="hidden"]):not(:disabled),textarea:not(:disabled),summary')].filter(el=>el.getClientRects().length).length`);
        for (let index = 0; index <= controlCount; index++) {
          await key('Tab');
          assert.equal(await inside(), true, `Tab stays inside, step ${index + 1}`);
        }
        await key('Escape');
        assert.equal(await evaluate(`document.querySelector('cart-drawer').classList.contains('active')`), false, 'Escape closes the drawer');
        assert.equal(await evaluate('document.activeElement.id'), 'cart-icon-bubble', 'closing returns focus to the opener');
      });
    }
  } finally {
    socket?.close(); child.kill(); server.close();
  }
});
