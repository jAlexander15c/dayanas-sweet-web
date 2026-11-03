(function (global) {
  'use strict';
  const sponges = ['Chocolate', 'Vainilla', 'Capuchino', 'Fresa'];
  const fillings = ['Nutella', 'Ganache de chocolate', 'Guayaba', 'Coco', 'Dulce de leche', 'Crema pastelera de vainilla', 'Crema con fresas naturales', 'Tiramisú', 'Ferrero'];
  const coatings = ['Merengue italiano', 'Whipped icing', 'Ganache de chocolate', 'Buttercream'];
  const decorations = ['Topper personalizado', 'Imagen comestible', 'Flores de fondant'];
  const messages = {
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
  function createService(basePath) {
    if (!/^\/apps\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(basePath)) throw fail('UNAVAILABLE');
    async function call(path, options = {}) {
      const response = await global.fetch(`${basePath}${path}`, { credentials: 'same-origin', cache: 'no-store', ...options });
      let body;
      try { body = await response.json(); } catch (_) { throw fail('UNAVAILABLE'); }
      if (!response.ok) throw fail(Object.hasOwn(messages, body?.code) ? body.code : 'UNAVAILABLE');
      return body;
    }
    return {
      list: () => call('/requests'),
      calendar: () => call('/calendar'),
      create: body => call('/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      upload: (id, file, operationId) => call(`/requests/${encodeURIComponent(id)}/photos`, { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name), 'X-Operation-Id': operationId }, body: file })
    };
  }
  function createController(service, notify = () => {}, persist = () => {}, recovery = null) {
    const state = { id: null, busy: false, error: null, errorCode: null, intent: null, photos: [], complete: false };
    if (recovery && validId(recovery.id) && Array.isArray(recovery.photos) && recovery.photos.length <= 3 && recovery.photos.every(p => p && typeof p.operationId === 'string' && typeof p.done === 'boolean')) {
      state.id = recovery.id;
      state.photos = recovery.photos.map(p => ({ ...p, file: null }));
    }
    const save = () => persist(state.id ? { id: state.id, photos: state.photos.map(p => ({ ...photoMeta(p), operationId: p.operationId, done: p.done })) } : null);
    return { state, edit() {
      if (state.busy || state.id || state.errorCode !== 'VALIDATION') return false;
      state.intent = null; state.photos = []; state.error = null; state.errorCode = null; notify(state); return true;
    }, async submit(input, files) {
      if (state.busy || state.complete) return false;
      state.busy = true; state.error = null; state.errorCode = null; notify(state);
      try {
        if (!state.intent && !state.id) {
          const selected = validatePhotos(files);
          state.intent = { input: copy(input), operationId: uuid() };
          state.photos = selected.map(file => ({ ...photoMeta(file), file, operationId: uuid(), done: false }));
          notify(state);
        }
        if (!state.id) {
          const snapshot = await service.create(state.intent);
          if (!validId(snapshot?.id)) throw fail('UNAVAILABLE');
          state.id = snapshot.id; save(); notify(state);
        }
        for (const photo of state.photos.filter(p => !p.done)) {
          if (!photo.file) photo.file = validatePhotos(files).find(f => sameFile(f, photo));
          if (!photo.file) throw fail('RECOVERY');
          await service.upload(state.id, photo.file, photo.operationId);
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
    if (root.dataset.mounted || root.dataset.enabled !== 'true' || root.dataset.customer !== 'true') return;
    root.dataset.mounted = 'true';
    const q = s => root.querySelector(s), qa = s => Array.from(root.querySelectorAll(s));
    let service;
    try { service = createService(root.dataset.proxy); } catch (_) { q('[data-gate]').textContent = messages.UNAVAILABLE; return; }
    const storageKey = `ds-celebracion-photo-recovery:${root.dataset.customerKey}`;
    let recovery;
    try { recovery = JSON.parse(global.sessionStorage.getItem(storageKey)); } catch (_) { /* Storage may be unavailable. */ }
    const persist = record => { try { if (record) global.sessionStorage.setItem(storageKey, JSON.stringify(record)); else global.sessionStorage.removeItem(storageKey); } catch (_) { /* In-memory retry still works. */ } };
    const selection = { diameter: 8, tiers: [{ sponges: ['Vainilla', 'Chocolate'], fillings: ['Guayaba', 'Nutella'] }], coating: 'Buttercream', decorations: [], comments: '' };
    const secondTier = { sponges: ['Vainilla', 'Vainilla'], fillings: ['Dulce de leche', 'Dulce de leche'] };
    let step = 0, files = [], previewUrls = [], lastSnapshot = null, checkingCalendar = false;
    const calendar = { ready: false, closed: [] };
    const form = q('[data-form]');
    const link = (anchor, id) => {
      if (!root.dataset.trackingUrl || !validId(id)) { anchor.hidden = true; return; }
      const url = new URL(root.dataset.trackingUrl, global.location.origin);
      if (url.origin !== global.location.origin) { anchor.hidden = true; return; }
      url.searchParams.set('solicitud', id); anchor.href = url.pathname + url.search; anchor.hidden = false;
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
        q('[data-created-id]').textContent = state.id;
        link(q('[data-created-link]'), state.id);
      }
      if (state.complete) {
        form.hidden = true; q('[data-layout]').hidden = true; q('[data-recovery]').hidden = true;
        q('[data-success]').hidden = false;
        link(q('[data-success-link]'), state.id);
        q('[data-success-title]').focus();
        loadRequests();
      }
    }, persist, recovery);
    if (!controller.state.id) recovery = null;
    q('[data-gate]').hidden = true;
    q('[data-live]').hidden = false;
    q('[data-js-note]').hidden = true;

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
        q('[data-date-status]').textContent = info.urgent ? 'Solicitud urgente: requiere aprobación y un recargo que Dayana cotizará. No confirma disponibilidad.' : 'Solicitud normal: desde 7 días de anticipación. La fecha y la hora están sujetas a confirmación.';
        return info;
      } catch (error) { q('[data-date-status]').textContent = error.message; return null; }
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
      if (step < 3) {
        if (step === 2) {
          const date = dateStatus(); if (!date) { q('[data-date]').focus(); return; }
          lastSnapshot = buildInput(selection, date);
          summarize(q('[data-review]'));
          row(q('[data-review]'), 'Recogida solicitada', date.label);
          row(q('[data-review]'), 'Modalidad', date.urgent ? 'Urgente · requiere aprobación y recargo cotizado' : 'Normal');
          row(q('[data-review]'), 'Comentarios', selection.comments.trim() || 'Sin comentarios adicionales.');
          row(q('[data-review]'), 'Fotos de referencia', `${files.length} seleccionadas`);
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
      await controller.submit(lastSnapshot, files);
    });
    q('[data-retry]').addEventListener('click', () => controller.submit(lastSnapshot, files));
    q('[data-edit]').addEventListener('click', () => { if (controller.edit()) showStep(0); });
    q('[data-list-retry]').addEventListener('click', loadRequests);
    q('[data-calendar-retry]').addEventListener('click', loadCalendar);
    if (controller.state.id) {
      q('[data-layout]').hidden = true; q('[data-recovery]').hidden = false;
      q('[data-recovery-id]').textContent = controller.state.id;
      link(q('[data-recovery-link]'), controller.state.id);
      q('[data-pending-photos]').textContent = controller.state.photos.filter(p => !p.done).map(p => p.name).join(', ') || 'No hay fotos pendientes.';
      q('[data-recover-submit]').addEventListener('click', () => controller.submit(null, q('[data-recover-files]').files));
    }
    renderFlavors(); updateSummary(); loadRequests(); loadCalendar();
  }
  global.DSCelebracionSolicitud = { pickupInfo, validateCalendar, validatePhotos, buildInput, createService, createController, mount };
  if (global.document) {
    const init = () => global.document.querySelectorAll('[data-ds-request]').forEach(mount);
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', init); else init();
    global.document.addEventListener('shopify:section:load', init);
  }
})(window);
