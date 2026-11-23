// Cobros del panel: cotizaciones y cobros directos por un monto libre.
// Cada cobro es un pedido borrador de Shopify con líneas personalizadas (sin stock, sin envío)
// y su factura (draftOrderInvoiceSend), que es el correo con el botón para pagar. Al pagarlo,
// Shopify lo convierte en un pedido normal. Nunca se usa draftOrderComplete.
// Crear y anular son idempotentes por operationId: el borrador lleva la etiqueta
// ds-operation:<id> y un reintento lo busca antes de crear otro. No guarda nombres ni correos.
import { cents, decimal, orderError } from './orders-shopify.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const EMAIL = /^[^\s@<>()[\],;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const CHARGE_LIMITS = Object.freeze({ lines: 10, minCents: 100, maxCents: 500_000, maxDays: 60, title: 80, name: 80, message: 500 });
// Tras un intento de creación sin respuesta, la búsqueda por etiqueta de Shopify puede tardar en
// ver el borrador: durante este tiempo un reintento espera en vez de crear otro.
export const CREATE_SETTLE_MS = 60_000;
const KINDS = { cobro: 'Cobro', cotizacion: 'Cotización' };

const bad = message => orderError(422, 'VALIDATION', message);
const usd = value => `$${(value / 100).toFixed(2)}`;
const numeric = gid => String(gid || '').split('/').pop();
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

export function validateCharge(body, today) {
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
    const days = dayNumber(body.expiresOn) - dayNumber(today);
    if (days < 1 || days > CHARGE_LIMITS.maxDays) throw bad(`La cotización vale desde mañana hasta ${CHARGE_LIMITS.maxDays} días.`);
    expiresOn = body.expiresOn;
  } else if (body.expiresOn != null) throw bad('Un cobro directo no vence.');
  let message = '';
  if (body.message != null) {
    if (typeof body.message !== 'string') throw bad('Mensaje inválido.');
    message = body.message.trim();
    if (message.length > CHARGE_LIMITS.message) throw bad(`El mensaje es demasiado largo (máximo ${CHARGE_LIMITS.message} caracteres).`);
  }
  return { kind: body.kind, name, email, lines, expiresOn, message, totalCents: lines.reduce((sum, line) => sum + line.cents, 0) };
}

