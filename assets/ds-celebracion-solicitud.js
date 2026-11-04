(function (global) {
  'use strict';
  const sponges = ['Chocolate', 'Vainilla', 'Capuchino', 'Fresa'];
  const fillings = ['Nutella', 'Ganache de chocolate', 'Guayaba', 'Coco', 'Dulce de leche', 'Crema pastelera de vainilla', 'Crema con fresas naturales', 'Tiramisú', 'Ferrero'];
  const coatings = ['Merengue italiano', 'Whipped icing', 'Ganache de chocolate', 'Buttercream'];
  const decorations = ['Topper personalizado', 'Imagen comestible', 'Flores de fondant'];
  const messages = {
    RATE_LIMITED: 'Se alcanzó el límite temporal de solicitudes. Inténtalo más tarde.',
    AUTH_REQUIRED: 'Tu sesión terminó. Inicia sesión de nuevo para continuar.',
    VALIDATION: 'Revisa los datos. La fecha y la disponibilidad se validan al enviar.',
    UNAVAILABLE: 'No pudimos completar el envío. Puedes reintentarlo sin duplicar la solicitud.',
    RECOVERY: 'Selecciona de nuevo las fotos pendientes que aparecen abajo para completar el envío.',
    PHOTOS: 'Elige hasta 3 fotos JPEG, PNG o WEBP, de un máximo de 2 MB cada una.',
    DATE: 'Elige una fecha y hora válidas con al menos 24 horas de anticipación, en horario de Houston.',
    HOURS: 'El horario de recogida es de 8:00 a. m. a 6:00 p. m., en horario de Houston. La última hora permitida es las 18:00.',
    CLOSED_DATE: 'Dayana cerró esta fecha para recogidas. Elige otro día.',
    CALENDAR: 'Necesitamos consultar el calendario antes de continuar. Actualiza las fechas disponibles e inténtalo de nuevo.',
    CONFLICT: 'No se pudo completar esta operación. Conservamos tu solicitud; consulta su seguimiento antes de continuar.'
  };
  const fail = (code, message) => Object.assign(new Error(message || messages[code] || messages.UNAVAILABLE), { code });
  const uuid = () => global.crypto.randomUUID();
  const copy = value => JSON.parse(JSON.stringify(value));
  const photoMeta = file => ({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified });
  const sameFile = (a, b) => a.name === b.name && a.size === b.size && a.type === b.type && a.lastModified === b.lastModified;
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(id);

  function validatePhotos(files) {
    const list = Array.from(files);
    if (list.length > 3 || list.some(f => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || !Number.isFinite(f.size) || f.size <= 0 || f.size > 2097152 || !f.name)) throw fail('PHOTOS');
    return list;
  }
  function houstonParts(at) {
    const values = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    return Object.fromEntries(values.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  }
  function pickupInfo(day, time, now = Date.now(), closedDates = []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) throw fail('DATE');
    const [year, month, date] = day.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
    if (hour < 8 || hour > 18 || minute > 59 || (hour === 18 && minute !== 0)) throw fail('HOURS');
    if (closedDates.includes(day)) throw fail('CLOSED_DATE');
    const target = Date.UTC(year, month - 1, date, hour, minute);
    let at = target + 6 * 3600000;
    for (let i = 0; i < 3; i++) {
      const p = houstonParts(at);
      const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
      at += target - local;
    }
    const p = houstonParts(at);
    if (`${p.year}-${p.month}-${p.day}` !== day || `${p.hour}:${p.minute}` !== time || at - now < 24 * 3600000) throw fail('DATE');
    return { pickupAt: new Date(at).toISOString(), urgent: at - now < 168 * 3600000, label: `${day} a las ${time} · Houston (fecha solicitada)` };
  }
  function validateCalendar(value) {
    if (!value || !Array.isArray(value.days)) throw fail('CALENDAR');
    const seen = new Set(), closed = [];
    for (const day of value.days) {
      if (!day || typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || typeof day.closed !== 'boolean' || seen.has(day.date)) throw fail('CALENDAR');
      const at = Date.parse(`${day.date}T00:00:00Z`);
      if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== day.date) throw fail('CALENDAR');
      seen.add(day.date);
      if (day.closed) closed.push(day.date);
    }
    return closed.sort();
  }
  function buildInput(selection, date) {
    const tiers = selection.tiers.map(tier => ({ diameter: selection.tiers.length === 2 ? null : selection.diameter, sponges: tier.sponges.slice(), fillings: tier.fillings.slice() }));
    const description = tiers.map((tier, i) => `Piso ${i + 1}: ${tier.diameter ? `${tier.diameter} pulgadas` : 'diámetro a proponer por Dayana'}. Bizcochos: ${tier.sponges.join(' y ')}. Rellenos: ${tier.fillings.join(' y ')}.`).join('\n');
    return {
      requestText: `Pastel personalizado redondo.\n${description}\nCobertura: ${selection.coating}.\nDecoraciones: ${selection.decorations.join(', ') || 'Sin selección'}.\nRecogida solicitada: ${date.label}.\n${date.urgent ? 'Solicitud urgente, sujeta a aprobación y recargo cotizado.\n' : ''}Comentarios: ${selection.comments.trim() || 'Sin comentarios adicionales.'}`,
      pickup: { label: date.label },
      details: { pickupAt: date.pickupAt, urgent: date.urgent, tiers, coating: selection.coating, decorations: selection.decorations.slice() }
    };
  }
  function createService(basePath, { guest = false } = {}) {
    if (!/^\/apps\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(basePath)) throw fail('UNAVAILABLE');
    async function call(path, options = {}) {
      const response = await global.fetch(`${basePath}${guest ? '/guest' : ''}${path}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...options });
      let body;
      try { body = await response.json(); } catch (_) { throw fail('UNAVAILABLE'); }
      if (!response.ok) throw fail(Object.hasOwn(messages, body?.code) ? body.code : 'UNAVAILABLE');
      return body;
    }
    const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return {
      ...(!guest ? { list: () => call('/requests') } : {}),
      calendar: () => call('/calendar', guest ? post({}) : {}),
      create: body => call('/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      async upload(id, file, operationId, capability) {
        if (!validId(id)) throw fail('VALIDATION');
        if (!guest) return call(`/requests/${encodeURIComponent(id)}/photos`, { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name), 'X-Operation-Id': operationId }, body: file });
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        return call(`/requests/${encodeURIComponent(id)}/photos`, post({ capability, name: file.name, mimeType: file.type, base64: global.btoa(binary), operationId }));
      }
    };
  }
  function validContact(value) {
    const contact = { name: String(value?.name || '').trim(), email: String(value?.email || '').trim(), phone: String(value?.phone || '').trim() };
    if (!contact.name || contact.name.length > 120 || contact.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email) || !contact.phone || contact.phone.length > 40 || contact.phone.replace(/\D/g, '').length < 7) throw fail('VALIDATION', 'Indica tu nombre, correo electrónico y teléfono válidos.');
    return contact;
  }
  function createController(service, notify = () => {}, persist = () => {}, recovery = null, { guest = false } = {}) {
    const state = { id: null, busy: false, error: null, errorCode: null, intent: null, photos: [], complete: false, capability: null, snapshot: null };
    const recoveredIntent = recovery?.intent && typeof recovery.intent.operationId === 'string' && recovery.intent.input && (!guest || /^[a-f0-9]{64}$/.test(recovery.intent.capability || ''));
    if (recovery && (validId(recovery.id) || recoveredIntent) && (!guest || recoveredIntent) && Array.isArray(recovery.photos) && recovery.photos.length <= 3 && recovery.photos.every(p => p && typeof p.operationId === 'string' && typeof p.done === 'boolean')) {
      state.id = validId(recovery.id) ? recovery.id : null;
      state.intent = recoveredIntent ? copy(recovery.intent) : null;
      state.capability = guest ? state.intent.capability : null;
      state.snapshot = recovery.snapshot || null;
      state.photos = recovery.photos.map(p => ({ ...p, file: null }));
    }
    const save = () => persist(state.intent || state.id ? { id: state.id, intent: state.intent, snapshot: state.snapshot, photos: state.photos.map(p => ({ ...photoMeta(p), operationId: p.operationId, done: p.done })) } : null);
    return { state, edit() {
      if (state.busy || state.id || state.errorCode !== 'VALIDATION') return false;
      state.intent = null; state.capability = null; state.photos = []; state.error = null; state.errorCode = null; save(); notify(state); return true;
    }, async submit(input, files, contact, website = '') {
      if (state.busy || state.complete) return false;
      state.busy = true; state.error = null; state.errorCode = null; notify(state);
      try {
        if (!state.intent && !state.id) {
          const selected = validatePhotos(files);
          const guestContact = guest ? validContact(contact) : null;
          if (guest && website) throw fail('VALIDATION');
          state.intent = { input: copy(input), operationId: uuid() };
          if (guest) {
            state.capability = Array.from(global.crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
            Object.assign(state.intent, { contact: guestContact, capability: state.capability, website: '' });
          }
          state.photos = selected.map(file => ({ ...photoMeta(file), file, operationId: uuid(), done: false }));
          save(); notify(state);
        }
        if (!state.id) {
          const snapshot = await service.create(state.intent);
          if (!validId(snapshot?.id)) throw fail('UNAVAILABLE');
          state.id = snapshot.id; state.snapshot = snapshot; save(); notify(state);
        }
        for (const photo of state.photos.filter(p => !p.done)) {
          if (!photo.file) photo.file = validatePhotos(files).find(f => sameFile(f, photo));
          if (!photo.file) throw fail('RECOVERY');
          const snapshot = await service.upload(state.id, photo.file, photo.operationId, state.capability);
          if (snapshot?.id === state.id) state.snapshot = snapshot;
          photo.done = true; save(); notify(state);
        }
        state.complete = true; persist(null); return true;
      } catch (error) {
        state.error = error?.message && error?.code ? error.message : messages.UNAVAILABLE;
        state.errorCode = error?.code || 'UNAVAILABLE';
        return false;
      } finally { state.busy = false; notify(state); }
    } };
  }

  function mount(root) {
    const guest = root.dataset.customer !== 'true';
    if (root.dataset.mounted || root.dataset.enabled !== 'true' || (guest && root.dataset.guestEnabled !== 'true')) return;
    root.dataset.mounted = 'true';
    const q = s => root.querySelector(s), qa = s => Array.from(root.querySelectorAll(s));
    let service;
    try { service = createService(root.dataset.proxy, { guest }); } catch (_) { q('[data-gate]').textContent = messages.UNAVAILABLE; return; }
    const storageKey = `ds-celebracion-photo-recovery:${guest ? 'guest' : root.dataset.customerKey}`;
    let recovery;
    try { recovery = JSON.parse(global.sessionStorage.getItem(storageKey)); } catch (_) { /* Storage may be unavailable. */ }
    const persist = record => { try { if (record) global.sessionStorage.setItem(storageKey, JSON.stringify(record)); else global.sessionStorage.removeItem(storageKey); } catch (_) { /* In-memory retry still works. */ } };
    const selection = { diameter: 8, tiers: [{ sponges: ['Vainilla', 'Chocolate'], fillings: ['Guayaba', 'Nutella'] }], coating: 'Buttercream', decorations: [], comments: '' };
    const secondTier = { sponges: ['Vainilla', 'Vainilla'], fillings: ['Dulce de leche', 'Dulce de leche'] };
    let step = 0, files = [], previewUrls = [], lastSnapshot = null, checkingCalendar = false;
    const calendar = { ready: false, closed: [] };
    const form = q('[data-form]');
    const link = (anchor, id) => {
      if (!(root.dataset.trackingUrl || guest) || !validId(id)) { anchor.hidden = true; return; }
      const url = new URL(root.dataset.trackingUrl || '/pages/seguimiento-de-tu-pastel', global.location.origin);
      if (url.origin !== global.location.origin) { anchor.hidden = true; return; }
      url.searchParams.set('solicitud', id);
      if (guest && controller.state.capability) url.hash = `acceso=${controller.state.capability}`;
      anchor.href = url.pathname + url.search + url.hash; anchor.rel = 'noreferrer'; anchor.hidden = false;
    };
    const controller = createController(service, state => {
      form.setAttribute('aria-busy', String(state.busy));
      qa('[data-next], [data-retry], [data-recover-submit]').forEach(b => { b.disabled = state.busy; });
      qa('[data-step] input, [data-step] select, [data-step] textarea, [data-step] button, [data-back]').forEach(el => { el.disabled = !!(state.busy || state.intent || state.id); });
      q('[data-next]').hidden = !!(state.intent || state.id);
      q('[data-error]').textContent = state.error || '';
      q('[data-error]').hidden = !state.error;
      q('[data-retry]').hidden = !state.error || (!state.intent && !state.id) || !!recovery;
      q('[data-edit]').hidden = state.errorCode !== 'VALIDATION' || !!state.id;
      q('[data-login]').hidden = state.errorCode !== 'AUTH_REQUIRED';
      if (state.id) {
        q('[data-created]').hidden = false;
        q('[data-created-id]').textContent = state.snapshot?.reference || state.id;
        if (guest && state.capability) { try { global.sessionStorage.setItem(`ds-guest-access:${state.id}`, state.capability); } catch (_) { /* The link still contains access. */ } }
        link(q('[data-created-link]'), state.id);
      }
      if (state.complete) {
        form.hidden = true; q('[data-layout]').hidden = true; q('[data-recovery]').hidden = true;
        q('[data-success]').hidden = false;
        link(q('[data-success-link]'), state.id);
        q('[data-success-title]').focus();
        if (guest) renderReceipt(state); else loadRequests();
      }
    }, persist, recovery, { guest });
    if (!controller.state.id && !controller.state.intent) recovery = null;
    q('[data-gate]').hidden = true;
    q('[data-live]').hidden = false;
    q('[data-js-note]').hidden = true;

    function renderReceipt(state) {
      q('[data-guest-receipt]').hidden = false;
      q('[data-reference]').textContent = state.snapshot?.reference || 'Solicitud guardada';
      const email = state.snapshot?.contact?.email || state.intent?.contact?.email || '';
      const emailMessages = { pending: `Tu solicitud está guardada. Estamos preparando el correo de seguimiento para ${email}.`, sent: `El servidor de correo aceptó el enlace para ${email}. Revisa también tu carpeta de correo no deseado.`, failed: `Tu solicitud está guardada, pero no pudimos enviar el correo a ${email}. Conserva tu enlace privado.`, unknown: `Tu solicitud está guardada. No pudimos confirmar el envío del correo a ${email}. Conserva tu enlace privado.` };
      q('[data-email-status]').textContent = emailMessages[state.snapshot?.emailStatus] || emailMessages.unknown;
    }
    async function copyTracking() {
      const anchor = q('[data-success-link]');
      try { await global.navigator.clipboard.writeText(anchor.href); q('[data-copy-status]').textContent = 'Enlace privado copiado. Guárdalo y no lo compartas.'; }
      catch (_) { q('[data-private-link]').parentElement.hidden = false; q('[data-private-link]').hidden = false; q('[data-private-link]').value = anchor.href; q('[data-private-link]').select(); q('[data-copy-status]').textContent = 'Copia y guarda este enlace privado.'; }
    }
    if (guest) q('[data-copy-link]').addEventListener('click', copyTracking);
    function contactInput() { return guest ? validContact({ name: q('[data-contact-name]').value, email: q('[data-contact-email]').value, phone: q('[data-contact-phone]').value }) : null; }
    function fieldMessage(field) {
      if (field.type === 'checkbox') return field.checked ? '' : 'Debes confirmar que entiendes las condiciones de la solicitud.';
      const value = field.value.trim();
      if (!value) return 'Este campo es obligatorio.';
      if (field.matches('[data-contact-email]') && !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value)) return 'Escribe un correo electrónico válido.';
      if (field.matches('[data-contact-phone]') && (!/^\+?[\d ().-]+$/.test(value) || value.replace(/\D/g, '').length < 7)) return 'Escribe un teléfono válido con al menos 7 dígitos.';
      if (/[\x00-\x1f\x7f]/.test(value)) return 'Revisa este dato; contiene caracteres no válidos.';
      return field.validity.valid ? '' : 'Revisa el valor de este campo.';
    }
    function markField(field, message) {
      let error = field.parentElement.querySelector('[data-field-error]');
      if (!error) {
        error = document.createElement('span'); error.dataset.fieldError = ''; error.className = 'ds-request__field-error';
        error.id = `ds-field-error-${uuid()}`; field.parentElement.append(error);
        field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
      }
      error.textContent = message; error.hidden = !message;
      field.parentElement.classList.toggle('ds-request__invalid', !!message);
      if (message) field.setAttribute('aria-invalid', 'true'); else field.removeAttribute('aria-invalid');
    }
    function validateStep() {
      const fields = qa(`[data-step="${step}"] [required]`);
      fields.forEach(field => markField(field, fieldMessage(field)));
      if (step === 2 && q('[data-date]').value && q('[data-time]').value) dateStatus();
      const invalid = fields.find(field => field.getAttribute('aria-invalid') === 'true');
      if (!invalid) return true;
      q('[data-error]').textContent = 'Completa o corrige los campos marcados en rojo para continuar.';
      q('[data-error]').hidden = false; invalid.focus(); return false;
    }
    form.addEventListener('input', event => {
      if (!event.target.matches('[required]') || !event.target.parentElement.querySelector('[data-field-error]')) return;
      markField(event.target, fieldMessage(event.target));
      if (!qa('[aria-invalid="true"]').length) q('[data-error]').hidden = true;
    });
    function row(parent, title, content) {
      const wrap = document.createElement('div'), label = document.createElement('dt'), value = document.createElement('dd');
      label.textContent = title; value.textContent = content; wrap.append(label, value); parent.append(wrap);
    }
    function summarize(target) {
      target.replaceChildren();
      row(target, 'Pastel redondo', `${selection.tiers.length} ${selection.tiers.length === 1 ? `piso · ${selection.diameter}″` : 'pisos · Dayana propondrá los diámetros'}`);
      selection.tiers.forEach((t, i) => row(target, `Piso ${i + 1}`, `${t.sponges.join(' + ')} · ${t.fillings.join(' + ')}`));
      row(target, 'Cobertura', selection.coating);
      row(target, 'Decoraciones', selection.decorations.join(', ') || 'Sin selección');
    }
    function updateSummary() { summarize(q('[data-summary]')); }
    function options(select, list, value) {
      list.forEach(text => { const option = document.createElement('option'); option.value = text; option.textContent = text; option.selected = text === value; select.append(option); });
    }
    function renderFlavors() {
      const area = q('[data-flavors]'); area.replaceChildren();
      selection.tiers.forEach((tier, index) => {
        const fieldset = document.createElement('fieldset'), legend = document.createElement('legend'), grid = document.createElement('div');
        legend.textContent = `Sabores · Piso ${index + 1}`; grid.className = 'ds-request__two'; fieldset.append(legend, grid);
        for (const key of ['sponges', 'fillings']) for (let i = 0; i < 2; i++) {
          const label = document.createElement('label'), select = document.createElement('select');
          label.textContent = `${key === 'sponges' ? 'Bizcocho' : 'Relleno'} ${i + 1}`;
          options(select, key === 'sponges' ? sponges : fillings, tier[key][i]);
          select.addEventListener('change', () => { tier[key][i] = select.value; updateSummary(); });
          label.append(select); grid.append(label);
        }
        area.append(fieldset);
      });
    }
    function showStep(value) {
      step = value;
      qa('[data-step]').forEach(el => { el.hidden = Number(el.dataset.step) !== step; });
      qa('[data-marker]').forEach(el => { if (Number(el.dataset.marker) === step) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); });
      q('[data-back]').hidden = step === 0;
      q('[data-next]').textContent = ['Continuar a tu idea', 'Elegir fecha', 'Revisar solicitud', 'Enviar solicitud'][step];
      q('[data-error]').hidden = true;
      q(`[data-step="${step}"] h2`).focus();
    }
    function dateStatus() {
      try {
        if (!calendar.ready) throw fail('CALENDAR');
        const info = pickupInfo(q('[data-date]').value, q('[data-time]').value, Date.now(), calendar.closed);
        markField(q('[data-date]'), ''); markField(q('[data-time]'), '');
        q('[data-date-status]').textContent = info.urgent ? 'Solicitud urgente: requiere aprobación y un recargo que Dayana cotizará. No confirma disponibilidad.' : 'Solicitud normal: desde 7 días de anticipación. La fecha y la hora están sujetas a confirmación.';
        return info;
      } catch (error) {
        q('[data-date-status]').textContent = error.message;
        if (error.code !== 'CALENDAR' && q('[data-date]').value && q('[data-time]').value) markField(q(error.code === 'HOURS' ? '[data-time]' : '[data-date]'), error.message);
        return null;
      }
    }
    async function loadCalendar() {
      calendar.ready = false;
      q('[data-calendar-status]').textContent = 'Consultando las fechas disponibles…';
      q('[data-calendar-retry]').disabled = true;
      try {
        calendar.closed = validateCalendar(await service.calendar()); calendar.ready = true;
        const min = q('[data-date]').min;
        const upcoming = calendar.closed.filter(day => day >= min);
        q('[data-calendar-status]').textContent = upcoming.length ? `Fechas cerradas por Dayana: ${upcoming.join(', ')}. Los demás días están sujetos a su confirmación.` : 'El calendario no tiene fechas cerradas próximas. La fecha solicitada necesita la aceptación de Dayana.';
        if (q('[data-date]').value) dateStatus();
        return true;
      } catch (error) {
        q('[data-calendar-status]').textContent = error?.code === 'AUTH_REQUIRED' ? error.message : messages.CALENDAR;
        q('[data-login]').hidden = error?.code !== 'AUTH_REQUIRED';
        dateStatus(); return false;
      } finally { q('[data-calendar-retry]').disabled = false; }
    }
    async function loadRequests() {
      const status = q('[data-list-status]');
      status.textContent = 'Consultando tus solicitudes…';
      try {
        const result = await service.list();
        if (!Array.isArray(result?.requests)) throw fail('UNAVAILABLE');
        q('[data-requests]').replaceChildren();
        result.requests.forEach(item => {
          if (!validId(item?.id)) return;
          const li = document.createElement('li'), anchor = document.createElement('a'), text = document.createElement('span');
          text.textContent = item.pickup?.label || `Solicitud ${item.id}`;
          anchor.textContent = 'Ver seguimiento'; link(anchor, item.id); li.append(text, anchor); q('[data-requests]').append(li);
        });
        status.textContent = result.requests.length ? 'Puedes continuar la conversación desde el seguimiento de cada solicitud.' : 'Todavía no tienes solicitudes.';
      } catch (error) { status.textContent = error?.code ? error.message : 'No pudimos consultar tus solicitudes. Puedes reintentar la consulta.'; }
    }
    qa('[data-floors]').forEach(button => button.addEventListener('click', () => {
      const count = Number(button.dataset.floors);
      if (count === 2 && selection.tiers.length === 1) selection.tiers.push(secondTier);
      if (count === 1) selection.tiers.length = 1;
      qa('[data-floors]').forEach(el => el.setAttribute('aria-pressed', String(Number(el.dataset.floors) === count)));
      q('[data-size-field]').hidden = count === 2;
      q('[data-height-note]').textContent = count === 2 ? 'Dayana propondrá la combinación de diámetros (6″ a 16″) y la altura según tu diseño.' : 'Dayana propondrá la altura según tu diseño.';
      renderFlavors(); updateSummary();
    }));
    qa('[data-diameter]').forEach(button => button.addEventListener('click', () => {
      selection.diameter = Number(button.dataset.diameter);
      qa('[data-diameter]').forEach(el => el.setAttribute('aria-pressed', String(Number(el.dataset.diameter) === selection.diameter))); updateSummary();
    }));
    options(q('[data-coating]'), coatings, selection.coating);
    q('[data-coating]').addEventListener('change', e => { selection.coating = e.target.value; updateSummary(); });
    qa('[data-decoration]').forEach(el => el.addEventListener('change', () => { selection.decorations = qa('[data-decoration]:checked').map(input => decorations[Number(input.dataset.decoration)]); updateSummary(); }));
    q('[data-comments]').addEventListener('input', e => { selection.comments = e.target.value; });
    q('[data-files]').addEventListener('change', e => {
      try {
        const next = validatePhotos(e.target.files);
        previewUrls.forEach(url => global.URL.revokeObjectURL(url)); previewUrls = []; files = next;
        q('[data-photos]').replaceChildren();
        files.forEach((file, index) => {
          const figure = document.createElement('figure'), img = document.createElement('img'), caption = document.createElement('figcaption'), remove = document.createElement('button');
          const url = global.URL.createObjectURL(file); previewUrls.push(url);
          img.src = url; img.alt = `Referencia ${index + 1}`; caption.textContent = file.name; remove.type = 'button'; remove.textContent = 'Quitar';
          remove.addEventListener('click', () => { files = files.filter(f => f !== file); global.URL.revokeObjectURL(url); figure.remove(); });
          figure.append(img, caption, remove); q('[data-photos]').append(figure);
        });
        q('[data-error]').hidden = true;
      } catch (error) { q('[data-error]').textContent = error.message; q('[data-error]').hidden = false; }
      e.target.value = '';
    });
    q('[data-date]').addEventListener('change', dateStatus); q('[data-time]').addEventListener('change', dateStatus);
    const minDate = houstonParts(Date.now() + 24 * 3600000);
    q('[data-date]').min = `${minDate.year}-${minDate.month}-${minDate.day}`;
    q('[data-back]').addEventListener('click', () => showStep(step - 1));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (checkingCalendar) return;
      if (!validateStep()) return;
      if (step < 3) {
        if (step === 2) {
          if (guest) { try { contactInput(); } catch (error) { q('[data-error]').textContent = error.message; q('[data-error]').hidden = false; const invalid = qa('[data-guest-contact] input').find(el => !el.checkValidity()); (invalid || q('[data-contact-name]')).focus(); return; } }
          const date = dateStatus(); if (!date) { q('[data-date]').focus(); return; }
          lastSnapshot = buildInput(selection, date);
          summarize(q('[data-review]'));
          row(q('[data-review]'), 'Recogida solicitada', date.label);
          row(q('[data-review]'), 'Modalidad', date.urgent ? 'Urgente · requiere aprobación y recargo cotizado' : 'Normal');
          row(q('[data-review]'), 'Comentarios', selection.comments.trim() || 'Sin comentarios adicionales.');
          row(q('[data-review]'), 'Fotos de referencia', `${files.length} seleccionadas`);
          if (guest) { const c = contactInput(); row(q('[data-review]'), 'Tu contacto', `${c.name} · ${c.email} · ${c.phone}`); }
        }
        showStep(step + 1); return;
      }
      if (!q('[data-confirm]').checked) { q('[data-error]').textContent = 'Confirma que entiendes cómo funciona la solicitud.'; q('[data-error]').hidden = false; q('[data-confirm]').focus(); return; }
      checkingCalendar = true; q('[data-next]').disabled = true; q('[data-back]').disabled = true;
      const calendarReady = await loadCalendar();
      checkingCalendar = false; q('[data-next]').disabled = false; q('[data-back]').disabled = false;
      if (!calendarReady) { showStep(2); return; }
      const date = dateStatus(); if (!date) { showStep(2); return; }
      lastSnapshot = buildInput(selection, date);
      await controller.submit(lastSnapshot, files, guest ? contactInput() : null, guest ? q('[data-website]').value : '');
    });
    q('[data-retry]').addEventListener('click', () => controller.submit(lastSnapshot, files));
    q('[data-edit]').addEventListener('click', () => {
      if (controller.edit()) { recovery = null; q('[data-recovery]').hidden = true; q('[data-layout]').hidden = false; showStep(0); }
    });
    if (!guest) q('[data-list-retry]').addEventListener('click', loadRequests);
    q('[data-calendar-retry]').addEventListener('click', loadCalendar);
    if (controller.state.id || controller.state.intent) {
      q('[data-layout]').hidden = true; q('[data-recovery]').hidden = false;
      q('[data-recovery-id]').textContent = controller.state.snapshot?.reference || controller.state.id || 'Pendiente de confirmar; reintentaremos la misma solicitud.';
      if (!controller.state.id) q('[data-recovery] h2').textContent = 'Completemos tu envío';
      link(q('[data-recovery-link]'), controller.state.id);
      q('[data-pending-photos]').textContent = controller.state.photos.filter(p => !p.done).map(p => p.name).join(', ') || 'No hay fotos pendientes.';
      q('[data-recover-submit]').addEventListener('click', () => controller.submit(null, q('[data-recover-files]').files));
    }
    renderFlavors(); updateSummary(); if (!guest) loadRequests(); loadCalendar();
    global.addEventListener?.('pagehide', () => { previewUrls.forEach(url => global.URL.revokeObjectURL(url)); previewUrls = []; });
  }
  global.DSCelebracionSolicitud = { pickupInfo, validateCalendar, validatePhotos, validContact, buildInput, createService, createController, mount };
  if (global.document) {
    const init = () => global.document.querySelectorAll('[data-ds-request]').forEach(mount);
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', init); else init();
    global.document.addEventListener('shopify:section:load', init);
  }
})(window);
