# Revisión exhaustiva + SEO — encargo para Codex (2026-11-05)

Pedido del usuario: revisión exhaustiva de todo el proyecto. Busca errores, da recomendaciones y evalúa
el SEO de dayanassweet.com con el objetivo de quedar #1 en nuestras categorías. **Todo se entrega como
propuesta**: ni tú ni nadie implementa nada todavía. Las correcciones las hacemos después Claude y Codex.

## Modelo y esfuerzo
Los eliges tú según lo que veas, y dices cuáles usaste y por qué. Puedes repartir en subagentes
o en pasadas si te sirve: por ejemplo, código con esfuerzo alto y SEO con esfuerzo medio.

## Alcance
1. **Tema Shopify en vivo**: checkout C:\Users\Milton\orca\dayanas-sweet-web (rama `main` = tienda en vivo).
   Revisa Liquid, CSS, JS, plantillas, secciones `ds-*`, carrito/cart drawer, envíos, cierre de tanda
   (stock 0) y accesibilidad. Revisa también el rendimiento: Core Web Vitals, imágenes, JS bloqueante.
2. **Workers Cloudflare**: `services/inventario` y `services/celebraciones`. La versión publicada está en
   C:/Users/Milton/orca/workspaces/dayanas-sweet-web/inventario-panel (rama `jAlexander15c/inventario-panel`,
   commit 1dd5c03). Revisa seguridad (sesiones, roles, App Proxy, RPC StaffGateway, rate limits, correos),
   eliminar producto archivado, idempotencia y errores silenciosos.
3. **SEO** (sitio en vivo https://dayanassweet.com, solo lectura):
   - Categorías actuales: galletas, brownies, enlatados/conservas saladas, jugos y bebidas,
     celebraciones/pedidos. Confírmalas en la tienda y ten en cuenta su ubicación y mercado real.
   - Revisa lo técnico: títulos, meta descriptions, H1, canónicas, sitemap, robots, datos estructurados
     (Product, LocalBusiness/Bakery, BreadcrumbList), hreflang/idioma, alt de imágenes, enlazado
     interno, velocidad y mobile.
   - Revisa contenido y palabras clave por categoría, intención de búsqueda, competidores locales,
     Google Business Profile, reseñas, SEO local, colecciones y textos de producto.
   - Dinos qué depende de nosotros (código o tema) y qué depende del admin de Shopify o de Dayana
     (Google Business, reseñas, contenido).

## Reglas
- Solo lectura. No hagas push, deploy, `shopify theme push` ni cambios en el admin de Shopify o Cloudflare.
  No toques secretos. No hagas compras ni envíes formularios en la tienda.
- Puedes correr pruebas locales (`node tests/check-theme.mjs`, `npm test` en los services) y consultar
  páginas públicas.
- Si una duda cambia el resultado, pregunta al coordinador con `orca orchestration send`.

## Entregable
`docs/revision-2026-11-05/INFORME.md` (en el checkout principal), en español:
1. Resumen ejecutivo: las 10 acciones de mayor impacto.
2. Hallazgos de errores. Cada uno con severidad (crítico/alto/medio/bajo), `archivo:línea`, escenario
   concreto que falla, propuesta de solución y quién conviene que lo haga (Claude o Codex).
3. Recomendaciones que no son errores.
4. SEO: diagnóstico por categoría, palabras clave objetivo, cambios técnicos y de contenido, y plan por
   fases (rápido / 1 mes / continuo). Para cada punto: impacto esperado y esfuerzo.
5. Qué corriste y su resultado real, y qué no pudiste comprobar.

Cierra avisando con `orca orchestration send --run run_019f52154b1f` y la ruta del informe.
