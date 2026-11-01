# QA de integración Shopify · opción 1 · 2026-11-01

**final result: passed**

## Referencia y evidencia

Fuente visual: `docs/redesign/opcion-1/index.html`, `style.css`, `textos.md` y `qa/textos-desktop.png`. La opción 1 y los textos ya estaban elegidos por Milton; no se creó otra dirección de diseño.

Implementación: tema Shopify sin publicar `189782163760`, **DS - Opcion 1 integrada - QA 20261101**. Vista previa: https://dayanassweet.com/?preview_theme_id=189782163760 . Se comprobó el ID renderizado y su rol `unpublished` en portada, búsqueda, producto y colección.

Evidencia conjunta, dentro de `docs/redesign/opcion-1/qa/`:

- `integracion-comparacion-final.png`: referencia e implementación juntas, vista inicial y detalle de menú/categorías; capturas de origen de 1260 × 800 CSS px, densidad 1. Detalle con scrollY 500; el menú queda a 226 px del borde superior de ambas capturas. La lámina final se renderizó en el navegador a 1374 × 883; las dos fuentes se escalan por igual, sin modificar las imágenes originales.
- `integracion-comparacion-mobile.png`: referencia e implementación de 390 × 844 CSS px, densidad 1, mostradas con la misma escala dentro de una lámina de 1260 × 800.
- Capturas individuales `integrada-desktop.png`, `integrada-menu-desktop.png`, `integrada-mobile-390.png`, `integrada-mobile-menu.png`, `integrada-mobile-320.png` e `integrada-producto-mobile.png`. Referencias nuevas: `integracion-referencia-desktop.png`, `integracion-referencia-menu.png` e `integracion-referencia-mobile-390.png`.

La barra negra de vista previa pertenece a Shopify y no al diseño de la tienda. Se excluyó de la comparación de producto. La primera captura de 1260 × 1000 excedía el área visible del navegador de Orca y se descartó; las capturas válidas posteriores usan 800/844/740 px de alto.

## Superficies revisadas

| Superficie | Resultado |
| --- | --- |
| Tipografía | Mismos archivos locales DM Serif Display y Montserrat. Titular de tres líneas, cursiva rosa y cuerpo con los saltos de la referencia. Los componentes internos de Dawn reciben las mismas familias. |
| Composición | Cabecera de 96 px, hero de 500 px y banda de 130 px en escritorio. Categorías a dos columnas; en móvil, foto seguida del texto y categorías a una columna. Sin desbordamiento horizontal en 1260, 390 ni 320 px. |
| Color | Papel `#fff7fa`, rosa `#d03a67`, banda `#f8d4e3`, tinta `#3a2430`, botón blanco sobre rosa. Foco visible y estado cerrado coherente con el panel. |
| Imágenes | Se copiaron las fotos, logo e iconos existentes de la propuesta. Imágenes del hero y categorías cargadas y verificadas por `naturalWidth`; sin placeholders. Las fotos son las generadas para la propuesta y siguen siendo reemplazables desde el editor. |
| Contenido | Presentación y CTA elegidos aplicados. Banda cerrada lee el aviso central del panel, más breve que el del HTML: cambio deliberado para mantener el mismo aviso en todas las rutas. El pie usa contacto y políticas reales; ya no dice prototipo. |

## Hallazgos y correcciones

1. **P2, intro del menú en una línea demasiado larga.** Primera implementación conservaba el texto sin el salto del HTML y alteraba la alineación del botón. Se limitó ese párrafo a 240 px en escritorio. Comparación final conjunta: recupera dos líneas y la alineación de la referencia. Móvil conserva las reglas de su breakpoint.
2. **P2, reset de movimiento global.** La revisión independiente detectó que el reset copiado del prototipo quitaba la transición del drawer de Dawn y su ciclo de foco. Prueba nueva falló antes de corregirlo; reset limitado a componentes `ds-r-*`, prueba aprobada. Se mantiene la transición nativa del drawer. No se modificó Dawn para ocultar el problema.
3. **P2, modo de notificación omitido.** La cabecera anterior renderizaba `cart-notification` y sus assets; la nueva no. Prueba RED/GREEN y render/estilos/script condicionales trasladados al layout. Se seleccionó temporalmente notification solo en el tema de prueba: DOM, custom element y stylesheet reales presentes. Se restauró drawer y una descarga nueva confirmó la restauración.

