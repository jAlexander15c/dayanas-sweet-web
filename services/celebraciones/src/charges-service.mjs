// Cobros del panel: cotizaciones y cobros directos por un monto libre.
// Cada cobro es un pedido borrador de Shopify con líneas personalizadas (sin stock, sin envío)
// y su factura (draftOrderInvoiceSend), que es el correo con el botón para pagar. Al pagarlo,
// Shopify lo convierte en un pedido normal. Nunca se usa draftOrderComplete.
//
// Idempotencia (crear): el borrador lleva la etiqueta ds-operation:<id>. En cuanto Shopify devuelve
// su ID, queda guardado y todo reintento lo lee por ID: nunca se crea otro. Si la creación quedó sin
// respuesta, el reintento la busca (por etiqueta y en la lectura de los borradores más nuevos) pero
// NUNCA vuelve a crear: que el borrador no aparezca ahora no prueba que no se haya creado (pudo
// anularse o vencer). Pasado CREATE_SETTLE_MS sin encontrarlo, la operación se cierra como «sin
// confirmar» y la administradora decide, mirando la lista, si crea uno nuevo (con otra clave).
// La factura (el correo) se envía una sola vez: la intención queda guardada antes de llamar a
// Shopify y un reintento nunca la repite. Si no se pudo confirmar, el cobro igual existe y la
// pantalla pide mandar el enlace por WhatsApp.
// Privacidad: el nombre y el correo solo viajan a Shopify. El recibo guardado no los lleva; una
// repetición los vuelve a leer de Shopify.
import { cents, decimal, orderError } from './orders-shopify.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const EMAIL = /^[^\s@<>()[\],;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const CHARGE_LIMITS = Object.freeze({ lines: 10, minCents: 100, maxCents: 500_000, maxDays: 60, title: 80, name: 80, message: 500 });
// Tras un intento de creación sin respuesta, el borrador puede tardar en verse: durante este plazo
// un reintento espera (202). Después, si sigue sin aparecer, la operación se cierra sin confirmar.
export const CREATE_SETTLE_MS = 5 * 60_000;
// El cron recorre como mucho estas páginas de 50 cobros por hora y sigue donde quedó en la próxima.
const EXPIRE_PAGES = 40;
const KINDS = { cobro: 'Cobro', cotizacion: 'Cotización' };

const bad = message => orderError(422, 'VALIDATION', message);
const usd = value => `$${(value / 100).toFixed(2)}`;
const numeric = gid => String(gid || '').split('/').pop();
const draftGid = id => `gid://shopify/DraftOrder/${numeric(id)}`;
const tagValue = (tags, prefix) => (tags || []).find(tag => tag.startsWith(prefix))?.slice(prefix.length) ?? null;

