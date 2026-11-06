import { authenticate } from './shopify-auth.mjs';
import { verifyAppProxy } from './proxy-auth.mjs';
import { createHandler, readJson, securityHeaders } from './http.mjs';
import { errorResult, fail, requireValue } from './errors.mjs';
import { requireRole } from './staff-identity.mjs';
export const portalCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: https://cdn.shopify.com https://*.shopifycdn.com; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";
export const portalHeaders = () => ({ 'Content-Security-Policy': portalCsp, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()' });
// Extension seam: never accepts actor identity or Shopify credentials from the browser.
export async function forwardToCelebraciones(env, actor, method, path, body, aud = 'celebraciones') {
  if (!env.CELEBRACIONES) return { status: 501, body: { code: 'NOT_AVAILABLE' } };
  return env.CELEBRACIONES.handle({ actor: { ...actor, aud }, method, path, body });
}
const ORDER_ROUTE = /^orders(?:\/(\d{1,20})(?:\/(note|fulfill|ready|delivered|refund-preview|cash|refund|edit|cancel))?)?$/;
const ORDER_ADMIN = new Set(['refund-preview', 'cash', 'refund', 'edit', 'cancel']);
const ORDER_MONEY = new Set(['cash', 'refund', 'edit', 'cancel']);
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/;
// Pedidos: Inventario authenticates, checks roles, verifies the admin password for
// money actions and forwards only {actor, stepUp}. The password never leaves this Worker.
async function handlePedidos({ env, identity, offline, clientFactory }, action, data) {
  const actor = await identity.authenticate(data.session);
  if (!actor.roles.includes('inventario') && !actor.roles.includes('admin')) throw fail(403, 'ROLE_REQUIRED', 'Tu cuenta no tiene permiso para esta acción.');
  requireValue(!Object.hasOwn(data, 'actor'), 'Esta acción no acepta identidad del navegador.');
  const route = action.slice('pedidos/'.length);
  if (route === 'variants') {
    requireRole(actor, 'admin');
    await offline.get();
    return { status: 200, body: { variants: await clientFactory().variantsWithStock() } };
  }
  const match = ORDER_ROUTE.exec(route);
  if (!match || (match[2] && !match[1])) throw fail(404, 'NOT_FOUND', 'Esta acción no existe.');
  const [, id, write] = match;
  const body = write ? data.body : undefined;
  if (write) requireValue(body && typeof body === 'object' && !Array.isArray(body) && !Object.hasOwn(body, 'password') && !Object.hasOwn(body, 'actor'));
  if (write && ORDER_ADMIN.has(write)) requireRole(actor, 'admin');
  let forwarded = actor;
  if (write && ORDER_MONEY.has(write)) {
    if (typeof data.password !== 'string' || !data.password) throw fail(401, 'PASSWORD_REQUIRED', 'Escribe tu contraseña para confirmar.');
    forwarded = await identity.stepUp(data.session, data.password);
  }
  const { stepUp, ...plain } = forwarded;
  const send = extra => forwardToCelebraciones(env, { ...plain, ...(stepUp === true ? { stepUp: true } : {}), ...extra }, write ? 'POST' : 'GET', `/${route}`, body, 'pedidos');
  const result = await send({});
  // Celebraciones resolves the operationId first: a stored receipt comes back without any
  // stock check. Only when a write (new or retry) is about to be sent does it ask for stock;
  // then this Worker checks it and repeats the call with stockVerified, which the browser cannot set.
  if (write === 'edit' && result?.status === 409 && result.body?.code === 'STOCK_CHECK_REQUIRED') {
    await checkEditStock(offline, clientFactory, body);
    return send({ stockVerified: true });
  }
  return result;
}
// Additions and increases must have stock now; Celebraciones re-checks the order itself.
async function checkEditStock(offline, clientFactory, body) {
  const wanted = new Map();
  const add = (variantId, quantity) => { requireValue(VARIANT_GID.test(variantId || '') && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 99, 'Producto inválido.'); wanted.set(variantId, (wanted.get(variantId) || 0) + quantity); };
  for (const item of Array.isArray(body.additions) ? body.additions : []) add(item?.variantId, item?.quantity);
  for (const change of Array.isArray(body.changes) ? body.changes : []) {
    if (!Number.isSafeInteger(change?.quantity) || !Number.isSafeInteger(change?.fromQuantity) || change.quantity <= change.fromQuantity) continue;
    if (!change.variantId) throw fail(409, 'NO_STOCK', 'No podemos confirmar el stock de ese producto. Quítalo y agrégalo de nuevo.');
    add(change.variantId, change.quantity - change.fromQuantity);
  }
  if (!wanted.size) return;
  await offline.get();
  const stock = await clientFactory().variantStock([...wanted.keys()]);
  for (const [variantId, quantity] of wanted) if (!(stock.get(variantId) >= quantity)) throw fail(409, 'NO_STOCK', 'Ese producto ya no tiene stock suficiente en esta tanda.');
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
      if (action.startsWith('pedidos/')) {
        const result = await handlePedidos({ env, identity, offline, clientFactory }, action, data);
        return Response.json(result.body, { status: result.status, headers });
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