export function createChargesService({ client, store, now = () => Date.now(), timeZone = 'America/Chicago' }) {
  if (!client || !store) throw orderError(503, 'UNAVAILABLE', 'Cobros no está configurado.');
  let tail = Promise.resolve();
  const serial = fn => { const run = tail.then(fn, fn); tail = run.catch(() => {}); return run; };
  const failure = error => {
    if (error?.uncertain) return { status: 502, body: { code: 'REVIEW_REQUIRED', state: 'uncertain', message: 'No pudimos confirmar si Shopify lo recibió. Toca «Reintentar»: el panel revisa y no lo repite.' } };
    if (Number.isInteger(error?.status) && typeof error?.code === 'string') return { status: error.status, body: { code: error.code, message: error.message } };
    return { status: 503, body: { code: 'UNAVAILABLE', message: 'Cobros no respondió. Inténtalo en unos segundos.' } };
  };
  const final = response => (response.status >= 400 && response.body?.state !== 'uncertain' && response.body?.state !== 'processing') ? { ...response, body: { ...response.body, final: true } } : response;
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

  async function invoice(draft, params) {
    if (draft.status !== 'OPEN') return draft;
    const label = params.kind === 'cotizacion' ? 'cotización' : 'cobro';
    const lines = [params.message, params.expiresOn ? `Esta cotización vale hasta el ${longDay(params.expiresOn)}.` : ''].filter(Boolean);
    await client.sendChargeInvoice(draft.id, { to: params.email, subject: `Tu ${label} de Dayana's Sweet`, ...(lines.length ? { customMessage: lines.join('\n\n') } : {}) });
    const sent = await client.chargeDraft(draft.id);
    if (!sent || sent.status === 'OPEN') throw orderError(502, 'REVIEW_REQUIRED', 'Shopify no confirmó el envío del correo.', { uncertain: true });
    return sent;
  }

  async function attemptCreate(operationId, params, progress) {
    let [draft] = await client.chargesByOperation(operationId);
    if (!draft) {
      if (progress.createdAt && now() - progress.createdAt < CREATE_SETTLE_MS)
        return { status: 202, body: { code: 'PROCESSING', state: 'processing', message: 'Shopify todavía está creando el cobro. Espera un minuto y toca «Reintentar»: el panel revisa y no lo repite.' } };
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
    if (!isCharge(draft) || cents(draft.totalPriceSet) !== params.totalCents) throw orderError(502, 'REVIEW_REQUIRED', 'El cobro quedó distinto en Shopify. Revísalo en Shopify antes de repetir.');
    if (draft.status === 'COMPLETED') return { status: 200, body: { charge: view(draft) } };
    draft = await invoice(draft, params);
    return { status: 200, body: { charge: view(draft) } };
  }

  async function run(operationId, action, params, staff, perform) {
    const fingerprint = await digest({ action, params });
    return serial(async () => {
      try {
        const previous = store.getOperation(operationId);
        if (previous && previous.fingerprint !== fingerprint) throw orderError(409, 'OPERATION_REUSED', 'Esta clave ya se usó para otro cobro. Cierra y vuelve a intentarlo.');
        if (previous && previous.state !== 'pending') return previous.response;
        if (!previous) store.begin({ operationId, action, orderId: 'cobro', fingerprint, plan: { kind: params.kind ?? null, totalCents: params.totalCents ?? null }, staffId: staff.staffId, staffName: staff.staffName, amountCents: params.totalCents ?? null, summary: params.summary, at: now() });
        let response;
        try { response = await perform(previous?.progress || {}); }
        catch (error) { response = failure(error); }
        const pending = response.status === 202 || response.body?.state === 'uncertain' || response.status === 503;
        if (!pending) store.finish(operationId, { state: response.status < 400 ? 'succeeded' : 'failed', response: final(response), at: now() });
        return final(response);
      } catch (error) { return final(failure(error)); }
    });
  }

  /** Lee el borrador y lo borra si sigue sin pagar. onRead guarda lo que hace falta para el registro antes de borrar. */
  async function removeDraft(id, onRead = () => {}) {
    const draft = await client.chargeDraft(`gid://shopify/DraftOrder/${id}`);
    if (!draft) return null;
    if (!isCharge(draft)) throw orderError(404, 'NOT_FOUND', 'No encontramos ese cobro.');
    if (draft.status === 'COMPLETED') throw orderError(409, 'CHARGE_PAID', 'Este cobro ya está pagado: ahora es un pedido. Si hace falta, reembólsalo desde Pedidos.');
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
        const drafts = (await client.chargeDrafts()).filter(isCharge).map(view);
        return { status: 200, body: { charges: drafts, closed: store.chargeRecords(50), today: today() } };
      } catch (error) { return failure(error); }
    },
    async create(body, staff) {
      if (!allowed(staff)) return stepUpRequired();
      let params, operationId;
      try {
        if (!UUID.test(body?.operationId || '')) throw bad('Falta la clave de la operación.');
        operationId = body.operationId.toLowerCase();
        params = validateCharge({ ...body, operationId: undefined }, today());
      } catch (error) { return final(failure(error)); }
      const summary = `${KINDS[params.kind]} ${usd(params.totalCents)} enviado`;
      return run(operationId, 'charge-create', { ...params, summary }, staff, progress => attemptCreate(operationId, params, progress));
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
    /** Cron: borra las cotizaciones vencidas sin pagar. Una pagada nunca se toca. */
    async expire() {
      const day = today();
      let expired = 0;
      let drafts = [];
      try { drafts = await client.chargeDrafts(); } catch { return { expired }; }
      for (const draft of drafts) {
        const expiresOn = tagValue(draft.tags, 'ds-vence:');
        if (!isCharge(draft) || draft.status === 'COMPLETED' || !expiresOn || day <= expiresOn) continue;
        try {
          const removed = await removeDraft(numeric(draft.id));
          if (removed) { store.recordCharge({ draftId: numeric(draft.id), ...removed, state: 'vencido', at: now() }); expired++; }
        } catch { /* se reintenta en la próxima hora */ }
      }
      return { expired };
    },
  });
}
