# Verificación de la maqueta interactiva

Fecha: 3 de noviembre de 2026. Alcance: fragmento `celebraciones-recorrido.html`, no tema Shopify.

- `node --check recorrido-script.js`: correcto.
- 14 comprobaciones en navegador: correctas. Cubren dos pisos con selecciones independientes, combinación de tamaños propuesta por la pastelera, persistencia al avanzar/volver, nombre requerido, correo de demostración válido, mínimo de 24 horas, umbrales de 72 y 168 horas, contenido del resumen, final sin envío/cobro, color fijo del ganache, un piso en catálogo y ausencia de desbordamiento desktop.
- Archivo de imagen seleccionado mediante el control real: previsualización cargada, ancho natural 480 px.
- Anchos medidos sin desbordamiento: 1024, 390 y 320 px.
- Revisión visual: 690 px en dos columnas y 390 px en una columna. La captura de 1024 px de Orca presentó repetición de mosaicos y no se considera una comprobación visual válida a ese ancho.
- Consola consultada: sin entradas de error.
- `node tests/check-theme.mjs`: 37 JS, 67 JSON y 52 esquemas correctos.

La envoltura `recorrido-browser.html` permite inspeccionar el fragmento fuera del iframe del visor. También se abrió el fragmento con la envoltura oficial de visualización y se comprobó su renderizado. No se probó la persistencia de estado del host real; el código la usa solo si está disponible y nunca guarda fotos, comentarios ni contacto.

La dirección, capacidad real, servicios de pago, catálogo con múltiples unidades, panel y seguimiento aún no forman parte de este fragmento. No se envió información a Shopify ni se publicó.

Seguimiento/pastelera: node --check y check-theme correctos. Pruebas DOM: propuesta no altera total hasta aceptación; 170-90=80; mantener precio; 70-90 muestra diferencia20; comentarios escapados y atribución por rol; historial4 versiones. Revisadas capturas390 y690. Maqueta local sin integración Shopify.

