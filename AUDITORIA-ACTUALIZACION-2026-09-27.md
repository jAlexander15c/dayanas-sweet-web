# Auditoría y optimización del tema — 27 de septiembre de 2026

La revisión detallada original está en [REVISION-WEB-CODEX.md](REVISION-WEB-CODEX.md). Este documento registra el estado posterior a las correcciones locales. La tienda publicada todavía usa la versión anterior del tema; las mediciones en vivo son una línea de referencia, no una medición de estos cambios.

## Referencia de rendimiento publicada

Una ejecución móvil de Lighthouse sobre `https://dayanassweet.com/` dio rendimiento **57/100**, FCP **3,9 s**, LCP **9,3 s**, TBT **200 ms**, CLS **0** y transferencia total **2.553 KiB**. El elemento LCP fue la primera foto del carrusel. Lighthouse atribuyó **5,9 s de los 9,3 s** a demora de renderizado; por ello la reducción de bytes por sí sola no garantiza resolver todo el LCP. Es una sola medición sintética y puede variar.

El HTML publicado descargó los tres PNG de respaldo del carrusel. Las cabeceras de la portada también precargaron `dayanas-theme.css` y `ds-pages.css`. Ninguna de las mejoras locales estaba publicada al medir.

## Correcciones locales verificadas

| Área | Cambio | Comprobación |
| --- | --- | --- |
| Imágenes de marca | Tres respaldos PNG se sirven mediante WebP de 480, 800 y 1200 px con `srcset`, `sizes` y dimensiones reservadas en portada, categorías, historia y redes. Los valores PNG del editor se conservan para no invalidar su configuración. | Los nueve WebP existen; Theme Check reconoce el fragmento. Los tres PNG suman 6,96 MB en el repositorio; las tres versiones WebP de 800 px suman 218 KB. La transferencia real dependerá de pantalla y CDN. |
| Portada | Primera foto en carga inmediata y prioridad alta; el script prepara la siguiente foto después de cargar la visible. | Revisión del marcado y sintaxis JS. Falta prueba visual del carrusel en vista previa. |
| Productos | La primera foto de ficha se solicita con carga inmediata, prioridad alta y preload de Shopify; las tarjetas de colección y búsqueda piden tamaños ajustados a la grilla. La primera fila evita la animación de entrada. | Theme Check y sintaxis JS sin errores nuevos. Falta medir LCP de ficha y colección. |
| CSS | Se quitó la petición vacía de `dayanas-theme.css`. Los 4,4 KB de estilos compartidos de navegación/búsqueda se separaron de `ds-pages.css`; la portada ya no carga los 17,8 KB de estilos interiores. | Revisión de selectores y Theme Check. Falta comparación visual en móvil y escritorio. |
| Compra e inventario | El cierre de tanda se refleja en botones de ficha, carrito, compra rápida DS y tarjeta estándar de Dawn. Los avisos de cupo y precio de la barra fija se actualizan al cambiar variante. | Código y sintaxis revisados. Debe probarse con variantes, stock y checkout reales. |
| Seguridad y accesibilidad | Escape del correo y textos sustituidos; enlaces sociales sin destino dejan de ser enlaces; controles de pausa, mensajes inactivos fuera de foco, limpieza de observadores y contraste de cupos. | Código y sintaxis revisados. Falta recorrido con teclado/lector en la vista previa. |

## Riesgos y acciones pendientes

1. **Cierre real de pedidos:** el ajuste `ds_batch_open` solo gobierna la interfaz del tema. Antes de anunciar una tanda cerrada, bloquear la disponibilidad o aplicar una validación de checkout en Shopify y probar una URL directa de checkout. Esta es la prioridad operativa más alta.
2. **Validación del comercio:** probar ficha con dos variantes de distinto precio y stock, agotado, carrito lateral y completo, compra dinámica, cupón y checkout invitado en un tema de prueba. No hay acceso al Admin ni a un tema de vista previa desde este repositorio.
3. **Medición posterior:** publicar en un tema de prueba, repetir Lighthouse móvil tres veces en portada, colección y ficha, y revisar LCP/CLS y la cascada de red. Investigar la demora de renderizado del hero si persiste después de servir WebP.
4. **Contenido y configuración:** configurar el Instagram real, revisar las fechas y promesas de ingredientes/conservación de cada producto y decidir qué idiomas están publicados antes de traducir la interfaz DS. El JSON-LD ahora incorpora el logo de respaldo y omite enlaces `sameAs` vacíos; faltan las URLs sociales reales. El ajuste huérfano de contraseña se retiró.
5. **Advertencias heredadas:** Theme Check inspeccionó 181 archivos y encontró ocho advertencias, cero errores. Incluyen nombres de variables, un `seo_media` sin uso, complejidad del fragmento de filtros y fragmentos detectados como huérfanos porque se llaman desde Liquid guardado en JSON. `offset: continue` es sintaxis Liquid válida aunque el analizador la señale.

## Verificaciones ejecutadas

- Theme Check: **181 archivos, 8 advertencias, 0 errores**.
- Parseo de **67 archivos JSON** en templates, sections, config y locales.
- `node --check` de `assets/ds-motion.js` y `assets/product-info.js`.
- `git diff --check` sin errores de espacios.
- Cabecera HTTP y HTML de la portada pública; Lighthouse móvil sobre la versión publicada.

La guía de Shopify para imágenes recomienda `srcset`/`sizes`, carga inmediata y prioridad alta solo para la imagen LCP, y usar preload con moderación: [rendimiento de temas](https://shopify.dev/docs/storefronts/themes/best-practices/performance), [preload](https://shopify.dev/docs/storefronts/themes/best-practices/performance/use-preload-resource-hints-sparingly).
