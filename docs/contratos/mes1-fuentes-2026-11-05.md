# Mes 1 — fuentes más livianas: encargo para Codex (2026-11-05)

Aprobado por el usuario ("Continuen", fase del primer mes del INFORME, sección 3 "Fuentes").
El modelo y el esfuerzo los eliges tú; informa cuáles usaste.

## Problema medido (INFORME)
- Portada móvil: 10 descargas de fuente, 739.468 bytes. Las cuatro `ds-r-font-*` suman 499.312.
- Los `assets/ds-r-font-*.woff2` son TrueType renombrados (CSS `format('truetype')` en `assets/ds-redesign.css:1-40`).
- `layout/theme.liquid:309-318` precarga las fuentes Dawn (`montserrat_n4`, `fraunces_n7`). Revisa si alguna se usa visiblemente.

## Rama
`codex/mes1-fuentes` desde `origin/main@fc35d4a`, en un worktree propio.
Solo tocas:
- `assets/ds-r-font-*` (reemplazar o crear archivos nuevos);
- los bloques `@font-face` de `assets/ds-redesign.css`;
- las líneas de precarga de fuentes de `layout/theme.liquid` (309-318);
- `tests/*`.
Claude trabaja en paralelo en `layout/theme.liquid` (`<head>`, líneas 1-40), `snippets/ds-structured-data.liquid`, `sections/ds-collection-hero.liquid` y `sections/ds-redesign-home.liquid`. No toques esas partes.

## Criterios de aceptación
- WOFF2 real (`format('woff2')`), con un subconjunto que cubra español completo: á é í ó ú ü ñ, mayúsculas, ¿ ¡, comillas tipográficas ’ “ ” « », —, –, …, $, €, ·, °, ×, números y signos de puntuación. Además, cualquier carácter presente en `templates/*.json`, `sections/*.liquid`, `locales/es.default.json` y `config/settings_data.json` que use la capa ds-.
- Se conservan los mismos pesos y estilos. Si quitas una variante, demuestra que no se usa.
- `font-display` igual o mejor que hoy.
- Precargas: solo las fuentes realmente usadas sobre el primer pliegue. Si las fuentes Dawn no se ven, se quitan sus precargas.
- Paridad visual: capturas antes/después a 390 px y 1440 px de inicio, una colección, un producto, Contacto y `/pages/pasteles-personalizados`. Las diferencias de píxeles deben ser mínimas y estar explicadas.
- Informa los bytes de fuente de la portada móvil antes y después.

## Comprobaciones obligatorias
- `node tests/check-theme.mjs`.
- Las suites del tema que dependan de los archivos tocados.
- Capturas de paridad.
- Para instalar herramientas (por ejemplo fonttools/brotli con pip), usa solo paquetes oficiales de PyPI/npm. Si no puedes, pregunta.

## Límites
- Sin push, deploy, `shopify theme push` ni cambios en el admin.
- Puedes hacer commits en tu rama.
- Si una duda cambia el resultado, pregunta por el buzón **y** escribe en la terminal del coordinador (`term_2edeb327-1bd6-493d-a9bf-b088a22349b2`).

## Entrega
`orca orchestration send --run run_019f52154b1f --subject ... --body ...` con:
- la rama y los commits;
- los bytes antes y después;
- las rutas de las capturas;
- las pruebas y su resultado;
- lo pendiente.
