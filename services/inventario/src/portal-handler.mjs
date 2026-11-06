import { authenticate } from './shopify-auth.mjs';
import { verifyAppProxy } from './proxy-auth.mjs';
import { createHandler, readJson, securityHeaders } from './http.mjs';
import { errorResult, fail, requireValue } from './errors.mjs';
import { requireRole } from './staff-identity.mjs';
export const portalCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: https://cdn.shopify.com https://*.shopifycdn.com; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";
export const portalHeaders = () => ({ 'Content-Security-Policy': portalCsp, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()' });
// Extension seam: never accepts actor identity or Shopify credentials from the browser.
export async function forwardToCelebraciones(env, actor, method, path, body) {
  if (!env.CELEBRACIONES) return { status: 501, body: { code: 'NOT_AVAILABLE' } };
  return env.CELEBRACIONES.handle({ actor: { ...actor, aud: 'celebraciones' }, method, path, body });
}
export function createPortalHandler({ env, identity, offline, service, clientFactory }) {
  return async request => {
    const url = new URL(request.url), embedded = url.pathname.startsWith('/api/staff/');
    const headers = embedded ? securityHeaders(env) : portalHeaders();
    try {
      let master;
      if (embedded) master = { ...await authenticate(request, env), master: true };
      else {
        if (env.EXTERNAL_LOGIN_ENABLED !== 'true') throw fail(503, 'DISABLED', 'El acceso externo todavía no está habilitado.');
        await verifyAppProxy(request, env);
      }
      if (request.method !== 'POST') throw fail(405, 'METHOD_NOT_ALLOWED', 'Envía esta acción como POST JSON.');
      const data = await readJson(request);
      requireValue(data && typeof data === 'object' && !Array.isArray(data));
      const action = url.pathname.slice(embedded ? '/api/staff/'.length : '/proxy/api/'.length);
      if (embedded && action === 'connect') return Response.json(await offline.connect(master.token), { headers });
      if (embedded && !['users', 'invite', 'update-user', 'resend-invitation', 'cancel-invitation'].includes(action)) throw fail(404, 'NOT_FOUND', 'Esta acción no existe.');
      if (action.startsWith('inventory/')) {
        const actor = await identity.authenticate(data.session); requireRole(actor, 'inventario');
        if (env.SERVICE_ENABLED !== 'true') throw fail(503, 'DISABLED', 'El inventario todavía no está habilitado.');
        // Fail before constructing a mutation receipt when reconnecting is necessary.
        await offline.get();
        const suffix = action.slice('inventory/'.length), target = new URL(`/api/${suffix}`, 'https://inventory.internal');
        for (const [key, value] of Object.entries(data.params || {})) if (typeof value === 'string') target.searchParams.set(key, value);
        const operation = suffix === 'operations';
        const staff = { staffId: `user:${actor.userId}`, staffName: actor.name, token: null };
        const handler = createHandler({ env, service, clientFactory, authenticateRequest: async () => staff });
        const response = await handler(new Request(target, { method: operation ? 'POST' : 'GET', ...(operation ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data.body) } : {}) }));
        return new Response(response.body, { status: response.status, headers: { ...headers, 'Content-Type': 'application/json' } });
      }
      if (action.startsWith('celebraciones/')) {
        const actor = await identity.authenticate(data.session); requireRole(actor, 'celebraciones');
        requireValue(!Object.hasOwn(data, 'actor'), 'Esta acción no acepta identidad del navegador.');
        const method = data.method || 'GET'; requireValue(['GET', 'POST', 'PATCH', 'DELETE'].includes(method));
        const path = `/${action.slice('celebraciones/'.length)}${url.search}`;
        // Only application query parameters; Shopify's proxy signature is not sent to the other service.
        const clean = new URL(path, 'https://gateway.internal');
        for (const key of ['signature', 'shop', 'timestamp', 'logged_in_customer_id', 'path_prefix']) clean.searchParams.delete(key);
        const result = await forwardToCelebraciones(env, actor, method, clean.pathname + clean.search, data.body ?? null);
        return Response.json(result.body, { status: result.status, headers });
      }
      return Response.json(await identity.handle(action, data, master), { headers });
    } catch (error) { const result = errorResult(error); return Response.json(result.body, { status: result.status, headers }); }
  };
}
