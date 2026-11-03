(function (global) {
  'use strict';
  const fail = code => Object.assign(new Error(code), { code });
  function createHttpService(basePath) {
    if (!/^\/apps\/[a-z0-9-]+$/.test(basePath)) throw fail('VALIDATION');
    async function call(id, action, payload) {
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw fail('VALIDATION');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await global.fetch(`${basePath}/requests/${encodeURIComponent(id)}${action}`, {
          method: payload ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
          ...(payload ? { body: JSON.stringify(payload) } : {})
        });
        if (!response.headers.get('content-type')?.includes('application/json')) throw fail('UNAVAILABLE');
        const body = await response.json();
        if (!response.ok) throw fail(['AUTH_REQUIRED', 'NOT_FOUND', 'CONFLICT', 'VALIDATION', 'UNAVAILABLE'].includes(body?.code) ? body.code : 'UNAVAILABLE');
        return body;
      } catch (e) { throw e?.code ? e : fail('UNAVAILABLE'); }
      finally { clearTimeout(timer); }
    }
    return {
      getTracking: id => call(id, ''),
      postComment: (id, text, operationId) => call(id, '/comments', { text, operationId }),
      acceptProposal: (id, proposalVersion, operationId) => call(id, '/accept', { proposalVersion, operationId }),
      startPayment: (id, operationId) => call(id, '/payment', { operationId }),
      syncPayment: (id, operationId) => call(id, '/payment-sync', { operationId })
    };
  }
  function initialize(scope) {
    scope.querySelectorAll('[data-ds-tracking]').forEach(root => {
      if (root.dataset.serviceEnabled !== 'true' || root.dsTrackingController) return;
      const id = new URL(global.location.href).searchParams.get('solicitud');
      if (!id || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) { root.querySelector('[data-status-message]').textContent = 'Abre el enlace de tu solicitud para consultar el seguimiento.'; return; }
      try { global.DSTracking.mountTracking(root, createHttpService(root.dataset.proxyPath), id); }
      catch { root.querySelector('[data-status-message]').textContent = 'El seguimiento todavía no está disponible.'; }
    });
  }
  global.DSTrackingService = { createHttpService };
  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', () => initialize(global.document), { once: true });
    else initialize(global.document);
    global.document.addEventListener('shopify:section:load', event => initialize(event.target));
  }
})(globalThis);
