// Pedidos: lista, detalle y acciones sobre pedidos de Shopify desde el portal del personal.
// Usa el transporte del portal (window.inventarioPortal.request, 30 s). Cada escritura lleva un
// operationId; si no hay confirmación, solo se puede «Reintentar» con la misma clave.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = cents => `$${(cents / 100).toFixed(2)}`;
const portal = window.inventarioPortal;
const UNCONFIRMED = 'No pudimos confirmar si se guardó. Toca «Reintentar»: consulta este mismo cambio y no lo repite.';
// Rechazos que garantizan que Shopify no recibió el cambio (validación, permisos, monto o pedido
// distinto, stock, userErrors). Solo con estos se descarta la clave. Cualquier otro error conserva la clave.
const NOT_APPLIED = new Set(['VALIDATION', 'ROLE_REQUIRED', 'STEP_UP_REQUIRED', 'NOT_FOUND', 'ORDER_NOT_FOUND', 'NO_STOCK', 'AMOUNT_CHANGED', 'NOTHING_DUE',
  'REFUND_LIMIT', 'ORDER_CHANGED', 'ORDER_SHIPPED', 'ORDER_CANCELLED', 'ORDER_TOO_LARGE', 'CELEBRACIONES_ORDER', 'PICKUP_ORDER', 'SHIPPING_ORDER',
  'NOTHING_TO_FULFILL', 'FULFILLMENT_SCOPE', 'SHOPIFY_REJECTED', 'OPERATION_REUSED', 'CASH_NOT_ALLOWED', 'UNPAID_SHIPMENT']);
const STAGES = { preparar: 'Por preparar', listo: 'Listos', entregado: 'Entregados', cancelado: 'Cancelados' };
const STAGE_ONE = { preparar: 'Por preparar', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado' };
// Activos: lo que falta preparar o entregar. Historial: entregados y cancelados (no se borra nada en Shopify).
const TABS = { activos: { label: 'Activos', stages: ['preparar', 'listo'] }, historial: { label: 'Historial', stages: ['entregado', 'cancelado'] } };
const ACTIVE = new Set(TABS.activos.stages);
const REFUND_REASONS = [['damaged', 'Llegó dañado'], ['missing', 'Faltó un producto'], ['customer', 'Pedido de la clienta'], ['other', 'Otro']];
const CANCEL_REASONS = [['CUSTOMER', 'La clienta lo pidió'], ['INVENTORY', 'Sin stock para la tanda'], ['DECLINED', 'Pago rechazado o fraude'], ['OTHER', 'Otro']];
const back = label => `<a class="order-back" href="#pedidos${label.href || ''}" aria-label="${esc(label.aria)}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg></a>`;
const dateTime = value => { try { return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }).format(new Date(value)); } catch { return ''; } };
const clock = () => { try { return new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }).format(new Date()); } catch { return ''; } };
const lineName = line => `${line.title}${line.variantTitle ? ` · ${line.variantTitle}` : ''}`;

let list = null, filter = 'preparar', tab = 'activos', query = '', detail = null, variants = null, bakeOpen = false, nextNotice = '', listNotice = '';
// bulk: «Todos los retiros están listos» en curso (bloquea navegar y cerrar la hoja); bulkDone recarga la lista al cerrar.
// bulkRun: cada lote vale solo mientras siga la misma sesión y su hoja abierta (salir o caducar lo invalida).
let bulk = null, bulkDone = false, bulkRun = 0;
// Vuelve al detalle mostrando un aviso; la navegación pasa por #hash para que «atrás» funcione.
function goDetail(id, notice) { list = null; nextNotice = notice; if (location.hash === `#pedidos/${id}`) show(); else location.hash = `pedidos/${id}`; }
// Operación en curso: misma clave y mismo contenido hasta que se confirme.
let op = null;

const user = () => portal?.user?.() || null;
const roles = () => user()?.roles || [];
const isAdmin = () => roles().includes('admin');
const canSee = () => roles().includes('admin') || roles().includes('inventario');
const view = () => $('#pedidos-view');
const sheet = () => $('#order-sheet');
const busy = () => !!bulk?.sending || (!!op && (op.sending || op.unconfirmed));

function deliveryBadge(order) {
  if (order.delivery === 'pickup') return '<span class="badge badge-pickup">Retiro en Fulshear</span>';
  const carrier = /usps/i.test(order.shippingTitle || '') ? 'USPS' : (order.shippingTitle || '').slice(0, 30);
  return `<span class="badge badge-ship">${esc(carrier ? `Envío ${carrier}` : 'Envío')}${order.shippingCents === 0 ? ' · gratis' : ''}</span>`;
}
function paymentBadges(order) {
  const badges = [];
  if (order.celebraciones) badges.push('<span class="badge badge-pickup">Celebraciones</span>');
  if (order.outstandingCents > 0) badges.push(`<span class="badge badge-due">${order.cash ? 'Efectivo pendiente' : 'Pago pendiente'}</span>`);
  else if (order.financial !== 'REFUNDED') badges.push('<span class="badge badge-paid">Pagado</span>');
  if (order.financial === 'PARTIALLY_REFUNDED') badges.push('<span class="badge badge-refund">Reembolso parcial</span>');
  if (order.financial === 'REFUNDED') badges.push('<span class="badge badge-refund">Reembolsado</span>');
  return badges.join('');
}
function itemSummary(items) {
  const byTitle = new Map();
  for (const item of items) byTitle.set(item.title, (byTitle.get(item.title) || 0) + item.quantity);
  return [...byTitle].map(([title, quantity]) => `${quantity} ${title}`).join(' · ');
}
function errorText(error) {
  return error?.message || 'No pudimos completar la acción.';
}

