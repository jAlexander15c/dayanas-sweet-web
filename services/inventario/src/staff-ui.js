// Shared access/transport adapter. No dependencies, third-party scripts or credential-bearing URLs.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const portal = document.body.dataset.portal === 'true';
const storageKey = 'dayanas.inventario.session';
const base = new URL('../', import.meta.url).pathname;
let credential, currentUser, initializeInventory, invitationToken, recoveryIdentifier = '', busy = false;
const field = (label, name, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" required ${extra}></label>`;
const rules = '<ul class="password-rules"><li>Al menos 10 caracteres</li><li>Distinta de tu usuario</li><li>No es una contraseña muy común</li></ul>';
// La sesión vive solo en esta pestaña (sessionStorage): se borra al cerrarla y no queda en el disco del navegador.
// Se limpia también la copia que guardaban las versiones anteriores en localStorage.
function forgetLegacySession() { try { localStorage.removeItem(storageKey); } catch { /* almacenamiento bloqueado */ } }
function clearSession() { credential = null; currentUser = null; try { sessionStorage.removeItem(storageKey); } catch { /* almacenamiento bloqueado */ } forgetLegacySession(); }
function saveSession(result) { credential = { session: result.session, expiresAt: result.expiresAt }; try { sessionStorage.setItem(storageKey, JSON.stringify(credential)); } catch { /* la sesión sigue en memoria */ } forgetLegacySession(); currentUser = result.user; }
const REQUEST_TIMEOUT_MS = 30000;
// R04: si la conexión se queda colgada, la petición se corta y se informa; las escrituras inciertas siguen el flujo de "consultar la misma operación".
async function timedFetch(url, options) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch (error) { if (controller.signal.aborted) throw Object.assign(new Error('La conexión tardó demasiado. Revisa tu internet e inténtalo otra vez.'), { code: 'TIMEOUT' }); throw error; }
  finally { clearTimeout(timer); }
}
async function request(action, body = {}) {
  let response;
  if (portal) response = await timedFetch(`${base}api/${action}`, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, session: credential?.session }) });
  else {
    if (!window.shopify?.idToken) throw new Error('Abre Dayana Inventario desde Shopify.');
    response = await timedFetch(`/api/staff/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${await window.shopify.idToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  const result = await response.json();
  if (!response.ok) {
    if (portal && result.code === 'SESSION_REQUIRED') { clearSession(); hideViews(); showAccess('login'); }
    throw Object.assign(new Error(result.message || 'No pudimos completar esta acción.'), { code: result.code, status: response.status, result });
  }
  return result;
}
function message(text, error = false) { const element = $('#staff-message') || $('#access-message'); if (element) { element.textContent = text; element.classList.toggle('error', error); } }
function showAccess(screen, notice = '') {
  // R02: cierra confirmaciones y editores abiertos para que la pantalla de entrada quede usable con teclado.
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  $('#celebraciones-frame')?.remove();
  $('#panel-view').hidden = true; $('#access-view').hidden = false; $('#staff-who').replaceChildren();
  let title, description = '', fields, submit, links;
  if (screen === 'login') {
    title = 'Entrar al panel'; description = 'Inventario y Celebraciones, en un solo lugar. Solo para el equipo de Dayana’s Sweet.';
    fields = field('Usuario', 'username', 'text', 'autocomplete="username" maxlength="32"') + field('Contraseña', 'password', 'password', 'autocomplete="current-password" maxlength="256"');
    submit = 'Entrar'; links = '<button type="button" class="text-button" data-screen="recover">Olvidé mi contraseña</button>';
  } else if (screen === 'recover') {
    title = 'Recuperar contraseña'; description = 'Escribe tu usuario o tu correo. Si está registrado, te enviamos un código de 6 números a tu correo.';
    fields = field('Usuario o correo', 'identifier', 'text', 'autocomplete="username" maxlength="254"'); submit = 'Enviar código'; links = '<button type="button" class="text-button" data-screen="login">Volver a entrar</button>';
  } else if (screen === 'reset') {
    title = 'Revisa tu correo'; description = 'Si los datos están registrados, recibirás un código. Vence en 10 minutos.';
    fields = `<fieldset class="otp-field"><legend>Código de 6 números</legend><div class="otp-code">${Array.from({ length: 6 }, (_, i) => `<input type="text" aria-label="Número ${i + 1}" inputmode="numeric" ${i === 0 ? 'autocomplete="one-time-code" maxlength="6"' : 'autocomplete="off" maxlength="1"'} required pattern="[0-9]">`).join('')}</div></fieldset>` + field('Nueva contraseña', 'password', 'password', 'autocomplete="new-password" minlength="10" maxlength="256"') + rules;
    submit = 'Guardar y entrar'; links = '<button type="button" class="text-button" id="resend-code">Enviar otro código</button><button type="button" class="text-button" data-screen="login">Volver a entrar</button>';
  } else {
    title = 'Crea tu acceso'; description = 'Elige tu contraseña; tu usuario ya está listo.';
    fields = '<p id="invitation-name"></p>' + field('Usuario', 'username', 'text', 'readonly autocomplete="username"') + field('Contraseña', 'password', 'password', 'autocomplete="new-password" minlength="10" maxlength="256"') + field('Repite la contraseña', 'repeat', 'password', 'autocomplete="new-password" minlength="10" maxlength="256"') + rules;
    submit = 'Crear contraseña y entrar'; links = '<p class="notice">El enlace de invitación sirve una sola vez y vence en 48 horas.</p>';
  }
  $('#access-view').innerHTML = `<div class="access-card"><p class="eyebrow">${screen === 'invitation' ? 'Invitación' : 'Panel de la pastelera'}</p><h1>${title}</h1><p class="muted">${description}</p><form id="access-form">${fields}<button class="primary" id="access-submit">${submit}</button></form>${links}<p id="access-message" role="status" aria-live="polite"></p></div>`;
  message(notice);
  if (!$('#access-view').hidden) $('#access-form input:not([readonly])')?.focus();
  $('#access-form').onsubmit = async event => {
    event.preventDefault(); if (busy) return; busy = true; $('#access-submit').disabled = true;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (screen === 'reset') data.code = [...event.currentTarget.querySelectorAll('.otp-code input')].map(input => input.value).join('');
    try {
      if (screen === 'recover') { recoveryIdentifier = data.identifier; const result = await request('recover', data); showAccess('reset', result.message); }
      else {
        if (screen === 'invitation' && data.password !== data.repeat) throw new Error('Las dos contraseñas deben coincidir.');
        const result = await request(screen === 'login' ? 'login' : screen === 'reset' ? 'reset-password' : 'accept-invitation', { ...data, identifier: recoveryIdentifier, token: invitationToken });
        invitationToken = null; saveSession(result); await showPanel();
      }
    } catch (error) { message(error.message, true); }
    finally { busy = false; if ($('#access-submit')) $('#access-submit').disabled = false; }
  };
  for (const button of $('#access-view').querySelectorAll('[data-screen]')) button.onclick = () => showAccess(button.dataset.screen);
  if ($('#resend-code')) $('#resend-code').onclick = async event => { event.currentTarget.disabled = true; try { message((await request('recover', { identifier: recoveryIdentifier })).message); } catch (e) { message(e.message, true); } finally { if ($('#resend-code')) $('#resend-code').disabled = false; } };
  const digits = [...$('#access-view').querySelectorAll('.otp-code input')];
  digits.forEach((input, index) => {
    const distribute = text => { const numbers = text.replace(/\D/g, '').slice(0, 6 - index); for (let i = 0; i < numbers.length; i++) digits[index + i].value = numbers[i]; digits[Math.min(5, index + numbers.length)]?.focus(); };
    input.oninput = () => { const value = input.value; input.value = ''; distribute(value); };
    input.onpaste = event => { event.preventDefault(); distribute(event.clipboardData.getData('text')); };
    input.onkeydown = event => { if (event.key === 'Backspace' && !input.value && index > 0) digits[index - 1].focus(); };
  });
  if (screen === 'invitation') request('invitation-info', { token: invitationToken }).then(result => { if (!$('#invitation-name')) return; $('#invitation-name').textContent = `Hola, ${result.name}.`; $('#access-form [name=username]').value = result.username; }).catch(e => { message(e.message, true); if ($('#access-submit')) $('#access-submit').disabled = true; });
}
function hideViews() { for (const id of ['workspace', 'categories-view', 'history-view', 'users-view', 'celebraciones-view']) $(`#${id}`).hidden = true; }
async function showPanel() {
  $('#access-view').hidden = true; $('#access-view').replaceChildren(); $('#panel-view').hidden = false;
  const roles = currentUser.roles;
  $('#staff-who').innerHTML = `<span>${esc(currentUser.name)}${roles.includes('admin') ? ' · Administradora' : ''}</span><button id="change-password">Cambiar contraseña</button><button id="sign-out">Salir</button>`;
  $('#users').hidden = !roles.includes('admin'); $('#celebraciones').hidden = !roles.includes('celebraciones');
  for (const id of ['home', 'categories', 'history']) $(`#${id}`).hidden = !roles.includes('inventario');
  $('#sign-out').onclick = async () => {
    // Start server revocation with the current token, then always clear this device immediately.
    const pending = request('logout'); clearSession(); hideViews(); showAccess('login', 'Cerraste la sesión en este aparato.');
    try { await pending; }
    catch { message('Cerraste la sesión en este aparato. No pudimos confirmar el cierre en el servidor por un problema de conexión.'); }
  };
  $('#change-password').onclick = () => {
    hideViews(); $('#users-view').hidden = false;
    $('#users-view').innerHTML = `<div class="access-card"><h2>Cambiar contraseña</h2><form id="password-form">${field('Contraseña actual', 'currentPassword', 'password', 'autocomplete="current-password" maxlength="256"')}${field('Nueva contraseña', 'password', 'password', 'autocomplete="new-password" minlength="10" maxlength="256"')}${rules}<button class="primary">Guardar contraseña</button></form><p id="staff-message" role="status"></p></div>`;
    $('#password-form').onsubmit = async event => { event.preventDefault(); const b = event.currentTarget.querySelector('button'); b.disabled = true; try { await request('change-password', Object.fromEntries(new FormData(event.currentTarget))); clearSession(); showAccess('login', 'Contraseña cambiada. Entra con tu nueva contraseña.'); } catch (e) { message(e.message, true); b.disabled = false; } };
  };
  if (roles.includes('inventario')) await initializeInventory();
  else { hideViews(); $('#feedback').textContent = 'Elige una sección para continuar.'; if (roles.includes('admin')) await showUsers(); }
  if (location.hash.startsWith('#celebraciones') && roles.includes('celebraciones')) showCelebraciones();
}
const roleFields = roles => `<fieldset><legend>Permisos</legend>${[['admin','Administrador (maneja usuarios)'],['inventario','Inventario (productos, fotos, stock, categorías)'],['celebraciones','Celebraciones']].map(([role,label]) => `<label class="role-option"><input type="checkbox" name="roles" value="${role}" ${roles.includes(role) ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>`;
async function showUsers() {
  hideViews(); $('#users-view').hidden = false;
  const { users } = await request('users');
  const first = !users.some(u => u.status === 'active' && u.roles.includes('admin'));
  $('#feedback').textContent = '';
  $('#users-view').innerHTML = `<h2>${portal ? 'Usuarios' : 'Usuarios de /inventarios'}</h2>${portal ? '' : '<p class="notice">Llave maestra: aquí entras con tu cuenta de Shopify. Desde aquí se crea el primer usuario y se recupera el acceso si se pierden las contraseñas.</p><button id="connect-external">Conectar acceso externo</button>'}<form id="invite-form" class="card user-form"><h3>${first ? 'Invitar al primer administrador' : 'Invitar a alguien'}</h3>${field('Nombre', 'name', 'text', 'maxlength="100"')}${field('Usuario', 'username', 'text', 'pattern="[a-z0-9._-]{3,32}" minlength="3" maxlength="32" autocomplete="off"')}${field('Correo', 'email', 'email', 'maxlength="254"')}${roleFields(first ? ['admin', 'inventario'] : ['inventario'])}<button class="primary">Enviar invitación</button></form><p id="staff-message" role="status" aria-live="polite"></p><div class="user-list">${users.map(u => `<article class="card user-card"><div><h3>${esc(u.name)}</h3><p>${esc(u.email)} · usuario: ${esc(u.username)}</p></div><div class="actions">${u.status === 'invited' ? `<button data-user="${esc(u.id)}" data-action="resend-invitation">Reenviar</button><button data-user="${esc(u.id)}" data-action="cancel-invitation">Cancelar</button>` : `<button data-user="${esc(u.id)}" data-action="edit">Editar permisos</button><button data-user="${esc(u.id)}" data-action="${u.status === 'disabled' ? 'active' : 'disabled'}">${u.status === 'disabled' ? 'Reactivar' : 'Desactivar'}</button>`}</div><div class="chips"><span class="badge">${u.status === 'active' ? 'Activa' : u.status === 'disabled' ? 'Desactivado' : `Invitación pendiente${u.invitationExpiresAt ? ' · vence ' + new Date(u.invitationExpiresAt).toLocaleString('es') : ' · pendiente de envío'}`}</span>${u.roles.map(r => `<span class="badge">${esc(r)}</span>`).join('')}${u.lastLoginAt ? `<span class="muted">Entró ${esc(new Date(u.lastLoginAt).toLocaleString('es'))}</span>` : ''}</div></article>`).join('')}</div><p class="muted">Desactivar cierra sus sesiones abiertas. Siempre debe quedar al menos un administrador activo.</p>`;
  $('#invite-form').onsubmit = async event => {
    event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'); button.disabled = true;
    try { const data = new FormData(form); await request('invite', { ...Object.fromEntries(data), roles: data.getAll('roles') }); await showUsers(); message('Invitación enviada. Vence en 48 horas.'); }
    catch (e) { if (e.code === 'EMAIL_FAILED') await showUsers(); message(e.message, true); button.disabled = false; }
  };
  if ($('#connect-external')) $('#connect-external').onclick = async event => { event.currentTarget.disabled = true; try { await request('connect'); message('Acceso externo conectado a Shopify.'); } catch (e) { message(e.message, true); } finally { if ($('#connect-external')) $('#connect-external').disabled = false; } };
  for (const button of $('#users-view').querySelectorAll('[data-user]')) button.onclick = async () => {
    const user = users.find(u => u.id === button.dataset.user), action = button.dataset.action;
    if (action === 'edit') {
      const card = button.closest('article');
      card.innerHTML = `<h3>Permisos de ${esc(user.name)}</h3><form>${roleFields(user.roles)}<button class="primary">Guardar permisos</button><button type="button" data-cancel>Volver</button></form>`;
      card.querySelector('[data-cancel]').onclick = () => showUsers().catch(e => message(e.message, true));
      card.querySelector('form').onsubmit = async event => { event.preventDefault(); const b = event.currentTarget.querySelector('button'); b.disabled = true; try { await request('update-user', { userId: user.id, roles: new FormData(event.currentTarget).getAll('roles') }); if (portal && user.id === currentUser.id) { const r = await request('session'); currentUser = r.user; } await showUsers(); } catch (e) { message(e.message, true); b.disabled = false; } }; return;
    }
    button.disabled = true;
    try { await request(['active','disabled'].includes(action) ? 'update-user' : action, { userId: user.id, ...(['active','disabled'].includes(action) ? { status: action } : {}) }); await showUsers(); message(action === 'resend-invitation' ? 'Invitación enviada.' : 'Cambio guardado.'); } catch (e) { message(e.message, true); button.disabled = false; }
  };
}
function showCelebraciones() {
  if (!portal || !currentUser?.roles.includes('celebraciones')) return;
  hideViews(); $('#celebraciones-view').hidden = false;
  const requestId = location.hash.match(/^#celebraciones\/([a-f0-9-]{36})$/)?.[1];
  const source = `${base}celebraciones${requestId ? '?solicitud=' + encodeURIComponent(requestId) : ''}`;
  let frame = $('#celebraciones-frame');
  if (!frame) { frame = document.createElement('iframe'); frame.id = 'celebraciones-frame'; frame.title = 'Solicitudes y pagos de Celebraciones'; $('#celebraciones-view').replaceChildren(frame); }
  if (frame.getAttribute('src') !== source) frame.src = source;
  $('#feedback').textContent = '';
}
window.inventarioPortal = { mode: portal, request };
window.inventarioAccess = {
  async inventory(path, body) { const url = new URL(path, location.origin); return request(`inventory/${url.pathname.slice('/api/'.length)}`, { params: Object.fromEntries(url.searchParams), ...(body ? { body } : {}) }); },
  async boot(start) {
    initializeInventory = start;
    $('#users').onclick = () => showUsers().catch(e => { $('#feedback').textContent = e.message; });
    for (const id of ['home', 'categories', 'history']) $(`#${id}`).addEventListener('click', () => { $('#users-view').hidden = true; $('#celebraciones-view').hidden = true; });
    if (!portal) return start();
    $('#celebraciones').onclick = () => { location.hash = 'celebraciones'; showCelebraciones(); };
    addEventListener('hashchange', () => { if (currentUser?.roles.includes('celebraciones') && location.hash.startsWith('#celebraciones')) showCelebraciones(); });
    addEventListener('storage', event => { if (event.key === storageKey && !event.newValue) { credential = null; currentUser = null; hideViews(); showAccess('login'); } });
    const fragment = new URLSearchParams(location.hash.slice(1)); invitationToken = fragment.get('invitacion');
    if (invitationToken) { history.replaceState(null, '', location.pathname + location.search); showAccess('invitation'); return; }
    try {
      forgetLegacySession();
      credential = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (credential?.expiresAt > Date.now() && typeof credential.session === 'string') { currentUser = (await request('session')).user; await showPanel(); return; }
    } catch { /* Expired credentials are removed; no tokens go into diagnostics. */ }
    clearSession(); showAccess('login');
  },
};
