import { requireValue } from './errors.mjs';
export function gid(value, type) {
  requireValue(typeof value === 'string' && new RegExp(`^gid://shopify/${type}/[1-9][0-9]*$`).test(value), 'El producto o la tienda no son válidos. Vuelve a abrirlos.');
  return value;
}
export function integer(value, min = 0) {
  requireValue(Number.isSafeInteger(value) && value >= min && value <= 1_000_000, 'Escribe un número entero de cajas entre 0 y 1000000.');
  return value;
}
export function text(value, max, required = false) {
  requireValue(typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) && (!required || value.trim().length > 0));
  return value.trim();
}
function exactText(value, max, required = false) {
  text(value, max, required);
  return value;
}
export function operation(input) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input));
  requireValue(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId || ''), 'Vuelve a abrir la confirmación del cambio.');
  const base = { operationId: input.operationId.toLowerCase(), action: input.action };
  requireValue(['create', 'edit', 'production', 'correction', 'category_create', 'category_edit', 'category_order', 'category_publish', 'category_adopt', 'delete'].includes(input.action));
  if (input.action.startsWith('category_')) {
    if (input.action !== 'category_create') base.categoryId = gid(input.categoryId, 'Collection');
    if (input.action === 'category_publish') return base;
    if (input.action === 'category_order') {
      requireValue([-1, 1].includes(input.direction));
      base.direction = input.direction;
      requireValue(Array.isArray(input.expectedCategories) && input.expectedCategories.length <= 10_000);
      base.expectedCategories = input.expectedCategories.map(categoryExpectation);
      return base;
    }
    if (input.action === 'category_adopt') {
      base.expectedCategory = categoryExpectation(input.expectedCategory);
      requireValue(base.expectedCategory.id === base.categoryId);
      base.photo = input.photo ? validatePhoto(input.photo) : null;
      base.altText = text(input.altText ?? '', 512, !!(base.expectedCategory.image || base.photo));
      requireValue(input.publish === undefined || typeof input.publish === 'boolean');
      base.publish = input.publish === true;
    } else {
      base.title = text(input.title, 255, true);
      requireValue(typeof (input.description ?? '') === 'string' && (input.description ?? '').length <= 500, 'La descripción corta admite hasta 500 caracteres. Acórtala antes de guardar.');
      base.description = text(input.description ?? '', 500);
      base.altText = text(input.altText, 512, true);
    }
    requireValue(input.enInicio === undefined || typeof input.enInicio === 'boolean');
    base.enInicio = input.enInicio !== false;
    if (input.orden !== undefined) {
      requireValue(Number.isSafeInteger(input.orden) && input.orden >= 1 && input.orden <= 1_000_000, 'Escribe un número de orden desde 1 hasta 1000000.');
      base.orden = input.orden;
    }
    if (input.action === 'category_adopt') return base;
    base.photo = input.photo ? validatePhoto(input.photo) : null;
    if (input.action === 'category_create') requireValue(base.photo, 'Agrega una foto para esta categoría.');
    else base.expectedCategory = categoryExpectation(input.expectedCategory);
    return base;
  }
  if (input.action !== 'create') base.productId = gid(input.productId, 'Product');
  if (input.action === 'delete') {
    base.confirmTitle = text(input.confirmTitle, 255, true);
    return base;
  }
  if (['production', 'correction'].includes(input.action)) {
    base.variantId = gid(input.variantId, 'ProductVariant');
    base.locationId = gid(input.locationId, 'Location');
    base.expected = integer(input.expected, -1_000_000);
    base.quantity = integer(input.quantity, input.action === 'production' ? 1 : 0);
    base.reason = text(input.reason ?? (input.action === 'production' ? 'Producción preparada' : ''), 500, true);
    return base;
  }
  base.title = text(input.title, 200, true);
  if (input.action === 'create' || input.descriptionChanged === true) base.description = text(input.description, 5000);
  if (input.price !== undefined) {
    requireValue(typeof input.price === 'string' && /^(0|[1-9]\d{0,6})\.\d{2}$/.test(input.price), 'Escribe el precio con dos decimales, por ejemplo 12.50.');
    base.price = input.price;
  }
  if (input.sku !== undefined) base.sku = text(input.sku, 100);
  base.photos = input.photos || [];
  requireValue(Array.isArray(base.photos) && base.photos.length <= 3, 'Agrega hasta 3 fotos por cambio.');
  base.photos = base.photos.map(validatePhoto);
  if (input.action === 'create') {
    base.categoryId = gid(input.categoryId, 'Collection');
  } else if (input.categoryId !== undefined) {
    base.categoryId = gid(input.categoryId, 'Collection');
  }
  if (input.action === 'create') {
    requireValue(base.price !== undefined && base.sku !== undefined);
    base.locationId = gid(input.locationId, 'Location');
    base.quantity = integer(input.quantity);
    base.status = input.status ?? 'DRAFT';
    requireValue(['DRAFT', 'ACTIVE'].includes(base.status));
    base.confirmActive = input.confirmActive === true;
    requireValue(base.status !== 'ACTIVE' || base.confirmActive, 'Confirma que quieres poner este producto a la venta.');
  } else {
    requireValue(input.expectedProduct && typeof input.expectedProduct === 'object', 'Vuelve a abrir el producto para revisar los valores actuales.');
    const expected = input.expectedProduct;
    requireValue(typeof expected.descriptionHtml === 'string' && expected.descriptionHtml.length <= 1_000_000);
    base.expectedProduct = { title: exactText(expected.title, 255, true), descriptionHtml: expected.descriptionHtml, status: exactText(expected.status, 20), ...(expected.price === undefined ? {} : { price: exactText(expected.price, 30), sku: exactText(expected.sku ?? '', 100) }) };
    // Older clients send unchanged fields too. Preserve their exact value so a
    // name-only edit cannot silently trim an existing title or SKU.
    if (input.title === expected.title) base.title = expected.title;
    if (input.sku !== undefined && input.sku === expected.sku) base.sku = expected.sku;
    if (expected.variants !== undefined) {
      requireValue(Array.isArray(expected.variants) && expected.variants.length <= 10_000);
      base.expectedProduct.variants = expected.variants.map(v => ({ id: gid(v.id, 'ProductVariant'), price: exactText(v.price, 30), sku: exactText(v.sku ?? '', 100) }));
    }
    if (base.categoryId || expected.categoryIds !== undefined) {
      requireValue(Array.isArray(expected.categoryIds) && expected.categoryIds.length <= 10_000, 'Vuelve a abrir el producto para revisar su categoría.');
      base.expectedProduct.categoryIds = expected.categoryIds.map(id => gid(id, 'Collection')).sort();
    }
    if (expected.tags !== undefined) {
      requireValue(Array.isArray(expected.tags) && expected.tags.length <= 10_000, 'Vuelve a abrir el producto para revisar sus etiquetas.');
      base.expectedProduct.tags = expected.tags.map(tag => { requireValue(typeof tag === 'string' && tag.length <= 1000); return tag; }).sort();
    }
    requireValue(['DRAFT', 'ACTIVE', 'ARCHIVED', 'UNLISTED'].includes(input.status));
    base.status = input.status;
    base.confirmActive = input.confirmActive === true;
    base.descriptionChanged = input.descriptionChanged === true;
  }
  return base;
}
function categoryExpectation(value) {
  requireValue(value && typeof value === 'object');
  // CAS must preserve Shopify's exact bytes, including whitespace at the edges.
  const exact = (v, max) => { requireValue(typeof v === 'string' && v.length <= max); return v; };
  return { id: gid(value.id, 'Collection'), title: exact(value.title, 255), descriptionHtml: exact(value.descriptionHtml, 1_000_000), image: value.image ? { url: exact(value.image.url, 5000), altText: exact(value.image.altText, 512) } : null, enInicio: value.enInicio === true, orden: value.orden == null ? null : exact(value.orden, 30), updatedAt: exact(value.updatedAt, 100) };
}
export function validatePhoto(photo) {
    requireValue(photo && ['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) && typeof photo.data === 'string' && photo.data.length <= 7_000_000 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(photo.data), 'Usa fotos JPG, PNG o WebP de hasta 5 MB.');
    const raw = Uint8Array.from(atob(photo.data), c => c.charCodeAt(0));
    requireValue(raw.length > 12 && raw.length <= 5_000_000);
    const magic = photo.type === 'image/jpeg' ? raw[0] === 255 && raw[1] === 216 && raw[2] === 255 : photo.type === 'image/png' ? [137,80,78,71,13,10,26,10].every((b,i) => raw[i] === b) : String.fromCharCode(...raw.slice(0,4)) === 'RIFF' && String.fromCharCode(...raw.slice(8,12)) === 'WEBP';
    requireValue(magic, 'La foto no tiene el formato indicado. Guárdala como JPG e inténtalo otra vez.');
    return { type: photo.type, data: photo.data };
}
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const formattedDescription = html => /<(?!\/?p\s*>|br\s*\/?\s*>)[^>]*>/i.test(html || '');
export async function fingerprint(input) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(input)))))].map(n => n.toString(16).padStart(2, '0')).join('');
}
