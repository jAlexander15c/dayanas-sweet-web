// Server-only Admin GraphQL 2026-10 transport. No business state or payment capture.
// Schema references: https://shopify.dev/docs/api/admin-graphql/2026-10
// Grant: https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
const API_VERSION = '2026-10';
const shopPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;
const markerPattern = /^[A-Za-z0-9_-]{1,100}$/;
const oauthDiagnosticCodes=new Set(['invalid_client','invalid_grant','unauthorized_client','invalid_scope','invalid_request','access_denied','shop_not_permitted','invalid_shop','temporarily_unavailable']);
const graphqlDiagnosticCodes=new Set(['ACCESS_DENIED','THROTTLED','INTERNAL_SERVER_ERROR','SHOP_INACTIVE','MAX_COST_EXCEEDED','GRAPHQL_VALIDATION_FAILED','undefinedField','argumentNotAccepted','variableRequiresValidType','missingRequiredArguments','variableMismatch']);
const moneyFields = 'shopMoney { amount currencyCode } presentmentMoney { amount currencyCode }';
const lineFields = `id title quantity originalUnitPriceSet { ${moneyFields} }`;
const discountValueFields='value { __typename ... on MoneyV2 { amount currencyCode } }';
const orderDiscountFields=`discountAllocations { allocatedAmountSet { ${moneyFields} } discountApplication { __typename index targetType ${discountValueFields} ... on ManualDiscountApplication { description title } } }`;
const calculatedDiscountFields=`calculatedDiscountAllocations { allocatedAmountSet { ${moneyFields} } discountApplication { __typename id description appliedTo targetType ${discountValueFields} } }`;
const lines = `lineItems(first: 250) { nodes { ${lineFields} } pageInfo { hasNextPage } }`;
const draftFields = `id status invoiceUrl customer { id } order { id } currencyCode presentmentCurrencyCode
  subtotalPriceSet { ${moneyFields} } totalTaxSet { ${moneyFields} } totalPriceSet { ${moneyFields} }
  totalDiscountsSet { ${moneyFields} } totalShippingPriceSet { ${moneyFields} }
  taxesIncluded taxExempt tags customAttributes { key value } ${lines}`;
const calculatedFields = `id subtotalPriceSet { ${moneyFields} } totalPriceSet { ${moneyFields} }
  totalOutstandingSet { ${moneyFields} } taxLines { title priceSet { ${moneyFields} } }
  lineItems(first: 250) { nodes { ${lineFields} editableQuantity ${calculatedDiscountFields} } pageInfo { hasNextPage } }
  addedLineItems(first: 250) { nodes { ${lineFields} editableQuantity ${calculatedDiscountFields} } pageInfo { hasNextPage } }`;
const collectionField = 'paymentCollectionDetails { additionalPaymentCollectionUrl }';
const orderFields = `id customer { id } test currencyCode presentmentCurrencyCode displayFinancialStatus
  cancelledAt closed fullyPaid taxesIncluded tags updatedAt ${collectionField}
  lineItems(first: 250) { nodes { ${lineFields} currentQuantity ${orderDiscountFields} } pageInfo { hasNextPage } }
  subtotalPriceSet { ${moneyFields} } totalTaxSet { ${moneyFields} } totalPriceSet { ${moneyFields} }
  currentSubtotalPriceSet { ${moneyFields} } currentTotalTaxSet { ${moneyFields} } currentTotalPriceSet { ${moneyFields} }
  currentTotalDiscountsSet { ${moneyFields} } totalShippingPriceSet { ${moneyFields} }
  totalOutstandingSet { ${moneyFields} } totalReceivedSet { ${moneyFields} }
  totalRefundedSet { ${moneyFields} } netPaymentSet { ${moneyFields} }
  transactions { id kind status test gateway manualPaymentGateway amountSet { ${moneyFields} } parentTransaction { id } }`;

