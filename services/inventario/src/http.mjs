import { authenticate, shopPattern } from './shopify-auth.mjs';
import { errorResult, fail, requireValue } from './errors.mjs';
import { gid, text } from './validation.mjs';
import { categoryIds } from './categories.mjs';
export function securityHeaders(env) {
  const shop = shopPattern.test(env.SHOPIFY_SHOP || '') ? `https://${env.SHOPIFY_SHOP}` : '';
  return {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' https://cdn.shopify.com; style-src 'self'; img-src 'self' blob: https://cdn.shopify.com https://*.shopifycdn.com; connect-src 'self' https://admin.shopify.com https://cdn.shopify.com ${shop}; frame-ancestors https://admin.shopify.com ${shop}; base-uri 'none'; object-src 'none'; form-action 'self'`,
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  };
}
export async function readJson(request) {
  requireValue((request.headers.get('Content-Type') || '').split(';')[0] === 'application/json', 'Envía los datos como JSON.');
  if (Number(request.headers.get('Content-Length')) > 22_000_000) throw fail(413, 'TOO_LARGE', 'Las fotos pesan demasiado. Usa hasta tres fotos de 5 MB.');
  const reader = request.body?.getReader();
  requireValue(reader);
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 22_000_000) { await reader.cancel(); throw fail(413, 'TOO_LARGE', 'Las fotos pesan demasiado. Usa hasta tres fotos de 5 MB.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fail(400, 'VALIDATION', 'No pudimos leer el formulario. Ábrelo otra vez.'); }
}
export function createHandler({ env, service, clientFactory, authenticateRequest = authenticate }) {
  return async request => {
    const headers = securityHeaders(env);
    try {
      const staff = await authenticateRequest(request, env);
      if (env.SERVICE_ENABLED !== 'true') throw fail(503, 'DISABLED', 'El panel todavía no está habilitado. Consulta a la encargada.');
      const url = new URL(request.url);
      let data;
      if (request.method === 'GET' && url.pathname === '/api/session') {
        let missingScopes = [], warning = '';
        try {
          missingScopes = await clientFactory(staff.token, staff.staffId).accessScopes();
          if (missingScopes.length) warning = `Faltan permisos de la aplicación en Shopify: ${missingScopes.join(', ')}. Pide a la encargada que autorice los 8 permisos antes de habilitar el servicio.`;
        } catch { warning = 'No pudimos verificar los permisos de la aplicación. Pide a la encargada que revise su autorización en Shopify.'; }
        data = { staffId: staff.staffId, staffName: staff.staffName, missingScopes, warning };
      }
      else if (request.method === 'GET' && url.pathname === '/api/history') data = { events: service.history() };
      else if (request.method === 'GET' && url.pathname === '/api/locations') data = { locations: await clientFactory(staff.token, staff.staffId).locations() };
      else if (request.method === 'GET' && url.pathname === '/api/categories') data = await clientFactory(staff.token, staff.staffId).categories();
      else if (request.method === 'GET' && url.pathname === '/api/products') {
        const query = text(url.searchParams.get('q') || '', 100);
        const after = url.searchParams.get('after');
        requireValue(after === null || (after.length <= 1000 && /^[A-Za-z0-9+/=_-]+$/.test(after)));
        data = await clientFactory(staff.token, staff.staffId).search(query, after);
        if (url.searchParams.get('uncategorized') === 'true') data.nodes = data.nodes.filter(p => categoryIds(p).length === 0);
      } else if (request.method === 'GET' && url.pathname === '/api/product') data = { product: await clientFactory(staff.token, staff.staffId).product(gid(url.searchParams.get('id'), 'Product')) };
      else if (request.method === 'POST' && url.pathname === '/api/operations') {
        const result = await service.execute(await readJson(request), staff);
        return Response.json(result.body, { status: result.status, headers });
      } else throw fail(404, 'NOT_FOUND', 'Esta acción no existe. Vuelve al inventario.');
      return Response.json(data, { headers });
    } catch (error) { const result = errorResult(error); return Response.json(result.body, { status: result.status, headers }); }
  };
}
