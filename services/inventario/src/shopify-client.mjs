// Independent adaptation of Celebraciones' server-only GraphQL transport.
import { fail, requireValue } from './errors.mjs';
import { gid } from './validation.mjs';
import { shopPattern } from './shopify-auth.mjs';
import { sortCategories, isManual, isCategory, classifyCollection, categoryIds } from './categories.mjs';
export const API_VERSION = '2026-10';
export const REQUIRED_SCOPES = ['read_products', 'write_products', 'read_inventory', 'write_inventory', 'read_locations', 'write_files', 'read_publications', 'write_publications'];
// Bound to this environment object (and transport in tests); never persisted.
const onlineTokens = new WeakMap();
export const titleSearch = query => (query.match(/[\p{L}\p{N}]+/gu) || []).map(word => `title:${word}*`).join(' ') || null;
const page = 'pageInfo { hasNextPage endCursor }';
// Keep requested connection cost bounded below Shopify's 1000-point ceiling.
// Full detail paginates instead of requesting 100 options × 20 stock locations.
const levels = count => `inventoryLevels(first: ${count}) { nodes { location { id name } quantities(names: ["available", "on_hand", "committed"]) { name quantity } } ${page} }`;
const variantFields = (levelCount = 5) => `id title price sku inventoryItem { id tracked ${levels(levelCount)} }`;
const categoryFlag = 'categoria: metafield(namespace: "dayana", key: "categoria") { value }';
const sources = `sources { __typename ... on CollectionConditionsSource {
  inclusion { conditions { id __typename ... on CollectionSourceInclusionConditionProductTag { relation values } } selections(first: 1) { nodes { __typename } pageInfo { hasNextPage } } }
  exclusion { conditions { id __typename } selections(first: 1) { nodes { __typename } pageInfo { hasNextPage } } }
} }`;
// Sources adds nested objects per membership. Start small and complete every page
// separately, so the product search connection stays below Shopify's cost cap.
const membership = `collections(first: 3) { nodes { id title ${sources} ${categoryFlag} } ${page} }`;
const collectionFields = `id title description descriptionHtml updatedAt ${sources} image { id url altText } productsCount { count } ${categoryFlag} enInicio: metafield(namespace: "dayana", key: "en_inicio") { value } orden: metafield(namespace: "dayana", key: "orden") { value }`;
const categoryLists = collections => ({
  categories: sortCategories(collections).map(c => ({ ...c, ...classifyCollection(c) })),
  collections: collections.filter(c => !isCategory(c)).map(c => ({ ...c, ...classifyCollection(c), manual: isManual(c) })),
});
const productFields = (variantCount = 20, levelCount = 5) => `id title description descriptionHtml status tags featuredImage { url altText } ${membership} variants(first: ${variantCount}) { nodes { ${variantFields(levelCount)} } ${page} }`;
const attachCategories = (product, catalog) => {
  const ids = categoryIds(product, catalog);
  product.categories = catalog.filter(c => ids.includes(c.id)).map(c => ({ ...c, ...classifyCollection(c) }));
};
const groupFields = 'id createdAt changes { name delta quantityAfterChange }';

