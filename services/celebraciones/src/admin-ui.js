const failure = code => Object.assign(new Error(code), { code });
const states = { requested: 'Solicitud recibida', quoted: 'Cotización disponible', reserved: 'Reserva confirmada', preparing: 'En preparación', ready: 'Listo para recoger' };
const usd = cents => new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const proposalPaymentMode = (snapshot, proposal = snapshot.acceptedProposal) => proposal?.paymentMode ?? (snapshot.details?.urgent === true ? 'full' : 'deposit');
export function paymentTerms(mode, total, received=0) {
  const due=Math.max(0,total-received);
  if(received>total)return `Pagos recibidos: ${usd(received)}. Diferencia a favor del cliente: ${usd(received-total)}, pendiente de resolución.`;
  if(received && due===0)return `Total cubierto por los pagos recibidos: ${usd(received)}. Sin saldo pendiente.`;
  if (mode==='delivery') return `Pago completo contra entrega: ${usd(due)} ${received?'de saldo ':''}al recoger.${received?' Los pagos recibidos se conservan.':' No se pide anticipo. La reserva se confirma al aceptar.'}`;
  if (mode==='full') return `Pago completo anticipado: ${usd(due)} ${received?'de saldo ':''}en Shopify.${received?' Los pagos recibidos se conservan.':' El pago confirma la reserva.'}`;
  if(received)return `Anticipo del 60 %. Recibido: ${usd(received)}. Saldo de esta propuesta: ${usd(due)}; se actualizará en Shopify al aceptar.`;
  const deposit=Math.ceil(total*60/100);
  return `Anticipo del 60 %: ${usd(deposit)} para reservar y ${usd(total-deposit)} hasta 24 horas antes de recoger.`;
}
export function canRecordDeliveryPayment(snapshot) {
  return !!snapshot?.acceptedProposal && proposalPaymentMode(snapshot)==='delivery' && !snapshot.pendingProposal
    && ['reserved','preparing','ready'].includes(snapshot.status) && billingIsCurrent(snapshot)
    && snapshot.payment?.stage==='delivery' && !snapshot.payment.reviewRequired && paymentSummary(snapshot).balance>0;
}

export function parseDollars(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw failure('VALIDATION');
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100000000) throw failure('VALIDATION');
  return cents;
}

export function calendarInput({ date, closed }) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof closed !== 'boolean') throw failure('VALIDATION');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw failure('VALIDATION');
  return { date, closed };
}

export function paymentSummary(snapshot) {
  if (snapshot.billing !== undefined && snapshot.billing !== null) {
    const billing = snapshot.billing;
    if (billing.currency !== 'USD' || !Number.isSafeInteger(billing.proposalVersion) || billing.proposalVersion <= 0
      || ['totalCents', 'taxCents', 'netPaidCents', 'balanceDueCents'].some(key => !Number.isSafeInteger(billing[key]) || billing[key] < 0)
      || billing.taxCents > billing.totalCents || billing.balanceDueCents !== Math.max(billing.totalCents - billing.netPaidCents, 0)) throw failure('UNAVAILABLE');
    if (billing.overpaymentCents !== undefined && (!Number.isSafeInteger(billing.overpaymentCents) || billing.overpaymentCents !== Math.max(billing.netPaidCents - billing.totalCents, 0))) throw failure('UNAVAILABLE');
    if (!billingIsCurrent(snapshot)) return { total: snapshot.acceptedProposal?.totalCents ?? null, received: billing.netPaidCents, balance: null, credit: 0 };
    return { total: billing.totalCents, received: billing.netPaidCents, balance: billing.balanceDueCents, credit: Math.max(billing.netPaidCents - billing.totalCents, 0) };
  }
  const received = snapshot.payments.reduce((sum, payment) => {
    if (payment.status !== 'confirmed' || !Number.isSafeInteger(payment.amountCents) || payment.amountCents < 0) throw failure('UNAVAILABLE');
    const next = sum + payment.amountCents;
    if (!Number.isSafeInteger(next)) throw failure('UNAVAILABLE');
    return next;
  }, 0);
  const total = snapshot.acceptedProposal?.totalCents ?? null;
  if (total !== null && (!Number.isSafeInteger(total) || total < 0)) throw failure('UNAVAILABLE');
  return { total, received, balance: total === null ? null : Math.max(total - received, 0), credit: total === null ? 0 : Math.max(received - total, 0) };
}

function billingIsCurrent(snapshot) {
  return !!snapshot.billing && !!snapshot.acceptedProposal && snapshot.billing.proposalVersion === snapshot.acceptedProposal.version;
}

export function canMarkReady(snapshot) {
  if (snapshot?.acceptedProposal && proposalPaymentMode(snapshot)==='delivery') return ['reserved','preparing'].includes(snapshot.status) && !snapshot.pendingProposal && billingIsCurrent(snapshot) && ['delivery','paid'].includes(snapshot.payment?.stage) && !snapshot.payment.reviewRequired;
  if (!snapshot || !['reserved', 'preparing'].includes(snapshot.status) || snapshot.pendingProposal || !billingIsCurrent(snapshot)
    || snapshot.payment?.stage !== 'paid' || snapshot.payment.reviewRequired) return false;
  return paymentSummary(snapshot).balance === 0;
}

