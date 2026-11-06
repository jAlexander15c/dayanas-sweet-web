// Admin GraphQL 2026-10 client for the staff orders panel. Reuses the shared
// client-credentials transport of shopify-payments.mjs (same app, same token).
// Never logs, and never returns raw Shopify errors, bodies or tokens.
// Docs: https://shopify.dev/docs/api/admin-graphql/2026-10
//  - refundCreate requires @idempotent(key:) since 2026-04: https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/refundCreate
//  - orderMarkAsPaid / orderCancel / fulfillmentCreate / orderEditCommit have no idempotency key:
//    the service reconciles by reading the order before any retry.

export function orderError(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}
const UNCERTAIN = () => orderError(502, 'REVIEW_REQUIRED', 'Shopify no confirmó el cambio.', { uncertain: true });
const UNAVAILABLE = () => orderError(503, 'SHOPIFY_UNAVAILABLE', 'Shopify no respondió. Inténtalo en unos segundos.');
const DENIED = () => orderError(403, 'ACCESS_DENIED', 'Falta un permiso de Shopify para esta acción.');
const money = 'shopMoney { amount currencyCode }';
const bag = name => `${name} { ${money} }`;

export function cents(value) {
  const amount = value?.shopMoney?.amount, currency = value?.shopMoney?.currencyCode;
  if (currency !== 'USD' || typeof amount !== 'string' || !/^-?\d{1,12}(?:\.\d{1,2})?$/.test(amount)) throw orderError(502, 'SHOPIFY_UNAVAILABLE', 'Shopify devolvió un monto que el panel no puede leer.');
  const negative = amount.startsWith('-'), [whole, fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  return (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (negative ? -1 : 1);
}
export const decimal = value => { if (!Number.isSafeInteger(value) || value < 0) throw orderError(422, 'VALIDATION', 'Monto inválido.'); return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`; };
export const orderGid = id => `gid://shopify/Order/${id}`;

const listFields = `id name createdAt cancelledAt closed email displayFinancialStatus displayFulfillmentStatus tags paymentGatewayNames
  customer { firstName lastName } ${bag('currentTotalPriceSet')} ${bag('totalOutstandingSet')} ${bag('totalRefundedSet')} ${bag('totalShippingPriceSet')}
  shippingLine { title code source deliveryCategory }
  lineItems(first: 20) { nodes { id title variantTitle currentQuantity unfulfilledQuantity } pageInfo { hasNextPage } }
  fulfillments(first: 5) { status displayStatus }`;
const detailFields = `id name createdAt cancelledAt closed email phone note displayFinancialStatus displayFulfillmentStatus tags paymentGatewayNames
  customer { firstName lastName }
  ${bag('currentSubtotalPriceSet')} ${bag('currentTotalPriceSet')} ${bag('totalShippingPriceSet')} ${bag('totalOutstandingSet')}
  ${bag('totalReceivedSet')} ${bag('totalRefundedSet')} ${bag('netPaymentSet')}
  shippingLine { title code source deliveryCategory }
  lineItems(first: 100) { nodes { id title variantTitle sku quantity currentQuantity unfulfilledQuantity refundableQuantity
    ${bag('originalUnitPriceSet')} ${bag('discountedUnitPriceAfterAllDiscountsSet')} } pageInfo { hasNextPage } }
  transactions(first: 50) { id kind status gateway createdAt manualPaymentGateway ${bag('amountSet')} }
  refunds(first: 30) { id createdAt note ${bag('totalRefundedSet')} }
  fulfillments(first: 20) { id status displayStatus createdAt trackingInfo(first: 3) { company number url } }`;

export function createShopifyOrdersClient({ transport }) {
  if (!transport || typeof transport.token !== 'function' || typeof transport.requestJson !== 'function') throw orderError(503, 'UNAVAILABLE', 'Pedidos no está configurado.');
  // A mutation is "uncertain" when the request may have reached Shopify without a
  // readable answer (timeout, network, 5xx, partial data). 3xx/4xx and top-level
  // GraphQL errors mean Shopify did not run it.
  async function graphql(query, variables, root, { mutation = false, errorsField = 'userErrors' } = {}) {
    let accessToken;
    try { accessToken = await transport.token(); } catch { throw UNAVAILABLE(); }
    let result;
    try {
      ({ value: result } = await transport.requestJson(transport.graphqlUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken }, body: JSON.stringify({ query, variables }) }, mutation ? 'PAYMENT_REVIEW' : 'SHOPIFY_UNAVAILABLE', 'graphql'));
    } catch (error) {
      const status = error?.diagnostic?.httpStatus;
      if (status === 403 || error?.diagnostic?.code === 'ACCESS_DENIED') throw DENIED();
      if (mutation && !(status >= 300 && status < 500)) throw UNCERTAIN();
      throw UNAVAILABLE();
    }
    const codes = (Array.isArray(result?.errors) ? result.errors : []).map(e => e?.extensions?.code);
    if (codes.length) {
      if (mutation && result?.data?.[root] != null) throw UNCERTAIN();
      if (codes.includes('ACCESS_DENIED')) throw DENIED();
      if (codes.some(code => typeof code === 'string' && code.startsWith('IDEMPOTENCY_'))) throw Object.assign(UNCERTAIN(), { idempotency: codes.find(code => code?.startsWith('IDEMPOTENCY_')) });
      throw mutation ? orderError(503, 'SHOPIFY_REJECTED', 'Shopify no aceptó la solicitud. No se hizo ningún cambio.') : UNAVAILABLE();
    }
    if (!result?.data || !Object.hasOwn(result.data, root)) throw mutation ? UNCERTAIN() : UNAVAILABLE();
    const value = result.data[root];
    if (mutation) {
      if (!value || !Array.isArray(value[errorsField])) throw UNCERTAIN();
      if (value[errorsField].length) {
        const message = value[errorsField].map(e => String(e?.message || '').slice(0, 200)).filter(Boolean).join(' ').slice(0, 500);
        throw orderError(422, 'SHOPIFY_REJECTED', `Shopify no aplicó el cambio: ${message || 'datos no válidos'}.`, { shopifyCodes: value[errorsField].map(e => e?.code).filter(c => typeof c === 'string') });
      }
    }
    return value;
  }
  return Object.freeze({
    async listOrders({ since, pages = 6 }) {
      const nodes = []; let after = null;
      for (let page = 0; page < pages; page++) {
        const connection = await graphql(`query PanelOrders($after: String, $query: String) { orders(first: 25, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) { nodes { ${listFields} } pageInfo { hasNextPage endCursor } } }`, { after, query: `created_at:>=${since}` }, 'orders');
        if (!Array.isArray(connection?.nodes)) throw UNAVAILABLE();
        nodes.push(...connection.nodes);
        if (!connection.pageInfo?.hasNextPage) return { nodes, complete: true };
        after = connection.pageInfo.endCursor;
      }
      return { nodes, complete: false };
    },
    async order(id) {
      const value = await graphql(`query PanelOrder($id: ID!) { order(id: $id) { ${detailFields} } }`, { id }, 'order');
      if (!value) throw orderError(404, 'ORDER_NOT_FOUND', 'No encontramos este pedido en Shopify.');
      return value;
    },
    // Separate and tolerant: product variant access may need scopes the app does not have.
    async lineVariants(id) {
      try {
        const value = await graphql(`query PanelLineVariants($id: ID!) { order(id: $id) { id lineItems(first: 100) { nodes { id variant { id } } } } }`, { id }, 'order');
        return new Map((value?.lineItems?.nodes || []).map(line => [line.id, line.variant?.id || null]));
      } catch { return null; }
    },
    async fulfillmentOrders(id) {
      const value = await graphql(`query PanelFulfillmentOrders($id: ID!) { order(id: $id) { id fulfillmentOrders(first: 10) { nodes { id status deliveryMethod { methodType } lineItems(first: 100) { nodes { id remainingQuantity } } } } } }`, { id }, 'order');
      return (value?.fulfillmentOrders?.nodes || []).filter(fo => ['OPEN', 'IN_PROGRESS'].includes(fo.status) && fo.lineItems?.nodes?.some(line => line.remainingQuantity > 0));
    },
    async suggestRefund(id, { lines, refundShipping }) {
      const value = await graphql(`query PanelSuggestedRefund($id: ID!, $lines: [RefundLineItemInput!], $shipping: Boolean) { order(id: $id) { id
        selected: suggestedRefund(refundLineItems: $lines, refundShipping: $shipping) { ${bag('amountSet')} ${bag('maximumRefundableSet')} shipping { ${bag('amountSet')} ${bag('maximumRefundableSet')} } }
        full: suggestedRefund(suggestFullRefund: true) { ${bag('maximumRefundableSet')} suggestedTransactions { gateway kind parentTransaction { id } ${bag('amountSet')} ${bag('maximumRefundableSet')} } } } }`, { id, lines, shipping: refundShipping }, 'order');
      if (!value?.selected || !value?.full) throw orderError(404, 'ORDER_NOT_FOUND', 'No encontramos este pedido en Shopify.');
      return {
        amountCents: cents(value.selected.amountSet), maximumCents: cents(value.full.maximumRefundableSet),
        shippingCents: value.selected.shipping ? cents(value.selected.shipping.amountSet) : 0,
        shippingMaximumCents: value.selected.shipping ? cents(value.selected.shipping.maximumRefundableSet) : 0,
        transactions: (value.full.suggestedTransactions || []).filter(t => t.parentTransaction?.id).map(t => ({ parentId: t.parentTransaction.id, gateway: t.gateway, maximumCents: cents(t.maximumRefundableSet) })),
      };
    },
    markAsPaid: id => graphql(`mutation PanelMarkAsPaid($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { order { id displayFinancialStatus ${bag('totalOutstandingSet')} } userErrors { field message } } }`, { input: { id } }, 'orderMarkAsPaid', { mutation: true }),
    refund: (input, key) => graphql(`mutation PanelRefund($input: RefundInput!, $key: String!) { refundCreate(input: $input) @idempotent(key: $key) { refund { id note ${bag('totalRefundedSet')} } userErrors { field message } } }`, { input, key }, 'refundCreate', { mutation: true }),
    cancel: variables => graphql(`mutation PanelCancel($orderId: ID!, $reason: OrderCancelReason!, $restock: Boolean!, $notifyCustomer: Boolean, $staffNote: String, $refundMethod: OrderCancelRefundMethodInput) { orderCancel(orderId: $orderId, reason: $reason, restock: $restock, notifyCustomer: $notifyCustomer, staffNote: $staffNote, refundMethod: $refundMethod) { job { id done } orderCancelUserErrors { field message code } } }`, variables, 'orderCancel', { mutation: true, errorsField: 'orderCancelUserErrors' }),
    fulfill: fulfillment => graphql(`mutation PanelFulfill($fulfillment: FulfillmentInput!) { fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } } }`, { fulfillment }, 'fulfillmentCreate', { mutation: true }),
    preparedForPickup: fulfillmentOrderIds => graphql(`mutation PanelReady($input: FulfillmentOrderLineItemsPreparedForPickupInput!) { fulfillmentOrderLineItemsPreparedForPickup(input: $input) { userErrors { field message } } }`, { input: { lineItemsByFulfillmentOrder: fulfillmentOrderIds.map(fulfillmentOrderId => ({ fulfillmentOrderId })) } }, 'fulfillmentOrderLineItemsPreparedForPickup', { mutation: true }),
    async editBegin(id) {
      const value = await graphql(`mutation PanelEditBegin($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id lineItems(first: 100) { nodes { id quantity } } } userErrors { field message } } }`, { id }, 'orderEditBegin', { mutation: true });
      if (!value.calculatedOrder?.id) throw UNCERTAIN();
      return value.calculatedOrder;
    },
    editSetQuantity: (id, lineItemId, quantity) => graphql(`mutation PanelEditQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!) { orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: true) { calculatedOrder { id } userErrors { field message } } }`, { id, lineItemId, quantity }, 'orderEditSetQuantity', { mutation: true }),
    editAddVariant: (id, variantId, quantity) => graphql(`mutation PanelEditAdd($id: ID!, $variantId: ID!, $quantity: Int!) { orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity, allowDuplicates: false) { calculatedLineItem { id } calculatedOrder { id } userErrors { field message } } }`, { id, variantId, quantity }, 'orderEditAddVariant', { mutation: true }),
    editCommit: (id, notifyCustomer, staffNote) => graphql(`mutation PanelEditCommit($id: ID!, $notifyCustomer: Boolean, $staffNote: String) { orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) { order { id } userErrors { field message } } }`, { id, notifyCustomer, staffNote }, 'orderEditCommit', { mutation: true }),
  });
}
