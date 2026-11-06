// Staff orders panel: list, detail, internal note and the Shopify writes
// (dispatch, pickup, cash, refund, edit, cancel). Every write is idempotent by
// operationId: same id + same content returns the stored result without calling
// Shopify; same id + different content is 409; a pending write is reconciled by
// reading the order before anything is resent. Never logs.
import { cents, decimal, orderError, orderGid } from './orders-shopify.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LINE_GID = /^gid:\/\/shopify\/LineItem\/\d{1,20}$/;
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/;
export const MESSAGES = Object.freeze({
  celebraciones: 'Este pedido se cobra desde Celebraciones',
  shipped: 'Un pedido despachado ya no se cancela: se reembolsa.',
  fulfillmentScope: 'Falta un permiso de Shopify para despachar desde el panel. Mientras tanto, despacha desde el admin de Shopify.',
  uncertain: 'No pudimos confirmar si Shopify aplicó el cambio. Toca «Reintentar»: el panel revisa el pedido y no lo repite.',
  processing: 'Shopify todavía está procesando la cancelación. Espera unos segundos y toca «Reintentar»: el panel revisa el pedido y no la repite.',
  review: 'El pedido no quedó como se esperaba. Revisa el pedido en Shopify antes de repetir.',
  cancelFailed: 'Shopify terminó sin cancelar el pedido. Revisa el pedido en Shopify antes de repetir.',
  cancelRefund: 'El pedido se canceló, pero Shopify todavía no muestra el reembolso. Revisa los pagos del pedido en Shopify.',
  stockCheck: 'Hay que confirmar el stock antes de guardar.',
});
// orderCancel runs as a background job. When its id is unknown (the answer was lost) the
// panel waits this long after the last attempt before it may resend.
export const CANCEL_SETTLE_MS = 120_000;
const REFUND_REASONS = { damaged: 'Llegó dañado', missing: 'Faltó un producto', customer: 'Pedido de la clienta', other: 'Otro motivo' };
const CANCEL_REASONS = { CUSTOMER: 'La clienta lo pidió', INVENTORY: 'Sin stock para la tanda', DECLINED: 'Pago rechazado o fraude', OTHER: 'Otro motivo' };
const MONEY_ACTIONS = new Set(['cash', 'refund', 'edit', 'cancel']);

const bad = (message, code = 'VALIDATION') => orderError(422, code, message);
const conflict = (code, message, extra) => orderError(409, code, message, extra);
const numeric = gid => String(gid).split('/').pop();
const usd = value => `$${decimal(value)}`;
const bool = value => { if (typeof value !== 'boolean') throw bad('Falta una opción.'); return value; };
const int = (value, min, max, message = 'Cantidad inválida.') => { if (!Number.isSafeInteger(value) || value < min || value > max) throw bad(message); return value; };
const optionalCents = set => set ? cents(set) : 0;

export function isPickup(order) {
  const line = order.shippingLine;
  if (!line) return true;
  return /pick/i.test(line.deliveryCategory || '') || /retiro|pickup|pick up|recoger|fulshear/i.test(`${line.title || ''} ${line.code || ''}`);
}
const isCelebraciones = order => Array.isArray(order.tags) && order.tags.includes('ds-celebraciones');
const activeFulfillments = order => (order.fulfillments || []).filter(f => !['CANCELLED', 'ERROR', 'FAILURE'].includes(f.status));
function customerLabel(order, full = false) {
  const first = order.customer?.firstName?.trim() || '', last = order.customer?.lastName?.trim() || '';
  if (!first && !last) return 'Sin nombre';
  return full ? `${first} ${last}`.trim() : `${first}${last ? ` ${last[0]}.` : ''}`.trim();
}
function stageOf(order, ready) {
  const status = order.displayFulfillmentStatus;
  if (isPickup(order)) {
    if (['FULFILLED', 'FULFILLMENT_NOT_REQUIRED', 'RESTOCKED'].includes(status)) return 'entregado';
    return ready ? 'listo' : 'preparar';
  }
  if (['FULFILLMENT_NOT_REQUIRED', 'RESTOCKED'].includes(status)) return 'entregado';
  if (status !== 'FULFILLED') return 'preparar';
  const shipments = activeFulfillments(order);
  return shipments.length && shipments.every(f => f.displayStatus === 'DELIVERED') ? 'entregado' : 'listo';
}
const gatewayLabel = name => /cash|efectivo|manual|cod\b|pago al/i.test(name || '') ? 'Efectivo' : /shopify_payments/i.test(name || '') ? 'Tarjeta' : String(name || 'Otro').slice(0, 40);

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function failure(error) {
  if (error?.uncertain) return { status: 502, body: { code: 'REVIEW_REQUIRED', state: 'uncertain', retryable: true, message: MESSAGES.uncertain } };
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 503;
  const body = { code: typeof error?.code === 'string' ? error.code : 'UNAVAILABLE', message: error?.status ? error.message : 'No pudimos completar la acción. Inténtalo de nuevo.' };
  for (const key of ['currentCents', 'maximumCents', 'note']) if (error?.[key] !== undefined) body[key] = error[key];
  return { status, body };
}

