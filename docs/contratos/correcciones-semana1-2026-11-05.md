# Correcciones semana 1: encargo para Codex (2026-11-05)

Aprobado por el usuario ("arranquen"). Corriges los hallazgos de `docs/revision-2026-11-05/INFORME.md`
que te asignó el informe: **F1, F2, F3, F4, F5, F6, F8 y F9**. Claude hace F7 y los textos de SEO.
El modelo y el esfuerzo los eliges tú; informa cuáles usaste.

## Ramas (no trabajes en el checkout principal ni en `main`)
- **Workers** (F1, F2, F3, F4, F5, F8): rama nueva `codex/correcciones-workers` desde
  `jAlexander15c/inventario-panel@1dd5c03`, en un worktree propio. Los archivos de
  `services/celebraciones/src` de esa rama son los publicados (712643e7).
- **Tema** (F6, F9): rama nueva `codex/correcciones-tema` desde `origin/main@f66a6bb`, en un worktree propio.
  Tocas solo `assets/cart-drawer.js`, `assets/global.js` (si hace falta) y `tests/*`.
  **No toques `sections/ds-contact.liquid`**: es de Claude (F7).

## Criterios de aceptación
- **F1:** una ráfaga de comentarios no genera un correo por mensaje. Hace falta un límite por solicitud
  y por ventana de tiempo, y los avisos se agrupan. Los avisos de pago tienen prioridad. El cliente
  legítimo recibe un mensaje claro. Prueba de ráfaga incluida.
- **F2:** editar solo el nombre nunca escribe precio ni SKU. Antes de cada escritura se releen los
  campos que se van a cambiar. Prueba con un cambio concurrente de precio.
- **F3:** la última lectura vuelve a validar `cancelledAt`. Si cambió, no hay URL y se marca
  `reviewRequired`. Incluye prueba de regresión.
- **F4:** los valores esperados no se normalizan, así que un título o SKU con espacios se puede editar.
  Incluye prueba.
- **F5:** se confirma la operación al recibir su recibo. Si falla la recarga, se muestra un aviso
  visible con un botón para actualizar. Incluye prueba.
- **F6:** Tab, Mayús+Tab y Escape funcionan con el carrito vacío y con productos, y el foco vuelve al
  disparador. Incluye prueba de navegador.
- **F8:** la confirmación de borrado acepta títulos existentes largos (hasta el límite de Shopify).
  Se mantienen las reglas de producto ARCHIVED, nombre escrito y rol Inventario.
- **F9:** las dos pruebas usan el mismo lector de JSON con comentarios que check-theme.

## Comprobaciones obligatorias
- `npm test` en `services/inventario` y en `services/celebraciones`, más `wrangler deploy --dry-run` de ambos.
- `node tests/check-theme.mjs`, las suites del tema que tocaste y una prueba de navegador del carrito
  a 390 px y en desktop.
- Informa el resultado real de cada una.

## Límites
- Sin push, deploy, `shopify theme push` ni cambios en el admin de Shopify o Cloudflare. Sin tocar secretos.
- Puedes hacer commits en tus ramas. La publicación se hace después, coordinada y con autorización
  del usuario.
- Si una duda cambia el resultado, pregunta por el buzón **y** escribe en la terminal del coordinador
  (`term_2edeb327-1bd6-493d-a9bf-b088a22349b2`). No te quedes esperando: avanza con lo que no dependa
  de la duda.

## Entrega
Un mensaje con `orca orchestration send --run run_019f52154b1f` que incluya: las ramas y commits,
qué cambiaste por hallazgo, las pruebas con su resultado y lo que quede pendiente.