export function paymentConnectionSummary(data) {
  if (!data || typeof data.configured !== 'boolean' || typeof data.mode !== 'string') throw failure('UNAVAILABLE');
  if (!data.configured && data.diagnostic && typeof data.diagnostic === 'object') {
    const allowedCodes = new Set([
      'invalid_client', 'invalid_grant', 'unauthorized_client', 'invalid_scope', 'invalid_request', 'access_denied',
      'shop_not_permitted', 'invalid_shop', 'temporarily_unavailable',
      'ACCESS_DENIED', 'THROTTLED', 'INTERNAL_SERVER_ERROR', 'SHOP_INACTIVE', 'MAX_COST_EXCEEDED', 'GRAPHQL_VALIDATION_FAILED',
      'undefinedField', 'argumentNotAccepted', 'variableRequiresValidType', 'missingRequiredArguments', 'variableMismatch',
    ]);
    const diagnostic = data.diagnostic;
    const stage = ['token', 'graphql'].includes(diagnostic.stage) ? diagnostic.stage : 'no identificada';
    const httpStatus = Number.isInteger(diagnostic.httpStatus) && diagnostic.httpStatus >= 100 && diagnostic.httpStatus <= 599 ? diagnostic.httpStatus : 'no disponible';
    const code = allowedCodes.has(diagnostic.code) ? diagnostic.code : 'unknown';
    return { message: 'La conexión de pagos falló.', details: [`Etapa: ${stage}`, `HTTP: ${httpStatus}`, `Código: ${code}`] };
  }
  if (!data.configured) return { message: 'Los pagos online no están configurados.', details: [`Modo: ${data.mode}`] };
  if (typeof data.currency !== 'string' || !/^[A-Z]{3}$/.test(data.currency)
    || !Array.isArray(data.scopes) || data.scopes.some(value => typeof value !== 'string')
    || !Array.isArray(data.missingScopes) || data.missingScopes.some(value => typeof value !== 'string')
    || !Array.isArray(data.locations) || data.locations.some(location => !location || typeof location.id !== 'string' || typeof location.name !== 'string' || typeof location.isActive !== 'boolean')) throw failure('UNAVAILABLE');
  const message = data.missingScopes.length ? 'La conexión responde, pero faltan permisos de Shopify.' : data.currency !== 'USD' ? 'La conexión responde, pero los pagos requieren USD.' : 'La conexión con Shopify responde. Revisa los datos comprobados a continuación.';
  return { message, details: [
    `Modo: ${data.mode}`, `Moneda: ${data.currency}`,
    `Permisos concedidos: ${data.scopes.join(', ') || 'ninguno'}`,
    `Permisos pendientes: ${data.missingScopes.join(', ') || 'ninguno'}`,
    ...data.locations.map(location => `Ubicación: ${location.name} · ${location.isActive ? 'activa' : 'inactiva'} · ${location.id}`),
    ...(data.locations.length ? [] : ['No se encontraron ubicaciones.']),
  ] };
}

export function createOperationBook(uuid = () => crypto.randomUUID()) {
  const intents = new Map();
  return {
    get(key, payload) {
      const signature = JSON.stringify(payload), previous = intents.get(key);
      if (previous?.signature === signature) return previous.id;
      const id = uuid(); intents.set(key, { signature, id }); return id;
    },
    complete(key) { intents.delete(key); },
  };
}

export function createAdminApi({ shopify = globalThis.shopify, fetch: transport = globalThis.fetch } = {}) {
  return async (path, body, asBlob = false) => {
    if (!shopify?.idToken) throw failure('AUTH_REQUIRED');
    let token;
    try { token = await shopify.idToken(); } catch { throw failure('AUTH_REQUIRED'); }
    if (typeof token !== 'string' || !token) throw failure('AUTH_REQUIRED');
    let response;
    try {
      response = await transport(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        credentials: 'omit', cache: 'no-store', redirect: 'error',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw failure('UNAVAILABLE'); }
    if (response.status === 401 || response.status === 403) throw failure('AUTH_REQUIRED');
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw failure(['AUTH_REQUIRED', 'NOT_FOUND', 'CONFLICT', 'QUOTE_EXPIRED','CHECKOUT_PENDING','VALIDATION', 'UNAVAILABLE'].includes(data.code) ? data.code : 'UNAVAILABLE');
    }
    try { return asBlob ? await response.blob() : await response.json(); } catch { throw failure('UNAVAILABLE'); }
  };
}

export function createPortalApi(request) {
  return async(path,body,asBlob=false)=>{
    if(typeof request!=='function')throw failure('AUTH_REQUIRED');
    if(typeof path!=='string'||!path.startsWith('/admin/')||/[\\#\r\n]/.test(path))throw failure('VALIDATION');
    let result;
    try {result=await request(`celebraciones/${path.slice(7)}`,{method:body===undefined?'GET':'POST',body:body??null});}
    catch(error) {throw failure(['SESSION_REQUIRED','ROLE_REQUIRED'].includes(error?.code)?'AUTH_REQUIRED':['AUTH_REQUIRED','NOT_FOUND','CONFLICT','QUOTE_EXPIRED','CHECKOUT_PENDING','VALIDATION','UNAVAILABLE'].includes(error?.code)?error.code:'UNAVAILABLE');}
    if(asBlob) {
      if(!['image/jpeg','image/png','image/webp'].includes(result?.mimeType)||typeof result.base64!=='string'||result.base64.length>2796204)throw failure('UNAVAILABLE');
      try {return new Blob([Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0))],{type:result.mimeType});}catch{throw failure('UNAVAILABLE');}
    }
    return result;
  };
}

