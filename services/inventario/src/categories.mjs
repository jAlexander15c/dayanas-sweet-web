import { fail, requireValue } from './errors.mjs';
import { escapeHtml, formattedDescription } from './validation.mjs';

export const normalizedTitle = value => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
// One classifier for every server decision. Unknown/compound sources stay unusable.
export function classifyCollection(collection) {
  const sources = collection.sources || [];
  const emptySelections = selections => !selections?.nodes?.length && !selections?.pageInfo?.hasNextPage;
  const noExclusions = source => !source.exclusion?.conditions?.length && emptySelections(source.exclusion?.selections);
  if (sources.every(s => s.__typename === 'CollectionConditionsSource' && !s.inclusion?.conditions?.length && !s.exclusion?.conditions?.length)) return { kind: 'manual', tag: null };
  if (sources.length === 1) {
    const source = sources[0], conditions = source.inclusion?.conditions;
    const condition = conditions?.[0];
    if (source.__typename === 'CollectionConditionsSource' && conditions?.length === 1 && noExclusions(source)
      && emptySelections(source.inclusion.selections)
      && condition.__typename === 'CollectionSourceInclusionConditionProductTag' && condition.relation === 'TAGGED_WITH'
      && condition.values?.length === 1 && typeof condition.values[0] === 'string' && condition.values[0].trim()) return { kind: 'tag', tag: condition.values[0] };
  }
  return { kind: 'automatic', tag: null };
}
export const isManual = collection => classifyCollection(collection).kind === 'manual';
export const isCategory = collection => collection.categoria?.value === 'true' && classifyCollection(collection).kind !== 'automatic';
export const hasTag = (product, tag) => (product.tags || []).some(value => value.toLowerCase() === tag.toLowerCase());
export const tagSnapshot = product => [...(product.tags || [])].sort();
export const categoryIds = (product, collections = product.categories || product.collections?.nodes || []) => {
  const members = product.collections?.nodes || [];
  return [...new Set([...collections, ...members].filter(isCategory).filter(c => members.some(m => m.id === c.id) || (classifyCollection(c).kind === 'tag' && hasTag(product, classifyCollection(c).tag))).map(c => c.id))].sort();
};
export const categorySnapshot = collection => ({ id: collection.id, title: collection.title, descriptionHtml: collection.descriptionHtml, image: collection.image ? { url: collection.image.url, altText: collection.image.altText || '' } : null, enInicio: collection.enInicio?.value === 'true', orden: collection.orden?.value || null, updatedAt: collection.updatedAt });
export const sortCategories = collections => collections.filter(isCategory).sort((a, b) => (Number(a.orden?.value) || Number.MAX_SAFE_INTEGER) - (Number(b.orden?.value) || Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title, 'es'));
export const categoryMetafields = (enInicio, orden) => [
  { namespace: 'dayana', key: 'categoria', type: 'boolean', value: 'true' },
  { namespace: 'dayana', key: 'en_inicio', type: 'boolean', value: String(enInicio) },
  { namespace: 'dayana', key: 'orden', type: 'number_integer', value: String(orden) },
];
export function assertCategory(collections, id) {
  const category = collections.find(c => c.id === id && isCategory(c));
  requireValue(category, 'Elige una categoría de la lista actualizada.');
  return category;
}
export async function assignCategory(client, product, categoryId, step, collections) {
  const target = assertCategory(collections, categoryId), destination = classifyCollection(target);
  const ids = categoryIds(product, collections);
  const read = async () => {
    try { return await client.product(product.id); }
    catch { throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: no pudimos comprobar la categoría guardada. Revisa el producto en Shopify antes de repetir.'); }
  };
  let current = await read();
  if (JSON.stringify(tagSnapshot(current)) !== JSON.stringify(tagSnapshot(product)) || JSON.stringify(categoryIds(current, collections)) !== JSON.stringify(ids)) throw fail(409, 'PRODUCT_CHANGED', 'Las etiquetas o categorías cambiaron en Shopify. Vuelve a abrir el producto antes de guardar.');
  // A lost response is resolved only by a fresh read of the requested tag state.
  const mutateTag = async (tag, add) => {
    await step(add ? `Agregar etiqueta «${tag}»` : `Quitar etiqueta «${tag}»`, async () => {
      try { await client[add ? 'tagsAdd' : 'tagsRemove'](product.id, [tag]); }
      catch (error) {
        if (error.code !== 'REVIEW_REQUIRED' && error.status) throw error;
        current = await read();
        if (hasTag(current, tag) !== add) throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: revisa las etiquetas del producto en Shopify antes de repetir.');
        return;
      }
      current = await read();
      if (hasTag(current, tag) !== add) throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: revisa las etiquetas del producto en Shopify antes de repetir.');
    });
  };
  if (destination.kind === 'tag') {
    if (!hasTag(current, destination.tag)) await mutateTag(destination.tag, true);
  } else if (!ids.includes(categoryId)) await step('Asignar categoría', () => client.addProducts(categoryId, product.id));
  const removedTags = new Set();
  for (const id of ids.filter(id => id !== categoryId)) {
    const previous = collections.find(c => c.id === id) || product.collections.nodes.find(c => c.id === id);
    const source = classifyCollection(previous);
    if (source.kind === 'tag') {
      // The chosen destination may use the very same tag under another title/case.
      if (destination.kind === 'tag' && destination.tag.toLowerCase() === source.tag.toLowerCase()) continue;
      // Remove the tag exactly as stored on the product (e.g. "Galletas"), not as written in the rule.
      if (hasTag(current, source.tag)) await mutateTag((current.tags || []).find(t => t.toLowerCase() === source.tag.toLowerCase()) || source.tag, false);
      removedTags.add(source.tag.toLowerCase());
    } else await step('Quitar categoría anterior', () => client.removeProducts(id, product.id));
  }
  let fresh;
  try { fresh = await client.product(product.id); }
  catch { throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: no pudimos comprobar la categoría guardada. Revisa el producto en Shopify antes de repetir.'); }
  // Shopify updates automatic membership asynchronously: tags are authoritative here.
  const manualIds = (fresh.collections?.nodes || []).filter(c => isCategory(c) && isManual(c)).map(c => c.id).sort();
  const unexpectedTag = collections.filter(isCategory).some(c => {
    const source = classifyCollection(c);
    return source.kind === 'tag' && hasTag(fresh, source.tag) && (destination.kind !== 'tag' || source.tag.toLowerCase() !== destination.tag.toLowerCase());
  });
  if ((destination.kind === 'tag' ? !hasTag(fresh, destination.tag) || manualIds.length > 0 : JSON.stringify(manualIds) !== JSON.stringify([categoryId]))
    || unexpectedTag || [...removedTags].some(tag => hasTag(fresh, tag))) throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: revisa la categoría del producto en Shopify antes de repetir.');
  return destination.kind === 'tag' || removedTags.size ? 'Puede tardar unos segundos en aparecer en la categoría' : '';
}
export async function executeCategory({ input, client, event, step, store, now }) {
  if (input.action === 'category_adopt') return adoptCategory({ input, client, event, step, store });
  const collections = await client.collections();
  const categories = sortCategories(collections);
  if (input.action === 'category_publish') {
    const category = assertCategory(collections, input.categoryId);
    const publicationId = await client.onlineStorePublication();
    const published = await client.isPublished(category.id, publicationId);
    event.categoryId = category.id;
    event.before = { title: category.title, published };
    event.change = { title: category.title, published: true };
    if (!published) await step('Publicar categoría en la Tienda online', () => client.publish(category.id, publicationId));
    event.after = { categoryId: category.id, title: category.title, published: true };
    return;
  }
  if (input.action === 'category_order') {
    const current = categories.map(categorySnapshot);
    if (JSON.stringify(current) !== JSON.stringify(input.expectedCategories)) throw fail(409, 'CATEGORY_CHANGED', 'Las categorías cambiaron. Actualiza la lista y revisa el orden otra vez.');
    const index = categories.findIndex(c => c.id === input.categoryId);
    const target = index + input.direction;
    requireValue(index >= 0 && target >= 0 && target < categories.length, 'Esta categoría ya está al principio o al final.');
    [categories[index], categories[target]] = [categories[target], categories[index]];
    event.before = current;
    event.change = categories.map((c, i) => ({ id: c.id, title: c.title, orden: i + 1 }));
    await step('Preparar campos de categorías', () => client.ensureCategoryDefinitions());
    for (const [i, category] of categories.entries()) {
      if (category.orden?.value !== String(i + 1)) await step(`Ordenar ${category.title}`, () => client.updateCollection({ id: category.id, metafields: [{ namespace: 'dayana', key: 'orden', type: 'number_integer', value: String(i + 1) }] }));
    }
    event.after = event.change;
    return;
  }
  const existing = input.action === 'category_edit' ? assertCategory(collections, input.categoryId) : null;
  if (existing && JSON.stringify(categorySnapshot(existing)) !== JSON.stringify(input.expectedCategory)) throw fail(409, 'CATEGORY_CHANGED', 'La categoría cambió en Shopify. Cierra y vuelve a abrirla para revisar los valores actuales.');
  const duplicate = collections.find(c => c.id !== existing?.id && normalizedTitle(c.title) === normalizedTitle(input.title));
  const blocked = () => fail(409, 'CATEGORY_EXISTS', 'Ya existe una colección con ese nombre o una creación sin confirmar. Revísala en Shopify antes de crear otra.');
  if (duplicate) throw blocked();
  if (!existing) {
    const recent = store.history().filter(e => e.operationId !== input.operationId && e.action === 'category_create' && normalizedTitle(e.change?.title || '') === normalizedTitle(input.title) && Date.parse(now()) - Date.parse(e.date) < 86_400_000 && (e.categoryId || ['pending', 'uncertain', 'succeeded'].includes(e.result)));
    for (const candidate of recent) {
      if (candidate.categoryId) {
        const fresh = await client.collection(candidate.categoryId);
        if (fresh && normalizedTitle(fresh.title) === normalizedTitle(input.title)) throw blocked();
      } else {
        // A complete fresh listing confirms absence when the create response had no ID.
        const fresh = await client.collections();
        if (fresh.some(c => normalizedTitle(c.title) === normalizedTitle(input.title))) throw blocked();
      }
    }
  }
  const orden = input.orden ?? Math.max(0, ...categories.map(c => Number(c.orden?.value) || 0)) + 1;
  requireValue(Number.isSafeInteger(orden) && orden >= 1 && orden <= 1_000_000, 'Escribe un orden entero entre 1 y 1000000.');
  event.before = existing ? categorySnapshot(existing) : null;
  event.change = { title: input.title, ...(existing && formattedDescription(existing.descriptionHtml) ? {} : { description: input.description }), enInicio: input.enInicio, orden, altText: input.altText, newPhoto: !!input.photo };
  const publicationId = existing ? null : await client.onlineStorePublication(); // Creation publishes; editing preserves publication state.
  await step('Preparar campos de categorías', () => client.ensureCategoryDefinitions());
  let source = existing?.image?.url;
  if (input.photo) source = (await step('Subir foto de categoría', () => client.upload(input.photo, 0))).originalSource;
  requireValue(source && (input.photo || existing.image.id), 'Agrega una foto para esta categoría.');
  const descriptionHtml = input.description ? `<p>${escapeHtml(input.description).replace(/\n/g, '<br>')}</p>` : '';
  const data = { title: input.title, ...(existing && formattedDescription(existing.descriptionHtml) ? {} : { descriptionHtml }), image: { ...(input.photo ? { src: source } : { id: existing.image.id }), altText: input.altText }, metafields: categoryMetafields(input.enInicio, orden) };
  const category = await step(existing ? 'Guardar categoría' : 'Crear categoría manual', () => existing ? client.updateCollection({ id: existing.id, ...data }) : client.createCollection(data));
  event.categoryId = category.id;
  store.checkpoint(input.operationId, event);
  if (!existing && !(await client.isPublished(category.id, publicationId))) await step('Publicar categoría en la Tienda online', () => client.publish(category.id, publicationId));
  event.after = { ...event.change, categoryId: category.id, ...(!existing ? { published: true } : {}) };
}

async function adoptCategory({ input, client, event, step, store }) {
  const changed = () => fail(409, 'CATEGORY_CHANGED', 'La colección cambió, revisa y confirma otra vez');
  const read = async () => {
    try { return await client.collection(input.categoryId); }
    catch (error) {
      if (event.adoption?.updateAttempted) throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: no pudimos releer la colección. Reintenta esta misma operación.');
      throw error;
    }
  };
  const matches = c => c && isCategory(c) && c.enInicio?.value === String(event.adoption.enInicio)
    && (event.change.kind ? classifyCollection(c).kind === event.change.kind && classifyCollection(c).tag === event.change.tag : isManual(c))
    && c.orden?.value === String(event.adoption.orden)
    && (event.adoption.newPhoto
      ? c.image && c.image.altText === input.altText && (c.image.id !== event.adoption.imageId || c.image.url !== input.expectedCategory.image?.url)
      : input.expectedCategory.image ? c.image?.id === event.adoption.imageId && c.image?.altText === input.altText : !c.image);
  let collection = await read();
  const recovered = event.adoption?.updateAttempted && matches(collection);
  // A previous attempt may have applied before someone edited it: never report that as a clean failure.
  if (!recovered && event.adoption?.updateAttempted && collection?.categoria?.value === 'true') throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: la colección ya es categoría pero con otros valores. Revísala en Categorías antes de repetir.');
  if (!recovered &&(!collection || classifyCollection(collection).kind === 'automatic' || collection.categoria?.value === 'true' || collection.updatedAt !== input.expectedCategory.updatedAt)) throw changed();
  requireValue(!collection.image || input.altText.trim(), 'Escribe el texto alternativo de la foto.');
  let publicationId = null, published = null;
  try {
    publicationId = await client.onlineStorePublication();
    published = await client.isPublished(collection.id, publicationId);
  } catch (error) {
    // Publication discovery is optional for adoption, unless explicitly requested.
    if (input.publish) {
      if (event.adoption?.updateAttempted) throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: no pudimos comprobar la publicación. Reintenta esta misma operación.');
      throw error;
    }
  }
  if (!event.adoption) {
    const categories = sortCategories(await client.collections());
    const orden = input.orden ?? Math.max(0, ...categories.map(c => Number(c.orden?.value) || 0)) + 1;
    requireValue(Number.isSafeInteger(orden) && orden >= 1 && orden <= 1_000_000, 'Escribe un orden entero entre 1 y 1000000.');
    event.categoryId = collection.id;
    event.before = { ...categorySnapshot(collection), published };
    event.adoption = { enInicio: input.enInicio, orden, newPhoto: !!input.photo, imageId: collection.image?.id || null, updateAttempted: false };
    event.change = { title: collection.title, ...classifyCollection(collection), enInicio: input.enInicio, orden, altText: input.altText, newPhoto: !!input.photo, publish: input.publish };
    store.checkpoint(input.operationId, event);
  }
  if (!recovered) {
    // History recovery never persists image bytes. The original open confirmation
    // can still retry with its photo; a read can resolve an already applied update.
    if (event.adoption.newPhoto && !input.photo) {
      event.historyRetryable = false;
      throw fail(502, 'REVIEW_REQUIRED', 'Sin confirmar: revisa la colección y reintenta desde la confirmación original con su foto.', { retryable: false, keepOriginalRetry: true });
    }
    await step('Preparar campos de categorías', () => client.ensureCategoryDefinitions());
    const image = input.photo ? { src: (await step('Subir foto de categoría', () => client.upload(input.photo, 0))).originalSource, altText: input.altText }
      : collection.image && collection.image.altText !== input.altText ? { id: collection.image.id, altText: input.altText } : null;
    // Read immediately before collectionUpdate, after definitions/photo awaits.
    collection = await read();
    if (!collection || classifyCollection(collection).kind === 'automatic' || collection.categoria?.value === 'true' || collection.updatedAt !== input.expectedCategory.updatedAt) throw changed();
    event.adoption.updateAttempted = true;
    store.checkpoint(input.operationId, event);
    await step('Usar colección como categoría', () => client.updateCollection({ id: collection.id, metafields: categoryMetafields(event.adoption.enInicio, event.adoption.orden), ...(image ? { image } : {}) }));
  } else {
    await step('Comprobar categoría ya guardada en Shopify', async () => true);
  }
  if (input.publish && !published) {
    await step('Publicar categoría en la Tienda online', () => client.publish(collection.id, publicationId));
    published = true;
  }
  event.after = { ...event.change, categoryId: collection.id, published };
}
