(function (global) {
  'use strict';
  const statuses = { requested: 'Solicitud recibida', quoted: 'Cotización disponible', reserved: 'Reserva confirmada', preparing: 'En preparación', ready: 'Listo para recoger' };
  const messages = { AUTH_REQUIRED: 'Inicia sesión para consultar tu pastel.', NOT_FOUND: 'No encontramos esta solicitud.', CONFLICT: 'La propuesta cambió. Revisa la información actualizada antes de aceptar.', VALIDATION: 'Revisa la información e inténtalo de nuevo.', UNAVAILABLE: 'No pudimos completar la operación. Puedes volver a intentarlo.' };
  messages.QUOTE_EXPIRED = 'Esta propuesta venció. Escríbele a Dayana para acordar una nueva fecha y recibir una propuesta vigente.';
  messages.CHECKOUT_PENDING = 'Hay un pago pendiente de comprobar en Shopify. Actualiza el estado del pago antes de continuar; no vuelvas a pagar.';
  const guestAccessMessage = 'Abre el enlace privado completo de tu correo para consultar esta solicitud sin iniciar sesión.';
  const quoteExpired = (proposal, now = Date.now()) => typeof proposal?.expiresAt === 'string' && Date.parse(proposal.expiresAt) <= now;
  function initialPaymentDeadline(snapshot) {
    if (snapshot?.payment?.stage !== 'deposit') return null;
    const deadlines = [snapshot.acceptedProposal?.expiresAt, snapshot.details?.pickupAt].map(value => typeof value === 'string' ? Date.parse(value) : NaN).filter(Number.isFinite);
    return deadlines.length ? Math.min(...deadlines) : null;
  }
  const initialPaymentExpired = (snapshot, now = Date.now()) => { const deadline = initialPaymentDeadline(snapshot); return deadline !== null && deadline <= now; };
  const fail = code => Object.assign(new Error(messages[code]), { code });
  const cents = value => { if (!Number.isSafeInteger(value) || value < 0) throw fail('VALIDATION'); return value; };
  const paymentStages = new Set(['unavailable', 'deposit', 'syncing', 'balance', 'paid', 'review', 'delivery']);
  const paymentMode = (s,p=s.acceptedProposal) => p?.paymentMode ?? (s.details?.urgent === true ? 'full' : 'deposit');
  function terms(s,p) {
    const mode=paymentMode(s,p), paid=balance(s).paidCents;
    if(mode==='delivery')return `Pago completo contra entrega. No pagas ahora; al recoger: ${money(Math.max(0,p.totalCents-paid))}.`;
    if(mode==='full')return `Pago completo anticipado: ${money(Math.max(0,p.totalCents-paid))} en Shopify.${paid?' Tus pagos recibidos se conservan.':' El pago confirma la reserva.'}`;
    if(paid)return `Anticipo del 60 %. Tus pagos recibidos se conservan; el saldo se actualizará en Shopify al aceptar.`;
    const deposit=Math.ceil(p.totalCents*60/100);
    return `Anticipo del 60 %: ${money(deposit)} para reservar y ${money(p.totalCents-deposit)} hasta 24 horas antes de recoger.`;
  }
  function paymentUrl(value, configuredHosts = []) {
    if (typeof value !== 'string' || value.length > 4096) return null;
    try {
      const url = new URL(value), hosts = new Set(['checkout.shopify.com', ...configuredHosts.filter(host => typeof host === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(host))]);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.has(url.hostname)) return null;
      return url.href;
    } catch { return null; }
  }
  function balance(snapshot, proposal = snapshot.acceptedProposal) {
    if(snapshot.billing){
      const b=snapshot.billing;
      for(const key of ['totalCents','taxCents','netPaidCents','balanceDueCents'])cents(b[key]);
      if(b.currency!=='USD'||!Number.isSafeInteger(b.proposalVersion)||b.proposalVersion<1||b.taxCents>b.totalCents||b.balanceDueCents!==Math.max(0,b.totalCents-b.netPaidCents))throw fail('VALIDATION');
      if (b.overpaymentCents !== undefined && cents(b.overpaymentCents) !== Math.max(0, b.netPaidCents - b.totalCents)) throw fail('VALIDATION');
      const current=proposal && proposal.version===snapshot.acceptedProposal?.version && b.proposalVersion===proposal.version;
      return {totalCents:current?b.totalCents:(proposal?cents(proposal.totalCents):null),paidCents:b.netPaidCents,dueCents:current?b.balanceDueCents:null,creditCents:current?Math.max(0,b.netPaidCents-b.totalCents):0,taxCents:current?b.taxCents:null,taxIncluded:Boolean(current),pendingTax:!current};
    }
    const ids = new Set();
    for (const p of snapshot.payments) {
      if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id) || p.status !== 'confirmed') throw fail('VALIDATION');
      ids.add(p.id);
    }
    const paidCents = snapshot.payments.reduce((sum, p) => p.status === 'confirmed' ? cents(sum + cents(p.amountCents)) : sum, 0);
    const totalCents = proposal ? cents(proposal.totalCents) : null;
    return { totalCents, paidCents, dueCents: totalCents === null ? null : Math.max(0, totalCents - paidCents), creditCents: totalCents === null ? 0 : Math.max(0, paidCents - totalCents) };
  }
  function validate(s, id) {
    if (!s || s.id !== id || !Number.isSafeInteger(s.version) || s.version < 1 || !statuses[s.status] || !s.pickup || typeof s.pickup.label !== 'string' || typeof s.requestText !== 'string' || !s.permissions || typeof s.permissions.canComment !== 'boolean' || typeof s.permissions.canAccept !== 'boolean') throw fail('VALIDATION');
    for (const key of ['payments', 'comments', 'history']) if (!Array.isArray(s[key])) throw fail('VALIDATION');
    for (const p of [s.acceptedProposal, s.pendingProposal]) {
      if (p === null) continue;
      if (!p || !Number.isSafeInteger(p.version) || p.version < 1 || !['total', 'breakdown'].includes(p.display) || ['canPrepare', 'changes', 'reply'].some(k => typeof p[k] !== 'string')) throw fail('VALIDATION');
      if (p.expiresAt !== undefined && p.expiresAt !== null && (typeof p.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(p.expiresAt) || !Number.isFinite(Date.parse(p.expiresAt)))) throw fail('VALIDATION');
      if(p.paymentMode!==undefined && !['deposit','full','delivery'].includes(p.paymentMode))throw fail('VALIDATION');
      if (cents(p.baseCents) + cents(p.surchargeCents) !== cents(p.totalCents)) throw fail('VALIDATION');
    }
    if (s.comments.some(c => !c || ['id', 'author', 'text'].some(k => typeof c[k] !== 'string'))) throw fail('VALIDATION');
    if (s.history.some(h => !h || !Number.isSafeInteger(h.version) || typeof h.reply !== 'string' || typeof h.status !== 'string')) throw fail('VALIDATION');
    if (s.payment !== undefined && s.payment !== null && (!paymentStages.has(s.payment.stage) || typeof s.payment.reviewRequired !== 'boolean' || (s.payment.url !== null && typeof s.payment.url !== 'string'))) throw fail('VALIDATION');
    s.history.forEach(h => cents(h.totalCents));
    balance(s); if (s.pendingProposal) balance(s, s.pendingProposal);
    return s;
  }
  function createController(id, service, notify = () => {}, options = {}) {
    const state = { snapshot: null, busy: false, error: null, action: null };
    const retries = new Map();
    let storage = options.storage;
    if (storage === undefined) { try { storage = global.sessionStorage; } catch { storage = null; } }
    const storageKey = key => `ds-tracking-payment:${encodeURIComponent(options.shop || '')}:${encodeURIComponent(id)}:${key}`;
    const publish = () => notify(state);
    function receive(s) {
      validate(s, id);
      if (state.snapshot && s.version < state.snapshot.version) throw fail('CONFLICT');
      state.snapshot = s;
    }
    async function run(action, work) {
      if (state.busy) return false;
      state.busy = true; state.error = null; state.action = action; publish();
      try { receive(await work()); state.error = null; return true; }
      catch (error) {
        const code = Object.hasOwn(messages, error?.code) ? error.code : 'UNAVAILABLE';
        if (code === 'AUTH_REQUIRED' || code === 'NOT_FOUND') state.snapshot = null;
        if (['CONFLICT', 'QUOTE_EXPIRED', 'CHECKOUT_PENDING'].includes(code)) { try { receive(await service.getTracking(id)); } catch (refreshError) { if (['AUTH_REQUIRED', 'NOT_FOUND'].includes(refreshError?.code)) state.snapshot = null; } }
        state.error = { code, message: service.guest && ['AUTH_REQUIRED', 'NOT_FOUND'].includes(code) ? guestAccessMessage : messages[code] }; return false;
      } finally { state.busy = false; publish(); }
    }
    function operation(key, persist = false) {
      if (!retries.has(key)) {
        let saved;
        if (persist) { try { saved = storage?.getItem(storageKey(key)); } catch { /* Private mode can disable storage. */ } }
        retries.set(key, typeof saved === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(saved) ? saved : global.crypto.randomUUID());
      }
      if (persist) { try { storage?.setItem(storageKey(key), retries.get(key)); } catch { /* Retain the in-memory retry key. */ } }
      return retries.get(key);
    }
    function completeOperation(key, persist = false) {
      retries.delete(key);
      if (persist) { try { storage?.removeItem(storageKey(key)); } catch { /* Storage is optional. */ } }
    }
    async function paymentAction(action) {
      const s = state.snapshot;
      if (state.busy || !s?.payment || !s.acceptedProposal || typeof service[action] !== 'function') return false;
      if (action === 'startPayment' && initialPaymentExpired(s)) { state.error = { code: 'QUOTE_EXPIRED', message: messages.QUOTE_EXPIRED }; publish(); return false; }
      if (paymentMode(s)==='delivery')return action==='syncPayment'?run('load',()=>service.getTracking(id)):false;
      if (action === 'startPayment' && (s.pendingProposal || s.payment.reviewRequired || !['deposit', 'balance'].includes(s.payment.stage))) return false;
      const key = `${action}:${s.acceptedProposal.version}:${s.payment.stage}`, operationId = operation(key, true);
      const ok = await run(action, () => service[action](id, operationId));
      if (ok) completeOperation(key, true);
      return ok;
    }
    return {
      state,
      load: () => run('load', () => service.getTracking(id)),
      startPayment: () => paymentAction('startPayment'),
      syncPayment: () => paymentAction('syncPayment'),
      async comment(raw) {
        const text = String(raw).trim(), s = state.snapshot;
        if (state.busy || !s || s.status === 'ready' || !s.permissions.canComment) return false;
        if (!text || text.length > 2000) { state.error = { code: 'VALIDATION', message: 'Escribe un comentario de entre 1 y 2000 caracteres.' }; publish(); return false; }
        const operationId = operation(`comment:${text}`);
        const ok = await run('comment', () => service.postComment(id, text, operationId));
        if (ok) retries.delete(`comment:${text}`); return ok;
      },
      async accept() {
        const s = state.snapshot;
        if (state.busy || !s || s.status === 'ready' || !s.pendingProposal) return false;
        if (quoteExpired(s.pendingProposal)) { state.error = { code: 'QUOTE_EXPIRED', message: messages.QUOTE_EXPIRED }; publish(); return false; }
        if (!s.permissions.canAccept) return false;
        const version = s.pendingProposal.version, operationId = operation(`accept:${version}`);
        const ok = await run('accept', () => service.acceptProposal(id, version, operationId));
        if (ok) retries.delete(`accept:${version}`); return ok;
      }
    };
  }
  const money = value => value === null ? 'Por cotizar' : new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' }).format(value / 100);
  function createPhotoGallery(container, service, id, urls = global.URL) {
    let current = null, generation = 0, activeUrls = [];
    function clear() {
      generation++; current = null;
      activeUrls.forEach(url => urls.revokeObjectURL(url)); activeUrls = [];
      container.replaceChildren();
    }
    async function render(attachments = []) {
      const photos = attachments.filter(p => p && /^[a-zA-Z0-9-]{1,100}$/.test(p.id) && typeof p.name === 'string' && ['image/jpeg', 'image/png', 'image/webp'].includes(p.mimeType)).slice(0, 3);
      const key = JSON.stringify(photos);
      if (key === current) return;
      clear(); current = key; const version = generation;
      for (const photo of photos) {
        const figure = container.ownerDocument.createElement('figure'), caption = container.ownerDocument.createElement('figcaption');
        caption.textContent = photo.name; figure.append(caption); container.append(figure);
        try {
          const blob = await service.getPhoto(id, photo.id);
          if (version !== generation) return;
          const url = urls.createObjectURL(blob), img = container.ownerDocument.createElement('img');
          activeUrls.push(url); img.src = url; img.alt = `Referencia: ${photo.name}`; img.loading = 'lazy'; figure.prepend(img);
        } catch (_) { if (version === generation) { caption.textContent = `${photo.name} · No pudimos cargar esta foto. Actualiza el seguimiento para reintentar.`; current = null; } }
      }
    }
    return { render, clear };
  }
  function mountTracking(root, service, id = root.dataset.trackingId) {
    if (root.dsTrackingController) return root.dsTrackingController;
    const q = key => root.querySelector(`[data-${key}]`);
    const put = (key, value) => { q(key).textContent = value; };
    let expiryTimer = null;
    const clearExpiryTimer = () => { if (expiryTimer !== null) global.clearTimeout?.(expiryTimer); expiryTimer = null; };
    const login = q('login');
    if (login && !service.guest && global.location) {
      try {
        const current = new URL(global.location.href), url = new URL(login.getAttribute('href'), current);
        if (url.origin === current.origin) { current.hash = ''; current.searchParams.set('solicitud', id); url.searchParams.set('return_to', current.pathname + current.search); login.href = url.pathname + url.search; }
      } catch (_) { /* Keep the Shopify-provided login route. */ }
    }
    const gallery = q('photos') && typeof service.getPhoto === 'function' ? createPhotoGallery(q('photos'), service, id) : null;
    const list = (key, items, heading, body) => {
      const container = q(key); container.replaceChildren();
      if (!items.length) { const p = root.ownerDocument.createElement('p'); p.textContent = key === 'comments' ? 'Todavía no hay comentarios.' : 'Todavía no hay propuestas anteriores.'; container.append(p); }
      items.forEach(item => { const article = root.ownerDocument.createElement('article'), strong = root.ownerDocument.createElement('strong'), p = root.ownerDocument.createElement('p'); strong.textContent = heading(item); p.textContent = body(item); article.append(strong, p); container.append(article); });
    };
    function render(state) {
      const s = state.snapshot;
      q('content').hidden = !s;
      q('retry').hidden = !state.error || state.busy;
      if (login) login.hidden = service.guest || state.error?.code !== 'AUTH_REQUIRED' || state.busy;
      clearExpiryTimer();
      put('status-message', state.busy && !s ? 'Cargando tu solicitud…' : !s ? (state.error?.message || 'El seguimiento todavía no está disponible.') : '');
      put('action-message', s && state.error ? state.error.message : state.busy ? state.action === 'syncPayment' ? 'Comprobando el pago con Shopify…' : state.action === 'startPayment' ? 'Preparando el enlace seguro de pago…' : 'Guardando…' : '');
      if (!s) { gallery?.clear(); return; }
      if (q('reference')) { q('reference').hidden = !s.reference; put('reference', s.reference || ''); }
      if (q('guest-access')) q('guest-access').hidden = !service.guest;
      if (q('email-status') && service.guest) {
        const statuses = { pending: 'Estamos preparando tu correo de seguimiento.', sent: 'El servidor de correo aceptó tu enlace de seguimiento. Revisa también el correo no deseado.', failed: 'No pudimos enviar el correo. Tu solicitud está guardada; conserva tu enlace privado.', unknown: 'No pudimos confirmar el envío del correo. Tu solicitud está guardada; conserva tu enlace privado.' };
        put('email-status', statuses[s.emailStatus] || statuses.unknown);
      }
      if (gallery) { q('photos-section').hidden = !s.attachments?.length; void gallery.render(s.attachments || []); }
      put('order-status', statuses[s.status]); put('pickup', s.pickup.label);
      const amounts = balance(s), accepted = s.acceptedProposal;
      q('payments-note').hidden = !accepted || !['reserved', 'preparing'].includes(s.status) || amounts.dueCents === 0;
      put('total', money(amounts.totalCents)); put('paid', money(amounts.paidCents));
      if(q('total-label'))put('total-label',amounts.taxIncluded?'Total':'Precio');
      put('balance-label', amounts.creditCents ? 'A tu favor' : 'Saldo pendiente');
      put('balance', amounts.pendingTax?'Pendiente de actualizar en Shopify':money(amounts.creditCents || amounts.dueCents));
      put('payments-note', paymentMode(s)==='delivery' ? 'Paga el saldo al recoger. Tu reserva está confirmada sin anticipo.' : paymentMode(s)==='full' ? 'El pago completo se realiza antes de preparar. Cualquier ajuste requiere tu aceptación.' : 'Paga el saldo 24 horas antes de recoger. Cualquier ajuste requiere tu aceptación.');
      if (q('payment-note')) {
        const payment = s.payment, review = payment?.reviewRequired || payment?.stage === 'review', expiredPayment = initialPaymentExpired(s);
        const mode=paymentMode(s);
        const canPay = mode!=='delivery' && !!accepted && !s.pendingProposal && !expiredPayment && !review && ['deposit', 'balance'].includes(payment?.stage);
        const url = canPay ? paymentUrl(payment.url, [root.dataset.shop, root.dataset.paymentHost]) : null;
        const unsafeLink = canPay && payment.url !== null && !url;
        const label = payment?.stage === 'balance' ? 'Pagar saldo' : mode==='full' ? 'Pagar pedido' : 'Pagar anticipo';
        q('pay').hidden = !canPay || !!url || unsafeLink; q('pay').disabled = state.busy || expiredPayment; put('pay', label);
        q('payment-link').hidden = !url || state.busy; put('payment-link', label);
        if (url && !state.busy) q('payment-link').setAttribute('href', url); else q('payment-link').removeAttribute('href');
        q('payment-sync').hidden = !payment || !accepted; q('payment-sync').disabled = state.busy;
        put('payment-sync',mode==='delivery'?'Actualizar estado':'Comprobar pago');
        const note = expiredPayment ? 'Esta propuesta venció y su enlace de pago necesita revisión. No pagues con el enlace anterior. Escríbele a Dayana para acordar una nueva fecha y recibir una propuesta vigente.'
          : review && payment?.reason === 'CHECKOUT_PENDING' ? 'Hay un checkout anterior pendiente de comprobar para otra versión de tu propuesta. No pagues con el enlace anterior. Escríbele a Dayana para revisar el pago y continuar.'
          : review && payment?.reason === 'QUOTE_EXPIRED' ? 'Esta propuesta venció y su enlace de pago necesita revisión. No pagues con el enlace anterior. Escríbele a Dayana para acordar una nueva fecha y recibir una propuesta vigente.'
          : review || unsafeLink ? 'Este pago necesita revisión. No vuelvas a pagar; Dayana comprobará el pedido. Puedes actualizar el estado.'
          : s.pendingProposal ? 'Revisa y acepta la propuesta pendiente antes de continuar con el pago.'
          : payment?.stage === 'syncing' ? 'Estamos comprobando el pago con Shopify. No vuelvas a pagar; actualiza el estado en unos momentos.'
          : payment?.stage === 'paid' ? mode==='delivery' ? 'Pago contra entrega registrado por Dayana. No tienes que volver a pagar.' : 'Pago confirmado por Shopify. No tienes que volver a pagar.'
          : mode==='delivery' && accepted ? `Reserva confirmada. Pagarás ${money(amounts.dueCents)} al recoger; no necesitas un anticipo.`
          : canPay ? payment.stage==='balance' ? 'El saldo y los pagos recibidos se comprueban en Shopify.' : mode==='full' ? 'Pago completo del 100% para confirmar la reserva. El pago se realiza en Shopify.' : 'El anticipo es del 60%. La reserva se confirma cuando Shopify acredita el pago.'
          : 'El enlace de pago estará disponible cuando la propuesta aceptada esté lista para pagar.';
        put('payment-note', note);
      }
      q('credit-note').hidden = !amounts.creditCents;
      q('breakdown').hidden = accepted?.display !== 'breakdown';
      put('breakdown', accepted ? `Pastel y personalización: ${money(accepted.baseCents)} · Urgencia: ${money(accepted.surchargeCents)}` : '');
      q('accepted').hidden = !accepted;
      put('request', s.requestText);
      for (const [key, field] of [['can-prepare', 'canPrepare'], ['changes', 'changes'], ['reply', 'reply']]) put(key, key === 'changes' && accepted && !accepted.changes.trim() ? 'Sin cambios respecto a tu referencia.' : accepted?.[field] || '');
      const pending = s.pendingProposal, expired = quoteExpired(pending); q('pending').hidden = !pending;
      if (q('pending-expiry')) {
        q('pending-expiry').hidden = !pending?.expiresAt;
        if (pending?.expiresAt) {
          const deadline = new Intl.DateTimeFormat('es-US', { timeZone: 'America/Chicago', dateStyle: 'long', timeStyle: 'short' }).format(new Date(pending.expiresAt));
          put('pending-expiry', expired ? `Esta propuesta venció el ${deadline} (hora de Houston). Escríbele a Dayana para acordar una nueva fecha y recibir una propuesta vigente.` : `Vigente hasta el ${deadline} (hora de Houston).`);
        }
      }
      if (pending) {
        put('pending-title', accepted ? 'Hay un ajuste por revisar' : 'Tu cotización está lista');
        put('pending-note', ['reserved', 'preparing'].includes(s.status) ? 'Tu reserva y los pagos recibidos se conservan. Aceptar no realiza ningún cobro.' : paymentMode(s,pending)==='delivery' ? 'Al aceptar confirmas tu reserva, si la fecha sigue disponible. Pagarás al recoger; no se realiza ningún cobro ahora.' : 'Aceptar esta propuesta no reserva cupo ni realiza un cobro. La reserva se confirma con el pago correspondiente.');
        put('accept', accepted ? 'Aceptar ajuste' : 'Aceptar propuesta');
        q('pending-breakdown').hidden = pending.display !== 'breakdown';
        put('pending-breakdown', `Pastel y personalización: ${money(pending.baseCents)} · Urgencia: ${money(pending.surchargeCents)}`);
        put('pending-reply', pending.reply); put('pending-can', pending.canPrepare); put('pending-changes', pending.changes.trim() ? pending.changes : 'Sin cambios respecto a tu referencia.');
        put('pending-total', money(pending.totalCents));
        put('pending-balance', terms(s,pending));
      }
      q('accept').disabled = state.busy || !s.permissions.canAccept || expired || s.status === 'ready';
      const canComment = s.permissions.canComment && s.status !== 'ready';
      q('comment-form').hidden = !canComment; q('comment-closed').hidden = canComment;
      q('send').disabled = state.busy; q('comment-input').disabled = state.busy;
      list('comments', s.comments, c => c.author, c => c.text);
      const now = Date.now(), deadlines = [Date.parse(pending?.expiresAt), initialPaymentDeadline(s)].filter(at => Number.isFinite(at) && at > now);
      if (deadlines.length) expiryTimer = global.setTimeout?.(() => render(controller.state), Math.min(Math.min(...deadlines) - now + 1, 2147483647)) ?? null;
      list('history', s.history, h => `Propuesta ${h.version} · ${h.status} · ${money(h.totalCents)}`, h => `${h.reply}${h.paymentMode ? ' · '+({deposit:'Anticipo del 60 %',full:'Pago completo anticipado',delivery:'Pago completo contra entrega'}[h.paymentMode] || '') : ''}`);
    }
    const controller = createController(id, service, render, { shop: root.dataset.shop });
    root.dsTrackingController = controller;
    q('retry').addEventListener('click', () => controller.load());
    if (q('copy-link')) q('copy-link').addEventListener('click', async () => {
      if (!service.guest || !service.privateLink) return;
      const link = service.privateLink(id);
      try { await global.navigator.clipboard.writeText(link); put('copy-status', 'Enlace privado copiado. Guárdalo y no lo compartas.'); }
      catch (_) { q('private-link').hidden = false; q('private-link').value = link; q('private-link').select(); put('copy-status', 'Copia y guarda este enlace privado.'); }
    });
    global.addEventListener?.('pagehide', () => { gallery?.clear(); clearExpiryTimer(); });
    root.ownerDocument.addEventListener('shopify:section:unload', event => { if (event.target.contains(root)) { gallery?.clear(); clearExpiryTimer(); } });
    q('accept').addEventListener('click', async () => { if (await controller.accept()) put('action-message', 'Propuesta aceptada. No se ha realizado ningún cobro.'); });
    q('comment-form').addEventListener('submit', async event => {
      event.preventDefault();
      if (await controller.comment(q('comment-input').value)) { q('comment-input').value = ''; put('action-message', 'Comentario enviado.'); }
    });
    if (q('pay')) q('pay').addEventListener('click', () => controller.startPayment());
    if (q('payment-sync')) q('payment-sync').addEventListener('click', () => controller.syncPayment());
    const syncOnReturn = () => { if (root.isConnected && controller.state.snapshot?.payment) void controller.syncPayment(); };
    global.addEventListener?.('pageshow', event => { if (event.persisted) void controller.load().then(ok => { if (ok) syncOnReturn(); }); });
    let leftForPayment = false;
    if (q('payment-link')) q('payment-link').addEventListener('click', event => {
      if (initialPaymentExpired(controller.state.snapshot)) { event.preventDefault(); render(controller.state); return; }
      leftForPayment = true;
    });
    root.ownerDocument.addEventListener('visibilitychange', () => {
      if (root.ownerDocument.visibilityState !== 'visible') return;
      render(controller.state);
      if (leftForPayment) { leftForPayment = false; syncOnReturn(); }
    });
    void controller.load().then(ok => { if (ok && controller.state.snapshot?.payment && controller.state.snapshot.payment.stage !== 'unavailable') void controller.syncPayment(); });
    return controller;
  }
  global.DSTracking = { balance, createController, mountTracking, paymentUrl, createPhotoGallery, paymentMode, terms };
  // Deliberately no endpoint or automatic fake service. The authenticated integration mounts this API.
})(globalThis);
