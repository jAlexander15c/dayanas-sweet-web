// LOCAL TEST ONLY: a simulated Shopify Admin GraphQL 2026-10 for the orders panel.
// It answers the panel's named operations, keeps state and counts money calls.
// Failure injection: fake.next(operationName, 'lost' | 'down' | 'denied' | 'reject').
//  - lost: Shopify APPLIES the mutation, then the response is lost (network error).
//  - down: the request fails before reaching Shopify.
//  - denied: top-level ACCESS_DENIED (missing scope).
//  - reject: userErrors.
const money = cents => ({ shopMoney: { amount: (cents / 100).toFixed(2), currencyCode: 'USD' } });
const ROOTS = { PanelMarkAsPaid: 'orderMarkAsPaid', PanelRefund: 'refundCreate', PanelCancel: 'orderCancel', PanelFulfill: 'fulfillmentCreate', PanelReady: 'fulfillmentOrderLineItemsPreparedForPickup',
  PanelEditBegin: 'orderEditBegin', PanelEditQuantity: 'orderEditSetQuantity', PanelEditAdd: 'orderEditAddVariant', PanelEditCommit: 'orderEditCommit' };
const MONEY_OPS = new Set(['PanelMarkAsPaid', 'PanelRefund', 'PanelCancel', 'PanelEditCommit']);

export function sampleOrders() {
  const day = '2026-11-05T15:00:00Z';
  const line = (id, title, variantTitle, unitCents, quantity, variant) => ({ id, title, variantTitle, sku: `SKU-${id}`, unitCents, quantity, current: quantity, fulfilled: 0, variantId: `gid://shopify/ProductVariant/${variant}` });
  return [
    { id: '1042', name: '#1042', createdAt: '2026-11-05T14:00:00Z', email: 'ana@example.com', phone: '+12815550101', note: 'Dejar en la puerta', tags: [], customer: { firstName: 'Ana', lastName: 'Ramírez' },
      shipping: { title: 'USPS Ground Advantage', code: 'usps', deliveryCategory: 'shipping', cents: 900 }, gateway: 'shopify_payments', paid: true,
      lines: [line('11', 'Galletas surtidas', 'Caja de 6', 2400, 2, 501), line('12', 'Brownie Box', null, 2800, 1, 502)] },
    { id: '1043', name: '#1043', createdAt: day, email: 'bea@example.com', phone: '', note: '', tags: [], customer: { firstName: 'Beatriz', lastName: 'Luna' },
      shipping: { title: 'Retiro en Fulshear', code: 'pickup', deliveryCategory: 'pick-up', cents: 0 }, gateway: 'manual', paid: false,
      lines: [line('21', 'Galletas surtidas', 'Caja de 6', 2400, 1, 501), line('22', 'Galletas de avena', 'Caja de 6', 1200, 1, 503)] },
    { id: '1044', name: '#1044', createdAt: '2026-11-04T12:00:00Z', email: 'cele@example.com', phone: '', note: '', tags: ['ds-celebraciones', 'ds-request:abc'], customer: { firstName: 'Carla', lastName: 'Soto' },
      shipping: { title: 'Retiro en Fulshear', code: 'pickup', deliveryCategory: 'pick-up', cents: 0 }, gateway: 'manual', paid: false,
      lines: [line('31', 'Mesa de postres', null, 15000, 1, 504)] },
    { id: '1045', name: '#1045', createdAt: '2026-11-03T12:00:00Z', email: 'dora@example.com', phone: '', note: '', tags: [], customer: { firstName: 'Dora', lastName: 'Paz' },
      shipping: { title: 'USPS Ground Advantage', code: 'usps', deliveryCategory: 'shipping', cents: 0 }, gateway: 'shopify_payments', paid: true, shipped: true,
      lines: [line('41', 'Galletas surtidas', 'Caja de 12', 4600, 2, 505), line('42', 'Brownie Box', null, 2000, 1, 502)] },
  ];
}

