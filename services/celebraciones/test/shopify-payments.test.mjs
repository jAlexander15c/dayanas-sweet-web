import assert from 'node:assert/strict';
import test from 'node:test';

// Only the external HTTP boundary is replaced; fixtures follow Admin 2026-10.
import { createShopifyPaymentClient } from '../src/shopify-payments.mjs';
const shop = 'example-sweets.myshopify.com';
const gid = (type, id = 1) => `gid://shopify/${type}/${id}`;
const money = amount => ({ shopMoney: { amount, currencyCode: 'USD' }, presentmentMoney: { amount, currencyCode: 'USD' } });
const connection = nodes => ({ nodes, pageInfo: { hasNextPage: false } });
const line = { id: gid('LineItem'), title: 'Anticipo pastel [req-1/v1]', quantity: 1, currentQuantity: 1, originalUnitPriceSet: money('90.01') };
const draft = () => ({ id: gid('DraftOrder'), status: 'OPEN', invoiceUrl: `https://${shop}/invoice/one`, customer: { id: gid('Customer', 2) }, order: null, currencyCode: 'USD', presentmentCurrencyCode: 'USD', subtotalPriceSet: money('90.01'), totalTaxSet: money('6.30'), totalPriceSet: money('96.31'), taxesIncluded: false, taxExempt: false, totalDiscountsSet: money('0.00'), totalShippingPriceSet: money('0.00'), tags: ['ds-celebraciones', 'ds-request:req-1', 'ds-version:1', 'ds-operation:op-1'], customAttributes: [], lineItems: connection([{ ...line, id: gid('DraftOrderLineItem') }]) });
const order = () => ({ id: gid('Order'), customer: { id: gid('Customer', 2) }, test: false, currencyCode: 'USD', presentmentCurrencyCode: 'USD', displayFinancialStatus: 'PARTIALLY_PAID', cancelledAt: null, closed: false, fullyPaid: false, taxesIncluded: false, subtotalPriceSet: money('150.01'), totalTaxSet: money('10.50'), totalPriceSet: money('160.51'), currentSubtotalPriceSet: money('150.01'), currentTotalTaxSet: money('10.50'), currentTotalPriceSet: money('160.51'), currentTotalDiscountsSet: money('0.00'), totalShippingPriceSet: money('0.00'), totalOutstandingSet: money('80.51'), totalReceivedSet: money('90.00'), totalRefundedSet: money('10.00'), netPaymentSet: money('80.00'), tags: ['ds-request:req-1'], updatedAt: '2026-11-03T12:00:00Z', paymentCollectionDetails: { additionalPaymentCollectionUrl: `https://${shop}/checkouts/balance` }, lineItems: connection([line]), transactions: [
  { id: gid('OrderTransaction', 1), kind: 'SALE', status: 'SUCCESS', test: false, amountSet: money('90.00'), parentTransaction: null },
  { id: gid('OrderTransaction', 2), kind: 'REFUND', status: 'SUCCESS', test: false, amountSet: money('10.00'), parentTransaction: { id: gid('OrderTransaction', 1) } },
  { id: gid('OrderTransaction', 3), kind: 'CAPTURE', status: 'PENDING', test: true, amountSet: money('80.51'), parentTransaction: null },
  { id: gid('OrderTransaction', 4), kind: 'AUTHORIZATION', status: 'SUCCESS', test: false, amountSet: money('80.51'), parentTransaction: null },
] });
const calculated = () => ({ id: gid('CalculatedOrder'), subtotalPriceSet: money('150.01'), totalPriceSet: money('160.51'), totalOutstandingSet: money('70.51'), taxLines: [{ title: 'ITBMS', priceSet: money('10.50') }], lineItems: connection([{ ...line, id: gid('CalculatedLineItem'), editableQuantity: 1 }]), addedLineItems: connection([]) });
const deposit = { requestId: 'req-1', proposalVersion: 1, operationId: 'op-1', customerId: '2', baseCents: 15001, urgent: false, locationId: gid('Location', 3) };

test('guest draft omits purchasingEntity and never resolves a customer from email',async()=>{
 const {client,calls}=harness(({variables})=>{
   assert.equal(Object.hasOwn(variables.input,'purchasingEntity'),false);
   const value=draft();value.customer=null;
   return Response.json({data:{draftOrderCreate:{draftOrder:value,userErrors:[]}}});
 });
 const result=await client.createDepositDraft({...deposit,customerId:null});assert.equal(result.customerId,null);
 assert.equal(calls.length,2,'only OAuth and draft create; no customer lookup');
});

