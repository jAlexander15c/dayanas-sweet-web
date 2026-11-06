// Synthetic data only. This mock never forwards traffic to a network.
export const productId = 'gid://shopify/Product/101';
export const variantId = 'gid://shopify/ProductVariant/201';
export const itemId = 'gid://shopify/InventoryItem/301';
export const locationId = 'gid://shopify/Location/401';
export const categoryId = 'gid://shopify/Collection/701';
export function sampleCategory(overrides = {}) {
  return { id: categoryId, title: 'Brownies de prueba', description: 'Hechos en casa', descriptionHtml: '<p>Hechos en casa</p>', updatedAt: '2026-11-03T12:00:00Z', sources: [], publishedOnPublication: true, image: { id: 'gid://shopify/ImageSource/901', url: 'https://cdn.shopify.com/test/category.png', altText: 'Brownies en caja' }, productsCount: { count: 0 }, categoria: { value: 'true' }, enInicio: { value: 'true' }, orden: { value: '1' }, ...overrides };
}
export function tagSources(tag = 'galletas') {
  const selections = () => ({ nodes: [], pageInfo: { hasNextPage: false } });
  return [{ __typename: 'CollectionConditionsSource', inclusion: { conditions: [{ id: 'tag-rule', __typename: 'CollectionSourceInclusionConditionProductTag', relation: 'TAGGED_WITH', values: [tag] }], selections: selections() }, exclusion: { conditions: [], selections: selections() } }];
}
export const testEnv = { SHOPIFY_SHOP: 'inventario-test.myshopify.com', SHOPIFY_CLIENT_ID: 'test-client', SHOPIFY_APP_SECRET: 'local-test-secret-not-a-real-credential', INVENTARIO_STAFF_IDS: '123', INVENTARIO_STAFF_NAMES: '{"123":"Pastelera de prueba"}', SERVICE_ENABLED: 'true' };
export function sampleProduct() {
  return { id: productId, title: 'Caja de prueba', description: 'Descripción', descriptionHtml: '<p>Descripción</p>', status: 'DRAFT', featuredImage: null, media: { nodes: [] }, variants: { nodes: [{ id: variantId, title: 'Default Title', price: '12.00', sku: 'CAJA', inventoryItem: { id: itemId, tracked: true, inventoryLevels: { nodes: [{ location: { id: locationId, name: 'Cocina de prueba' }, quantities: [{ name: 'available', quantity: 4 }, { name: 'on_hand', quantity: 6 }, { name: 'committed', quantity: 2 }] }], pageInfo: { hasNextPage: false, endCursor: null } } } }], pageInfo: { hasNextPage: false, endCursor: null } } };
}
export function createShopifyMock() {
  const state = { product: { ...sampleProduct(), tags: [], collections: { nodes: [], pageInfo: { hasNextPage: false } } }, collections: [sampleCategory()], definitions: [], published: [], calls: [], receipts: new Map(), applied: 0, exchanges: 0, stale: false, rejectMutation: false, rejectRoot: null, failTransport: false, activateNeeded: false };
  const fetch = async (url, init = {}) => {
    if (String(url).endsWith('/admin/oauth/access_token')) {
      const params = new URLSearchParams(init.body);
      if (params.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:token-exchange' || params.get('requested_token_type') !== 'urn:shopify:params:oauth:token-type:online-access-token') throw Error('Wrong token grant');
      state.exchanges++;
      const subject = params.get('subject_token');
      let sub = '123';
      try { sub = JSON.parse(atob(subject.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch {}
      return Response.json({ access_token: 'mock-admin-token', expires_in: 3600, associated_user: { id: sub } });
    }
    if (String(url).startsWith('https://shopify-staged-uploads.storage.googleapis.com/')) return new Response('', { status: 201 });
    if (!String(url).endsWith('/admin/api/2026-10/graphql.json')) throw Error('Unexpected mock URL: ' + url);
    const body = JSON.parse(init.body);
    state.calls.push(body);
    const { query, variables: v } = body;
    const root = /\{\s*(\w+)\s*(?:\(|\{)/.exec(query)[1];
    if (root === 'publications' && state.publicationsDenied) return Response.json({ errors: [{ message: 'Missing scope', extensions: { code: 'ACCESS_DENIED' } }] });
    if (v.key && state.receipts.has(v.key)) return Response.json(state.receipts.get(v.key));
    if (query.startsWith('mutation') && state.graphqlCode) {
      const code = state.graphqlCode;
      if (!state.keepGraphqlCode) state.graphqlCode = null;
      return Response.json({ errors: [{ message: 'private-debug', extensions: { code } }], ...(state.partialData ? { data: { [root]: { userErrors: [], ...(state.partialProductId ? { product: { id: state.partialProductId } } : {}) } } } : {}) });
    }
    if (state.failTransport && query.startsWith('mutation')) throw Error('Simulated lost response');
    let value;
    if (query.startsWith('mutation') && (state.rejectMutation || state.rejectRoot === root)) return Response.json({ data: { [root]: { userErrors: [{ message: 'Acción rechazada', code: 'INVALID' }] } } });
    if (root === 'currentAppInstallation') value = { accessScopes: (state.scopes || ['read_products', 'write_products', 'read_inventory', 'write_inventory', 'read_locations', 'write_files', 'read_publications', 'write_publications']).map(handle => ({ handle })) };
    else if (root === 'locations') value = { nodes: [{ id: locationId, name: 'Cocina de prueba', isActive: true }], pageInfo: { hasNextPage: false } };
    else if (root === 'publications') value = { nodes: state.publications || [{ id: 'gid://shopify/Publication/801', channels: { nodes: [{ handle: 'online_store' }], pageInfo: { hasNextPage: false } } }], pageInfo: { hasNextPage: false } };
    else if (root === 'collections') value = { nodes: structuredClone(state.collections).map(c => ({ ...c, productsCount: { count: state.product.collections.nodes.some(member => member.id === c.id) ? 1 : 0 } })), pageInfo: { hasNextPage: false } };
    else if (root === 'collection') value = structuredClone(state.collections.find(c => c.id === v.id) || null);
    else if (root === 'node') { const resource = v.id.includes('/Collection/') ? state.collections.find(c => c.id === v.id) : state.product; value = resource ? { publishedOnPublication: resource.publishedOnPublication === true } : null; }
    else if (root === 'metafieldDefinitions') value = { nodes: structuredClone(state.definitions), pageInfo: { hasNextPage: false } };
    else if (root === 'metafieldDefinitionCreate') {
      const definition = { ...v.definition, id: `gid://shopify/MetafieldDefinition/${state.definitions.length + 1}`, type: { name: v.definition.type } };
      state.definitions.push(definition);
      value = { createdDefinition: { id: definition.id }, userErrors: [] };
    } else if (root === 'metafieldDefinitionUpdate') {
      const definition = state.definitions.find(d => d.key === v.definition.key);
      definition.access = v.definition.access;
      value = { updatedDefinition: { id: definition.id }, userErrors: [] };
    } else if (root === 'collectionCreate' || root === 'collectionUpdate') {
      const input = v.collection || v.input;
      const c = root === 'collectionCreate' ? sampleCategory({ id: `gid://shopify/Collection/${702 + state.collections.length}`, title: input.title, publishedOnPublication: false }) : state.collections.find(c => c.id === input.id);
      if (root === 'collectionCreate') state.collections.push(c);
      for (const key of ['title', 'descriptionHtml']) if (input[key] !== undefined) c[key] = input[key];
      c.description = c.descriptionHtml.replace(/<[^>]*>/g, '');
      if (input.image) c.image = { id: input.image.id || `gid://shopify/ImageSource/${902 + state.calls.length}`, url: input.image.src ? (input.image.src.includes('staged-uploads') ? `https://cdn.shopify.com/test/category-${c.id.split('/').at(-1)}.png` : input.image.src) : c.image.url, altText: input.image.altText };
      for (const m of input.metafields || []) c[{ categoria: 'categoria', en_inicio: 'enInicio', orden: 'orden' }[m.key]] = { value: m.value };
      value = { collection: { id: c.id }, userErrors: [] };
    } else if (root === 'tagsAdd' || root === 'tagsRemove') {
      if (root === 'tagsAdd') for (const tag of v.tags) {
        if (!state.product.tags.some(t => t.toLowerCase() === tag.toLowerCase())) state.product.tags.push(tag);
      }
      else state.product.tags = state.product.tags.filter(t => !v.tags.some(tag => t.toLowerCase() === tag.toLowerCase()));
      // Deliberately do NOT update collection membership: Shopify is asynchronous.
      value = { node: { id: v.id }, userErrors: [] };
    } else if (root === 'collectionAddProducts') {
      const c = state.collections.find(c => c.id === v.id);
      if (!state.product.collections.nodes.some(c => c.id === v.id)) state.product.collections.nodes.push(structuredClone(c));
      value = { collection: { id: v.id }, userErrors: [] };
    } else if (root === 'collectionRemoveProducts') {
      if (!state.jobStuck) state.product.collections.nodes = state.product.collections.nodes.filter(c => c.id !== v.id);
      value = { job: { id: 'gid://shopify/Job/mock', done: !state.jobStuck }, userErrors: [] };
    } else if (root === 'job') value = { id: v.id, done: !state.jobStuck };
    else if (root === 'publishablePublish') { state.published.push({ id: v.id, publicationId: v.input[0].publicationId }); const resource = v.id.includes('/Collection/') ? state.collections.find(c => c.id === v.id) : state.product; if (resource && !state.publishUnconfirmed) resource.publishedOnPublication = true; value = { publishable: { publishedOnPublication: !state.publishUnconfirmed }, userErrors: [] }; }
    else if (root === 'products') value = { nodes: [structuredClone(state.product)], pageInfo: { hasNextPage: false, endCursor: null } };
    else if (root === 'product') value = v.id === state.product.id ? structuredClone(state.product) : null;
    else if (root === 'productCreate') {
      Object.assign(state.product, v.product);
      state.product.publishedOnPublication = false;
      state.product.collections = { nodes: [], pageInfo: { hasNextPage: false } };
      state.product.tags = [];
      state.product.variants.nodes[0].inventoryItem.inventoryLevels.nodes[0].quantities.forEach(q => { q.quantity = 0; });
      if (state.activateNeeded) state.product.variants.nodes[0].inventoryItem.inventoryLevels.nodes = [];
      value = { product: structuredClone(state.product), userErrors: [] };
    } else if (root === 'productDelete') { state.deleted = v.input.id; value = { deletedProductId: v.input.id, userErrors: [] }; }
    else if (root === 'productUpdate') { Object.assign(state.product, v.product); value = { product: { id: state.product.id }, userErrors: [] }; }
    else if (root === 'productVariantsBulkUpdate') {
      const variant = state.product.variants.nodes[0];
      if (v.variants[0].price !== undefined) variant.price = v.variants[0].price;
      if (v.variants[0].inventoryItem?.sku !== undefined) variant.sku = v.variants[0].inventoryItem.sku;
      value = { productVariants: [{ id: variantId }], userErrors: [] };
    } else if (root === 'inventoryActivate') {
      state.product.variants.nodes[0].inventoryItem.inventoryLevels.nodes = sampleProduct().variants.nodes[0].inventoryItem.inventoryLevels.nodes;
      state.product.variants.nodes[0].inventoryItem.inventoryLevels.nodes[0].quantities.forEach(q => { q.quantity = 0; });
      value = { inventoryLevel: { id: 'gid://shopify/InventoryLevel/501' }, userErrors: [] };
    } else if (root === 'inventoryAdjustQuantities' || root === 'inventorySetQuantities') {
      const level = state.product.variants.nodes[0].inventoryItem.inventoryLevels.nodes[0];
      const target = level.quantities.find(q => q.name === v.input.name);
      const input = (v.input.changes || v.input.quantities)[0];
      if (state.stale) { target.quantity += 1; state.stale = false; }
      if (target.quantity !== input.changeFromQuantity) value = { inventoryAdjustmentGroup: null, userErrors: [{ code: 'CHANGE_FROM_QUANTITY_STALE', message: 'Quantity changed' }] };
      else {
        const delta = root === 'inventoryAdjustQuantities' ? input.delta : input.quantity - target.quantity;
        target.quantity += delta;
        // Shopify moves the physical and available totals together for these changes.
        level.quantities.find(q => q.name === (v.input.name === 'available' ? 'on_hand' : 'available')).quantity += delta;
        state.applied++;
        value = { inventoryAdjustmentGroup: { id: 'gid://shopify/InventoryAdjustmentGroup/601', changes: [{ name: v.input.name, delta, quantityAfterChange: target.quantity }] }, userErrors: [] };
      }
    } else if (root === 'stagedUploadsCreate') value = { stagedTargets: [{ url: 'https://shopify-staged-uploads.storage.googleapis.com/test', resourceUrl: 'https://shopify-staged-uploads.storage.googleapis.com/test/photo', parameters: [{ name: 'key', value: 'mock' }] }], userErrors: [] };
    else throw Error('Unhandled GraphQL in mock: ' + root);
    const result = { data: { [root]: value } };
    if (v.key) state.receipts.set(v.key, result);
    if ((v.key && state.loseAfterApply) || state.loseRoot === root) { state.loseAfterApply = false; state.loseRoot = null; throw Error('Applied, response lost'); }
    return Response.json(result);
  };
  return { state, fetch };
}