function startPanel() {
  const q = selector => document.querySelector(selector);
  const portal=document.body.dataset.dsPortal==='true';
  const portalRequest=(path,body)=>{
    try {if(parent===window||parent.location.origin!==location.origin||!parent.inventarioPortal?.request)throw failure('AUTH_REQUIRED');return parent.inventarioPortal.request(path,body);}
    catch{throw failure('AUTH_REQUIRED');}
  };
  const api = portal?createPortalApi(portalRequest):createAdminApi(), operations = createOperationBook(), snapshots = new Map(), drafts = new Map();
  const proposalForm = q('#ds-proposal-form'), commentForm = q('#ds-comment-form'), calendarForm = q('#ds-calendar-form');
  let calendarDays = new Map(), calendarLoaded = false;
  let selected = null, busy = false, denied = false, photoGeneration = 0;
  let nextCursor=null,searchQuery='';
  const photoUrls = new Set();
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
  const feedback = (message, error = false) => { q('#ds-feedback').textContent = message; q('#ds-feedback').classList.toggle('ds-error', error); };
  const pathFor = id => `/admin/requests/${encodeURIComponent(id)}`;
  const current = () => snapshots.get(selected);
  const photoDialog=q('#ds-photo-dialog');
  let photoOpener=null;
  function closePhoto() { if(photoDialog.open)photoDialog.close();q('#ds-photo-full').removeAttribute('src'); }
  function openPhoto(url,name,opener) {
    photoOpener=opener;
    q('#ds-photo-title').textContent=name;
    q('#ds-photo-full').alt=name;q('#ds-photo-full').src=url;
    q('#ds-photo-view').classList.remove('is-zoomed');
    q('#ds-photo-zoom').setAttribute('aria-pressed','false');q('#ds-photo-zoom').textContent='Ampliar';
    photoDialog.showModal();
  }
  q('#ds-photo-close').addEventListener('click',closePhoto);
  photoDialog.addEventListener('close',()=>{if(photoDialog.open)return;q('#ds-photo-full').removeAttribute('src');if(photoOpener?.isConnected)photoOpener.focus();photoOpener=null;});
  q('#ds-photo-zoom').addEventListener('click',()=>{
    const zoomed=q('#ds-photo-view').classList.toggle('is-zoomed');
    q('#ds-photo-zoom').setAttribute('aria-pressed',String(zoomed));q('#ds-photo-zoom').textContent=zoomed?'Ajustar':'Ampliar';
  });

  function revokePhotos() { closePhoto();photoGeneration++; for (const url of photoUrls) URL.revokeObjectURL(url); photoUrls.clear(); q('#ds-photos').replaceChildren(); }
  function remember(snapshot) {
    if (!snapshot || typeof snapshot.id !== 'string' || !Number.isSafeInteger(snapshot.version)) throw failure('UNAVAILABLE');
    paymentSummary(snapshot);
    const previous = snapshots.get(snapshot.id);
    if (!previous || snapshot.version >= previous.version) snapshots.set(snapshot.id, snapshot);
  }
  function updateControls() {
    const snapshot = current();
    q('#ds-alert-refresh').disabled=busy||denied;
    q('#ds-staff-alerts').querySelectorAll('button').forEach(button=>{button.disabled=busy||denied;});
    q('#ds-refresh').disabled = busy || denied;
    q('#ds-back-to-list').disabled = busy || denied;
    q('#ds-more').disabled = busy || denied;q('#ds-more').hidden=!nextCursor;
    q('#ds-search-form button').disabled=busy||denied;q('#ds-search').disabled=busy||denied;
    q('#ds-notifications-refresh').disabled=busy||denied;
    q('#ds-payment-sync').disabled=busy||denied||!snapshot?.acceptedProposal;
    q('#ds-notifications').querySelectorAll('button').forEach(button=>{button.disabled=busy||denied;});
    q('#ds-payment-check').disabled = busy || denied;
    q('#ds-requests').querySelectorAll('button').forEach(button => { button.disabled = busy; });
    q('#ds-proposal-fields').disabled = busy || denied || !snapshot || snapshot.status === 'ready';
    q('#ds-comment-fields').disabled = busy || denied || !snapshot?.permissions.canComment;
    q('#ds-calendar-fields').disabled = busy || denied || !calendarLoaded;
    q('#ds-preparing').hidden = snapshot?.status !== 'reserved';
    q('#ds-ready').hidden = !['reserved', 'preparing'].includes(snapshot?.status);
    q('#ds-preparing').disabled = busy || denied || snapshot?.permissions.canPrepare===false;
    q('#ds-ready').disabled = busy || denied || !canMarkReady(snapshot);
    proposalForm.elements.paymentMode.disabled = busy || denied || !!snapshot?.paymentModeLocked;
    q('#ds-delivery-form').hidden = !canRecordDeliveryPayment(snapshot);
    q('#ds-delivery-fields').disabled = busy || denied || !canRecordDeliveryPayment(snapshot);
    q('#ds-workspace').setAttribute('aria-busy', String(busy));
  }
  async function accessDenied() {
    denied = true; selected = null; snapshots.clear(); drafts.clear(); calendarDays.clear(); calendarLoaded = false; revokePhotos();
    q('#ds-staff-alerts-card').hidden=true;q('#ds-staff-alerts').replaceChildren();q('#ds-alert-count').textContent='';
    q('#ds-workspace').hidden = true; q('#ds-detail').hidden = true; q('#ds-access').hidden = false;
    q('#ds-requests').replaceChildren(); q('#ds-thread').replaceChildren(); q('#ds-history').replaceChildren();
    q('#ds-request-text').textContent = ''; q('#ds-finances').replaceChildren(); q('#ds-accepted-copy').replaceChildren(); q('#ds-pending-copy').replaceChildren();
    for (const selector of ['#ds-request-id', '#ds-pickup', '#ds-urgency', '#ds-status', '#ds-credit', '#ds-billing-note', '#ds-price-preview', '#ds-calendar-status']) q(selector).textContent = '';
    q('#ds-calendar-days').replaceChildren(); calendarForm.reset();
    q('#ds-payment-check-result').replaceChildren();
    proposalForm.reset(); commentForm.reset(); feedback('Acceso no autorizado.', true);
    if(portal){q('#ds-access').replaceChildren(node('h2','Vuelve a iniciar sesión'),node('p','Tu sesión terminó o no tienes permiso para Celebraciones. Regresa al acceso del panel.'));return;}
    try {
      const session = await api('/admin/session');
      if (session.authorized === false && typeof session.staffId === 'string') {
        const previous = q('#ds-staff-id'); if (previous) previous.remove();
        const ownId = node('p', `Tu usuario de Shopify: ${session.staffId}. Falta habilitar el acceso de este usuario.`, 'ds-note');
        ownId.id = 'ds-staff-id'; q('#ds-access').append(ownId);
      }
    } catch { /* No identity is displayed unless Shopify verifies the session. */ }
  }
  async function showError(error) {
    if (error.code === 'AUTH_REQUIRED') return accessDenied();
    const messages = {
      NOT_FOUND: 'No se encontró esta solicitud o ya no tienes acceso a ella.',
      CONFLICT: 'La solicitud cambió. Revisa la versión actual antes de volver a enviar. Tu borrador se conserva.',
      QUOTE_EXPIRED:'La fecha de recogida ya pasó. No se puede aceptar ni iniciar el anticipo; coordina una nueva solicitud con la fecha correcta.',
      CHECKOUT_PENDING:'Ya existe un checkout inicial pendiente. Comprueba si el cliente pagó antes de ajustar la propuesta. Si necesita cambios antes de pagar, coordina la cancelación del intento anterior en Shopify y una nueva solicitud; no le envíes dos enlaces de pago.',
      VALIDATION: 'Revisa la fecha, los textos y los importes: usa hasta dos decimales y un total máximo de $1,000,000.00. Tu borrador se conserva.',
      UNAVAILABLE: 'No pudimos completar la operación. Puedes reintentar; tu borrador se conserva.',
    };
    feedback(messages[error.code] || messages.UNAVAILABLE, true);
    q('#ds-workspace').hidden = false;
    if (error.code === 'NOT_FOUND') { revokePhotos(); q('#ds-detail').hidden = true; q('#ds-empty').hidden = false; q('#ds-empty').replaceChildren(node('h2', 'Solicitud no disponible'), node('p', messages.NOT_FOUND)); }
  }
  async function locked(task) {
    if (busy || denied) return;
    busy = true; updateControls();
    try { await task(); } catch (error) { await showError(error); }
    finally { busy = false; updateControls(); }
  }
  function renderList() {
    const list = q('#ds-requests'); list.replaceChildren();
    q('#ds-list-message').textContent = snapshots.size ? `${snapshots.size} ${snapshots.size === 1 ? 'solicitud cargada' : 'solicitudes cargadas'}${nextCursor?' · Hay más solicitudes.':''}` : searchQuery?'No hay solicitudes que coincidan.':'Todavía no hay solicitudes.';
    for (const snapshot of snapshots.values()) {
      const button = node('button', undefined, 'ds-request'); button.type = 'button'; button.setAttribute('aria-pressed', String(snapshot.id === selected));
      button.append(node('strong', snapshot.pickup.label), node('span', states[snapshot.status] || 'Solicitud'), node('span', snapshot.requestText.slice(0, 100), 'ds-muted'));
      if(snapshot.reference)button.append(node('span',`${snapshot.reference} · ${snapshot.contact?.name || 'Invitado'}`,'ds-muted'));
      button.addEventListener('click', () => locked(async () => {
        const fresh = await api(pathFor(snapshot.id)); remember(fresh); selected = snapshot.id;
        renderList(); renderDetail(true); feedback('Solicitud actualizada.'); q('#ds-request-title').focus();
      }));
      list.append(button);
    }
    updateControls();
  }
  function renderProposal(target, proposal) {
    const container = q(target); container.replaceChildren();
    container.append(node('p', `Propuesta ${proposal.version} · Precio: ${usd(proposal.totalCents)}`, 'ds-proposal-price'));
    container.append(node('p', paymentTerms(proposalPaymentMode(current(),proposal),proposal.totalCents,paymentSummary(current()).received), 'ds-note'));
    if (current()?.payments.length) container.append(node('p', 'Los pagos ya recibidos se descuentan del total. No se vuelven a cobrar.', 'ds-muted'));
    if (proposal.display === 'breakdown') container.append(node('p', `Pastel y personalización: ${usd(proposal.baseCents)} · Recargo por urgencia: ${usd(proposal.surchargeCents)}`, 'ds-muted'));
    for (const [label, value] of [['Lo que podemos preparar', proposal.canPrepare], ['Lo que cambia', proposal.changes || 'Sin cambios indicados.'], ['Respuesta de Dayana', proposal.reply]]) {
      container.append(node('h4', label), node('p', value, 'ds-copy'));
    }
  }
  function draftFor(snapshot) {
    if (!drafts.has(snapshot.id)) {
      const source = snapshot.pendingProposal || snapshot.acceptedProposal;
      drafts.set(snapshot.id, {
        canPrepare: source?.canPrepare || '', changes: source?.changes || '', reply: source?.reply || '',
        baseCents: source ? (source.baseCents / 100).toFixed(2) : '',
        surchargeCents: source ? (source.surchargeCents / 100).toFixed(2) : '0', display: source?.display || 'total', paymentMode:proposalPaymentMode(snapshot,source), text: '',
      });
    }
    return drafts.get(snapshot.id);
  }
  function pricePreview() {
    try {
      const total = parseDollars(proposalForm.elements.baseCents.value) + parseDollars(proposalForm.elements.surchargeCents.value);
      if (total > 100000000) throw failure('VALIDATION');
      q('#ds-price-preview').textContent = `Precio de esta propuesta: ${usd(total)}. ${paymentTerms(proposalForm.elements.paymentMode.value,total,current()?paymentSummary(current()).received:0)}`;
    } catch { q('#ds-price-preview').textContent = 'Completa un precio válido, con hasta dos decimales.'; }
  }
  async function renderPhotos(snapshot) {
    revokePhotos(); const generation = photoGeneration;
    const attachments = Array.isArray(snapshot.attachments) ? snapshot.attachments : [];
    if (!attachments.length) { q('#ds-photos').append(node('p', 'Sin fotos de referencia.', 'ds-muted')); return; }
    for (const attachment of attachments) {
      const figure = node('figure'), caption = node('figcaption', attachment.name); figure.append(caption); q('#ds-photos').append(figure);
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(attachment.mimeType)) { caption.textContent = `${attachment.name} · Vista previa no disponible.`; continue; }
      try {
        const blob = await api(`${pathFor(snapshot.id)}/photos/${encodeURIComponent(attachment.id)}`, undefined, true);
        if (generation !== photoGeneration || denied) return;
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(blob.type)) throw failure('UNAVAILABLE');
        const url = URL.createObjectURL(blob); photoUrls.add(url);
        const image = node('img'); image.alt = attachment.name; image.src = url; image.loading = 'lazy';
        const enlarge=node('button',undefined,'ds-photo-open');enlarge.type='button';enlarge.setAttribute('aria-label',`Ampliar foto: ${attachment.name}`);enlarge.setAttribute('aria-haspopup','dialog');
        enlarge.append(image,node('span','Ampliar foto'));enlarge.addEventListener('click',()=>openPhoto(url,attachment.name,enlarge));figure.prepend(enlarge);
      } catch (error) {
        if (generation !== photoGeneration) return;
        if (error.code === 'AUTH_REQUIRED') { accessDenied(); return; }
        caption.textContent = `${attachment.name} · No pudimos cargar esta foto. Actualiza para reintentar.`;
      }
    }
  }
  function renderDetail(loadPhotos = false) {
    const snapshot = current(); if (!snapshot) return;
    q('#ds-empty').hidden = true; q('#ds-detail').hidden = false;
    q('#ds-request-id').textContent = `Solicitud ${snapshot.reference || snapshot.id}`;
    q('#ds-pickup').textContent = `Recogida · ${snapshot.pickup.label}`;
    q('#ds-urgency').textContent = snapshot.details?.urgent === true ? 'Solicitud urgente' : snapshot.details?.urgent === false ? 'Solicitud normal' : 'Urgencia no indicada';
    q('#ds-status').textContent = states[snapshot.status] || 'Solicitud';
    const emailStates={pending:'Correo pendiente de envío.',sent:'Correo aceptado por el servidor de envío.',failed:'No se pudo enviar el correo. El acceso web sigue disponible.',unknown:'No se pudo confirmar el envío del correo. Revisar antes de reenviar.'};
    const contact=snapshot.contact?`${snapshot.contact.name}\n${snapshot.contact.email}\n${snapshot.contact.phone}\nCorreo inicial: ${emailStates[snapshot.emailStatus]||''}\n\n`:'';
    q('#ds-request-text').textContent = contact + snapshot.requestText;
    const notifications=q('#ds-notifications');notifications.replaceChildren();
    const kinds={propose:'Propuesta',comment:'Mensaje',preparing:'En preparación',ready:'Listo para recoger'};
    const mailStatuses={pending:'Pendiente de envío',sent:'Aceptado por el proveedor',failed:'No se pudo enviar',unknown:'Envío sin confirmar'};
    for(const notice of snapshot.notifications||[]){
      const item=node('div',undefined,['failed','unknown'].includes(notice.status)?'ds-note ds-error':'ds-note');
      item.append(node('strong',`${kinds[notice.kind==='setStatus'?notice.eventStatus:notice.kind]||'Actualización'} · ${mailStatuses[notice.status]||'Estado no disponible'}`));
      if(notice.createdAt)item.append(node('p',new Date(notice.createdAt).toLocaleString('es-US',{timeZone:'America/Chicago'}),'ds-muted'));
      if(notice.status==='failed'){const retry=node('button','Reintentar correo');retry.type='button';retry.addEventListener('click',()=>void locked(()=>mutate('email-retry',{notificationId:notice.id})));item.append(retry);}
      if(notice.status==='unknown')item.append(node('p','Revisa este envío en Resend antes de intentar enviar otro aviso. No se reenvía automáticamente para evitar duplicados.','ds-muted'));
      notifications.append(item);
    }
    if(!snapshot.notifications?.length)notifications.append(node('p','Todavía no hay avisos de actualización.','ds-muted'));
    const finances = paymentSummary(snapshot), billed = billingIsCurrent(snapshot), staleBilling = !!snapshot.billing && !billed; q('#ds-finances').replaceChildren();
    for (const [label, value] of [[billed ? 'Total vigente' : 'Precio', finances.total], ['Recibido', finances.received], ['Saldo pendiente', finances.balance]]) {
      const item = node('div'); item.append(node('span', label, 'ds-muted'), node('strong', value === null ? staleBilling && label === 'Saldo pendiente' ? 'Pendiente de actualizar en Shopify' : 'Por acordar' : usd(value), value === null ? 'ds-money ds-money-pending' : 'ds-money')); q('#ds-finances').append(item);
    }
    q('#ds-billing-note').textContent = snapshot.acceptedProposal && proposalPaymentMode(snapshot)==='delivery' ? snapshot.payment?.reviewRequired ? 'Hay una diferencia a favor del cliente pendiente de revisión. No registres otro cobro.' : snapshot.payment?.stage==='paid' ? 'Pago contra entrega registrado por la pastelera en Celebraciones.' : 'Pago contra entrega: la reserva está confirmada y el cobro sigue pendiente. Los importes se registran en Celebraciones.' : billed ? 'Importes confirmados por Shopify para la propuesta vigente.' : staleBilling ? 'El total y el saldo están pendientes de actualizar en Shopify.' : 'El precio vigente corresponde a la propuesta aceptada.';
    q('#ds-delivery-amount').textContent = `Importe recibido al entregar: ${usd(finances.balance || 0)}.`;
    q('#ds-delivery-form').reset();
    q('#ds-credit').hidden = !finances.credit;
    q('#ds-credit').textContent = `Diferencia a favor del cliente: ${usd(finances.credit)}. Pendiente de resolución; no se ha realizado un reembolso.`;
    q('#ds-accepted').hidden = !snapshot.acceptedProposal; if (snapshot.acceptedProposal) renderProposal('#ds-accepted-copy', snapshot.acceptedProposal);
    q('#ds-pending').hidden = !snapshot.pendingProposal; if (snapshot.pendingProposal) renderProposal('#ds-pending-copy', snapshot.pendingProposal);
    const draft = draftFor(snapshot);
    if(snapshot.paymentModeLocked)draft.paymentMode=proposalPaymentMode(snapshot);
    for (const key of ['canPrepare', 'changes', 'reply', 'baseCents', 'surchargeCents', 'display', 'paymentMode']) proposalForm.elements[key].value = draft[key];
    q('#ds-payment-mode-note').textContent = snapshot.paymentModeLocked ? 'La modalidad está fijada porque ya se inició el cobro o se aceptó la reserva contra entrega.' : 'Solo la pastelera elige esta condición; el cliente la revisa al aceptar. También puedes elegirla en solicitudes urgentes.';
    commentForm.elements.text.value = draft.text; pricePreview();
    q('#ds-thread').replaceChildren();
    for (const comment of snapshot.comments) { const article = node('article', undefined, 'ds-message'); article.append(node('strong', comment.author), node('p', comment.text, 'ds-copy')); q('#ds-thread').append(article); }
    if (!snapshot.comments.length) q('#ds-thread').append(node('p', 'Todavía no hay comentarios.', 'ds-muted'));
    q('#ds-history').replaceChildren();
    for (const entry of snapshot.history) { const article = node('article'); article.append(node('h4', `Propuesta ${entry.version} · ${states[entry.status] || entry.status} · ${usd(entry.totalCents)}`), node('p', paymentTerms(proposalPaymentMode(snapshot,entry),entry.totalCents)), node('p', entry.reply, 'ds-copy')); q('#ds-history').append(article); }
    if (!snapshot.history.length) q('#ds-history').append(node('p', 'Todavía no hay propuestas anteriores.', 'ds-muted'));
    q('#ds-proposal-note').textContent = snapshot.status === 'ready' ? 'El pastel está listo. Ya no se pueden enviar propuestas.' : snapshot.permissions.canPropose===false?'Hay un checkout inicial pendiente. El sistema comprobará si ya fue pagado antes de permitir otra propuesta; mientras siga pendiente, no se podrá cambiar.':'El cliente debe aceptar la propuesta para que cambie el diseño y precio vigentes.';
    q('#ds-comment-note').textContent = snapshot.permissions.canComment ? 'Un comentario no cambia la propuesta ni su precio.' : 'Esta solicitud ya no admite comentarios.';
    q('#ds-status-note').textContent = ['reserved', 'preparing'].includes(snapshot.status) ? !canMarkReady(snapshot) ? 'Para marcar listo, Shopify debe confirmar el pago completo, sin propuestas ni revisión de pago pendientes.' : 'Marca el avance cuando corresponda. Al marcar listo se cierran los comentarios y las propuestas.' : snapshot.status === 'ready' ? 'El pastel está listo para recoger.' : 'La preparación estará disponible cuando el servicio confirme la reserva. Aceptar una propuesta no confirma por sí solo pagos ni cupo.';
    if(snapshot.status==='reserved'&&snapshot.permissions.canPrepare===false)q('#ds-status-note').textContent='No se puede iniciar la preparación: falta confirmar el anticipo vigente o resolver una propuesta o revisión pendiente. Actualiza el pago antes de continuar.';
    if(snapshot.acceptedProposal && proposalPaymentMode(snapshot)==='delivery')q('#ds-status-note').textContent = snapshot.pendingProposal || snapshot.payment?.reviewRequired ? 'Resuelve la propuesta o revisión pendiente antes de marcar listo.' : 'Con pago contra entrega puedes marcar listo antes de cobrar. Registra el pago recibido cuando el cliente pague.';
    updateControls(); if (loadPhotos) void renderPhotos(snapshot);
  }
  function saveDraft() {
    const snapshot = current(); if (!snapshot || denied) return;
    const draft = draftFor(snapshot);
    for (const key of ['canPrepare', 'changes', 'reply', 'baseCents', 'surchargeCents', 'display', 'paymentMode']) draft[key] = proposalForm.elements[key].value;
    draft.text = commentForm.elements.text.value; pricePreview();
  }
  proposalForm.addEventListener('input', saveDraft); proposalForm.addEventListener('change', saveDraft); commentForm.addEventListener('input', saveDraft);
  async function mutate(action, payload) {
    const id = selected, key = `${id}/${action}`, operationId = operations.get(key, payload);
    feedback('Guardando…');
    try {
      const snapshot = await api(`${pathFor(id)}/${action}`, { ...payload, operationId });
      remember(snapshot); operations.complete(key);
      if (action === 'comments') draftFor(snapshots.get(id)).text = '';
      renderList(); if (selected === id) renderDetail();
      if (action === 'proposals') {
        feedback('Propuesta enviada. Esperando la aceptación del cliente. Puedes consultar el estado del correo en «Correos de actualizaciones».');
        const confirmation = q('#ds-feedback');
        confirmation.setAttribute('tabindex', '-1');
        confirmation.focus({ preventScroll: true });
        confirmation.scrollIntoView({ block: 'center', behavior: 'instant' });
      } else feedback('Cambios guardados.');
    } catch (error) {
      if (error.code === 'CONFLICT') {
        // Refresh for review; never repeat a mutation against changed state automatically.
        try { remember(await api(pathFor(id))); renderList(); if (selected === id) renderDetail(); }
        catch (readError) { if (readError.code === 'AUTH_REQUIRED') throw readError; }
      }
      throw error;
    }
  }
  proposalForm.addEventListener('submit', event => {
    event.preventDefault(); void locked(async () => {
      saveDraft(); const draft = draftFor(current());
      const proposal = { canPrepare: draft.canPrepare.trim(), changes: draft.changes.trim(), reply: draft.reply.trim(), baseCents: parseDollars(draft.baseCents), surchargeCents: parseDollars(draft.surchargeCents), display: draft.display, paymentMode:draft.paymentMode };
      if (!proposal.canPrepare || !proposal.reply || proposal.baseCents + proposal.surchargeCents > 100000000) throw failure('VALIDATION');
      await mutate('proposals', { proposal });
    });
  });
  commentForm.addEventListener('submit', event => { event.preventDefault(); void locked(async () => { const text = commentForm.elements.text.value.trim(); if (!text) throw failure('VALIDATION'); await mutate('comments', { text }); }); });
  q('#ds-preparing').addEventListener('click', () => void locked(() => mutate('status', { status: 'preparing' })));
  q('#ds-ready').addEventListener('click', () => void locked(() => mutate('status', { status: 'ready' })));
  q('#ds-delivery-form').addEventListener('submit', event => {
    event.preventDefault();
    if(!q('#ds-delivery-form').elements.received.checked || !canRecordDeliveryPayment(current()))return;
    const proposalVersion=current().acceptedProposal.version;
    void locked(()=>mutate('delivery-payment',{proposalVersion}));
  });
  function renderCalendar() {
    const date = calendarForm.elements.date.value, closed = calendarDays.get(date);
    q('#ds-calendar-status').textContent = !calendarLoaded ? 'La agenda no se ha podido cargar. Usa Actualizar para reintentar.' : !date ? 'Selecciona una fecha.' : closed === true ? 'Fecha cerrada para nuevas solicitudes.' : closed === false ? 'Fecha abierta para nuevas solicitudes.' : 'Sin cierre registrado para esta fecha.';
    q('#ds-calendar-days').replaceChildren();
    const dates = [...calendarDays].filter(([, isClosed]) => isClosed).map(([day]) => day).sort();
    for (const day of dates) q('#ds-calendar-days').append(node('li', day));
    if (!dates.length) q('#ds-calendar-days').append(node('li', calendarLoaded ? 'No hay fechas cerradas.' : 'Agenda sin cargar.'));
  }
  async function loadCalendar() {
    const result = await api('/admin/calendar');
    if (denied) return;
    if (!Array.isArray(result.days)) throw failure('UNAVAILABLE');
    const entries = result.days.map(day => { const valid = calendarInput(day); return [valid.date, valid.closed]; });
    calendarDays = new Map(entries); calendarLoaded = true; renderCalendar();
  }
  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  calendarForm.elements.date.value = ['year', 'month', 'day'].map(type => todayParts.find(part => part.type === type).value).join('-');
  calendarForm.elements.date.addEventListener('change', renderCalendar);
  calendarForm.addEventListener('submit', event => {
    event.preventDefault(); const action = event.submitter?.value;
    void locked(async () => {
      if (!['true', 'false'].includes(action)) throw failure('VALIDATION');
      const payload = calendarInput({ date: calendarForm.elements.date.value, closed: action === 'true' });
      const key = `calendar/${payload.date}`, operationId = operations.get(key, payload);
      feedback('Guardando agenda…');
      await api('/admin/calendar', { ...payload, operationId });
      await loadCalendar(); operations.complete(key);
      feedback(payload.closed ? 'Fecha cerrada para nuevas solicitudes.' : 'Fecha abierta para nuevas solicitudes.');
    });
  });
  async function loadPage(append=false){
    const query=new URLSearchParams();if(searchQuery)query.set('q',searchQuery);if(append&&nextCursor)query.set('cursor',nextCursor);
    const result=await api('/admin/requests'+(query.size?'?'+query.toString():''));
    if (!Array.isArray(result.requests)) throw failure('UNAVAILABLE');
    if(!append)snapshots.clear();nextCursor=result.nextCursor||null;
    for (const snapshot of result.requests) remember(snapshot);
    q('#ds-workspace').hidden=false;renderList();
  }
  async function refresh() {
    saveDraft();await loadPage();
    if(selected){remember(await api(pathFor(selected)));renderList();renderDetail(true);}
    try { await loadCalendar(); } catch (error) { renderCalendar(); throw error; }
    if (denied) return;
    await refreshAlerts();
    feedback('Solicitudes actualizadas.');
  }
  q('#ds-refresh').addEventListener('click', () => void locked(refresh));
  q('#ds-more').addEventListener('click',()=>void locked(()=>loadPage(true)));
  q('#ds-search-form').addEventListener('submit',event=>{event.preventDefault();void locked(async()=>{saveDraft();selected=null;revokePhotos();q('#ds-detail').hidden=true;q('#ds-empty').hidden=false;searchQuery=q('#ds-search').value.trim();await loadPage();});});
  q('#ds-notifications-refresh').addEventListener('click',()=>void locked(async()=>{if(selected){remember(await api(pathFor(selected)));renderDetail();feedback('Estado de correos actualizado.');}}));
  q('#ds-payment-sync').addEventListener('click',()=>void locked(()=>mutate('payment-sync',{})));
  q('#ds-back-to-list').addEventListener('click', () => {
    if (busy || denied) return;
    saveDraft(); selected = null; revokePhotos();
    q('#ds-detail').hidden = true; q('#ds-empty').hidden = false;
    renderList(); feedback('Selecciona una solicitud para ver sus detalles.');
    (q('#ds-requests button') || q('#ds-refresh')).focus();
  });
  q('#ds-payment-check').addEventListener('click', () => void locked(async () => {
    const container = q('#ds-payment-check-result'); container.replaceChildren(node('p', 'Comprobando conexión…', 'ds-muted'));
    try {
      const result = paymentConnectionSummary(await api('/admin/payment-status'));
      if (denied) return;
      const details = node('ul'); for (const text of result.details) details.append(node('li', text));
      container.replaceChildren(node('p', result.message, 'ds-note'), details); feedback('Comprobación de conexión terminada.');
    } catch (error) { container.replaceChildren(node('p', 'No se pudo comprobar la conexión. Puedes volver a intentar.', 'ds-muted')); throw error; }
  }));
  let alertsLoading=false,alertsSignature='';
  async function openAlertRequest(id) {
    saveDraft();
    const fresh=await api(pathFor(id));remember(fresh);selected=id;
    renderList();renderDetail(true);q('#ds-request-title').focus();
    q('#ds-request-title').scrollIntoView({block:'start',behavior:'instant'});
  }
  async function refreshAlerts(background=false) {
    if(denied||alertsLoading)return;
    alertsLoading=true;
    try {
      const result=await api('/admin/staff-alerts');
      if(denied)return;
      if(!Array.isArray(result.alerts)||!Number.isSafeInteger(result.unread))throw failure('UNAVAILABLE');
      q('#ds-staff-alerts-card').hidden=false;
      q('#ds-alert-count').textContent=`${result.unread} sin leer`;
      q('#ds-alert-status').textContent='Los pagos aparecen cuando el servicio confirma el cobro. Actualización automática cada 30 segundos mientras el panel está visible.';
      const container=q('#ds-staff-alerts'),signature=JSON.stringify(result.alerts);
      // Do not replace a focused button while someone is navigating the inbox.
      if(signature===alertsSignature||(background&&container.contains(document.activeElement)))return;
      alertsSignature=signature;container.replaceChildren();
      if(!result.alerts.length)container.append(node('p','No tienes avisos nuevos.','ds-muted'));
      for(const alert of result.alerts) {
        const item=node('article',undefined,`ds-staff-alert${alert.read?'':' is-unread'}`);
        item.append(node('strong',alert.kind==='payment'?`Pago confirmado · ${usd(alert.amountCents)}`:'Nuevo mensaje de la clienta'));
        item.append(node('p',`${alert.reference||'Solicitud de pastel'} · ${new Date(alert.createdAt).toLocaleString('es')}`,'ds-muted'));
        item.append(node('p',alert.kind==='payment'?`Saldo pendiente al confirmar: ${usd(alert.balanceDueCents)}.`:'Hay una respuesta para revisar en la conversación.'));
        const mailStates={pending:'Correo pendiente de envío',sending:'Correo en proceso',sent:'Correo aceptado por el proveedor',failed:'No se pudo enviar el correo',unknown:'No se pudo confirmar el envío del correo'};
        item.append(node('p',mailStates[alert.emailStatus]||'Estado del correo no disponible','ds-muted'));
        const actions=node('div',undefined,'ds-actions'),open=node('button','Ver solicitud','ds-primary');open.type='button';
        open.addEventListener('click',()=>void locked(()=>openAlertRequest(alert.requestId)));actions.append(open);
        if(!alert.read) {
          const read=node('button','Marcar leído');read.type='button';
          read.addEventListener('click',()=>void locked(async()=>{await api('/admin/staff-alerts',{id:alert.id});await refreshAlerts();q('#ds-alert-refresh').focus();}));actions.append(read);
        }
        item.append(actions);container.append(item);
      }
      updateControls();
    } catch(error) {
      if(error.code==='AUTH_REQUIRED'){await accessDenied();return;}
      q('#ds-alert-status').textContent='No pudimos actualizar los avisos. Pulsa «Actualizar avisos» para reintentar.';
      if(!background)q('#ds-staff-alerts-card').hidden=false;
    } finally {alertsLoading=false;}
  }
  q('#ds-alert-refresh').addEventListener('click',()=>void locked(()=>refreshAlerts()));
  const pollAlerts=()=>{if(!document.hidden&&!busy&&!denied)void refreshAlerts(true);};
  const alertsTimer=window.setInterval(pollAlerts,30000);
  document.addEventListener('visibilitychange',pollAlerts);
  window.addEventListener('pagehide',()=>{revokePhotos();window.clearInterval(alertsTimer);});
  void locked(async()=>{
    await refresh();
    const requested=new URLSearchParams(location.search).get('solicitud');
    if(requested&&/^[a-f0-9-]{36}$/.test(requested)&&!denied)await openAlertRequest(requested);
  });
}

if (typeof document !== 'undefined') startPanel();