test('adding a staged custom balance accepts Shopify opaque calculated line IDs',async()=>{
  const id='gid://shopify/CalculatedLineItem/new-7b5f9a12';
  const {client}=harness(()=>Response.json({data:{orderEditAddCustomItem:{calculatedOrder:calculated(),calculatedLineItem:{id},userErrors:[]}}}));
  const value=await client.addCustomBalance({editId:gid('CalculatedOrder'),requestId:'req-1',proposalVersion:1,baseCents:6000});
  assert.equal(value.lineItemId,id);
  await assert.rejects(client.removeLine({editId:gid('CalculatedOrder'),lineItemId:'gid://shopify/CalculatedLineItem/../bad'}),{code:'VALIDATION'});
});

function harness(handler, extra = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ...init });
    if (url.endsWith('/access_token')) return Response.json({ access_token: 'test-token', expires_in: 3600 });
    return handler(JSON.parse(init.body), init, calls);
  };
  return { calls, client: createShopifyPaymentClient({ shop, clientId: 'test-client', secret: 'test-secret', fetchImpl, ...extra }) };
}
test('notification recipient lookup uses only the stored customer ID and validates returned identity',async()=>{
 const {client,calls}=harness(({query,variables})=>{
  assert.match(query,/defaultEmailAddress/);assert.deepEqual(variables,{id:gid('Customer',2)});
  return Response.json({data:{customer:{id:gid('Customer',2),firstName:'Ana',defaultEmailAddress:{emailAddress:'ana@example.test'}}}});
 });
 assert.deepEqual(await client.getCustomerContact('2'),{name:'Ana',email:'ana@example.test'});assert.equal(calls.length,2);
 const wrong=harness(()=>Response.json({data:{customer:{id:gid('Customer',3),defaultEmailAddress:{emailAddress:'wrong@example.test'}}}}));
 await assert.rejects(wrong.client.getCustomerContact('2'));
 await assert.rejects(client.getCustomerContact('ana@example.test'));
});
test('Workers-compatible transport uses manual redirects and never forwards credentials to a redirect', async () => {
  let calls = 0;
  const client = createShopifyPaymentClient({ shop, clientId: 'test-client', secret: 'test-secret', fetchImpl: async (_url, init) => {
    calls++;
    assert.equal(init.redirect, 'manual');
    return new Response('', { status: 302, headers: { Location: 'https://untrusted.example/token' } });
  } });
  await assert.rejects(client.getDraft(gid('DraftOrder')), error => {
    assert.equal(error.diagnostic?.httpStatus, 302);
    return error.code === 'SHOPIFY_UNAVAILABLE';
  });
  assert.equal(calls, 1);
});

test('deposit rounds 60 percent upward in integer cents and lets Shopify add tax', async () => {
  assert.equal(typeof createShopifyPaymentClient, 'function', 'payment client must exist');
  const { client, calls } = harness(({ variables }) => {
    assert.deepEqual(variables.input.purchasingEntity, { customerId: gid('Customer', 2) });
    assert.deepEqual(variables.input.lineItems[0].originalUnitPriceWithCurrency, { amount: '90.01', currencyCode: 'USD' });
    assert.equal(variables.input.lineItems[0].taxable, false);
    assert.equal(variables.input.lineItems[0].requiresShipping, false);
    assert.equal(variables.input.allowDiscountCodesInCheckout, false);
    assert.equal(variables.input.acceptAutomaticDiscounts, false);
    assert.equal(variables.input.taxExempt, false);
    assert.ok(variables.input.tags.includes('ds-operation:op-1'));
    for (const forbidden of ['email', 'shippingAddress', 'billingAddress', 'appliedDiscount', 'deposit', 'locationId']) assert.equal(variables.input[forbidden], undefined);
    return Response.json({ data: { draftOrderCreate: { draftOrder: draft(), userErrors: [] } } });
  });
  const result = await client.createDepositDraft(deposit);
  assert.equal(result.subtotalCents, 9001);
  assert.equal(result.taxCents, 630);
  assert.equal(result.totalCents, 9631);
  assert.deepEqual(result.logistics, { validated: false, locationId: gid('Location', 3) });
  assert.equal(calls[1].url, `https://${shop}/admin/api/2026-10/graphql.json`);
  const grant = new URLSearchParams(calls[0].body);
  assert.equal(grant.get('grant_type'), 'client_credentials');
  assert.equal(grant.get('client_id'), 'test-client');
});

