// All remote mutations have a durable preflight checkpoint. Browser input never
// supplies Shopify IDs, amounts, financial state or customer identity.
import {sanitizePaymentDiagnostic,sanitizeCalculatedOrderDiagnostic} from './shopify-payments.mjs';
const failure = code => Object.assign(new Error(code), { code });
function requireValue(ok, code='PAYMENT_REVIEW') { if (!ok) throw failure(code); }
const cents = value => Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000;
const diagnosticPhases=new Set(['claim','recover-draft','draft-create','read-draft','read-order','validate-ledger','validate-lines','reconcile-order','read-calculated-order','prepare-order-edit','order-open','verify-opened-order','edit-begin','edit-remove','edit-add','edit-discount','validate-calculated','edit-commit','verify-committed-order','get-payment-url','verify-payment-link','validate-payment-url']);
const uncertainPhases=new Set(['draft-create','order-open','edit-begin','edit-remove','edit-add','edit-discount','edit-commit','edit-incomplete']);
const diagnosticReasons=new Set(['OPERATION_REPLAY_OR_BUSY','DRAFT_RECOVERY_UNRESOLVED','UNCERTAIN_OPERATION','STAGED_EDIT_INSPECTED','INITIAL_CHECKOUT_NOT_CREATED','DRAFT_PROPOSAL_CHANGED','ORDER_CANCELLED','PAYMENT_PENDING','DEPOSIT_UNCONFIRMED','CHECKOUT_PROPOSAL_CHANGED','ORDER_CLOSED','ORDER_STILL_CLOSED','CALCULATED_MISMATCH','PAYMENT_URL_MISSING','PAYMENT_URL_UNTRUSTED','PAYMENT_STATE_CHANGED','OVERPAYMENT','VALIDATION_ERROR','PAYMENT_REVIEW','SHOPIFY_UNAVAILABLE','UNEXPECTED_ERROR']);
const discountDiagnosticFlags=['identityMatches','baseMatches','quantityMatches','allocationCountMatches','allocatedAmountMatches','kindMatches','targetTypeMatches','fixedValueMatches','descriptionMatches','noUnexpectedDiscounts'];
function safeDiscountDiagnostic(value){
  const result={};
  for(const key of ['currentMatches','plannedMatches','plannedWithoutZeroMatches','plannedTargetMatches','aggregateMatches'])result[key]=value?.[key]===true;
  for(const key of ['lineCount','discountedLineCount','allocationCount','zeroAllocationCount','expectedLineCount'])result[key]=Number.isSafeInteger(value?.[key])&&value[key]>=0&&value[key]<=62500?value[key]:null;
  for(const key of ['current','planned'])result[key]=value?.[key]?Object.fromEntries(discountDiagnosticFlags.map(flag=>[flag,value[key][flag]===true])):null;
  return result;
}