// ---------- Lista ----------
async function showList(reload = true) {
  view().innerHTML = `<div class="orders-head"><p class="eyebrow">Pedidos de la tienda</p><h2 class="orders-title">Pedidos</h2></div><p class="muted" role="status" id="orders-status">Cargando pedidos…</p>`;
  if (reload || !list) {
    try { list = await portal.request('pedidos/orders'); }
    catch (error) { $('#orders-status').textContent = errorText(error); $('#orders-status').classList.add('error'); return; }
  }
  renderList();
}
function renderList() {
  const tiles = list.bake.products.slice(0, 3).map(item => `<div class="bake-tile"><div class="bake-number">${item.quantity}</div><div>${esc(item.title)}</div></div>`).join('');
  view().innerHTML = `<div class="orders-head"><p class="eyebrow">Pedidos de la tienda · últimos ${list.days} días</p><h2 class="orders-title">Pedidos</h2></div>
  <section class="card bake"><h3>Para hornear</h3><p class="muted">Suma de los pedidos sin despachar ni retirar.</p>
    <div class="bake-tiles">${tiles}<div class="bake-tile"><div class="bake-number">${list.bake.orders}</div><div>pedidos en total</div></div></div>
    <button type="button" id="bake-toggle" aria-expanded="${bakeOpen}" aria-controls="bake-detail">Ver detalle por sabor y hoja de empaque</button>
    <div id="bake-detail" ${bakeOpen ? '' : 'hidden'}>
      <h4>Por sabor</h4>${list.bake.variants.length ? `<ul class="bake-list">${list.bake.variants.map(v => `<li><span>${esc(v.title)}${v.variantTitle ? ` · ${esc(v.variantTitle)}` : ''}</span><strong>${v.quantity}</strong></li>`).join('')}</ul>` : '<p class="muted">No hay nada pendiente por hornear.</p>'}
      <h4>Hoja de empaque</h4>${packing()}
    </div>
  </section>
  <div class="order-tabs" role="group" aria-label="Pedidos activos o historial">${Object.entries(TABS).map(([key, { label, stages }]) => `<button type="button" class="order-tab" data-tab="${key}" aria-pressed="${tab === key}">${label} · ${stages.reduce((sum, stage) => sum + (list.counts[stage] || 0), 0)}</button>`).join('')}</div>
  <div class="order-chips" role="group" aria-label="Filtrar pedidos">${TABS[tab].stages.map(key => `<button type="button" class="chip" data-stage="${key}" aria-pressed="${filter === key}">${STAGES[key]} · ${list.counts[key] || 0}</button>`).join('')}</div>
  <label class="order-search">Buscar pedido<input id="order-query" type="search" maxlength="80" placeholder="Número, nombre o correo" value="${esc(query)}" autocomplete="off"></label>
  ${list.complete ? '' : '<p class="notice">Hay más pedidos de los que el panel muestra. Los más antiguos están en Shopify.</p>'}
  <p class="muted" id="orders-status" role="status"></p>
  <div id="orders-bulk"></div>
  <div id="order-cards" class="order-cards"></div>`;
  $('#bake-toggle').onclick = () => { bakeOpen = !bakeOpen; $('#bake-toggle').setAttribute('aria-expanded', String(bakeOpen)); $('#bake-detail').hidden = !bakeOpen; };
  for (const chip of view().querySelectorAll('.chip')) chip.onclick = () => { filter = chip.dataset.stage; for (const other of view().querySelectorAll('.chip')) other.setAttribute('aria-pressed', String(other === chip)); renderCards(); };
  for (const button of view().querySelectorAll('.order-tab')) button.onclick = () => { if (tab === button.dataset.tab) return; tab = button.dataset.tab; filter = TABS[tab].stages[0]; renderList(); };
  $('#order-query').oninput = event => { query = event.target.value; renderCards(); };
  renderCards();
  if (listNotice) { $('#orders-status').textContent = listNotice; listNotice = ''; }
}
function packing() {
  const pending = list.orders.filter(order => ACTIVE.has(order.stage) && !order.celebraciones && order.items.some(item => item.unfulfilled > 0));
  if (!pending.length) return '<p class="muted">No hay pedidos por empacar.</p>';
  return `<ul class="packing">${pending.map(order => `<li><strong>${esc(order.name)} · ${esc(order.customer)}</strong> <span class="muted">${order.delivery === 'pickup' ? 'Retiro' : 'Envío'}</span><br>${order.items.filter(item => item.unfulfilled > 0).map(item => `${item.unfulfilled} × ${esc(item.title)}${item.variantTitle ? ` · ${esc(item.variantTitle)}` : ''}`).join(', ')}</li>`).join('')}</ul>`;
}
function renderCards() {
  const term = query.trim().toLowerCase().replace(/^#/, '');
  const shown = list.orders.filter(order => term
    ? [order.name.replace(/^#/, ''), order.customer, order.email].some(value => String(value || '').toLowerCase().includes(term))
    : order.stage === filter);
  $('#orders-status').textContent = term ? `${shown.length} ${shown.length === 1 ? 'resultado' : 'resultados'} en todos los pedidos.` : '';
  $('#order-cards').innerHTML = shown.length ? shown.map(order => `<article class="order-card"><a class="order-card-link" href="#pedidos/${esc(order.id)}">
    <div class="order-card-head"><strong>${esc(order.name)} · ${esc(order.customer)}</strong><span>${usd(order.totalCents)}</span></div>
    <div class="muted">${esc(itemSummary(order.items))}${order.itemsTruncated ? ' · y más' : ''}</div>
    <div class="badges">${deliveryBadge(order)}${paymentBadges(order)}${term ? `<span class="badge">${STAGE_ONE[order.stage]}</span>` : ''}</div></a>${quickButton(order)}</article>`).join('')
    : `<p class="empty muted">${term ? 'No encontramos pedidos con esa búsqueda.' : 'No hay pedidos aquí.'}</p>`;
  for (const button of view().querySelectorAll('[data-quick]')) button.onclick = () => quickAction(button.dataset.quick, button.dataset.id);
  // Marcar en lote: solo en «Por preparar», con 2 o más retiros.
  const pickups = list.orders.filter(order => order.delivery === 'pickup' && order.stage === 'preparar');
  $('#orders-bulk').innerHTML = !term && filter === 'preparar' && pickups.length >= 2 ? `<button type="button" id="bulk-ready">Todos los retiros están listos (${pickups.length})</button>` : '';
  if ($('#bulk-ready')) $('#bulk-ready').onclick = openBulk;
}
/** Retiros activos: «Listo para retirar» o «Entregado» sin abrir el pedido. Confirma en la misma hoja que el detalle. */
function quickButton(order) {
  if (order.delivery !== 'pickup' || !ACTIVE.has(order.stage)) return '';
  const [action, label] = order.stage === 'preparar' ? ['ready', 'Listo para retirar'] : ['delivered', 'Entregado'];
  return `<div class="order-quick"><button type="button" data-quick="${action}" data-id="${esc(order.id)}" aria-label="${esc(`${label}: pedido ${order.name}`)}">${label}</button></div>`;
}
function quickAction(action, id) {
  if (busy()) return;
  const order = list?.orders.find(item => String(item.id) === String(id));
  if (!order) return;
  op = null;
  pickupSheet(action, order, async result => { list = null; listNotice = result?.warning || (action === 'ready' ? `${order.name}: listo para retirar.` : `${order.name}: entregado.`); await showList(true); }, true);
}

// ---------- Detalle ----------
async function showDetail(id, notice = '') {
  view().innerHTML = `<div class="order-top">${back({ aria: 'Volver a pedidos' })}<h2 id="order-title">Pedido</h2></div><p class="muted" role="status">Cargando pedido…</p>`;
  try { detail = await portal.request(`pedidos/orders/${id}`); }
  catch (error) { view().querySelector('[role=status]').textContent = errorText(error); view().querySelector('[role=status]').classList.add('error'); return; }
  renderDetail(notice);
}
function actionButtons(order) {
  const buttons = [], admin = isAdmin(), notes = [];
  if (!order.cancelled) {
    if (order.delivery === 'pickup') {
      if (order.stage === 'preparar') buttons.push('<button type="button" class="primary" data-action="ready">Listo para retirar</button>');
      if (order.stage === 'listo') buttons.push('<button type="button" class="primary" data-action="delivered">Entregado</button>');
    } else if (order.fulfillment !== 'FULFILLED') buttons.push('<button type="button" class="primary" data-action="fulfill">Marcar despachado</button>');
    if (admin && order.celebraciones) notes.push('<p class="notice">Este pedido se cobra desde Celebraciones</p>');
    if (admin && !order.celebraciones) {
      if (order.outstandingCents > 0 && order.cashAllowed === true) buttons.push('<button type="button" data-action="cash">Cobré en efectivo</button>');
      if (order.lines.some(line => line.unfulfilled > 0)) buttons.push('<button type="button" data-action="edit">Editar pedido</button>');
      if (order.netPaymentCents > 0) buttons.push('<button type="button" data-action="refund">Reembolsar</button>');
      if (order.canCancel) buttons.push('<button type="button" class="danger" data-action="cancel">Cancelar pedido</button>');
      else if (order.cancelPending) notes.push('<p class="notice">Shopify está procesando la cancelación de este pedido. Vuelve a abrirlo en unos segundos.</p>');
      else notes.push('<p class="muted">Un pedido despachado ya no se cancela: se reembolsa.</p>');
    }
  } else notes.push('<p class="notice">Este pedido está cancelado.</p>');
  return `${buttons.length ? `<div class="order-actions">${buttons.join('')}</div>` : ''}${notes.join('')}<p class="muted">Cobrar, editar, reembolsar y cancelar: solo la administradora, con su contraseña.</p>`;
}
function renderDetail(notice = '') {
  const order = detail;
  const rows = order.lines.filter(line => line.quantity > 0).map(line => `<div class="order-row"><span>${esc(lineName(line))}</span><span>${line.quantity} × ${usd(line.unitCents)}</span></div>`).join('');
  const shipping = order.delivery === 'pickup' ? `<div class="order-row"><span>Retiro</span><span>${order.shippingCents ? usd(order.shippingCents) : 'Gratis'}</span></div>` : `<div class="order-row"><span>Envío</span><span>${order.shippingCents ? usd(order.shippingCents) : 'Gratis'}</span></div>`;
  view().innerHTML = `<div class="order-top">${back({ aria: 'Volver a pedidos' })}<h2 id="order-title">Pedido ${esc(order.name)}</h2></div>
  ${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ''}
  <div class="badges">${deliveryBadge(order)}${paymentBadges({ ...order, cash: order.payment.includes('Efectivo') })}<span class="badge">${order.cancelled ? 'Cancelado' : STAGE_ONE[order.stage]}</span></div>
  <section class="card"><h3>Cliente</h3><p>${esc(order.customer.name)}</p><p class="muted">${[order.customer.email, order.customer.phone].filter(Boolean).map(esc).join(' · ') || 'Sin datos de contacto'}</p>${order.customerNote ? `<p>Nota del cliente: «${esc(order.customerNote)}».</p>` : ''}</section>
  <section class="card"><h3>Productos</h3>${rows}${order.linesTruncated ? '<p class="muted">El pedido tiene más productos; revisa Shopify.</p>' : ''}${shipping}
    <div class="order-row order-total"><span>Total</span><span>${usd(order.totalCents)}</span></div>
    ${order.refundedCents > 0 ? `<div class="order-row"><span>Reembolsado</span><span>${usd(order.refundedCents)}</span></div>` : ''}
    ${order.outstandingCents > 0 ? `<div class="order-row order-due"><span>Saldo por cobrar</span><span>${usd(order.outstandingCents)}</span></div>` : ''}
    ${order.fulfillments.flatMap(f => f.tracking).filter(t => t.number).map(t => `<p class="muted">Seguimiento: ${esc(t.company || '')} ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.number)}</a>` : esc(t.number)}</p>`).join('')}</section>
  <section class="card"><h3>Acciones</h3>${actionButtons(order)}</section>
  <section class="card"><h3>Historial del pedido</h3>${order.timeline.map(event => `<p class="order-event">${esc(dateTime(event.at))} · ${esc(event.title)}${event.by ? ` · ${esc(event.by)}` : ''}${event.state === 'unconfirmed' ? ' · sin confirmar' : event.state === 'failed' ? ' · no se aplicó' : ''}</p>`).join('')}</section>
  <section class="card"><form id="note-form"><label for="internal-note">Nota interna</label><textarea id="internal-note" maxlength="2000" placeholder="Solo la ve el personal">${esc(order.note.text)}</textarea>
    <p class="muted" id="note-meta">${order.note.staffName ? `Última edición: ${esc(order.note.staffName)} · ${esc(dateTime(order.note.updatedAt))}` : ''}</p>
    <button type="submit" id="note-save">Guardar nota</button><p id="note-status" role="status"></p></form></section>`;
  for (const button of view().querySelectorAll('[data-action]')) button.onclick = () => openAction(button.dataset.action);
  $('#note-form').onsubmit = saveNote;
}
async function saveNote(event) {
  event.preventDefault();
  const button = $('#note-save'), status = $('#note-status');
  button.disabled = true; status.textContent = 'Guardando…'; status.classList.remove('error');
  try {
    const result = await portal.request(`pedidos/orders/${detail.id}/note`, { body: { text: $('#internal-note').value, version: detail.note.version } });
    detail.note = result.note; status.textContent = 'Nota guardada.';
    $('#note-meta').textContent = `Última edición: ${result.note.staffName} · ${dateTime(result.note.updatedAt)}`;
  } catch (error) {
    status.textContent = errorText(error); status.classList.add('error');
    if (error.result?.note) { detail.note = error.result.note; $('#internal-note').value = error.result.note.text; }
  } finally { button.disabled = false; }
}

// ---------- Hojas (despachar, retiro, efectivo, cancelar, confirmaciones) ----------
const password = () => `<label>Tu contraseña<input type="password" id="sheet-password" autocomplete="current-password" maxlength="256" required><small>Se pide en cada cobro, reembolso, edición o cancelación.</small></label>`;
function openSheet({ eyebrow, title, danger = false, fields, confirm, backLabel = 'Volver', foot = '', action, build, needsPassword = false, passwordFrom = null, after, id = null, fromList = false }) {
  const dialog = sheet();
  dialog.innerHTML = `<form id="sheet-form" novalidate><div class="sheet-head"><p class="eyebrow">${esc(eyebrow)}</p><h2 id="order-sheet-title" class="${danger ? 'danger-title' : ''}">${esc(title)}</h2></div>
    ${fields}<p id="sheet-error" role="alert"></p>
    <div class="actions"><button type="button" id="sheet-back">${esc(backLabel)}</button><button type="submit" id="sheet-confirm" class="${danger ? 'danger danger-fill' : 'primary'}">${esc(confirm)}</button></div>${foot ? `<p class="muted sheet-foot">${foot}</p>` : ''}</form>`;
  $('#sheet-back').onclick = () => { if (busy()) return; dialog.close(); };
  $('#sheet-form').onsubmit = async event => {
    event.preventDefault();
    if (op?.sending || op?.final) return;
    if (!op) {
      let body;
      try { body = build(); } catch (error) { $('#sheet-error').textContent = error.message; return; }
      op = { action, id: id ?? detail.id, fromList, body, operationId: crypto.randomUUID(), sending: false, unconfirmed: false };
      if (passwordFrom) op.password = passwordFrom();
    }
    if (needsPassword) {
      const value = $('#sheet-password')?.value || '';
      if (!value) { $('#sheet-error').textContent = 'Escribe tu contraseña para confirmar.'; return; }
      op.password = value;
    }
    await send(after);
  };
  dialog.showModal();
  dialog.querySelector('input:not([type=checkbox]):not([type=hidden]),select,textarea,button')?.focus();
}
async function send(after) {
  const dialog = sheet(), confirmButton = $('#sheet-confirm'), error = $('#sheet-error'), backButton = $('#sheet-back');
  op.sending = true; confirmButton.disabled = true; backButton.disabled = true; error.textContent = '';
  for (const input of dialog.querySelectorAll('input:not([type=password]),select,textarea')) input.disabled = true;
  try {
    const result = await portal.request(`pedidos/orders/${op.id}/${op.action}`, { body: { ...op.body, operationId: op.operationId }, ...(op.password ? { password: op.password } : {}) });
    // 202: Shopify sigue procesando (cancelación asíncrona). Misma clave; reintentar solo consulta.
    if (result?.state === 'processing') { op.sending = false; unconfirmed(result.message || UNCONFIRMED); return; }
    op = null;
    if (dialog.open) dialog.close();
    await after(result);
  } catch (failure) {
    if (!op) return;
    op.sending = false;
    if (failure.code === 'PASSWORD_INVALID' || failure.code === 'PASSWORD_REQUIRED') {
      // Rechazada antes de llegar a Shopify: mismo cambio y misma clave, solo se pide la contraseña otra vez.
      error.textContent = failure.message;
      confirmButton.disabled = false; backButton.disabled = false; backButton.hidden = false;
      if ($('#sheet-password')) { $('#sheet-password').disabled = false; $('#sheet-password').value = ''; $('#sheet-password').focus(); }
    } else if (failure.status && (NOT_APPLIED.has(failure.code) || (failure.code === 'SHOPIFY_UNAVAILABLE' && failure.result?.final === true))) {
      // Rechazo que garantiza que no se aplicó nada: se corrige el formulario y el próximo intento usa una clave nueva.
      op = null; error.textContent = failure.message;
      confirmButton.disabled = false; backButton.disabled = false; backButton.hidden = false;
      for (const input of dialog.querySelectorAll('input,select,textarea')) input.disabled = false;
    } else {
      // Pendiente: sin respuesta, 502 incierto o un 5xx que Celebraciones no marcó como definitivo (p. ej. la
      // respuesta se perdió en el camino). Se conserva la clave y el reintento solo consulta ese mismo cambio.
      const result = failure.result || {};
      const pending = !failure.status || result.state === 'uncertain' || (failure.status >= 500 && result.final !== true);
      if (pending) unconfirmed(result.state === 'uncertain' ? failure.message : UNCONFIRMED);
      else reviewed(failure.message);
    }
  }
}
/** Incertidumbre pendiente: solo «Reintentar», sin «Volver» ni Escape. */
function unconfirmed(text) {
  op.unconfirmed = true;
  $('#sheet-error').textContent = text;
  $('#sheet-confirm').textContent = 'Reintentar';
  $('#sheet-confirm').disabled = false;
  $('#sheet-back').hidden = true;
}
/** Resultado definitivo que pide revisar (CANCEL_FAILED, REVIEW_REQUIRED…): se cierra con «Volver» o Escape y esta hoja ya no escribe. */
function reviewed(text) {
  op.unconfirmed = false; op.final = true;
  $('#sheet-error').textContent = text;
  $('#sheet-confirm').hidden = true;
  $('#sheet-back').disabled = false;
  $('#sheet-back').hidden = false;
  $('#sheet-back').focus();
}
function done(message) {
  return async result => { list = null; await showDetail(detail.id, result?.warning || message); };
}

function openAction(action) {
  if (busy()) return;
  op = null;
  const order = detail, units = order.lines.reduce((sum, line) => sum + line.unfulfilled, 0);
  const pending = order.lines.filter(line => line.unfulfilled > 0).map(line => `${line.unfulfilled} ${line.title}`).join(', ');
  if (action === 'fulfill') return openSheet({ action, eyebrow: `Pedido ${order.name} · ${order.shippingTitle && /usps/i.test(order.shippingTitle) ? 'Envío USPS' : 'Envío'}`, title: 'Marcar despachado', confirm: 'Confirmar despacho',
    fields: `${order.outstandingCents > 0 ? `<p class="notice">Este pedido tiene saldo por cobrar. Cóbralo antes de enviarlo. Saldo: ${usd(order.outstandingCents)}.</p>
      <label class="check"><input type="checkbox" id="confirm-unpaid"><span>Enviar igual sin cobrar</span></label>` : ''}
      <label>Número de seguimiento<input type="text" id="tracking" inputmode="text" autocomplete="off" maxlength="60" required></label>
      <label>Transportista<select id="carrier"><option value="USPS">USPS Ground Advantage</option><option value="OTHER">Otro</option></select></label>
      <label id="carrier-name-field" hidden>Nombre del transportista<input type="text" id="carrier-name" maxlength="40"></label>
      <label class="check"><input type="checkbox" id="notify" checked><span>Avisar a la clienta por correo con el enlace de seguimiento <small>Lo envía Shopify con su plantilla de envío.</small></span></label>
      <div class="notice">Se despachan las ${units} unidades del pedido: ${esc(pending)}.</div>`,
    build: () => {
      const trackingNumber = $('#tracking').value.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9 -]{3,59}$/.test(trackingNumber)) throw new Error('Escribe un número de seguimiento válido.');
      const carrier = $('#carrier').value;
      if (carrier === 'OTHER' && !$('#carrier-name').value.trim()) throw new Error('Escribe el nombre del transportista.');
      const confirmUnpaid = $('#confirm-unpaid')?.checked === true;
      if (order.outstandingCents > 0 && !confirmUnpaid) throw new Error('Confirma «Enviar igual sin cobrar» para despachar este pedido.');
      return { trackingNumber, carrier, ...(carrier === 'OTHER' ? { carrierName: $('#carrier-name').value.trim() } : {}), notify: $('#notify').checked, confirmUnpaid };
    }, after: done('Pedido despachado.') }), $('#carrier').onchange = () => { $('#carrier-name-field').hidden = $('#carrier').value !== 'OTHER'; };
  if (action === 'ready') return pickupSheet(action, order, done('Pedido listo para retirar.'));
  if (action === 'delivered') return pickupSheet(action, order, done('Pedido entregado.'));
  if (action === 'cash') return openSheet({ action, needsPassword: true, eyebrow: `Pedido ${order.name} · ${order.customer.name}`, title: 'Cobré en efectivo', confirm: `Registrar ${usd(order.outstandingCents)}`,
    fields: `<div class="amount-box"><div>Monto a registrar</div><div class="amount">${usd(order.outstandingCents)}</div><div class="muted">Saldo exacto que calcula Shopify. No se puede cambiar.</div></div>
      <p>El pedido pasa a «Pagado» en Shopify. Queda registrado que lo cobró ${esc(user()?.name || '')} hoy a las ${esc(clock().replace(/\.$/, ''))}.</p>${password()}`,
    foot: 'Para que el cliente pueda elegir pagar en efectivo, Dayana debe activar «Efectivo al retirar» en Shopify (Ajustes › Pagos). Los pasteles de Celebraciones con pago contra entrega se cobran desde su propio flujo, así que no se cuentan dos veces.',
    build: () => ({ expectedAmountCents: order.outstandingCents }), after: done('Cobro registrado.') });
  if (action === 'cancel') {
    const items = order.lines.filter(line => line.quantity > 0).map(line => `${line.quantity} ${line.title}`).join(' y ');
    return openSheet({ action, needsPassword: true, danger: true, eyebrow: `Pedido ${order.name} · ${order.customer.name} · ${usd(order.totalCents)}`, title: 'Cancelar pedido', confirm: 'Cancelar pedido', backLabel: 'No cancelar',
      fields: `<label>Motivo<select id="cancel-reason">${CANCEL_REASONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
        ${order.netPaymentCents > 0 ? `<label class="check"><input type="checkbox" id="cancel-refund" checked><span>Reembolsar ${usd(order.netPaymentCents)} a la forma de pago original</span></label>` : ''}
        <label class="check"><input type="checkbox" id="cancel-restock" checked><span>Regresar las cajas al stock <small>${esc(items)} vuelven a estar a la venta.</small></span></label>
        <label class="check"><input type="checkbox" id="notify" checked><span>Avisar a la clienta por correo</span></label>${password().replace('<small>Se pide en cada cobro, reembolso, edición o cancelación.</small>', '')}`,
      foot: 'Un pedido despachado ya no se cancela: se reembolsa. La cancelación no se puede deshacer.',
      build: () => ({ reason: $('#cancel-reason').value, refund: !!$('#cancel-refund')?.checked, restock: $('#cancel-restock').checked, notify: $('#notify').checked }),
      after: done('Pedido cancelado.') });
  }
  if (action === 'refund') { location.hash = `pedidos/${order.id}/reembolsar`; return; }
  if (action === 'edit') { location.hash = `pedidos/${order.id}/editar`; return; }
}

/** Listo para retirar / Entregado, desde el detalle o desde la tarjeta. Con saldo por cobrar avisa, pero no bloquea. */
function pickupSheet(action, order, after, fromList = false) {
  const pending = (order.lines || order.items || []).filter(line => line.unfulfilled > 0).map(line => `${line.unfulfilled} ${line.title}`).join(', ');
  const due = !(order.outstandingCents > 0) ? ''
    : order.celebraciones ? `<p class="notice notice-due">Saldo por cobrar: ${usd(order.outstandingCents)}. Este pedido se cobra desde Celebraciones.</p>`
      : `<p class="notice notice-due">Saldo por cobrar: ${usd(order.outstandingCents)}. ${action === 'delivered' ? 'Marcarlo entregado no registra el pago: cóbralo al entregarlo.' : 'Cóbralo cuando la clienta lo retire.'}</p>`;
  const text = action === 'ready'
    ? { title: 'Listo para retirar', confirm: 'Marcar listo para retirar', intro: 'Shopify le avisa a la clienta que su pedido ya está listo en Fulshear. Al entregarlo, se marca «Entregado».' }
    : { title: 'Entregado', confirm: 'Marcar entregado', intro: 'La clienta ya retiró su pedido en Fulshear. No se envía ningún correo.' };
  return openSheet({ action, id: order.id, fromList, eyebrow: `Pedido ${order.name} · Retiro en Fulshear`, title: text.title, confirm: text.confirm,
    fields: `<p>${text.intro}</p>${due}${pending ? `<div class="notice">${esc(pending)}</div>` : ''}`, build: () => ({}), after });
}

// ---------- Todos los retiros listos ----------
function openBulk() {
  if (busy() || !list) return;
  op = null;
  const targets = list.orders.filter(order => order.delivery === 'pickup' && order.stage === 'preparar');
  if (targets.length < 2) return;
  const due = targets.filter(order => order.outstandingCents > 0);
  const dialog = sheet();
  dialog.innerHTML = `<form id="sheet-form" novalidate><div class="sheet-head"><p class="eyebrow">Retiro en Fulshear · ${targets.length} pedidos</p><h2 id="order-sheet-title">Todos los retiros están listos</h2></div>
    <p>Shopify le avisa a cada clienta que su pedido ya está listo en Fulshear: un correo por pedido.</p>
    <ul class="bulk-list">${targets.map(order => `<li data-bulk="${esc(order.id)}"><span>${esc(order.name)} · ${esc(order.customer)}${order.outstandingCents > 0 ? ` <small>saldo ${usd(order.outstandingCents)}</small>` : ''}</span><span class="muted" data-bulk-state></span></li>`).join('')}</ul>
    ${due.length ? `<p class="notice notice-due">${due.length === 1 ? '1 pedido tiene' : `${due.length} pedidos tienen`} saldo por cobrar. Cóbralo cuando lo retiren.</p>` : ''}
    <p id="sheet-error" role="alert"></p>
    <div class="actions"><button type="button" id="sheet-back">Volver</button><button type="submit" id="sheet-confirm" class="primary">Marcar ${targets.length} listos</button></div></form>`;
  $('#sheet-back').onclick = () => { if (!busy()) dialog.close(); };
  $('#sheet-form').onsubmit = event => { event.preventDefault(); if (!bulk && !bulkDone) runBulk(targets); };
  dialog.showModal();
  $('#sheet-confirm').focus();
}
/** Uno por uno, cada uno con su operationId. Antes vuelve a leer la lista para no avisar dos veces a una clienta. */
async function runBulk(targets) {
  const confirmButton = $('#sheet-confirm'), backButton = $('#sheet-back'), error = $('#sheet-error');
  const run = ++bulkRun, who = user()?.id;
  // Tras cada espera: si cambió la persona (salir, caducar, otra cuenta) o se cerró la hoja, no se envía nada más.
  // Se compara el id: renovar los datos de la misma persona (p. ej. al editar sus propios permisos) no detiene el lote.
  const live = () => run === bulkRun && !!who && user()?.id === who && sheet().open;
  // Si el lote se detiene con la hoja aún abierta, se libera: «Cerrar» vuelve a funcionar y nada se reanuda solo.
  const stop = () => {
    if (run !== bulkRun) return;
    bulkRun++; bulk = null;
    if (!sheet().open) return;
    bulkDone = true; confirmButton.hidden = true; backButton.textContent = 'Cerrar'; backButton.disabled = false;
    error.textContent = 'El lote se detuvo porque cambió la sesión. Los pedidos sin marcar siguen por preparar; revisa la lista.';
  };
  bulk = { sending: true }; confirmButton.disabled = true; backButton.disabled = true; error.textContent = '';
  let still;
  try { still = new Set((await portal.request('pedidos/orders')).orders.filter(order => order.delivery === 'pickup' && order.stage === 'preparar').map(order => String(order.id))); }
  catch (failure) { if (!live()) return stop(); bulk = null; confirmButton.disabled = false; backButton.disabled = false; error.textContent = `${errorText(failure)} No se marcó ningún pedido.`; return; }
  if (!live()) return stop();
  const tally = { ok: 0, skipped: 0, failed: 0, unknown: 0 };
  for (const order of targets) {
    const state = sheet().querySelector(`[data-bulk="${CSS.escape(String(order.id))}"] [data-bulk-state]`);
    if (!live()) return stop();
    if (!still.has(String(order.id))) { state.textContent = 'Ya no está por preparar'; tally.skipped++; continue; }
    state.textContent = 'Enviando…';
    try {
      const result = await portal.request(`pedidos/orders/${order.id}/ready`, { body: { operationId: crypto.randomUUID() } });
      if (!live()) return stop();
      state.textContent = result?.warning || 'Listo'; tally.ok++;
    } catch (failure) {
      if (!live()) return stop();
      const sure = failure.status && (NOT_APPLIED.has(failure.code) || (failure.code === 'SHOPIFY_UNAVAILABLE' && failure.result?.final === true));
      state.textContent = sure ? `No se marcó: ${errorText(failure)}` : 'Sin confirmar: revisa el pedido antes de repetirlo';
      tally[sure ? 'failed' : 'unknown']++;
    }
  }
  bulk = null; bulkDone = true;
  const parts = [`${tally.ok} ${tally.ok === 1 ? 'listo' : 'listos'}`];
  if (tally.failed) parts.push(`${tally.failed} sin marcar`);
  if (tally.unknown) parts.push(`${tally.unknown} sin confirmar`);
  if (tally.skipped) parts.push(`${tally.skipped} ya no estaban por preparar`);
  error.textContent = tally.failed || tally.unknown ? `${parts.join(', ')}. Abre los que quedaron sin marcar para revisarlos.` : '';
  listNotice = `${parts.join(', ')}.`;
  confirmButton.hidden = true; backButton.textContent = 'Cerrar'; backButton.disabled = false; backButton.focus();
}

// ---------- Reembolso ----------
async function ensureDetail(id) {
  if (detail?.id === id) return true;
  try { detail = await portal.request(`pedidos/orders/${id}`); return true; }
  catch (error) { view().innerHTML = `<p class="error" role="alert">${esc(errorText(error))}</p>`; return false; }
}
let previewTimer = null, preview = null, previewSeq = 0;
function parseMoney(value) {
  const text = String(value || '').trim().replace(/^\$/, '');
  if (!text) return 0;
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
function refundBody() {
  const lines = [...view().querySelectorAll('[data-refund-line]')].map(select => ({ lineItemId: select.dataset.refundLine, quantity: Number(select.value) })).filter(line => line.quantity > 0);
  return { lines, restock: $('#refund-restock').checked, refundShipping: !!$('#refund-shipping')?.checked, extraCents: parseMoney($('#refund-extra').value), reason: $('#refund-reason').value, notify: $('#refund-notify').checked };
}
async function showRefund(id) {
  if (!isAdmin()) { location.hash = `pedidos/${id}`; return; }
  view().innerHTML = '<p class="muted" role="status">Cargando pedido…</p>';
  if (!await ensureDetail(id)) return;
  const order = detail; preview = null;
  view().innerHTML = `<div class="order-top">${back({ aria: 'Volver al pedido', href: `/${order.id}` })}<h2 id="order-title">Reembolsar ${esc(order.name)}</h2></div>
  <p>Elige qué se devuelve. Shopify calcula el monto; nunca puede pasar de lo que la clienta pagó.</p>
  <section class="card"><h3>Productos</h3>${order.lines.filter(line => line.refundable > 0).map(line => `<div class="refund-line"><div><div>${esc(lineName(line))}</div><small>${usd(line.unitCents)} c/u · compró ${line.quantity}</small></div>
      <label>Devolver<select data-refund-line="${esc(line.id)}" aria-label="Cantidad a devolver de ${esc(line.title)}">${Array.from({ length: line.refundable + 1 }, (_, n) => `<option>${n}</option>`).join('')}</select></label></div>`).join('') || '<p class="muted">No quedan productos por devolver.</p>'}
    <label class="check"><input type="checkbox" id="refund-restock"><span>Regresar al stock <small>Solo si la caja sigue en condiciones de venderse en esta tanda.</small></span></label></section>
  <section class="card"><h3>Envío y otro monto</h3>
    <label class="check"><input type="checkbox" id="refund-shipping" ${order.shippingCents ? '' : 'disabled'}><span>Devolver el envío <small>${order.shippingCents ? `Envío de ${usd(order.shippingCents)}.` : 'Este pedido tuvo envío gratis.'}</small></span></label>
    <label>Monto adicional <small>(opcional, por ejemplo una caja dañada)</small><input type="text" id="refund-extra" inputmode="decimal" placeholder="$0.00" maxlength="10" autocomplete="off"></label>
    <label>Motivo<select id="refund-reason">${REFUND_REASONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label></section>
  <section class="card"><div class="order-row order-total"><span>Se devuelve</span><strong id="refund-total">$0.00</strong></div>
    <div class="order-row"><span>A la forma de pago original</span><span id="refund-max" class="muted"></span></div>
    <p id="refund-status" role="status" class="muted"></p>
    <label class="check"><input type="checkbox" id="refund-notify" checked><span>Avisar a la clienta por correo</span></label></section>
  <button type="button" class="primary wide" id="refund-review" disabled>Revisar y reembolsar $0.00</button>
  <p class="muted">Un reembolso no se puede deshacer. Si la conexión falla, el panel consulta el mismo reembolso y no lo repite.</p>`;
  for (const input of view().querySelectorAll('select,input:not([type=password])')) input.addEventListener(input.id === 'refund-extra' ? 'input' : 'change', schedulePreview);
  $('#refund-review').onclick = reviewRefund;
  schedulePreview();
}
function schedulePreview() {
  clearTimeout(previewTimer); preview = null;
  const seq = ++previewSeq;
  $('#refund-review').disabled = true;
  const body = refundBody();
  if (body.extraCents === null) { $('#refund-status').textContent = 'Escribe el monto adicional como 12.50.'; return; }
  $('#refund-status').textContent = 'Shopify está calculando…';
  previewTimer = setTimeout(async () => {
    try {
      const result = await portal.request(`pedidos/orders/${detail.id}/refund-preview`, { body: { lines: body.lines, refundShipping: body.refundShipping, extraCents: body.extraCents } });
      if (seq !== previewSeq) return;
      preview = { ...result, body };
      $('#refund-total').textContent = usd(result.totalCents);
      $('#refund-max').textContent = `Máximo ${usd(result.maximumCents)}`;
      $('#refund-review').textContent = `Revisar y reembolsar ${usd(result.totalCents)}`;
      $('#refund-status').textContent = result.overLimit ? `Pasa del máximo que se puede devolver (${usd(result.maximumCents)}).` : result.totalCents ? '' : 'Elige qué devolver o escribe un monto.';
      $('#refund-status').classList.toggle('error', !!result.overLimit);
      $('#refund-review').disabled = result.overLimit || result.totalCents <= 0;
    } catch (error) { if (seq === previewSeq) { $('#refund-status').textContent = errorText(error); $('#refund-status').classList.add('error'); } }
  }, 350);
}
function reviewRefund() {
  if (!preview || busy()) return;
  // P05: la revisión solo abre si el cálculo corresponde a lo que el formulario muestra ahora.
  if (JSON.stringify(refundBody()) !== JSON.stringify(preview.body)) { schedulePreview(); return; }
  const { body, totalCents } = preview, order = detail;
  const lines = body.lines.map(line => { const source = order.lines.find(item => item.id === line.lineItemId); return `<li>${line.quantity} × ${esc(lineName(source))}</li>`; }).join('');
  const reason = REFUND_REASONS.find(([value]) => value === body.reason)[1];
  op = null;
  openSheet({ action: 'refund', eyebrow: `Pedido ${order.name} · ${order.customer.name}`, title: 'Revisa el reembolso', confirm: `Reembolsar ${usd(totalCents)}`,
    fields: `<ul class="summary-list">${lines}${body.refundShipping ? '<li>Envío</li>' : ''}${body.extraCents ? `<li>Monto adicional ${usd(body.extraCents)}</li>` : ''}</ul>
      <div class="amount-box"><div>Se devuelve</div><div class="amount">${usd(totalCents)}</div><div class="muted">Motivo: ${esc(reason)}${body.restock ? ' · regresa al stock' : ''}${body.notify ? ' · se avisa a la clienta' : ''}</div></div>${password()}`,
    foot: 'Un reembolso no se puede deshacer. Si la conexión falla, el panel consulta el mismo reembolso y no lo repite.',
    build: () => ({ ...body, expectedTotalCents: totalCents }), needsPassword: true,
    after: async () => goDetail(order.id, `Reembolso de ${usd(totalCents)} registrado.`) });
}

// ---------- Editar ----------
let draft = null, editError = '';
async function showEdit(id) {
  if (!isAdmin()) { location.hash = `pedidos/${id}`; return; }
  view().innerHTML = '<p class="muted" role="status">Cargando pedido…</p>';
  if (!await ensureDetail(id)) return;
  editError = '';
  try { variants = (await portal.request('pedidos/variants')).variants; }
  catch (error) { variants = []; editError = `No pudimos cargar los productos con stock: ${errorText(error)}`; }
  const stock = new Map(variants.map(v => [v.id, v]));
  draft = {
    lines: detail.lines.filter(line => line.quantity > 0).map(line => ({ ...line, target: line.quantity, min: line.quantity - line.unfulfilled, max: line.unfulfilled > 0 ? line.quantity + (line.variantId && stock.get(line.variantId)?.available || 0) : line.quantity })),
    additions: [], notify: true,
  };
  renderEdit();
}
function renderEdit() {
  const order = detail, stock = new Map(variants.map(v => [v.id, v]));
  const choices = variants.filter(v => !draft.additions.some(a => a.variantId === v.id) && !draft.lines.some(line => line.variantId === v.id));
  const stepper = (key, value, min, max, name) => `<div class="stepper" role="group" aria-label="Cantidad de ${esc(name)}"><button type="button" data-step="${key}" data-delta="-1" aria-label="Quitar una" ${value <= min ? 'disabled' : ''}>−</button><span aria-live="polite">${value}</span><button type="button" data-step="${key}" data-delta="1" aria-label="Agregar una" ${value >= max ? 'disabled' : ''}>+</button></div>`;
  view().innerHTML = `<div class="order-top">${back({ aria: 'Volver al pedido', href: `/${order.id}` })}<h2 id="order-title">Editar ${esc(order.name)}</h2></div>
  <p>Cambia sabores o cantidades antes de preparar. Solo se ofrece lo que tiene stock en esta tanda.</p>
  <section class="card"><h3>Productos del pedido</h3>
    ${draft.lines.map((line, index) => `<div class="edit-line"><div><div>${esc(lineName(line))}</div><small>${usd(line.unitCents)} c/u${line.min > 0 ? ` · ${line.min} ya despachada${line.min === 1 ? '' : 's'}` : ''}${line.unfulfilled > 0 && !line.variantId ? ' · sin stock para agregar más' : ''}</small></div>${stepper(`line:${index}`, line.target, line.min, line.max, lineName(line))}</div>`).join('')}
    ${draft.additions.map((add, index) => { const v = stock.get(add.variantId); return `<div class="edit-line"><div><div>${esc(v.productTitle)}${v.title ? ` · ${esc(v.title)}` : ''}</div><small>Agregada · quedan ${v.available} en stock</small></div>${stepper(`add:${index}`, add.quantity, 0, Math.min(v.available, 20), v.productTitle)}</div>`; }).join('')}
    <div id="add-row" hidden><label>Producto con stock<select id="add-variant">${choices.map(v => `<option value="${esc(v.id)}">${esc(v.productTitle)}${v.title ? ` · ${esc(v.title)}` : ''} — ${usd(v.priceCents)} (quedan ${v.available})</option>`).join('')}</select></label><button type="button" id="add-confirm">Agregar</button></div>
    <button type="button" id="add-product" ${choices.length ? '' : 'disabled'}>${choices.length ? 'Agregar producto' : 'No hay otros productos con stock'}</button></section>
  <section class="card" id="edit-summary"></section>
  <label class="check"><input type="checkbox" id="edit-notify" ${draft.notify ? 'checked' : ''}><span>Avisar a la clienta del cambio por correo</span></label>
  <p id="edit-status" role="status" class="${editError ? 'error' : ''}">${esc(editError)}</p>
  <button type="button" class="primary wide" id="edit-review">Guardar cambios del pedido</button>
  <p class="muted">El stock se ajusta solo: la caja que sale vuelve al inventario y la que entra se descuenta.</p>`;
  for (const button of view().querySelectorAll('[data-step]')) button.onclick = () => {
    const [kind, index] = button.dataset.step.split(':'), delta = Number(button.dataset.delta);
    if (kind === 'line') { const line = draft.lines[index]; line.target = Math.min(line.max, Math.max(line.min, line.target + delta)); }
    else { const add = draft.additions[index]; add.quantity += delta; if (add.quantity <= 0) draft.additions.splice(index, 1); }
    renderEdit();
  };
  $('#add-product').onclick = () => { $('#add-row').hidden = false; $('#add-product').hidden = true; $('#add-variant').focus(); };
  if ($('#add-confirm')) $('#add-confirm').onclick = () => { draft.additions.push({ variantId: $('#add-variant').value, quantity: 1 }); renderEdit(); };
  $('#edit-notify').onchange = event => { draft.notify = event.currentTarget.checked; renderEditSummary(); };
  $('#edit-review').onclick = reviewEdit;
  renderEditSummary();
}
function editChanges() {
  const stock = new Map(variants.map(v => [v.id, v]));
  const changes = draft.lines.filter(line => line.target !== line.quantity);
  const delta = changes.reduce((sum, line) => sum + (line.target - line.quantity) * line.unitCents, 0) + draft.additions.reduce((sum, add) => sum + add.quantity * stock.get(add.variantId).priceCents, 0);
  const rows = [...changes.map(line => `${line.target > line.quantity ? '+' : '−'} ${Math.abs(line.target - line.quantity)} ${lineName(line)}`),
    ...draft.additions.map(add => { const v = stock.get(add.variantId); return `+ ${add.quantity} ${v.productTitle}${v.title ? ` · ${v.title}` : ''}`; })];
  return { changes, delta, rows };
}
/** Consecuencia de dinero del cambio. Shopify solo manda el enlace de pago si se avisa a la clienta. */
function editMoneyNote(delta, notify) {
  if (delta > 0) return notify ? `Sube ${usd(delta)}: Shopify le envía a la clienta el enlace para pagar la diferencia.`
    : `Sube ${usd(delta)}: la clienta no recibirá enlace de pago. Quedan ${usd(delta)} por cobrar (en efectivo desde el panel o con una factura desde Shopify).`;
  if (delta < 0) return `Baja ${usd(-delta)}: después puedes reembolsar la diferencia desde «Reembolsar».`;
  return 'El total no cambia.';
}
function renderEditSummary() {
  const { delta, rows } = editChanges(), total = detail.totalCents + delta;
  $('#edit-summary').innerHTML = `<h3>Resumen del cambio</h3>${rows.length ? rows.map(row => `<div class="summary-line">${esc(row)}</div>`).join('') : '<p class="muted">Todavía no hay cambios.</p>'}
    <div class="order-row order-total"><span>Nuevo total</span><strong>${usd(total)}${delta === 0 ? ' (sin cambio)' : ''}</strong></div>
    ${rows.length ? `<p class="${delta > 0 && !draft.notify ? 'notice notice-due' : 'muted'}" id="edit-money">${esc(editMoneyNote(delta, draft.notify))}</p>` : ''}`;
  $('#edit-review').disabled = !rows.length;
}
function reviewEdit() {
  if (busy()) return;
  const { changes, delta, rows } = editChanges();
  if (!rows.length) return;
  const body = { changes: changes.map(line => ({ lineItemId: line.id, variantId: line.variantId, fromQuantity: line.quantity, quantity: line.target })), additions: draft.additions.map(add => ({ variantId: add.variantId, quantity: add.quantity })), notify: draft.notify };
  const order = detail;
  openSheet({ action: 'edit', eyebrow: `Pedido ${order.name} · ${order.customer.name}`, title: 'Revisa el cambio del pedido', confirm: 'Guardar cambios del pedido',
    fields: `<ul class="summary-list">${rows.map(row => `<li>${esc(row)}</li>`).join('')}</ul><div class="amount-box"><div>Nuevo total</div><div class="amount">${usd(order.totalCents + delta)}</div><div class="muted">${esc(editMoneyNote(delta, body.notify))}${body.notify ? ' Se avisa a la clienta.' : ' No se avisa a la clienta.'}</div></div>${password()}`,
    build: () => body, needsPassword: true,
    after: async () => goDetail(order.id, delta < 0 ? `Pedido editado. Si corresponde, reembolsa ${usd(-delta)} desde «Reembolsar».`
      : delta > 0 && !body.notify ? `Pedido editado. Quedan ${usd(delta)} por cobrar: la clienta no recibió enlace de pago.` : 'Pedido editado.') });
}

// ---------- Navegación ----------
async function show() {
  if (!canSee() || !view()) return;
  if (busy()) return;
  clearTimeout(previewTimer); previewSeq++; preview = null;
  if (sheet()?.open) sheet().close();
  portal.hideViews(); view().hidden = false; portal.current?.('pedidos');
  $('#feedback').textContent = '';
  const match = /^#pedidos\/(\d{1,20})(?:\/(editar|reembolsar))?$/.exec(location.hash);
  if (!match) return showList(true);
  if (match[2] === 'reembolsar') return showRefund(match[1]);
  if (match[2] === 'editar') return showEdit(match[1]);
  detail = null;
  const notice = nextNotice; nextNotice = '';
  return showDetail(match[1], notice);
}
if (portal?.mode && view()) {
  window.inventarioOrders = { show };
  $('#pedidos').addEventListener('click', () => { if (busy()) return; if (location.hash === '#pedidos') show(); else location.hash = 'pedidos'; });
  addEventListener('hashchange', () => { if (location.hash.startsWith('#pedidos') && canSee()) show(); });
  sheet().addEventListener('cancel', event => { if (busy()) event.preventDefault(); });
  // Escape está bloqueado mientras no hay confirmación; solo un cierre forzado (sesión vencida) llega aquí.
  // Al cerrar un resultado definitivo se vuelve a leer el pedido (solo lectura) para mostrar su estado real.
  sheet().addEventListener('close', () => {
    // Un lote en curso que se cierra a la fuerza (salir o sesión vencida) queda anulado: no envía los pedidos restantes.
    if (bulk?.sending) { bulkRun++; bulk = null; bulkDone = false; return; }
    const reread = op?.final ? (op.fromList ? 'list' : detail) : null;
    if (op && !op.sending) op = null;
    if (bulkDone || reread === 'list') { bulkDone = false; list = null; showList(true); }
    else if (reread) showDetail(detail.id);
  });
  // La lista se esconde si se abre otra sección; la sesión vencida la maneja staff-ui.
  for (const id of ['home', 'categories', 'history', 'users', 'celebraciones']) $(`#${id}`)?.addEventListener('click', () => { if (!busy()) view().hidden = true; });
  if (location.hash.startsWith('#pedidos') && canSee()) show();
}
