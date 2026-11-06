import { fail, requireValue } from './errors.mjs';
const encode = value => new TextEncoder().encode(value);
export const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
export const unbase64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async value => base64url(await crypto.subtle.digest('SHA-256', encode(value)));
export async function mac(value, secret) {
  if (!secret || secret.length < 32) throw fail(503, 'IDENTITY_CONFIG', 'Falta configurar el acceso externo.');
  const key = await crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(await crypto.subtle.sign('HMAC', key, encode(value)));
}
export function same(a, b) {
  const aa = encode(a), bb = encode(b); let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}
const common = new Set(['1234567890', '12345678901', '123456789012', 'password123', 'password1234', 'contraseña', 'contraseña123', 'qwerty12345', 'qwertyuiop', 'abcdefghij', 'admin12345', 'dayanassweet', 'iloveyou123']);
export function validatePassword(password, username) {
  requireValue(typeof password === 'string' && password.length >= 10 && password.length <= 256 && password.toLowerCase() !== username.toLowerCase() && !common.has(password.toLowerCase()), 'Usa al menos 10 caracteres, una contraseña poco común y distinta de tu usuario.');
}
export async function hashPassword(password, salt = base64url(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey('raw', encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unbase64(salt), iterations: 100000 }, key, 256);
  return `pbkdf2-sha256$100000$${salt}$${base64url(hash)}`;
}
export async function verifyPassword(password, stored) {
  // Same work for missing/disabled/invited users; fixed dummy is never an account.
  const target = stored || 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const [, iterations, salt] = target.split('$');
  if (iterations !== '100000' || !salt) return false;
  return same(await hashPassword(password, salt), target);
}
async function encryptionKey(secret) {
  try { const bytes = unbase64(secret); if (bytes.length !== 32) throw Error(); return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); }
  catch { throw fail(503, 'TOKEN_CONFIG', 'Falta configurar la clave del acceso externo.'); }
}
export async function encryptToken(data, secret, shop) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encode(shop) }, await encryptionKey(secret), encode(JSON.stringify(data)));
  return `${base64url(iv)}.${base64url(encrypted)}`;
}
export async function decryptToken(data, secret, shop) {
  try { const [iv, value] = data.split('.'); return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(iv), additionalData: encode(shop) }, await encryptionKey(secret), unbase64(value)))); }
  catch { throw fail(503, 'RECONNECT_REQUIRED', 'Conecta el acceso externo desde Shopify.'); }
}
