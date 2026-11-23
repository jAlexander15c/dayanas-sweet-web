const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

const tab = (id, label, selected = false) => `<button type="button" role="tab" id="ds-tab-${id}" data-tab="${id}" aria-controls="ds-panel-${id}" aria-selected="${selected}"${selected ? '' : ' tabindex="-1"'}>${label}</button>`;

/**
 * Static Celebraciones markup, shared by the Shopify admin page and the staff portal (inside
 * #celebraciones-view). It holds no private data: everything is filled in by admin-ui.js.
 */
export function celebrationsMarkup() {
  return `<div id="ds-app" class="ds-app" data-view="list">
<p id="ds-feedback" class="ds-feedback" role="status" aria-live="polite"></p>
<section id="ds-access" class="ds-card" hidden><h2>Acceso no autorizado</h2><p>Abre esta aplicación desde Shopify con una cuenta autorizada para gestionar las celebraciones.</p></section>
<div id="ds-workspace" class="ds-workspace" hidden>
  <section id="ds-list-pane" class="ds-list-pane" aria-labelledby="ds-list-title">
    <div class="ds-row"><h2 id="ds-list-title" class="ds-title">Celebraciones</h2><button id="ds-alert-toggle" type="button" class="ds-alert-toggle" aria-expanded="false" aria-controls="ds-staff-alerts-card" hidden><span id="ds-alert-count">Avisos</span></button></div>
    <section id="ds-staff-alerts-card" class="ds-card ds-alerts" hidden aria-labelledby="ds-staff-alerts-title">
      <div class="ds-row"><h3 id="ds-staff-alerts-title">Avisos</h3><button id="ds-alert-refresh" type="button">Actualizar avisos</button></div>
      <p class="ds-muted">Mensajes de la clienta, propuestas aceptadas y pagos confirmados. También te llegan por correo.</p>
      <p id="ds-alert-status" class="ds-muted" role="status"></p>
      <div id="ds-staff-alerts" class="ds-stack"></div>
    </section>
    <form id="ds-search-form" class="ds-search" role="search"><label for="ds-search" class="ds-sr">Buscar solicitud</label><input id="ds-search" type="search" maxlength="100" placeholder="Nombre o número de solicitud"><button type="submit">Buscar</button></form>
    <div id="ds-filters" class="ds-filters" role="group" aria-label="Filtrar por etapa"></div>
    <p id="ds-list-message" class="ds-muted"></p>
    <nav id="ds-requests" class="ds-requests" aria-label="Solicitudes"></nav>
    <button id="ds-more" type="button" hidden>Cargar más solicitudes</button>
    <div class="ds-list-foot"><button id="ds-refresh" type="button">Actualizar lista</button><a id="ds-settings-link" class="ds-link-row" href="#celebraciones/ajustes">Ajustes: fechas cerradas y conexión de pagos <span aria-hidden="true">›</span></a></div>
  </section>

  <section id="ds-settings" class="ds-pane" hidden aria-labelledby="ds-settings-title">
    <a class="ds-back" href="#celebraciones">‹ Celebraciones</a>
    <h2 id="ds-settings-title" class="ds-title" tabindex="-1">Ajustes de Celebraciones</h2>
    <section class="ds-card" aria-labelledby="ds-calendar-title"><h3 id="ds-calendar-title">Fechas de recogida</h3><p class="ds-muted">Abre o cierra la recepción de solicitudes para cada fecha. Los pedidos existentes se conservan.</p>
      <form id="ds-calendar-form" class="ds-stack"><fieldset id="ds-calendar-fields" class="ds-stack"><label>Fecha de recogida<input name="date" type="date" required></label><p id="ds-calendar-status" class="ds-note" aria-live="polite">Cargando agenda…</p><div class="ds-actions"><button name="closed" value="true" type="submit">Cerrar fecha</button><button name="closed" value="false" type="submit">Abrir fecha</button></div></fieldset></form>
      <details><summary>Fechas cerradas</summary><ul id="ds-calendar-days"></ul></details>
      <p class="ds-muted">Recogida todos los días de 8:00 a 18:00, horario de Houston (America/Chicago). 4319 Freya Pointe Dr, Fulshear, TX 77441.</p>
    </section>
    <section class="ds-card" aria-labelledby="ds-payment-check-title"><h3 id="ds-payment-check-title">Conexión de pagos</h3><p class="ds-muted">Comprueba la conexión, los permisos y las ubicaciones de Shopify.</p><button id="ds-payment-check" type="button">Verificar conexión de pagos</button><div id="ds-payment-check-result" aria-live="polite"></div></section>
  </section>

  <section id="ds-empty" class="ds-card ds-empty"><h2>Elige una solicitud</h2><p class="ds-muted">Aquí verás el pedido, la propuesta, la conversación y los pagos.</p></section>

  <article id="ds-detail" class="ds-pane" hidden aria-labelledby="ds-request-title">
    <div class="ds-detail-head">
      <button id="ds-back-to-list" type="button" class="ds-back">‹ Celebraciones</button>
      <div class="ds-row ds-head-row"><div class="ds-head-text"><h2 id="ds-request-title" tabindex="-1">Solicitud</h2><p id="ds-request-id" class="ds-muted"></p><p id="ds-pickup" class="ds-muted"></p></div><span id="ds-status" class="ds-badge"></span></div>
      <div id="ds-tabs" class="ds-tabs" role="tablist" aria-label="Partes de la solicitud">${tab('pedido', 'Pedido', true)}${tab('propuesta', 'Propuesta')}${tab('conversacion', 'Conversación')}${tab('pagos', 'Pagos')}</div>
    </div>

    <section id="ds-summary" class="ds-card ds-summary" aria-labelledby="ds-next-title">
      <p id="ds-next-title" class="ds-eyebrow">Siguiente paso</p><p id="ds-next" class="ds-next"></p>
      <div id="ds-finances" class="ds-finances"></div>
      <p id="ds-credit" class="ds-note ds-error" hidden></p>
      <p id="ds-status-note" class="ds-muted"></p>
      <div class="ds-actions"><button id="ds-next-action" type="button" class="ds-primary" hidden></button><button id="ds-preparing" type="button" class="ds-primary" hidden>Marcar en preparación</button><button id="ds-ready" type="button" class="ds-primary" hidden>Marcar listo para recoger</button></div>
    </section>

    <section id="ds-panel-pedido" class="ds-panel" role="tabpanel" aria-labelledby="ds-tab-pedido">
      <section class="ds-card"><h3>Lo que nos contó</h3><p id="ds-urgency" class="ds-muted"></p><p id="ds-request-text" class="ds-copy"></p><div id="ds-photos" class="ds-photos"></div></section>
      <section class="ds-card"><h3>Contacto</h3><div id="ds-contact" class="ds-stack"></div></section>
    </section>

    <section id="ds-panel-propuesta" class="ds-panel" role="tabpanel" aria-labelledby="ds-tab-propuesta" hidden>
      <section id="ds-accepted" class="ds-card" hidden><p class="ds-eyebrow">Diseño y precio vigentes</p><h3>Propuesta aceptada</h3><div id="ds-accepted-copy"></div></section>
      <section id="ds-pending" class="ds-card ds-pending" hidden><p class="ds-eyebrow">Esperando que la clienta acepte</p><h3>Propuesta enviada</h3><div id="ds-pending-copy"></div></section>
      <section class="ds-card"><h3>Prepara la propuesta</h3><p id="ds-proposal-note" class="ds-muted">La clienta debe aceptar la propuesta para que cambien el diseño y el precio vigentes.</p>
        <form id="ds-proposal-form" class="ds-stack"><fieldset id="ds-proposal-fields" class="ds-stack">
          <label>Lo que podemos preparar<textarea name="canPrepare" required maxlength="2000"></textarea></label>
          <label>Lo que cambia o no podemos reproducir<textarea name="changes" maxlength="2000"></textarea></label>
          <label>Respuesta final de la pastelera<textarea name="reply" required maxlength="2000"></textarea></label>
          <div class="ds-two"><label>Pastel y personalización (USD)<input name="baseCents" inputmode="decimal" type="number" min="0" max="1000000" step="0.01" required></label><label>Recargo por urgencia (USD)<input name="surchargeCents" inputmode="decimal" type="number" min="0" max="1000000" step="0.01" value="0" required></label></div>
          <label>Mostrar a la clienta<select name="display"><option value="total">Solo total</option><option value="breakdown">Desglose y total</option></select></label>
          <label>¿Cómo paga la clienta?<select name="paymentMode"><option value="deposit">Anticipo del 60 %</option><option value="full">Pago completo antes de preparar</option><option value="delivery">Pago completo contra entrega</option></select></label>
          <p id="ds-payment-mode-note" class="ds-muted"></p>
          <p id="ds-price-preview" class="ds-note" aria-live="polite">Completa el precio de la propuesta.</p>
          <p id="ds-proposal-draft" class="ds-draft" hidden>Borrador sin enviar</p>
          <button type="submit" class="ds-primary">Enviar propuesta</button>
        </fieldset></form>
      </section>
      <details class="ds-card"><summary>Historial de propuestas</summary><div id="ds-history" class="ds-stack"></div></details>
    </section>

    <section id="ds-panel-conversacion" class="ds-panel" role="tabpanel" aria-labelledby="ds-tab-conversacion" hidden>
      <section class="ds-card"><h3>Conversación con la clienta</h3><div id="ds-thread" class="ds-thread"></div>
        <form id="ds-comment-form" class="ds-stack"><fieldset id="ds-comment-fields" class="ds-stack"><label>Tu mensaje<textarea name="text" required maxlength="2000" placeholder="Responde o aclara un detalle del pastel…"></textarea></label><p id="ds-comment-draft" class="ds-draft" hidden>Mensaje sin enviar</p><button type="submit" class="ds-primary">Enviar mensaje</button></fieldset></form>
        <p id="ds-comment-note" class="ds-muted"></p></section>
    </section>

    <section id="ds-panel-pagos" class="ds-panel" role="tabpanel" aria-labelledby="ds-tab-pagos" hidden>
      <section class="ds-card"><h3>Reserva y pagos</h3><p id="ds-billing-note" class="ds-muted"></p><p class="ds-muted">Los pagos recibidos se conservan.</p>
        <form id="ds-delivery-form" class="ds-stack" hidden><fieldset id="ds-delivery-fields" class="ds-stack"><p id="ds-delivery-amount" class="ds-note"></p><label class="ds-check"><input name="received" type="checkbox" required> Confirmo que ya recibí este importe de la clienta.</label><button type="submit" class="ds-primary">Registrar pago recibido</button><p class="ds-muted">Este registro confirma el cobro en Celebraciones; no hace un cargo ni registra una transacción en Shopify.</p></fieldset></form>
        <button id="ds-payment-sync" type="button">Actualizar estado del pago</button>
      </section>
      <section class="ds-card"><h3>Correos de actualizaciones</h3><p class="ds-muted">«Aceptado» significa que el proveedor recibió el correo, no que la clienta lo haya leído.</p><div id="ds-notifications" class="ds-stack"></div><button id="ds-notifications-refresh" type="button">Actualizar correos</button></section>
    </section>
  </article>
</div>
<noscript><p>Activa JavaScript para consultar y gestionar las solicitudes.</p></noscript>
<dialog id="ds-photo-dialog" class="ds-photo-dialog" aria-labelledby="ds-photo-title">
  <div class="ds-photo-toolbar"><h2 id="ds-photo-title">Foto de referencia</h2><div class="ds-actions"><button id="ds-photo-zoom" type="button" aria-pressed="false" aria-controls="ds-photo-view">Ampliar</button><button id="ds-photo-close" type="button" autofocus>Cerrar</button></div></div>
  <div id="ds-photo-view" class="ds-photo-view"><img id="ds-photo-full" alt=""></div>
</dialog>
</div>`;
}

