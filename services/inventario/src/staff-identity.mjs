import { fail, requireValue } from './errors.mjs';
import { randomToken, sha256, mac, same, hashPassword, verifyPassword, validatePassword, base64url, unbase64 } from './staff-crypto.mjs';
import { PASSKEY_ALGORITHMS, coseToJwk, decodeCbor, fromBase64url, importPasskey, parseAuthenticatorData, readClientData, sameBytes, sha256Bytes, verifySignature } from './webauthn.mjs';
const HOUR = 3600000, GENERIC = 'Usuario o contraseña incorrectos. Si el acceso está pausado, espera 15 minutos e inténtalo otra vez.';
export const recoveryMessage = 'Si los datos están registrados, recibirás un código de 6 números. Revisa tu correo e inténtalo de nuevo si no llega.';
const allowedRoles = ['admin', 'inventario', 'celebraciones'];
const PASSKEY_TTL = 5 * 60000, PASSKEY_FAILED = 'No pudimos entrar con Face ID o huella. Entra con tu usuario y contraseña.';
const utf8 = value => new TextEncoder().encode(value);
const passkeyLabel = value => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : '') || 'Este aparato';
export const publicUser = u => ({ id: u.id, username: u.username, name: u.name, email: u.email, roles: JSON.parse(u.roles), status: u.status, lastLoginAt: u.last_login_at, sessionVersion: u.session_version });
export const requireRole = (actor, role) => { if (!actor.roles.includes(role)) throw fail(403, 'ROLE_REQUIRED', 'Tu cuenta no tiene permiso para esta acción.'); };
export function createStaffIdentity({ env, store, sendEmail, waitUntil = task => { void task.catch(() => {}); }, now = Date.now }) {
  // Identity has its own shop DO. Only credential state transitions enter this queue, never email I/O.
  let tail = Promise.resolve();
  const run = fn => { const result = tail.then(fn); tail = result.catch(() => {}); return result; };
  const users = () => store.all('users');
  const lookup = identifier => users().find(u => u.username === identifier || u.email === identifier);
  const identifier = value => typeof value === 'string' ? value.trim().toLowerCase().slice(0, 254) : '';
  function purge() {
    for (const table of ['sessions', 'invitations']) for (const row of store.all(table)) if (row.expires_at <= now() || row.used_at) store.remove(table, row.hash);
    for (const row of store.all('recovery_codes')) if (row.created_at <= now() - 24 * HOUR) store.remove('recovery_codes', row.hash);
    for (const row of store.all('login_attempts')) if (row.window_at < now() - HOUR && row.locked_until <= now()) store.remove('login_attempts', row.hash);
    for (const row of store.all('passkey_challenges')) if (row.expires_at <= now()) store.remove('passkey_challenges', row.hash);
  }
  function attempt(hash) {
    let row = store.get('login_attempts', hash);
    if (!row || (row.locked_until && row.locked_until <= now()) || (!row.locked_until && row.window_at + 15 * 60000 <= now())) row = { hash, failures: 0, window_at: now(), locked_until: 0 };
    return row;
  }
  function failedAttempt(row, limit = 5) {
    if (row.locked_until <= now()) {
      row.failures++;
      if (row.failures >= limit) row.locked_until = now() + 15 * 60000;
      store.put('login_attempts', row);
    }
  }
  function invalidate(user) {
    user.session_version++; store.put('users', user);
    for (const row of store.all('sessions')) if (row.user_id === user.id) store.remove('sessions', row.hash);
  }
  function revokeCredentials(userId) {
    for (const table of ['invitations', 'recovery_codes']) for (const row of store.all(table)) if (row.user_id === userId && !row.used_at) { row.used_at = now(); store.put(table, row); }
  }
  async function newSession(user) {
    const session = randomToken(), expiresAt = now() + 12 * HOUR;
    store.put('sessions', { hash: await sha256(session), user_id: user.id, version: user.session_version, created_at: now(), last_used_at: now(), expires_at: expiresAt });
    user.last_login_at = now(); store.put('users', user);
    return { session, expiresAt, user: publicUser(user) };
  }
  async function authenticate(session) {
    if (typeof session !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(session)) throw fail(401, 'SESSION_REQUIRED', 'Entra otra vez para continuar.');
    const hash = await sha256(session), row = store.get('sessions', hash), user = row && store.get('users', row.user_id);
    if (!row || !user || user.status !== 'active' || row.version !== user.session_version || row.expires_at <= now() || row.last_used_at + 2 * HOUR <= now()) {
      if (row) store.remove('sessions', hash);
      throw fail(401, 'SESSION_REQUIRED', 'Entra otra vez para continuar.');
    }
    row.last_used_at = now(); store.put('sessions', row);
    return { userId: user.id, name: user.name, roles: JSON.parse(user.roles), shop: env.SHOPIFY_SHOP, sessionVersion: user.session_version };
  }
  function admin(actor) { if (!actor.master) requireRole(actor, 'admin'); }
  // Re-check the password of a signed-in person: same hash, same `login:user:<id>` counter and
  // 15-minute lock as login; 5 misses also end the sessions. The password is never stored or returned.
  async function confirmPassword(user, password) {
    if (typeof password !== 'string' || !password) throw fail(401, 'PASSWORD_REQUIRED', 'Escribe tu contraseña para confirmar.');
    const key = await sha256(`login:user:${user.id}`), local = attempt(key);
    const denied = () => fail(401, 'PASSWORD_INVALID', 'Contraseña incorrecta. Si el acceso está pausado, espera 15 minutos e inténtalo otra vez.');
    if (local.locked_until > now()) throw denied();
    if (password.length > 256 || !await verifyPassword(password, user.password_hash)) {
      store.transaction(() => { failedAttempt(local); if (local.failures >= 5) invalidate(user); });
      throw denied();
    }
    store.remove('login_attempts', key);
  }
  // Passkeys: the page origin and the relying party come only from PORTAL_PUBLIC_URL.
  function passkeyParty() {
    let url; try { url = new URL(env.PORTAL_PUBLIC_URL); } catch { url = null; }
    // http only for localhost (local browser checks); production is always https://dayanassweet.com.
    if (url?.protocol !== 'https:' && !(url?.protocol === 'http:' && url.hostname === 'localhost')) throw fail(503, 'IDENTITY_CONFIG', 'Falta configurar el acceso externo.');
    return { origin: url.origin, rpId: url.hostname };
  }
  // Signed, stateless challenge: a flood of option requests stores nothing. Only a challenge that
  // completed a login or an activation is recorded (until it expires), so it can never be replayed.
  async function issueChallenge(purpose, owner = '-') {
    const payload = `${purpose}.${owner}.${now() + PASSKEY_TTL}.${randomToken()}`;
    return base64url(utf8(`${payload}.${await mac(`passkey:${payload}`, env.INVENTARIO_CODE_KEY)}`));
  }
  async function readChallenge(challenge, purpose, owner = '-') {
    let parts = [];
    try { if (typeof challenge === 'string' && challenge.length <= 400) parts = new TextDecoder('utf-8', { fatal: true }).decode(unbase64(challenge)).split('.'); } catch { parts = []; }
    const [kind, who, expires, nonce, signature] = parts, expiresAt = Number(expires);
    if (parts.length !== 5 || kind !== purpose || who !== owner || !Number.isSafeInteger(expiresAt) || expiresAt <= now() || expiresAt > now() + PASSKEY_TTL) return null;
    if (!same(signature, await mac(`passkey:${kind}.${who}.${expires}.${nonce}`, env.INVENTARIO_CODE_KEY))) return null;
    const hash = await sha256(challenge);
    return store.get('passkey_challenges', hash) ? null : { hash, expires_at: expiresAt };
  }
  const passkeysOf = userId => store.all('passkeys').filter(row => row.user_id === userId).sort((a, b) => a.created_at - b.created_at);
  const publicPasskeys = userId => passkeysOf(userId).map(row => ({ id: row.id, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at }));
  function removePasskeys(userId) { for (const row of passkeysOf(userId)) store.remove('passkeys', row.id); }
  async function passkeyLogin(data) {
    const party = passkeyParty(), denied = () => fail(401, 'PASSKEY_FAILED', PASSKEY_FAILED);
    let clientDataJSON, authenticatorData, signature, client, auth;
    try {
      clientDataJSON = fromBase64url(data.clientDataJSON, 4096); authenticatorData = fromBase64url(data.authenticatorData, 1024);
      signature = fromBase64url(data.signature, 1024); client = readClientData(clientDataJSON, 'webauthn.get', party.origin);
      auth = parseAuthenticatorData(authenticatorData);
    } catch { throw denied(); }
    const row = typeof data.credentialId === 'string' && data.credentialId.length <= 1400 ? store.get('passkeys', data.credentialId) : null;
    const user = row && store.get('users', row.user_id), challenge = await readChallenge(client.challenge, 'login');
    if (!row || user?.status !== 'active' || !challenge) throw denied();
    if (data.userHandle != null && data.userHandle !== base64url(utf8(user.id))) throw denied();
    if (!sameBytes(auth.rpIdHash, await sha256Bytes(utf8(party.rpId))) || !auth.userPresent || !auth.userVerified) throw denied();
    let valid = false;
    try { valid = await verifySignature({ jwk: JSON.parse(row.public_key), alg: row.alg }, authenticatorData, clientDataJSON, signature); } catch { valid = false; }
    if (!valid) throw denied();
    // A counter that does not increase means a copied authenticator; synced passkeys always report 0.
    if ((auth.signCount !== 0 || row.sign_count !== 0) && auth.signCount <= row.sign_count) throw denied();
    store.transaction(() => { store.put('passkey_challenges', challenge); row.sign_count = auth.signCount; row.last_used_at = now(); store.put('passkeys', row); });
    return newSession(user);
  }
  // The registration challenge is only issued after the password was confirmed (passkey-register-options),
  // so a stolen session alone cannot add a device, and a wrong password never leaves an orphan passkey on the phone.
  async function passkeyRegister(user, data) {
    const party = passkeyParty();
    const rejected = () => fail(400, 'PASSKEY_INVALID', 'No pudimos activar Face ID o huella en este aparato. Inténtalo otra vez.');
    let clientDataJSON, attestation, client;
    try {
      clientDataJSON = fromBase64url(data.clientDataJSON, 4096); attestation = fromBase64url(data.attestationObject, 16384);
      client = readClientData(clientDataJSON, 'webauthn.create', party.origin);
    } catch { throw rejected(); }
    const challenge = await readChallenge(client.challenge, 'register', user.id);
    if (!challenge) throw fail(400, 'PASSKEY_EXPIRED', 'La activación tardó demasiado. Inténtalo otra vez.');
    let auth, key;
    try {
      const { value } = decodeCbor(attestation);
      if (!(value instanceof Map) || typeof value.get('fmt') !== 'string' || !(value.get('authData') instanceof Uint8Array)) throw Error();
      auth = parseAuthenticatorData(value.get('authData'));
      if (!auth.credentialId) throw Error();
      key = coseToJwk(auth.publicKey); await importPasskey(key.jwk, key.alg);
    } catch { throw rejected(); }
    if (!sameBytes(auth.rpIdHash, await sha256Bytes(utf8(party.rpId))) || !auth.userPresent || !auth.userVerified) throw rejected();
    const id = base64url(auth.credentialId);
    if (data.credentialId !== undefined && data.credentialId !== id) throw rejected();
    if (store.get('passkeys', id)) throw fail(409, 'PASSKEY_EXISTS', 'Este aparato ya tiene Face ID o huella activado.');
    requireValue(passkeysOf(user.id).length < 10, 'Ya tienes 10 aparatos activados. Quita uno antes de agregar otro.');
    store.transaction(() => {
      store.put('passkey_challenges', challenge);
      store.put('passkeys', { id, user_id: user.id, public_key: JSON.stringify(key.jwk), alg: key.alg, sign_count: auth.signCount, label: passkeyLabel(data.label), created_at: now(), last_used_at: null });
    });
    return { passkeys: publicPasskeys(user.id) };
  }
  function roles(value) { requireValue(Array.isArray(value) && value.length > 0 && value.length <= 3 && value.every(r => allowedRoles.includes(r))); return JSON.stringify([...new Set(value)].sort()); }
  async function invitation(user) {
    requireValue(user.status !== 'disabled' || user.password_hash, 'Esta invitación fue cancelada. Reactiva a la persona y después reenvía la invitación.');
    requireValue(user.status === 'invited', 'Esta persona ya tiene una contraseña. Usa la recuperación por correo.');
    const token = randomToken(), hash = await sha256(token), expiresAt = now() + 48 * HOUR;
    const url = new URL(env.PORTAL_PUBLIC_URL);
    requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash);
    url.hash = `invitacion=${token}`;
    // Keep the previous invitation if delivery fails; revoke it only once the new mail was accepted.
    return { complete: async () => {
      await sendEmail({ to: user.email, subject: 'Tu acceso a Dayana’s Sweet', text: `Hola, ${user.name}.\nTu usuario es ${user.username}. Crea tu contraseña aquí:\n${url.href}\nEl enlace sirve una sola vez y vence en 48 horas.` });
      return run(() => {
        const current = store.get('users', user.id);
        requireValue(current?.status === 'invited' && !current.password_hash && current.session_version === user.session_version, 'La invitación cambió durante el envío. Revisa el estado de la persona.');
        store.transaction(() => { revokeCredentials(user.id); store.put('invitations', { hash, user_id: user.id, expires_at: expiresAt, used_at: null }); });
        return { sent: true, expiresAt };
      });
    } };
  }
  async function invitationUser(token) {
    const row = typeof token === 'string' && token.length <= 100 ? store.get('invitations', await sha256(token)) : null;
    const user = row && store.get('users', row.user_id);
    if (!row || row.used_at || row.expires_at <= now() || user?.status !== 'invited') throw fail(400, 'INVITATION_INVALID', 'La invitación venció o ya fue usada. Pide una nueva a la administradora.');
    return { row, user };
  }
  async function prepareRecovery(data) {
    purge();
    const user = lookup(identifier(data.identifier));
    if (user?.status !== 'active') return;
    const sent = store.all('recovery_codes').filter(r => r.user_id === user.id && r.created_at > now() - 24 * HOUR);
    // Preserve both existing codes until expiry/use; a third request cannot evict the victim's code.
    if (sent.length >= 6 || sent.filter(r => r.created_at > now() - HOUR).length >= 3 || sent.filter(r => !r.used_at && r.expires_at > now()).length >= 2) return;
    let code, hash;
    do {
      let value; do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4294000000);
      code = String(value % 1000000).padStart(6, '0'); hash = await mac(`${user.id}:${code}`, env.INVENTARIO_CODE_KEY);
    } while (store.get('recovery_codes', hash));
    const row = { hash, user_id: user.id, created_at: now(), expires_at: now() + 10 * 60000, attempts: 0, used_at: null };
    // Reservations and provider failures count against both rolling limits, across restarts.
    store.put('recovery_codes', row);
    return async () => {
      try { await sendEmail({ to: user.email, subject: 'Código para recuperar tu acceso', text: `Tu código es ${code}. Vence en 10 minutos y permite 5 intentos. Si no lo pediste, ignora este correo.` }); }
      catch { await run(() => { const current = store.get('recovery_codes', hash); if (current && !current.used_at) { current.used_at = now(); store.put('recovery_codes', current); } }); }
    };
  }
  const handleQueued = (action, data, master) => run(async () => {
      purge();
      if (action === 'login') {
        const name = identifier(data.username), user = lookup(name);
        const key = await sha256(user ? `login:user:${user.id}` : `login:unknown:${name}`), globalKey = await sha256('login:global');
        const local = attempt(key), global = attempt(globalKey);
        // Global pressure only gates identifiers without an active account; local locks always apply.
        if (local.locked_until > now() || (user?.status !== 'active' && global.locked_until > now())) throw fail(401, 'LOGIN_FAILED', GENERIC);
        const verified = await verifyPassword(typeof data.password === 'string' ? data.password.slice(0, 256) : '', user?.password_hash);
        const valid = verified && typeof data.password === 'string' && data.password.length <= 256;
        if (!valid || user?.status !== 'active') {
          failedAttempt(local); failedAttempt(global, 50);
          throw fail(401, 'LOGIN_FAILED', GENERIC);
        }
        store.remove('login_attempts', key);
        return newSession(user);
      }
      if (action === 'passkey-options') { const party = passkeyParty(); return { challenge: await issueChallenge('login'), rpId: party.rpId, timeout: 120000, userVerification: 'required' }; }
      if (action === 'passkey-login') return passkeyLogin(data);
      if (action === 'invitation-info') { const { user } = await invitationUser(data.token); return { name: user.name, username: user.username }; }
      if (action === 'accept-invitation') {
        const { row, user } = await invitationUser(data.token); validatePassword(data.password, user.username);
        user.password_hash = await hashPassword(data.password); user.status = 'active'; user.password_changed_at = now();
        store.transaction(() => { row.used_at = now(); store.put('invitations', row); invalidate(user); revokeCredentials(user.id); });
        return newSession(user);
      }
      if (action === 'reset-password') {
        const user = lookup(identifier(data.identifier));
        const resetKey = await sha256(user ? `reset:user:${user.id}` : `reset:unknown:${identifier(data.identifier)}`), local = attempt(resetKey);
        const invalid = () => fail(400, 'CODE_INVALID', 'El código no es válido o venció. Solicita otro.');
        if (local.locked_until > now()) throw invalid();
        const live = user?.status === 'active' ? store.all('recovery_codes').filter(r => r.user_id === user.id && !r.used_at && r.expires_at > now() && r.attempts < 5) : [];
        const hash = await mac(`${user?.id || 'missing'}:${typeof data.code === 'string' ? data.code.slice(0, 20) : ''}`, env.INVENTARIO_CODE_KEY);
        const row = live.find(r => same(r.hash, hash));
        if (!/^\d{6}$/.test(data.code || '') || !row) {
          failedAttempt(local);
          for (const code of live) { code.attempts++; store.put('recovery_codes', code); }
          throw invalid();
        }
        validatePassword(data.password, user.username); user.password_hash = await hashPassword(data.password); user.password_changed_at = now();
        store.transaction(() => { invalidate(user); revokeCredentials(user.id); removePasskeys(user.id); });
        store.remove('login_attempts', await sha256(`login:user:${user.id}`));
        store.remove('login_attempts', resetKey);
        return newSession(user);
      }
      const actor = master || await authenticate(data.session);
      if (action === 'session') return { user: publicUser(store.get('users', actor.userId)) };
      if (action === 'logout') { store.remove('sessions', await sha256(data.session)); return { signedOut: true }; }
      if (!actor.master && action === 'passkeys') return { passkeys: publicPasskeys(actor.userId) };
      if (!actor.master && action === 'passkey-register-options') {
        const user = store.get('users', actor.userId), party = passkeyParty();
        await confirmPassword(user, data.password);
        return { challenge: await issueChallenge('register', user.id), rp: { id: party.rpId, name: 'Dayana’s Sweet' }, user: { id: base64url(utf8(user.id)), name: user.username, displayName: user.name },
          pubKeyCredParams: PASSKEY_ALGORITHMS.map(alg => ({ type: 'public-key', alg })), timeout: 120000, attestation: 'none',
          authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
          excludeCredentials: passkeysOf(user.id).map(row => ({ type: 'public-key', id: row.id })) };
      }
      if (!actor.master && action === 'passkey-register') return passkeyRegister(store.get('users', actor.userId), data);
      if (!actor.master && action === 'passkey-remove') {
        const row = typeof data.credentialId === 'string' ? store.get('passkeys', data.credentialId) : null;
        requireValue(row?.user_id === actor.userId, 'No encontramos ese aparato.');
        store.remove('passkeys', row.id); return { passkeys: publicPasskeys(actor.userId) };
      }
      if (action === 'change-password') {
        const user = store.get('users', actor.userId);
        const key = await sha256(`login:user:${user.id}`), local = attempt(key);
        if (local.locked_until > now()) throw fail(401, 'LOGIN_FAILED', GENERIC);
        if (!await verifyPassword(typeof data.currentPassword === 'string' ? data.currentPassword.slice(0, 256) : '', user.password_hash) || typeof data.currentPassword !== 'string' || data.currentPassword.length > 256) {
          store.transaction(() => { failedAttempt(local); if (local.failures >= 5) invalidate(user); });
          throw fail(401, 'LOGIN_FAILED', GENERIC);
        }
        validatePassword(data.password, user.username); user.password_hash = await hashPassword(data.password); user.password_changed_at = now();
        store.transaction(() => { invalidate(user); revokeCredentials(user.id); });
        store.remove('login_attempts', key);
        return { changed: true };
      }
      admin(actor);
      if (action === 'users') return { users: users().map(u => ({ ...publicUser(u), passkeys: passkeysOf(u.id).length, invitationExpiresAt: store.all('invitations').find(i => i.user_id === u.id && !i.used_at)?.expires_at || null })) };
      if (action === 'invite') {
        const username = identifier(data.username), email = identifier(data.email), name = typeof data.name === 'string' ? data.name.trim() : '';
        requireValue(/^[a-z0-9._-]{3,32}$/.test(username) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && name.length > 0 && name.length <= 100, 'Revisa nombre, usuario y correo.');
        requireValue(!users().some(u => u.username === username || u.email === email), 'El usuario o correo ya está registrado.');
        const userRoles = roles(data.roles);
        if (!users().some(u => u.status === 'active' && JSON.parse(u.roles).includes('admin'))) requireValue(actor.master && JSON.parse(userRoles).includes('admin'), 'El primer usuario debe ser administrador e invitarse desde Shopify.');
        const user = { id: crypto.randomUUID(), username, email, name, password_hash: null, roles: userRoles, status: 'invited', session_version: 1, created_at: now(), created_by: actor.master ? `shopify:${actor.staffId}` : `user:${actor.userId}`, last_login_at: null, password_changed_at: null };
        store.put('users', user);
        const pending = await invitation(user);
        return { complete: async () => ({ user: publicUser(user), ...await pending.complete() }) };
      }
      const user = store.get('users', data.userId); requireValue(user, 'No encontramos a esta persona.');
      if (action === 'resend-invitation') return invitation(user);
      if (action === 'update-user' || action === 'cancel-invitation') {
        const nextRoles = data.roles === undefined ? user.roles : roles(data.roles);
        let status = action === 'cancel-invitation' ? 'disabled' : (data.status ?? user.status);
        requireValue(['active', 'disabled', 'invited'].includes(status));
        if (status === 'active' && !user.password_hash) status = 'invited';
        requireValue(status !== 'invited' || !user.password_hash, 'Este usuario ya tiene contraseña.');
        const wasAdmin = user.status === 'active' && JSON.parse(user.roles).includes('admin');
        if (wasAdmin && (status !== 'active' || !JSON.parse(nextRoles).includes('admin'))) requireValue(users().some(u => u.id !== user.id && u.status === 'active' && JSON.parse(u.roles).includes('admin')), 'Siempre debe quedar al menos un administrador activo.');
        const removedRole = JSON.parse(user.roles).some(r => !JSON.parse(nextRoles).includes(r));
        store.transaction(() => { user.roles = nextRoles; user.status = status; if (removedRole || status === 'disabled') { invalidate(user); revokeCredentials(user.id); } else store.put('users', user); if (status === 'disabled') removePasskeys(user.id); });
        return { user: publicUser(user) };
      }
      throw fail(404, 'NOT_FOUND', 'Esta acción no existe.');
    });
  // Money actions in Pedidos: re-check the admin password for this one request (confirmPassword).
  const stepUp = (session, password) => run(async () => {
    purge();
    const actor = await authenticate(session);
    requireRole(actor, 'admin');
    await confirmPassword(store.get('users', actor.userId), password);
    return { ...actor, stepUp: true };
  });
  return {
    authenticate: session => authenticate(session),
    stepUp,
    async handle(action, data = {}, master = null) {
      if (action === 'recover') {
        // Same response path and HMAC work for every identifier, independent of queue/provider latency.
        await mac('configuration-check', env.INVENTARIO_CODE_KEY);
        waitUntil(run(() => prepareRecovery(data)).then(deliver => deliver?.()).catch(() => {}));
        return { message: recoveryMessage };
      }
      const result = await handleQueued(action, data, master);
      return result.complete ? result.complete() : result;
    },
  };
}
