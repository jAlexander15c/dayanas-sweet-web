// Cobros: cotizaciones y cobros por un monto libre, desde el portal (solo la administradora).
// Cada envío o anulación lleva un operationId y la contraseña. Si no hay confirmación, solo
// se puede «Reintentar» con la misma clave: el servidor busca ese mismo cobro y no lo repite.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = cents => `$${(cents / 100).toFixed(2)}`;
const portal = window.inventarioPortal;
const UNCONFIRMED = 'No pudimos confirmar si se envió. Toca «Reintentar»: el panel revisa este mismo cobro y no lo repite.';
// Rechazos que garantizan que Shopify no recibió nada: se corrige y el próximo intento usa una clave nueva.
const NOT_APPLIED = new Set(['VALIDATION', 'ROLE_REQUIRED', 'STEP_UP_REQUIRED', 'NOT_FOUND', 'OPERATION_REUSED', 'CHARGE_PAID', 'SHOPIFY_REJECTED']);
const KIND = { cobro: 'Cobro', cotizacion: 'Cotización' };
const TABS = { abiertos: 'Abiertos', pagados: 'Pagados', cerrados: 'Vencidos y anulados' };
const MAX_LINES = 10;

let data = null, tab = 'abiertos', draft = null, op = null, generation = 0;
const view = () => $('#cobros-view');
const sheet = () => $('#cobros-sheet');
const isAdmin = () => (portal?.user?.()?.roles || []).includes('admin');
// Mientras se envía o queda sin confirmar, no se navega: la misma clave tiene que poder reintentarse.
const busy = () => !!op && (op.sending || op.unconfirmed);
const day = value => { try { return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)); } catch { return value; } };
const when = value => { try { return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'America/Chicago' }).format(new Date(value)); } catch { return ''; } };
const addDays = (value, n) => new Date(Date.parse(`${value}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** "75", "75.5", "75,50" o "$75.00" → centavos; null si no es un monto. */
export function parseCents(text) {
  const clean = String(text ?? '').replace(/[$\s]/g, '').replace(',', '.');
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
const statusBadge = charge => charge.status === 'pagado' ? '<span class="badge badge-paid">Pagado</span>'
  : charge.status === 'vencido' ? '<span class="badge badge-refund">Vencida</span>'
  : charge.status === 'anulado' ? '<span class="badge badge-refund">Anulado</span>'
  : `<span class="badge ${charge.kind === 'cotizacion' ? 'badge-due' : 'badge-pickup'}">${KIND[charge.kind]}</span>`;

// ---------- Lista ----------
function cards() {
  const charges = data?.charges || [];
  const groups = {
    abiertos: charges.filter(charge => charge.status === 'abierto' || charge.status === 'enviado'),
    pagados: charges.filter(charge => charge.status === 'pagado'),
    cerrados: [...charges.filter(charge => charge.status === 'vencido'), ...(data?.closed || [])],
  };
  const tabs = `<div class="order-tabs cobros-tabs" role="group" aria-label="Filtrar cobros">${Object.entries(TABS).map(([key, label]) =>
    `<button type="button" class="order-tab" data-tab="${key}" aria-pressed="${tab === key}">${label}${groups[key].length ? ` (${groups[key].length})` : ''}</button>`).join('')}</div>`;
  const shown = groups[tab];
  const empty = { abiertos: 'No hay cobros esperando pago.', pagados: 'Todavía no hay cobros pagados.', cerrados: 'No hay cobros vencidos ni anulados.' }[tab];
  const body = shown.length ? `<div class="order-cards">${shown.map(charge => {
    const note = charge.status === 'pagado' ? `Pagado${charge.orderId ? ` · <a href="#pedidos/${esc(charge.orderId)}">Ver pedido ${esc(charge.orderName || '')}</a>` : ''}`
      : charge.status === 'anulado' ? `Anulado el ${esc(when(charge.at))}`
      : charge.status === 'vencido' ? `Venció el ${esc(day(charge.expiresOn || ''))}`
      : charge.expiresOn ? `Vence el ${esc(day(charge.expiresOn))}` : `Enviado el ${esc(when(charge.createdAt))}`;
    const actions = charge.status === 'abierto' || charge.status === 'enviado'
      ? `<div class="actions"><button type="button" data-copy="${esc(charge.id)}">Copiar enlace</button><button type="button" data-void="${esc(charge.id)}">Anular</button></div>` : '';
    return `<article class="order-card cobro-card"><div class="order-card-head"><strong>${esc(charge.name || KIND[charge.kind])}</strong>${statusBadge(charge)}</div>
      <div class="cobro-amount">${usd(charge.totalCents)}</div><p class="muted">${esc(charge.concept)} · ${note}</p>${actions}</article>`;
  }).join('')}</div>` : `<p class="muted">${empty}</p>`;
  const more = data?.complete === false ? '<p class="notice">Se muestran los 50 cobros más recientes. Los anteriores siguen en Shopify, en Pedidos › Borradores.</p>' : '';
  return tabs + more + body;
}
function renderList(notice = '') {
  view().innerHTML = `<div class="cobros-head"><div class="orders-head"><p class="eyebrow">Pastelería</p><h2 class="orders-title">Cobros</h2></div><button type="button" class="primary" id="cobro-new">Nuevo cobro</button></div>
    ${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ''}<div id="cobros-list">${data ? cards() : '<p class="muted" role="status">Cargando cobros…</p>'}</div>`;
  $('#cobro-new').onclick = () => { location.hash = 'cobros/nuevo'; };
  bindList();
}
function bindList() {
  for (const button of view().querySelectorAll('[data-tab]')) button.onclick = () => { tab = button.dataset.tab; $('#cobros-list').innerHTML = cards(); bindList(); };
  for (const button of view().querySelectorAll('[data-copy]')) button.onclick = () => copyLink(data.charges.find(charge => charge.id === button.dataset.copy)?.invoiceUrl, button);
  for (const button of view().querySelectorAll('[data-void]')) button.onclick = () => confirmVoid(data.charges.find(charge => charge.id === button.dataset.void));
}
async function loadList(notice = '') {
  const run = ++generation;
  renderList(notice);
  try {
    const result = await portal.request('pedidos/charges');
    if (run !== generation || !$('#cobros-list')) return;
    data = result; $('#cobros-list').innerHTML = cards(); bindList();
  } catch (error) {
    if (run !== generation || !$('#cobros-list')) return;
    $('#cobros-list').innerHTML = `<p class="error" role="alert">${esc(error.message)}</p><button type="button" id="cobros-retry">Volver a cargar</button>`;
    $('#cobros-retry').onclick = () => loadList();
  }
}
async function copyLink(url, button) {
  if (!url) return;
  const done = text => { const old = button.textContent; button.textContent = text; setTimeout(() => { button.textContent = old; }, 2500); };
  try { await navigator.clipboard.writeText(url); done('Enlace copiado'); }
  catch {
    const field = button.closest('.cobro-done, .cobro-card')?.querySelector('.cobro-url') || null;
    if (field) { field.hidden = false; field.select(); done('Selecciona y copia'); }
    else { button.insertAdjacentHTML('afterend', `<input class="cobro-url" readonly value="${esc(url)}" aria-label="Enlace de pago">`); button.nextElementSibling.select(); done('Selecciona y copia'); }
  }
}

// ---------- Nuevo cobro ----------
function newDraft() {
  const today = data?.today || new Date().toISOString().slice(0, 10);
  return { kind: 'cobro', name: '', email: '', lines: [{ title: '', amount: '' }], expiresOn: addDays(today, 7), message: '', today };
}
function totalCents() { return draft.lines.reduce((sum, line) => sum + (parseCents(line.amount) || 0), 0); }
function renderForm(error = '') {
  const isQuote = draft.kind === 'cotizacion';
  view().innerHTML = `<div class="order-top"><a class="order-back" href="#cobros" aria-label="Volver a Cobros"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></a><h2>Nuevo cobro</h2></div>
    <form id="cobro-form" class="card cobro-form" novalidate>
      <div class="order-tabs" role="group" aria-label="Tipo"><button type="button" class="order-tab" data-kind="cobro" aria-pressed="${!isQuote}">Cobro</button><button type="button" class="order-tab" data-kind="cotizacion" aria-pressed="${isQuote}">Cotización</button></div>
      <p class="muted">${isQuote ? 'La clienta acepta pagando. Al vencer, el enlace deja de servir.' : 'El enlace de pago no vence. Puedes anularlo cuando quieras.'}</p>
      <label>Nombre de la clienta<input id="cobro-name" maxlength="80" autocomplete="off" value="${esc(draft.name)}"></label>
      <label>Correo<input id="cobro-email" type="email" inputmode="email" maxlength="254" autocomplete="off" value="${esc(draft.email)}"></label>
      <fieldset class="cobro-lines"><legend>Conceptos</legend>${draft.lines.map((line, index) => `<div class="cobro-line">
        <label>Concepto<input data-line="${index}" data-field="title" maxlength="80" value="${esc(line.title)}" placeholder="Torta 30 personas"></label>
        <label>Monto (USD)<input data-line="${index}" data-field="amount" inputmode="decimal" maxlength="10" value="${esc(line.amount)}" placeholder="75.00"></label>
        <button type="button" data-remove="${index}" aria-label="Quitar ${esc(line.title || `línea ${index + 1}`)}" ${draft.lines.length === 1 ? 'disabled' : ''}>×</button></div>`).join('')}
        ${draft.lines.length < MAX_LINES ? '<button type="button" class="text-button" id="cobro-add">+ Agregar línea</button>' : ''}</fieldset>
      <p class="order-row order-total cobro-total"><span>Total</span><span id="cobro-total">${usd(totalCents())}</span></p>
      ${isQuote ? `<label>Válida hasta<input id="cobro-expires" type="date" min="${addDays(draft.today, 1)}" max="${addDays(draft.today, 60)}" value="${esc(draft.expiresOn)}"></label>` : ''}
      <label>Mensaje para la clienta <small>(opcional)</small><textarea id="cobro-message" maxlength="500">${esc(draft.message)}</textarea></label>
      <p id="cobro-error" role="alert">${esc(error)}</p>
      <button type="submit" class="primary wide">Revisar y enviar</button>
    </form>`;
  for (const button of view().querySelectorAll('[data-kind]')) button.onclick = () => { draft.kind = button.dataset.kind; renderForm(); };
  $('#cobro-name').oninput = event => { draft.name = event.currentTarget.value; };
  $('#cobro-email').oninput = event => { draft.email = event.currentTarget.value; };
  $('#cobro-message').oninput = event => { draft.message = event.currentTarget.value; };
  if ($('#cobro-expires')) $('#cobro-expires').onchange = event => { draft.expiresOn = event.currentTarget.value; };
  for (const input of view().querySelectorAll('[data-line]')) input.oninput = () => { draft.lines[Number(input.dataset.line)][input.dataset.field] = input.value; $('#cobro-total').textContent = usd(totalCents()); };
  for (const button of view().querySelectorAll('[data-remove]')) button.onclick = () => { draft.lines.splice(Number(button.dataset.remove), 1); renderForm(); };
  if ($('#cobro-add')) $('#cobro-add').onclick = () => { draft.lines.push({ title: '', amount: '' }); renderForm(); view().querySelector(`[data-line="${draft.lines.length - 1}"][data-field="title"]`)?.focus(); };
  $('#cobro-form').onsubmit = event => { event.preventDefault(); review(); };
}
/** Arma el envío o explica qué falta, sin llamar al servidor. */
function body() {
  const name = draft.name.trim(), email = draft.email.trim();
  if (!name) throw new Error('Escribe el nombre de la clienta.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Escribe un correo válido.');
  const lines = draft.lines.filter(line => line.title.trim() || String(line.amount).trim()).map(line => {
    if (!line.title.trim()) throw new Error('Cada monto necesita su concepto.');
    const cents = parseCents(line.amount);
    if (cents === null || cents < 100 || cents > 500_000) throw new Error(`El monto de «${line.title.trim()}» debe ir de $1.00 a $5,000.00.`);
    return { title: line.title.trim(), cents };
  });
  if (!lines.length) throw new Error('Agrega al menos un concepto con su monto.');
  if (draft.kind === 'cotizacion' && !draft.expiresOn) throw new Error('Elige hasta qué día vale la cotización.');
  return { kind: draft.kind, name, email, lines, ...(draft.kind === 'cotizacion' ? { expiresOn: draft.expiresOn } : {}), ...(draft.message.trim() ? { message: draft.message.trim() } : {}) };
}
function review() {
  let payload;
  try { payload = body(); } catch (error) { $('#cobro-error').textContent = error.message; return; }
  const total = payload.lines.reduce((sum, line) => sum + line.cents, 0), isQuote = payload.kind === 'cotizacion';
  openSheet({
    title: `Revisa ${isQuote ? 'la cotización' : 'el cobro'}`, confirm: `Enviar ${isQuote ? 'cotización' : 'cobro'} ${usd(total)}`,
    fields: `<div class="cobro-summary">${payload.lines.map(line => `<p class="order-row"><span>${esc(line.title)}</span><span>${usd(line.cents)}</span></p>`).join('')}
      <p class="order-row order-total"><span>Total</span><span>${usd(total)}</span></p></div>
      <p>Shopify le envía a <strong>${esc(payload.email)}</strong> el correo con el botón para pagar.${isQuote ? ` Vence el ${esc(day(payload.expiresOn))}: después el enlace ya no sirve.` : ' El enlace no vence.'}</p>`,
    action: 'charges/create', payload,
    after: result => showDone(result.charge, payload, result.email),
  });
}
function showDone(charge, payload, email = 'sent') {
  draft = null; data = null;
  const label = charge.kind === 'cotizacion' ? 'Cotización enviada' : 'Cobro enviado';
  view().innerHTML = `<div class="card cobro-done"><p class="eyebrow">${esc(KIND[charge.kind])} · ${usd(charge.totalCents)}</p><h2 tabindex="-1" id="cobro-done-title">${label}</h2>
    ${email === 'sent' ? `<p>Le llegó a <strong>${esc(payload.email)}</strong>. También puedes mandarle el enlace por WhatsApp:</p>`
      : `<p class="notice notice-due">No pudimos confirmar que el correo salió hacia <strong>${esc(payload.email)}</strong>. El cobro sí quedó creado: mándale este enlace por WhatsApp.</p>`}
    ${charge.invoiceUrl ? `<input class="cobro-url" readonly value="${esc(charge.invoiceUrl)}" aria-label="Enlace de pago"><button type="button" class="primary" id="cobro-copy">Copiar enlace</button>` : ''}
    <p class="notice">Cuando pague, aparece en Pedidos con la etiqueta «${esc(KIND[charge.kind])}» y aquí pasa a «Pagados».</p>
    <a class="action-link" href="#cobros">Volver a Cobros</a></div>`;
  if ($('#cobro-copy')) $('#cobro-copy').onclick = event => copyLink(charge.invoiceUrl, event.currentTarget);
  $('#cobro-done-title').focus();
}

// ---------- Anular ----------
function confirmVoid(charge) {
  if (!charge) return;
  openSheet({
    title: `Anular ${charge.kind === 'cotizacion' ? 'la cotización' : 'el cobro'}`, confirm: 'Anular', danger: true,
    fields: `<p><strong>${esc(charge.name)}</strong> · ${usd(charge.totalCents)}</p><p>El enlace de pago deja de servir. Si la clienta ya pagó, no se anula: queda como pedido.</p>`,
    action: `charges/${charge.id}/void`, payload: {},
    after: () => { data = null; loadList('Cobro anulado.'); },
  });
}

// ---------- Hoja de confirmación (contraseña, envío y reintento con la misma clave) ----------
function openSheet({ title, confirm, fields, action, payload, after, danger = false }) {
  const dialog = sheet();
  op = { action, body: payload, operationId: crypto.randomUUID(), sending: false, final: false, after };
  dialog.innerHTML = `<form id="cobros-sheet-form" novalidate><div class="sheet-head"><p class="eyebrow">Cobros</p><h2 id="cobros-sheet-title" class="${danger ? 'danger-title' : ''}">${esc(title)}</h2></div>
    ${fields}<label>Tu contraseña<input type="password" id="cobros-password" autocomplete="current-password" maxlength="256" required><small>Se pide en cada envío o anulación.</small></label>
    <p id="cobros-sheet-error" role="alert"></p>
    <div class="actions"><button type="button" id="cobros-sheet-back">Volver</button><button type="submit" id="cobros-sheet-confirm" class="${danger ? 'danger danger-fill' : 'primary'}">${esc(confirm)}</button></div></form>`;
  $('#cobros-sheet-back').onclick = () => { if (!busy()) dialog.close(); };
  $('#cobros-sheet-form').onsubmit = event => { event.preventDefault(); send(); };
  dialog.showModal();
  $('#cobros-password').focus();
}
async function send() {
  if (!op || op.sending || op.final) return;
  const password = $('#cobros-password')?.value || '';
  const error = $('#cobros-sheet-error'), confirmButton = $('#cobros-sheet-confirm'), backButton = $('#cobros-sheet-back');
  if (!password) { error.textContent = 'Escribe tu contraseña para confirmar.'; return; }
  op.sending = true; confirmButton.disabled = true; backButton.disabled = true; error.textContent = '';
  for (const input of sheet().querySelectorAll('input')) input.readOnly = true;
  const current = op;
  try {
    const result = await portal.request(`pedidos/${current.action}`, { body: { ...current.body, operationId: current.operationId }, password });
    if (op !== current) return;
    if (result?.state === 'processing') { current.sending = false; pending(result.message || UNCONFIRMED); return; }
    op = null; sheet().close();
    await current.after(result);
  } catch (failure) {
    if (op !== current) return;
    current.sending = false;
    const result = failure.result || {};
    if (failure.code === 'PASSWORD_INVALID' || failure.code === 'PASSWORD_REQUIRED') {
      // Rechazada antes de llegar a Shopify: misma clave, solo se corrige la contraseña.
      error.textContent = failure.message; confirmButton.disabled = false; backButton.disabled = false;
      $('#cobros-password').readOnly = false; $('#cobros-password').value = ''; $('#cobros-password').focus();
    } else if (failure.status && (result.final === true || (failure.status < 500 && NOT_APPLIED.has(failure.code)))) {
      // Resultado definitivo (también un 5xx marcado final, o tras un «Reintentar»): ya no hay nada pendiente.
      // Se libera la navegación y queda «Cerrar»; un próximo intento usa una clave nueva.
      current.final = true; current.unconfirmed = false; error.textContent = failure.message;
      backButton.hidden = false; backButton.disabled = false; backButton.textContent = 'Cerrar'; confirmButton.hidden = true;
    } else {
      pending(result.state === 'uncertain' ? failure.message : UNCONFIRMED);
    }
  }
}
/** Sin confirmación: el único paso posible es «Reintentar» con la misma clave. */
function pending(message) {
  op.unconfirmed = true;
  const confirmButton = $('#cobros-sheet-confirm'), backButton = $('#cobros-sheet-back');
  $('#cobros-sheet-error').textContent = message;
  confirmButton.textContent = 'Reintentar'; confirmButton.disabled = false; backButton.hidden = true;
  $('#cobros-password').readOnly = false;
}

// ---------- Navegación ----------
function show() {
  if (busy()) return;
  if (!isAdmin()) { location.hash = ''; return; }
  if (sheet()?.open) sheet().close();
  portal.hideViews(); view().hidden = false; portal.current?.('cobros');
  $('#feedback').textContent = '';
  if (location.hash === '#cobros/nuevo') {
    generation++; // una lista que siga cargando ya no pinta sobre el formulario
    if (!draft) draft = newDraft();
    if (!data) portal.request('pedidos/charges').then(result => { data = result; if (draft && draft.today !== result.today) { draft.today = result.today; draft.expiresOn = addDays(result.today, 7); if (location.hash === '#cobros/nuevo' && !view().hidden) renderForm(); } }).catch(() => {});
    return renderForm();
  }
  draft = null;
  return loadList();
}
if (portal?.mode && view()) {
  window.inventarioCobros = { show };
  $('#cobros').addEventListener('click', () => { if (busy()) return; if (location.hash === '#cobros') show(); else location.hash = 'cobros'; });
  addEventListener('hashchange', () => { if (location.hash.startsWith('#cobros')) show(); });
  sheet().addEventListener('cancel', event => { if (busy()) event.preventDefault(); });
  sheet().addEventListener('close', () => { if (op && !op.sending) op = null; });
  for (const id of ['home', 'categories', 'history', 'users', 'celebraciones', 'pedidos', 'hoy']) $(`#${id}`)?.addEventListener('click', () => { if (!busy()) view().hidden = true; });
  if (location.hash.startsWith('#cobros') && isAdmin()) show();
}
