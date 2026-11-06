import { DurableObject } from 'cloudflare:workers';
import { celebrationsView } from './celebraciones-view.mjs';
import { createDurableStore } from './durable-store.mjs';
import { createInventoryService } from './inventory-service.mjs';
import { createShopifyClient } from './shopify-client.mjs';
import { createHandler, securityHeaders } from './http.mjs';
import { renderAdminPage } from './admin-page.mjs';
import { authenticate } from './shopify-auth.mjs';
import { errorResult } from './errors.mjs';
import { createStaffStore } from './staff-store.mjs';
import { createStaffIdentity } from './staff-identity.mjs';
import { createStaffEmail } from './staff-email.mjs';
import { createOfflineToken } from './offline-token.mjs';
import { createPortalHandler, portalHeaders } from './portal-handler.mjs';
import { verifyAppProxy } from './proxy-auth.mjs';
import adminJavaScript from './admin-ui.js';
import adminCss from './admin-ui.css';
import staffJavaScript from './staff-ui.js';
const identityStub = env => env.IDENTITY.get(env.IDENTITY.idFromName('identity:' + env.SHOPIFY_SHOP));
export class StaffIdentityStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.identity = createStaffIdentity({ env, store: createStaffStore(ctx.storage, { offline: false }), sendEmail: createStaffEmail({ env }), waitUntil: task => ctx.waitUntil(task) });
    this.handler = createPortalHandler({ env, identity: this.identity });
  }
  // RPC only; session validation never waits behind password hashing or mail delivery.
  async authenticate(session) {
    try { return { actor: await this.identity.authenticate(session) }; }
    catch (error) { return { error: errorResult(error) }; }
  }
  fetch(request) { return this.handler(request); }
}
export class InventoryStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const store = createDurableStore(ctx.storage);
    const staffStore = createStaffStore(ctx.storage, { identity: false });
    const offline = createOfflineToken({ env, store: staffStore });
    const clientFactory = (sessionToken, staffId) => createShopifyClient({ env, sessionToken, staffId, ...(sessionToken === null ? { tokenProvider: () => offline.get() } : {}) });
    const service = createInventoryService({ store, clientFactory });
    this.handler = createHandler({ env, service, clientFactory });
    const identity = { authenticate: async session => {
      const result = await identityStub(env).authenticate(session);
      // RPC errors do not preserve custom Error fields; carry the public status/code as plain data.
      if (result.error) throw Object.assign(new Error(result.error.body.message), { status: result.error.status, ...result.error.body });
      return result.actor;
    } };
    const offlineFactory = () => createShopifyClient({ env, tokenProvider: () => offline.get() });
    this.portalHandler = createPortalHandler({ env, identity, offline, service, clientFactory: offlineFactory });
  }
  fetch(request) { const path = new URL(request.url).pathname; return path.startsWith('/proxy/') || path.startsWith('/api/staff/') ? this.portalHandler(request) : this.handler(request); }
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/proxy' || path.startsWith('/proxy/')) {
      const headers = portalHeaders();
      if (env.EXTERNAL_LOGIN_ENABLED !== 'true') return Response.json({ code: 'DISABLED', message: 'El acceso externo todavía no está habilitado.' }, { status: 503, headers });
      try { await verifyAppProxy(request, env); }
      catch { return Response.json({ code: 'AUTH_REQUIRED' }, { status: 401, headers }); }
      if (request.method === 'GET') { const response = celebrationsView(path, env); if (response) return response; }
      if (request.method === 'GET' && (path === '/proxy' || path === '/proxy/')) return renderAdminPage(env, { portal: true });
      const asset = path.slice('/proxy/assets/'.length);
      if (request.method === 'GET' && path.startsWith('/proxy/assets/') && ['admin-ui.js', 'admin-ui.css', 'staff-ui.js'].includes(asset)) return new Response(asset === 'admin-ui.css' ? adminCss : asset === 'staff-ui.js' ? staffJavaScript : adminJavaScript, { headers: { ...headers, 'Content-Type': asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' } });
      if (path.startsWith('/proxy/api/')) {
        const inventory = path.startsWith('/proxy/api/inventory/') || path.startsWith('/proxy/api/celebraciones/');
        return (inventory ? env.INVENTARIO.get(env.INVENTARIO.idFromName(env.SHOPIFY_SHOP)) : identityStub(env)).fetch(request);
      }
      return Response.json({ code: 'NOT_FOUND' }, { status: 404, headers });
    }
    if (path === '/api' || path.startsWith('/api/')) {
      // Reject unauthenticated requests before resolving or touching a DO.
      try { await authenticate(request, env); }
      catch (error) { const result = errorResult(error); return Response.json(result.body, { status: result.status, headers: securityHeaders(env) }); }
      if (path.startsWith('/api/staff/') && path !== '/api/staff/connect') return identityStub(env).fetch(request);
      const id = env.INVENTARIO.idFromName(env.SHOPIFY_SHOP || 'unconfigured');
      return env.INVENTARIO.get(id).fetch(request);
    }
    if (request.method === 'GET') {
      if (path === '/' || path === '/admin') return renderAdminPage(env);
      if (['/assets/admin-ui.js', '/assets/admin-ui.css', '/assets/staff-ui.js'].includes(path)) return new Response(path.endsWith('staff-ui.js') ? staffJavaScript : path.endsWith('.js') ? adminJavaScript : adminCss, { headers: { ...securityHeaders(env), 'Content-Type': path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' } });
    }
    return Response.json({ code: 'NOT_FOUND' }, { status: 404, headers: securityHeaders(env) });
  },
};
