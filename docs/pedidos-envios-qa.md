# Validación de pedidos y envíos del 1 de noviembre de 2026

## Publicación posterior autorizada

Después de completar el editor, Milton pidió «subelo a live». Se publicaron los archivos ya revisados del tema `189776789808`, sin cambios adicionales de código y sin push a GitHub. La CLI confirmó `status: success`, `role: live`. La lista posterior confirmó el tema anterior `188534653232` como `unpublished`; se conserva para reversión y también se descargó una copia local de sus 386 archivos antes de publicar. Recibos: `pedidos-envios-publicado.json`, `pedidos-envios-themes-after-publication.json` y rutas de copias en `pedidos-envios-publicacion-paths.json`.

Antes de publicar se repitieron las 20 pruebas (20 aprobadas), la comprobación de 37 JS, 67 JSON y 52 esquemas y Theme Check sobre una descarga nueva del candidato (0 errores, 8 advertencias). Los 386 archivos descargados coinciden con el contenido revisado, salvo normalizaciones del editor: colores hexadecimales en minúsculas y objetos/listas vacíos añadidos por Shopify. No hubo diferencias de comportamiento; informe `pedidos-envios-prepublish-verification.json`. Se confirmó de nuevo el estado cerrado y las cinco fechas vacías.

Después de publicar, la portada pública y el producto Tomate Confitada mostraron `Shopify.theme.id = 189776789808` y `role = main`. Revisión de escritorio 1260 × 800 y móvil 390 × 844: aviso cerrado visible, sin desbordamiento horizontal; producto con cero botones de compra habilitados. Capturas `qa/shopify-live-desktop.png` y `qa/shopify-live-mobile.png`, dentro del prototipo; datos `pedidos-envios-live-product-verification.json`. El navegador de administración conserva su barra de vista previa de la sesión anterior; el rol público y la lista remota confirman la publicación.

La publicación no integra el rediseño HTML completo ni modifica productos, inventario, pagos o envíos. El catálogo aún muestra productos cuyo nombre contiene «PRUEBA»; no se editaron. El tema anterior conectado a GitHub `main` permanece en la biblioteca, y no se modificó su conexión. Las secciones siguientes documentan la preparación anterior a esta autorización.

Implementación local de los controles nativos del tema, con estado inicial cerrado y fechas reales pendientes. El 1 de noviembre Milton autorizó completar la revisión y cargar un tema de prueba sin publicar («Haz todo eso»). No hubo commits, push a GitHub, publicación ni modificaciones al tema en vivo.

## Resultados

- `node --test tests/orders-settings.test.mjs`: 20 pruebas aprobadas, 0 fallos. Incluyen dos casos añadidos para el aviso de carrito vacío y su preparación antes de eliminar el último artículo.
- `node tests/check-theme.mjs`: 37 JavaScript, 67 JSON y 52 esquemas válidos.
- Renderizado de muestras desde el Liquid real: generado en `docs/redesign/opcion-1/qa/pedidos-envios.html`. Incluye controles leídos del esquema, estado inicial sin fechas, apertura informativa y pedidos abiertos con fechas exclusivamente de ejemplo.
- Shopify CLI 5.0.0 instalada como herramienta temporal, fuera del repositorio. Theme Check pasó sobre el paquete de archivos de tema que se cargaría: 0 errores, 8 advertencias. Reporte completo: `pedidos-envios-theme-check-deployable.json`. Las advertencias corresponden a snippets que el análisis estático no encuentra referenciados, nombres de variables, complejidad de facets y dos avisos de `main-product`. No se ocultaron ni desactivaron comprobaciones.
- La primera ejecución en la raíz también revisó JSON de informes internos en `docs/` y reportó 6 errores de esos documentos. Para comprobar el contenido real del despliegue se preparó un directorio separado con las siete carpetas válidas del tema; el resultado de ese contenido es el anterior, sin errores. No se editaron los informes antiguos para silenciar el análisis.
- Revisión independiente: detectó dos problemas P2, corregidos y cubiertos por pruebas que primero fallaron y después pasaron: FAQ vacía al omitir campos opcionales y contador con mensaje cerrado fijo. FAQ ahora oculta preguntas sin respuesta renderizada y abre la primera visible. El contador lee el aviso central.

## Escenarios cubiertos

Estado no configurado; valores predeterminados de lanzamiento; interruptor manual; cierre o envío ausentes; pedidos abiertos con fechas completas; cierre exacto vencido y futuro; texto dependiente de fecha pendiente; aliases de fecha nuevos y heredados; escape de HTML; preparación opcional ausente; fechas ocultas con pedidos cerrados; apertura informativa sin abrir ventas; envío compartido en carrito; FAQ configurada sin respuestas vacías; mensaje central del contador; anuncios pendientes sin barra vacía; aviso cerrado escapado en anuncios.

## Revisión visual local completada

La revisión anterior mediante Chrome se detuvo al no poder verificarse la URL actual. En la continuación autorizada se utilizó el navegador integrado de Orca sobre el archivo local de la muestra, con una página propia identificada por su URL.

Se inspeccionaron las capturas en escritorio de 1260 × 800 y móvil de 390 × 844 y 320 × 740. Sin desbordamiento horizontal, confirmado con las medidas del DOM. Se comprobaron visualmente controles de muestra, estado cerrado sin fechas y fechas de apertura/envío en los ejemplos de portada, producto y carrito. Consola de esa página: sin entradas capturadas.

Evidencia en `docs/redesign/opcion-1/qa/`: `pedidos-envios-desktop.png`, `pedidos-envios-mobile.png`, `pedidos-envios-abiertos.png`, `pedidos-envios-mobile-abiertos.png`, `pedidos-envios-mobile-carrito.png`.

