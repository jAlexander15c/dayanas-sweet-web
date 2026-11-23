import { securityHeaders } from './http.mjs';
import { escapeHtml } from './validation.mjs';
import { portalHeaders, portalCsp } from './portal-handler.mjs';
import { celebrationsMarkup } from '../../celebraciones/src/admin-page.mjs';
// Íconos de la barra inferior del iPhone (decorativos: el nombre de cada botón es su texto).
const icon = path => `<svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const icons = {
  hoy: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  pedidos: '<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  celebraciones: '<path d="M4 21h16M5 21v-6h14v6M7 15v-3h10v3M12 12V8"/><path d="M12 8c-1-1-1-3 0-4 1 1 1 3 0 4z"/>',
  productos: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  mas: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
};
// Portal: una sola navegación. En el iPhone es la barra inferior (Hoy, Pedidos, Celebraciones, Productos, Más);
// «Más» agrupa Categorías, Historial y Usuarios. En escritorio es una fila arriba.
const portalNav = () => `<button id="hoy" hidden>${icon(icons.hoy)}Hoy</button><button id="pedidos" hidden>${icon(icons.pedidos)}Pedidos</button><button id="celebraciones" hidden>${icon(icons.celebraciones)}Celebraciones</button><button id="home">${icon(icons.productos)}Productos</button><button id="more-nav" type="button" aria-expanded="false" aria-controls="more-menu">${icon(icons.mas)}Más</button><div id="more-menu" class="more-menu" role="group" aria-label="Más secciones"><button id="categories">Categorías</button><button id="history">Historial</button><button id="cobros" hidden>Cobros</button><button id="users">Usuarios</button></div>`;
export function renderAdminPage(env, { portal = false } = {}) {
  const assets = portal ? `${new URL(env.PORTAL_PUBLIC_URL).pathname.replace(/\/$/, '')}/assets` : '/assets';
  return new Response(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="shopify-api-key" content="${escapeHtml(env.SHOPIFY_CLIENT_ID || '')}">
${portal ? `<meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(portalCsp.replace("; frame-ancestors 'none'", ''))}">` : ''}
<title>Inventario · Dayana’s Sweet</title><link rel="stylesheet" href="${assets}/admin-ui.css">${portal ? `<link rel="stylesheet" href="${assets}/celebraciones.css">` : ''}
${portal ? '' : '<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>'}<script type="module" src="${assets}/staff-ui.js"></script><script type="module" src="${assets}/admin-ui.js"></script>${portal ? `<script type="module" src="${assets}/orders-ui.js"></script><script type="module" src="${assets}/celebraciones.js"></script><script type="module" src="${assets}/today-ui.js"></script><script type="module" src="${assets}/cobros-ui.js"></script>` : ''}</head>
<body ${portal ? 'data-portal="true"' : ''}><header><span>Dayana’s <em>Sweet</em></span><div id="staff-who" ${portal ? '' : 'hidden'}></div><span ${portal ? 'hidden' : ''}>Tu cocina, al día</span></header>
<main><section id="access-view" ${portal ? '' : 'hidden'}></section><div id="panel-view" ${portal ? 'hidden' : ''}><div class="heading">${portal ? '<h1 class="sr-only">Panel de Dayana</h1>' : '<div><p class="eyebrow">Panel de la pastelera</p><h1>Inventario</h1></div>'}<nav aria-label="Pantallas">${portal ? portalNav() : '<button id="home">Productos</button><button id="categories">Categorías</button><button id="history">Historial</button><button id="users">Usuarios</button>'}</nav></div>
<p id="feedback" role="status" aria-live="polite">Conectando con Shopify…</p>
<p id="scope-warning" class="error" role="alert" hidden></p>
<section id="workspace" hidden><div class="toolbar"><form id="search-form" role="search"><label for="search">¿Qué preparaste hoy?</label><div class="search-row"><input id="search" type="search" maxlength="100" placeholder="Busca un producto…"><button class="primary">Buscar</button></div></form><button id="new-product">+ Nuevo producto</button></div>
<label class="filter"><input id="uncategorized" type="checkbox"> Ver productos sin categoría</label><div id="products" class="products"></div><button id="more" hidden>Ver más productos</button></section>
<section id="categories-view" hidden><div class="toolbar"><div><h2>Categorías</h2><p>Organiza los productos y elige qué se ve en la portada.</p></div><button id="new-category">+ Nueva categoría</button></div><p id="category-warning" class="error" role="alert" hidden></p><div id="category-list" class="products"></div><h2>Colecciones de la tienda que aún no son categoría</h2><div id="collection-list" class="products"></div><div class="actions"><button id="collections-previous" hidden>Anterior</button><p id="collections-page" role="status"></p><button id="collections-next" hidden>Siguiente</button></div></section>
<section id="history-view" hidden><h2>Últimos cambios</h2><p>Lo que se guardó y lo que necesita revisión.</p><div id="events"></div></section>
<section id="users-view" hidden></section>${portal ? '<section id="today-view" class="today" hidden aria-labelledby="today-title"></section><section id="pedidos-view" class="orders" hidden></section><section id="cobros-view" class="orders cobros" hidden></section>' : ''}<section id="celebraciones-view" hidden>${portal ? celebrationsMarkup() : '<h2>Celebraciones</h2><p>Esta sección todavía no está disponible.</p>'}</section></div>
<noscript>Activa JavaScript para usar el panel.</noscript></main>
<dialog id="editor" aria-labelledby="editor-title"><form id="editor-form"><div class="dialog-head"><h2 id="editor-title"></h2><button type="button" id="close-editor" aria-label="Cerrar formulario">Cerrar</button></div><div id="editor-fields"></div><p id="editor-error" role="alert"></p><button class="primary" id="review">Revisar cambio</button></form></dialog>
<dialog id="category-editor" aria-labelledby="category-title"><form id="category-form"><div class="dialog-head"><h2 id="category-title"></h2><button type="button" id="close-category">Cerrar</button></div><div id="category-fields"></div><p id="category-error" role="alert"></p><button class="primary" id="review-category">Revisar categoría</button></form></dialog>
<dialog id="confirmation" aria-labelledby="confirm-title"><h2 id="confirm-title">Revisa antes de guardar</h2><div id="summary"></div><p id="confirm-error" role="alert"></p><div class="actions"><button id="back">Volver</button><button id="confirm" class="primary">Confirmar y guardar</button></div></dialog>
${portal ? '<dialog id="order-sheet" class="order-sheet" aria-labelledby="order-sheet-title"></dialog><dialog id="cobros-sheet" class="order-sheet" aria-labelledby="cobros-sheet-title"></dialog>' : ''}
</body></html>`, { headers: { ...(portal ? portalHeaders() : securityHeaders(env)), 'Content-Type': 'text/html; charset=utf-8' } });
}
