const encoder = new TextEncoder();
const criticalProxyFields = ['signature', 'shop', 'timestamp', 'logged_in_customer_id', 'path_prefix'];
const shopPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;

function authRequired() {
  return Object.assign(new Error('Autenticación requerida.'), { code: 'AUTH_REQUIRED' });
}

function validSecret(secret) {
  return typeof secret === 'string' && secret.trim().length > 0;
}

function validSeconds(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateConfig(secret, shop, nowSeconds) {
  if (!validSecret(secret) || typeof shop !== 'string' || !shopPattern.test(shop) || !validSeconds(nowSeconds)) {
    throw authRequired();
  }
}

async function verifyHmac(bytes, signature, secret) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  );
  // WebCrypto performs the MAC comparison without an application-level string comparison.
  return globalThis.crypto.subtle.verify('HMAC', key, signature, bytes);
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw authRequired();
  }
  const decoded = atob(value);
  if (btoa(decoded) !== value) throw authRequired();
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw authRequired();
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return decodeBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
}

/** Authenticate Shopify's signed app-proxy query and require a logged-in customer.
 * https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
 */
export async function verifyAppProxy(url, options) {
  try {
    const { secret, shop, nowSeconds = Math.floor(Date.now() / 1000), maxAgeSeconds = 300, allowAnonymous = false } = options;
    validateConfig(secret, shop, nowSeconds);
    if (!validSeconds(maxAgeSeconds) || !(typeof url === 'string' || url instanceof URL)) throw authRequired();
    const parameters = new URL(url instanceof URL ? url.href : url).searchParams;
    for (const field of criticalProxyFields) {
      if (parameters.getAll(field).length > 1) throw authRequired();
    }

    const customerId = parameters.get('logged_in_customer_id');
    const timestampText = parameters.get('timestamp');
    const signatureHex = parameters.get('signature');
    if (parameters.get('shop') !== shop || !(/^\d+$/.test(customerId ?? '') || (allowAnonymous === true && !customerId)) ||
        !/^\d+$/.test(timestampText ?? '') || !/^[a-f\d]{64}$/i.test(signatureHex ?? '')) {
      throw authRequired();
    }
    const timestamp = Number(timestampText);
    if (!validSeconds(timestamp) || nowSeconds - timestamp > maxAgeSeconds || timestamp - nowSeconds > 60) {
      throw authRequired();
    }

    // URLSearchParams decodes once; Shopify groups repeats with commas, sorts full
    // key=value strings, then concatenates them without ampersands (not OAuth HMAC).
    const grouped = new Map();
    for (const [key, value] of parameters) {
      if (key === 'signature') continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(value);
    }
    const message = [...grouped].map(([key, values]) => `${key}=${values.join(',')}`).sort().join('');
    const signature = Uint8Array.from(signatureHex.match(/../g), pair => Number.parseInt(pair, 16));
    if (!await verifyHmac(encoder.encode(message), signature, secret)) throw authRequired();
    return { shop, customerId: customerId || null };
  } catch {
    throw authRequired();
  }
}

/** Verify the Shopify webhook header against the unparsed request body bytes.
 * https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
 */
export async function verifyWebhook(rawBody, base64Hmac, secret) {
  try {
    if (!(rawBody instanceof Uint8Array) || !validSecret(secret)) return false;
    const signature = decodeBase64(base64Hmac);
    if (signature.length !== 32) return false;
    return await verifyHmac(rawBody, signature, secret);
  } catch {
    return false;
  }
}

/** Authenticate an App Bridge ID/session token for this embedded admin app.
 * https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens
 */
export async function verifyAdminSession(token, options) {
  try {
    const { secret, clientId, shop, nowSeconds = Math.floor(Date.now() / 1000) } = options;
    validateConfig(secret, shop, nowSeconds);
    if (typeof clientId !== 'string' || !clientId.trim() || typeof token !== 'string') throw authRequired();
    const parts = token.split('.');
    if (parts.length !== 3) throw authRequired();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const header = JSON.parse(decoder.decode(decodeBase64Url(parts[0])));
    if (header?.alg !== 'HS256' || (header.typ !== undefined && header.typ !== 'JWT') ||
        header.crit !== undefined || header.b64 !== undefined) throw authRequired();
    const signature = decodeBase64Url(parts[2]);
    if (signature.length !== 32 || !await verifyHmac(encoder.encode(`${parts[0]}.${parts[1]}`), signature, secret)) {
      throw authRequired();
    }
    const claims = JSON.parse(decoder.decode(decodeBase64Url(parts[1])));
    if (claims?.aud !== clientId || claims.dest !== `https://${shop}` || claims.iss !== `https://${shop}/admin` ||
        typeof claims.sub !== 'string' || !/^\d+$/.test(claims.sub) ||
        !validSeconds(claims.exp) || !validSeconds(claims.nbf) || !validSeconds(claims.iat) ||
        claims.exp <= nowSeconds || claims.nbf > nowSeconds || claims.iat > nowSeconds ||
        claims.exp <= claims.nbf || claims.exp <= claims.iat) throw authRequired();
    return { shop, staffId: claims.sub };
  } catch {
    throw authRequired();
  }
}
