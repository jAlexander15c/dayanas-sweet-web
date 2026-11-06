const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const statusText = { DRAFT: 'Borrador', ACTIVE: 'A la venta', ARCHIVED: 'Archivado', UNLISTED: 'Solo con enlace' };
const actionText = { create: 'Nuevo producto', edit: 'Editar producto', production: 'Agregar producción', correction: 'Corregir existencias', delete: 'Eliminar producto' };
Object.assign(actionText, { category_create: 'Nueva categoría', category_edit: 'Editar categoría', category_order: 'Ordenar categorías', category_publish: 'Publicar categoría', category_adopt: 'Usar colección como categoría' });
const productCategories = product => product?.categories || (product?.collections?.nodes || []).filter(c => c.categoria?.value === 'true' && (c.kind === 'manual' || c.kind === 'tag' || (!c.kind && !c.sources?.length)));
const tagNotice = category => category?.kind === 'tag' ? `<p>Los productos entran a esta categoría con la etiqueta «${esc(category.tag)}»</p><p>Puede tardar unos segundos en aparecer en la categoría</p>` : '';
function categoryChangeNotice(product, category) {
  if (!category) return '';
  const removed = new Set(productCategories(product).filter(c => c.kind === 'tag' && c.id !== category.id && !(category.kind === 'tag' && c.tag.toLowerCase() === category.tag.toLowerCase())).map(c => c.tag));
  return tagNotice(category) + [...removed].map(tag => `<p>Se quitará la etiqueta «${esc(tag)}» de este producto.</p>`).join('');
}
function openConfirmation() {
  $('#confirmation').showModal();
  // Longer tag summaries must open at their heading, before the save button.
  $('#confirm-title').tabIndex = -1;
  $('#confirm-title').focus?.({ preventScroll: true });
  $('#confirmation').scrollTop = 0;
}
const categorySnapshot = c => ({ id: c.id, title: c.title, descriptionHtml: c.descriptionHtml, image: c.image ? { url: c.image.url, altText: c.image.altText || '' } : null, enInicio: c.enInicio?.value === 'true', orden: c.orden?.value || null, updatedAt: c.updatedAt });
const stepText = step => step.result === 'succeeded' ? 'guardado' : step.result === 'uncertain' ? 'sin confirmar' : 'falló';
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
const formattedDescription = html => /<(?!\/?p\s*>|br\s*\/?\s*>)[^>]*>/i.test(html || '');
function descriptionText(product) {
  if (!product || formattedDescription(product.descriptionHtml)) return product?.description || '';
  const node = document.createElement('div');
  node.innerHTML = (product.descriptionHtml || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n\n');
  return node.textContent;
}
const expectedProduct = product => ({ title: product.title, descriptionHtml: product.descriptionHtml, status: product.status, ...(product.variants.nodes.length === 1 ? { price: product.variants.nodes[0].price, sku: product.variants.nodes[0].sku ?? '' } : { variants: product.variants.nodes.map(v => ({ id: v.id, price: v.price, sku: v.sku ?? '' })) }), categoryIds: productCategories(product).map(c => c.id).sort(), tags: [...(product.tags || [])].sort() });
function readable(value) {
  const labels = { deleted: 'eliminado', available: 'cajas disponibles', on_hand: 'cajas físicas', title: 'nombre', description: 'descripción', price: 'precio', sku: 'código', status: 'estado', initialQuantity: 'cajas iniciales', photoCount: 'fotos nuevas', delta: 'cajas sumadas', quantity: 'cajas contadas', expected: 'conteo revisado', added: 'cajas agregadas', productId: 'producto', product: 'producto' };
  if (Array.isArray(value)) return value.map(readable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [labels[key] || key, key === 'price' && item != null ? money(item) : readable(item)]));
  return typeof value === 'string' ? statusText[value] || value : value;
}
let locations = [], products = [], cursor = null, context = null, pending = null, sending = false;
let searchGeneration = 0, historyEvents = [], activeStaffId;
let pendingSubmitted = false;
let unconfirmed = false; // R04: hubo envío pero no respuesta; solo se puede consultar el mismo intento.
let categoryWarning = '', publicationAvailable = true;
let categories = [], editingCategory = null, categoryFromProduct = false;
let storeCollections = [], collectionPage = 0, adoptingCategory = false;
function feedback(message, error = false) { $('#feedback').textContent = message; $('#feedback').classList.toggle('error', error); }
async function api(path, body) {
  if (window.inventarioPortal?.mode) return window.inventarioAccess.inventory(path, body);
  if (!window.shopify?.idToken) throw new Error('Abre Dayana Inventario desde Shopify para entrar con tu cuenta.');
  const token = await window.shopify.idToken();
  // R04: mismo plazo que el portal, para cabeceras y cuerpo; un corte se trata como resultado sin confirmar.
  let response, result;
  try {
    response = await fetch(path, { signal: globalThis.AbortSignal?.timeout?.(30000), method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    result = await response.json();
  } catch (error) { if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw Object.assign(new Error('La conexión tardó demasiado. Revisa tu internet e inténtalo otra vez.'), { code: 'TIMEOUT' }); throw error; }
  if (!response.ok) throw Object.assign(new Error(result.message || 'No pudimos cargar los datos. Actualiza la pantalla.'), { status: response.status, result });
  return result;
}
function q(level) { return Object.fromEntries((level.quantities || []).map(v => [v.name, v.quantity])); }
function image(url, title) {
  let safe = false;
  try { const u = new URL(url); safe = u.protocol === 'https:' && (u.hostname === 'cdn.shopify.com' || u.hostname.endsWith('.shopifycdn.com')); } catch { /* Placeholder. */ }
  return safe ? `<img class="photo" src="${esc(url)}" alt="${esc(title)}" loading="lazy">` : '<span class="photo placeholder" aria-hidden="true">Sin foto</span>';
}
function renderProducts() {
  $('#products').innerHTML = products.length ? products.map((p, pi) => {
    const vs = p.variants.nodes;
    const more = p.variants.pageInfo.hasNextPage || vs.some(v => v.inventoryItem.inventoryLevels.pageInfo.hasNextPage);
    return `<article class="card"><div class="product-head">${image(p.featuredImage?.url, p.title)}<div><h2>${esc(p.title)}</h2><span class="badge">${esc(statusText[p.status] || p.status)}</span>${vs.length === 1 ? `<p>${esc(money(vs[0].price))}</p>` : ''}</div></div><p class="category-name">${esc(productCategories(p).map(c => c.title).join(", ") || "Sin categoría")}</p>${vs.map((v, vi) => `${vs.length > 1 ? `<h3>${esc(v.title)}</h3><p class="muted">Precio: ${esc(money(v.price))} · Código: ${esc(v.sku || 'Sin código')}</p>` : ''}${!v.inventoryItem.tracked ? '<p>El conteo de cajas está desactivado. Actívalo desde Shopify.</p>' : v.inventoryItem.inventoryLevels.nodes.length ? v.inventoryItem.inventoryLevels.nodes.map((l, li) => {
      const state = q(l);
      return `<section class="stock" aria-label="Cajas de ${esc(p.title)}">${locations.length > 1 ? `<p>${esc(l.location.name)}</p>` : ''}<div><span class="stock-number">${esc(state.available)}</span> cajas disponibles</div><small>${esc(state.committed)} apartadas para pedidos</small><div class="actions"><button class="primary" data-action="production" data-p="${pi}" data-v="${vi}" data-l="${li}">Agregar producción</button><button data-action="correction" data-p="${pi}" data-v="${vi}" data-l="${li}">Corregir existencias</button></div></section>`;
    }).join('') : '<p>Este producto aún no tiene cajas registradas en la tienda. Revísalo en Shopify.</p>'}`).join('')}${more ? '<p class="muted">Este producto tiene más opciones o tiendas. Abre el detalle para verlas todas.</p><button data-action="details" data-p="'+pi+'">Ver todas las opciones</button>' : ''}<button class="edit" data-action="edit" data-p="${pi}">Editar producto</button>${p.status === 'ARCHIVED' ? `<button class="edit danger" data-action="delete" data-p="${pi}">Eliminar producto</button>` : ''}</article>`;
  }).join('') : '<div class="card empty"><h2>No encontramos ese producto</h2><p>Prueba con otra palabra o agrega un producto nuevo.</p></div>';
  $('#more').hidden = !cursor;
}
async function search(append = false) {
  const generation = ++searchGeneration;
  feedback('Buscando en Shopify…');
  const result = await api(`/api/products?q=${encodeURIComponent($('#search').value)}${$('#uncategorized').checked ? '&uncategorized=true' : ''}${append && cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
  if (generation !== searchGeneration) return;
  products = append ? [...products, ...result.nodes] : result.nodes;
  cursor = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null;
  renderProducts();
  feedback('Cajas consultadas en Shopify. Abre una acción para revisar el conteo más reciente.');
}
const field = (label, name, value = '', extra = '') => `<label>${label}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
function locationField() {
  return locations.length > 1 ? `<label for="product-location">¿En qué tienda?</label><select id="product-location" name="locationId">${locations.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select>` : '';
}
function categoryField(product) {
  const selected = productCategories(product)[0]?.id || '';
  return `${categoryWarning ? `<p class="error" role="alert">${esc(categoryWarning)}</p>` : ''}<label for="product-category">Categoría</label><select id="product-category" name="categoryId" ${product ? '' : 'required'}><option value="">${product ? 'No cambiar categoría' : 'Elige una categoría'}</option>${categories.map(c => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select><button type="button" id="inline-category" ${publicationAvailable ? '' : 'disabled'}>Crear categoría nueva</button>${productCategories(product).length > 1 ? '<p class="error">Este producto tiene varias categorías. Elige una para dejarlo organizado.</p>' : ''}`;
}
function openEditor(action, product = null, variant = null, level = null) {
  context = { action, product, variant, level };
  pending = null;
  $('#editor-title').textContent = actionText[action];
  $('#editor-error').textContent = '';
  $('#review').disabled = false;
  let html;
  if (action === 'delete') {
    html = `<h3>${esc(product.title)}</h3><p class="error" role="alert">Esto borra el producto de Shopify para siempre: fotos, descripción, precio y conteo de cajas. No se puede deshacer. Los pedidos anteriores no se borran.</p>${field('Escribe el nombre del producto para confirmar', 'confirmTitle', '', 'required maxlength="255" autocomplete="off" spellcheck="false"')}<p class="muted">Nombre: ${esc(product.title)}</p>`;
  } else if (action === 'production' || action === 'correction') {
    const state = q(level);
    html = `<h3>${esc(product.title)}</h3>${product.variants.nodes.length > 1 ? `<p>${esc(variant.title)}</p>` : ''}${locations.length > 1 ? `<p>${esc(level.location.name)}</p>` : ''}<p>Ahora: <strong>${esc(state.available)} cajas disponibles</strong> y ${esc(state.committed)} apartadas para pedidos.</p>`;
    html += action === 'production' ? field('¿Cuántas cajas preparaste?', 'quantity', '', 'type="number" min="1" max="1000000" step="1" inputmode="numeric" required') : `<p>Cuenta <strong>todas las cajas que tienes físicamente</strong>, incluidas las apartadas para pedidos que todavía no se han enviado. El total registrado es ${esc(state.on_hand)}.</p>${field('¿Cuántas cajas contaste en total?', 'quantity', '', 'type="number" min="0" max="1000000" step="1" inputmode="numeric" required')}<label>¿Por qué corriges el conteo?<textarea name="reason" required maxlength="500" placeholder="Por ejemplo: una caja se dañó"></textarea></label>`;
  } else {
    const single = !product || product.variants.nodes.length === 1;
    const formatted = product && formattedDescription(product.descriptionHtml);
    html = `${field('Nombre', 'title', product?.title, `required maxlength="${Math.max(200, product?.title?.length || 0)}"`)}${categoryField(product)}<label for="product-description">Descripción</label><textarea id="product-description" name="description" maxlength="5000" ${formatted ? 'readonly' : ''}>${esc(descriptionText(product))}</textarea>${formatted ? '<p>Esta descripción tiene formato; edítala en Shopify</p>' : ''}`;
    if (single) html += `<div class="actions">${field('Precio', 'price', product ? Number(product.variants.nodes[0].price).toFixed(2) : '', 'required type="number" min="0" max="9999999.99" step="0.01" inputmode="decimal"')}${field('Código del producto (opcional)', 'sku', product?.variants.nodes[0].sku || '', 'maxlength="100"')}</div>`;
    else html += `<p>Este producto tiene varias opciones. Sus precios y códigos se cambian desde Shopify para evitar confusiones.</p>${product.variants.nodes.map(v => `<p>${esc(v.title)}: ${esc(money(v.price))} · ${esc(v.sku || 'Sin código')}</p>`).join('')}`;
    html += '<label>Agregar fotos (hasta 3)<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple></label><p class="muted">Puedes usar la cámara del celular. JPG, PNG o WebP; hasta 5 MB por foto.</p>';
    if (!product) html += `${locationField()}${field('Cajas para empezar', 'quantity', '0', 'required type="number" min="0" max="1000000" step="1" inputmode="numeric"')}<label for="product-status">Estado</label><select id="product-status" name="status"><option value="DRAFT">Borrador</option><option value="ACTIVE" ${publicationAvailable ? '' : 'disabled'}>A la venta</option></select><label id="active-check" hidden><input type="checkbox" name="confirmActive">Confirmo que quiero poner este producto a la venta.</label>`;
    else html += `<label for="product-status">Estado</label><select id="product-status" name="status">${['DRAFT','ACTIVE','ARCHIVED',...(product.status === 'UNLISTED' ? ['UNLISTED'] : [])].map(s => `<option value="${s}" ${s === product.status ? 'selected' : ''} ${s === 'ACTIVE' && product.status !== 'ACTIVE' && !publicationAvailable ? 'disabled' : ''}>${statusText[s]}</option>`).join('')}</select><label id="active-check" hidden><input type="checkbox" name="confirmActive">Confirmo que quiero poner este producto a la venta.</label>`;
  }
  $('#editor-fields').innerHTML = html;
  const stateInput = $('#editor-fields select[name="status"]');
  if (stateInput) stateInput.addEventListener('change', () => { $('#active-check').hidden = stateInput.value !== 'ACTIVE' || product?.status === 'ACTIVE'; });
  if ($('#inline-category')) $('#inline-category').onclick = guard(async () => { await loadCategories(); openCategory(null, true); });
  $('#editor').showModal();
}
async function openAction(button) {
  const action = button.dataset.action;
  const original = products[Number(button.dataset.p)];
  button.disabled = true;
  try {
    const { product } = await api(`/api/product?id=${encodeURIComponent(original.id)}`);
    if (action === 'details') {
      products[Number(button.dataset.p)] = product;
      renderProducts();
      feedback('Ya puedes ver todas las opciones de este producto.');
      return;
    }
    if (action === 'edit') { await loadCategories(); return openEditor(action, product); }
    if (action === 'delete') {
      if (product.status !== 'ARCHIVED') throw new Error('Solo se pueden eliminar productos archivados. Primero cámbialo a Archivado.');
      return openEditor(action, product);
    }
    const oldVariant = original.variants.nodes[Number(button.dataset.v)];
    const oldLevel = oldVariant.inventoryItem.inventoryLevels.nodes[Number(button.dataset.l)];
    const variant = product.variants.nodes.find(v => v.id === oldVariant.id);
    const level = variant?.inventoryItem.inventoryLevels.nodes.find(l => l.location.id === oldLevel.location.id);
    if (!level) throw new Error('Las opciones del producto cambiaron. Actualiza la búsqueda y vuelve a abrirlo.');
    openEditor(action, product, variant, level);
  } finally { button.disabled = false; }
}
async function photoData(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5_000_000) throw new Error('Usa fotos JPG, PNG o WebP de hasta 5 MB.');
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ type: file.type, data: String(reader.result).split(',')[1] }); reader.onerror = () => reject(new Error('No pudimos leer esa foto. Elígela otra vez.')); reader.readAsDataURL(file); });
}
function line(label, before, after) { return `<p class="summary-line"><strong>${esc(label)}</strong><br>${esc(before)} → ${esc(after)}</p>`; }
async function review(event) {
  event.preventDefault();
  const form = $('#editor-form');
  if (!form.reportValidity()) return;
  $('#review').disabled = true;
  try {
    const data = new FormData(form);
    const { action, product, variant, level } = context;
    const payload = { action, ...(product ? { productId: product.id } : {}) };
    let summary = product ? `<h3>${esc(product.title)}</h3>` : '';
    if (action === 'delete') {
      const normalizeTitle = title => (title || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
      payload.confirmTitle = String(data.get('confirmTitle') || '');
      if (normalizeTitle(payload.confirmTitle) !== normalizeTitle(product.title)) throw new Error('El nombre no coincide. Escríbelo igual que aparece para confirmar.');
      summary += '<p class="big-summary">Se eliminará para siempre</p><p>El producto desaparece de Shopify y de este panel. No se puede deshacer.</p>';
    } else if (['production','correction'].includes(action)) {
      let state = q(level);
      if (action === 'production') {
        const { product: fresh } = await api(`/api/product?id=${encodeURIComponent(product.id)}`);
        const freshLevel = fresh.variants.nodes.find(v => v.id === variant.id)?.inventoryItem.inventoryLevels.nodes.find(l => l.location.id === level.location.id);
        if (!freshLevel) throw new Error('Las opciones del producto cambiaron. Vuelve a abrirlo.');
        state = q(freshLevel);
      }
      const expected = state[action === 'production' ? 'available' : 'on_hand'];
      Object.assign(payload, { variantId: variant.id, locationId: level.location.id, expected, quantity: Number(data.get('quantity')), reason: action === 'production' ? 'Producción preparada' : data.get('reason') });
      summary += `${product.variants.nodes.length > 1 ? `<p>${esc(variant.title)}</p>` : ''}${locations.length > 1 ? `<p>${esc(level.location.name)}</p>` : ''}<p class="big-summary">${action === 'production' ? `Vas a sumar ${payload.quantity} cajas: ${expected} → ${expected + payload.quantity}` : `Vas a corregir las cajas físicas: ${expected} → ${payload.quantity}`}</p>`;
      if (action === 'correction') summary += `<p>Disponibles quedarán en ${payload.quantity - (state.on_hand - state.available)}</p>${payload.quantity < state.committed ? '<p class="error">El conteo es menor que las apartadas para pedidos. Revisa los pedidos antes de confirmar.</p>' : ''}<p>Este total incluye las cajas apartadas para pedidos sin enviar.</p><p>Motivo: ${esc(payload.reason)}</p>`;
    } else {
      Object.assign(payload, { title: data.get('title'), description: data.get('description'), status: data.get('status') });
      if (product) Object.assign(payload, { expectedProduct: expectedProduct(product), descriptionChanged: !formattedDescription(product.descriptionHtml) && payload.description !== descriptionText(product) });
      if (data.get('categoryId')) {
        payload.categoryId = data.get('categoryId');
        if (product) payload.expectedProduct.categoryIds = productCategories(product).map(c => c.id).sort();
      }
      summary += line('Categoría', productCategories(product).map(c => c.title).join(', ') || 'Sin categoría', categories.find(c => c.id === payload.categoryId)?.title || 'Sin cambiar');
      summary += categoryChangeNotice(product, categories.find(c => c.id === payload.categoryId));
      if (!product) {
        const { events } = await api('/api/history');
        const normalizeTitle = title => (title || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
        const matches = draft => ['DRAFT', 'ACTIVE'].includes(draft.status) && normalizeTitle(draft.title) === normalizeTitle(payload.title);
        const recent = events.filter(e => e.action === 'create' && normalizeTitle(e.change?.title) === normalizeTitle(payload.title) && Date.now() - Date.parse(e.date) < 86_400_000);
        const block = draft => {
          $('#editor-error').textContent = 'Ya existe un producto reciente o una creación sin confirmar con este nombre. Abre el producto para revisar y completar los pasos en Shopify antes de crear otro.';
          if (draft) draftButton($('#editor-error'), draft.id);
        };
        for (const candidate of recent.filter(e => e.productId)) {
          let draft;
          try { ({ product: draft } = await api(`/api/product?id=${encodeURIComponent(candidate.productId)}`)); }
          catch (error) { if (error.status === 404 && error.result?.code === 'PRODUCT_NOT_FOUND') continue; throw error; }
          if (draft.status !== 'ARCHIVED') {
            block(draft);
            return;
          }
        }
        let after = null;
        do {
          // The search endpoint accepts 100 characters; product titles accept 200.
          // Prefix-search the beginning and compare the complete normalized title.
          const page = await api(`/api/products?q=${encodeURIComponent(payload.title.trim().slice(0, 100))}${after ? `&after=${encodeURIComponent(after)}` : ''}`);
          const draft = page.nodes.find(matches);
          if (draft) { block(draft); return; }
          after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
        } while (after);
        if (recent.some(e => !e.productId && ['uncertain', 'pending'].includes(e.result))) { block(); return; }
      }
      summary += line('Nombre', product?.title || 'Sin producto', payload.title) + line('Descripción', product?.description || 'Sin descripción', payload.description || 'Sin descripción');
      if (!product || product.variants.nodes.length === 1) {
        const price = Number(data.get('price')).toFixed(2), sku = data.get('sku');
        if (!product || price !== product.variants.nodes[0].price) payload.price = price;
        if (!product || sku !== (product.variants.nodes[0].sku ?? '')) payload.sku = sku;
        summary += line('Precio', product ? money(product.variants.nodes[0].price) : 'Sin precio', money(price)) + line('Código', product?.variants.nodes[0].sku || 'Sin código', sku || 'Sin código');
      }
      const files = [...form.elements.photos.files];
      if (files.length > 3) throw new Error('Agrega hasta 3 fotos por cambio.');
      payload.photos = await Promise.all(files.map(photoData));
      summary += line('Fotos', 'Se conservan las fotos actuales', `${files.length} fotos nuevas`);
      if (!product) {
        if (!locations.length) throw new Error('No hay una tienda activa. Pide a la encargada que la revise en Shopify.');
        payload.locationId = locations.length === 1 ? locations[0].id : data.get('locationId');
        payload.quantity = Number(data.get('quantity'));
        summary += line('Cajas iniciales', 0, payload.quantity);
        if (locations.length > 1) summary += `<p>${esc(locations.find(l => l.id === payload.locationId)?.name)}</p>`;
      }
      payload.confirmActive = data.get('confirmActive') === 'on';
      if (payload.status === 'ACTIVE' && product?.status !== 'ACTIVE' && !payload.confirmActive) throw new Error('Marca la confirmación para poner este producto a la venta.');
      summary += line('Estado', product ? statusText[product.status] : 'Sin producto', statusText[payload.status]);
      if (payload.status === 'ACTIVE' && product?.status !== 'ACTIVE') summary += '<p><strong>También se publicará en la Tienda online para que se vea en la web si aún no está publicado.</strong></p>';
    }
    // Generated once when confirmation opens; retries use this same immutable payload.
    pending = { ...payload, operationId: crypto.randomUUID() };
    pendingSubmitted = false;
    unconfirmed = false;
    $('#summary').innerHTML = summary;
    $('#confirm-error').textContent = '';
    $('#confirm').textContent = payload.action === 'delete' ? 'Eliminar para siempre' : 'Confirmar y guardar';
    $('#confirm').onclick = confirm;
    $('#confirm').disabled = false;
    $('#back').hidden = false;
    openConfirmation();
  } catch (error) { $('#editor-error').textContent = error.message; }
  finally { $('#review').disabled = false; }
}
async function reloadSavedCategories(result, fromProduct) {
  const notice = fromProduct ? $('#editor-error') : $('#category-warning');
  try {
    if (!await loadCategories()) throw new Error('CATEGORY_RELOAD_FAILED');
    renderCategories();
    if (fromProduct) {
      const select = $('#editor-form select[name=categoryId]');
      select.innerHTML = categories.map(c => `<option value="${esc(c.id)}" ${c.id === result.after?.categoryId ? 'selected' : ''}>${esc(c.title)}</option>`).join('');
      notice.textContent = '';
    }
  } catch {
    notice.textContent = 'El cambio se guardó en Shopify. No pudimos actualizar la lista de categorías.';
    notice.hidden = false;
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = 'Actualizar';
    button.onclick = async () => {
      button.disabled = true;
      try { await reloadSavedCategories(result, fromProduct); }
      finally { button.disabled = false; }
    };
    notice.append(button);
  }
}
async function confirm() {
  if (sending || !pending) return;
  sending = true;
  feedback('Guardando en Shopify…');
  $('#confirm').disabled = true;
  $('#back').disabled = true;
  $('#confirm-error').textContent = 'Guardando en Shopify…';
  try {
    if (pending.action === 'production' && !pendingSubmitted) {
      const { product } = await api(`/api/product?id=${encodeURIComponent(pending.productId)}`);
      const level = product.variants.nodes.find(v => v.id === pending.variantId)?.inventoryItem.inventoryLevels.nodes.find(l => l.location.id === pending.locationId);
      if (!level) throw new Error('Las opciones del producto cambiaron. Vuelve a abrirlo.');
      const available = q(level).available;
      if (available !== pending.expected) {
        pending.expected = available;
        $('#summary .big-summary').textContent = `Vas a sumar ${pending.quantity} cajas: ${available} → ${available + pending.quantity}`;
        $('#confirm-error').textContent = 'Actualizamos el conteo de Shopify. Revisa el resumen y confirma.';
        $('#confirm').disabled = false;
        return;
      }
    }
    pendingSubmitted = true;
    const result = await api('/api/operations', pending);
    unconfirmed = false;
    const categoryOperation = pending.action.startsWith('category_');
    $('#confirmation').close();
    if (categoryOperation) {
      $('#category-editor').close();
      pending = null;
      feedback(result.message);
      await reloadSavedCategories(result, categoryFromProduct);
      return;
    }
    $('#editor').close();
    pending = null;
    $('#workspace').hidden = false; $('#history-view').hidden = true; $('#categories-view').hidden = true;
    // R01: el recibo sigue siendo un éxito; si la lista no se puede recargar, no se deja el conteo anterior a la vista.
    let reloaded = true;
    try { await search(); } catch {
      reloaded = false; searchGeneration++; products = []; cursor = null; $('#more').hidden = true;
      $('#products').innerHTML = '<p class="stale-list" role="status">La lista no se pudo actualizar. Toca «Buscar» para ver el conteo nuevo.</p>';
    }
    const saved = `${result.message} ${result.steps.map(s => s.label + ': ' + stepText(s)).join('. ')}`.trim();
    feedback(reloaded ? saved : `${saved.replace(/\.?$/, '.')} No pudimos actualizar la lista: toca «Buscar» para ver el conteo nuevo.`);
  } catch (error) {
    const steps = error.result?.steps?.map(s => `${s.label}: ${stepText(s)}.`).join(' ') || '';
    $('#confirm-error').textContent = `${error.message} ${steps}`;
    if (error.result?.productId && ['create'].includes(pending.action)) draftButton($('#confirm-error'), error.result.productId);
    if (error.result?.code === 'PRODUCT_CHANGED') $('#confirm-error').append(document.createTextNode(` Valores actuales: ${JSON.stringify(readable(error.result.current))}`));
    if (error.result?.state === 'uncertain' && error.result.retryable) {
      $('#confirm').textContent = 'Reintentar';
      $('#confirm').disabled = false;
      $('#confirm').onclick = confirm;
      $('#back').hidden = true;
    } else if (error.status) {
      unconfirmed = false;
      // A confirmed failure/conflict is terminal for this operationId. Open a
      // fresh form to read quantities again and create a new confirmation.
      $('#confirm').textContent = 'Cerrar y revisar';
      $('#confirm').disabled = false;
      $('#confirm').onclick = () => { $('#confirmation').close(); $('#editor').close(); $('#category-editor').close(); pending = null; $('#confirm').onclick = confirm; search().catch(e => feedback(e.message, true)); };
      $('#back').hidden = true;
    } else if (pendingSubmitted) {
      // Red caída o plazo vencido después de enviar: puede haberse guardado. Se ofrece consultar el mismo cambio
      // (misma clave, no se repite) y no se permite descartarlo con Volver o Escape.
      unconfirmed = true;
      $('#confirm-error').textContent = 'No pudimos confirmar si se guardó. Toca «Reintentar»: consulta este mismo cambio y no lo repite.';
      $('#confirm').textContent = 'Reintentar';
      $('#confirm').disabled = false;
      $('#confirm').onclick = confirm;
      $('#back').hidden = true;
    } else {
      $('#confirm').textContent = 'Reintentar';
      $('#confirm').disabled = false;
    }
  } finally { sending = false; $('#back').disabled = false; }
}
function draftButton(container, productId) {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = 'Abrir el producto';
  button.onclick = guard(async () => {
    const { product } = await api(`/api/product?id=${encodeURIComponent(productId)}`);
    $('#confirmation').close(); $('#editor').close();
    openEditor('edit', product);
    if (product.status === 'ACTIVE') {
      $('#editor-error').textContent = 'Este producto ya está a la venta. Revisa y completa su publicación en Shopify. ';
      const link = document.createElement('a');
      link.textContent = 'Completar publicación en Shopify';
      link.href = `shopify://admin/products/${product.id.split('/').at(-1)}`;
      link.target = '_top';
      $('#editor-error').append(link);
    }
  });
  container.append(button);
}
function guard(fn) { return (...args) => Promise.resolve().then(() => fn(...args)).catch(error => feedback(error.message, true)); }
async function loadCategories() {
  try {
    const result = await api('/api/categories');
    categories = result.categories;
    storeCollections = result.collections || []; collectionPage = 0;
    publicationAvailable = result.publicationAvailable !== false;
    categoryWarning = result.warning || '';
    $('#category-warning').textContent = categoryWarning; $('#category-warning').hidden = !categoryWarning;
    $('#new-category').disabled = !publicationAvailable;
    return true;
  } catch (error) {
    categories = []; storeCollections = []; collectionPage = 0; publicationAvailable = false;
    $('#new-category').disabled = true;
    categoryWarning = `No pudimos cargar Categorías: ${error.message} Puedes seguir agregando producción o corrigiendo existencias.`;
    $('#category-warning').textContent = categoryWarning; $('#category-warning').hidden = false;
    return false;
  }
}
function renderCategories() {
  $('#category-list').innerHTML = categories.length ? categories.map((c, i) => `<article class="card"><div class="product-head">${image(c.image?.url, c.image?.altText || c.title)}<div><h3>${esc(c.title)}</h3><p>${esc(c.productsCount?.count ?? 0)} productos</p></div></div>${c.publishedOnPublication === null ? '<p class="error">Publicación sin comprobar</p><button disabled>Publicar en la tienda</button>' : c.publishedOnPublication === false ? `<p class="error">No se ve en la tienda</p><button data-category="${i}" data-kind="publish" aria-label="Publicar en la tienda ${esc(c.title)}">Publicar en la tienda</button>` : ''}<p>Se ve en la portada: <strong>${c.enInicio?.value === 'true' ? 'Sí' : 'No'}</strong></p><p>Orden: ${esc(c.orden?.value || 'Al final')}</p><div class="actions"><button data-category="${i}" data-kind="edit" aria-label="Editar ${esc(c.title)}">Editar</button><button data-category="${i}" data-kind="up" aria-label="Subir ${esc(c.title)}" ${i === 0 ? 'disabled' : ''}>Subir</button><button data-category="${i}" data-kind="down" aria-label="Bajar ${esc(c.title)}" ${i === categories.length - 1 ? 'disabled' : ''}>Bajar</button></div></article>`).join('') : $('#category-warning').hidden ? '<article class="card"><p>Todavía no hay categorías. Crea la primera para organizar tus productos.</p></article>' : '';
  renderStoreCollections();
}
function renderStoreCollections() {
  collectionPage = Math.max(0, Math.min(collectionPage, Math.ceil(storeCollections.length / 100) - 1));
  const start = collectionPage * 100;
  $('#collection-list').innerHTML = storeCollections.length ? storeCollections.slice(start, start + 100).map((c, i) => `<article class="card"><div class="product-head">${image(c.image?.url, c.image?.altText || c.title)}<div><h3>${esc(c.title)}</h3><p>${esc(c.productsCount?.count ?? 0)} productos</p></div></div><p>${c.publishedOnPublication === true ? 'Se ve en la Tienda online' : c.publishedOnPublication === false ? 'No se ve en la tienda' : 'Publicación sin comprobar'}</p>${c.kind === 'tag' ? `<p>Automática por etiqueta «${esc(c.tag)}»: se puede usar como categoría</p>` : ''}${c.manual || c.kind === 'tag' ? `<button data-collection="${start + i}" aria-label="Usar ${esc(c.title)} como categoría">Usar como categoría</button>` : '<p>Automática: no se puede usar como categoría</p>'}</article>`).join('') : '<p>No hay colecciones pendientes de usar como categoría.</p>';
  $('#collections-previous').hidden = collectionPage === 0;
  $('#collections-next').hidden = start + 100 >= storeCollections.length;
  $('#collections-page').textContent = storeCollections.length > 100 ? `${start + 1}–${Math.min(start + 100, storeCollections.length)} de ${storeCollections.length} colecciones` : '';
}
function openAdoption(collection) {
  adoptingCategory = true; editingCategory = collection; categoryFromProduct = false;
  $('#category-title').textContent = 'Usar colección como categoría';
  $('#category-error').textContent = '';
  const order = Math.max(0, ...categories.map(c => Number(c.orden?.value) || 0)) + 1;
  $('#category-fields').innerHTML = `<h3>${esc(collection.title)}</h3>${tagNotice(collection)}<p>Se conservarán el nombre, la descripción, el enlace, los productos y las reglas de la colección.</p>${collection.image ? image(collection.image.url, collection.image.altText) : ''}<label>${collection.image ? 'Cambiar foto' : 'Foto de la categoría (opcional)'}<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>${field('Texto alternativo de la foto', 'altText', collection.image?.altText || '', `${collection.image ? 'required ' : ''}maxlength="512"`)}<p class="muted">Describe qué aparece en la foto. JPG, PNG o WebP; hasta 5 MB.</p><p id="adoption-no-photo" ${collection.image ? 'hidden' : ''}>Sin foto: en la portada se verá el nombre sobre color</p><label>Mostrar en la portada<select name="enInicio"><option value="true" selected>Sí</option><option value="false">No</option></select></label>${field('Orden', 'orden', order, 'type="number" min="1" max="1000000" step="1" required inputmode="numeric"')}${publicationAvailable && collection.publishedOnPublication === false ? '<p>Hoy no se ve en la tienda. ¿Publicarla también?</p><label class="filter"><input type="checkbox" name="publish">Publicar también en la Tienda online</label>' : collection.publishedOnPublication === null ? '<p>Publicación sin comprobar. Se conservará su estado actual.</p>' : ''}`;
  $('#category-form').elements.photo.onchange = () => {
    const hasPhoto = !!collection.image || !!$('#category-form').elements.photo.files[0];
    $('#category-form').elements.altText.required = hasPhoto;
    $('#adoption-no-photo').hidden = hasPhoto;
  };
  $('#category-editor').showModal();
}
function openCategory(category = null, fromProduct = false) {
  if (!category && !publicationAvailable) throw new Error(categoryWarning);
  editingCategory = category;
  adoptingCategory = false;
  categoryFromProduct = fromProduct;
  $('#category-title').textContent = category ? 'Editar categoría' : 'Nueva categoría';
  $('#category-error').textContent = '';
  const order = category?.orden?.value || Math.max(0, ...categories.map(c => Number(c.orden?.value) || 0)) + 1;
  const formatted = formattedDescription(category?.descriptionHtml);
  $('#category-fields').innerHTML = `${field('Nombre de la categoría', 'title', category?.title || '', 'required maxlength="255"')}<label>Descripción corta (opcional)<textarea name="description" maxlength="500" ${formatted ? 'readonly' : ''}>${esc(descriptionText(category))}</textarea></label>${formatted ? '<p>Esta descripción tiene formato; edítala en Shopify</p>' : ''}${category?.image ? image(category.image.url, category.image.altText) : ''}<label>${category ? 'Cambiar foto' : 'Foto de la categoría'}<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" ${category?.image ? '' : 'required'}></label>${field('Texto alternativo de la foto', 'altText', category?.image?.altText || '', 'required maxlength="512"')}<p class="muted">Describe qué aparece en la foto. JPG, PNG o WebP; hasta 5 MB.</p><label>Mostrar en la portada<select name="enInicio"><option value="true" ${!category || category.enInicio?.value === 'true' ? 'selected' : ''}>Sí</option><option value="false" ${category && category.enInicio?.value !== 'true' ? 'selected' : ''}>No</option></select></label>${field('Orden', 'orden', order, 'type="number" min="1" max="1000000" step="1" required inputmode="numeric"')}`;
  $('#category-editor').showModal();
}
const categorySaveNotice = editing => editing ? '<p>Se guardarán los cambios conservando el estado de publicación actual. Para publicarla, usa Publicar en la tienda.</p>' : '<p>Se creará como colección manual y se publicará en la Tienda online.</p>';
function showCategoryConfirmation(payload, summary) {
  pending = { ...payload, operationId: crypto.randomUUID() };
  pendingSubmitted = false;
  $('#summary').innerHTML = summary;
  $('#confirm-error').textContent = '';
  $('#confirm').textContent = 'Confirmar y guardar'; $('#confirm').disabled = false; $('#confirm').onclick = confirm;
  $('#back').hidden = false;
  openConfirmation();
}
$('#categories').addEventListener('click', guard(async () => {
  await loadCategories(); renderCategories();
  $('#workspace').hidden = true; $('#history-view').hidden = true; $('#categories-view').hidden = false;
  feedback('Las categorías se consultan en Shopify. Puedes ocultarlas de la portada sin borrarlas.');
}));
$('#new-category').onclick = () => openCategory();
$('#close-category').onclick = () => $('#category-editor').close();
$('#uncategorized').addEventListener('change', guard(() => search()));
$('#category-editor').addEventListener('cancel', event => { if (sending) event.preventDefault(); });
$('#category-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!event.target.reportValidity()) return;
  $('#review-category').disabled = true;
  try {
    const data = new FormData(event.target);
    const file = event.target.elements.photo.files[0];
    if (adoptingCategory) {
      const altText = String(data.get('altText') || '').trim();
      if ((editingCategory.image || file) && !altText) throw new Error('Escribe el texto alternativo de la foto.');
      const payload = { action: 'category_adopt', categoryId: editingCategory.id, expectedCategory: categorySnapshot(editingCategory), altText, enInicio: data.get('enInicio') === 'true', orden: Number(data.get('orden')), photo: file ? await photoData(file) : null, publish: publicationAvailable && data.get('publish') === 'on' };
      if (!Number.isSafeInteger(payload.orden) || payload.orden < 1 || payload.orden > 1_000_000) throw new Error('Escribe un número de orden desde 1 hasta 1000000.');
      const publication = editingCategory.publishedOnPublication === false ? `<p>Hoy no se ve en la tienda. ¿Publicarla también?</p><p><strong>${payload.publish ? 'Sí: se publicará también en la Tienda online.' : 'No: seguirá sin verse en la tienda. Podrás usar Publicar en la tienda después.'}</strong></p>` : `<p>${editingCategory.publishedOnPublication === true ? 'Ya se ve en la Tienda online.' : 'Publicación sin comprobar.'} Se conserva su publicación actual.</p>`;
      return showCategoryConfirmation(payload, `<h3>Usar ${esc(editingCategory.title)} como categoría</h3>${tagNotice(editingCategory)}<p>Se conservan el nombre, la descripción, el enlace, los productos y las reglas.</p>` + line('Foto', editingCategory.image ? 'Foto actual' : 'Sin foto', file ? 'Foto nueva' : editingCategory.image ? 'Se conserva' : 'Sin foto: en la portada se verá el nombre sobre color') + (editingCategory.image || file ? line('Texto alternativo', editingCategory.image?.altText || '', payload.altText) : '') + line('Mostrar en la portada', 'Sin categoría', payload.enInicio ? 'Sí' : 'No') + line('Orden', 'Sin categoría', payload.orden) + publication);
    }
    const payload = { action: editingCategory ? 'category_edit' : 'category_create', title: data.get('title'), description: formattedDescription(editingCategory?.descriptionHtml) ? '' : data.get('description'), altText: data.get('altText'), enInicio: data.get('enInicio') === 'true', orden: Number(data.get('orden')), photo: file ? await photoData(file) : null, ...(editingCategory ? { categoryId: editingCategory.id, expectedCategory: categorySnapshot(editingCategory) } : {}) };
    if (payload.description.length > 500) throw new Error('La descripción corta admite hasta 500 caracteres. Acórtala antes de guardar.');
    if (!Number.isSafeInteger(payload.orden) || payload.orden < 1 || payload.orden > 1_000_000) throw new Error('Escribe un número de orden desde 1 hasta 1000000.');
    const duplicate = categories.find(c => c.id !== editingCategory?.id && c.title.trim().normalize('NFC').toLocaleLowerCase('es') === payload.title.trim().normalize('NFC').toLocaleLowerCase('es'));
    if (duplicate) throw new Error('Ya existe una categoría con ese nombre. Elige otro o edita la existente.');
    showCategoryConfirmation(payload, line('Nombre', editingCategory?.title || 'Nueva categoría', payload.title) + (formattedDescription(editingCategory?.descriptionHtml) ? '<p>Se conserva la descripción con formato.</p>' : line('Descripción corta', editingCategory?.description || 'Sin descripción', payload.description || 'Sin descripción')) + line('Foto', editingCategory?.image ? 'Foto actual' : 'Sin foto', file ? 'Foto nueva' : 'Se conserva') + line('Texto alternativo', editingCategory?.image?.altText || '', payload.altText) + line('Se ve en la portada', editingCategory?.enInicio?.value === 'true' ? 'Sí' : 'No', payload.enInicio ? 'Sí' : 'No') + line('Orden', editingCategory?.orden?.value || 'Sin orden', payload.orden) + categorySaveNotice(!!editingCategory));
  } catch (error) { $('#category-error').textContent = error.message; }
  finally { $('#review-category').disabled = false; }
});
$('#collection-list').addEventListener('click', guard(async event => {
  const button = event.target.closest('button[data-collection]');
  if (!button) return;
  const selected = storeCollections[Number(button.dataset.collection)];
  if (!(await loadCategories())) return renderCategories();
  renderCategories();
  const collection = storeCollections.find(c => c.id === selected?.id);
  if (!collection || !(collection.manual || collection.kind === 'tag')) throw new Error('La colección cambió, revisa y confirma otra vez');
  openAdoption(collection);
}));
$('#collections-previous').onclick = () => { collectionPage--; renderStoreCollections(); };
$('#collections-next').onclick = () => { collectionPage++; renderStoreCollections(); };
$('#category-list').addEventListener('click', guard(async event => {
  const button = event.target.closest('button[data-category]');
  if (!button) return;
  const selected = categories[Number(button.dataset.category)];
  if (!(await loadCategories())) return renderCategories();
  const category = categories.find(c => c.id === selected.id);
  if (!category) throw new Error('La categoría cambió. Actualiza la lista.');
  if (button.dataset.kind === 'publish') {
    if (!publicationAvailable) throw new Error(categoryWarning);
    categoryFromProduct = false;
    return showCategoryConfirmation({ action: 'category_publish', categoryId: category.id }, `<h3>Publicar en la tienda</h3><p>${esc(category.title)}</p><p>Se publicará esta categoría en la Tienda online si aún no está publicada.</p>`);
  }
  if (button.dataset.kind === 'edit') return openCategory(category);
  const direction = button.dataset.kind === 'up' ? -1 : 1;
  const index = categories.indexOf(category), target = index + direction;
  if (target < 0 || target >= categories.length) return renderCategories();
  categoryFromProduct = false;
  const reordered = [...categories];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  showCategoryConfirmation({ action: 'category_order', categoryId: category.id, direction, expectedCategories: categories.map(categorySnapshot) }, `<h3>Nuevo orden</h3><ol>${reordered.map(c => `<li>${esc(c.title)}</li>`).join('')}</ol><p>Así se ordenarán las categorías de la portada.</p>`);
}));
$('#products').addEventListener('click', guard(event => { const button = event.target.closest('button[data-action]'); if (button) return openAction(button); }));
$('#search-form').addEventListener('submit', guard(event => { event.preventDefault(); return search(); }));
$('#more').addEventListener('click', guard(() => search(true)));
$('#new-product').addEventListener('click', guard(async () => { await loadCategories(); openEditor('create'); }));
$('#close-editor').addEventListener('click', () => $('#editor').close());
$('#editor-form').addEventListener('submit', review);
$('#back').addEventListener('click', () => { if (unconfirmed) return; $('#confirmation').close(); pending = null; });
$('#confirmation').addEventListener('cancel', event => { if (sending || unconfirmed) event.preventDefault(); });
$('#editor').addEventListener('cancel', event => { if (sending) event.preventDefault(); });
$('#confirm').onclick = confirm;
$('#home').addEventListener('click', guard(async () => { $('#workspace').hidden = false; $('#history-view').hidden = true; $('#categories-view').hidden = true; await search(); }));
$('#history').addEventListener('click', guard(async () => {
  const { events } = await api('/api/history');
  historyEvents = events;
  $('#workspace').hidden = true; $('#history-view').hidden = false; $('#categories-view').hidden = true;
  $('#events').innerHTML = events.length ? events.map(e => `<article class="card event"><h3>${esc(actionText[e.action])} · ${e.result === 'succeeded' ? 'Guardado' : ['pending', 'uncertain'].includes(e.result) ? 'Sin confirmar: revisa antes de repetir' : 'Fallido'}</h3><p>${esc(new Date(e.date).toLocaleString('es'))} · ${esc(e.staffName || e.staffId)}</p>${e.reason ? `<p>${esc(e.reason)}</p>` : ''}${e.error ? `<p>${esc(e.error.message)}</p>` : ''}${e.retryable && e.staffId === activeStaffId ? `<button data-retry="${esc(e.operationId)}">Reintentar</button>` : ''}<details><summary>Ver detalle del cambio</summary><pre>${esc(JSON.stringify({ producto: e.productId, opción: e.variantId, tienda: e.locationId, antes: readable(e.before), cambio: readable(e.change), después: readable(e.after), pasos: e.steps.map(s => `${s.label}: ${stepText(s)}`), confirmación: e.operationId }, null, 2))}</pre></details></article>`).join('') : '<div class="card"><p>Todavía no hay cambios. Aquí aparecerá cada operación que confirmes.</p></div>';
  feedback('Historial de los últimos 100 cambios. Los conteos actuales siempre se consultan en Shopify.');
}));
$('#events').addEventListener('click', guard(event => {
  const button = event.target.closest('button[data-retry]');
  if (!button) return;
  const receipt = historyEvents.find(e => e.operationId === button.dataset.retry);
  pending = receipt.retryInput;
  pendingSubmitted = true;
  $('#summary').textContent = 'Sin confirmar: revisa antes de repetir. Se consulta el mismo cambio con su clave original.';
  $('#confirm-error').textContent = '';
  $('#confirm').textContent = 'Reintentar'; $('#confirm').disabled = false; $('#confirm').onclick = confirm;
  $('#back').hidden = false; $('#confirmation').showModal();
}));
const startInventory = guard(async () => {
  const session = await api('/api/session'); activeStaffId = session.staffId;
  $('#scope-warning').textContent = session.warning || ''; $('#scope-warning').hidden = !session.warning;
  ({ locations } = await api('/api/locations'));
  $('#workspace').hidden = false;
  await search();
  await loadCategories();
});
if (window.inventarioAccess) window.inventarioAccess.boot(startInventory);
else startInventory();
