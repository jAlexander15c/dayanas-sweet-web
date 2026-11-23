// Shared access/transport adapter. No dependencies, third-party scripts or credential-bearing URLs.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const portal = document.body.dataset.portal === 'true';
const storageKey = 'dayanas.inventario.session';
const base = new URL('../', import.meta.url).pathname;
let credential, currentUser, initializeInventory, invitationToken, recoveryIdentifier = '', busy = false, lastLogin = null, loginOptions = null;
const field = (label, name, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" required ${extra}></label>`;
const rules = '<ul class="password-rules"><li>Al menos 10 caracteres</li><li>Distinta de tu usuario</li><li>No es una contraseña muy común</li></ul>';
// La sesión vive solo en esta pestaña (sessionStorage): se borra al cerrarla y no queda en el disco del navegador.
// Se limpia también la copia que guardaban las versiones anteriores en localStorage.
function forgetLegacySession() { try { localStorage.removeItem(storageKey); } catch { /* almacenamiento bloqueado */ } }
function clearSession() { credential = null; currentUser = null; try { sessionStorage.removeItem(storageKey); } catch { /* almacenamiento bloqueado */ } forgetLegacySession(); }
function saveSession(result) { credential = { session: result.session, expiresAt: result.expiresAt }; try { sessionStorage.setItem(storageKey, JSON.stringify(credential)); } catch { /* la sesión sigue en memoria */ } forgetLegacySession(); currentUser = result.user; }
// Passkeys (Face ID, huella o bloqueo de pantalla). La cara y la huella nunca salen del aparato:
// el teléfono firma un desafío del servidor, que solo guarda la llave pública.
const passkeyKey = 'dayanas.inventario.passkey';
const toBytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const toBase64url = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const passkeysSupported = () => portal && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials?.create;
async function platformPasskeyAvailable() { try { return passkeysSupported() && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; } }
// Preferencia de este aparato (ya activado o «ahora no»); si el navegador bloquea el almacenamiento, se vuelve a ofrecer.
function devicePreference(value) { try { if (value === undefined) return localStorage.getItem(passkeyKey); localStorage.setItem(passkeyKey, value); } catch { return null; } return value; }
const passkeyError = error => error?.name === 'NotAllowedError' || error?.name === 'AbortError' ? 'No se completó. Inténtalo otra vez o entra con tu contraseña.'
  : error?.name === 'InvalidStateError' ? 'Este aparato ya tiene Face ID o huella activado.' : error?.message || 'No pudimos usar Face ID o huella en este aparato.';
function deviceName() { const ua = navigator.userAgent; return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (/SM-|Samsung/i.test(ua) ? 'Samsung' : 'Android') : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Computadora' : 'Este aparato'; }
function prepareLoginOptions() { loginOptions = null; if (passkeysSupported()) request('passkey-options').then(options => { loginOptions = { ...options, readyAt: Date.now() }; }).catch(() => {}); }
async function passkeyLogin() {
  // Las opciones se piden antes del toque: Safari solo abre Face ID si la llamada sigue al toque sin esperas.
  const options = loginOptions && Date.now() - loginOptions.readyAt < 4 * 60000 ? loginOptions : await request('passkey-options');
  loginOptions = null;
  const found = await navigator.credentials.get({ publicKey: { challenge: toBytes(options.challenge), rpId: options.rpId, timeout: options.timeout, userVerification: 'required', allowCredentials: [] } });
  const response = found.response;
  return request('passkey-login', { credentialId: toBase64url(found.rawId), clientDataJSON: toBase64url(response.clientDataJSON), authenticatorData: toBase64url(response.authenticatorData), signature: toBase64url(response.signature), ...(response.userHandle?.byteLength ? { userHandle: toBase64url(response.userHandle) } : {}) });
}
const REQUEST_TIMEOUT_MS = 30000;
// R04: si la conexión se queda colgada, la petición se corta y se informa. El plazo cubre la respuesta completa
// (cabeceras y cuerpo); las escrituras sin confirmar siguen el flujo de "consultar la misma operación".
async function timedJson(url, options) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { const response = await fetch(url, { ...options, signal: controller.signal }); return { response, result: await response.json() }; }
  catch (error) { if (controller.signal.aborted) throw Object.assign(new Error('La conexión tardó demasiado. Revisa tu internet e inténtalo otra vez.'), { code: 'TIMEOUT' }); throw error; }
  finally { clearTimeout(timer); }
}
async function request(action, body = {}) {
  let response, result;
  if (portal) ({ response, result } = await timedJson(`${base}api/${action}`, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, session: credential?.session }) }));
  else {
    if (!window.shopify?.idToken) throw new Error('Abre Dayana Inventario desde Shopify.');
    ({ response, result } = await timedJson(`/api/staff/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${await window.shopify.idToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  }
  if (!response.ok) {
    if (portal && result.code === 'SESSION_REQUIRED') { clearSession(); hideViews(); showAccess('login'); }
    throw Object.assign(new Error(result.message || 'No pudimos completar esta acción.'), { code: result.code, status: response.status, result });
  }
  return result;
}
function message(text, error = false) { const element = (!$('#access-view').hidden && $('#access-message')) || $('#staff-message') || $('#access-message'); if (element) { element.textContent = text; element.classList.toggle('error', error); } }
function showAccess(screen, notice = '') {
  // R02: cierra confirmaciones y editores abiertos para que la pantalla de entrada quede usable con teclado.
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  // Al salir no queda en la página nada del panel (lista de personas, aparatos, mensajes).
  window.dsCelebraciones?.destroy(); $('#passkey-offer')?.remove(); $('#users-view')?.replaceChildren();
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
  const passkeyBlock = screen === 'login' && passkeysSupported() ? '<button type="button" class="primary" id="passkey-login">Entrar con Face ID o huella</button><p class="access-divider muted">o entra con tu usuario y contraseña</p>' : '';
  $('#access-view').innerHTML = `<div class="access-card"><p class="eyebrow">${screen === 'invitation' ? 'Invitación' : 'Panel de la pastelera'}</p><h1>${title}</h1><p class="muted">${description}</p>${passkeyBlock}<form id="access-form">${fields}<button class="primary" id="access-submit">${submit}</button></form>${links}<p id="access-message" role="status" aria-live="polite"></p></div>`;
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
        invitationToken = null; lastLogin = 'password'; saveSession(result); await showPanel();
      }
    } catch (error) { message(error.message, true); }
    finally { busy = false; if ($('#access-submit')) $('#access-submit').disabled = false; }
  };
  for (const button of $('#access-view').querySelectorAll('[data-screen]')) button.onclick = () => showAccess(button.dataset.screen);
  if ($('#passkey-login')) {
    prepareLoginOptions();
    $('#passkey-login').onclick = async () => {
      if (busy) return; busy = true; $('#passkey-login').disabled = true; message('');
      try { const result = await passkeyLogin(); lastLogin = 'passkey'; devicePreference('enrolled'); saveSession(result); await showPanel(); }
      catch (error) { message(passkeyError(error), true); prepareLoginOptions(); }
      finally { busy = false; if ($('#passkey-login')) $('#passkey-login').disabled = false; }
    };
  }
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
// starting/moved: si Dayana navega mientras el panel termina de cargar, no se le cambia la pantalla al terminar.
let starting = false, moved = false;
function hideViews() { if (starting) moved = true; for (const id of ['workspace', 'categories-view', 'history-view', 'users-view', 'celebraciones-view', 'pedidos-view', 'today-view']) { const view = $(`#${id}`); if (view) view.hidden = true; } }
// Portal: marca la sección abierta en la navegación y cierra los menús «Más» y «Cuenta».
// Solo usa APIs que existen también en los nodos simulados de las pruebas (setAttribute es opcional).
const setAttr = (element, name, value) => { if (typeof element?.setAttribute === 'function') element.setAttribute(name, value); };
function closeMenus() {
  for (const [menu, button] of [['#more-menu', '#more-nav'], ['#account-menu', '#account-button']]) { $(menu)?.classList.toggle('open', false); setAttr($(button), 'aria-expanded', 'false'); }
}
function markNav(id) {
  if (starting) moved = true;
  closeMenus();
  for (const button of document.querySelectorAll('nav[aria-label="Pantallas"] button')) { if (button.id === id) setAttr(button, 'aria-current', 'page'); else button.removeAttribute?.('aria-current'); }
  setAttr($('#more-nav'), 'data-current', String(['categories', 'history', 'users'].includes(id)));
}
function toggleMenu(menu, button) {
  const open = !$(menu)?.classList.contains('open'); closeMenus();
  $(menu)?.classList.toggle('open', open); setAttr($(button), 'aria-expanded', String(open));
  if (open) $(menu)?.querySelector?.('button')?.focus();
}
function showToday() { if (window.inventarioToday) window.inventarioToday.show({ keepFeedback: true }); }
async function showPanel() {
  $('#access-view').hidden = true; $('#access-view').replaceChildren(); $('#panel-view').hidden = false;
  const roles = currentUser.roles;
  const who = `${esc(currentUser.name)}${roles.includes('admin') ? ' · Administradora' : ''}`;
  const accountItems = `${passkeysSupported() ? '<button id="passkeys-button">Face ID / huella</button>' : ''}<button id="change-password">Cambiar contraseña</button><button id="sign-out">Salir</button>`;
  // Portal: en el iPhone la cuenta es un botón que abre un menú; en escritorio se ve en la cabecera.
  $('#staff-who').innerHTML = portal
    ? `<button id="account-button" type="button" aria-label="Cuenta" aria-expanded="false" aria-controls="account-menu"><span class="avatar" aria-hidden="true">${esc(currentUser.name.trim().charAt(0).toUpperCase() || '·')}</span></button><div id="account-menu" class="account-menu" role="group" aria-label="Tu cuenta"><p class="account-name">${who}</p>${accountItems}</div>`
    : `<span>${who}</span>${accountItems}`;
  if ($('#account-button')) $('#account-button').onclick = () => toggleMenu('#account-menu', '#account-button');
  if ($('#passkeys-button')) $('#passkeys-button').onclick = () => showPasskeys().catch(e => { $('#feedback').textContent = e.message; });
  void offerPasskey();
  $('#users').hidden = !roles.includes('admin'); $('#celebraciones').hidden = !roles.includes('celebraciones');
  if ($('#pedidos')) $('#pedidos').hidden = !(roles.includes('inventario') || roles.includes('admin'));
  for (const id of ['home', 'categories', 'history']) $(`#${id}`).hidden = !roles.includes('inventario');
  if ($('#hoy')) $('#hoy').hidden = !(roles.includes('inventario') || roles.includes('celebraciones'));
  if ($('#more-nav')) $('#more-nav').hidden = !roles.includes('inventario') && !roles.includes('admin');
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
  starting = true; moved = false;
  try { if (roles.includes('inventario')) await initializeInventory(); } finally { starting = false; }
  if (moved) return;
  if (roles.includes('inventario')) markNav('home');
  if (!roles.includes('inventario')) { hideViews(); $('#feedback').textContent = portal && $('#hoy') && !$('#hoy').hidden ? '' : 'Elige una sección para continuar.'; if (roles.includes('admin')) { await showUsers(); markNav('users'); } }
  // Portal: se abre en «Hoy», salvo que el enlace pida una sección (por ejemplo, desde un correo).
  if (location.hash.startsWith('#celebraciones') && roles.includes('celebraciones')) showCelebraciones();
  else if (location.hash.startsWith('#pedidos') && $('#pedidos') && !$('#pedidos').hidden) window.inventarioOrders?.show();
  else if (portal && $('#hoy') && !$('#hoy').hidden) showToday();
}
async function offerPasskey() {
  $('#passkey-offer')?.remove();
  if (lastLogin !== 'password' || devicePreference() || !await platformPasskeyAvailable() || $('#panel-view').hidden) return;
  const offer = document.createElement('div');
  offer.id = 'passkey-offer'; offer.className = 'notice passkey-offer'; offer.setAttribute('role', 'region'); offer.setAttribute('aria-label', 'Entrar con Face ID o huella');
  offer.innerHTML = '<p>¿Quieres entrar la próxima vez con Face ID o tu huella, sin escribir la contraseña?</p><div class="actions"><button class="primary" id="passkey-offer-yes">Activar</button><button id="passkey-offer-no">Ahora no</button></div>';
  $('#panel-view').prepend(offer);
  $('#passkey-offer-yes').onclick = () => showPasskeys().catch(e => { $('#feedback').textContent = e.message; });
  $('#passkey-offer-no').onclick = () => { devicePreference('dismissed'); offer.remove(); };
}
function renderPasskeys(list) {
  const container = $('#passkey-list'); if (!container) return;
  container.innerHTML = list.length ? `<h3>Aparatos activados</h3>${list.map(p => `<article class="card passkey-item"><div><strong>${esc(p.label)}</strong><p class="muted">Activado ${esc(new Date(p.createdAt).toLocaleDateString('es'))}${p.lastUsedAt ? ` · último uso ${esc(new Date(p.lastUsedAt).toLocaleString('es'))}` : ''}</p></div><button type="button" data-passkey="${esc(p.id)}">Quitar</button></article>`).join('')}` : '<p class="muted">Todavía no activaste ningún aparato.</p>';
  for (const button of container.querySelectorAll('[data-passkey]')) button.onclick = async () => {
    if (busy) return; busy = true; button.disabled = true;
    try { renderPasskeys((await request('passkey-remove', { credentialId: button.dataset.passkey })).passkeys); message('Aparato quitado: ya no entra con Face ID o huella. Puedes borrar también la llave en los ajustes de contraseñas del teléfono.'); }
    catch (e) { message(e.message, true); button.disabled = false; }
    finally { busy = false; }
  };
}
async function showPasskeys(notice = '') {
  hideViews(); $('#users-view').hidden = false; $('#passkey-offer')?.remove(); $('#feedback').textContent = '';
  const available = await platformPasskeyAvailable();
  const form = available ? `<form id="passkey-form">${field('Nombre de este aparato', 'label', 'text', `maxlength="60" autocomplete="off" value="${esc(deviceName())}"`)}${field('Tu contraseña', 'password', 'password', 'autocomplete="current-password" maxlength="256"')}<button class="primary" id="passkey-continue">Continuar</button></form>`
    : '<p class="notice">Este aparato no tiene Face ID, huella ni bloqueo de pantalla disponible para el panel. Puedes seguir entrando con tu contraseña.</p>';
  $('#users-view').innerHTML = `<div class="access-card passkey-card"><h2>Entrar con Face ID o huella</h2><p class="muted">Activa este aparato una sola vez. Después tocas «Entrar con Face ID o huella» y entras sin escribir la contraseña. Tu cara y tu huella no salen del teléfono.</p>${form}<p id="staff-message" role="status" aria-live="polite"></p><div id="passkey-list" class="passkey-list"></div></div>`;
  message(notice);
  renderPasskeys((await request('passkeys')).passkeys);
  if (!$('#passkey-form')) return;
  $('#passkey-form').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const step = event.currentTarget, data = Object.fromEntries(new FormData(step));
    busy = true; $('#passkey-continue').disabled = true; message('');
    let options;
    try { options = await request('passkey-register-options', { password: data.password }); }
    catch (e) { message(e.message, true); return; }
    finally { busy = false; if ($('#passkey-continue')) $('#passkey-continue').disabled = false; }
    // Segundo toque: el teléfono solo pide Face ID o huella justo después de un toque.
    step.innerHTML = '<p>Contraseña confirmada. Ahora toca «Activar» y usa Face ID o tu huella.</p><button type="button" class="primary" id="passkey-activate">Activar Face ID o huella</button><button type="button" id="passkey-cancel">Cancelar</button>';
    $('#passkey-activate').focus();
    $('#passkey-cancel').onclick = () => showPasskeys().catch(e => message(e.message, true));
    $('#passkey-activate').onclick = async () => {
      if (busy) return; busy = true; $('#passkey-activate').disabled = true; message('');
      try {
        const created = await navigator.credentials.create({ publicKey: { challenge: toBytes(options.challenge), rp: options.rp, user: { id: toBytes(options.user.id), name: options.user.name, displayName: options.user.displayName },
          pubKeyCredParams: options.pubKeyCredParams, timeout: options.timeout, attestation: 'none', authenticatorSelection: options.authenticatorSelection, excludeCredentials: options.excludeCredentials.map(item => ({ type: item.type, id: toBytes(item.id) })) } });
        await request('passkey-register', { label: data.label, credentialId: toBase64url(created.rawId), clientDataJSON: toBase64url(created.response.clientDataJSON), attestationObject: toBase64url(created.response.attestationObject) });
        devicePreference('enrolled'); busy = false;
        await showPasskeys('Listo. La próxima vez toca «Entrar con Face ID o huella».');
      } catch (error) {
        busy = false;
        if (error.code === 'PASSKEY_EXPIRED' || error.code === 'PASSKEY_INVALID') { await showPasskeys(error.message).catch(() => {}); message(error.message, true); return; }
        message(passkeyError(error), true); if ($('#passkey-activate')) $('#passkey-activate').disabled = false;
      }
    };
  };
}
const roleFields = roles => `<fieldset><legend>Permisos</legend>${[['admin','Administrador (maneja usuarios)'],['inventario','Inventario (productos, fotos, stock, categorías)'],['celebraciones','Celebraciones']].map(([role,label]) => `<label class="role-option"><input type="checkbox" name="roles" value="${role}" ${roles.includes(role) ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>`;
async function showUsers() {
  hideViews(); $('#users-view').hidden = false;
  const { users } = await request('users');
  const first = !users.some(u => u.status === 'active' && u.roles.includes('admin'));
  $('#feedback').textContent = '';
  $('#users-view').innerHTML = `<h2>${portal ? 'Usuarios' : 'Usuarios de /inventarios'}</h2>${portal ? '' : '<p class="notice">Llave maestra: aquí entras con tu cuenta de Shopify. Desde aquí se crea el primer usuario y se recupera el acceso si se pierden las contraseñas.</p><button id="connect-external">Conectar acceso externo</button>'}<form id="invite-form" class="card user-form"><h3>${first ? 'Invitar al primer administrador' : 'Invitar a alguien'}</h3>${field('Nombre', 'name', 'text', 'maxlength="100"')}${field('Usuario', 'username', 'text', 'pattern="[a-z0-9._\\-]{3,32}" minlength="3" maxlength="32" autocomplete="off"')}${field('Correo', 'email', 'email', 'maxlength="254"')}${roleFields(first ? ['admin', 'inventario'] : ['inventario'])}<button class="primary">Enviar invitación</button></form><p id="staff-message" role="status" aria-live="polite"></p><div class="user-list">${users.map(u => `<article class="card user-card"><div><h3>${esc(u.name)}</h3><p>${esc(u.email)} · usuario: ${esc(u.username)}</p></div><div class="actions">${u.status === 'invited' ? `<button data-user="${esc(u.id)}" data-action="resend-invitation">Reenviar</button><button data-user="${esc(u.id)}" data-action="cancel-invitation">Cancelar</button>` : `<button data-user="${esc(u.id)}" data-action="edit">Editar permisos</button><button data-user="${esc(u.id)}" data-action="${u.status === 'disabled' ? 'active' : 'disabled'}">${u.status === 'disabled' ? 'Reactivar' : 'Desactivar'}</button>`}</div><div class="chips"><span class="badge">${u.status === 'active' ? 'Activa' : u.status === 'disabled' ? 'Desactivado' : `Invitación pendiente${u.invitationExpiresAt ? ' · vence ' + new Date(u.invitationExpiresAt).toLocaleString('es') : ' · pendiente de envío'}`}</span>${u.roles.map(r => `<span class="badge">${esc(r)}</span>`).join('')}${u.passkeys ? `<span class="badge">Face ID / huella: ${u.passkeys}</span>` : ''}${u.lastLoginAt ? `<span class="muted">Entró ${esc(new Date(u.lastLoginAt).toLocaleString('es'))}</span>` : ''}</div></article>`).join('')}</div><p class="muted">Desactivar cierra sus sesiones abiertas. Siempre debe quedar al menos un administrador activo.</p>`;
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
  hideViews(); $('#celebraciones-view').hidden = false; $('#feedback').textContent = ''; markNav('celebraciones');
  // Celebraciones se dibuja en esta misma página (celebraciones.js): lista, detalle y ajustes por #hash.
  window.dsCelebraciones?.show(location.hash);
}
window.inventarioPortal = { mode: portal, request, hideViews, user: () => currentUser, current: markNav };
window.inventarioAccess = {
  async inventory(path, body) { const url = new URL(path, location.origin); return request(`inventory/${url.pathname.slice('/api/'.length)}`, { params: Object.fromEntries(url.searchParams), ...(body ? { body } : {}) }); },
  async boot(start) {
    initializeInventory = start;
    $('#users').onclick = () => showUsers().catch(e => { $('#feedback').textContent = e.message; });
    for (const id of ['home', 'categories', 'history']) $(`#${id}`).addEventListener('click', () => { $('#users-view').hidden = true; $('#celebraciones-view').hidden = true; if ($('#pedidos-view')) $('#pedidos-view').hidden = true; if ($('#today-view')) $('#today-view').hidden = true; });
    if (!portal) return start();
    $('#celebraciones').onclick = () => { location.hash = 'celebraciones'; showCelebraciones(); };
    // Navegación: botón activo, «Más» (Categorías, Historial, Usuarios) y menú de Cuenta.
    for (const id of ['home', 'categories', 'history', 'users']) $(`#${id}`).addEventListener('click', () => markNav(id));
    $('#more-nav').onclick = () => toggleMenu('#more-menu', '#more-nav');
    addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const opener = $('#account-menu.open') ? '#account-button' : $('#more-menu.open') ? '#more-nav' : null;
      if (opener) { closeMenus(); $(opener)?.focus(); }
    });
    document.addEventListener('click', event => {
      if (event.target.closest?.('#passkeys-button, #change-password')) markNav(null);
      else if (!event.target.closest?.('#more-menu, #more-nav, #account-menu, #account-button')) closeMenus();
    });
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
