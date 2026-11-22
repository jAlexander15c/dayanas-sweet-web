// Passkeys (WebAuthn) for the staff portal: Face ID, fingerprint or the device screen lock.
// Minimal, dependency-free verifier: attestation "none" (we trust the signed-in user, not the
// device maker), ES256 and RS256 keys, user verification always required. Nothing here logs or
// returns key material, challenges or identifiers.
import { base64url, unbase64 } from './staff-crypto.mjs';

export const PASSKEY_ALGORITHMS = [-7, -257];
const decoder = new TextDecoder('utf-8', { fatal: true });
const invalid = () => { throw Object.assign(new Error('PASSKEY_INVALID'), { code: 'PASSKEY_INVALID' }); };

export function fromBase64url(value, limit) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(limit * 4 / 3) + 4 || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
  try { return unbase64(value); } catch { return invalid(); }
}

// CBOR subset used by WebAuthn: integers, byte/text strings, arrays, maps, true/false/null.
// Indefinite lengths, tags and floats never appear in attestation objects or COSE keys.
export function decodeCbor(input, start = 0) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let offset = start;
  function length(info) {
    if (info < 24) return info;
    const size = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    if (!size || offset + size > bytes.length) invalid();
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + bytes[offset++];
    if (!Number.isSafeInteger(value)) invalid();
    return value;
  }
  function item(depth) {
    if (depth > 8 || offset >= bytes.length) invalid();
    const head = bytes[offset++], major = head >> 5, info = head & 31;
    if (major === 7) return info === 20 ? false : info === 21 ? true : info === 22 ? null : invalid();
    if (info === 31 || major === 6) invalid();
    const n = length(info);
    if (major === 0) return n;
    if (major === 1) return -1 - n;
    if (major === 2 || major === 3) {
      if (offset + n > bytes.length) invalid();
      const chunk = bytes.slice(offset, offset += n);
      if (major === 2) return chunk;
      try { return decoder.decode(chunk); } catch { return invalid(); }
    }
    if (n > 64) invalid();
    if (major === 4) return Array.from({ length: n }, () => item(depth + 1));
    const map = new Map();
    for (let i = 0; i < n; i++) { const key = item(depth + 1); if (map.has(key)) invalid(); map.set(key, item(depth + 1)); }
    return map;
  }
  const value = item(0);
  return { value, end: offset };
}

export function parseAuthenticatorData(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 37) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), flags = bytes[32];
  const result = { rpIdHash: bytes.slice(0, 32), flags, userPresent: !!(flags & 0x01), userVerified: !!(flags & 0x04), signCount: view.getUint32(33) };
  if (flags & 0x40) {
    if (bytes.length < 55) invalid();
    const size = view.getUint16(53);
    if (size < 16 || size > 1023 || 55 + size > bytes.length) invalid();
    result.credentialId = bytes.slice(55, 55 + size);
    const { value, end } = decodeCbor(bytes, 55 + size);
    if (!(value instanceof Map)) invalid();
    result.publicKey = value;
    // Extension data (ED flag) may follow the key; anything else is malformed.
    if (end !== bytes.length && !(flags & 0x80)) invalid();
  }
  return result;
}

// COSE public key -> JWK that WebCrypto can import. Only P-256/ES256 and RSA >= 2048/RS256.
export function coseToJwk(key) {
  const kty = key.get(1), alg = key.get(3);
  const bytes = label => { const value = key.get(label); if (!(value instanceof Uint8Array)) invalid(); return value; };
  if (alg === -7 && kty === 2 && key.get(-1) === 1) {
    const x = bytes(-2), y = bytes(-3);
    if (x.length !== 32 || y.length !== 32) invalid();
    return { alg, jwk: { kty: 'EC', crv: 'P-256', x: base64url(x), y: base64url(y) } };
  }
  if (alg === -257 && kty === 3) {
    const n = bytes(-1), e = bytes(-2);
    if (n.length < 256 || n.length > 512 || e.length < 1 || e.length > 8) invalid();
    return { alg, jwk: { kty: 'RSA', n: base64url(n), e: base64url(e) } };
  }
  return invalid();
}

const importParams = alg => alg === -7 ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
export async function importPasskey(jwk, alg) {
  if (!PASSKEY_ALGORITHMS.includes(alg)) invalid();
  try { return await crypto.subtle.importKey('jwk', jwk, importParams(alg), false, ['verify']); }
  catch { return invalid(); }
}

// Authenticators sign ES256 as ASN.1 DER; WebCrypto expects the raw 64-byte r||s form.
export function derToRaw(signature) {
  const s = signature;
  if (s.length < 8 || s[0] !== 0x30 || s[1] !== s.length - 2 || s[2] !== 0x02) invalid();
  const rLength = s[3], sStart = 4 + rLength;
  if (rLength < 1 || rLength > 33 || s[sStart] !== 0x02) invalid();
  const sLength = s[sStart + 1];
  if (sLength < 1 || sLength > 33 || sStart + 2 + sLength !== s.length) invalid();
  const out = new Uint8Array(64);
  const place = (from, size, at) => {
    let bytes = s.slice(from, from + size);
    while (bytes.length > 32 && bytes[0] === 0) bytes = bytes.slice(1);
    if (bytes.length > 32) invalid();
    out.set(bytes, at + 32 - bytes.length);
  };
  place(4, rLength, 0); place(sStart + 2, sLength, 32);
  return out;
}

export async function sha256Bytes(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
export const sameBytes = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

export function readClientData(bytes, type, origin) {
  let data;
  try { data = JSON.parse(decoder.decode(bytes)); } catch { return invalid(); }
  if (!data || data.type !== type || data.origin !== origin || data.crossOrigin === true || typeof data.challenge !== 'string') invalid();
  return data;
}

export async function verifySignature({ jwk, alg }, authenticatorData, clientDataJSON, signature) {
  const key = await importPasskey(jwk, alg);
  const signed = new Uint8Array(authenticatorData.length + 32);
  signed.set(authenticatorData); signed.set(await sha256Bytes(clientDataJSON), authenticatorData.length);
  const params = alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' };
  const raw = alg === -7 ? derToRaw(signature) : signature;
  return crypto.subtle.verify(params, key, raw, signed);
}