test('urgent draft charges full base and large cents never use floating price arithmetic', async () => {
  const { client } = harness(({ variables }) => {
    assert.equal(variables.input.lineItems[0].originalUnitPriceWithCurrency.amount, '90071992547409.91');
    return Response.json({ data: { draftOrderCreate: { draftOrder: draft(), userErrors: [] } } });
  });
  await client.createDepositDraft({ ...deposit, baseCents: Number.MAX_SAFE_INTEGER, urgent: true });
});

test('invalid amounts, IDs, marker input and missing operation fail before HTTP', async () => {
  const { client, calls } = harness(() => { throw new Error('must not fetch'); });
  for (const baseCents of [0, -1, 1.5, '15000', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(client.createDepositDraft({ ...deposit, baseCents }), { code: 'VALIDATION' });
  for (const patch of [{ operationId: undefined }, { requestId: 'private@email.test' }, { proposalVersion: 0 }, { customerId: '2 OR 1=1' }, { urgent: 'false' }, { locationId: 'https://evil.test' }]) await assert.rejects(client.createDepositDraft({ ...deposit, ...patch }), { code: 'VALIDATION' });
  assert.equal(calls.length, 0);
});

test('tokens are shared across concurrent reads, cached per client and renewed before expiry', async () => {
  let time = 1_800_000_000_000;
  const { client, calls } = harness(() => Response.json({ data: { draftOrder: draft() } }), { now: () => time });
  await Promise.all([client.getDraft(gid('DraftOrder')), client.getDraft(gid('DraftOrder'))]);
  assert.equal(calls.filter(call => call.url.endsWith('/access_token')).length, 1);
  time += 3_550_000;
  await client.getDraft(gid('DraftOrder'));
  assert.equal(calls.filter(call => call.url.endsWith('/access_token')).length, 2);
  assert.ok(calls.filter(call => call.url.endsWith('/graphql.json')).every(call => call.headers['X-Shopify-Access-Token'] === 'test-token'));
});

test('order maps exact amounts and every transaction without counting authorizations as paid', async () => {
  const { client } = harness(({ query, variables }) => {
    assert.equal(variables.id, gid('Order'));
    assert.match(query, /transactions\s*\{/);
    assert.doesNotMatch(query, /receiptJson|paymentDetails|email|phone/);
    return Response.json({ data: { order: order() } });
  });
  const snapshot = await client.getOrder(gid('Order'));
  assert.equal(snapshot.customerId, gid('Customer', 2));
  assert.equal(snapshot.netPaymentCents, 8000);
  assert.equal(snapshot.outstandingCents, 8051);
  assert.equal(snapshot.transactions[1].parentId, gid('OrderTransaction', 1));
  assert.deepEqual(snapshot.transactions.map(({ kind, status, amountCents, test }) => ({ kind, status, amountCents, test })), [
    { kind: 'SALE', status: 'SUCCESS', amountCents: 9000, test: false }, { kind: 'REFUND', status: 'SUCCESS', amountCents: 1000, test: false },
    { kind: 'CAPTURE', status: 'PENDING', amountCents: 8051, test: true }, { kind: 'AUTHORIZATION', status: 'SUCCESS', amountCents: 8051, test: false },
  ]);
  assert.equal(snapshot.lineItems[0].baseCents, 9001);
});

test('non-decimal, non-cent precision and unsafe returned money fail closed', async () => {
  for (const amount of ['NaN', '1e3', ' 90', '90.001', 90, '90071992547409.92']) {
    const fixture = order(); fixture.netPaymentSet = money(amount);
    const { client } = harness(() => Response.json({ data: { order: fixture } }));
    await assert.rejects(client.getOrder(gid('Order')), { code: 'PAYMENT_REVIEW' });
  }
});

test('additional payment link uses documented field, nullable and strict HTTPS allowlist', async () => {
  for (const [url, expected] of [[null, null], [`https://${shop}/balance`, `https://${shop}/balance`], ['https://checkout.shopify.com/balance', 'https://checkout.shopify.com/balance']]) {
    const { client } = harness(({ query }) => { assert.match(query, /paymentCollectionDetails\s*\{\s*additionalPaymentCollectionUrl/); return Response.json({ data: { order: { id: gid('Order'), paymentCollectionDetails: { additionalPaymentCollectionUrl: url } } } }); });
    assert.equal(await client.getAdditionalPaymentUrl(gid('Order')), expected);
  }
  for (const url of ['http://checkout.shopify.com/a', 'https://evil.test/a', 'https://shopify.com.evil.test/a', 'https://other.myshopify.com/a', 'https://user:pass@checkout.shopify.com/a']) {
    const { client } = harness(() => Response.json({ data: { order: { id: gid('Order'), paymentCollectionDetails: { additionalPaymentCollectionUrl: url } } } }));
    await assert.rejects(client.getAdditionalPaymentUrl(gid('Order')), { code: 'PAYMENT_REVIEW' });
  }
});

test('edits target the same session, preserve shipping/taxes and never send invoice or collect payment', async () => {
  const { client, calls } = harness(({ query, variables }) => {
    if (query.includes('mutation BeginOrderEdit')) return Response.json({ data: { orderEditBegin: { calculatedOrder: calculated(), userErrors: [] } } });
    if (query.includes('mutation AddCustomBalance')) {
      assert.deepEqual(variables.price, { amount: '60.00', currencyCode: 'USD' });
      assert.equal(variables.locationId, gid('Location', 3));
      assert.match(query, /quantity: 1, taxable: false, requiresShipping: false/);
      return Response.json({ data: { orderEditAddCustomItem: { calculatedOrder: calculated(), calculatedLineItem: { id: gid('CalculatedLineItem', 2) }, userErrors: [] } } });
    }
    if (query.includes('mutation RemoveLine')) { assert.match(query, /quantity: 0, restock: false/); return Response.json({ data: { orderEditSetQuantity: { calculatedOrder: calculated(), userErrors: [] } } }); }
    assert.match(query, /notifyCustomer: false/);
    return Response.json({ data: { orderEditCommit: { order: { id: gid('Order') }, userErrors: [] } } });
  });
  const edit = await client.beginOrderEdit(gid('Order'));
  assert.equal(edit.id, gid('CalculatedOrder'));
  assert.equal(edit.taxLines[0].amountCents, 1050);
  const added = await client.addCustomBalance({ editId: edit.id, requestId: 'req-1', proposalVersion: 2, baseCents: 6000, locationId: gid('Location', 3) });
  assert.equal(added.lineItemId, gid('CalculatedLineItem', 2));
  await client.removeLine({ editId: edit.id, lineItemId: gid('CalculatedLineItem') });
  assert.deepEqual(await client.commitOrderEdit(edit.id), { orderId: gid('Order') });
  assert.equal(calls.length, 5);
  assert.doesNotMatch(calls.slice(1).map(call => call.body).join(''), /orderCapture|refundCreate|orderMarkAsPaid|draftOrderComplete|orderInvoiceSend/);
});

test('user errors are validation without returning Shopify messages or customer data', async () => {
  const { client } = harness(() => Response.json({ data: { draftOrderCreate: { draftOrder: null, userErrors: [{ field: ['input'], message: 'test-token private@example.test test-secret', code: 'INVALID' }] } } }));
  await assert.rejects(client.createDepositDraft(deposit), error => { assert.equal(error.code, 'VALIDATION'); assert.doesNotMatch(JSON.stringify(error) + error.stack, /test-token|private@|test-secret/); return true; });
});

test('ambiguous mutation transport, HTTP and GraphQL failures never retry', async () => {
  for (const handler of [() => { throw new Error('test-token private@example.test'); }, () => new Response('secret', { status: 500 }), () => new Response('', { status: 401 }), () => Response.json({ errors: [{ message: 'private@example.test' }] }), () => new Response('not-json')]) {
    const { client, calls } = harness(handler);
    await assert.rejects(client.createDepositDraft(deposit), error => { assert.equal(error.code, 'PAYMENT_REVIEW'); assert.doesNotMatch(error.stack, /private@|test-token/); return true; });
    assert.equal(calls.length, 2);
  }
});

test('mutation timeout aborts and enters review exactly once, query timeout is unavailable', async () => {
  for (const mutate of [true, false]) {
    let signal;
    const { client, calls } = harness((_body, init) => { signal = init.signal; return new Promise(() => {}); }, { timeoutMs: 5 });
    await assert.rejects(mutate ? client.createDepositDraft(deposit) : client.getDraft(gid('DraftOrder')), { code: mutate ? 'PAYMENT_REVIEW' : 'SHOPIFY_UNAVAILABLE' });
    assert.equal(signal.aborted, true);
    assert.equal(calls.length, 2);
  }
});

test('configuration rejects unsafe shop domains without network and absent objects are unavailable', async () => {
  for (const badShop of ['https://example.myshopify.com', 'example.myshopify.com.evil.test', 'example.myshopify.com/a', 'evil.test']) assert.throws(() => createShopifyPaymentClient({ shop: badShop, clientId: 'x', secret: 'y' }), { code: 'CONFIGURATION' });
  const { client } = harness(() => Response.json({ data: { order: null } }));
  await assert.rejects(client.getOrder(gid('Order')), { code: 'SHOPIFY_UNAVAILABLE' });
});

test('scoped reads reject a mismatched response ID and draft creation verifies customer identity', async () => {
  const { client } = harness(({ query }) => {
    if (query.includes('CreateDepositDraft')) { const fixture = draft(); fixture.customer.id = gid('Customer', 9); return Response.json({ data: { draftOrderCreate: { draftOrder: fixture, userErrors: [] } } }); }
    if (query.includes('GetDraft')) { const fixture = draft(); fixture.id = gid('DraftOrder', 9); return Response.json({ data: { draftOrder: fixture } }); }
    const fixture = order(); fixture.id = gid('Order', 9); return Response.json({ data: { order: fixture } });
  });
  await assert.rejects(client.getDraft(gid('DraftOrder')), { code: 'PAYMENT_REVIEW' });
  await assert.rejects(client.getOrder(gid('Order')), { code: 'PAYMENT_REVIEW' });
  await assert.rejects(client.getAdditionalPaymentUrl(gid('Order')), { code: 'PAYMENT_REVIEW' });
  await assert.rejects(client.createDepositDraft(deposit), { code: 'PAYMENT_REVIEW' });
});

test('partial line collections and differing presentment currency never appear reconciled', async () => {
  for (const change of [fixture => { fixture.lineItems.pageInfo.hasNextPage = true; }, fixture => { fixture.netPaymentSet.presentmentMoney.currencyCode = 'EUR'; }, fixture => { fixture.totalReceivedSet.presentmentMoney.amount = '89.99'; }]) {
    const fixture = order(); change(fixture);
    const { client } = harness(() => Response.json({ data: { order: fixture } }));
    await assert.rejects(client.getOrder(gid('Order')), { code: 'PAYMENT_REVIEW' });
  }
});

test('token failures never submit a mutation and do not leak failed grant payload', async () => {
  let calls = 0;
  const client = createShopifyPaymentClient({ shop, clientId: 'test-client', secret: 'test-secret', fetchImpl: async () => { calls++; return Response.json({ error: 'test-secret private@example.test' }, { status: 403 }); } });
  await assert.rejects(client.createDepositDraft(deposit), error => { assert.equal(error.code, 'SHOPIFY_UNAVAILABLE'); assert.doesNotMatch(error.stack, /test-secret|private@/); return true; });
  assert.equal(calls, 1);
});

test('body read timeout is also ambiguous and a fresh client never reuses another shop token', async () => {
  const { client, calls } = harness(() => ({ ok: true, json: () => new Promise(() => {}) }), { timeoutMs: 5 });
  await assert.rejects(client.createDepositDraft(deposit), { code: 'PAYMENT_REVIEW' });
  assert.equal(calls.length, 2);
  const other = harness(() => Response.json({ data: { draftOrder: draft() } }));
  await other.client.getDraft(gid('DraftOrder'));
  assert.equal(other.calls.filter(call => call.url.endsWith('/access_token')).length, 1);
});

test('order line quantities exclude removed units while preserving their historical quantity', async () => {
  const fixture = order(); fixture.lineItems.nodes[0] = { ...line, currentQuantity: 0 };
  const { client } = harness(({ query }) => { assert.match(query, /currentQuantity/); return Response.json({ data: { order: fixture } }); });
  const snapshot = await client.getOrder(gid('Order'));
  assert.equal(snapshot.lineItems[0].quantity, 0);
  assert.equal(snapshot.lineItems[0].originalQuantity, 1);
});

test('recovering a lost draft searches unique request and operation markers without creating anything', async () => {
  const {client}=harness(({query,variables})=>{
    assert.match(query,/draftOrders/);assert.equal(variables.query,'tag:"ds-request:req-1" AND tag:"ds-operation:op-1"');
    return Response.json({data:{draftOrders:connection([draft()])}});
  });
  const values=await client.findDraftByOperation({requestId:'req-1',operationId:'op-1'});
  assert.equal(values[0].id,gid('DraftOrder'));
});

test('custom storefront invoice URLs require the explicitly configured exact origin',async()=>{
  const fixture=draft();fixture.invoiceUrl='https://dayanassweet.com/invoice/one';
  const {client}=harness(()=>Response.json({data:{draftOrder:fixture}}),{storefrontOrigin:'https://dayanassweet.com'});
  assert.equal((await client.getDraft(gid('DraftOrder'))).invoiceUrl,fixture.invoiceUrl);
});

test('connection preflight reads installation scopes, currency and locations without customer data',async()=>{
  const {client,calls}=harness(({query})=>{
    assert.doesNotMatch(query,/email|phone|address|customer/);
    if(query.includes('currentAppInstallation'))return Response.json({data:{currentAppInstallation:{accessScopes:[{handle:'write_draft_orders'},{handle:'read_orders'},{handle:'write_order_edits'},{handle:'read_locations'}]}}});
    if(query.includes('locations('))return Response.json({data:{locations:{nodes:[{id:gid('Location'),name:'Houston',isActive:true}]}}});
    return Response.json({data:{shop:{id:gid('Shop'),currencyCode:'USD'}}});
  });
  const result=await client.checkConfiguration();
  assert.equal(result.currency,'USD');assert.equal(result.scopes.includes('write_order_edits'),true);assert.equal(result.locations[0].isActive,true);
  assert.equal(calls.length,4);
});

test('token diagnostics expose only HTTP status and recognized OAuth codes',async()=>{
  for(const code of ['invalid_client','invalid_grant','unauthorized_client','invalid_scope','invalid_request','access_denied','shop_not_permitted','invalid_shop','temporarily_unavailable']){
    const client=createShopifyPaymentClient({shop,clientId:'test-client',secret:'test-secret',fetchImpl:async()=>Response.json({error:code,error_description:'test-secret private@example.test',access_token:'test-token'},{status:400})});
    await assert.rejects(client.checkConfiguration(),error=>{
      assert.equal(error.code,'SHOPIFY_UNAVAILABLE');assert.deepEqual(error.diagnostic,{stage:'token',httpStatus:400,code});
      assert.doesNotMatch(JSON.stringify(error)+error.stack,/test-secret|test-token|private@|error_description/);return true;
    });
  }
});

test('unknown token errors, malformed bodies and transport failure never expose arbitrary strings',async()=>{
  for(const [fetchImpl,httpStatus] of [
    [async()=>Response.json({error:'test-secret private@example.test',error_description:'private'},{status:403}),403],
    [async()=>new Response('private@example.test',{status:502}),502],
    [async()=>{throw Object.assign(new Error('test-secret'),{diagnostic:{stage:'token',httpStatus:400,code:'invalid_client'}});},null],
    [async()=>Response.json({expires_in:3600,customerEmail:'private@example.test'}),200],
  ]){
    const client=createShopifyPaymentClient({shop,clientId:'test-client',secret:'test-secret',fetchImpl});
    await assert.rejects(client.checkConfiguration(),error=>{assert.deepEqual(error.diagnostic,{stage:'token',httpStatus,code:'unknown'});assert.doesNotMatch(JSON.stringify(error)+error.stack,/test-secret|private@|customerEmail/);return true;});
  }
});

test('GraphQL diagnostics retain only known extension codes and HTTP status',async()=>{
  for(const [status,code,want] of [[200,'ACCESS_DENIED','ACCESS_DENIED'],[429,'THROTTLED','THROTTLED'],[200,'undefinedField','undefinedField'],[200,'test-secret private@example.test','unknown']]){
    const {client,calls}=harness(()=>Response.json({errors:[{message:'test-secret private@example.test',path:['private'],extensions:{code,requestId:'private@example.test'}}]},{status}));
    await assert.rejects(client.checkConfiguration(),error=>{assert.equal(error.code,'SHOPIFY_UNAVAILABLE');assert.deepEqual(error.diagnostic,{stage:'graphql',httpStatus:status,code:want});assert.doesNotMatch(JSON.stringify(error)+error.stack,/test-secret|private@|requestId/);return true;});
    assert.equal(calls.length,2);
  }
});

test('diagnostic transport metadata does not change mutation review behavior or retry a failed request',async()=>{
  const {client,calls}=harness(()=>Response.json({errors:[{extensions:{code:'THROTTLED'},message:'private@example.test'}]},{status:429}));
  await assert.rejects(client.createDepositDraft(deposit),error=>{assert.equal(error.code,'PAYMENT_REVIEW');assert.deepEqual(error.diagnostic,{stage:'graphql',httpStatus:429,code:'THROTTLED'});return true;});
  assert.equal(calls.length,2);
});

test('timeout diagnostics distinguish token transport from a GraphQL response body stall',async()=>{
  const tokenClient=createShopifyPaymentClient({shop,clientId:'test-client',secret:'test-secret',fetchImpl:async()=>new Promise(()=>{}),timeoutMs:5});
  await assert.rejects(tokenClient.checkConfiguration(),error=>{assert.deepEqual(error.diagnostic,{stage:'token',httpStatus:null,code:'unknown'});return true;});
  const {client}=harness(()=>({ok:true,status:200,json:async()=>new Promise(()=>{})}),{timeoutMs:5});
  await assert.rejects(client.checkConfiguration(),error=>{assert.deepEqual(error.diagnostic,{stage:'graphql',httpStatus:200,code:'unknown'});return true;});
});

test('calculated order inspection is read-only, accepts opaque staged IDs and diagnoses invalid money before parsing',async()=>{
 for(const malformed of [false,true]){
  const fixture=calculated();fixture.__typename='CalculatedOrder';fixture.originalOrder={id:gid('Order')};
  fixture.addedLineItems=connection([{...line,id:'gid://shopify/CalculatedLineItem/new-opaque-value',quantity:1}]);
  if(malformed)fixture.totalPriceSet=money('not-a-number');
  const {client,calls}=harness(({query,variables})=>{
   assert.match(query,/^query ReadCalculatedOrder/);assert.match(query,/node\(id: \$id\)/);assert.match(query,/\.\.\. on CalculatedOrder/);assert.match(query,/originalOrder\s*\{\s*id/);assert.equal(variables.id,gid('CalculatedOrder'));
   return Response.json({data:{node:fixture}});
  });
  let shape;
  if(malformed)await assert.rejects(client.readCalculatedOrder(gid('CalculatedOrder'),{expectedOrderId:gid('Order')}),error=>{assert.equal(error.code,'PAYMENT_REVIEW');shape=error.calculatedShape;return true;});
  else{const value=await client.readCalculatedOrder(gid('CalculatedOrder'),{expectedOrderId:gid('Order')});assert.equal(value.originalOrderId,gid('Order'));shape=value.calculatedShape;}
  assert.equal(shape.originalOrderMatches,true);assert.equal(shape.idKind,'numeric');assert.equal(shape.addedLineIdKind,'opaque');assert.equal(shape.addedLineItemCount,1);assert.equal(shape.totalMoney.valid,!malformed);
  assert.doesNotMatch(JSON.stringify(shape),/gid:|new-opaque|not-a-number|title|amount/);assert.equal(calls.length,2);
 }
});

test('reopening sends only the validated own order ID to orderOpen and never retries a lost response',async()=>{
  const {client,calls}=harness(({query,variables})=>{
    assert.match(query,/mutation ReopenOrder/);assert.match(query,/orderOpen\(input: \$input\)/);assert.deepEqual(variables,{input:{id:gid('Order')}});
    assert.doesNotMatch(query,/email|phone|address|notifyCustomer|refund|Capture|settings/);
    return Response.json({data:{orderOpen:{order:{id:gid('Order'),closed:false},userErrors:[]}}});
  });
  assert.deepEqual(await client.reopenOrder(gid('Order')),{orderId:gid('Order'),closed:false});assert.equal(calls.length,2);
  const lost=harness(()=>{throw new Error('private token');});
  await assert.rejects(lost.client.reopenOrder(gid('Order')),{code:'PAYMENT_REVIEW'});assert.equal(lost.calls.length,2);
});

test('fixed price reductions use exact decimal money and return allocated discounts with their line identity',async()=>{
 const fixture=calculated();fixture.lineItems.nodes[0].calculatedDiscountAllocations=[{allocatedAmountSet:money('0.01'),discountApplication:{__typename:'CalculatedManualDiscountApplication',id:'gid://shopify/CalculatedManualDiscountApplication/abc',description:'Ajuste de precio aceptado: propuesta 2',targetType:'LINE_ITEM',value:{__typename:'MoneyV2',amount:'0.01',currencyCode:'USD'}}}];
 const {client}=harness(({query,variables})=>{
  assert.match(query,/orderEditAddLineItemDiscount/);assert.deepEqual(variables.discount,{description:'Ajuste de precio aceptado: propuesta 2',fixedValue:{amount:'0.01',currencyCode:'USD'}});assert.equal(variables.lineItemId,gid('CalculatedLineItem'));
  return Response.json({data:{orderEditAddLineItemDiscount:{calculatedOrder:fixture,userErrors:[]}}});
 });
 const result=await client.setCustomPriceDiscount({editId:gid('CalculatedOrder'),lineItemId:gid('CalculatedLineItem'),discountCents:1,proposalVersion:2});
 assert.equal(result.lineItems[0].discountCents,1);assert.equal(result.lineItems[0].discounts[0].applicationId,'gid://shopify/CalculatedManualDiscountApplication/abc');
});

test('updating an owned discount targets its calculated application rather than adding another discount',async()=>{
 const {client}=harness(({query,variables})=>{assert.match(query,/orderEditUpdateDiscount/);assert.equal(variables.discountApplicationId,'gid://shopify/CalculatedManualDiscountApplication/abc');assert.equal(variables.discount.fixedValue.amount,'20.01');return Response.json({data:{orderEditUpdateDiscount:{calculatedOrder:calculated(),userErrors:[]}}});});
 await client.setCustomPriceDiscount({editId:gid('CalculatedOrder'),lineItemId:gid('CalculatedLineItem'),discountApplicationId:'gid://shopify/CalculatedManualDiscountApplication/abc',discountCents:2001,proposalVersion:3});
});

test('discounted order snapshots preserve exact allocated money and negative outstanding credit',async()=>{
 const fixture=order();fixture.currentSubtotalPriceSet=fixture.currentTotalPriceSet=money('70.00');fixture.currentTotalTaxSet=money('0.00');fixture.currentTotalDiscountsSet=money('20.01');fixture.totalOutstandingSet=money('-10.00');fixture.fullyPaid=true;
 fixture.lineItems.nodes[0].discountAllocations=[{allocatedAmountSet:money('20.01'),discountApplication:{__typename:'ManualDiscountApplication',index:0,title:'Price adjustment',description:'Ajuste de precio aceptado: propuesta 2',targetType:'LINE_ITEM',value:{__typename:'MoneyV2',amount:'20.01',currencyCode:'USD'}}}];
 const {client}=harness(({query})=>{assert.match(query,/discountAllocations/);assert.match(query,/on ManualDiscountApplication/);return Response.json({data:{order:fixture}});});
 const value=await client.getOrder(gid('Order'));assert.equal(value.outstandingCents,-1000);assert.equal(value.totalCents,7000);assert.equal(value.discountCents,2001);assert.equal(value.lineItems[0].discountCents,2001);assert.equal(value.lineItems[0].discounts[0].valueCents,2001);
});

test('discount mutations retain validation and ambiguity semantics without retrying',async()=>{
 for(const validation of [true,false]){
  const {client,calls}=harness(()=>validation?Response.json({data:{orderEditAddLineItemDiscount:{calculatedOrder:null,userErrors:[{message:'private token',field:['discount']}]}}}):Promise.reject(new Error('private token')));
  await assert.rejects(client.setCustomPriceDiscount({editId:gid('CalculatedOrder'),lineItemId:gid('CalculatedLineItem'),discountCents:1,proposalVersion:2}),error=>{assert.equal(error.code,validation?'VALIDATION':'PAYMENT_REVIEW');assert.doesNotMatch(error.stack,/private token/);return true;});assert.equal(calls.length,2);
 }
});
