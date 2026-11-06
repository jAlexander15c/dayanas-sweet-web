import { fail } from './errors.mjs';
import { encryptToken, decryptToken } from './staff-crypto.mjs';
import { shopPattern } from './shopify-auth.mjs';
export function createOfflineToken({ env, store, fetchImpl = globalThis.fetch, now = Date.now }) {
  let tail = Promise.resolve();
  const serialized = fn => { const run = tail.then(fn); tail = run.catch(() => {}); return run; };
  const reconnect = () => fail(503, 'RECONNECT_REQUIRED', 'Conecta el acceso externo desde Shopify.');
  async function exchange(parameters) {
    if (!shopPattern.test(env.SHOPIFY_SHOP || '') || !env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_APP_SECRET) throw reconnect();
    try {
      const response = await fetchImpl(`https://${env.SHOPIFY_SHOP}/admin/oauth/access_token`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_APP_SECRET.trim(), ...parameters }) });
      if (!response.ok) throw reconnect();
      const data = await response.json();
      if (!data.access_token || !data.refresh_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || !Number.isFinite(data.refresh_token_expires_in) || data.refresh_token_expires_in <= 0) throw reconnect();
      const value = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: now() + data.expires_in * 1000, refresh_expires_at: now() + data.refresh_token_expires_in * 1000 };
      store.put('offline_credentials', { id: env.SHOPIFY_SHOP, ciphertext: await encryptToken(value, env.INVENTARIO_TOKEN_KEY, env.SHOPIFY_SHOP) });
      return value.access_token;
    } catch (error) { if (error.code === 'TOKEN_CONFIG') throw error; throw reconnect(); }
  }
  return {
    connect(sessionToken) { return serialized(async () => { // Validate encryption config before sending OAuth credentials.
      await encryptToken({}, env.INVENTARIO_TOKEN_KEY, env.SHOPIFY_SHOP);
      await exchange({ grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: sessionToken, subject_token_type: 'urn:ietf:params:oauth:token-type:id_token', requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token', expiring: '1' });
      return { connected: true };
    }); },
    get() { return serialized(async () => {
      const row = store.get('offline_credentials', env.SHOPIFY_SHOP); if (!row) throw reconnect();
      const value = await decryptToken(row.ciphertext, env.INVENTARIO_TOKEN_KEY, env.SHOPIFY_SHOP);
      if (value.expires_at > now() + 60000) return value.access_token;
      if (value.refresh_expires_at <= now()) throw reconnect();
      return exchange({ grant_type: 'refresh_token', refresh_token: value.refresh_token });
    }); },
  };
}
