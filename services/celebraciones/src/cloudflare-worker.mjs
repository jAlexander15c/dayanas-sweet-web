import { DurableObject } from 'cloudflare:workers';
import { createDurableStore } from './durable-store.mjs';
import { createHandler } from './http.mjs';
import { renderAdminPage } from './admin-page.mjs';
import { createShopifyPaymentClient } from './shopify-payments.mjs';
import { createPaymentService } from './payment-service.mjs';
import { createPaymentScheduler } from './payment-scheduler.mjs';
import adminJavaScript from './admin-ui.js';
import adminCss from './admin-ui.css';

function unavailable() {
  return Response.json({ code: 'UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
function configured(env) {
  return typeof env.SHOPIFY_APP_SECRET === 'string' && env.SHOPIFY_APP_SECRET.length > 0 &&
    typeof env.SHOPIFY_CLIENT_ID === 'string' && env.SHOPIFY_CLIENT_ID.length > 0 &&
    /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(env.SHOPIFY_SHOP || '') &&
    /^https:\/\/[^/]+$/.test(env.STOREFRONT_ORIGIN || '');
}

export class CelebrationStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.store = createDurableStore(ctx.storage);
    const paymentService=env.PAYMENTS_ENABLED==='true'?createPaymentService({store:this.store,mode:env.PAYMENTS_MODE||'TEST',storefrontOrigin:env.STOREFRONT_ORIGIN,onDiagnostic:diagnostic=>console.warn('payment-diagnostic '+JSON.stringify(diagnostic)),client:createShopifyPaymentClient({shop:env.SHOPIFY_SHOP,clientId:env.SHOPIFY_CLIENT_ID,secret:env.SHOPIFY_APP_SECRET,storefrontOrigin:env.STOREFRONT_ORIGIN})}):undefined;
    this.scheduler=paymentService?createPaymentScheduler({store:this.store,service:paymentService,storage:ctx.storage,shop:env.SHOPIFY_SHOP}):null;
    if(this.scheduler)ctx.blockConcurrencyWhile(()=>this.scheduler.ensure());
    this.handler = createHandler({ store: this.store, paymentService, config: {
      secret: env.SHOPIFY_APP_SECRET,
      shop: env.SHOPIFY_SHOP,
      clientId: env.SHOPIFY_CLIENT_ID,
      storefrontOrigin: env.STOREFRONT_ORIGIN,
      requireDetails: true,
      testCustomerIds: env.PAYMENTS_MODE === 'TEST' ? (env.TEST_CUSTOMER_IDS || '').split(',').map(s => s.trim()).filter(Boolean) : undefined,
      staffIds: (env.SHOPIFY_STAFF_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
    } });
  }
  async fetch(request) {
    if (!configured(this.env)) return unavailable();
    if(new URL(request.url).pathname.startsWith('/proxy/') && this.env.SERVICE_ENABLED!=='true')return unavailable();
    const financialRequest=request.method==='POST'&&/\/requests\/[^/]+\/(payment|payment-sync|accept|status)$/.test(new URL(request.url).pathname);
    if(!this.scheduler||!financialRequest)return this.handler(request);
    // Persist a recovery wake-up before the handler can send any mutation.
    await this.scheduler.begin();
    try{return await this.handler(request);}
    finally{await this.scheduler.end();}
  }
  async alarm(){
    if(!configured(this.env)||this.env.PAYMENTS_ENABLED!=='true'||!this.scheduler){await this.ctx.storage.deleteAlarm();return;}
    await this.scheduler.run();
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if(request.method==='GET'){
      if(path==='/' || path==='/admin')return renderAdminPage({clientId:env.SHOPIFY_CLIENT_ID,shop:env.SHOPIFY_SHOP});
      if(path==='/admin/assets/admin-ui.js' || path==='/admin/assets/admin-ui.css')return new Response(path.endsWith('.js')?adminJavaScript:adminCss,{headers:{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    if (!configured(env)) return unavailable();
    if(path.startsWith('/proxy/') && env.SERVICE_ENABLED!=='true')return unavailable();
    if (!/^\/(proxy|admin)\/(requests(?:\/|$)|calendar$|session$|payment-status$)/.test(path)) return Response.json({ code: 'NOT_FOUND' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    // One object for the configured shop: no user-controlled object names and
    // every read/mutation remains authenticated inside the object.
    const id = env.CELEBRATIONS.idFromName(env.SHOPIFY_SHOP);
    return env.CELEBRATIONS.get(id).fetch(request);
  }
};
