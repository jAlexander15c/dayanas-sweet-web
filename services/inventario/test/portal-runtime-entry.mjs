// LOCAL TEST ONLY: all outbound requests are replaced; never deployed or forwarded.
import worker, { InventoryStore as ProductionInventoryStore, StaffIdentityStore as ProductionStaffIdentityStore } from '../src/cloudflare-worker.mjs';
import { createShopifyMock } from './shopify-fixture.mjs';
const mock = createShopifyMock(), emails = [];
globalThis.fetch = async (url, init) => {
  if (String(url) === 'https://api.resend.com/emails') {
    const email = JSON.parse(init.body); emails.push(email);
    if (email.subject === 'Código para recuperar tu acceso') await new Promise(resolve => setTimeout(resolve, 300));
    return Response.json({ id: 'synthetic-mail' });
  }
  if (String(url).endsWith('/admin/oauth/access_token')) {
    const params = new URLSearchParams(init.body);
    if (params.get('requested_token_type')?.endsWith('offline-access-token') || params.get('grant_type') === 'refresh_token') return Response.json({ access_token: 'synthetic-offline-token', refresh_token: 'synthetic-refresh-token', expires_in: 3600, refresh_token_expires_in: 7776000 });
  }
  return mock.fetch(url, init);
};
// Test-only inspection proves actual namespaces/SQL ownership, without exposing a production endpoint.
export class InventoryStore extends ProductionInventoryStore {
  inspect() { return this.ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type = ?', 'table').toArray().map(r => r.name); }
}
export class StaffIdentityStore extends ProductionStaffIdentityStore {
  inspect() { return this.ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type = ?', 'table').toArray().map(r => r.name); }
}
export default { async fetch(request, env, ctx) {
  const path = new URL(request.url).pathname;
  if (path === '/__test/emails') return Response.json(emails);
  if (path === '/__test/calls') return Response.json(mock.state.calls);
  if (path === '/__test/storage') return Response.json({ inventory: await env.INVENTARIO.get(env.INVENTARIO.idFromName(env.SHOPIFY_SHOP)).inspect(), identity: await env.IDENTITY.get(env.IDENTITY.idFromName('identity:' + env.SHOPIFY_SHOP)).inspect() });
  if (path === '/__test/disabled') return worker.fetch(new Request(request.url.replace('/__test/disabled', '/proxy')), { ...env, EXTERNAL_LOGIN_ENABLED: 'false' }, ctx);
  return worker.fetch(request, env, ctx);
} };