La lámina inicial de detalle tenía scroll distinto entre las dos fuentes; se descartó esa comparación y se recapturó la referencia con scrollY 500. La lámina final corresponde al mismo encuadre. No quedan hallazgos P0/P1/P2 en la integración evaluada.

## Interacciones verificadas en Shopify

- Cómo pedir abre las instrucciones de tres pasos y su CTA enfoca el campo de correo.
- Menú móvil abre; pasar de su navegación a Cómo pedir y cerrar con Escape devuelve el foco al botón visible Abrir menú.
- Búsqueda con texto: Escape cierra y devuelve foco a Buscar. Envío real de búsqueda `tomate` navega a `/search?q=tomate&type=product` y muestra Tomate Confitada como resultado.
- Carrito Dawn abre con aviso cerrado y foco dentro del drawer, y Escape permite cerrarlo. Se comprobó el estado de clase y el elemento enfocado; durante automatización se volvió a seleccionar la pestaña antes de interpretar una captura o referencia desactualizada.
- Suscripción: formulario real POST `/contact`, validación nativa al estar vacío, sin mensaje de éxito inventado. No se enviaron correos válidos ni se probó una suscripción real o su entrega; el éxito del servidor está cubierto por el render condicional de Liquid.
- Colecciones reales `/collections/galletas` y `/collections/brownies`; colección Galletas revisada en móvil. Producto Tomate Confitada con cabecera nueva, aviso cerrado y cero botones de compra habilitados.
- Consola consultada: entradas informativas de Shopify/HotReload y hCaptcha; sin errores capturados en la consulta.
- Movimiento reducido: regla CSS aislada y regresión cubierta por prueba. No se emuló esa preferencia en el navegador, porque la interfaz de Orca usada no expone ese control documentado.

## Validación y límites

- 44 pruebas aprobadas, 0 fallos: `node --test tests/*.test.mjs` con LiquidJS temporal externo al tema.
- `node tests/check-theme.mjs`: 38 JavaScript, 67 JSON y 55 esquemas válidos.
- Theme Check sobre el directorio desplegable: 0 errores y 8 advertencias heredadas. No se desactivaron checks. La prueba temporal del modo notification encontró un BOM introducido por PowerShell en el archivo temporal; se corrigió guardándolo sin BOM y la carga estricta posterior pasó.
- Subidas únicamente al nuevo tema sin publicar. El tema activo sigue siendo `189776789808`; el ligado a GitHub `main`, `188534653232`, sigue en la biblioteca sin publicar. No hubo otro cambio en vivo, commits ni push.

El alcance visual aprobado define la portada y la navegación. Las fichas, catálogo y carrito conservan los componentes comerciales de Dawn con la tipografía y paleta compartidas; no se afirma un rediseño específico adicional de esas pantallas. Catálogo, precios, productos de prueba y fotos definitivas no se modificaron.

## Entrega para GitHub

Los archivos están en la rama de trabajo `jAlexander15c/auditoria-bloques-20261028`; `git fetch origin` confirmó que su base y `origin/main` aún coinciden en `25f82bb`. Los cambios del tema anteriores a esta integración también están sin commit en esa rama: una entrega posterior debe incluir el contenido de tema efectivamente probado, preservando la documentación y cambios ajenos.

Para restaurar el flujo GitHub → Shopify, tras la autorización específica para el push a main se debe integrar el tema revisado, comprobar su sincronización en el tema conectado a `main` (`188534653232`) y publicarlo, conservando el respaldo actual. Un push por sí solo no vuelve a activar ese tema: quedó sin publicar en el cambio anterior. No se modificó la conexión de GitHub ni ninguna credencial.

## Pendientes ajenos a esta integración

Fechas reales; catálogo definitivo (aún contiene productos «PRUEBA»); confirmación o sustitución de fotos de la propuesta; instrucciones de cuidado dentro de los empaques a cargo de Milton. Sin cambios a inventario, pagos, transporte o checkout.