/** An extra open, paid shipping order, used where a cancellable order is needed. */
export function cancellableOrder() {
  return { id: '1046', name: '#1046', createdAt: '2026-11-02T12:00:00Z', email: 'elena@example.com', phone: '', note: '', tags: [], customer: { firstName: 'Elena', lastName: 'Vidal' },
    shipping: { title: 'USPS Ground Advantage', code: 'usps', deliveryCategory: 'shipping', cents: 900 }, gateway: 'shopify_payments', paid: true,
    lines: [{ id: '61', title: 'Brownie Box', variantTitle: null, sku: 'SKU-61', unitCents: 2800, quantity: 1, current: 1, fulfilled: 0, variantId: 'gid://shopify/ProductVariant/502' }] };
}

export function createFakeShopify({ orders = sampleOrders(), clock = () => '2026-11-06T15:20:00Z', jobPolls = 0 } = {}) {
  const state = new Map();
  const jobs = new Map();
  /** Finishes a cancel job. cancel:false = the job ends without cancelling; refund:false = cancelled, refund not shown yet. */
  function finishJob(id, { cancel = true, refund = true } = {}) {
    const job = jobs.get(id);
    if (!job || job.done) return;
    job.done = true;
    const order = state.get(job.orderId);
    order.cancelling = null;
    if (!cancel) return;
    order.cancelledAt = clock();
    if (refund && job.input.refundMethod?.originalPaymentMethodsRefund) {
      const cents = order.receivedCents - order.refundedCents;
      if (cents > 0) { order.refunds.push({ id: `gid://shopify/Refund/${nextId++}`, createdAt: clock(), note: 'Cancel', cents }); order.refundedCents += cents; }
    }
  }
  let nextId = 9000;
  const queue = [];
  const calls = [];
  const idempotency = new Map();
  let moneyCalls = 0;
  const calc = new Map();
  for (const source of orders) {
    const order = structuredClone(source);
    order.cancelledAt = null; order.refunds = []; order.fulfillments = []; order.transactions = [];
    order.refundedCents = 0; order.shippingRefunded = 0;
    const total = totals(order).total;
    order.receivedCents = order.paid ? total : 0;
    order.outstandingCents = order.paid ? 0 : total;
    if (order.paid) order.transactions.push({ id: `gid://shopify/OrderTransaction/${order.id}1`, kind: 'SALE', status: 'SUCCESS', gateway: order.gateway, createdAt: order.createdAt, cents: total });
    if (order.shipped) shipAll(order, { company: 'USPS', number: '9400111111111111111111' }, 'IN_TRANSIT');
    state.set(order.id, order);
  }
  function totals(order) {
    const subtotal = order.lines.reduce((sum, line) => sum + line.current * line.unitCents, 0);
    return { subtotal, total: subtotal + order.shipping.cents };
  }
  function shipAll(order, tracking, displayStatus = 'CONFIRMED') {
    for (const line of order.lines) line.fulfilled = line.current;
    order.fulfillments.push({ id: `gid://shopify/Fulfillment/${nextId++}`, status: 'SUCCESS', displayStatus, createdAt: clock(), trackingInfo: tracking ? [{ company: tracking.company, number: tracking.number, url: null }] : [] });
  }
  function financial(order) {
    if (order.refundedCents > 0) return order.refundedCents >= order.receivedCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    if (order.outstandingCents > 0) return order.receivedCents > 0 ? 'PARTIALLY_PAID' : 'PENDING';
    return 'PAID';
  }
  function fulfillmentStatus(order) {
    const active = order.lines.filter(line => line.current > 0);
    if (active.length && active.every(line => line.fulfilled >= line.current)) return 'FULFILLED';
    if (active.some(line => line.fulfilled > 0)) return 'PARTIALLY_FULFILLED';
    return 'UNFULFILLED';
  }
  function render(order) {
    const { subtotal, total } = totals(order);
    return {
      id: `gid://shopify/Order/${order.id}`, name: order.name, createdAt: order.createdAt, cancelledAt: order.cancelledAt, closed: false,
      email: order.email, phone: order.phone, note: order.note, tags: order.tags, paymentGatewayNames: [order.gateway],
      displayFinancialStatus: financial(order), displayFulfillmentStatus: fulfillmentStatus(order), customer: order.customer,
      currentSubtotalPriceSet: money(subtotal), currentTotalPriceSet: money(total), totalShippingPriceSet: money(order.shipping.cents),
      totalOutstandingSet: money(order.outstandingCents), totalReceivedSet: money(order.receivedCents), totalRefundedSet: money(order.refundedCents),
      netPaymentSet: money(order.receivedCents - order.refundedCents),
      shippingLine: { title: order.shipping.title, code: order.shipping.code, source: 'shopify', deliveryCategory: order.shipping.deliveryCategory },
      lineItems: { nodes: order.lines.map(line => ({ id: `gid://shopify/LineItem/${line.id}`, title: line.title, variantTitle: line.variantTitle, sku: line.sku,
        quantity: line.quantity, currentQuantity: line.current, unfulfilledQuantity: Math.max(0, line.current - line.fulfilled), refundableQuantity: line.current,
        originalUnitPriceSet: money(line.unitCents), discountedUnitPriceAfterAllDiscountsSet: money(line.unitCents), variant: { id: line.variantId } })), pageInfo: { hasNextPage: false } },
      transactions: order.transactions.map(t => ({ id: t.id, kind: t.kind, status: t.status, gateway: t.gateway, createdAt: t.createdAt, manualPaymentGateway: t.gateway === 'manual', amountSet: money(t.cents) })),
      refunds: order.refunds.map(r => ({ id: r.id, createdAt: r.createdAt, note: r.note, totalRefundedSet: money(r.cents) })),
      fulfillments: order.fulfillments.map(f => ({ id: f.id, status: f.status, displayStatus: f.displayStatus, createdAt: f.createdAt, trackingInfo: f.trackingInfo })),
    };
  }
  const find = gid => state.get(String(gid || '').split('/').pop());
  const userError = message => ({ field: null, message, code: 'INVALID' });

  const handlers = {
    PanelOrders: () => ({ orders: { nodes: [...state.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(render), pageInfo: { hasNextPage: false, endCursor: null } } }),
    PanelOrder: v => ({ order: find(v.id) ? render(find(v.id)) : null }),
    PanelLineVariants: v => ({ order: find(v.id) ? { id: v.id, lineItems: { nodes: find(v.id).lines.map(line => ({ id: `gid://shopify/LineItem/${line.id}`, variant: { id: line.variantId } })) } } : null }),
    PanelFulfillmentOrders: v => {
      const order = find(v.id);
      const remaining = order.lines.map(line => ({ id: `gid://shopify/FulfillmentOrderLineItem/${line.id}`, remainingQuantity: Math.max(0, line.current - line.fulfilled) }));
      const open = remaining.some(line => line.remainingQuantity > 0);
      return { order: { id: v.id, fulfillmentOrders: { nodes: [{ id: `gid://shopify/FulfillmentOrder/${order.id}`, status: open ? 'OPEN' : 'CLOSED', deliveryMethod: { methodType: order.shipping.deliveryCategory === 'pick-up' ? 'PICK_UP' : 'SHIPPING' }, lineItems: { nodes: remaining } }] } } };
    },
    PanelSuggestedRefund: v => {
      const order = find(v.id);
      const lineCents = (v.lines || []).reduce((sum, item) => sum + item.quantity * order.lines.find(line => `gid://shopify/LineItem/${line.id}` === item.lineItemId).unitCents, 0);
      const shippingLeft = order.shipping.cents - order.shippingRefunded;
      const maximum = order.receivedCents - order.refundedCents;
      const amount = Math.min(maximum, lineCents + (v.shipping ? shippingLeft : 0));
      const sale = order.transactions.find(t => t.kind === 'SALE' && t.status === 'SUCCESS');
      return { order: { id: v.id,
        selected: { amountSet: money(amount), maximumRefundableSet: money(maximum), shipping: { amountSet: money(v.shipping ? shippingLeft : 0), maximumRefundableSet: money(shippingLeft) } },
        full: { maximumRefundableSet: money(maximum), suggestedTransactions: sale && maximum > 0 ? [{ gateway: sale.gateway, kind: 'SUGGESTED_REFUND', parentTransaction: { id: sale.id }, amountSet: money(maximum), maximumRefundableSet: money(maximum) }] : [] } } };
    },
    PanelMarkAsPaid: v => {
      const order = find(v.input.id);
      if (order.outstandingCents <= 0) return { orderMarkAsPaid: { order: null, userErrors: [userError('Order is already paid')] } };
      const cents = order.outstandingCents;
      order.transactions.push({ id: `gid://shopify/OrderTransaction/${nextId++}`, kind: 'SALE', status: 'SUCCESS', gateway: 'manual', createdAt: clock(), cents });
      order.receivedCents += cents; order.outstandingCents = 0; moneyCalls++;
      return { orderMarkAsPaid: { order: { id: v.input.id, displayFinancialStatus: financial(order), totalOutstandingSet: money(0) }, userErrors: [] } };
    },
    PanelRefund: v => {
      if (!v.key) return { __errors: [{ message: 'Idempotency key required', extensions: { code: 'IDEMPOTENCY_KEY_PARAMETER_MISSING' } }] };
      if (idempotency.has(v.key)) return { refundCreate: idempotency.get(v.key) };
      const order = find(v.input.orderId);
      const cents = (v.input.transactions || []).reduce((sum, t) => sum + Math.round(Number(t.amount) * 100), 0);
      if (cents > order.receivedCents - order.refundedCents) return { refundCreate: { refund: null, userErrors: [userError('Refund exceeds refundable amount')] } };
      for (const item of v.input.refundLineItems || []) {
        const line = order.lines.find(l => `gid://shopify/LineItem/${l.id}` === item.lineItemId);
        line.current -= item.quantity; line.fulfilled = Math.min(line.fulfilled, line.current);
      }
      if (v.input.shipping?.fullRefund) order.shippingRefunded = order.shipping.cents;
      const refund = { id: `gid://shopify/Refund/${nextId++}`, createdAt: clock(), note: v.input.note, cents, notify: v.input.notify };
      order.refunds.push(refund); order.refundedCents += cents; moneyCalls++;
      const result = { refund: { id: refund.id, note: refund.note, totalRefundedSet: money(cents) }, userErrors: [] };
      idempotency.set(v.key, result);
      return { refundCreate: result };
    },
    // orderCancel is asynchronous: it returns a Job and the order is cancelled (and
    // refunded) only when that job finishes. The job finishes with fake.runJobs() or,
    // with { jobPolls: n }, on the n-th `job(id)` query.
    PanelCancel: v => {
      const order = find(v.orderId);
      if (order.cancelledAt) return { orderCancel: { job: null, orderCancelUserErrors: [userError('Order is already cancelled')] } };
      if (order.cancelling) return { orderCancel: { job: null, orderCancelUserErrors: [userError('Order is already being cancelled')] } };
      if (order.fulfillments.length) return { orderCancel: { job: null, orderCancelUserErrors: [userError('Cannot cancel an order with fulfillments')] } };
      const id = `gid://shopify/Job/${nextId++}`;
      order.cancelInput = v; order.cancelling = id; moneyCalls++;
      jobs.set(id, { orderId: order.id, input: v, done: false, polls: 0 });
      return { orderCancel: { job: { id, done: false }, orderCancelUserErrors: [] } };
    },
    PanelJob: v => {
      const job = jobs.get(v.id);
      if (!job) return { job: null };
      job.polls++;
      if (!job.done && jobPolls && job.polls >= jobPolls) finishJob(v.id);
      return { job: { id: v.id, done: job.done } };
    },
    PanelFulfill: v => {
      const fo = v.fulfillment.lineItemsByFulfillmentOrder[0].fulfillmentOrderId;
      const order = find(fo);
      if (fulfillmentStatus(order) === 'FULFILLED') return { fulfillmentCreate: { fulfillment: null, userErrors: [userError('Fulfillment order is closed')] } };
      shipAll(order, v.fulfillment.trackingInfo, order.shipping.deliveryCategory === 'pick-up' ? 'PICKED_UP' : 'CONFIRMED');
      order.lastFulfillNotify = v.fulfillment.notifyCustomer;
      return { fulfillmentCreate: { fulfillment: { id: order.fulfillments.at(-1).id, status: 'SUCCESS' }, userErrors: [] } };
    },
    PanelReady: v => { const order = find(v.input.lineItemsByFulfillmentOrder[0].fulfillmentOrderId); order.readyNotices = (order.readyNotices || 0) + 1; return { fulfillmentOrderLineItemsPreparedForPickup: { userErrors: [] } }; },
    PanelEditBegin: v => {
      const order = find(v.id), id = `gid://shopify/CalculatedOrder/${nextId++}`;
      calc.set(id, { orderId: order.id, quantities: new Map(order.lines.map(line => [line.id, line.current])), additions: [] });
      return { orderEditBegin: { calculatedOrder: { id, lineItems: { nodes: order.lines.map(line => ({ id: `gid://shopify/CalculatedLineItem/${line.id}`, quantity: line.current })) } }, userErrors: [] } };
    },
    PanelEditQuantity: v => { calc.get(v.id).quantities.set(v.lineItemId.split('/').pop(), v.quantity); return { orderEditSetQuantity: { calculatedOrder: { id: v.id }, userErrors: [] } }; },
    PanelEditAdd: v => { calc.get(v.id).additions.push({ variantId: v.variantId, quantity: v.quantity }); return { orderEditAddVariant: { calculatedLineItem: { id: `gid://shopify/CalculatedLineItem/${nextId++}` }, calculatedOrder: { id: v.id }, userErrors: [] } }; },
    PanelEditCommit: v => {
      const session = calc.get(v.id), order = state.get(session.orderId);
      const before = totals(order).total;
      for (const line of order.lines) line.current = session.quantities.get(line.id);
      for (const add of session.additions) order.lines.push({ id: String(nextId++), title: `Producto ${add.variantId.split('/').pop()}`, variantTitle: null, sku: null, unitCents: 1500, quantity: add.quantity, current: add.quantity, fulfilled: 0, variantId: add.variantId });
      const delta = totals(order).total - before;
      order.outstandingCents = Math.max(0, order.outstandingCents + delta); order.lastEditNotify = v.notifyCustomer;
      calc.delete(v.id); moneyCalls++;
      return { orderEditCommit: { order: { id: `gid://shopify/Order/${order.id}` }, userErrors: [] } };
    },
  };

  async function fetchImpl(url, init) {
    if (String(url).endsWith('/admin/oauth/access_token')) return Response.json({ access_token: 'fake-token', expires_in: 3600 });
    const { query, variables } = JSON.parse(init.body);
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
    calls.push(op);
    const index = queue.findIndex(item => item.op === op);
    const mode = index >= 0 ? queue.splice(index, 1)[0].mode : null;
    if (mode === 'down') throw new TypeError('network down');
    if (mode === 'denied') return Response.json({ errors: [{ message: 'Access denied', extensions: { code: 'ACCESS_DENIED' } }] });
    if (!handlers[op]) return Response.json({ errors: [{ message: 'unknown', extensions: { code: 'UNKNOWN' } }] });
    if (mode === 'reject') return Response.json({ data: { [ROOTS[op]]: { userErrors: [userError('Rejected by test')], orderCancelUserErrors: [userError('Rejected by test')] } } });
    const data = handlers[op](variables);
    if (data.__errors) return Response.json({ errors: data.__errors });
    if (mode === 'lost') throw new TypeError('response lost after Shopify applied it');
    return Response.json({ data });
  }
  return {
    fetch: fetchImpl, calls, state,
    get moneyCalls() { return moneyCalls; },
    next(op, mode) { queue.push({ op, mode }); },
    runJobs(options) { for (const id of jobs.keys()) finishJob(id, options); },
    pendingJobs: () => [...jobs.values()].filter(job => !job.done).length,
    order: id => render(state.get(String(id))),
    raw: id => state.get(String(id)),
    count: op => calls.filter(name => name === op).length,
    isMoneyOp: op => MONEY_OPS.has(op),
  };
}
