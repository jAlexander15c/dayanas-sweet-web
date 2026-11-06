// LOCAL TEST ONLY: Inventario portal + the real Celebraciones orders gateway/service in one local
// Worker. Shopify (both apps) and Resend are simulated; nothing leaves the process. Never deployed.
import worker, { InventoryStore as ProductionInventoryStore, StaffIdentityStore as ProductionStaffIdentityStore } from '../src/cloudflare-worker.mjs';
import { createShopifyMock } from './shopify-fixture.mjs';
import { handleStaffGateway } from '../../celebraciones/src/staff-gateway.mjs';
import { createShopifyAdminTransport } from '../../celebraciones/src/shopify-payments.mjs';
import { createShopifyOrdersClient } from '../../celebraciones/src/orders-shopify.mjs';
import { createOrdersStore, sqlFromStorage } from '../../celebraciones/src/orders-store.mjs';
import { createOrdersService } from '../../celebraciones/src/orders-service.mjs';
import { cancellableOrder, createFakeShopify, sampleOrders } from '../../celebraciones/test/fake-shopify-orders.mjs';

const mock = createShopifyMock(), emails = [], orders = createFakeShopify({ orders: [...sampleOrders(), cancellableOrder()] });
const forwarded = [];
const stock = { 'gid://shopify/ProductVariant/503': 4, 'gid://shopify/ProductVariant/506': 5, 'gid://shopify/ProductVariant/501': 0 };
const variantNodes = [
  { id: 'gid://shopify/ProductVariant/503', title: 'Caja de 6', price: '12.00', inventoryQuantity: 4, inventoryItem: { tracked: true }, product: { title: 'Galletas de avena', status: 'ACTIVE' } },
  { id: 'gid://shopify/ProductVariant/506', title: 'Snickerdoodle', price: '12.00', inventoryQuantity: 5, inventoryItem: { tracked: true }, product: { title: 'Galletas', status: 'ACTIVE' } },
  { id: 'gid://shopify/ProductVariant/501', title: 'Caja de 6', price: '24.00', inventoryQuantity: 0, inventoryItem: { tracked: true }, product: { title: 'Galletas surtidas', status: 'ACTIVE' } },
];
globalThis.fetch = async (url, init) => {
  if (String(url) === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'synthetic-mail' }); }
  if (String(url).endsWith('/admin/oauth/access_token')) {
    const params = new URLSearchParams(init.body);
    if (params.get('requested_token_type')?.endsWith('offline-access-token') || params.get('grant_type') === 'refresh_token') return Response.json({ access_token: 'synthetic-offline-token', refresh_token: 'synthetic-refresh-token', expires_in: 3600, refresh_token_expires_in: 7776000 });
  }
  const body = typeof init?.body === 'string' ? init.body : '';
  if (body.includes('PedidosVariants')) return Response.json({ data: { productVariants: { nodes: variantNodes, pageInfo: { hasNextPage: false, endCursor: null } } } });
  if (body.includes('PedidosStock')) { const { variables } = JSON.parse(body); return Response.json({ data: { nodes: variables.ids.map(id => ({ id, inventoryQuantity: stock[id] ?? 0, inventoryItem: { tracked: true }, product: { status: 'ACTIVE' } })) } }); }
  return mock.fetch(url, init);
};
export class InventoryStore extends ProductionInventoryStore {
  constructor(ctx, env) {
    const transport = createShopifyAdminTransport({ shop: env.SHOPIFY_SHOP, clientId: 'synthetic-celebraciones', secret: 'synthetic-secret', fetchImpl: orders.fetch });
    const ordersService = createOrdersService({ client: createShopifyOrdersClient({ transport }), store: createOrdersStore(sqlFromStorage(ctx.storage)) });
    // Same contract as the RPC service binding: a structured clone of the input, nothing else.
    const binding = { handle: async input => { const copy = JSON.parse(JSON.stringify(input)); forwarded.push(copy); return handleStaffGateway(copy, { config: { shop: env.SHOPIFY_SHOP }, ordersService }); } };
    super(ctx, { ...env, CELEBRACIONES: binding });
  }
}
export class StaffIdentityStore extends ProductionStaffIdentityStore {}
export default { async fetch(request, env, ctx) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/__test/emails') return Response.json(emails);
  if (path === '/__test/pedidos') return Response.json({ calls: orders.calls, moneyCalls: orders.moneyCalls, forwarded: forwarded.map(input => ({ actor: input.actor, path: input.path, body: input.body })) });
  if (path === '/__test/pedidos-next') { orders.next(url.searchParams.get('op'), url.searchParams.get('mode')); return Response.json({ ok: true }); }
  return worker.fetch(request, env, ctx);
} };