export function createShopifyClient({ env, sessionToken, staffId, tokenProvider, fetchImpl = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now() }) {
  requireValue(shopPattern.test(env.SHOPIFY_SHOP || '') && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_APP_SECRET && (sessionToken || tokenProvider));
  const origin = `https://${env.SHOPIFY_SHOP}`;
  let accessToken;
  let transportCache = onlineTokens.get(env);
  if (!transportCache) onlineTokens.set(env, transportCache = new WeakMap());
  let cache = transportCache.get(fetchImpl);
  if (!cache) transportCache.set(fetchImpl, cache = new Map());
  async function request(url, init, asJson = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'manual' });
      // Workers only support follow/manual; a manual 3xx is not ok and is handled as a failure below.
      // Keep the timeout active while consuming the JSON body as well.
      return asJson ? { response, data: response.ok ? await response.json() : null } : response;
    }
    catch (error) {
      // Transport exceptions can contain request headers or provider data. Log only a fixed event.
      console.warn(JSON.stringify({ event: 'shopify_fetch_failed' }));
      throw fail(502, 'REVIEW_REQUIRED', 'No pudimos confirmar la respuesta de Shopify. Revisa el historial y Shopify antes de repetir el cambio.'); }
    finally { clearTimeout(timer); }
  }
  async function token() {
    if (tokenProvider) return tokenProvider();
    const cached = staffId && cache.get(staffId);
    if (cached?.expires > now()) return cached.token;
    const { response, data } = await request(`${origin}/admin/oauth/access_token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_APP_SECRET.trim(), grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: sessionToken, subject_token_type: 'urn:ietf:params:oauth:token-type:id_token', requested_token_type: 'urn:shopify:params:oauth:token-type:online-access-token' }).toString(),
    }, true);
    if (!response.ok) throw fail(502, 'TOKEN_EXCHANGE_FAILED', 'No pudimos conectar con Shopify. Cierra y abre esta aplicación desde Shopify.');
    if (typeof data.access_token !== 'string' || !data.access_token) throw fail(502, 'TOKEN_EXCHANGE_FAILED', 'Shopify no autorizó la conexión. Revisa la instalación y los permisos de la aplicación.');
    if (!staffId || String(data.associated_user?.id) !== staffId) throw fail(403, 'ACCESS_DENIED', 'Shopify no autorizó los permisos de esta persona. Abre la aplicación otra vez.');
    accessToken = data.access_token;
    if (Number.isFinite(data.expires_in) && data.expires_in > 0) cache.set(staffId, { token: accessToken, expires: now() + data.expires_in * 1000 });
    return accessToken;
  }
  async function graphql(query, variables, root, mutation = false) {
    const t = await token();
    let response, data;
    for (let attempt = 0; attempt < 2; attempt++) {
      ({ response, data } = await request(`${origin}/admin/api/${API_VERSION}/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': t }, body: JSON.stringify({ query, variables }) }, true));
      if (tokenProvider && response.status === 401) throw fail(503, 'RECONNECT_REQUIRED', 'Conecta el acceso externo desde Shopify.');
      // Idempotency errors describe the original request, not a rejected new
      // adjustment. Classify them before partial data, permissions or CAS errors.
      const idempotencyCodes = [...(data?.errors || []), ...(data?.data?.[root]?.userErrors || [])]
        .flatMap(error => [error.code, error.extensions?.code])
        .filter(code => typeof code === 'string' && code.startsWith('IDEMPOTENCY_'));
      if (idempotencyCodes.length) {
        const concurrent = idempotencyCodes.every(code => code === 'IDEMPOTENCY_CONCURRENT_REQUEST');
        if (concurrent && attempt === 0) { await sleep(2000); continue; }
        throw fail(502, 'REVIEW_REQUIRED', concurrent
          ? 'Shopify aún está guardando este cambio. Espera un momento y pulsa Reintentar; no lo hagas de nuevo.'
          : 'No pudimos confirmar el cambio con su clave original. Revisa el inventario y el historial en Shopify antes de hacer otro cambio.', { retryable: concurrent });
      }
      const partial = mutation && data?.data?.[root] != null;
      if (partial && data.errors?.length) {
        const productId = data.data[root]?.product?.id;
        throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: revisa antes de repetir', /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/.test(productId || '') ? { productId } : {});
      }
      const codes = data?.errors?.map(error => error.extensions?.code) || [];
      if (response.status === 403 || codes.includes('ACCESS_DENIED')) throw fail(403, 'ACCESS_DENIED', 'Tu cuenta no tiene permisos para esta acción en Shopify. Pide a la encargada que los revise.');
      if (response.status === 429 || (codes.length && codes.every(code => code === 'THROTTLED'))) {
        if (attempt === 0) { await sleep(1000); continue; } // Identical query, variables and @idempotent key.
        throw fail(503, 'THROTTLED', 'Shopify está ocupado, intenta en unos segundos');
      }
      break;
    }
    if (!response.ok) throw fail(502, 'REVIEW_REQUIRED', 'Shopify no confirmó el cambio. Revisa Shopify antes de repetirlo.');
    if (data.errors?.length || !data.data || !Object.hasOwn(data.data, root)) throw fail(502, mutation ? 'REVIEW_REQUIRED' : 'SHOPIFY_QUERY_FAILED', mutation ? 'Sin confirmar: revisa antes de repetir' : 'Shopify no pudo completar la solicitud. Revisa los permisos de la aplicación e inténtalo desde Shopify.');
    const result = data.data[root];
    if (mutation && (!result || !Array.isArray(result.userErrors))) throw fail(502, 'REVIEW_REQUIRED', 'Shopify no confirmó el resultado. Revisa el producto desde Shopify.');
    if (result?.userErrors?.length) {
      const stale = result.userErrors.some(e => ['CHANGE_FROM_QUANTITY_STALE', 'COMPARE_QUANTITY_STALE'].includes(e.code));
      // Only Shopify's bounded userErrors, never raw HTTP/GraphQL errors or credentials.
      const message = result.userErrors.map(e => String(e.message).slice(0, 300)).join(' ').slice(0, 800);
      throw fail(stale ? 409 : 422, stale ? 'QUANTITY_CHANGED' : 'SHOPIFY_REJECTED', stale ? 'Las cajas cambiaron mientras corregías. Revisa y confirma otra vez.' : `Shopify no guardó este paso: ${message}`);
    }
    return result;
  }
  async function locations() {
    const result = [];
    let after = null;
    do {
      const connection = await graphql(`query InventoryLocations($after: String) { locations(first: 100, after: $after) { nodes { id name isActive } ${page} } }`, { after }, 'locations');
      result.push(...connection.nodes.filter(l => l.isActive));
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (after);
    return result;
  }
  async function product(id, complete = true) {
    const result = await graphql(`query InventoryProduct($id: ID!) { product(id: $id) { ${productFields()} } }`, { id: gid(id, 'Product') }, 'product');
    if (!result || result.id !== id) throw fail(404, 'PRODUCT_NOT_FOUND', 'No encontramos este producto en la tienda. Vuelve a buscarlo.');
    if (complete) {
      let after = result.variants.pageInfo.hasNextPage ? result.variants.pageInfo.endCursor : null;
      while (after) {
        const connection = await graphql(`query InventoryVariants($id: ID!, $after: String) { product(id: $id) { variants(first: 20, after: $after) { nodes { ${variantFields()} } ${page} } } }`, { id, after }, 'product');
        result.variants.nodes.push(...connection.variants.nodes);
        after = connection.variants.pageInfo.hasNextPage ? connection.variants.pageInfo.endCursor : null;
      }
      for (const variant of result.variants.nodes) {
        let cursor = variant.inventoryItem.inventoryLevels.pageInfo.hasNextPage ? variant.inventoryItem.inventoryLevels.pageInfo.endCursor : null;
        while (cursor) {
          const item = await graphql(`query InventoryLevels($id: ID!, $after: String) { inventoryItem(id: $id) { inventoryLevels(first: 100, after: $after) { nodes { location { id name } quantities(names: ["available", "on_hand", "committed"]) { name quantity } } ${page} } } }`, { id: variant.inventoryItem.id, after: cursor }, 'inventoryItem');
          variant.inventoryItem.inventoryLevels.nodes.push(...item.inventoryLevels.nodes);
          cursor = item.inventoryLevels.pageInfo.hasNextPage ? item.inventoryLevels.pageInfo.endCursor : null;
        }
        variant.inventoryItem.inventoryLevels.pageInfo.hasNextPage = false;
      }
      result.variants.pageInfo.hasNextPage = false;
    }
    await completeMembership(result);
    attachCategories(result, await collections());
    return result;
  }
  async function completeMembership(product) {
    let after = product.collections?.pageInfo.hasNextPage ? product.collections.pageInfo.endCursor : null;
    while (after) {
      const next = await graphql(`query InventoryMembership($id: ID!, $after: String) { product(id: $id) { collections(first: 100, after: $after) { nodes { id title ${sources} ${categoryFlag} } ${page} } } }`, { id: product.id, after }, 'product');
      product.collections.nodes.push(...next.collections.nodes);
      after = next.collections.pageInfo.hasNextPage ? next.collections.pageInfo.endCursor : null;
    }
    if (product.collections) product.collections.pageInfo.hasNextPage = false;
  }
  async function collections(publicationId = null) {
    const result = [];
    let after = null;
    do {
      const connection = await graphql(`query InventoryCollections($after: String${publicationId ? ', $publicationId: ID!' : ''}) { collections(first: 25, after: $after) { nodes { ${collectionFields} ${publicationId ? 'publishedOnPublication(publicationId: $publicationId)' : ''} } ${page} } }`, { after, ...(publicationId ? { publicationId } : {}) }, 'collections');
      result.push(...connection.nodes);
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (after);
    return result;
  }
  async function onlineStorePublication() {
    let after = null;
    const matches = [];
    do {
      const connection = await graphql(`query InventoryPublications($after: String) { publications(first: 100, after: $after, catalogType: APP) { nodes { id channels(first: 1) { nodes { handle } ${page} } } ${page} } }`, { after }, 'publications');
      for (const publication of connection.nodes) {
        let channels = publication.channels;
        let found = channels?.nodes.some(c => c.handle === 'online_store');
        while (!found && channels?.pageInfo.hasNextPage) {
          const next = await graphql(`query InventoryPublicationChannels($id: ID!, $after: String) { publication(id: $id) { channels(first: 100, after: $after) { nodes { handle } ${page} } } }`, { id: publication.id, after: channels.pageInfo.endCursor }, 'publication');
          channels = next.channels;
          found = channels.nodes.some(c => c.handle === 'online_store');
        }
        if (found) matches.push(publication);
      }
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (after);
    if (matches.length !== 1) throw fail(422, 'ONLINE_STORE_NOT_FOUND', 'No encontramos una única publicación Online Store (Tienda online). Pide a la encargada que revise los canales y permisos.');
    return matches[0].id;
  }
  return {
    locations, product, collections, onlineStorePublication,
    async accessScopes() {
      const installation = await graphql('query InventoryAccessScopes { currentAppInstallation { accessScopes { handle } } }', {}, 'currentAppInstallation');
      const granted = installation.accessScopes.map(s => s.handle);
      return REQUIRED_SCOPES.filter(scope => !granted.includes(scope));
    },
    async collection(id) {
      return graphql(`query InventoryCollection($id: ID!) { collection(id: $id) { ${collectionFields} } }`, { id: gid(id, 'Collection') }, 'collection');
    },
    async isPublished(id, publicationId) {
      const resource = await graphql('query InventoryPublicationState($id: ID!, $publicationId: ID!) { node(id: $id) { ... on Publishable { publishedOnPublication(publicationId: $publicationId) } } }', { id, publicationId }, 'node');
      if (typeof resource?.publishedOnPublication !== 'boolean') throw fail(502, 'SHOPIFY_QUERY_FAILED', 'No pudimos comprobar si se ve en la Tienda online. Actualiza y revisa antes de publicar.');
      return resource.publishedOnPublication;
    },
    async categories() {
      let publicationId;
      try { publicationId = await onlineStorePublication(); }
      catch {
        return {
          ...categoryLists((await collections()).map(c => ({ ...c, publishedOnPublication: null }))),
          publicationAvailable: false,
          warning: 'No pudimos consultar la publicación de la Tienda online. Puedes usar colecciones existentes como categorías, elegir categorías y guardar productos en borrador o editar productos sin activarlos. Crear categorías nuevas y publicar en la tienda está deshabilitado; pide a la encargada que revise los canales y permisos.',
        };
      }
      return { ...categoryLists(await collections(publicationId)), publicationAvailable: true, warning: '' };
    },
    async ensureCategoryDefinitions() {
      const definitions = [];
      let after = null;
      do {
        const connection = await graphql(`query InventoryCategoryDefinitions($after: String) { metafieldDefinitions(first: 100, after: $after, ownerType: COLLECTION, namespace: "dayana") { nodes { id key type { name } access { storefront } } ${page} } }`, { after }, 'metafieldDefinitions');
        definitions.push(...connection.nodes);
        after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      } while (after);
      for (const [key, type] of [['categoria', 'boolean'], ['en_inicio', 'boolean'], ['orden', 'number_integer']]) {
        const existing = definitions.find(d => d.key === key);
        if (existing && existing.type.name !== type) throw fail(409, 'CATEGORY_DEFINITION_CONFLICT', `El campo ds.${key} tiene otro tipo en Shopify. Pide a la encargada que lo revise.`);
        if (!existing) await graphql('mutation InventoryCategoryDefinitionCreate($definition: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $definition) { createdDefinition { id } userErrors { field message code } } }', { definition: { name: `Dayana: ${key}`, namespace: 'dayana', key, type, ownerType: 'COLLECTION', access: { storefront: 'PUBLIC_READ' } } }, 'metafieldDefinitionCreate', true);
        else if (existing.access.storefront !== 'PUBLIC_READ') await graphql('mutation InventoryCategoryDefinitionAccess($definition: MetafieldDefinitionUpdateInput!) { metafieldDefinitionUpdate(definition: $definition) { updatedDefinition { id } userErrors { field message code } } }', { definition: { namespace: 'dayana', key, ownerType: 'COLLECTION', access: { storefront: 'PUBLIC_READ' } } }, 'metafieldDefinitionUpdate', true);
      }
    },
    async createCollection(input) {
      const result = await graphql('mutation InventoryCategoryCreate($collection: CollectionCreateInput!) { collectionCreate(collection: $collection) { collection { id } userErrors { field message } } }', { collection: input }, 'collectionCreate', true);
      if (!result.collection?.id) throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: revisa antes de repetir');
      return result.collection;
    },
    async updateCollection(input) {
      const result = await graphql('mutation InventoryCategoryEdit($input: CollectionUpdateInput!) { collectionUpdate(collection: $input) { collection { id } userErrors { field message } } }', { input }, 'collectionUpdate', true);
      if (!result.collection?.id) throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: revisa antes de repetir');
      return result.collection;
    },
    async publish(id, publicationId) {
      return graphql('mutation InventoryPublish($id: ID!, $input: [PublicationInput!]!, $publicationId: ID!) { publishablePublish(id: $id, input: $input) { publishable { publishedOnPublication(publicationId: $publicationId) } userErrors { field message } } }', { id, input: [{ publicationId }], publicationId }, 'publishablePublish', true).then(result => {
        if (result.publishable?.publishedOnPublication !== true) throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: revisa la publicación en la Tienda online antes de repetir.');
        return result;
      });
    },
    async addProducts(id, productId) {
      return graphql('mutation InventoryCategoryAdd($id: ID!, $productIds: [ID!]!) { collectionAddProducts(id: $id, productIds: $productIds) { collection { id } userErrors { field message } } }', { id, productIds: [productId] }, 'collectionAddProducts', true);
    },
    async tagsAdd(id, tags) {
      const result = await graphql('mutation InventoryCategoryTagAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } } }', { id, tags }, 'tagsAdd', true);
      if (result.node?.id !== id) throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: revisa las etiquetas del producto en Shopify antes de repetir.');
      return result;
    },
    async tagsRemove(id, tags) {
      const result = await graphql('mutation InventoryCategoryTagRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { node { id } userErrors { field message } } }', { id, tags }, 'tagsRemove', true);
      if (result.node?.id !== id) throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: revisa las etiquetas del producto en Shopify antes de repetir.');
      return result;
    },
    async removeProducts(id, productId) {
      const result = await graphql('mutation InventoryCategoryRemove($id: ID!, $productIds: [ID!]!) { collectionRemoveProducts(id: $id, productIds: $productIds) { job { id done } userErrors { field message } } }', { id, productIds: [productId] }, 'collectionRemoveProducts', true);
      let job = result.job;
      for (let attempt = 0; job && !job.done && attempt < 5; attempt++) {
        await sleep(400);
        try { job = await graphql('query InventoryCategoryJob($id: ID!) { job(id: $id) { id done } }', { id: job.id }, 'job'); }
        catch { throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: no pudimos comprobar el cambio de categoría. Revisa antes de repetir.'); }
      }
      if (!job?.done) throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: Shopify sigue cambiando la categoría. Revisa antes de repetir.');
      return result;
    },
    // Pedidos: variants that can be added to an order now (active, tracked, stock > 0).
    async variantsWithStock() {
      const variants = []; let after = null;
      for (let page = 0; page < 8; page++) {
        const result = await graphql('query PedidosVariants($after: String) { productVariants(first: 100, after: $after) { nodes { id title price inventoryQuantity inventoryItem { tracked } product { title status } } pageInfo { hasNextPage endCursor } } }', { after }, 'productVariants');
        for (const v of result.nodes) {
          if (v.product?.status !== 'ACTIVE' || !v.inventoryItem?.tracked || !(v.inventoryQuantity > 0) || !/^\d{1,9}(?:\.\d{1,2})?$/.test(v.price || '')) continue;
          const [whole, fraction = ''] = v.price.split('.');
          variants.push({ id: v.id, productTitle: v.product.title, title: v.title === 'Default Title' ? null : v.title, priceCents: Number(whole) * 100 + Number(fraction.padEnd(2, '0')), available: v.inventoryQuantity });
        }
        if (!result.pageInfo?.hasNextPage) break;
        after = result.pageInfo.endCursor;
      }
      return variants.sort((a, b) => a.productTitle.localeCompare(b.productTitle) || String(a.title).localeCompare(String(b.title)));
    },
    async variantStock(ids) {
      const nodes = await graphql('query PedidosStock($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id inventoryQuantity inventoryItem { tracked } product { status } } } }', { ids }, 'nodes');
      return new Map((nodes || []).filter(v => v?.id).map(v => [v.id, v.product?.status === 'ACTIVE' && v.inventoryItem?.tracked ? v.inventoryQuantity : 0]));
    },
    async search(query = '', after = null) {
      // Literal title matching; never execute caller-supplied Shopify search syntax.
      const result = await graphql(`query InventorySearch($query: String, $after: String) { products(first: 12, after: $after, query: $query, sortKey: TITLE) { nodes { ${productFields(5, 3)} } ${page} } }`, { query: titleSearch(query), after }, 'products');
      for (const product of result.nodes) await completeMembership(product);
      const catalog = await collections();
      for (const product of result.nodes) attachCategories(product, catalog);
      return result;
    },
    async create(input) {
      return (await graphql('mutation InventoryCreate($product: ProductCreateInput!) { productCreate(product: $product) { product { id variants(first: 1) { nodes { id inventoryItem { id } } } } userErrors { field message } } }', { product: { title: input.title, descriptionHtml: input.descriptionHtml, status: 'DRAFT' } }, 'productCreate', true)).product;
    },
    async remove(id) {
      // Permanent: the caller has already checked ARCHIVED status and the typed title.
      const result = await graphql('mutation InventoryDelete($input: ProductDeleteInput!) { productDelete(input: $input, synchronous: true) { deletedProductId userErrors { field message } } }', { input: { id } }, 'productDelete', true);
      if (result.deletedProductId !== id) throw fail(502, 'REVIEW_REQUIRED', 'Shopify no confirmó la eliminación. Revisa el producto desde Shopify.');
      return result;
    },
    async update(input, media = []) {
      return graphql('mutation InventoryEdit($product: ProductUpdateInput!, $media: [CreateMediaInput!]) { productUpdate(product: $product, media: $media) { product { id } userErrors { field message } } }', { product: input, media }, 'productUpdate', true);
    },
    async variant(productId, variantId, price, sku, tracked) {
      const inventoryItem = { ...(sku === undefined ? {} : { sku }), ...(tracked ? { tracked: true } : {}) };
      return graphql('mutation InventoryPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) { productVariants { id } userErrors { field message } } }', { productId, variants: [{ id: variantId, ...(price === undefined ? {} : { price }), ...(Object.keys(inventoryItem).length ? { inventoryItem } : {}) }] }, 'productVariantsBulkUpdate', true);
    },
    async activate(inventoryItemId, locationId, key) {
      return graphql('mutation InventoryActivate($item: ID!, $location: ID!, $key: String!) { inventoryActivate(inventoryItemId: $item, locationId: $location) @idempotent(key: $key) { inventoryLevel { id } userErrors { field message } } }', { item: inventoryItemId, location: locationId, key }, 'inventoryActivate', true);
    },
    async adjust({ inventoryItemId, locationId, expected, delta, key }) {
      return (await graphql(`mutation InventoryProduction($input: InventoryAdjustQuantitiesInput!, $key: String!) { inventoryAdjustQuantities(input: $input) @idempotent(key: $key) { inventoryAdjustmentGroup { ${groupFields} } userErrors { field message code } } }`, { key, input: { name: 'available', reason: 'received', referenceDocumentUri: `gid://dayana-inventario/Production/${key}`, changes: [{ inventoryItemId, locationId, delta, changeFromQuantity: expected }] } }, 'inventoryAdjustQuantities', true)).inventoryAdjustmentGroup;
    },
    async set({ inventoryItemId, locationId, expected, quantity, key }) {
      return (await graphql(`mutation InventoryCorrection($input: InventorySetQuantitiesInput!, $key: String!) { inventorySetQuantities(input: $input) @idempotent(key: $key) { inventoryAdjustmentGroup { ${groupFields} } userErrors { field message code } } }`, { key, input: { name: 'on_hand', reason: 'correction', referenceDocumentUri: `gid://dayana-inventario/Count/${key}`, quantities: [{ inventoryItemId, locationId, quantity, changeFromQuantity: expected }] } }, 'inventorySetQuantities', true)).inventoryAdjustmentGroup;
    },
    async upload(photo, index) {
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[photo.type];
      const bytes = Uint8Array.from(atob(photo.data), c => c.charCodeAt(0));
      const result = await graphql('mutation InventoryPhoto($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }', { input: [{ filename: `producto-${index}.${extension}`, mimeType: photo.type, httpMethod: 'POST', resource: 'IMAGE', fileSize: String(bytes.length) }] }, 'stagedUploadsCreate', true);
      const target = result.stagedTargets?.[0];
      const safe = value => {
        try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && (u.hostname === 'shopify-staged-uploads.storage.googleapis.com' || u.hostname.endsWith('.shopify.com') || u.hostname.endsWith('.shopifycdn.com') || u.hostname === 'storage.googleapis.com' || u.hostname.endsWith('.amazonaws.com')); } catch { return false; }
      };
      if (!target || !safe(target.url) || !safe(target.resourceUrl)) throw fail(502, 'PHOTO_FAILED', 'Shopify no preparó la foto. Inténtalo con otra imagen.');
      const form = new FormData();
      for (const p of target.parameters) form.append(p.name, p.value);
      form.append('file', new Blob([bytes], { type: photo.type }), `producto.${extension}`);
      const response = await request(target.url, { method: 'POST', body: form });
      if (!response.ok) throw fail(502, 'PHOTO_FAILED', 'La foto no terminó de subir. Revisa el producto y agrega la foto otra vez.');
      return { originalSource: target.resourceUrl, mediaContentType: 'IMAGE', alt: 'Foto del producto' };
    },
  };
}
