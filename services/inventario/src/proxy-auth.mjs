import { fail } from './errors.mjs';
import { shopPattern } from './shopify-auth.mjs';
export async function verifyAppProxy(request, env, now = Date.now()) {
  try {
    const p = new URL(request.url).searchParams;
    if (!shopPattern.test(env.SHOPIFY_SHOP || '') || !env.SHOPIFY_APP_SECRET) throw Error();
    for (const key of ['signature', 'shop', 'timestamp', 'logged_in_customer_id', 'path_prefix']) if (p.getAll(key).length > 1) throw Error();
    const signature = p.get('signature'), timestamp = p.get('timestamp');
    if (p.get('shop') !== env.SHOPIFY_SHOP || !/^\d+$/.test(timestamp || '') || !Number.isSafeInteger(Number(timestamp)) || Math.abs(now / 1000 - Number(timestamp)) > 600 || !/^[a-f\d]{64}$/i.test(signature || '')) throw Error();
    const grouped = new Map();
    for (const [key, value] of p) if (key !== 'signature') grouped.set(key, [...(grouped.get(key) || []), value]);
    const message = [...grouped].map(([key, values]) => `${key}=${values.join(',')}`).sort().join('');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SHOPIFY_APP_SECRET.trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, Uint8Array.from(signature.match(/../g), h => parseInt(h, 16)), new TextEncoder().encode(message))) throw Error();
    // logged_in_customer_id deliberately grants no access.
  } catch { throw fail(401, 'AUTH_REQUIRED', 'Autenticación requerida.'); }
}