export function createOrdersService({ client, store, now = () => Date.now(), days = 60 }) {
  let tail = Promise.resolve();
  const serial = fn => { const run = tail.then(fn, fn); tail = run.catch(() => {}); return run; };
  const readOrder = id => client.order(orderGid(id));
  const scoped = async fn => {
    try { return await fn(); } catch (error) {
      if (error?.code === 'ACCESS_DENIED') throw orderError(403, 'FULFILLMENT_SCOPE', MESSAGES.fulfillmentScope);
      throw error;
    }
  };
  async function openFulfillmentOrders(order) {
    const list = await scoped(() => client.fulfillmentOrders(order.id));
    if (!list.length) throw conflict('NOTHING_TO_FULFILL', 'Este pedido no tiene productos pendientes de entregar.');
    return list;
  }

  const ACTIONS = {
    fulfill: {
      validate(body) {
        const trackingNumber = typeof body.trackingNumber === 'string' ? body.trackingNumber.trim() : '';
        if (!/^[A-Za-z0-9][A-Za-z0-9 -]{3,59}$/.test(trackingNumber)) throw bad('Escribe un número de seguimiento válido.');
        if (!['USPS', 'OTHER'].includes(body.carrier)) throw bad('Elige el transportista.');
        const carrierName = body.carrier === 'OTHER' ? String(body.carrierName || '').trim() : 'USPS';
        if (!carrierName || carrierName.length > 40) throw bad('Escribe el nombre del transportista.');
        return { trackingNumber, carrier: body.carrier, carrierName, notify: bool(body.notify) };
      },
      async prepare(order, params) {
        if (isPickup(order)) throw conflict('PICKUP_ORDER', 'Este pedido es de retiro en Fulshear.');
        const fos = await openFulfillmentOrders(order);
        return { amountCents: null, summary: `Despachado · ${params.carrierName} ${params.trackingNumber}`,
          plan: { fulfillment: { lineItemsByFulfillmentOrder: fos.map(fo => ({ fulfillmentOrderId: fo.id })), notifyCustomer: params.notify, trackingInfo: { company: params.carrierName, number: params.trackingNumber } } } };
      },
      perform: plan => scoped(() => client.fulfill(plan.fulfillment)),
      reconcile(order, plan) {
        const number = plan.fulfillment.trackingInfo.number;
        if (activeFulfillments(order).some(f => (f.trackingInfo || []).some(t => t.number === number))) return 'done';
        if (order.displayFulfillmentStatus === 'FULFILLED') return conflict('ORDER_CHANGED', 'El pedido ya se despachó desde Shopify.');
        return 'retry';
      },
    },
    ready: {
      validate: () => ({}),
      async prepare(order) {
        if (!isPickup(order)) throw conflict('SHIPPING_ORDER', 'Este pedido es de envío.');
        const fos = await openFulfillmentOrders(order);
        return { amountCents: null, summary: 'Listo para retirar', plan: { fulfillmentOrderIds: fos.map(fo => fo.id) } };
      },
      perform: plan => scoped(() => client.preparedForPickup(plan.fulfillmentOrderIds)),
      // Shopify exposes no readable "prepared" flag; resending only repeats the ready notice.
      reconcile: () => 'retry',
    },
    delivered: {
      validate: () => ({}),
      async prepare(order) {
        if (!isPickup(order)) throw conflict('SHIPPING_ORDER', 'Este pedido es de envío.');
        const fos = await openFulfillmentOrders(order);
        return { amountCents: null, summary: 'Entregado en Fulshear', plan: { fulfillment: { lineItemsByFulfillmentOrder: fos.map(fo => ({ fulfillmentOrderId: fo.id })), notifyCustomer: false } } };
      },
      perform: plan => scoped(() => client.fulfill(plan.fulfillment)),
      reconcile: order => order.displayFulfillmentStatus === 'FULFILLED' ? 'done' : 'retry',
    },
    cash: {
      validate: body => ({ expectedAmountCents: int(body.expectedAmountCents, 1, 10_000_000, 'Monto inválido.') }),
      prepare(order, params) {
        const outstanding = cents(order.totalOutstandingSet);
        if (outstanding <= 0 || order.displayFinancialStatus === 'PAID') throw conflict('NOTHING_DUE', 'Este pedido no tiene saldo por cobrar.');
        if (outstanding !== params.expectedAmountCents) throw conflict('AMOUNT_CHANGED', `El saldo cambió en Shopify: ahora es ${usd(outstanding)}. Revisa antes de cobrar.`, { currentCents: outstanding });
        return { amountCents: outstanding, summary: `Cobró en efectivo ${usd(outstanding)}`, plan: { orderId: order.id, amountCents: outstanding } };
      },
      perform: plan => client.markAsPaid(plan.orderId),
      reconcile(order, plan) {
        const outstanding = cents(order.totalOutstandingSet);
        if (outstanding === 0) return 'done';
        if (outstanding === plan.amountCents) return 'retry';
        return conflict('AMOUNT_CHANGED', 'El saldo cambió en Shopify mientras se cobraba. Revisa el pedido.', { currentCents: outstanding });
      },
    },
    refund: {
      validate(body) {
        const lines = refundLines(body.lines);
        const extraCents = int(body.extraCents ?? 0, 0, 10_000_000, 'Monto adicional inválido.');
        if (!Object.hasOwn(REFUND_REASONS, body.reason)) throw bad('Elige el motivo.');
        return { lines, restock: bool(body.restock), refundShipping: bool(body.refundShipping), extraCents, reason: body.reason, notify: bool(body.notify), expectedTotalCents: int(body.expectedTotalCents, 1, 10_000_000, 'Monto inválido.') };
      },
      async prepare(order, params, { operationId }) {
        const { suggestion, totalCents } = await suggest(order, params);
        if (totalCents !== params.expectedTotalCents) throw conflict('AMOUNT_CHANGED', `Shopify calculó ${usd(totalCents)}. Revisa el monto antes de reembolsar.`, { currentCents: totalCents, maximumCents: suggestion.maximumCents });
        let remaining = totalCents; const transactions = [];
        for (const t of suggestion.transactions) {
          if (!remaining) break;
          const take = Math.min(remaining, t.maximumCents);
          if (take > 0) { transactions.push({ orderId: order.id, parentId: t.parentId, gateway: t.gateway, kind: 'REFUND', amount: decimal(take) }); remaining -= take; }
        }
        if (remaining) throw bad(`El reembolso pasa de lo que se puede devolver: máximo ${usd(totalCents - remaining)}.`, 'REFUND_LIMIT');
        const byId = new Map(order.lineItems.nodes.map(line => [line.id, line]));
        const tag = `panel ${operationId.slice(0, 8)}`;
        return { amountCents: totalCents, summary: `Reembolsó ${usd(totalCents)} · ${REFUND_REASONS[params.reason]}${params.restock ? ' · regresó al stock' : ''}`,
          plan: { tag, totalCents, input: { orderId: order.id, note: `${REFUND_REASONS[params.reason]} (${tag})`, notify: params.notify,
            refundLineItems: params.lines.map(line => ({ lineItemId: line.lineItemId, quantity: line.quantity, restockType: params.restock && byId.get(line.lineItemId).unfulfilledQuantity >= line.quantity ? 'CANCEL' : 'NO_RESTOCK' })),
            ...(params.refundShipping ? { shipping: { fullRefund: true } } : {}), transactions } } };
      },
      // refundCreate carries @idempotent(key: operationId): Shopify returns the same refund for the same key.
      perform: (plan, operationId) => client.refund(plan.input, operationId),
      reconcile: (order, plan) => (order.refunds || []).some(refund => String(refund.note || '').includes(plan.tag)) ? 'done' : 'retry',
    },
    edit: {
      validate(body) {
        if (!Array.isArray(body.changes) || !Array.isArray(body.additions) || body.changes.length > 100 || body.additions.length > 20) throw bad('Cambios inválidos.');
        const changes = body.changes.map(change => {
          if (!LINE_GID.test(change?.lineItemId)) throw bad('Producto inválido.');
          if (change.variantId != null && !VARIANT_GID.test(change.variantId)) throw bad('Producto inválido.');
          const fromQuantity = int(change.fromQuantity, 0, 999), quantity = int(change.quantity, 0, 99);
          if (quantity === fromQuantity) throw bad('No hay cambios en ese producto.');
          return { lineItemId: change.lineItemId, variantId: change.variantId ?? null, fromQuantity, quantity };
        }).sort((a, b) => a.lineItemId.localeCompare(b.lineItemId));
        const additions = body.additions.map(add => {
          if (!VARIANT_GID.test(add?.variantId)) throw bad('Producto inválido.');
          return { variantId: add.variantId, quantity: int(add.quantity, 1, 20) };
        }).sort((a, b) => a.variantId.localeCompare(b.variantId));
        if (!changes.length && !additions.length) throw bad('No hay cambios para guardar.');
        if (new Set(changes.map(c => c.lineItemId)).size !== changes.length || new Set(additions.map(a => a.variantId)).size !== additions.length) throw bad('Cambios repetidos.');
        return { changes, additions, notify: bool(body.notify) };
      },
      // Additions and increases consume stock; Inventario checks it only when a write will really be sent.
      needsStock: p => p.additions.length > 0 || p.changes.some(c => c.quantity > c.fromQuantity),
      async prepare(order, params, { actor }) {
        if (order.lineItems.pageInfo?.hasNextPage) throw conflict('ORDER_TOO_LARGE', 'Este pedido tiene demasiados productos para editarlo desde el panel.');
        const byId = new Map(order.lineItems.nodes.map(line => [line.id, line]));
        const variants = params.changes.some(c => c.variantId) ? await client.lineVariants(order.id) : null;
        for (const change of params.changes) {
          const line = byId.get(change.lineItemId);
          if (!line || line.currentQuantity !== change.fromQuantity) throw conflict('ORDER_CHANGED', 'El pedido cambió. Ábrelo de nuevo antes de editar.');
          if (change.quantity < line.currentQuantity - line.unfulfilledQuantity) throw bad('Solo se pueden cambiar productos sin despachar.');
          if (change.variantId && variants && variants.get(line.id) !== change.variantId) throw conflict('ORDER_CHANGED', 'El pedido cambió. Ábrelo de nuevo antes de editar.');
        }
        const parts = [...params.changes.map(c => `${byId.get(c.lineItemId).title} ${c.fromQuantity}→${c.quantity}`), ...(params.additions.length ? [`${params.additions.reduce((n, a) => n + a.quantity, 0)} agregado(s)`] : [])];
        return { amountCents: null, summary: `Editó el pedido · ${parts.join(', ')}`.slice(0, 300),
          plan: { orderId: order.id, changes: params.changes.map(({ lineItemId, fromQuantity, quantity }) => ({ lineItemId, fromQuantity, quantity })), additions: params.additions, notify: params.notify,
            staffNote: `Editado desde el panel por ${actor.staffName}`.slice(0, 255), originalLines: order.lineItems.nodes.map(line => ({ id: line.id, quantity: line.currentQuantity })) } };
      },
      async perform(plan) {
        const calculated = await client.editBegin(plan.orderId);
        const calcLines = new Map(calculated.lineItems.nodes.map(line => [numeric(line.id), line.id]));
        for (const change of plan.changes) {
          const calcId = calcLines.get(numeric(change.lineItemId));
          if (!calcId) throw orderError(409, 'ORDER_CHANGED', 'El pedido cambió. Ábrelo de nuevo antes de editar.');
          await client.editSetQuantity(calculated.id, calcId, change.quantity);
        }
        for (const add of plan.additions) await client.editAddVariant(calculated.id, add.variantId, add.quantity);
        return client.editCommit(calculated.id, plan.notify, plan.staffNote);
      },
      // Every change and addition of the stored plan is compared with the order: all at the
      // target -> done; all at the start and nothing foreign -> retry; anything else -> review.
      async reconcile(order, plan) {
        const review = conflict('REVIEW_REQUIRED', MESSAGES.review);
        if (order.lineItems.pageInfo?.hasNextPage) return review;
        const lines = new Map(order.lineItems.nodes.map(line => [line.id, line]));
        const changes = new Map(plan.changes.map(change => [change.lineItemId, change]));
        const outcomes = [];
        for (const { id, quantity } of plan.originalLines) {
          const current = lines.get(id)?.currentQuantity, change = changes.get(id);
          if (change) outcomes.push(current === change.quantity ? 'target' : current === change.fromQuantity ? 'start' : 'other');
          else if (current !== quantity) outcomes.push('other');
        }
        const known = new Set(plan.originalLines.map(line => line.id));
        const fresh = order.lineItems.nodes.filter(line => !known.has(line.id) && line.currentQuantity > 0);
        if (plan.additions.length || fresh.length) {
          const variants = await client.lineVariants(order.id);
          if (!variants) return review;
          for (const add of plan.additions) {
            const index = fresh.findIndex(line => variants.get(line.id) === add.variantId);
            if (index < 0) { outcomes.push('start'); continue; }
            outcomes.push(fresh.splice(index, 1)[0].currentQuantity === add.quantity ? 'target' : 'other');
          }
          if (fresh.length) outcomes.push('other');
        }
        if (outcomes.length && outcomes.every(outcome => outcome === 'target')) return 'done';
        if (outcomes.every(outcome => outcome === 'start')) return 'retry';
        return review;
      },
    },
    cancel: {
      validate(body) {
        if (!Object.hasOwn(CANCEL_REASONS, body.reason)) throw bad('Elige el motivo.');
        return { reason: body.reason, refund: bool(body.refund), restock: bool(body.restock), notify: bool(body.notify) };
      },
      prepare(order, params, { actor }) {
        if (activeFulfillments(order).length || !['UNFULFILLED', 'ON_HOLD', 'SCHEDULED', 'OPEN', 'PENDING_FULFILLMENT'].includes(order.displayFulfillmentStatus)) throw conflict('ORDER_SHIPPED', MESSAGES.shipped);
        const refundCents = params.refund ? Math.max(0, optionalCents(order.netPaymentSet)) : 0;
        return { amountCents: refundCents, summary: `Canceló el pedido · ${CANCEL_REASONS[params.reason]}${refundCents ? ` · reembolsó ${usd(refundCents)}` : ''}${params.restock ? ' · regresó al stock' : ''}`,
          plan: { refundCents, variables: { orderId: order.id, reason: params.reason, restock: params.restock, notifyCustomer: params.notify, staffNote: `Cancelado desde el panel por ${actor.staffName}`.slice(0, 255),
            ...(params.refund ? { refundMethod: { originalPaymentMethodsRefund: true } } : {}) } } };
      },
      perform: plan => client.cancel(plan.variables),
      // orderCancel only queues a job: success is claimed when the job is done and the order shows cancelledAt.
      async performed(result, operation) {
        const job = result?.job?.id ? { id: result.job.id, done: result.job.done === true } : null;
        if (job) store.progress(operation.operationId, { jobId: job.id }, now());
        if (job && !job.done) return 'processing';
        return cancelVerdict(await client.order(operation.plan.variables.orderId), operation.plan, job ?? undefined, false);
      },
      async reconcile(order, plan, operation) {
        const jobId = operation.progress?.jobId;
        if (!jobId) return cancelVerdict(order, plan, undefined, settled(operation));
        // Job first, then the order: a job that finished after the first read must be judged on a fresh order.
        const job = await client.job(jobId);
        return cancelVerdict(job?.done ? await client.order(plan.variables.orderId) : order, plan, job, settled(operation));
      },
    },
  };

  const settled = operation => now() - (operation.progress?.attemptedAt ?? operation.createdAt) >= CANCEL_SETTLE_MS;
  // job: undefined = id unknown (answer lost); null = Shopify no longer knows it; { done }.
  function cancelVerdict(order, plan, job, settledNow) {
    const refundShown = !plan.refundCents || optionalCents(order.netPaymentSet) <= 0;
    const running = job === undefined ? !settledNow : job?.done === false;
    if (order.cancelledAt) {
      if (refundShown) return 'done';
      return running ? 'processing' : { done: true, warning: MESSAGES.cancelRefund };
    }
    if (job === undefined) return settledNow ? 'retry' : 'processing';
    if (job?.done === false) return 'processing';
    return job?.done === true ? conflict('CANCEL_FAILED', MESSAGES.cancelFailed) : conflict('REVIEW_REQUIRED', MESSAGES.review);
  }

  function refundLines(value) {
    if (!Array.isArray(value) || value.length > 100) throw bad('Elige qué devolver.');
    const lines = value.map(line => {
      if (!LINE_GID.test(line?.lineItemId)) throw bad('Producto inválido.');
      return { lineItemId: line.lineItemId, quantity: int(line.quantity, 1, 999) };
    }).sort((a, b) => a.lineItemId.localeCompare(b.lineItemId));
    if (new Set(lines.map(l => l.lineItemId)).size !== lines.length) throw bad('Productos repetidos.');
    return lines;
  }
  function checkRefundLines(order, lines) {
    const byId = new Map(order.lineItems.nodes.map(line => [line.id, line]));
    for (const line of lines) {
      const current = byId.get(line.lineItemId);
      if (!current || current.refundableQuantity < line.quantity) throw bad('Esa cantidad ya no se puede devolver. Abre el pedido de nuevo.');
    }
  }
  async function suggest(order, { lines, refundShipping, extraCents }) {
    checkRefundLines(order, lines);
    const suggestion = await client.suggestRefund(order.id, { lines: lines.map(({ lineItemId, quantity }) => ({ lineItemId, quantity })), refundShipping });
    const totalCents = suggestion.amountCents + extraCents;
    if (totalCents <= 0) throw bad('Elige qué devolver o escribe un monto.');
    if (totalCents > suggestion.maximumCents) throw orderError(422, 'REFUND_LIMIT', `El reembolso pasa de lo que se puede devolver: máximo ${usd(suggestion.maximumCents)}.`, { maximumCents: suggestion.maximumCents });
    return { suggestion, totalCents };
  }
  function checkOrder(order, action) {
    if (order.cancelledAt) throw conflict('ORDER_CANCELLED', 'Este pedido está cancelado.');
    if (MONEY_ACTIONS.has(action) && isCelebraciones(order)) throw conflict('CELEBRACIONES_ORDER', MESSAGES.celebraciones);
  }

  const uncertainFor = operationId => { const response = failure({ uncertain: true }); return { ...response, body: { ...response.body, operationId } }; };
  const processingFor = operationId => ({ status: 202, body: { code: 'PROCESSING', state: 'processing', retryable: true, operationId, message: MESSAGES.processing } });
  const stockCheck = () => ({ status: 409, body: { code: 'STOCK_CHECK_REQUIRED', message: MESSAGES.stockCheck } });
  // Verdicts: 'done' | { done, warning } -> succeeded; 'processing' -> stays pending; an error -> failed.
  function conclude(operationId, verdict, reconciled = false) {
    if (verdict === 'processing') return processingFor(operationId);
    const ok = verdict === 'done' || verdict?.done === true;
    const response = ok ? { status: 200, body: { ok: true, operationId, ...(reconciled ? { reconciled: true } : {}), ...(verdict?.warning ? { warning: verdict.warning } : {}) } } : failure(verdict);
    store.finish(operationId, { state: ok ? 'succeeded' : 'failed', response, at: now() });
    return response;
  }
  async function attempt(def, operation) {
    const { operationId, plan } = operation;
    store.progress(operationId, { attemptedAt: now() }, now());
    let result;
    try { result = await def.perform(plan, operationId); } catch (error) { return error?.uncertain ? uncertainFor(operationId) : conclude(operationId, error); }
    if (!def.performed) return conclude(operationId, 'done');
    // Shopify accepted the write; if its outcome cannot be read yet the operation stays pending.
    try { return conclude(operationId, await def.performed(result, operation)); } catch { return processingFor(operationId); }
  }
  async function resume(def, operation, actor) {
    let verdict;
    try { verdict = await def.reconcile(await readOrder(operation.orderId), operation.plan, operation); } catch { return uncertainFor(operation.operationId); }
    if (verdict !== 'retry') return conclude(operation.operationId, verdict, true);
    if (def.needsStock?.(operation.plan) && actor?.stockVerified !== true) return stockCheck();
    return attempt(def, operation);
  }

  function summarize(order, ready) {
    const pickup = isPickup(order), lines = order.lineItems?.nodes || [];
    return {
      id: numeric(order.id), name: order.name, customer: customerLabel(order), email: order.email || '', createdAt: order.createdAt,
      totalCents: cents(order.currentTotalPriceSet), outstandingCents: cents(order.totalOutstandingSet), refundedCents: optionalCents(order.totalRefundedSet),
      shippingCents: optionalCents(order.totalShippingPriceSet), financial: order.displayFinancialStatus, fulfillment: order.displayFulfillmentStatus,
      delivery: pickup ? 'pickup' : 'shipping', shippingTitle: order.shippingLine?.title || null, stage: stageOf(order, ready), celebraciones: isCelebraciones(order),
      cash: (order.paymentGatewayNames || []).some(name => gatewayLabel(name) === 'Efectivo'),
      items: lines.filter(line => line.currentQuantity > 0).map(line => ({ title: line.title, variantTitle: line.variantTitle || null, quantity: line.currentQuantity, unfulfilled: line.unfulfilledQuantity })),
      itemsTruncated: !!order.lineItems?.pageInfo?.hasNextPage,
    };
  }
  function timeline(order, operations, pickup) {
    const events = [{ at: order.createdAt, title: 'Pedido recibido en la tienda' }];
    const outstanding = cents(order.totalOutstandingSet);
    for (const t of order.transactions || []) {
      if (t.status !== 'SUCCESS' || !['SALE', 'CAPTURE'].includes(t.kind)) continue;
      events.push({ at: t.createdAt, title: `Pago recibido ${usd(cents(t.amountSet))} · ${gatewayLabel(t.gateway)}` });
    }
    if (outstanding > 0 && (order.paymentGatewayNames || []).some(name => gatewayLabel(name) === 'Efectivo')) events.push({ at: order.createdAt, title: pickup ? 'Pago: efectivo al retirar' : 'Pago: efectivo pendiente' });
    for (const refund of order.refunds || []) events.push({ at: refund.createdAt, title: `Reembolso ${usd(optionalCents(refund.totalRefundedSet))}` });
    for (const f of activeFulfillments(order)) {
      const tracking = (f.trackingInfo || [])[0];
      events.push({ at: f.createdAt, title: pickup ? 'Entregado en Fulshear' : `Despachado${tracking?.number ? ` · ${tracking.company || ''} ${tracking.number}`.replace(/\s+/g, ' ') : ''}` });
    }
    if (order.cancelledAt) events.push({ at: order.cancelledAt, title: 'Pedido cancelado' });
    for (const op of operations) {
      events.push({ at: new Date(op.createdAt).toISOString(), title: op.summary, by: op.staffName, amountCents: op.amountCents ?? null, panel: true,
        state: op.state === 'succeeded' ? 'ok' : op.state === 'failed' ? 'failed' : 'unconfirmed' });
    }
    return events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  return Object.freeze({
    async list() {
      try {
        const since = new Date(now() - days * 86_400_000).toISOString().slice(0, 10);
        const { nodes, complete } = await client.listOrders({ since });
        const open = nodes.filter(order => !order.cancelledAt);
        const ready = store.readyOrders(open.map(order => numeric(order.id)));
        const orders = open.map(order => summarize(order, ready.has(numeric(order.id))));
        const products = new Map(), variants = new Map(); let bakeOrders = 0;
        for (const order of orders) {
          if (order.stage === 'entregado' || order.celebraciones) continue;
          const pending = order.items.filter(item => item.unfulfilled > 0);
          if (!pending.length) continue;
          bakeOrders++;
          for (const item of pending) {
            products.set(item.title, (products.get(item.title) || 0) + item.unfulfilled);
            const key = `${item.title}\u0000${item.variantTitle || ''}`;
            variants.set(key, { title: item.title, variantTitle: item.variantTitle, quantity: (variants.get(key)?.quantity || 0) + item.unfulfilled });
          }
        }
        const counts = { preparar: 0, listo: 0, entregado: 0 };
        for (const order of orders) counts[order.stage]++;
        return { status: 200, body: { orders, counts, complete, days,
          bake: { orders: bakeOrders, products: [...products].map(([title, quantity]) => ({ title, quantity })).sort((a, b) => b.quantity - a.quantity || a.title.localeCompare(b.title)),
            variants: [...variants.values()].sort((a, b) => a.title.localeCompare(b.title) || String(a.variantTitle).localeCompare(String(b.variantTitle))) } } };
      } catch (error) { return failure(error); }
    },
    async detail(id) {
      try {
        let operations = store.history(id);
        // A cancellation still running in Shopify is settled here too: job first, then the order (cancelledAt).
        const running = operations.filter(op => op.action === 'cancel' && op.state === 'pending' && op.progress?.jobId);
        const jobs = new Map();
        for (const op of running) { try { jobs.set(op.operationId, await client.job(op.progress.jobId)); } catch { /* asked again on the next read or retry */ } }
        const order = await readOrder(id);
        const variants = await client.lineVariants(order.id);
        for (const op of running) {
          if (!jobs.has(op.operationId)) continue;
          const verdict = cancelVerdict(order, op.plan, jobs.get(op.operationId), settled(op));
          if (verdict !== 'processing' && verdict !== 'retry') conclude(op.operationId, verdict, true);
        }
        if (running.length) operations = store.history(id);
        const pickup = isPickup(order), cancelPending = operations.some(op => op.action === 'cancel' && op.state === 'pending');
        const ready = operations.some(op => op.action === 'ready' && op.state === 'succeeded');
        const lines = order.lineItems.nodes.map(line => ({ id: line.id, title: line.title, variantTitle: line.variantTitle || null, sku: line.sku || null,
          quantity: line.currentQuantity, unfulfilled: line.unfulfilledQuantity, refundable: line.refundableQuantity,
          unitCents: cents(line.discountedUnitPriceAfterAllDiscountsSet || line.originalUnitPriceSet), variantId: variants?.get(line.id) || null }));
        const shipped = activeFulfillments(order).length > 0;
        return { status: 200, body: {
          id: numeric(order.id), name: order.name, createdAt: order.createdAt, cancelled: !!order.cancelledAt, celebraciones: isCelebraciones(order),
          customer: { name: customerLabel(order, true), email: order.email || '', phone: order.phone || '' }, customerNote: String(order.note || '').slice(0, 2000),
          delivery: pickup ? 'pickup' : 'shipping', shippingTitle: order.shippingLine?.title || null, stage: stageOf(order, ready),
          financial: order.displayFinancialStatus, fulfillment: order.displayFulfillmentStatus, lines, linesTruncated: !!order.lineItems.pageInfo?.hasNextPage,
          subtotalCents: optionalCents(order.currentSubtotalPriceSet), shippingCents: optionalCents(order.totalShippingPriceSet), totalCents: cents(order.currentTotalPriceSet),
          outstandingCents: cents(order.totalOutstandingSet), receivedCents: optionalCents(order.totalReceivedSet), refundedCents: optionalCents(order.totalRefundedSet), netPaymentCents: optionalCents(order.netPaymentSet),
          payment: [...new Set((order.paymentGatewayNames || []).map(gatewayLabel))],
          fulfillments: activeFulfillments(order).map(f => ({ createdAt: f.createdAt, displayStatus: f.displayStatus, tracking: (f.trackingInfo || []).map(t => ({ company: t.company || null, number: t.number || null, url: /^https:\/\//.test(t.url || '') ? t.url : null })) })),
          shipped, cancelPending, canCancel: !order.cancelledAt && !shipped && !cancelPending, timeline: timeline(order, operations, pickup), note: store.getNote(id),
        } };
      } catch (error) { return failure(error); }
    },
    async note(id, body, actor) {
      try {
        if (typeof body?.text !== 'string' || body.text.length > 2000) throw bad('La nota puede tener hasta 2000 caracteres.');
        const version = int(body.version, 0, 1_000_000, 'Versión inválida.');
        const saved = store.saveNote(id, { text: body.text.trim(), version, staffId: actor.staffId, staffName: actor.staffName, at: now() });
        if (!saved) throw conflict('NOTE_CONFLICT', 'Alguien guardó la nota antes. Revisa el texto nuevo.', { note: store.getNote(id) });
        return { status: 200, body: { note: saved } };
      } catch (error) { return failure(error); }
    },
    async refundPreview(id, body) {
      try {
        const lines = refundLines(body?.lines);
        const params = { lines, refundShipping: bool(body.refundShipping), extraCents: int(body.extraCents ?? 0, 0, 10_000_000, 'Monto adicional inválido.') };
        const order = await readOrder(id);
        checkOrder(order, 'refund');
        checkRefundLines(order, lines);
        const suggestion = await client.suggestRefund(order.id, { lines, refundShipping: params.refundShipping });
        const totalCents = suggestion.amountCents + params.extraCents;
        return { status: 200, body: { amountCents: suggestion.amountCents, extraCents: params.extraCents, totalCents, maximumCents: suggestion.maximumCents,
          shippingMaximumCents: suggestion.shippingMaximumCents, overLimit: totalCents > suggestion.maximumCents } };
      } catch (error) { return failure(error); }
    },
    async execute(action, id, body, actor) {
      const def = ACTIONS[action];
      try {
        if (!def || !/^\d{1,20}$/.test(id)) throw orderError(404, 'NOT_FOUND', 'No encontramos esa acción.');
        if (MONEY_ACTIONS.has(action) && !(actor?.roles?.includes('admin') && actor.stepUp === true)) throw orderError(403, 'STEP_UP_REQUIRED', 'Esta acción necesita la contraseña de la administradora.');
        if (!body || typeof body !== 'object' || !UUID.test(body.operationId || '')) throw bad('Falta la clave de la operación.');
        const operationId = body.operationId.toLowerCase();
        const params = def.validate(body);
        const fingerprint = await digest({ action, orderId: id, params });
        return await serial(async () => {
          try {
            const previous = store.getOperation(operationId);
            if (previous) {
              if (previous.fingerprint !== fingerprint) throw conflict('OPERATION_REUSED', 'Esta clave ya se usó para otro cambio. Cierra y vuelve a intentarlo.');
              if (previous.state !== 'pending') return previous.response;
              return await resume(def, previous, actor);
            }
            // Stock is confirmed only for a write that will really be sent, never for a stored receipt.
            if (def.needsStock?.(params) && actor.stockVerified !== true) return stockCheck();
            const order = await readOrder(id);
            checkOrder(order, action);
            const prepared = await def.prepare(order, params, { operationId, actor });
            store.begin({ operationId, action, orderId: id, fingerprint, plan: prepared.plan, staffId: actor.staffId, staffName: actor.staffName, amountCents: prepared.amountCents, summary: prepared.summary, at: now() });
            return await attempt(def, { operationId, orderId: id, plan: prepared.plan, progress: {}, createdAt: now() });
          } catch (error) { return failure(error); }
        });
      } catch (error) { return failure(error); }
    },
  });
}