/** Fecha local (YYYY-MM-DD) de la tienda, en Houston. */
export function localDay(at, timeZone = 'America/Chicago') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}
const dayNumber = day => { const [, y, m, d] = DAY.exec(day); return Date.UTC(Number(y), Number(m) - 1, Number(d)) / 86_400_000; };
const validDay = day => { const match = DAY.exec(day || ''); if (!match) return false; const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))); return date.toISOString().slice(0, 10) === day; };
const longDay = day => new Intl.DateTimeFormat('es-US', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`));

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const text = (value, max, label) => {
  if (typeof value !== 'string') throw bad(`Falta ${label}.`);
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) throw bad(`Falta ${label}.`);
  if (clean.length > max) throw bad(`${label[0].toUpperCase()}${label.slice(1)} es demasiado largo (máximo ${max} caracteres).`);
  return clean;
};

/** El vencimiento de una cotización va de mañana a CHARGE_LIMITS.maxDays días, contado desde `today`. */
export function checkExpiry(params, today) {
  if (params.kind !== 'cotizacion') return;
  const days = dayNumber(params.expiresOn) - dayNumber(today);
  if (days < 1 || days > CHARGE_LIMITS.maxDays) throw bad(`La cotización vale desde mañana hasta ${CHARGE_LIMITS.maxDays} días.`);
}

/** Valida la forma del cobro. Con `today`, también el rango del vencimiento (solo para una operación nueva). */
export function validateCharge(body, today = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Datos inválidos.');
  if (!Object.hasOwn(KINDS, body.kind)) throw bad('Elige si es un cobro o una cotización.');
  const name = text(body.name, CHARGE_LIMITS.name, 'el nombre de la clienta');
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL.test(email)) throw bad('Escribe un correo válido.');
  if (!Array.isArray(body.lines) || !body.lines.length) throw bad('Agrega al menos una línea con concepto y monto.');
  if (body.lines.length > CHARGE_LIMITS.lines) throw bad(`Máximo ${CHARGE_LIMITS.lines} líneas.`);
  const lines = body.lines.map(line => {
    const title = text(line?.title, CHARGE_LIMITS.title, 'el concepto');
    if (!Number.isSafeInteger(line?.cents) || line.cents < CHARGE_LIMITS.minCents || line.cents > CHARGE_LIMITS.maxCents) throw bad(`Cada monto va de ${usd(CHARGE_LIMITS.minCents)} a ${usd(CHARGE_LIMITS.maxCents)}.`);
    return { title, cents: line.cents };
  });
  let expiresOn = null;
  if (body.kind === 'cotizacion') {
    if (!validDay(body.expiresOn)) throw bad('Elige hasta qué día vale la cotización.');
    expiresOn = body.expiresOn;
  } else if (body.expiresOn != null) throw bad('Un cobro directo no vence.');
  let message = '';
  if (body.message != null) {
    if (typeof body.message !== 'string') throw bad('Mensaje inválido.');
    message = body.message.trim();
    if (message.length > CHARGE_LIMITS.message) throw bad(`El mensaje es demasiado largo (máximo ${CHARGE_LIMITS.message} caracteres).`);
  }
  const params = { kind: body.kind, name, email, lines, expiresOn, message, totalCents: lines.reduce((sum, line) => sum + line.cents, 0) };
  if (today) checkExpiry(params, today);
  return params;
}

export function createChargesService({ client, store, now = () => Date.now(), timeZone = 'America/Chicago' }) {
  if (!client || !store) throw orderError(503, 'UNAVAILABLE', 'Cobros no está configurado.');
  let tail = Promise.resolve();
  const serial = fn => { const run = tail.then(fn, fn); tail = run.catch(() => {}); return run; };
  const failure = error => {
    if (error?.uncertain) return { status: 502, body: { code: 'REVIEW_REQUIRED', state: 'uncertain', message: error.message && error.code === 'REVIEW_REQUIRED' && error.message !== 'Shopify no confirmó el cambio.' ? error.message : 'No pudimos confirmar si Shopify lo recibió. Toca «Reintentar»: el panel revisa y no lo repite.' } };
    if (Number.isInteger(error?.status) && typeof error?.code === 'string') return { status: error.status, body: { code: error.code, message: error.message } };
    return { status: 503, body: { code: 'UNAVAILABLE', message: 'Cobros no respondió. Inténtalo en unos segundos.' } };
  };
  // 503 sin respuesta de Cobros queda pendiente; SHOPIFY_REJECTED (Shopify no aceptó la solicitud, sin cambios) es definitivo.
  const isPending = response => response.status === 202 || response.body?.state === 'uncertain' || (response.status === 503 && response.body?.code !== 'SHOPIFY_REJECTED');
  const final = response => (response.status >= 400 && !isPending(response)) ? { ...response, body: { ...response.body, final: true } } : response;
  const today = () => localDay(now(), timeZone);

  function view(draft) {
    const tags = draft.tags || [];
    const kind = tagValue(tags, 'ds-tipo:') === 'cotizacion' ? 'cotizacion' : 'cobro';
    const expiresOn = kind === 'cotizacion' ? tagValue(tags, 'ds-vence:') : null;
    const paid = draft.status === 'COMPLETED';
    const expired = !paid && !!expiresOn && today() > expiresOn;
    const status = paid ? 'pagado' : expired ? 'vencido' : draft.status === 'INVOICE_SENT' ? 'enviado' : 'abierto';
    return {
      id: numeric(draft.id), kind, status, expiresOn,
      name: draft.customAttributes?.find(item => item.key === 'Clienta')?.value || '',
      email: draft.email || '', totalCents: cents(draft.totalPriceSet),
      concept: (draft.lineItems?.nodes || []).map(line => line.title).join(' + '),
      createdAt: draft.createdAt, invoiceUrl: paid || expired ? null : draft.invoiceUrl || null,
      orderId: draft.order ? numeric(draft.order.id) : null, orderName: draft.order?.name || null,
    };
  }
  const isCharge = draft => Array.isArray(draft?.tags) && draft.tags.includes('ds-cobro');
  /** Pedido pagado: se guarda la relación borrador → pedido para reconocerlo en Pedidos aunque no herede etiquetas. */
  const linkPaid = draft => {
    if (draft?.status !== 'COMPLETED' || !draft.order?.id || !isCharge(draft)) return;
    store.linkChargeOrder({ orderId: numeric(draft.order.id), draftId: numeric(draft.id), kind: view(draft).kind, at: now() });
  };

  // ---------- Recibos sin datos de contacto ----------
  /** Lo que se guarda del resultado: sin nombre, correo, conceptos, enlace ni mensajes de Shopify. */
  function redact(response) {
    const body = { ...response.body };
    if (body.charge) body.charge = { id: body.charge.id, kind: body.charge.kind, status: body.charge.status, totalCents: body.charge.totalCents, expiresOn: body.charge.expiresOn, orderId: body.charge.orderId };
    if (body.code === 'SHOPIFY_REJECTED') body.message = 'Shopify no aceptó el cobro. Revisa los datos y vuelve a intentarlo.';
    return { ...response, body };
  }
  /** Una repetición vuelve a leer el cobro en Shopify para mostrar el enlace; si ya no existe, queda el recibo. */
  async function rehydrate(response) {
    if (!response?.body?.charge?.id) return response;
    try {
      const draft = await client.chargeDraft(draftGid(response.body.charge.id));
      if (draft && isCharge(draft)) return { ...response, body: { ...response.body, charge: view(draft) } };
    } catch { /* se responde con el recibo guardado */ }
    return response;
  }

  async function run(operationId, action, params, staff, perform, { onNew = () => {} } = {}) {
    const fingerprint = await digest({ action, params });
    return serial(async () => {
      try {
        const previous = store.getOperation(operationId);
        if (previous && previous.fingerprint !== fingerprint) throw orderError(409, 'OPERATION_REUSED', 'Esta clave ya se usó para otro cobro. Cierra y vuelve a intentarlo.');
        if (previous && previous.state !== 'pending') return rehydrate(previous.response);
        // Las reglas que dependen del día (vencimiento) solo valen al empezar una operación nueva:
        // un reintento de la misma clave al día siguiente concilia lo que ya se hizo.
        if (!previous) {
          onNew();
          store.begin({ operationId, action, orderId: 'cobro', fingerprint, plan: { kind: params.kind ?? null, totalCents: params.totalCents ?? null }, staffId: staff.staffId, staffName: staff.staffName, amountCents: params.totalCents ?? null, summary: params.summary, at: now() });
        }
        let response;
        try { response = await perform(previous?.progress || {}); }
        catch (error) { response = failure(error); }
        const result = final(response);
        if (!isPending(response)) store.finish(operationId, { state: response.status < 400 ? 'succeeded' : 'failed', response: redact(result), at: now() });
        return result;
      } catch (error) { return final(failure(error)); }
    });
  }

  // ---------- Crear ----------
  /** Busca el borrador de una operación: por etiqueta y en la lectura directa de los más nuevos. */
  async function findByOperation(operationId) {
    const tag = `ds-operation:${operationId}`;
    const [byTag] = await client.chargesByOperation(operationId);
    if (byTag) return byTag;
    const recent = await client.recentDrafts();
    return recent.nodes.find(node => Array.isArray(node.tags) && node.tags.includes(tag)) || null;
  }

  async function attemptCreate(operationId, params, progress) {
    let draft;
    if (progress.draftId) {
      draft = await client.chargeDraft(draftGid(progress.draftId));
      if (!draft) throw orderError(409, 'CHARGE_GONE', 'Este cobro ya no está en Shopify: se anuló o venció. Revisa la lista de Cobros.');
    } else {
      if (progress.createdAt) {
        // Ya hubo un intento sin respuesta: se concilia, nunca se vuelve a crear.
        draft = await findByOperation(operationId);
        if (!draft && now() - progress.createdAt < CREATE_SETTLE_MS)
          return { status: 202, body: { code: 'PROCESSING', state: 'processing', message: 'Shopify todavía no confirma el cobro. Espera unos minutos y toca «Reintentar»: el panel revisa y no lo repite.' } };
        if (!draft) throw orderError(409, 'CREATE_UNCONFIRMED', 'No pudimos confirmar que el cobro se creó. Revisa la lista de Cobros: si no aparece, crea uno nuevo.');
      } else {
        store.progress(operationId, { createdAt: now() }, now());
        draft = await client.createCharge({
          email: params.email, presentmentCurrencyCode: 'USD', taxExempt: false, useCustomerDefaultAddress: false,
          acceptAutomaticDiscounts: false, allowDiscountCodesInCheckout: false,
          lineItems: params.lines.map(line => ({ title: line.title, quantity: 1, originalUnitPriceWithCurrency: { amount: decimal(line.cents), currencyCode: 'USD' }, taxable: false, requiresShipping: false })),
          tags: ['ds-cobro', `ds-tipo:${params.kind}`, ...(params.expiresOn ? [`ds-vence:${params.expiresOn}`] : []), `ds-operation:${operationId}`],
          customAttributes: [{ key: 'Clienta', value: params.name }],
          note: `${KINDS[params.kind]} desde el panel`,
        });
      }
      // Desde aquí el cobro existe: todo reintento lo lee por su ID.
      store.progress(operationId, { draftId: numeric(draft.id) }, now());
    }
    if (!isCharge(draft) || cents(draft.totalPriceSet) !== params.totalCents) throw orderError(502, 'REVIEW_REQUIRED', 'El cobro quedó distinto en Shopify. Revísalo en Shopify antes de repetir.');
    if (draft.status === 'COMPLETED') { linkPaid(draft); return { status: 200, body: { charge: view(draft), email: 'sent' } }; }
    // Una cotización que venció mientras se conciliaba no se factura ni se muestra como enviada; el cron la borra.
    if (view(draft).status === 'vencido') throw orderError(409, 'CHARGE_EXPIRED', 'Esta cotización venció antes de confirmarse el envío. No se mandó nada: crea una nueva si la clienta todavía la quiere.');
    // La factura se intenta una sola vez por operación: draftOrderInvoiceSend no tiene clave de idempotencia
    // y una solicitud sin respuesta puede seguir en curso. La intención queda guardada antes de llamar.
    if (draft.status === 'OPEN' && !progress.invoiceAt) {
      store.progress(operationId, { invoiceAt: now() }, now());
      const label = params.kind === 'cotizacion' ? 'cotización' : 'cobro';
      const lines = [params.message, params.expiresOn ? `Esta cotización vale hasta el ${longDay(params.expiresOn)}.` : ''].filter(Boolean);
      try { await client.sendChargeInvoice(draft.id, { to: params.email, subject: `Tu ${label} de Dayana's Sweet`, ...(lines.length ? { customMessage: lines.join('\n\n') } : {}) }); }
      catch { /* sin confirmar: el cobro existe y la pantalla pide mandar el enlace */ }
      draft = await client.chargeDraft(draft.id) || draft;
    }
    return { status: 200, body: { charge: view(draft), email: draft.status === 'OPEN' ? 'unconfirmed' : 'sent' } };
  }

  // ---------- Anular y vencer ----------
  /**
   * Lee el borrador y lo borra si sigue sin pagar. onRead guarda lo que hace falta para el registro antes de borrar.
   * Shopify no tiene un borrado condicional: si la clienta paga entre la lectura y el borrado (milisegundos), el
   * pedido pagado se conserva y aparece en Pedidos; solo el registro local diría «anulado» o «vencido».
   */
  async function removeDraft(id, onRead = () => {}) {
    const draft = await client.chargeDraft(draftGid(id));
    if (!draft) return null;
    if (!isCharge(draft)) throw orderError(404, 'NOT_FOUND', 'No encontramos ese cobro.');
    if (draft.status === 'COMPLETED') { linkPaid(draft); throw orderError(409, 'CHARGE_PAID', 'Este cobro ya está pagado: ahora es un pedido. Si hace falta, reembólsalo desde Pedidos.'); }
    const shown = view(draft);
    const record = { kind: shown.kind, totalCents: shown.totalCents, concept: shown.concept };
    onRead(record);
    await client.deleteCharge(draft.id);
    return record;
  }
  const allowed = staff => staff?.roles?.includes('admin') && staff.stepUp === true;
  const stepUpRequired = () => final({ status: 403, body: { code: 'STEP_UP_REQUIRED', message: 'Esta acción necesita la contraseña de la administradora.' } });

  return Object.freeze({
    async list() {
      try {
        const page = await client.chargeDrafts();
        const drafts = page.nodes.filter(isCharge);
        for (const draft of drafts) linkPaid(draft);
        return { status: 200, body: { charges: drafts.map(view), closed: store.chargeRecords(50), today: today(), complete: !page.hasNextPage } };
      } catch (error) { return failure(error); }
    },
    async create(body, staff) {
      if (!allowed(staff)) return stepUpRequired();
      let params, operationId;
      try {
        if (!UUID.test(body?.operationId || '')) throw bad('Falta la clave de la operación.');
        operationId = body.operationId.toLowerCase();
        params = validateCharge({ ...body, operationId: undefined });
      } catch (error) { return final(failure(error)); }
      const summary = `${KINDS[params.kind]} ${usd(params.totalCents)} enviado`;
      return run(operationId, 'charge-create', { ...params, summary }, staff, progress => attemptCreate(operationId, params, progress), { onNew: () => checkExpiry(params, today()) });
    },
    async void(id, body, staff) {
      if (!allowed(staff)) return stepUpRequired();
      if (!/^\d{1,20}$/.test(id)) return final({ status: 404, body: { code: 'NOT_FOUND', message: 'No encontramos ese cobro.' } });
      if (!UUID.test(body?.operationId || '')) return final(failure(bad('Falta la clave de la operación.')));
      const operationId = body.operationId.toLowerCase();
      return run(operationId, 'charge-void', { id, summary: `Cobro ${id} anulado` }, staff, async progress => {
        // Si la respuesta del borrado se perdió, el borrador ya no existe: el registro sale de lo guardado antes de borrar.
        const removed = await removeDraft(id, record => store.progress(operationId, { record }, now())) || progress.record;
        if (!removed) throw orderError(404, 'NOT_FOUND', 'No encontramos ese cobro.');
        store.recordCharge({ draftId: id, ...removed, state: 'anulado', at: now() });
        return { status: 200, body: { voided: id } };
      });
    },
    /**
     * Cron: recorre los cobros por ID (orden estable), borra las cotizaciones vencidas sin pagar y anota los
     * pagados. Hace como mucho EXPIRE_PAGES páginas por hora y guarda dónde quedó: la próxima hora sigue de ahí
     * y, al terminar el recorrido, vuelve a empezar.
     */
    async expire() {
      const day = today();
      let expired = 0, after = store.chargeSweepCursor();
      for (let page = 0; page < EXPIRE_PAGES; page++) {
        let result;
        try { result = await client.chargeDrafts(after, { sweep: true }); } catch { break; }
        for (const draft of result.nodes) {
          if (!isCharge(draft)) continue;
          if (draft.status === 'COMPLETED') { linkPaid(draft); continue; }
          const expiresOn = tagValue(draft.tags, 'ds-vence:');
          if (!expiresOn || day <= expiresOn) continue;
          try {
            const removed = await removeDraft(numeric(draft.id));
            if (removed) { store.recordCharge({ draftId: numeric(draft.id), ...removed, state: 'vencido', at: now() }); expired++; }
          } catch { /* se reintenta en la próxima hora */ }
        }
        after = result.hasNextPage && result.endCursor ? result.endCursor : null;
        store.saveChargeSweepCursor(after);
        if (!after) break;
      }
      return { expired };
    },
  });
}