/** Shopify admin app shell. Private data is loaded only with an authorized App Bridge session. */
export function renderAdminPage({ clientId, shop } = {}) {
  const valid = typeof shop === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(shop)
    && typeof clientId === 'string' && clientId.trim().length > 0;
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' https://cdn.shopify.com; style-src 'self'; img-src 'self' blob:; connect-src 'self' https://admin.shopify.com https://cdn.shopify.com${valid ? ` https://${shop}` : ''}; frame-ancestors ${valid ? `https://${shop} https://admin.shopify.com` : "'none'"}; base-uri 'none'; object-src 'none'; form-action 'self'`,
  };
  if (!valid) return new Response('<!doctype html><html lang="es"><meta charset="utf-8"><title>Panel no disponible</title><p>El panel no está disponible. Revisa la configuración de la aplicación.</p></html>', { status: 503, headers });
  return new Response(`<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="shopify-api-key" content="${escape(clientId)}">
<title>Celebraciones · Dayana's Sweet</title>
<link rel="stylesheet" href="/admin/assets/admin-ui.css">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<script type="module" src="/admin/assets/admin-ui.js"></script>
</head><body class="ds-page" data-ds-standalone="true">
<header class="ds-head"><span class="ds-brand">Dayana’s <em>Sweet</em></span><span>Panel de la pastelera</span></header>
<main class="ds-main">
${celebrationsMarkup()}
</main>
</body></html>`, { headers });
}
