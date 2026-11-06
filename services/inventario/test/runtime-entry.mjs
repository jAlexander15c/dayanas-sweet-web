// LOCAL TEST ENTRY ONLY. Not referenced by production wrangler.jsonc.
// All outbound fetch is replaced, including unknown URLs (mock throws).
import worker, { InventoryStore, StaffIdentityStore } from '../src/cloudflare-worker.mjs';
import { createShopifyMock, sampleCategory, tagSources } from './shopify-fixture.mjs';
const mock = createShopifyMock();
globalThis.fetch = mock.fetch;
export { InventoryStore, StaffIdentityStore };
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === '/__test/auth-guard') {
      let touches = 0;
      const response = await worker.fetch(new Request('https://panel.test/api/products', { headers: request.headers }), { ...env, INVENTARIO: { idFromName() { touches++; return 'test'; }, get() { touches++; return { fetch: () => Response.json({ forwarded: true }) }; } } });
      return Response.json({ status: response.status, touches });
    }
    if (path === '/__test/calls') return Response.json(mock.state.calls);
    if (path === '/__test/tag-category-fixtures') {
      mock.state.collections = ['Galletas', 'Brownies', 'Enlatados', 'Cajas para regalar', 'Postres'].map((title, i) => sampleCategory({ id: `gid://shopify/Collection/${810 + i}`, title, categoria: null, enInicio: null, orden: null, sources: tagSources(['galletas', 'brownies', 'enlatados', 'cajas-para-regalar', 'postres'][i]) })).concat([
        sampleCategory({ id: 'gid://shopify/Collection/820', title: 'Más vendidos', categoria: null, sources: [{ __typename: 'CollectionConditionsSource', inclusion: { conditions: [{ id: 'complex-a' }, { id: 'complex-b' }] } }] }),
        sampleCategory({ id: 'gid://shopify/Collection/821', title: 'Página de inicio', categoria: null, enInicio: null, orden: null, image: null }),
      ]);
      mock.state.product.tags = ['GALLETAS', 'conservar'];
      mock.state.product.collections.nodes = [];
      return Response.json({ ok: true });
    }
    if (path === '/__test/real-shape') {
      mock.state.collections = ['Brownies', 'Cajas para regalar', 'Enlatados', 'Galletas', 'Postres'].map((title, i) => sampleCategory({ id: `gid://shopify/Collection/${800 + i}`, title, categoria: null, enInicio: null, orden: null, image: null, descriptionHtml: '', description: '' })).concat(sampleCategory({ id: 'gid://shopify/Collection/899', title: 'Más vendidos', categoria: null, enInicio: null, orden: null, image: null, sources: [{ __typename: 'CollectionConditionsSource', inclusion: { conditions: [{ id: 'rule' }] } }] }));
      return Response.json({ ok: true });
    }
    if (path === '/__test/adoption-fixtures') {
      mock.state.collections = [sampleCategory(), ...['Galletas existentes', 'Enlatados existentes', 'Brownies para publicar', 'Colección con foto nueva'].map((title, i) => sampleCategory({ id: `gid://shopify/Collection/${710 + i}`, title, categoria: null, publishedOnPublication: false, ...(i === 1 || i === 3 ? { image: null } : {}) })), sampleCategory({ id: 'gid://shopify/Collection/720', title: 'Automática de prueba', categoria: null, sources: [{ __typename: 'CollectionConditionsSource', inclusion: { conditions: [{ id: 'rule' }] } }] }), ...Array.from({ length: 98 }, (_, i) => sampleCategory({ id: `gid://shopify/Collection/${1000 + i}`, title: `Otra colección ${i + 1}`, categoria: null }))];
      return Response.json({ ok: true });
    }
    if (path === '/__test/adoption-lost') { mock.state.loseRoot = 'collectionUpdate'; return Response.json({ ok: true }); }
    if (path === '/__test/adoption-no-publications') { mock.state.publicationsDenied = true; return Response.json({ ok: true }); }
    if (path === '/__test/format') { mock.state.product.descriptionHtml = '<p><strong>Descripción con formato</strong></p>'; return Response.json({ ok: true }); }
    if (path === '/__test/category-unpublished') { mock.state.collections[0].publishedOnPublication = false; return Response.json({ ok: true }); }
    if (path === '/__test/category-format') { mock.state.collections[0].descriptionHtml = '<p><strong>Hechos en casa</strong></p>\n'; return Response.json({ ok: true }); }
    if (path === '/__test/lost') { mock.state.loseAfterApply = true; return Response.json({ ok: true }); }
    if (path === '/__test/reject-price') { mock.state.rejectRoot = mock.state.rejectRoot ? null : 'productVariantsBulkUpdate'; return Response.json({ ok: true }); }
    if (path === '/__test/sale') {
      const qs = mock.state.product.variants.nodes[0].inventoryItem.inventoryLevels.nodes[0].quantities;
      qs.find(q => q.name === 'available').quantity--;
      qs.find(q => q.name === 'committed').quantity++;
      return Response.json({ ok: true });
    }
    if (path === '/__test/stale') { mock.state.stale = true; return Response.json({ ok: true }); }
    return worker.fetch(request, env, ctx);
  },
};
