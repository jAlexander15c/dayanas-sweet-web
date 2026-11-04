const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

/** Public app shell. Private data is loaded only with an authorized App Bridge session. */
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
</head><body>
<header class="ds-head"><span class="ds-brand">Dayana’s <em>Sweet</em></span><span>Panel de la pastelera</span></header>
<main>
  <p class="ds-eyebrow">Celebraciones</p><h1>Una propuesta <em>con cada detalle.</em></h1>
  <p class="ds-sub">Revisa cada solicitud, conversa con el cliente y prepara su propuesta.</p>
  <p id="ds-feedback" role="status" aria-live="polite">Conectando con Shopify…</p>
  <section id="ds-access" class="ds-card" hidden><h2>Acceso no autorizado</h2><p>Abre esta aplicación desde Shopify con una cuenta autorizada para gestionar las celebraciones.</p></section>
  <div id="ds-workspace" class="ds-workspace" hidden>
    <aside class="ds-sidebar" aria-label="Solicitudes y agenda"><div class="ds-list-head"><h2>Solicitudes</h2><button id="ds-refresh" type="button">Actualizar</button></div>
      <form id="ds-search-form" class="ds-stack"><label>Buscar solicitud<input id="ds-search" type="search" maxlength="100" placeholder="Número de solicitud o nombre"></label><button type="submit">Buscar</button></form>
      <p id="ds-list-message" class="ds-muted"></p><nav id="ds-requests" aria-label="Elegir solicitud"></nav><button id="ds-more" type="button" hidden>Cargar más solicitudes</button>
      <section class="ds-calendar ds-card" aria-labelledby="ds-calendar-title"><h2 id="ds-calendar-title">Agenda</h2><p class="ds-muted">Abre o cierra la recepción de solicitudes para cada fecha. Los pedidos existentes se conservan.</p>
        <form id="ds-calendar-form" class="ds-stack"><fieldset id="ds-calendar-fields" class="ds-stack"><label>Fecha de recogida<input name="date" type="date" required></label><p id="ds-calendar-status" class="ds-note" aria-live="polite">Cargando agenda…</p><div class="ds-stack"><button name="closed" value="true" type="submit">Cerrar fecha</button><button name="closed" value="false" type="submit">Abrir fecha</button></div></fieldset></form>
        <details><summary>Fechas cerradas</summary><ul id="ds-calendar-days"></ul></details>
        <p class="ds-muted">Recogida todos los días de 8:00 a 18:00, horario de Houston (America/Chicago).</p><p class="ds-muted">4319 Freya Point Dr, Fulshear, TX 77441</p>
      </section>
      <section class="ds-calendar ds-card" aria-labelledby="ds-payment-check-title"><h2 id="ds-payment-check-title">Conexión de pagos</h2><p class="ds-muted">Comprueba la conexión, los permisos y las ubicaciones de Shopify.</p><button id="ds-payment-check" type="button">Verificar conexión de pagos</button><div id="ds-payment-check-result" aria-live="polite"></div></section>
    </aside>
    <section id="ds-empty" class="ds-card"><h2>Cada pastel empieza con una idea</h2><p>Selecciona una solicitud para ver sus detalles.</p></section>
    <article id="ds-detail" hidden aria-labelledby="ds-request-title">
      <button id="ds-back-to-list" type="button">← Volver a solicitudes</button>
      <div class="ds-detail-head"><div><p class="ds-eyebrow" id="ds-request-id"></p><h2 id="ds-request-title" tabindex="-1">Detalle de la solicitud</h2><p id="ds-pickup"></p><p id="ds-urgency" class="ds-muted"></p></div><span id="ds-status" class="ds-badge"></span></div>
      <section class="ds-card"><h3>Reserva y pagos</h3><div id="ds-finances" class="ds-finances"></div><p id="ds-billing-note" class="ds-muted"></p><p class="ds-muted">Los pagos recibidos se conservan.</p><p id="ds-credit" class="ds-note" hidden></p>
        <form id="ds-delivery-form" class="ds-stack" hidden><fieldset id="ds-delivery-fields" class="ds-stack"><p id="ds-delivery-amount" class="ds-note"></p><label class="ds-receipt-confirm"><input name="received" type="checkbox" required> Confirmo que ya recibí este importe del cliente.</label><button type="submit" class="ds-primary">Registrar pago recibido</button><p class="ds-muted">Este registro confirma el cobro en Celebraciones; no realiza un cargo ni registra una transacción en Shopify.</p></fieldset></form>
        <button id="ds-payment-sync" type="button">Actualizar estado del pago</button>
      </section>
      <section class="ds-card"><p class="ds-eyebrow">La idea del cliente</p><h3>Lo que nos contó</h3><p id="ds-request-text" class="ds-copy"></p><div id="ds-photos" class="ds-photos"></div></section>
      <section class="ds-card"><h3>Correos de actualizaciones</h3><p class="ds-muted">Comprueba el estado de cada aviso. «Aceptado» significa que el proveedor lo recibió, no que el cliente lo haya leído.</p><div id="ds-notifications" class="ds-stack"></div><button id="ds-notifications-refresh" type="button">Actualizar correos</button></section>
      <section id="ds-accepted" class="ds-card" hidden><p class="ds-eyebrow">Diseño y precio vigentes</p><h3>Propuesta aceptada</h3><div id="ds-accepted-copy"></div></section>
      <section id="ds-pending" class="ds-card ds-pending" hidden><p class="ds-eyebrow">Esperando aceptación del cliente</p><h3>Propuesta pendiente</h3><div id="ds-pending-copy"></div></section>
      <section class="ds-card"><h3>Prepara la propuesta</h3><p id="ds-proposal-note" class="ds-muted">El cliente debe aceptar la propuesta para que cambie el diseño y precio vigentes.</p>
        <p class="ds-muted ds-tax-note">El cliente pagará según la condición que elijas en esta propuesta.</p><form id="ds-proposal-form" class="ds-stack"><fieldset id="ds-proposal-fields" class="ds-stack">
          <div class="ds-two"><label>Lo que podemos preparar<textarea name="canPrepare" required maxlength="2000"></textarea></label><label>Lo que cambia o no podemos reproducir<textarea name="changes" maxlength="2000"></textarea></label></div>
          <label>Respuesta final de la pastelera<textarea name="reply" required maxlength="2000"></textarea></label>
          <div class="ds-two"><label>Pastel y personalización (USD)<input name="baseCents" inputmode="decimal" type="number" min="0" max="1000000" step="0.01" required></label><label>Recargo por urgencia (USD)<input name="surchargeCents" inputmode="decimal" type="number" min="0" max="1000000" step="0.01" value="0" required></label></div>
          <label>Mostrar al cliente<select name="display"><option value="total">Solo total</option><option value="breakdown">Desglose y total</option></select></label>
          <label>¿Cómo debe pagar el cliente?<select name="paymentMode"><option value="deposit">Anticipo del 60 %</option><option value="full">Pago completo antes de preparar</option><option value="delivery">Pago completo contra entrega</option></select></label>
          <p id="ds-payment-mode-note" class="ds-muted"></p>
          <p id="ds-price-preview" class="ds-note" aria-live="polite">Completa el precio de la propuesta.</p>
          <button type="submit" class="ds-primary">Enviar propuesta</button>
        </fieldset></form>
      </section>
      <section class="ds-card"><h3>Conversemos sobre su pastel</h3><div id="ds-thread" class="ds-stack"></div><form id="ds-comment-form" class="ds-stack"><fieldset id="ds-comment-fields" class="ds-stack"><label>Tu comentario<textarea name="text" required maxlength="2000" placeholder="Responde o aclara un detalle de la solicitud…"></textarea></label><button type="submit" class="ds-primary">Enviar comentario</button></fieldset></form><p id="ds-comment-note" class="ds-muted"></p></section>
      <section class="ds-card"><h3>Preparación y recogida</h3><p id="ds-status-note" class="ds-muted"></p><div class="ds-actions"><button id="ds-preparing" type="button">Marcar en preparación</button><button id="ds-ready" type="button" class="ds-primary">Marcar listo para recoger</button></div></section>
      <details class="ds-card"><summary>Historial de propuestas</summary><div id="ds-history" class="ds-stack"></div></details>
    </article>
  </div>
  <noscript><p>Activa JavaScript para consultar y gestionar las solicitudes.</p></noscript>
</main>
<dialog id="ds-photo-dialog" class="ds-photo-dialog" aria-labelledby="ds-photo-title">
  <div class="ds-photo-toolbar"><h2 id="ds-photo-title">Foto de referencia</h2><div><button id="ds-photo-zoom" type="button" aria-pressed="false" aria-controls="ds-photo-view">Ampliar</button><button id="ds-photo-close" type="button" autofocus>Cerrar</button></div></div>
  <div id="ds-photo-view" class="ds-photo-view"><img id="ds-photo-full" alt=""></div>
</dialog>
</body></html>`, { headers });
}
