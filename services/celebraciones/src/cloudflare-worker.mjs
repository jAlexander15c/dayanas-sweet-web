import { runStaffAlertJobs } from './staff-alerts.mjs';
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { handleStaffGateway, portalStaffActor } from './staff-gateway.mjs';
import { createDurableStore } from './durable-store.mjs';
import { createHandler } from './http.mjs';
import { renderAdminPage } from './admin-page.mjs';
import { createShopifyPaymentClient } from './shopify-payments.mjs';
import { createPaymentService } from './payment-service.mjs';
import { createPaymentScheduler } from './payment-scheduler.mjs';
import { createQuoteEmail, runQuoteEmailJobs } from './quote-email.mjs';
import { runNotificationJobs } from './notification-email.mjs';
import { createResendTransport } from './resend-email.mjs';
import { createAdminMailTest } from './admin-mail-test.mjs';
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
    const shopifyClient=createShopifyPaymentClient({shop:env.SHOPIFY_SHOP,clientId:env.SHOPIFY_CLIENT_ID,secret:env.SHOPIFY_APP_SECRET,storefrontOrigin:env.STOREFRONT_ORIGIN});
    const paymentService=env.PAYMENTS_ENABLED==='true'?createPaymentService({store:this.store,mode:env.PAYMENTS_MODE||'TEST',storefrontOrigin:env.STOREFRONT_ORIGIN,onDiagnostic:diagnostic=>console.warn('payment-diagnostic '+JSON.stringify(diagnostic)),client:shopifyClient}):undefined;
    let email=null,sendEmail=null;
    try {sendEmail=createResendTransport({apiKey:env.RESEND_API_KEY});email=createQuoteEmail({key:env.GUEST_ACCESS_KEY,storefrontOrigin:env.STOREFRONT_ORIGIN,send:sendEmail});} catch { /* Guest creation stays disabled until configured. */ }
    this.scheduler=paymentService||email?createPaymentScheduler({store:this.store,service:paymentService,storage:ctx.storage,shop:env.SHOPIFY_SHOP,
      ...(email?{additionalDue:()=>{
        const due=[this.store.nextGuestEmailDue(env.SHOPIFY_SHOP),this.store.nextNotificationDue(env.SHOPIFY_SHOP),this.store.nextStaffAlertDue(env.SHOPIFY_SHOP)].filter(value=>value!==null);
        return due.length?Math.min(...due):null;
      },additionalRun:async()=>{
        await runStaffAlertJobs({store:this.store,shop:env.SHOPIFY_SHOP,clientId:env.SHOPIFY_CLIENT_ID,send:sendEmail,portalEnabled:env.EXTERNAL_STAFF_ENABLED==='true'});
        await runQuoteEmailJobs({store:this.store,shop:env.SHOPIFY_SHOP,email});
        await runNotificationJobs({store:this.store,shop:env.SHOPIFY_SHOP,email,resolveCustomer:id=>shopifyClient.getCustomerContact(id)});
      }}:{})}):null;
    if(this.scheduler)ctx.blockConcurrencyWhile(()=>this.scheduler.ensure());
    this.handlerOptions = { store: this.store, paymentService,
      mailTest:env.GUEST_QA_ENABLED==='true'&&email?createAdminMailTest({storage:ctx.storage,lock:fn=>ctx.blockConcurrencyWhile(fn),send:sendEmail,transport:'resend'}):undefined,
      guestEmail:email?{seal:email.seal,wake:()=>this.scheduler.ensure()}:undefined, config: {
      guestEnabled: env.GUEST_ENABLED==='true' && email!==null,
      secret: env.SHOPIFY_APP_SECRET,
      shop: env.SHOPIFY_SHOP,
      clientId: env.SHOPIFY_CLIENT_ID,
      storefrontOrigin: env.STOREFRONT_ORIGIN,
      requireDetails: true,
      testCustomerIds: env.PAYMENTS_MODE === 'TEST' ? (env.TEST_CUSTOMER_IDS || '').split(',').map(s => s.trim()).filter(Boolean) : undefined,
      staffIds: (env.SHOPIFY_STAFF_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
    } };
    this.handler = createHandler(this.handlerOptions);
  }
  async staffHandle(input) {
    if(this.env.EXTERNAL_STAFF_ENABLED!=='true'||!configured(this.env))return {status:503,body:{code:'UNAVAILABLE'}};
    try {portalStaffActor(input?.actor,this.env.SHOPIFY_SHOP);}catch{return {status:401,body:{code:'AUTH_REQUIRED'}};}
    if(this.scheduler)await this.scheduler.begin();
    try {return await handleStaffGateway(input,this.handlerOptions);}
    finally {if(this.scheduler)await this.scheduler.end();}
  }
  async fetch(request) {
    if (!configured(this.env)) return unavailable();
    if(new URL(request.url).pathname.startsWith('/proxy/') && this.env.SERVICE_ENABLED!=='true')return unavailable();
    const path=new URL(request.url).pathname;
    const financialRequest=request.method==='POST'&&/\/requests\/[^/]+\/(payment|payment-sync|accept|status|proposals|comments|email-retry)$/.test(path);
    const guestCreation=request.method==='POST'&&path==='/proxy/guest/requests';
    if(!this.scheduler||(!financialRequest&&!guestCreation))return this.handler(request);
    // Persist a recovery wake-up before the handler can send any mutation.
    await this.scheduler.begin();
    try{return await this.handler(request);}
    finally{await this.scheduler.end();}
  }
  async alarm(){
    if(!configured(this.env)||!this.scheduler){await this.ctx.storage.deleteAlarm();return;}
    await this.scheduler.run();
  }
}

export class StaffGateway extends WorkerEntrypoint {
  async handle(input) {
    if(this.env.EXTERNAL_STAFF_ENABLED!=='true'||!configured(this.env))return {status:503,body:{code:'UNAVAILABLE'}};
    try {portalStaffActor(input?.actor,this.env.SHOPIFY_SHOP);}catch{return {status:401,body:{code:'AUTH_REQUIRED'}};}
    const id=this.env.CELEBRATIONS.idFromName(this.env.SHOPIFY_SHOP);
    return this.env.CELEBRATIONS.get(id).staffHandle(input);
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
    if (!/^\/(proxy|admin)\/(requests(?:\/|$)|calendar$|session$|payment-status$|email-test$|staff-alerts$)/.test(path) && !/^\/proxy\/guest\/(requests(?:\/|$)|calendar$)/.test(path)) return Response.json({ code: 'NOT_FOUND' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    // One object for the configured shop: no user-controlled object names and
    // every read/mutation remains authenticated inside the object.
    const id = env.CELEBRATIONS.idFromName(env.SHOPIFY_SHOP);
    return env.CELEBRATIONS.get(id).fetch(request);
  }
};