La muestra HTML es un artefacto local de solo lectura. Las comprobaciones remotas de la continuación se documentan a continuación y se distinguen de esta muestra.

## Tema de prueba y acceso a Shopify

Milton completó el flujo oficial de acceso de la CLI. La subida creó el tema `189776789808`, **DS - Pedidos envios - QA 20261101**, con rol `unpublished`, sin sobrescribir temas anteriores. La subida con `--strict` terminó correctamente y sin incidencias de carga. Recibo: `pedidos-envios-upload.json`.

Se confirmó antes y después que el tema en vivo sigue siendo `188534653232`, **dayanas-sweet-web/main**. No hubo publicación, push a GitHub, cambios al inventario, productos, tarifas o pagos.

El editor visual utiliza una sesión de navegador separada. Después de ayudar a Milton a encontrar la pestaña junto a la conversación, completó el acceso. Se abrió el grupo «DS · Pedidos y envíos», se revisaron sus etiquetas y se guardó una apertura de ejemplo con prefijo «PRUEBA» mediante el botón Guardar. Una descarga nueva de los ajustes remotos confirmó el texto guardado. Después se borró desde el mismo campo y se volvió a guardar; otra descarga confirmó pedidos cerrados y apertura, cierre, envío, preparación y cierre exacto vacíos. Evidencia: `pedidos-envios-editor-verified.json` y `qa/shopify-editor-pedidos-final.png`, dentro del prototipo. No se solicita ni guarda ninguna contraseña en el proyecto.

La captura del editor muestra sus controles y Guardar deshabilitado después de guardar. Su iframe de vista previa aparecía en blanco en esta sesión; la validación visual de la tienda se hizo por las rutas de vista previa directa descritas a continuación. No se atribuye a esta captura una revisión visual de la tienda incrustada.

## Pruebas sobre Shopify real

- La vista previa confirmó mediante sus datos públicos el tema exacto `189776789808` y su rol `unpublished`. Shopify retira el parámetro de la dirección al establecer la sesión de vista previa; se verificó el ID del tema renderizado para evitar confundirlo con el tema en vivo.
- Estado cerrado: aviso central correcto en portada, producto y colección; fechas pendientes ocultas. Producto Tomate Confitada: ningún botón de compra activo mientras está cerrado.
- Se probaron temporalmente cierre y envío con textos que empezaban por **PRUEBA**, solo en el tema sin publicar. La portada, colección y producto mostraron exactamente los mismos valores compartidos y cambiaron al estado abierto. Datos observados: `pedidos-envios-remote-scenario.json`. Captura: `qa/shopify-fechas-prueba.png`, dentro del prototipo.
- Después se restauró `config/settings_data.json` desde el archivo local inicial mediante una subida limitada a ese archivo y al mismo tema sin publicar. Se descargó de nuevo la configuración remota para verificar **pedidos cerrados y apertura/cierre/envío vacíos**. Evidencia: `pedidos-envios-restored-upload.json` y `pedidos-envios-remote-restored.json`. No quedaron fechas de prueba configuradas.
- También se descargaron los ajustes del tema remoto y se verificaron el grupo «DS · Pedidos y envíos» y sus cinco controles principales. Resumen: `pedidos-envios-remote-settings.json`. La interacción posterior con el editor y su guardado se documentan en el apartado anterior.
- Revisión real en escritorio y móvil de la vista previa: avisos y fechas legibles, sin desbordamiento horizontal en los anchos comprobados. No se agregaron artículos, se crearon órdenes ni se realizaron pagos.

## Corrección detectada en la prueba real

El aviso del carrito existía dentro de `drawer__footer`, que Dawn oculta al estar vacío. Se observó el aviso con altura 0 en el navegador. Se añadió su renderizado a la región visible de carrito vacío del drawer y de la página de carrito, conservando la instancia del footer para el carrito con artículos. La nueva prueba real del drawer mostró **visibility: visible y altura 66 px**. Captura: `qa/shopify-carrito-aviso.png`.

La revisión independiente de esas inserciones detectó que un guard `cart == empty` en la página no cubría la eliminación AJAX del último artículo. Se sustituyó por el parámetro `empty_notice: true`: prepara el aviso cerrado incluso con artículos y omite el texto de envío abierto en la región de vacío. Una prueba nueva falló antes de añadir ese comportamiento y después pasó; resultado final 20/20. No se modificó `cart.js`, checkout o inventario. Las correcciones se cargaron únicamente al tema de prueba; recibos `pedidos-envios-cart-fix-upload.json` y `pedidos-envios-cart-ajax-upload.json`.

Se preparó `dayanas-pedidos-envios-prueba-20261101.zip` con 386 archivos de `assets`, `config`, `layout`, `locales`, `sections`, `snippets` y `templates`. El ZIP usa rutas relativas y contiene pedidos cerrados y fechas vacías; excluye documentación, herramientas y credenciales. Tamaño y hash: `pedidos-envios-paquete.json`.

## Decisiones acotadas

- Fechas escritas y apertura manual para facilitar la operación; la apertura escrita no es programación automática.
- Pedidos cerrados en la interfaz hasta habilitar el interruptor y completar cierre/envío.
- Identificadores `ds_batch_*` conservados para compatibilidad; los nombres nuevos visibles usan «Pedidos y envíos».
- Omisión de textos con fechas pendientes para no publicar frases incompletas. Se revisó y corrigió su efecto en los acordeones FAQ.
- Conservación, tarifas y catálogo permanecen fuera de esta tarea. El inventario de Shopify sigue siendo el control real de disponibilidad.
