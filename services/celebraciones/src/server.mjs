import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createStore } from './store.mjs';
import { createHandler } from './http.mjs';
import { createShopifyPaymentClient } from './shopify-payments.mjs';
import { createPaymentService } from './payment-service.mjs';

const required = ['SHOPIFY_APP_SECRET', 'SHOPIFY_SHOP', 'SHOPIFY_CLIENT_ID', 'STOREFRONT_ORIGIN', 'CELEBRACIONES_DB'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Falta configurar: ${missing.join(', ')}. No introduzcas secretos en el repositorio.`);
const config = { secret: process.env.SHOPIFY_APP_SECRET, shop: process.env.SHOPIFY_SHOP, clientId: process.env.SHOPIFY_CLIENT_ID, storefrontOrigin: process.env.STOREFRONT_ORIGIN, staffIds: (process.env.SHOPIFY_STAFF_IDS || '').split(',').map(s => s.trim()).filter(Boolean) };
if (!/^https:\/\/[^/]+$/.test(config.storefrontOrigin) || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(config.shop)) throw new Error('Dominio Shopify u origen HTTPS inválidos.');
const database = resolve(process.env.CELEBRACIONES_DB);
mkdirSync(dirname(database), { recursive: true });
const store = createStore(database);
const paymentService=process.env.PAYMENTS_ENABLED==='true'?createPaymentService({store,mode:process.env.PAYMENTS_MODE||'TEST',storefrontOrigin:config.storefrontOrigin,client:createShopifyPaymentClient({...config,storefrontOrigin:config.storefrontOrigin})}):undefined;
const handler = createHandler({ store, config, paymentService });
const port = Number(process.env.PORT || 8787);
const server = createServer(async (req, res) => {
  try {
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Readable.toWeb(req), duplex: 'half' }) });
    const result = await handler(request);
    res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer()));
  } catch { res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"code":"UNAVAILABLE"}'); }
});
server.requestTimeout = 15000; server.headersTimeout = 10000;
server.listen(port, '127.0.0.1', () => console.log(`Servicio de celebraciones en 127.0.0.1:${port}; requiere proxy HTTPS para Shopify.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
