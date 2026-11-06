# Fuentes — mes 1, 2026-11-05

Rama `codex/mes1-fuentes`, base publicada `fc35d4ac1d572c89a52e47cc31dd6f07481512ab`.
Trabajo ejecutado por Codex en la sesión actual, sin subagentes adicionales. El identificador exacto del modelo/esfuerzo de esta sesión no está expuesto por la interfaz de herramientas; no se cambió la configuración global.

## Resultado

Las cinco variantes se mantienen: DM Serif Display normal/cursiva 400 y Montserrat normal 400/500/600. WOFF2 real, `font-display: swap`, mismas métricas, pesos, estilos, hinting y funciones OpenType. Los nombres de archivo incluyen el hash del contenido nuevo para evitar reutilizar binarios viejos desde caché.

| Variante | Antes (bytes) | Después (bytes) |
|---|---:|---:|
| Montserrat 400 | 180.068 | 22.224 |
| DM Serif Display normal | 70.348 | 27.220 |
| Montserrat 600 | 180.584 | 22.336 |
| DM Serif Display cursiva | 68.312 | 27.560 |
| Montserrat 500 | 180.036 | 22.316 |
| Total de archivos | 679.348 | 121.656 |

Cobertura: Latin básico/extendido y acentos combinados, todos los caracteres españoles y símbolos exigidos; además, todo carácter encontrado en `templates/*.json`, `sections/*.liquid`, `locales/es.default.json` y `config/settings_data.json` que ya existía en cada fuente original. La prueba descomprime los WOFF2 y compara cmap, métricas horizontales, métricas verticales y estilos con los originales. Los caracteres ausentes ya en los originales (por ejemplo emoji) siguen usando el mismo fallback; la lista por variante queda en `font-subsets.json`. Se conservan todos los registros de nombres/licencias.

Se sustituyen las precargas Dawn Montserrat n4/Fraunces n7 por Montserrat 400 y DM Serif Display normal de la capa ds-. Ambas fuentes se observaron sobre el primer pliegue de las cinco páginas a ambos anchos, mediante `CSS.getPlatformFontsForNode`. Fraunces no apareció allí. Se mantiene la declaración Dawn y su Montserrat 700 cuando lo solicita contenido existente. No se elimina ninguna variante de la capa ds-. Las precargas usan exactamente la URL relativa resuelta por CSS, sin el query de `asset_url`, para evitar una segunda descarga.

## Medición reproducible

| Página | Ancho | Antes | Después |
|---|---:|---:|---:|
| Inicio | 390 / 1440 | 620.880 | 119.064 |
| Colección Brownies | 390 | 371.984 | 88.596 |
| Colección Brownies | 1440 | 552.568 | 110.932 |
| Producto Tomate Confitada | 390 / 1440 | 925.140 | 325.784 |
| Contacto | 390 / 1440 | 732.604 | 113.820 |
| Pasteles personalizados | 390 / 1440 | 620.880 | 119.064 |

Portada móvil: **501.816 bytes menos, 80,82 %**, de siete recursos de fuente a cinco. Las cuatro fuentes ds- usadas en portada pasan de 499.312 a 99.340 bytes; queda además Montserrat 700 de Dawn (19.724 bytes).

Son bytes de los cuerpos de recursos de fuente solicitados por el navegador, sumados una vez por URL, no una medición de velocidad, LCP ni tráfico HTTP total. El resultado «después» se mide mediante sustitución local; aún no está desplegado. La auditoría previa registró 739.468 bytes/10 recursos: esta entrega usa una nueva pareja controlada de la versión publicada para no mezclar condiciones distintas.

## Paridad visual

Chrome headless, viewport 390×900 y 1440×900, DPR 1, capturas completas. HTML y recursos públicos se guardan una vez y se reproducen para ambos casos; únicamente cambian CSS de fuentes, sus archivos y el bloque de precargas. Reloj fijado en 2026-11-05T16:00Z, animaciones/transiciones desactivadas en ambas series, fuentes listas e imágenes diferidas recorridas antes de capturar. Se bloquean analítica, escrituras y el inicio de autenticación Shop; no se realiza compra ni envío de formulario.

**Diez parejas, cero píxeles diferentes y dimensiones idénticas.** En una primera pasada sin reloj fijo solo variaron los minutos del contador de Contacto; repetir con la misma hora eliminó esas diferencias. La ficha Brownie devolvió 429, por lo que la página de producto utilizada es `/products/tomate-confitada`, con respuesta 200. Las capturas finales no tuvieron errores de recursos no disponibles en el replay.

Evidencia: `C:/Users/Milton/AppData/Local/Temp/dayanas-mes1-fuentes/`:

- `{inicio,coleccion,producto,contacto,pasteles}-{390,1440}-{before,after}.png` (20 capturas).
- Los mismos prefijos con `-diff.png` (10 mapas de diferencia).
- `before.json`, `after.json`: URL, bytes, fuentes realmente renderizadas y capturas.
- `pixel-differences.json`: comparación exacta de las diez parejas.
- `cache/`: respuestas públicas utilizadas por ambas series; no se versionan.

## Validaciones y reproducción

- `node tests/check-theme.mjs`: PASS, 42 JS, 69 JSON, 57 esquemas.
- `node --test tests/*.test.mjs`: PASS, 140/140, cero omitidas.
- `python tests/test_font_subsets.py`: PASS, cobertura/métricas/estilos/compresión de las cinco variantes.
- `python tests/font-parity-diff.py <directorio-evidencia>`: PASS, diez parejas idénticas.
- `git diff --check`: PASS.

Herramientas oficiales instaladas en venv temporal `C:/Users/Milton/AppData/Local/Temp/dayanas-fonttools-env`: fonttools 4.68.0, brotli 1.2.1 y Pillow 13.0.0, desde `https://pypi.org/simple`. Playwright existente en `C:/Users/Milton/AppData/Local/Temp/dayanas-guest-qa-20261103` y Chrome local. No se modifican dependencias globales.

Construcción: `python tests/subset_fonts.py` (requiere el commit base en Git). Validación de fuentes: `python tests/test_font_subsets.py` con `PYTHONDONTWRITEBYTECODE=1`. Capturas: establecer `DS_QA_ROOT` al directorio que contiene Playwright, ejecutar `node tests/font-parity-capture.mjs before <evidencia>` y luego `after`. La primera fase es lectura pública; la segunda solo usa las respuestas guardadas y los archivos locales.

Documentación utilizada: [subconjuntos de fontTools](https://fonttools.readthedocs.io/en/latest/subset/index.html) y [formato WOFF2](https://fonttools.readthedocs.io/en/latest/ttLib/woff2.html).

Pendiente: integración del coordinador con SEO y verificación posterior en el tema de prueba cuando se autorice. Sin push, deploy, theme push ni cambios en admin. El único cambio en `layout/theme.liquid` es el bloque de precargas, separado del `<head>` inicial reservado a Claude.
