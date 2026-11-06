import { fail, requireValue, errorResult } from './errors.mjs';
import { operation, fingerprint, escapeHtml, formattedDescription } from './validation.mjs';
import { executeCategory, assertCategory, assignCategory, categoryIds, tagSnapshot, classifyCollection } from './categories.mjs';
export function quantities(level) {
  return Object.fromEntries((level?.quantities || []).map(q => [q.name, q.quantity]));
}
export function createInventoryService({ store, clientFactory, now = () => new Date().toISOString() }) {
  // A single DO per shop + this queue serializes operations across await boundaries.
  // The durable pending receipt fences retries even after process eviction/crash.
  let tail = Promise.resolve();
  return {
    history: () => store.history().map(event => {
      if (event.result === 'pending' && Date.parse(now()) - Date.parse(event.date) > 120_000) {
        event.result = 'uncertain';
        event.error = { code: 'REVIEW_REQUIRED', message: 'Sin confirmar: revisa antes de repetir' };
        for (const step of event.steps || []) if (step.result === 'pending') step.result = 'uncertain';
        store.finish(event.operationId, 'uncertain', { status: 409, body: { ...event.error, state: 'uncertain', operationId: event.operationId } }, event);
      }
      return { ...event, ...(event.action === 'category_adopt' && event.retryInput ? { retryInput: { action: event.action, operationId: event.operationId, resume: true } } : {}), retryable: event.result === 'uncertain' && event.retryable !== false && event.historyRetryable !== false && !!event.retryInput && ['production', 'correction', 'category_adopt'].includes(event.action) && Date.parse(now()) - Date.parse(event.date) < 86_400_000 };
    }),
    execute(input, staff) {
      const run = tail.then(() => execute(input, staff));
      tail = run.catch(() => {});
      return run;
    },
  };
  async function execute(raw, staff) {
    // Adoption recovery from history uses the server's recorded intent; image
    // bytes remain only in the original browser confirmation, never in SQLite.
    const savedAdoption = raw?.action === 'category_adopt' && raw.resume === true ? store.get(raw.operationId) : null;
    const savedEvent = savedAdoption ? store.event(raw.operationId) : null;
    if (raw?.resume === true) requireValue(savedAdoption && savedAdoption.staff_id === staff.staffId && savedEvent?.action === 'category_adopt', 'Esta confirmación pertenece a otra persona o ya no está disponible.');
    const input = operation(savedAdoption ? savedEvent.retryInput : raw);
    const hash = savedAdoption ? savedAdoption.fingerprint : await fingerprint(input);
    const previous = store.get(input.operationId);
    let resumed;
    if (previous) {
      if (previous.fingerprint !== hash || previous.staff_id !== staff.staffId) throw fail(409, 'OPERATION_REUSED', 'Esta confirmación pertenece a otro cambio. Vuelve a abrir el formulario.');
      if (previous.state === 'uncertain' || previous.state === 'pending') {
        const age = Date.parse(now()) - Date.parse(previous.created_at);
        resumed = store.event(input.operationId);
        if (resumed?.retryable === false && previous.response) return JSON.parse(previous.response);
        if ((previous.state === 'pending' && age <= 120_000) || age >= 86_400_000 || !['production', 'correction', 'category_adopt'].includes(input.action)) return { status: 409, body: { code: 'REVIEW_REQUIRED', state: 'uncertain', retryable: false, message: 'Sin confirmar: revisa antes de repetir', operationId: input.operationId, productId: resumed?.productId } };
      } else return JSON.parse(previous.response);
    }
    const event = resumed || { id: crypto.randomUUID(), operationId: input.operationId, staffId: staff.staffId, staffName: staff.staffName, date: now(), action: input.action, productId: input.productId || null, variantId: input.variantId || null, locationId: input.locationId || null, before: null, change: null, after: null, reason: input.reason || null, result: 'pending', error: null, shopifyAdjustmentId: null, steps: [] };
    if (['production', 'correction'].includes(input.action)) event.retryInput = input;
    if (input.action === 'category_adopt' && !resumed) event.retryInput = { ...input, photo: null };
    if (!resumed) store.begin(input.operationId, hash, staff.staffId, event.date, event);
    let result;
    try {
      const client = clientFactory(staff.token, staff.staffId);
      const steps = event.steps;
      const step = async (label, fn) => {
        const entry = { label, result: 'pending' };
        steps.push(entry);
        store.checkpoint(input.operationId, event);
        try { const value = await fn(); entry.result = 'succeeded'; store.checkpoint(input.operationId, event); return value; }
        catch (error) { entry.result = error.code === 'REVIEW_REQUIRED' || !error.status ? 'uncertain' : 'failed'; store.checkpoint(input.operationId, event); throw error; }
      };
      if (!resumed?.mutation && ['production', 'correction', 'create'].includes(input.action)) {
        const locations = await client.locations();
        requireValue(locations.some(l => l.id === input.locationId), 'No encontramos esa tienda. Actualiza la pantalla y elige otra vez.');
      }
      if (input.action.startsWith('category_')) {
        await executeCategory({ input, client, event, step, store, now });
      } else if (input.action === 'create') {
        const collections = await client.collections();
        const category = assertCategory(collections, input.categoryId);
        const publicationId = input.status === 'ACTIVE' ? await client.onlineStorePublication() : null;
        const normalizeTitle = title => (title || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
        const matches = product => ['DRAFT', 'ACTIVE'].includes(product.status) && normalizeTitle(product.title) === normalizeTitle(input.title);
        const recent = store.history().filter(e => e.operationId !== input.operationId && e.action === 'create' && normalizeTitle(e.change?.title) === normalizeTitle(input.title) && Date.parse(now()) - Date.parse(e.date) < 86_400_000);
        const blocked = draft => fail(409, 'RECENT_DRAFT', 'Ya existe un producto reciente o una creación sin confirmar con este nombre. Abre el producto para revisar y completar los pasos en Shopify antes de crear otro.', draft ? { productId: draft.id } : {});
        for (const candidate of recent.filter(e => e.productId)) {
          let draft;
          try { draft = await client.product(candidate.productId); }
          catch (error) { if (error.status === 404 && error.code === 'PRODUCT_NOT_FOUND') continue; throw error; }
          if (draft.status !== 'ARCHIVED') throw blocked(draft);
        }
        // Search through titleSearch via client.search, including drafts unknown
        // to this panel (e.g. productCreate succeeded but its response was lost).
        let after = null;
        do {
          const page = await client.search(input.title, after);
          const draft = page.nodes.find(matches);
          if (draft) throw blocked(draft);
          after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
        } while (after);
        if (recent.some(e => !e.productId && ['uncertain', 'pending'].includes(e.result))) throw blocked();
        event.before = { product: null };
        event.change = { title: input.title, price: input.price, sku: input.sku, status: input.status, categoryId: input.categoryId, ...classifyCollection(category), initialQuantity: input.quantity, photoCount: input.photos.length };
        const product = await step('Crear borrador', () => client.create({ title: input.title, descriptionHtml: `<p>${escapeHtml(input.description).replace(/\n/g, '<br>')}</p>` }));
        event.productId = product.id;
        store.checkpoint(input.operationId, event);
        const variant = product.variants.nodes[0];
        event.variantId = variant.id;
        await step('Guardar precio y código', () => client.variant(product.id, variant.id, input.price, input.sku, true));
        const current = await client.product(product.id);
        const existing = current.variants.nodes[0].inventoryItem.inventoryLevels.nodes.find(l => l.location.id === input.locationId);
        if (!existing) await step('Preparar inventario', () => client.activate(variant.inventoryItem.id, input.locationId, `${input.operationId}:activate`));
        const available = existing ? quantities(existing).available : 0;
        if (input.quantity > 0) {
          const group = await step('Agregar cajas iniciales', () => client.adjust({ inventoryItemId: variant.inventoryItem.id, locationId: input.locationId, expected: available, delta: input.quantity, key: `${input.operationId}:initial` }));
          event.shopifyAdjustmentId = group.id;
        }
        if (input.photos.length) {
          const media = [];
          for (const [i, photo] of input.photos.entries()) media.push(await step(`Subir foto ${i + 1}`, () => client.upload(photo, i)));
          await step('Agregar fotos', () => client.update({ id: product.id }, media));
        }
        event.categoryNotice = await assignCategory(client, await client.product(product.id), input.categoryId, step, collections);
        if (input.status === 'ACTIVE') {
          await step('Poner a la venta', () => client.update({ id: product.id, status: 'ACTIVE' }));
          if (!(await client.isPublished(product.id, publicationId))) await step('Publicar en la Tienda online', () => client.publish(product.id, publicationId));
        }
        event.after = { productId: product.id, status: input.status, categoryId: input.categoryId, price: input.price, sku: input.sku, added: input.quantity };
      } else {
        // Recovery sends the exact recorded mutation first. A product/stock read
        // could now differ or disappear although Shopify already applied it.
        const product = resumed?.mutation ? null : await client.product(input.productId);
        if (input.action === 'delete') {
          // Two-step guard: only archived products, confirmed by typing the exact title.
          const normalize = title => (title || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
          if (product.status !== 'ARCHIVED') throw fail(409, 'NOT_ARCHIVED', 'Solo se pueden eliminar productos archivados. Primero cámbialo a Archivado.');
          requireValue(normalize(input.confirmTitle) === normalize(product.title), 'Escribe el nombre exacto del producto para confirmar.');
          event.before = { title: product.title, status: product.status };
          event.change = { deleted: true };
          await step('Eliminar en Shopify', () => client.remove(product.id));
          event.after = { deleted: true, title: product.title };
        } else if (input.action === 'edit') {
          const variants = product.variants.nodes;
          const current = { title: product.title, descriptionHtml: product.descriptionHtml, status: product.status, ...(variants.length === 1 ? { price: variants[0].price, sku: variants[0].sku ?? '' } : { variants: variants.map(v => ({ id: v.id, price: v.price, sku: v.sku ?? '' })) }) };
          if (input.expectedProduct.categoryIds) current.categoryIds = categoryIds(product);
          if (input.expectedProduct.tags) current.tags = tagSnapshot(product);
          if (JSON.stringify(current) !== JSON.stringify(input.expectedProduct)) throw fail(409, 'PRODUCT_CHANGED', 'El producto cambió en Shopify. Cierra y vuelve a abrirlo para revisar los valores actuales.', { current });
          const collections = input.categoryId ? await client.collections() : [];
          const category = input.categoryId ? assertCategory(collections, input.categoryId) : null;
          if (input.categoryId && (classifyCollection(category).kind === 'tag' || product.categories?.some(c => c.kind === 'tag'))) requireValue(input.expectedProduct.tags, 'Vuelve a abrir el producto para revisar sus etiquetas.');
          const activating = input.status === 'ACTIVE' && product.status !== 'ACTIVE';
          const publicationId = activating ? await client.onlineStorePublication() : null;
          const published = activating ? await client.isPublished(product.id, publicationId) : false;
          requireValue(variants.length === 1 || (input.price === undefined && input.sku === undefined), 'Este producto tiene varias opciones. Cambia sus precios y códigos desde Shopify.');
          requireValue(input.status !== 'ACTIVE' || product.status === 'ACTIVE' || input.confirmActive, 'Confirma que quieres poner este producto a la venta.');
          event.before = { ...current, description: product.description };
          event.change = { title: input.title, ...(input.descriptionChanged && !formattedDescription(product.descriptionHtml) ? { description: input.description } : {}), status: input.status, categoryId: input.categoryId || null, ...(category ? classifyCollection(category) : {}), price: input.price ?? null, sku: input.sku ?? null, photoCount: input.photos.length };
          const media = [];
          for (const [i, photo] of input.photos.entries()) media.push(await step(`Subir foto ${i + 1}`, () => client.upload(photo, i)));
          // ACTIVE is the final step, after all other fields have succeeded.
          const descriptionChanged = input.descriptionChanged && !formattedDescription(product.descriptionHtml);
          const changed = () => fail(409, 'PRODUCT_CHANGED', 'El producto cambió en Shopify. Cierra y vuelve a abrirlo para revisar los valores actuales.');
          // Recheck only fields this step will write. Unrelated concurrent changes
          // remain untouched, including price/SKU when editing a name or photos.
          const checkProduct = async expected => {
            const fresh = await client.product(product.id);
            if (Object.entries(expected).some(([key, value]) => fresh[key] !== value)) throw changed();
            return fresh;
          };
          const metadata = {
            ...(input.title !== product.title ? { title: input.title } : {}),
            ...(descriptionChanged ? { descriptionHtml: `<p>${escapeHtml(input.description).replace(/\n/g, '<br>')}</p>` } : {}),
            ...(input.status !== 'ACTIVE' && input.status !== product.status ? { status: input.status } : {}),
          };
          if (Object.keys(metadata).length || media.length) await step('Guardar nombre, descripción y fotos', async () => {
            await checkProduct(Object.fromEntries(Object.keys(metadata).map(key => [key, product[key]])));
            return client.update({ id: product.id, ...metadata }, media);
          });
          const price = input.price !== variants[0]?.price ? input.price : undefined;
          const sku = input.sku !== (variants[0]?.sku ?? '') ? input.sku : undefined;
          if (variants.length === 1 && (price !== undefined || sku !== undefined)) await step('Guardar precio y código', async () => {
            const fresh = await checkProduct({});
            const variant = fresh.variants.nodes.find(v => v.id === variants[0].id);
            if (!variant || (price !== undefined && variant.price !== variants[0].price) || (sku !== undefined && (variant.sku ?? '') !== (variants[0].sku ?? ''))) throw changed();
            return client.variant(product.id, variants[0].id, price, sku, false);
          });
          if (input.categoryId) event.categoryNotice = await assignCategory(client, product, input.categoryId, step, collections);
          if (activating) await step('Poner a la venta', async () => {
            await checkProduct({ status: product.status });
            return client.update({ id: product.id, status: 'ACTIVE' });
          });
          if (activating && !published) await step('Publicar en la Tienda online', async () => {
            await checkProduct({ status: 'ACTIVE' });
            return client.publish(product.id, publicationId);
          });
          event.after = event.change;
        } else {
          const saved = resumed?.mutation;
          const variant = saved ? { id: input.variantId, inventoryItem: { id: saved.args.inventoryItemId, tracked: true } } : product.variants.nodes.find(v => v.id === input.variantId);
          requireValue(variant?.inventoryItem?.tracked, 'Este producto no tiene conteo de cajas activo. Pide a la encargada que lo active en Shopify.');
          const name = input.action === 'production' ? 'available' : 'on_hand';
          const level = saved ? null : variant.inventoryItem.inventoryLevels.nodes.find(l => l.location.id === input.locationId);
          requireValue(saved || level, 'Este producto no tiene cajas registradas en esa tienda. Revísalo desde Shopify.');
          const state = saved ? { [name]: saved.args.expected } : quantities(level);
          event.before = { [name]: state[name] };
          event.change = input.action === 'production' ? { delta: input.quantity } : { quantity: input.quantity, expected: input.expected };
          if (!resumed && input.action === 'correction' && state[name] !== input.expected) throw fail(409, 'QUANTITY_CHANGED', `Las cajas cambiaron mientras revisabas: ahora hay ${state[name]}. Revisa y confirma otra vez.`, { current: state[name] });
          let group;
          try {
            let plan = resumed?.mutation || { method: input.action === 'production' ? 'adjust' : 'set', attempt: 0, args: { inventoryItemId: variant.inventoryItem.id, locationId: input.locationId, expected: resumed ? input.expected : state[name], ...(input.action === 'production' ? { delta: input.quantity } : { quantity: input.quantity }), key: input.operationId } };
            for (;;) {
              event.mutation = plan;
              event.retryInput = input;
              store.checkpoint(input.operationId, event); // Exact CAS quantity/key survive eviction and lost responses.
              try { group = await step(input.action === 'production' ? 'Sumar producción' : 'Corregir conteo', () => client[plan.method](plan.args)); break; }
              catch (error) {
                if (input.action !== 'production' || error.code !== 'QUANTITY_CHANGED' || plan.attempt >= 2 || Date.parse(now()) - Date.parse(event.date) >= 86_400_000) throw error;
                // Explicit CAS rejection guarantees no adjustment was applied; only then use a new key.
                const fresh = await client.product(input.productId);
                const freshLevel = fresh.variants.nodes.find(v => v.id === variant.id)?.inventoryItem.inventoryLevels.nodes.find(l => l.location.id === input.locationId);
                const expected = quantities(freshLevel).available;
                requireValue(Number.isSafeInteger(expected), 'No pudimos leer las cajas actuales. Vuelve a abrir el producto.');
                plan = { ...plan, attempt: plan.attempt + 1, args: { ...plan.args, expected, key: `${input.operationId}:cas:${plan.attempt + 1}` } };
              }
            }
          } catch (error) {
            if (error.code === 'QUANTITY_CHANGED') {
              try {
                const fresh = await client.product(input.productId);
                const freshLevel = fresh.variants.nodes.find(v => v.id === variant.id)?.inventoryItem.inventoryLevels.nodes.find(l => l.location.id === input.locationId);
                const current = quantities(freshLevel)[name];
                throw fail(409, 'QUANTITY_CHANGED', `Las cajas cambiaron mientras revisabas: ahora hay ${current}. Revisa y confirma otra vez.`, { current });
              } catch (readError) { if (readError.code === 'QUANTITY_CHANGED') throw readError; }
            }
            throw error;
          }
          event.shopifyAdjustmentId = group.id;
          const change = group.changes.find(c => c.name === name);
          event.after = { [name]: change?.quantityAfterChange ?? null };
          if (Number.isSafeInteger(change?.quantityAfterChange) && Number.isSafeInteger(change?.delta)) event.before = { [name]: change.quantityAfterChange - change.delta };
        }
      }
      event.result = 'succeeded';
      event.error = null;
      result = { status: 200, body: { code: 'SAVED', message: (input.action === 'category_adopt' ? `Guardado en Shopify. Colección usada como categoría.${event.after.published === false ? ' No se ve en la tienda.' : event.after.published === null ? ' Publicación sin comprobar.' : ''}` : input.action === 'delete' ? 'Producto eliminado de Shopify.' : 'Guardado en Shopify.') + (event.categoryNotice ? ` ${event.categoryNotice}.` : ''), operationId: input.operationId, productId: event.productId, steps: event.steps, after: event.after } };
    } catch (error) {
      if (error.productId) event.productId = error.productId;
      if (error.retryable === false && !error.keepOriginalRetry) event.retryable = false;
      event.result = error.code === 'REVIEW_REQUIRED' || !error.status ? 'uncertain' : 'failed';
      const safe = errorResult(error);
      event.error = { code: safe.body.code, message: safe.body.message };
      result = { status: safe.status, body: { ...safe.body, state: event.result, retryable: event.result === 'uncertain' && error.retryable !== false && event.retryable !== false && !!event.retryInput, operationId: input.operationId, productId: safe.body.productId || event.productId, steps: event.steps, message: `${event.result === 'uncertain' && !safe.body.message.startsWith('Sin confirmar') ? 'Sin confirmar: revisa antes de repetir. ' : ''}${safe.body.message}${event.steps.some(s => s.result === 'succeeded') ? ` Algunos pasos ya se guardaron; revisa ${input.action.startsWith('category_') ? 'la colección' : 'el producto'} antes de repetir.` : ''}` } };
    }
    store.finish(input.operationId, event.result, result, event);
    return result;
  }
}