export function createPaymentService({ store, client, mode='TEST', storefrontOrigin, now=Date.now, onDiagnostic } = {}) {
  requireValue(store && client && ['TEST','REAL'].includes(mode), 'UNAVAILABLE');
  const expectedTest = mode === 'TEST';
  const trustedStorefront = storefrontOrigin ? new URL(storefrontOrigin).hostname : null;
  function report(phase,uncertainPhase,reason,error,inspection) {
    if(typeof onDiagnostic!=='function')return;
    const value={phase:diagnosticPhases.has(phase)?phase:null,uncertainPhase:uncertainPhases.has(uncertainPhase)?uncertainPhase:null,reason:diagnosticReasons.has(reason)?reason:'UNEXPECTED_ERROR',diagnostic:sanitizePaymentDiagnostic(error?.diagnostic)};
    const shape=inspection?.calculatedShape||error?.calculatedShape;
    if(shape)value.calculatedShape=sanitizeCalculatedOrderDiagnostic(shape);
    if(error?.discountLedger)value.discountLedger=safeDiscountDiagnostic(error.discountLedger);
    if(inspection)value.stagedEdit={matchesExpectedOrder:inspection.matchesExpectedOrder===true,stagedBalanceCount:Number.isSafeInteger(inspection.stagedBalanceCount)&&inspection.stagedBalanceCount>=0&&inspection.stagedBalanceCount<=250?inspection.stagedBalanceCount:null,matchesTarget:inspection.matchesTarget===true,matchesSubtotal:inspection.matchesSubtotal===true,matchesOutstanding:inspection.matchesOutstanding===true,matchesTax:inspection.matchesTax===true};
    try{
      const result=onDiagnostic(value);
      if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});
    }catch{/* Logging must never change a financial operation or its outcome. */}
  }
  async function checkConfiguration() {
    try{
      const value=await client.checkConfiguration();
      const missingScopes=['write_draft_orders','read_orders','write_order_edits','read_customers','write_orders'].filter(scope=>!value.scopes.includes(scope)&&!(scope==='read_orders'&&value.scopes.includes('write_orders')));
      return {configured:missingScopes.length===0&&value.currency==='USD',mode,scopes:value.scopes,locations:value.locations,currency:value.currency,missingScopes};
    }catch(error){
      return {configured:false,mode,currency:null,scopes:[],locations:[],missingScopes:[],diagnostic:sanitizePaymentDiagnostic(error?.diagnostic)};
    }
  }
  function safeUrl(value,shop) {
    if(value===null)return null;
    try { const url=new URL(value); requireValue(url.protocol==='https:' && !url.username && !url.password && !url.port && [shop,trustedStorefront,'checkout.shopify.com'].includes(url.hostname));return url.href; }
    catch { throw failure('PAYMENT_REVIEW'); }
  }
  function tags(value,state,id) {
    requireValue(Array.isArray(value.tags) && ['ds-celebraciones',`ds-request:${id}`,`ds-version:${state.originProposalVersion}`,`ds-operation:${state.originOperationId}`].every(tag=>value.tags.includes(tag)));
  }
  function verifyDraft(value,context,id) {
    const {state,customerId}=context;
    requireValue(value && value.customerId===`gid://shopify/Customer/${customerId}` && value.currency==='USD');
    tags(value,state,id);
    requireValue(value.subtotalCents===state.initialDepositCents && value.totalCents===state.initialDepositCents && value.taxCents===0 && value.discountCents===0 && value.shippingCents===0);
    requireValue(Array.isArray(value.lineItems) && value.lineItems.length===1 && value.lineItems[0].baseCents===state.initialDepositCents && value.lineItems[0].quantity===1 && value.lineItems[0].title===`${state.urgent?'Pago completo':'Anticipo'} pastel [${id}/v${state.originProposalVersion}]`);
  }
  function discountsMatch(lines,expected={},calculated=false){
    const active=lines.filter(line=>line.quantity>0);
    if(Object.keys(expected).some(id=>!active.some(line=>line.id===id)))return false;
    return active.every(line=>{
      const owned=expected[line.id],allocations=line.discounts??[],amount=line.discountCents??0;
      if(!Array.isArray(allocations)||!cents(amount)||!allocations.every(discount=>cents(discount.amountCents)))return false;
      // Shopify preserves replaced applications with zero allocation. Only
      // positive allocations describe the current economic discount.
      const discounts=allocations.filter(discount=>discount.amountCents!==0);
      if(!owned)return amount===0&&discounts.length===0;
      if(line.quantity!==1||line.baseCents!==owned.baseCents||amount!==owned.amountCents||!cents(amount)||amount===0||amount>line.baseCents||discounts.length!==1)return false;
      const discount=discounts[0];
      return discount.kind===(calculated?'CalculatedManualDiscountApplication':'ManualDiscountApplication')&&discount.targetType==='LINE_ITEM'&&discount.valueType==='MoneyV2'&&discount.valueCents===amount&&discount.amountCents===amount&&discount.description===owned.description;
    });
  }
  function verifyOrderDiscounts(order,state){
    const current=state.ownedDiscounts||{},planned=state.discountPlan;
    const currentMatches=discountsMatch(order.lineItems,current),plannedMatches=!!(planned&&discountsMatch(order.lineItems,planned.expectedOwned)),plannedTargetMatches=!!(planned&&order.totalCents===planned.targetCents);
    const active=order.lineItems.filter(line=>line.quantity>0),aggregateMatches=cents(order.discountCents)&&active.reduce((sum,line)=>sum+(line.discountCents||0),0)===order.discountCents;
    if((currentMatches||(plannedTargetMatches&&plannedMatches))&&aggregateMatches)return;
    // Diagnostic comparison only: financial validation above is unchanged.
    const withoutZero=order.lineItems.map(line=>({...line,discounts:(line.discounts||[]).filter(discount=>discount.amountCents!==0)}));
    const plannedWithoutZeroMatches=!!(planned&&discountsMatch(withoutZero,planned.expectedOwned));
    function inspect(expected){
      const result=Object.fromEntries(discountDiagnosticFlags.map(flag=>[flag,true]));
      for(const [id,owned]of Object.entries(expected)){
        const line=active.find(item=>item.id===id);if(!line){result.identityMatches=false;continue;}
        result.baseMatches&&=line.baseCents===owned.baseCents;result.quantityMatches&&=line.quantity===1;
        const allocations=Array.isArray(line.discounts)?line.discounts:[];result.allocationCountMatches&&=allocations.length===1;
        result.allocatedAmountMatches&&=line.discountCents===owned.amountCents&&allocations.length===1&&allocations[0].amountCents===owned.amountCents;
        result.kindMatches&&=allocations.every(discount=>discount.kind==='ManualDiscountApplication');
        result.targetTypeMatches&&=allocations.every(discount=>discount.targetType==='LINE_ITEM');
        result.fixedValueMatches&&=allocations.length===1&&allocations[0].valueType==='MoneyV2'&&allocations[0].valueCents===owned.amountCents;
        result.descriptionMatches&&=allocations.length===1&&allocations[0].description===owned.description;
      }
      result.noUnexpectedDiscounts=active.every(line=>expected[line.id]||((line.discountCents??0)===0&&(line.discounts??[]).length===0));
      return result;
    }
    throw Object.assign(failure('PAYMENT_REVIEW'),{discountLedger:safeDiscountDiagnostic({currentMatches,plannedMatches,plannedWithoutZeroMatches,plannedTargetMatches,aggregateMatches,lineCount:active.length,discountedLineCount:active.filter(line=>(line.discountCents??0)>0).length,allocationCount:active.reduce((sum,line)=>sum+(Array.isArray(line.discounts)?line.discounts.length:0),0),zeroAllocationCount:active.reduce((sum,line)=>sum+(line.discounts||[]).filter(discount=>discount.amountCents===0).length,0),expectedLineCount:Object.keys(planned?.expectedOwned||current).length,current:inspect(current),planned:planned?inspect(planned.expectedOwned):null})});
  }
  function ledger(order,context,id) {
    const {state,customerId}=context;
    requireValue(order && order.id===state.orderId && order.customerId===`gid://shopify/Customer/${customerId}` && order.currency==='USD' && order.test===expectedTest);
    tags(order,state,id);
    for(const key of ['subtotalCents','taxCents','totalCents','netPaymentCents','receivedCents','refundedCents'])requireValue(cents(order[key]));
    requireValue(order.taxCents===0 && order.subtotalCents===order.totalCents && order.shippingCents===0 && Array.isArray(order.transactions));
    requireValue(Array.isArray(order.lineItems));verifyOrderDiscounts(order,state);
    const unique=new Set(), sales=new Map(), refunds=[];
    let received=0,refunded=0,pending=false;
    for(const transaction of order.transactions) {
      requireValue(typeof transaction.id==='string' && !unique.has(transaction.id));
      unique.add(transaction.id);
      if(!['SALE','CAPTURE','REFUND'].includes(transaction.kind))continue;
      // Historical authorizations and failed attempts have no settled money.
      // A gateway-mode change must not invalidate a later successful payment.
      if(['FAILURE','ERROR'].includes(transaction.status))continue;
      requireValue(transaction.currency==='USD' && cents(transaction.amountCents) && transaction.test===expectedTest);
      if(['PENDING','AWAITING_RESPONSE','UNKNOWN'].includes(transaction.status)){pending=true;continue;}
      if(transaction.status!=='SUCCESS')continue;
      requireValue(transaction.manualPaymentGateway===false && transaction.gateway==='shopify_payments');
      if(transaction.kind==='REFUND'){refunded+=transaction.amountCents;refunds.push(transaction);}
      else {received+=transaction.amountCents;sales.set(transaction.id,{id:transaction.id,amountCents:transaction.amountCents,grossCents:transaction.amountCents,refundedCents:0,status:'confirmed'});}
    }
    requireValue(cents(received)&&cents(refunded)&&refunded<=received&&order.receivedCents===received&&order.refundedCents===refunded&&order.netPaymentCents===received-refunded);
    for(const refund of refunds) {const sale=sales.get(refund.parentId);requireValue(sale && sale.amountCents>=refund.amountCents);sale.amountCents-=refund.amountCents;sale.refundedCents+=refund.amountCents;}
    requireValue(Number.isSafeInteger(order.outstandingCents) && order.outstandingCents===order.totalCents-order.netPaymentCents);
    requireValue(typeof order.fullyPaid==='boolean' && order.fullyPaid===(order.outstandingCents<=0));
    requireValue(Array.isArray(order.lineItems) && order.lineItems.every(line=>cents(line.baseCents)&&Number.isSafeInteger(line.quantity)&&line.quantity>=0));
    return {net:received-refunded,pending,payments:[...sales.values()]};
  }

  async function run(actor,id,operationId,action) {
    // Read authorizes ownership even when another invocation currently holds the lease.
    const before=store.getPaymentContext(actor,id);
    if(action==='sync'&&!before.state)return before.snapshot;
    if(actor.role==='staff'&&action==='pay')throw failure('AUTH_REQUIRED');
    if(action==='pay'&&!before.state)requireValue((await checkConfiguration()).configured,'UNAVAILABLE');
    const claim=store.claimPayment(actor,id,operationId,action,now());
    if(!claim.claimed){report('claim',before.state?.uncertainPhase,'OPERATION_REPLAY_OR_BUSY');return claim.snapshot;}
    const {token,context}=claim;
    let state=context.state;
    const target=context.snapshot.acceptedProposal.totalCents, version=context.snapshot.acceptedProposal.version;
    let lastBilling, lastPayments, reserve=false, executionPhase='claim', failureReason=null;
    function checkpoint(patch={},publicPatch={},complete=false) {
      const time=now();
      const result=store.checkpointPayment(actor,id,token,{leaseUntil:time+60_000,updatedAt:time,...patch},publicPatch,complete);
      state=result.state;context.state=state;
      return result.snapshot;
    }
    function finish(stage,url=null,reviewRequired=false,reason=null,error,inspection) {
      if(reason)report(executionPhase,state.uncertainPhase,reason,error,inspection);
      return checkpoint({phase:'idle'}, {payment:{url,stage,reviewRequired}, ...(lastBilling?{billing:lastBilling}:{}),...(lastPayments?{payments:lastPayments}:{}),reserve},true);
    }
    function checkedPaymentUrl(url){
      executionPhase='validate-payment-url';
      try{return safeUrl(url,context.shop);}
      catch(error){failureReason='PAYMENT_URL_UNTRUSTED';throw error;}
    }
    function billing(order,paid,authoritativeTarget=false) {
      // Until the edit is verified this remains the last Shopify order total,
      // bound to its old proposal, so the UI cannot advertise an estimated debt.
      lastPayments=paid.payments;
      if(!authoritativeTarget && !(state.syncedProposalVersion===version && order.totalCents===target))return;
      const total=order.totalCents;
      lastBilling={proposalVersion:authoritativeTarget?version:(state.syncedProposalVersion || state.originProposalVersion),subtotalCents:order.subtotalCents,taxCents:order.taxCents,totalCents:total,
        netPaidCents:paid.net,balanceDueCents:Math.max(total-paid.net,0),overpaymentCents:Math.max(paid.net-total,0),currency:'USD',source:'shopify'};
      lastPayments=paid.payments;
    }
    async function remote(phase,fn) {
      executionPhase=phase;failureReason=null;
      checkpoint({phase});
      // Keep the mutation phase durable until its result identifiers are saved
      // atomically by the caller. A process crash in this gap is ambiguous.
      try { return await fn(); }
      catch(error) { checkpoint({uncertainPhase:error?.code==='VALIDATION'?null:phase,phase:'read'});throw error; }
    }
    try {
      if(state.uncertainPhase==='draft-create'&&!state.draftId) {
        executionPhase='recover-draft';
        const candidates=await client.findDraftByOperation({requestId:id,operationId:state.originOperationId});
        if(candidates.length!==1)return finish('review',null,true,'DRAFT_RECOVERY_UNRESOLVED');
        verifyDraft(candidates[0],context,id);
        checkpoint({draftId:candidates[0].id,uncertainPhase:null});
      }
      if(!state.draftId&&!state.orderId) {
        if(state.uncertainPhase)return finish('review',null,true,'UNCERTAIN_OPERATION');
        if(action==='sync')return finish('review',null,true,'INITIAL_CHECKOUT_NOT_CREATED');
        const created=await remote('draft-create',()=>client.createDepositDraft({requestId:id,proposalVersion:state.originProposalVersion,operationId:state.originOperationId,customerId:context.customerId,baseCents:state.initialBaseCents,urgent:state.urgent}));
        checkpoint({draftId:typeof created?.id==='string'?created.id:null,uncertainPhase:'draft-create',phase:'read'});
        verifyDraft(created,context,id); checkpoint({uncertainPhase:null});
      }
      if(!state.orderId) {
        executionPhase='read-draft';
        const draft=await client.getDraft(state.draftId);verifyDraft(draft,context,id);
        if(!draft.orderId) {
          if(version!==state.originProposalVersion)return finish('review',null,true,'DRAFT_PROPOSAL_CHANGED');
          requireValue(['OPEN','INVOICE_SENT'].includes(draft.status));
          checkpoint({checkoutVersion:version,uncertainPhase:null});
          return finish('deposit',checkedPaymentUrl(draft.invoiceUrl));
        }
        checkpoint({orderId:draft.orderId});
      }
      executionPhase='read-order';
      let order=await client.getOrder(state.orderId);
      executionPhase='validate-ledger';
      let paid=ledger(order,context,id);billing(order,paid);
      if(order.cancelledAt)return finish('review',null,true,'ORDER_CANCELLED');
      reserve=paid.net>=state.initialDepositCents;
      if(paid.pending)return finish('syncing',null,false,'PAYMENT_PENDING');
      const initialTitle=`${state.urgent?'Pago completo':'Anticipo'} pastel [${id}/v${state.originProposalVersion}]`;
      function representation(value) {
        const active=value.lineItems.filter(line=>line.quantity>0);
        requireValue(active.every(line=>line.title===initialTitle || new RegExp(`^Saldo pastel \\[${id}/v[1-9][0-9]*\\]$`).test(line.title)));
        requireValue(active.reduce((sum,line)=>sum+line.quantity*line.baseCents-(line.discountCents||0),0)===value.subtotalCents);
        return active;
      }
      function lineSignature(lines){return JSON.stringify(lines.filter(line=>line.quantity>0).map(({id,title,quantity,baseCents,discountCents=0})=>({id,title,quantity,baseCents,discountCents})).sort((a,b)=>a.id.localeCompare(b.id)));}
      function calculatedLines(value){return [...new Map([...value.lineItems,...(value.addedLineItems||[])].filter(line=>line.quantity>0).map(line=>[line.id,line])).values()];}
      function calculatedDiscountsMatch(value){
        const expected={},lines=calculatedLines(value);
        for(const line of active){
          const owned=state.ownedDiscounts?.[line.id];if(!owned)continue;
          const matches=lines.filter(item=>item.title===line.title&&item.quantity===line.quantity&&item.baseCents===line.baseCents);
          if(matches.length!==1)return false;expected[matches[0].id]=owned;
        }
        return discountsMatch(lines,expected,true);
      }
      function matchesStagedPlan(value){
        const plan=state.stagedIncrease;
        return plan && plan.version===version && plan.targetCents===target && plan.editId===state.editId && value.originalOrderId===state.orderId &&
          order.totalCents===plan.baselineTotal && lineSignature(active)===plan.baselineLines &&
          value.subtotalCents===target && value.totalCents===target && value.outstandingCents===target-paid.net && value.taxLines.every(tax=>tax.amountCents===0) &&
          lineSignature(calculatedLines(value))===plan.calculatedLines&&calculatedDiscountsMatch(value);
      }
      executionPhase='validate-lines';
      let active=representation(order);
      let alreadyTarget=order.totalCents===target;
      function verifyReductionPreview(value){
        const plan=state.discountPlan,lines=calculatedLines(value);
        requireValue(plan&&plan.version===version&&plan.targetCents===target&&plan.editId===state.editId&&value.originalOrderId===state.orderId);
        const expectedLines=plan.lines.map(line=>({...line,discountCents:plan.calculatedOwned[line.id]?.amountCents||0}));
        requireValue(lineSignature(lines)===lineSignature(expectedLines)&&discountsMatch(lines,plan.calculatedOwned,true));
        requireValue(value.subtotalCents===target&&value.totalCents===target&&value.outstandingCents===target-paid.net&&value.taxLines.every(tax=>tax.amountCents===0));
        requireValue(lines.reduce((sum,line)=>sum+line.quantity*line.baseCents-(line.discountCents||0),0)===target);
      }
      async function completeReduction(){
        const plan=state.discountPlan;
        requireValue(plan&&plan.version===version&&plan.targetCents===target&&plan.editId===state.editId);
        executionPhase='validate-calculated';failureReason='PAYMENT_STATE_CHANGED';
        order=await client.getOrder(state.orderId);paid=ledger(order,context,id);billing(order,paid);active=representation(order);
        requireValue(!order.cancelledAt&&order.totalCents===plan.baselineTotal&&lineSignature(active)===plan.baselineLines&&paid.net>=state.initialDepositCents);
        if(paid.pending)return finish('syncing',null,false,'PAYMENT_PENDING');
        if(order.closed){
          checkpoint({orderOpenResumePhase:'edit-discount',uncertainPhase:'order-open'});
          const opened=await remote('order-open',()=>client.reopenOrder(state.orderId));
          checkpoint({phase:'read',uncertainPhase:'order-open'});requireValue(opened.orderId===state.orderId);
          order=await client.getOrder(state.orderId);paid=ledger(order,context,id);billing(order,paid);active=representation(order);
          requireValue(!order.cancelledAt&&order.totalCents===plan.baselineTotal&&lineSignature(active)===plan.baselineLines&&paid.net>=state.initialDepositCents);
          if(order.closed)return finish('review',null,true,'ORDER_STILL_CLOSED');
          if(paid.pending)return finish('syncing',null,false,'PAYMENT_PENDING');
          checkpoint({uncertainPhase:'edit-discount',orderOpenResumePhase:null});
        }
        executionPhase='read-calculated-order';failureReason='CALCULATED_MISMATCH';
        const calculated=await client.readCalculatedOrder(state.editId,{expectedOrderId:state.orderId});verifyReductionPreview(calculated);
        failureReason=null;
        const committed=await remote('edit-commit',()=>client.commitOrderEdit(state.editId));
        checkpoint({phase:'read',editCommitted:true,uncertainPhase:'edit-commit'});requireValue(committed.orderId===state.orderId);
        executionPhase='verify-committed-order';
        order=await client.getOrder(state.orderId);paid=ledger(order,context,id);active=representation(order);
        requireValue(order.totalCents===target&&discountsMatch(order.lineItems,plan.expectedOwned));
        checkpoint({ownedDiscounts:plan.expectedOwned,discountPlan:null,uncertainPhase:null,syncedProposalVersion:version});alreadyTarget=true;
        return null;
      }
      // Reopening applies only to the correlated, paid deposit order when a
      // further edit is needed. It never changes shop-wide archive settings.
      if(!alreadyTarget){
        executionPhase='prepare-order-edit';
        if(paid.net<state.initialDepositCents)return finish('review',null,true,'DEPOSIT_UNCONFIRMED');
      }
      if(state.uncertainPhase==='order-open'){
        executionPhase='verify-opened-order';
        // The initial getOrder already revalidated ownership and actual money.
        // A still-closed result never causes an automatic replay of orderOpen.
        if(order.closed)return finish('review',null,true,'ORDER_STILL_CLOSED');
        checkpoint({uncertainPhase:state.orderOpenResumePhase||null,orderOpenResumePhase:null});
      }
      if(order.closed&&!alreadyTarget&&(!state.uncertainPhase||state.uncertainPhase==='edit-add'||state.uncertainPhase==='edit-discount'||(state.uncertainPhase==='edit-incomplete'&&(state.stagedIncrease||state.discountPlan)))){
        const resumePhase=state.uncertainPhase||null;
        checkpoint({orderOpenResumePhase:resumePhase,uncertainPhase:'order-open'});
        let opened;
        try{opened=await remote('order-open',()=>client.reopenOrder(state.orderId));}
        catch(error){
          if(error?.code==='VALIDATION')checkpoint({uncertainPhase:resumePhase,orderOpenResumePhase:null});
          throw error;
        }
        checkpoint({phase:'read',uncertainPhase:'order-open'});
        requireValue(opened.orderId===state.orderId);
        executionPhase='verify-opened-order';
        order=await client.getOrder(state.orderId);paid=ledger(order,context,id);billing(order,paid);
        if(order.cancelledAt)return finish('review',null,true,'ORDER_CANCELLED');
        if(order.closed)return finish('review',null,true,'ORDER_STILL_CLOSED');
        if(paid.pending)return finish('syncing',null,false,'PAYMENT_PENDING');
        if(paid.net<state.initialDepositCents)return finish('review',null,true,'DEPOSIT_UNCONFIRMED');
        active=representation(order);alreadyTarget=order.totalCents===target;
        checkpoint({uncertainPhase:resumePhase,orderOpenResumePhase:null});
      }
      if(state.uncertainPhase) {
        executionPhase='reconcile-order';
        if(['edit-discount','edit-incomplete'].includes(state.uncertainPhase)&&state.discountPlan){
          const result=await completeReduction();if(result)return result;
        }else if(['edit-add','edit-incomplete'].includes(state.uncertainPhase)&&state.stagedIncrease){
          executionPhase='read-calculated-order';
          const calculated=await client.readCalculatedOrder(state.editId,{expectedOrderId:state.orderId});
          requireValue(matchesStagedPlan(calculated)&&!order.closed&&!order.cancelledAt&&paid.net>=state.initialDepositCents);
          // The read-only preview can race a payment too. Await its final state
          // while retaining this exact validated session and its durable plan.
          const latest=await client.getOrder(state.orderId),latestPaid=ledger(latest,context,id);billing(latest,latestPaid);
          if(latestPaid.pending)return finish('syncing',null,false,'PAYMENT_PENDING');
          requireValue(!latest.closed&&!latest.cancelledAt&&latest.totalCents===order.totalCents&&lineSignature(representation(latest))===lineSignature(active)&&latestPaid.net===paid.net&&latestPaid.net>=state.initialDepositCents);
          const committed=await remote('edit-commit',()=>client.commitOrderEdit(state.editId));
          checkpoint({phase:'read',editCommitted:true,uncertainPhase:'edit-commit'});requireValue(committed.orderId===state.orderId);
          order=await client.getOrder(state.orderId);paid=ledger(order,context,id);active=representation(order);alreadyTarget=order.totalCents===target;
        }else if(state.uncertainPhase==='edit-add'&&state.editId){
          executionPhase='read-calculated-order';
          const calculated=await client.readCalculatedOrder(state.editId,{expectedOrderId:state.orderId});
          const inspection={matchesExpectedOrder:calculated.originalOrderId===state.orderId,stagedBalanceCount:calculated.addedLineItems.filter(line=>line.quantity>0&&line.title===`Saldo pastel [${id}/v${version}]`).length,
            matchesTarget:calculated.totalCents===target,matchesSubtotal:calculated.subtotalCents===target,matchesOutstanding:calculated.outstandingCents===target-paid.net,matchesTax:calculated.taxLines.every(tax=>tax.amountCents===0),calculatedShape:calculated.calculatedShape};
          // Recover only the first, fully verified balance addition. Never add
          // the line again, and leave more complex interrupted edits in review.
          const initial=calculated.lineItems.filter(line=>line.quantity>0);
          const added=calculated.addedLineItems.filter(line=>line.quantity>0);
          const recoverable=version===state.originProposalVersion && paid.net>=state.initialDepositCents && !order.closed && !order.cancelledAt && order.totalCents===state.initialDepositCents &&
            inspection.matchesExpectedOrder && inspection.matchesTarget && inspection.matchesSubtotal && inspection.matchesOutstanding && inspection.matchesTax &&
            initial.length===1 && initial[0].title===initialTitle && initial[0].quantity===1 && initial[0].baseCents===state.initialDepositCents &&
            added.length===1 && added[0].title===`Saldo pastel [${id}/v${version}]` && added[0].quantity===1 && added[0].baseCents===target-state.initialDepositCents;
          if(!recoverable)return finish('review',null,true,'STAGED_EDIT_INSPECTED',undefined,inspection);
          const latest=await client.getOrder(state.orderId), latestPaid=ledger(latest,context,id);
          requireValue(!latest.closed && !latest.cancelledAt && !latestPaid.pending && latestPaid.net>=state.initialDepositCents && latestPaid.net===paid.net && latest.totalCents===order.totalCents);
          const committed=await remote('edit-commit',()=>client.commitOrderEdit(state.editId));
          checkpoint({phase:'read',editCommitted:true,uncertainPhase:'edit-commit'});
          requireValue(committed.orderId===state.orderId);
          order=await client.getOrder(state.orderId);paid=ledger(order,context,id);active=representation(order);
          alreadyTarget=order.totalCents===target;
        }
        if((state.uncertainPhase&&state.uncertainPhase!=='edit-commit')||!alreadyTarget)return finish('review',null,true,'UNCERTAIN_OPERATION');
        if(state.discountPlan){requireValue(state.discountPlan.version===version&&state.discountPlan.targetCents===target&&discountsMatch(order.lineItems,state.discountPlan.expectedOwned));checkpoint({ownedDiscounts:state.discountPlan.expectedOwned,discountPlan:null});}
        checkpoint({uncertainPhase:null,syncedProposalVersion:version,stagedIncrease:null,editCommitted:true});
      }
      if(!alreadyTarget&&target<order.totalCents){
        executionPhase='prepare-order-edit';
        requireValue(!order.closed&&paid.net>=state.initialDepositCents&&!paid.pending);
        const edit=await remote('edit-begin',()=>client.beginOrderEdit(state.orderId));
        checkpoint({editId:edit.id,editCommitted:false,phase:'read',stagedIncrease:null,discountPlan:null});
        const lines=calculatedLines(edit),expectedOwned=structuredClone(state.ownedDiscounts||{}),calculatedOwned={},mapping=[];
        requireValue(lines.length===active.length);
        for(const line of active){
          requireValue(line.quantity===1);
          const matches=lines.filter(item=>item.title===line.title&&item.quantity===line.quantity&&item.baseCents===line.baseCents);
          requireValue(matches.length===1&&!mapping.some(item=>item.id===matches[0].id));
          mapping.push({id:matches[0].id,orderLineId:line.id,title:line.title,quantity:line.quantity,baseCents:line.baseCents});
          if(expectedOwned[line.id])calculatedOwned[matches[0].id]=expectedOwned[line.id];
        }
        requireValue(discountsMatch(lines,calculatedOwned,true)&&edit.totalCents===order.totalCents&&edit.subtotalCents===order.subtotalCents&&edit.taxLines.every(tax=>tax.amountCents===0));
        let reduction=order.totalCents-target;const changes=[];
        for(const line of [...active].reverse()){
          if(!reduction)break;
          const previous=expectedOwned[line.id]?.amountCents||0,extra=Math.min(reduction,line.baseCents-previous);if(!extra)continue;
          const amountCents=previous+extra,owned={baseCents:line.baseCents,amountCents,description:`Ajuste de precio aceptado: propuesta ${version}`,proposalVersion:version};
          expectedOwned[line.id]=owned;const mapped=mapping.find(item=>item.orderLineId===line.id),calculated=lines.find(item=>item.id===mapped.id);
          const effectiveDiscount=calculated.discounts?.find(discount=>discount.amountCents>0);
          requireValue(!previous||(typeof effectiveDiscount?.applicationId==='string'&&effectiveDiscount.applicationId.length>0));
          calculatedOwned[mapped.id]=owned;changes.push({lineItemId:mapped.id,discountApplicationId:previous?effectiveDiscount.applicationId:null,discountCents:amountCents});reduction-=extra;
        }
        requireValue(reduction===0&&changes.length>0&&changes.every(change=>!change.discountApplicationId||typeof change.discountApplicationId==='string'));
        checkpoint({discountPlan:{editId:state.editId,version,targetCents:target,baselineTotal:order.totalCents,baselineLines:lineSignature(active),expectedOwned,calculatedOwned,lines:mapping},phase:'read'});
        for(const change of changes){await remote('edit-discount',()=>client.setCustomPriceDiscount({editId:state.editId,...change,proposalVersion:version}));checkpoint({phase:'read',uncertainPhase:'edit-discount'});}
        const result=await completeReduction();if(result)return result;
      }
      if(!alreadyTarget) {
        executionPhase='prepare-order-edit';
        if(paid.net<state.initialDepositCents)return finish('review',null,true,'DEPOSIT_UNCONFIRMED');
        if(order.closed)return finish('review',null,true,'ORDER_CLOSED');
        const initial=active.find(line=>line.title===initialTitle);
        const retainInitial=initial && target>=initial.baseCents;
        if(initial)requireValue(initial.quantity===1 && initial.baseCents===state.initialDepositCents);
        // Preserve verified components, including an earlier unpaid balance.
        // Late payment of that balance remains part of this same order ledger.
        const increaseOrder=target>order.totalCents;
        const toRemove=increaseOrder?[]:active.filter(line=>!retainInitial||line.id!==initial.id);
        const addBase=increaseOrder?target-order.totalCents:target-(retainInitial?initial.baseCents:0);
        const edit=await remote('edit-begin',()=>client.beginOrderEdit(state.orderId));
        checkpoint({editId:edit.id,editCommitted:false,phase:'read',stagedIncrease:null});
        requireValue(calculatedDiscountsMatch(edit));
        let preview=edit;
        for(const line of toRemove) {
          const candidates=edit.lineItems.filter(item=>item.title===line.title && item.baseCents===line.baseCents && item.quantity===line.quantity);
          requireValue(candidates.length===1);
          preview=await remote('edit-remove',()=>client.removeLine({editId:state.editId,lineItemId:candidates[0].id}));
          checkpoint({phase:'read'});
        }
        if(addBase>0) {
          const added=await remote('edit-add',()=>client.addCustomBalance({editId:state.editId,requestId:id,proposalVersion:version,baseCents:addBase}));preview=added.calculatedOrder;
          let stagedIncrease=null;
          if(increaseOrder&&preview?.subtotalCents===target&&preview.totalCents===target&&Array.isArray(preview.taxLines)&&preview.taxLines.every(tax=>tax.amountCents===0)){
            const original=calculatedLines(edit),staged=calculatedLines(preview),addedLines=staged.filter(line=>!original.some(item=>item.id===line.id));
            requireValue(lineSignature(staged.filter(line=>original.some(item=>item.id===line.id)))===lineSignature(original)&&addedLines.length===1&&addedLines[0].title===`Saldo pastel [${id}/v${version}]`&&addedLines[0].quantity===1&&addedLines[0].baseCents===addBase);
            stagedIncrease={editId:state.editId,version,targetCents:target,baselineTotal:order.totalCents,baselineLines:lineSignature(active),calculatedLines:lineSignature(staged)};
          }
          checkpoint({phase:'read',stagedIncrease});
        }
        // A customer can pay the previous checkout while the edit is staged.
        // Use the fresh ledger for outstanding checks, keeping this edit session.
        executionPhase='validate-calculated';failureReason='PAYMENT_STATE_CHANGED';
        const priorTotal=order.totalCents;
        order=await client.getOrder(state.orderId);paid=ledger(order,context,id);billing(order,paid);representation(order);
        requireValue(!order.cancelledAt&&order.totalCents===priorTotal);
        if(paid.pending)return finish('syncing',null,false,'PAYMENT_PENDING');
        if(paid.net<state.initialDepositCents)return finish('review',null,true,'DEPOSIT_UNCONFIRMED');
        if(order.closed){
          checkpoint({orderOpenResumePhase:'edit-add',uncertainPhase:'order-open'});
          const opened=await remote('order-open',()=>client.reopenOrder(state.orderId));
          checkpoint({phase:'read',uncertainPhase:'order-open'});requireValue(opened.orderId===state.orderId);
          executionPhase='verify-opened-order';
          order=await client.getOrder(state.orderId);paid=ledger(order,context,id);billing(order,paid);representation(order);
          requireValue(!order.cancelledAt&&order.totalCents===priorTotal);
          if(order.closed)return finish('review',null,true,'ORDER_STILL_CLOSED');
          if(paid.pending)return finish('syncing',null,false,'PAYMENT_PENDING');
          if(paid.net<state.initialDepositCents)return finish('review',null,true,'DEPOSIT_UNCONFIRMED');
          checkpoint({uncertainPhase:null,orderOpenResumePhase:null});
          preview=await client.readCalculatedOrder(state.editId,{expectedOrderId:state.orderId});requireValue(preview.originalOrderId===state.orderId);
        }else if(preview.outstandingCents!==target-paid.net){
          preview=await client.readCalculatedOrder(state.editId,{expectedOrderId:state.orderId});requireValue(preview.originalOrderId===state.orderId);
        }
        executionPhase='validate-calculated';failureReason='CALCULATED_MISMATCH';
        requireValue(preview?.subtotalCents===target && preview.totalCents===target && preview.outstandingCents===target-paid.net && Array.isArray(preview.taxLines) && preview.taxLines.every(tax=>tax.amountCents===0)&&calculatedDiscountsMatch(preview));
        failureReason=null;
        const committed=await remote('edit-commit',()=>client.commitOrderEdit(state.editId));
        checkpoint({phase:'read',editCommitted:true});
        requireValue(committed.orderId===state.orderId);
        executionPhase='verify-committed-order';
        order=await client.getOrder(state.orderId);paid=ledger(order,context,id);representation(order);
        requireValue(order.totalCents===target);
        if(paid.pending){billing(order,paid,true);return finish('syncing',null,false,'PAYMENT_PENDING');}
      }
      checkpoint({syncedProposalVersion:version,uncertainPhase:null,stagedIncrease:null});
      requireValue(!order.cancelledAt);
      billing(order,paid,true);reserve=paid.net>=state.initialDepositCents;
      if(paid.pending)return finish('syncing',null,false,'PAYMENT_PENDING');
      if(paid.net>target)return finish('review',null,true,'OVERPAYMENT');
      if(paid.net===target && order.fullyPaid)return finish('paid');
      executionPhase='get-payment-url';
      const url=await client.getAdditionalPaymentUrl(state.orderId);
      if(!url)return finish('review',null,true,'PAYMENT_URL_MISSING');
      // Re-read after fetching the URL to detect concurrent payments/edits.
      executionPhase='verify-payment-link';
      const checked=await client.getOrder(state.orderId), latest=ledger(checked,context,id);representation(checked);
      failureReason='PAYMENT_STATE_CHANGED';
      requireValue(checked.totalCents===target && latest.net===paid.net && !latest.pending);
      failureReason=null;
      checkpoint({checkoutVersion:version});
      return finish('balance',checkedPaymentUrl(url));
    } catch(error) {
      if(error?.code==='NOT_FOUND'||error?.code==='AUTH_REQUIRED')throw error;
      // These details stay in durable internal state, never in public errors.
      if(state.phase!=='read'&&state.phase!=='idle')state.uncertainPhase=state.phase;
      const reason=failureReason||(error?.code==='VALIDATION'?'VALIDATION_ERROR':error?.code==='SHOPIFY_UNAVAILABLE'?'SHOPIFY_UNAVAILABLE':error?.code==='PAYMENT_REVIEW'?'PAYMENT_REVIEW':'UNEXPECTED_ERROR');
      try { checkpoint({uncertainPhase:state.uncertainPhase,phase:'read'});return finish(state.uncertainPhase||error?.code==='PAYMENT_REVIEW'?'review':'syncing',null,!!state.uncertainPhase||error?.code==='PAYMENT_REVIEW',reason,error); }
      catch {throw failure('UNAVAILABLE');}
    }
  }
  return Object.freeze({pay:(actor,id,operationId)=>run(actor,id,operationId,'pay'),sync:(actor,id,operationId)=>run(actor,id,operationId,'sync'),checkConfiguration});
}