/** The only diagnostic fields allowed across the server/panel boundary. */
export function sanitizePaymentDiagnostic(value) {
  const stage=['token','graphql'].includes(value?.stage)?value.stage:null;
  const httpStatus=Number.isInteger(value?.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599?value.httpStatus:null;
  const known=stage==='token'?oauthDiagnosticCodes:stage==='graphql'?graphqlDiagnosticCodes:null;
  return {stage,httpStatus,code:known?.has(value?.code)?value.code:'unknown'};
}

export function sanitizeCalculatedOrderDiagnostic(value) {
  const kind=value=>['none','numeric','opaque','parameterized','mixed','invalid'].includes(value)?value:'invalid';
  const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=250?value:null;
  const flag=value=>typeof value==='boolean'?value:null;
  const moneyShape=value=>({currencyPresent:value?.currencyPresent===true,valid:value?.valid===true});
  return {idKind:kind(value?.idKind),addedLineIdKind:kind(value?.addedLineIdKind),originalOrderMatches:value?.originalOrderMatches===true,
    lineItemCount:count(value?.lineItemCount),addedLineItemCount:count(value?.addedLineItemCount),hasNextPage:flag(value?.hasNextPage),addedHasNextPage:flag(value?.addedHasNextPage),
    subtotalMoney:moneyShape(value?.subtotalMoney),totalMoney:moneyShape(value?.totalMoney),outstandingMoney:moneyShape(value?.outstandingMoney),taxLineCount:count(value?.taxLineCount),taxMoneyValid:value?.taxMoneyValid===true};
}

function calculatedShape(value,expectedOrderId) {
  const kind=id=>{
    if(typeof id!=='string'||!/^gid:\/\/shopify\/[A-Za-z]+\/[^/?#\s]+(?:\?[^#\s]+)?$/.test(id))return 'invalid';
    if(id.includes('?'))return 'parameterized';
    return /\/[1-9][0-9]*$/.test(id)?'numeric':'opaque';
  };
  const added=value?.addedLineItems?.nodes;
  const kinds=Array.isArray(added)?[...new Set(added.map(line=>kind(line?.id)))]:['invalid'];
  const moneyShape=bag=>{
    let valid=false;try{money(bag);valid=true;}catch{}
    return {currencyPresent:typeof bag?.shopMoney?.currencyCode==='string'&&typeof bag?.presentmentMoney?.currencyCode==='string',valid};
  };
  return sanitizeCalculatedOrderDiagnostic({idKind:kind(value?.id),addedLineIdKind:kinds.length===0?'none':kinds.length===1?kinds[0]:'mixed',originalOrderMatches:value?.originalOrder?.id===expectedOrderId,
    lineItemCount:value?.lineItems?.nodes?.length,addedLineItemCount:added?.length,hasNextPage:value?.lineItems?.pageInfo?.hasNextPage,addedHasNextPage:value?.addedLineItems?.pageInfo?.hasNextPage,
    subtotalMoney:moneyShape(value?.subtotalPriceSet),totalMoney:moneyShape(value?.totalPriceSet),outstandingMoney:moneyShape(value?.totalOutstandingSet),taxLineCount:value?.taxLines?.length,
    taxMoneyValid:Array.isArray(value?.taxLines)&&value.taxLines.every(tax=>moneyShape(tax?.priceSet).valid)});
}

function fail(code,diagnostic) {
  const messages = {
    CONFIGURATION: 'Configuración de pagos no disponible.',
    VALIDATION: 'No se pudo validar la operación de pagos.',
    PAYMENT_REVIEW: 'La operación requiere conciliación de pagos.',
    SHOPIFY_UNAVAILABLE: 'Shopify no está disponible para esta consulta.',
  };
  return Object.assign(new Error(messages[code]), { code,...(diagnostic?{diagnostic:sanitizePaymentDiagnostic(diagnostic)}:{}) });
}

function requireValue(condition, code = 'VALIDATION') { if (!condition) throw fail(code); }
function gid(value, type, code = 'VALIDATION') {
  // Staged line items use opaque IDs before an order edit is committed.
  const suffix = type === 'CalculatedLineItem' ? '[A-Za-z0-9_-]{1,200}' : '[1-9][0-9]*';
  requireValue(typeof value === 'string' && new RegExp(`^gid://shopify/${type}/${suffix}$`).test(value), code);
  return value;
}
function customerGid(value) {
  return gid(typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? `gid://shopify/Customer/${value}` : value, 'Customer');
}
function editGid(value) {
  requireValue(typeof value === 'string' && /^gid:\/\/shopify\/(CalculatedOrder|OrderEditSession)\/[1-9][0-9]*$/.test(value));
  return value;
}
function centsInput(value) { requireValue(Number.isSafeInteger(value) && value > 0); return BigInt(value); }
function decimal(cents) { return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`; }
function marker(requestId, proposalVersion) {
  requireValue(typeof requestId === 'string' && markerPattern.test(requestId) && Number.isSafeInteger(proposalVersion) && proposalVersion > 0);
  return `${requestId}/v${proposalVersion}`;
}
function moneyCents(value) {
  requireValue(typeof value === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(value), 'PAYMENT_REVIEW');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const amount = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (negative ? -1n : 1n);
  requireValue(amount <= BigInt(Number.MAX_SAFE_INTEGER) && amount >= BigInt(Number.MIN_SAFE_INTEGER), 'PAYMENT_REVIEW');
  return Number(amount);
}
function money(bag) {
  requireValue(bag?.shopMoney?.currencyCode === 'USD' && bag?.presentmentMoney?.currencyCode === 'USD', 'PAYMENT_REVIEW');
  const cents = moneyCents(bag.shopMoney.amount);
  requireValue(cents === moneyCents(bag.presentmentMoney.amount), 'PAYMENT_REVIEW');
  return cents;
}
function readLines(connection, currentOrder = false) {
  requireValue(Array.isArray(connection?.nodes) && connection.pageInfo?.hasNextPage === false, 'PAYMENT_REVIEW');
  return connection.nodes.map(line => {
    requireValue(typeof line.id === 'string' && typeof line.title === 'string' && Number.isSafeInteger(line.quantity) && line.quantity >= 0, 'PAYMENT_REVIEW');
    if (currentOrder) requireValue(Number.isSafeInteger(line.currentQuantity) && line.currentQuantity >= 0, 'PAYMENT_REVIEW');
    const allocations=(currentOrder?line.discountAllocations:line.calculatedDiscountAllocations)??[];
    requireValue(Array.isArray(allocations),'PAYMENT_REVIEW');
    const discounts=allocations.map(allocation=>{
      const application=allocation.discountApplication;
      requireValue(application&&typeof application.__typename==='string','PAYMENT_REVIEW');
      const fixed=application.value?.__typename==='MoneyV2';
      if(fixed)requireValue(application.value.currencyCode==='USD','PAYMENT_REVIEW');
      return {amountCents:money(allocation.allocatedAmountSet),kind:application.__typename,applicationId:application.id??null,description:application.description??application.title??null,targetType:application.targetType,valueType:application.value?.__typename??null,valueCents:fixed?moneyCents(application.value.amount):null};
    });
    const discountCents=discounts.reduce((sum,discount)=>sum+discount.amountCents,0);
    requireValue(Number.isSafeInteger(discountCents)&&discountCents>=0,'PAYMENT_REVIEW');
    return { id: line.id, title: line.title, quantity: currentOrder ? line.currentQuantity : line.quantity, baseCents: money(line.originalUnitPriceSet),discountCents,discounts, ...(currentOrder ? { originalQuantity: line.quantity } : {}), ...(line.editableQuantity === undefined ? {} : { editableQuantity: line.editableQuantity }) };
  });
}
function calculatedSnapshot(value) {
  requireValue(value, 'PAYMENT_REVIEW');
  requireValue(Array.isArray(value.taxLines), 'PAYMENT_REVIEW');
  return {
    id: gid(value.id, 'CalculatedOrder', 'PAYMENT_REVIEW'), currency: 'USD',
    subtotalCents: value.subtotalPriceSet === null ? null : money(value.subtotalPriceSet), totalCents: money(value.totalPriceSet), outstandingCents: money(value.totalOutstandingSet),
    taxLines: value.taxLines.map(tax => ({ title: tax.title, amountCents: money(tax.priceSet), currency: 'USD' })),
    lineItems: readLines(value.lineItems), addedLineItems: readLines(value.addedLineItems),
  };
}

/** No retries: a lost mutation response must be reconciled by the caller.
 * now() is epoch milliseconds; timeoutMs is a bounded request/body timeout.
 * The caller owns durable operationId uniqueness, authorization and eligibility.
 */
export function createShopifyPaymentClient({ shop, clientId, secret, storefrontOrigin, fetchImpl = (...args) => globalThis.fetch(...args), now = Date.now, timeoutMs = 10_000 } = {}) {
  requireValue(typeof shop === 'string' && shopPattern.test(shop) && typeof clientId === 'string' && clientId.trim() && typeof secret === 'string' && secret.trim() && typeof fetchImpl === 'function' && typeof now === 'function' && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000, 'CONFIGURATION');
  let cachedToken;
  let pendingToken;
  let storefrontHost=null;
  if(storefrontOrigin){try{const origin=new URL(storefrontOrigin);requireValue(origin.protocol==='https:'&&!origin.username&&!origin.password&&!origin.port&&origin.origin===storefrontOrigin,'CONFIGURATION');storefrontHost=origin.hostname;}catch{throw fail('CONFIGURATION');}}
  const epoch = () => { const value = now(); requireValue(Number.isSafeInteger(value) && value >= 0, 'CONFIGURATION'); return value; };

  async function requestJson(url, init, errorCode, stage) {
    const controller = new AbortController();
    let timer;
    const diagnostic={stage,httpStatus:null,code:'unknown'};
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'manual' });
          diagnostic.httpStatus=Number.isInteger(response?.status)&&response.status>=100&&response.status<=599?response.status:null;
          // Workers has no redirect:error mode. Never follow a redirect with
          // app credentials or an Admin API token, even to another Shopify host.
          if (response.status >= 300 && response.status < 400) throw fail(errorCode, diagnostic);
          const value=await response.json();
          if(!response.ok){
            diagnostic.code=stage==='token'?value?.error:value?.errors?.[0]?.extensions?.code;
            throw fail(errorCode,diagnostic);
          }
          return {value,httpStatus:diagnostic.httpStatus};
        })(),
        new Promise((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail(errorCode)); }, timeoutMs); }),
      ]);
    } catch {
      // Never propagate raw transport errors, response bodies, tokens or PII.
      throw fail(errorCode,diagnostic);
    } finally { clearTimeout(timer); }
  }

  async function token() {
    if (cachedToken && epoch() < cachedToken.expiresAt) return cachedToken.value;
    if (!pendingToken) pendingToken = (async () => {
      const startedAt = epoch();
      const {value:result,httpStatus} = await requestJson(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }).toString(),
      }, 'SHOPIFY_UNAVAILABLE','token');
      if(!(typeof result?.access_token === 'string' && result.access_token.length > 0 && Number.isSafeInteger(result.expires_in) && result.expires_in > 0 && result.expires_in <= 86_400))throw fail('SHOPIFY_UNAVAILABLE',{stage:'token',httpStatus,code:result?.error});
      const lifetime = result.expires_in * 1000;
      cachedToken = { value: result.access_token, expiresAt: startedAt + lifetime - Math.min(60_000, Math.floor(lifetime / 10)) };
      return cachedToken.value;
    })().finally(() => { pendingToken = undefined; });
    return pendingToken;
  }

  async function graphql(query, variables, root, mutation = false) {
    // Token failures occur before sending the mutation and are not ambiguous.
    const accessToken = await token();
    const errorCode = mutation ? 'PAYMENT_REVIEW' : 'SHOPIFY_UNAVAILABLE';
    const {value:result,httpStatus} = await requestJson(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken }, body: JSON.stringify({ query, variables }),
    }, errorCode,'graphql');
    if(!(result && !result.errors?.length && result.data && Object.hasOwn(result.data, root)))throw fail(errorCode,{stage:'graphql',httpStatus,code:result?.errors?.[0]?.extensions?.code});
    const value = result.data[root];
    if(!value)throw fail(errorCode,{stage:'graphql',httpStatus,code:'unknown'});
    if (mutation) {
      requireValue(Array.isArray(value.userErrors), 'PAYMENT_REVIEW');
      requireValue(value.userErrors.length === 0, 'VALIDATION');
    }
    return value;
  }

  function paymentUrl(value) {
    if (value === null) return null;
    try {
      requireValue(typeof value === 'string', 'PAYMENT_REVIEW');
      const url = new URL(value);
      requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.port && [shop,storefrontHost,'checkout.shopify.com'].includes(url.hostname), 'PAYMENT_REVIEW');
      return url.href;
    } catch { throw fail('PAYMENT_REVIEW'); }
  }

  function draftSnapshot(value, locationId = null) {
    requireValue(value && value.currencyCode === 'USD' && value.presentmentCurrencyCode === 'USD', 'PAYMENT_REVIEW');
    return {
      id: gid(value.id, 'DraftOrder', 'PAYMENT_REVIEW'), status: value.status, invoiceUrl: paymentUrl(value.invoiceUrl), customerId: value.customer?.id ?? null, orderId: value.order?.id ?? null,
      currency: 'USD', subtotalCents: money(value.subtotalPriceSet), taxCents: money(value.totalTaxSet), totalCents: money(value.totalPriceSet),
      discountCents: money(value.totalDiscountsSet), shippingCents: money(value.totalShippingPriceSet), taxesIncluded: value.taxesIncluded, taxExempt: value.taxExempt,
      tags: value.tags, customAttributes: value.customAttributes, lineItems: readLines(value.lineItems),
      // DraftOrderInput has no locationId. This is metadata, never a pickup/address claim.
      logistics: { validated: false, locationId },
    };
  }

  return Object.freeze({
    async checkConfiguration() {
      const installation=await graphql('query PaymentScopes { currentAppInstallation { accessScopes { handle } } }',{},'currentAppInstallation');
      requireValue(Array.isArray(installation.accessScopes)&&installation.accessScopes.every(scope=>typeof scope.handle==='string'),'SHOPIFY_UNAVAILABLE');
      const scopes=installation.accessScopes.map(scope=>scope.handle);
      const shopInfo=await graphql('query PaymentShop { shop { id currencyCode } }',{},'shop');
      requireValue(typeof shopInfo.currencyCode==='string','SHOPIFY_UNAVAILABLE');
      let locations=[];
      if(scopes.includes('read_locations')){
        const result=await graphql('query PaymentLocations { locations(first: 10) { nodes { id name isActive } } }',{},'locations');
        requireValue(Array.isArray(result.nodes),'SHOPIFY_UNAVAILABLE');
        locations=result.nodes.map(location=>({id:gid(location.id,'Location','SHOPIFY_UNAVAILABLE'),name:String(location.name),isActive:location.isActive===true}));
      }
      return {scopes,currency:shopInfo.currencyCode,locations};
    },
    async createDepositDraft({ requestId, proposalVersion, operationId, customerId, baseCents, urgent, locationId = null } = {}) {
      const label = marker(requestId, proposalVersion);
      requireValue(typeof operationId === 'string' && markerPattern.test(operationId) && typeof urgent === 'boolean');
      if (locationId !== null) gid(locationId, 'Location');
      const fullBase = centsInput(baseCents);
      const depositBase = urgent ? fullBase : (fullBase * 60n + 99n) / 100n;
      const input = {
        ...(customerId===null?{}:{purchasingEntity:{customerId:customerGid(customerId)}}), presentmentCurrencyCode: 'USD',
        // Boxed cake exemption applies only to this integration's custom cake line.
        lineItems: [{ title: `${urgent ? 'Pago completo' : 'Anticipo'} pastel [${label}]`, quantity: 1, originalUnitPriceWithCurrency: { amount: decimal(depositBase), currencyCode: 'USD' }, taxable: false, requiresShipping: false }],
        tags: ['ds-celebraciones', `ds-request:${requestId}`, `ds-version:${proposalVersion}`, `ds-operation:${operationId}`],
        acceptAutomaticDiscounts: false, allowDiscountCodesInCheckout: false, taxExempt: false, useCustomerDefaultAddress: false,
        customAttributes: [{ key: 'ds-operation', value: operationId }, { key: 'ds-logistics-validated', value: 'false' }, ...(locationId ? [{ key: 'ds-requested-location', value: locationId }] : [])],
      };
      const result = await graphql(`mutation CreateDepositDraft($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { ${draftFields} } userErrors { field message } } }`, { input }, 'draftOrderCreate', true);
      requireValue(customerId===null?result.draftOrder?.customer==null:result.draftOrder?.customer?.id===input.purchasingEntity.customerId, 'PAYMENT_REVIEW');
      return draftSnapshot(result.draftOrder, locationId);
    },

    async getDraft(id) {
      const result = await graphql(`query GetDraft($id: ID!) { draftOrder(id: $id) { ${draftFields} } }`, { id: gid(id, 'DraftOrder') }, 'draftOrder');
      requireValue(result.id === id, 'PAYMENT_REVIEW');
      const requestedLocation = result.customAttributes?.find(attribute => attribute.key === 'ds-requested-location')?.value ?? null;
      return draftSnapshot(result, requestedLocation);
    },

    async findDraftByOperation({requestId,operationId}={}) {
      requireValue(typeof requestId==='string'&&markerPattern.test(requestId)&&typeof operationId==='string'&&markerPattern.test(operationId));
      const result=await graphql(`query FindDraftByOperation($query: String!) { draftOrders(first: 2, query: $query) { nodes { ${draftFields} } pageInfo { hasNextPage } } }`,{query:`tag:"ds-request:${requestId}" AND tag:"ds-operation:${operationId}"`},'draftOrders');
      requireValue(Array.isArray(result.nodes)&&result.pageInfo?.hasNextPage===false,'PAYMENT_REVIEW');
      return result.nodes.map(value=>draftSnapshot(value));
    },

    async getOrder(id) {
      const value = await graphql(`query GetOrder($id: ID!) { order(id: $id) { ${orderFields} } }`, { id: gid(id, 'Order') }, 'order');
      requireValue(value.id === id, 'PAYMENT_REVIEW');
      requireValue(value.currencyCode === 'USD' && value.presentmentCurrencyCode === 'USD' && Array.isArray(value.transactions) && typeof value.test === 'boolean', 'PAYMENT_REVIEW');
      return {
        id: gid(value.id, 'Order', 'PAYMENT_REVIEW'), customerId: value.customer?.id ?? null, test: value.test, currency: 'USD',
        subtotalCents: money(value.currentSubtotalPriceSet), taxCents: money(value.currentTotalTaxSet), totalCents: money(value.currentTotalPriceSet),
        originalSubtotalCents: money(value.subtotalPriceSet), originalTaxCents: money(value.totalTaxSet), originalTotalCents: money(value.totalPriceSet),
        outstandingCents: money(value.totalOutstandingSet), receivedCents: money(value.totalReceivedSet), refundedCents: money(value.totalRefundedSet), netPaymentCents: money(value.netPaymentSet),
        discountCents:money(value.currentTotalDiscountsSet),shippingCents:money(value.totalShippingPriceSet),
        taxesIncluded: value.taxesIncluded, displayFinancialStatus: value.displayFinancialStatus, cancelledAt: value.cancelledAt, closed: value.closed, fullyPaid: value.fullyPaid, updatedAt: value.updatedAt,
        tags: value.tags, lineItems: readLines(value.lineItems, true), additionalPaymentCollectionUrl: paymentUrl(value.paymentCollectionDetails?.additionalPaymentCollectionUrl ?? null),
        transactions: value.transactions.map(transaction => {
          requireValue(typeof transaction.test === 'boolean' && typeof transaction.kind === 'string' && typeof transaction.status === 'string', 'PAYMENT_REVIEW');
          return { id: gid(transaction.id, 'OrderTransaction', 'PAYMENT_REVIEW'), kind: transaction.kind, status: transaction.status, test: transaction.test, gateway:transaction.gateway,manualPaymentGateway:transaction.manualPaymentGateway,amountCents: money(transaction.amountSet), currency: 'USD', parentId: transaction.parentTransaction?.id ?? null };
        }),
      };
    },

    async getAdditionalPaymentUrl(id) {
      const value = await graphql(`query GetAdditionalPaymentUrl($id: ID!) { order(id: $id) { id ${collectionField} } }`, { id: gid(id, 'Order') }, 'order');
      requireValue(value.id === id, 'PAYMENT_REVIEW');
      return paymentUrl(value.paymentCollectionDetails?.additionalPaymentCollectionUrl ?? null);
    },

    async readCalculatedOrder(id,{expectedOrderId}={}) {
      gid(id,'CalculatedOrder');
      if(expectedOrderId!==undefined)gid(expectedOrderId,'Order');
      const value=await graphql(`query ReadCalculatedOrder($id: ID!) { node(id: $id) { __typename ... on CalculatedOrder { originalOrder { id } ${calculatedFields} } } }`,{id},'node');
      const shape=calculatedShape(value,expectedOrderId);
      try{
        requireValue(value.__typename==='CalculatedOrder'&&value.id===id,'PAYMENT_REVIEW');
        return {...calculatedSnapshot(value),originalOrderId:gid(value.originalOrder?.id,'Order','PAYMENT_REVIEW'),calculatedShape:shape};
      }catch{
        throw Object.assign(fail('PAYMENT_REVIEW'),{calculatedShape:shape});
      }
    },

    async reopenOrder(id) {
      gid(id,'Order');
      const value=await graphql('mutation ReopenOrder($input: OrderOpenInput!) { orderOpen(input: $input) { order { id closed } userErrors { field message } } }',{input:{id}},'orderOpen',true);
      requireValue(value.order?.id===id&&typeof value.order.closed==='boolean','PAYMENT_REVIEW');
      return {orderId:id,closed:value.order.closed};
    },

    async setCustomPriceDiscount({editId,lineItemId,discountApplicationId=null,discountCents,proposalVersion}={}) {
      const id=editGid(editId);gid(lineItemId,'CalculatedLineItem');
      requireValue(Number.isSafeInteger(proposalVersion)&&proposalVersion>0);
      const discount={description:`Ajuste de precio aceptado: propuesta ${proposalVersion}`,fixedValue:{amount:decimal(centsInput(discountCents)),currencyCode:'USD'}};
      let value;
      if(discountApplicationId){
        requireValue(typeof discountApplicationId==='string'&&/^gid:\/\/shopify\/Calculated(?:Manual)?DiscountApplication\/[^\s/?#]+(?:\?[^\s#]+)?$/.test(discountApplicationId));
        value=await graphql(`mutation UpdatePriceDiscount($id: ID!, $discountApplicationId: ID!, $discount: OrderEditAppliedDiscountInput!) { orderEditUpdateDiscount(id: $id, discountApplicationId: $discountApplicationId, discount: $discount) { calculatedOrder { ${calculatedFields} } userErrors { field message } } }`,{id,discountApplicationId,discount},'orderEditUpdateDiscount',true);
      }else value=await graphql(`mutation AddPriceDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) { orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) { calculatedOrder { ${calculatedFields} } userErrors { field message } } }`,{id,lineItemId,discount},'orderEditAddLineItemDiscount',true);
      return calculatedSnapshot(value.calculatedOrder);
    },

    async beginOrderEdit(orderId) {
      const value = await graphql(`mutation BeginOrderEdit($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { ${calculatedFields} } userErrors { field message } } }`, { id: gid(orderId, 'Order') }, 'orderEditBegin', true);
      return calculatedSnapshot(value.calculatedOrder);
    },

    async addCustomBalance({ editId, requestId, proposalVersion, baseCents, locationId = null } = {}) {
      const title = `Saldo pastel [${marker(requestId, proposalVersion)}]`;
      const amount = decimal(centsInput(baseCents));
      if (locationId !== null) gid(locationId, 'Location');
      const value = await graphql(`mutation AddCustomBalance($id: ID!, $title: String!, $price: MoneyInput!, $locationId: ID) {
        orderEditAddCustomItem(id: $id, title: $title, price: $price, locationId: $locationId, quantity: 1, taxable: false, requiresShipping: false) {
          calculatedOrder { ${calculatedFields} } calculatedLineItem { id } userErrors { field message }
        } }`, { id: editGid(editId), title, price: { amount, currencyCode: 'USD' }, locationId }, 'orderEditAddCustomItem', true);
      return { calculatedOrder: calculatedSnapshot(value.calculatedOrder), lineItemId: gid(value.calculatedLineItem?.id, 'CalculatedLineItem', 'PAYMENT_REVIEW') };
    },

    async removeLine({ editId, lineItemId } = {}) {
      const value = await graphql(`mutation RemoveLine($id: ID!, $lineItemId: ID!) { orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: 0, restock: false) { calculatedOrder { ${calculatedFields} } userErrors { field message } } }`, { id: editGid(editId), lineItemId: gid(lineItemId, 'CalculatedLineItem') }, 'orderEditSetQuantity', true);
      return calculatedSnapshot(value.calculatedOrder);
    },

    async commitOrderEdit(editId) {
      const value = await graphql('mutation CommitOrderEdit($id: ID!) { orderEditCommit(id: $id, notifyCustomer: false) { order { id } userErrors { field message } } }', { id: editGid(editId) }, 'orderEditCommit', true);
      return { orderId: gid(value.order?.id, 'Order', 'PAYMENT_REVIEW') };
    },
  });
}
