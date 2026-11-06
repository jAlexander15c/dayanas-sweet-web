import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopifyClient } from '../src/shopify-client.mjs';
import { createShopifyMock, testEnv, sampleProduct, productId, locationId } from './shopify-fixture.mjs';
test('detalle recorre todas las páginas de opciones, niveles y tiendas', async () => {
  const mock = createShopifyMock();
  const p = sampleProduct();
  p.variants.pageInfo = { hasNextPage: true, endCursor: 'v2' };
  p.variants.nodes[0].inventoryItem.inventoryLevels.pageInfo = { hasNextPage: true, endCursor: 'l2' };
  let locationsCalls = 0, variantCalls = 0, levelCalls = 0;
  const client = createShopifyClient({ env: testEnv, sessionToken: 'synthetic', staffId: '123', fetchImpl: async (url, init) => {
    if (!String(url).includes('graphql.json')) return mock.fetch(url, init);
    const { query, variables } = JSON.parse(init.body);
    if (query.includes('query InventoryLocations')) {
      locationsCalls++;
      return Response.json({ data: { locations: { nodes: [{ id: variables.after ? 'gid://shopify/Location/402' : locationId, isActive: true, name: 'Tienda' }], pageInfo: { hasNextPage: !variables.after, endCursor: 'next' } } } });
    }
    if (query.includes('query InventoryProduct')) return Response.json({ data: { product: p } });
    if (query.includes('query InventoryVariants')) { variantCalls++; const v = sampleProduct().variants.nodes[0]; v.id = 'gid://shopify/ProductVariant/202'; return Response.json({ data: { product: { variants: { nodes: [v], pageInfo: { hasNextPage: false } } } } }); }
    if (query.includes('query InventoryLevels')) { levelCalls++; return Response.json({ data: { inventoryItem: { inventoryLevels: { nodes: [{ location: { id: 'gid://shopify/Location/402', name: 'Segunda' }, quantities: [] }], pageInfo: { hasNextPage: false } } } } }); }
    if (query.includes('query InventoryCollections')) return mock.fetch(url, init);
    throw Error('Unexpected query');
  } });
  const result = await client.product(productId); assert.equal(result.variants.nodes.length, 2); assert.equal(result.variants.nodes[0].inventoryItem.inventoryLevels.nodes.length, 2); assert.equal(variantCalls, 1); assert.equal(levelCalls, 1);
  assert.equal((await client.locations()).length, 2); assert.equal(locationsCalls, 2);
});
test('errores GraphQL y credenciales nunca se devuelven sin filtrar', async () => {
  const client = createShopifyClient({ env: testEnv, sessionToken: 'synthetic', staffId: '123', fetchImpl: async url => String(url).includes('access_token') ? Response.json({ access_token: 'very-private-token', associated_user: { id: 123 }, expires_in: 60 }) : Response.json({ errors: [{ message: 'very-private-token raw-debug-body' }] }) });
  await assert.rejects(client.product(productId), error => error.code === 'SHOPIFY_QUERY_FAILED' && !error.message.includes('very-private-token'));
});
