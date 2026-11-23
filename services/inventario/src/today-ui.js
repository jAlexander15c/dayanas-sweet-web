// Hoy: lo del día en una pantalla, solo lectura. Usa los mismos endpoints que Pedidos y Celebraciones
// (window.inventarioPortal.request) y muestra solo lo que permite el rol. No escribe nada.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = cents => `$${(cents / 100).toFixed(2)}`;
const portal = window.inventarioPortal;
const view = () => $('#today-view');
const roles = () => portal?.user?.()?.roles || [];
const houston = options => new Intl.DateTimeFormat('es-US', { timeZone: 'America/Chicago', ...options });
const clock = () => houston({ hour: 'numeric', minute: '2-digit' }).format(new Date());
const WEEK = 7 * 86400000;
let generation = 0;

const blocks = {
  pedidos: {
    title: 'Pedidos de la tienda',
    visible: r => r.includes('inventario') || r.includes('admin'),
    async load() { return portal.request('pedidos/orders'); },
    render(list) {
      const active = list.orders.filter(order => order.stage !== 'entregado');
      const pickupReady = active.filter(order => order.stage === 'listo' && order.delivery === 'pickup').length;
      const due = active.filter(order => order.outstandingCents > 0);
      const bake = list.bake.products.slice(0, 3);
      return `<div class="today-stats">
        <a class="today-stat" href="#pedidos"><strong>${list.counts.preparar}</strong><span>por preparar</span></a>
        <a class="today-stat" href="#pedidos"><strong>${pickupReady}</strong><span>listos para retirar</span></a>
      </div>
      ${due.length ? `<p class="today-alert">${due.length} ${due.length === 1 ? 'pedido activo con' : 'pedidos activos con'} cobro pendiente (${usd(due.reduce((sum, order) => sum + order.outstandingCents, 0))}).</p>` : ''}
      <h4>Para hornear</h4>
      ${bake.length ? `<ul class="today-bake">${bake.map(item => `<li><strong>${esc(item.quantity)}</strong> ${esc(item.title)}</li>`).join('')}</ul>` : '<p class="muted">No hay nada pendiente por hornear.</p>'}
      ${list.complete ? '' : '<p class="muted">Hay más pedidos de los que el panel muestra; los más antiguos están en Shopify.</p>'}`;
    },
  },
  celebraciones: {
    title: 'Celebraciones',
    visible: r => r.includes('celebraciones'),
    async load() {
      const get = path => portal.request(`celebraciones/${path}`, { method: 'GET', body: null });
      const [alerts, page] = await Promise.all([get('staff-alerts'), get('requests')]);
      return { alerts, page };
    },
    render({ alerts, page }) {
      const requests = Array.isArray(page.requests) ? page.requests : [];
      const toAnswer = requests.filter(request => request.status === 'requested' && !request.pendingProposal).length;
      const now = Date.now();
      const soon = requests
        .map(request => ({ request, at: Date.parse(request.details?.pickupAt) }))
        .filter(({ request, at }) => ['reserved', 'preparing', 'ready'].includes(request.status) && Number.isFinite(at) && at >= now - 86400000 && at <= now + WEEK)
        .sort((a, b) => a.at - b.at).slice(0, 5);
      const when = at => houston({ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(at));
      return `<div class="today-stats">
        <a class="today-stat" href="#celebraciones"><strong>${Number.isSafeInteger(alerts.unread) ? alerts.unread : 0}</strong><span>avisos sin leer</span></a>
        <a class="today-stat" href="#celebraciones"><strong>${toAnswer}</strong><span>por responder</span></a>
      </div>
      <h4>Recogidas de los próximos 7 días</h4>
      ${soon.length ? `<ul class="today-list">${soon.map(({ request, at }) => `<li><a href="#celebraciones/${esc(request.id)}"><span>${esc(request.contact?.name || request.reference || 'Solicitud')}</span><span class="muted">${esc(when(at))}</span></a></li>`).join('')}</ul>` : '<p class="muted">No hay recogidas confirmadas esta semana.</p>'}
      ${page.nextCursor ? '<p class="muted">Se revisaron las 50 solicitudes más recientes.</p>' : ''}`;
    },
  },
  productos: {
    title: 'Productos',
    visible: r => r.includes('inventario'),
    async load() { return null; },
    render() {
      return '<p class="muted">Registra lo que horneaste para que la tienda muestre lo disponible.</p><button type="button" class="primary" data-today-products>Ir a Productos</button>';
    },
  },
};

async function fill(key, run) {
  const card = $(`#today-${key}`); if (!card) return;
  const body = card.querySelector('.today-body'), foot = card.querySelector('.today-foot');
  body.innerHTML = '<p class="muted">Cargando…</p>'; foot.replaceChildren();
  try {
    const data = await blocks[key].load();
    if (run !== generation || view().hidden) return;
    body.innerHTML = blocks[key].render(data);
    if (key !== 'productos') foot.innerHTML = `<span class="muted">Actualizado ${esc(clock())}</span>`;
  } catch (error) {
    if (run !== generation || view().hidden) return;
    body.innerHTML = `<p class="error" role="alert">${esc(error?.message || 'No pudimos cargar esta parte.')}</p>`;
    foot.innerHTML = '<button type="button" data-today-retry>Reintentar</button>';
    foot.querySelector('[data-today-retry]').onclick = () => fill(key, generation);
  }
  const products = body.querySelector('[data-today-products]');
  if (products) products.onclick = () => $('#home')?.click();
}

// keepFeedback: al entrar, «Hoy» se abre solo y conserva un error del arranque (por ejemplo, «Conecta el acceso externo»);
// los avisos informativos de Productos no se muestran sobre «Hoy».
function show({ keepFeedback = false } = {}) {
  if (!portal?.mode || !view() || !portal.user?.()) return;
  const r = roles(), keys = Object.keys(blocks).filter(key => blocks[key].visible(r));
  portal.hideViews(); view().hidden = false; if (!keepFeedback || !$('#feedback').classList.contains('error')) $('#feedback').textContent = '';
  portal.current?.('hoy');
  const run = ++generation;
  const today = houston({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  view().innerHTML = `<div class="today-head"><div><p class="eyebrow">${esc(today)}</p><h2 id="today-title" class="today-title">Hoy</h2></div><button type="button" id="today-refresh">Actualizar</button></div>
    <div class="today-grid">${keys.map(key => `<section class="card today-card" id="today-${key}" aria-labelledby="today-${key}-title"><h3 id="today-${key}-title">${blocks[key].title}</h3><div class="today-body"></div><div class="today-foot"></div></section>`).join('')}</div>
    ${keys.length ? '' : '<p class="muted">Tu usuario no tiene secciones con resumen diario.</p>'}`;
  $('#today-refresh').onclick = () => show();
  for (const key of keys) void fill(key, run);
}

if (portal?.mode && view()) {
  window.inventarioToday = { show };
  $('#hoy').addEventListener('click', () => { if (location.hash === '#hoy') show(); else location.hash = 'hoy'; });
  addEventListener('hashchange', () => { if (location.hash === '#hoy') show(); });
  if (location.hash === '#hoy' && portal.user?.()) show();
}
