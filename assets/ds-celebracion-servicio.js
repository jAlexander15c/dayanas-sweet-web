(function (global) {
  'use strict';
  const fail = code => Object.assign(new Error(code), { code });
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
  const validCapability = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  function captureAccess(location, history, storage) {
    const url = new URL(location.href), id = url.searchParams.get('solicitud');
    const fragment = new URLSearchParams(url.hash.slice(1));
    const supplied = fragment.has('acceso');
    const token = fragment.get('acceso');
    // Clear the visible URL before mounting or starting any tracking request.
    if (supplied) history.replaceState(null, '', url.pathname + url.search);
    let capability = null;
    if (validId(id)) {
      if (supplied) {
        if (validCapability(token)) { capability = token; try { storage?.setItem(`ds-guest-access:${id}`, token); } catch (_) { /* Keep access in memory. */ } }
      } else { try { const saved = storage?.getItem(`ds-guest-access:${id}`); if (validCapability(saved)) capability = saved; } catch (_) { /* Private storage can be unavailable. */ } }
    }
    return { id, capability, invalid: supplied && !validCapability(token) };
  }
  function createHttpService(basePath, capability = null) {
    if (!/^\/apps\/[a-z0-9-]+$/.test(basePath) || (capability !== null && !validCapability(capability))) throw fail('VALIDATION');
    const guest = capability !== null;
    async function call(id, action, payload, photo = false) {
      if (!validId(id)) throw fail('VALIDATION');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      const body = guest ? { ...payload, capability } : payload;
      try {
        const response = await global.fetch(`${basePath}${guest ? '/guest' : ''}/requests/${encodeURIComponent(id)}${action}`, {
          method: body ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { Accept: photo ? 'image/jpeg, image/png, image/webp' : 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {})
        });
        if (photo && response.ok) {
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(response.headers.get('content-type')?.split(';')[0])) throw fail('UNAVAILABLE');
          const blob = await response.blob();
          if (blob.size > 2097152) throw fail('UNAVAILABLE');
          return blob;
        }
        if (!response.headers.get('content-type')?.includes('application/json')) throw fail('UNAVAILABLE');
        const result = await response.json();
        if (!response.ok) throw fail(['AUTH_REQUIRED', 'NOT_FOUND', 'CONFLICT', 'QUOTE_EXPIRED', 'CHECKOUT_PENDING', 'VALIDATION', 'UNAVAILABLE'].includes(result?.code) ? result.code : 'UNAVAILABLE');
        return result;
      } catch (e) { throw e?.code ? e : fail('UNAVAILABLE'); }
      finally { clearTimeout(timer); }
    }
    return {
      guest,
      privateLink: guest ? id => {
        if (!validId(id)) throw fail('VALIDATION');
        const url = new URL(global.location.href); url.search = ''; url.searchParams.set('solicitud', id); url.hash = `acceso=${capability}`; return url.href;
      } : null,
      getTracking: id => call(id, guest ? '/tracking' : ''),
      getPhoto: (id, photoId) => { if (!validId(photoId)) return Promise.reject(fail('VALIDATION')); return call(id, `/photos/${encodeURIComponent(photoId)}`, undefined, true); },
      postComment: (id, text, operationId) => call(id, '/comments', { text, operationId }),
      acceptProposal: (id, proposalVersion, operationId) => call(id, '/accept', { proposalVersion, operationId }),
      startPayment: (id, operationId) => call(id, '/payment', { operationId }),
      syncPayment: (id, operationId) => call(id, '/payment-sync', { operationId })
    };
  }
  let access;
  if (global.location && global.history) {
    let storage; try { storage = global.sessionStorage; } catch (_) { /* Access remains in memory. */ }
    access = captureAccess(global.location, global.history, storage);
  }
  function initialize(scope) {
    scope.querySelectorAll('[data-ds-tracking]').forEach(root => {
      if (root.dataset.serviceEnabled !== 'true' || root.dsTrackingController) return;
      const { id, capability, invalid } = access || {};
      if (!validId(id) || invalid) { root.querySelector('[data-status-message]').textContent = 'Abre el enlace privado completo de tu solicitud para consultar el seguimiento.'; return; }
      try { global.DSTracking.mountTracking(root, createHttpService(root.dataset.proxyPath, capability), id); }
      catch { root.querySelector('[data-status-message]').textContent = 'El seguimiento todavía no está disponible.'; }
    });
  }
  global.DSTrackingService = { createHttpService, captureAccess };
  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', () => initialize(global.document), { once: true });
    else initialize(global.document);
    global.document.addEventListener('shopify:section:load', event => initialize(event.target));
  }
})(globalThis);
