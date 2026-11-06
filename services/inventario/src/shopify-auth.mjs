// Adapted from Celebraciones' WebCrypto verifier; independent module and app.
import { fail } from './errors.mjs';
export const shopPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;
const encoder = new TextEncoder();
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw Error();
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') !== value) throw Error();
  return bytes;
}
export async function authenticate(request, env, now = Math.floor(Date.now() / 1000)) {
  let claims, token, step = 'config';
  try {
    if (!shopPattern.test(env.SHOPIFY_SHOP || '') || !env.SHOPIFY_APP_SECRET || !env.SHOPIFY_CLIENT_ID) throw Error();
    step = 'header';
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(request.headers.get('Authorization') || '');
    if (!match || match[1].length > 8192) throw Error();
    token = match[1];
    const parts = token.split('.');
    if (parts.length !== 3) throw Error();
    const json = p => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(p)));
    const header = json(parts[0]);
    if (header.alg !== 'HS256' || (header.typ !== undefined && header.typ !== 'JWT') || header.crit !== undefined || header.b64 !== undefined) throw Error();
    step = 'signature';
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.SHOPIFY_APP_SECRET.trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, decode(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`))) throw Error();
    step = 'claims';
    claims = json(parts[1]);
    const seconds = n => Number.isSafeInteger(n) && n >= 0;
    if (claims.aud !== env.SHOPIFY_CLIENT_ID || claims.dest !== `https://${env.SHOPIFY_SHOP}` || claims.iss !== `https://${env.SHOPIFY_SHOP}/admin` || !/^\d+$/.test(claims.sub || '') || typeof claims.sub !== 'string' || ![claims.exp, claims.nbf, claims.iat].every(seconds) || claims.exp <= now - 3 || claims.nbf > now + 3 || claims.iat > now + 3 || claims.exp <= claims.nbf || claims.exp <= claims.iat) throw Error();
  } catch {
    // Only the failing step and non-secret claim checks are logged; never the token or the secret.
    const detail = step === 'claims' && claims ? { aud: claims.aud === env.SHOPIFY_CLIENT_ID, dest: claims.dest === `https://${env.SHOPIFY_SHOP}`, iss: claims.iss === `https://${env.SHOPIFY_SHOP}/admin`, exp: claims.exp > now - 3 } : undefined;
    console.warn(JSON.stringify({ event: 'auth_failed', step, detail }));
    throw fail(401, 'AUTH_REQUIRED', 'Abre Dayana Inventario desde Shopify e inicia sesión otra vez.'); }
  const allowed = (env.INVENTARIO_STAFF_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(claims.sub)) throw fail(403, 'STAFF_DENIED', 'Tu cuenta no tiene acceso. Pide a la encargada que te autorice.');
  let names = {};
  try { names = JSON.parse(env.INVENTARIO_STAFF_NAMES || '{}'); } catch { /* Names never grant access. */ }
  return { staffId: claims.sub, staffName: typeof names?.[claims.sub] === 'string' ? names[claims.sub].slice(0, 100) : null, token };
}
