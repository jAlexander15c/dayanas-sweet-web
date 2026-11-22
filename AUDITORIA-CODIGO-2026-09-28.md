# Auditoría de código y optimización — 28 de septiembre de 2026

**Actualización:** los 11 hallazgos de este informe ya tienen correcciones locales. También se optimizó la carga de recursos de rieles y temporadas vacías y se añadieron pruebas reproducibles. Véase [ENTREGA-WEB-CORRECCIONES.md](ENTREGA-WEB-CORRECCIONES.md) para el estado de validación y entrega. El texto siguiente conserva la evidencia de la auditoría inicial.

Revisión del tema Shopify en el commit `f40d571`, con dos agentes de Codex para JavaScript y Liquid. No se utilizó Claude. Se revisaron el código local, la configuración y las auditorías anteriores. Este informe no modifica el tema ni implica publicación.

## Resultado

La sintaxis está en buen estado, pero hay defectos funcionales en las cantidades y el feedback de compra, una actualización redundante del carrito y opciones del editor desconectadas de las tarjetas DS. Corregir estas rutas aporta más valor inmediato que una refactorización general de Dawn.

Se identificaron **7 hallazgos de prioridad media (P2)** y **4 de prioridad baja (P3)**. Algunos dependen de una configuración específica; se indica en cada caso. No se confirmaron bloqueos críticos en esta revisión. Eso no equivale a una validación completa del checkout ni de la tienda publicada.

## Hallazgos prioritarios

### 1. P2 — Las reglas de cantidad se calculan antes de actualizar la variante

**Ubicación:** `assets/product-info.js:398–413`; caso adicional en `:373`.

`updateQuantityRules()` ejecuta `setQuantityBoundries()` antes de copiar `data-min`, `data-max`, `data-cart-quantity` y `step` recibidos del servidor. El input y sus suscriptores utilizan las reglas anteriores.

**Evidencia:** ejecución aislada de los métodos originales en Node/VM: al pasar de mínimo 1/máximo 10 a mínimo 3/máximo 6/incremento 3, el resultado mantiene `min=1`, `max=10` y `value=1`, aunque el dataset ya contiene las reglas nuevas. Además, `if (max)` elimina el límite cuando la capacidad restante es cero: queda `min=0/value=0`, sin atributo `max`.

**Impacto:** cantidades inválidas, botones desincronizados y rechazos evitables al agregar. Depende de reglas de cantidad o de cantidades previas en el carrito.

**Corrección:** copiar primero los atributos, recalcular después y publicar `quantityUpdate` al terminar. Distinguir ausencia de máximo (`null`) de máximo cero y tratar explícitamente el caso sin capacidad restante.

**Aceptación:** cambiar entre variantes con mínimos/incrementos distintos; repetir con el máximo ya alcanzado en el carrito. Verificar valor, límites, botones y mensaje visible.

### 2. P2 — Los errores de red al agregar no llegan al comprador

**Ubicación:** `assets/product-form.js:108–112`; `assets/ds-motion.js:415`; `snippets/ds-product-card.liquid:90`.

El `catch` registra el error y emite un evento estándar, pero no llama a `handleErrorMessage()` ni publica `PUB_SUB_EVENTS.cartError`. El tema no contiene un consumidor visual de ese evento estándar. Las tarjetas DS ocultan el error nativo y dependen del pubsub para mostrar su aviso.

**Impacto:** después de un fallo de conexión desaparece el indicador de carga sin explicar si se agregó el producto. La persona puede reintentar sin conocer el estado real del carrito.

**Corrección:** unificar el feedback visible de errores de transporte y respuestas de error de Shopify, conservando los eventos de analítica. Si la conexión se perdió después de procesar la solicitud, evitar afirmar que el carrito no cambió.

**Aceptación:** bloquear la solicitud de adición en una vista previa y comprobar mensajes accesibles tanto en ficha como en tarjeta, recuperación del botón y reintento. Hallazgo confirmado por seguimiento del código; no se realizó una compra real.

### 3. P2 — Dos adiciones simultáneas pierden o asignan mal el feedback

**Ubicación:** `assets/ds-motion.js:348–356`, `:380`.

Un único `lastCardForm` representa todas las solicitudes. Enviar B reemplaza la referencia a A antes de que responda el servidor. La comparación de variante descarta la respuesta de A; si ambas tarjetas tienen la misma variante, puede marcar la tarjeta equivocada.

**Evidencia:** ejecución del script original en VM: enviar A, enviar B y emitir error de A deja oculto el aviso de A. El error de B sí se muestra.

**Corrección:** incluir el identificador del formulario y de la solicitud en los eventos de `product-form`. Actualizar el origen exacto de cada operación, sin depender del último formulario enviado.

**Aceptación:** respuestas en orden inverso, una adición correcta y otra rechazada, y la misma variante mostrada en dos secciones.

### 4. P2 — El carrito se vuelve a descargar y renderizar tras recibirlo

**Ubicación:** `assets/product-form.js:80–104`; `assets/cart.js:38–40`, `:113–126`.

La respuesta de adición ya incluye `sections`, que `renderContents()` utiliza. A la vez, `cartUpdate` dispara otra descarga de `?section_id=cart-drawer` y otro reemplazo de sus elementos.

**Impacto confirmado por código:** con el carrito lateral montado, una petición adicional de sección y trabajo DOM redundante por adición. También se recrean componentes y suscripciones. **Riesgo pendiente de prueba en navegador:** una respuesta antigua de ese GET puede sustituir temporalmente un cambio posterior; no existe control de secuencia en esa ruta.

**Corrección:** asignar un único responsable al render de cada sección. Reutilizar `cartData.sections` cuando exista y reservar el GET para eventos que no traigan HTML. Descartar respuestas obsoletas. No confundir este GET redundante con la consulta de datos del carrito usada por los eventos estándar.

**Aceptación:** inspeccionar Network y comprobar una sola actualización del cajón por adición, sin perder actualización de la burbuja, totales ni página completa de carrito. Retrasar respuestas y cambiar cantidad para verificar consistencia.

### 5. P2 — La colección ignora el ajuste de compra rápida

**Ubicación:** `sections/main-collection-product-grid.liquid:10–23`, `:171`; `snippets/ds-product-card.liquid:87–107`; `templates/collection.json:14`.

La plantilla actual establece `quick_add: "none"`, pero la tarjeta DS siempre muestra Agregar o Elegir cuando el producto está disponible y la tanda abierta. El ajuste no se pasa al snippet. Seleccionar `bulk` carga cuatro scripts aunque la tarjeta no renderiza sus componentes.

**Impacto:** el editor promete un comportamiento que no cumple; la modalidad bulk añade carga sin proporcionar su funcionalidad.

**Corrección:** definir explícitamente las modalidades soportadas por DS y conectar el ajuste al snippet. Si la compra directa actual es la deseada, migrar la configuración de forma explícita en lugar de mantener `none` sin efecto. Retirar o implementar las opciones incompatibles y cargar recursos según el marcado real.

**Aceptación:** comprobar cada modalidad en el editor y su HTML, incluidos productos con variantes, agotados y tanda cerrada.

### 6. P2 — La imagen secundaria se emite aunque esté desactivada

**Ubicación:** `templates/collection.json:11`; `snippets/ds-product-card.liquid:65–66`; `assets/ds-conversion.css:6–12`.

La configuración establece `show_secondary_image: false`, pero el snippet emite la segunda imagen siempre que exista. Solo se muestra mediante hover con puntero preciso; aun así, también está presente en móviles.

**Impacto:** solicitudes potencialmente innecesarias para cada tarjeta con segunda imagen. `loading="lazy"` no asegura que una imagen transparente situada dentro del viewport permanezca sin descargar. La magnitud debe medirse en la cascada de red; no se atribuye un ahorro de bytes ni de LCP sin esa medición.

**Corrección:** pasar y respetar `show_secondary_image`. Para dispositivos sin hover, evaluar una carga bajo demanda si se conserva el efecto en escritorio.

**Aceptación:** con el ajuste apagado no debe existir la imagen alternativa en el HTML. Con el ajuste encendido, validar hover, navegación táctil y solicitudes de imágenes.

### 7. P2 — Las repeticiones del anuncio pueden conservar enlaces enfocables ocultos a lectores de pantalla

**Ubicación:** `assets/ds-motion.js:40–49`, `:52–53`, `:65`; `sections/ds-announcement.liquid:35–39`.

Para llenar una barra ancha, `fill()` copia mensajes dentro del primer grupo y les asigna `aria-hidden="true"`. Los enlaces de esas copias mantienen su capacidad de recibir foco. Solo el segundo grupo recibe `inert` y `tabIndex=-1`.

**Condición:** mensaje con enlace, contenido más corto que el viewport y movimiento permitido. Los mensajes configurados actualmente no tienen enlaces, por lo que el defecto es latente.

**Corrección:** hacer inertes también las copias del primer grupo o excluir sus controles del foco, conservando un único conjunto interactivo accesible.

**Aceptación:** configurar un anuncio corto con enlace, abrir a ancho de escritorio y recorrerlo con Tab. Cada enlace original debe aparecer una sola vez en el recorrido. Evidencia estructural; pendiente la prueba con lector de pantalla.

## Hallazgos secundarios

| Prioridad | Ubicación | Problema y corrección |
| --- | --- | --- |
| P3 | `sections/ds-product-rail.liquid:18–45` | Se decide si mostrar productos y flechas con el total de la colección, antes de excluir el producto actual. Una colección que solo contiene ese producto deja un riel vacío sin su mensaje alternativo. Calcular sobre los productos efectivamente mostrados. |
| P3 | `sections/ds-contact.liquid:10–36` | IDs fijos en una sección que admite varias instancias. Al duplicarla, etiquetas y enlaces de error pueden apuntar al primer formulario. Incorporar `section.id` a IDs y referencias. |
| P3 | `sections/ds-social.liquid:16` | Todos los errores de Shopify se presentan como falta de @ o dominio, aunque pueden tener otra causa. Mostrar los mensajes y campos de `form.errors`. |
| P3 | `snippets/product-media.liquid` — dos usos de `inline_asset_content` | Se solicita `icon-3d-model`, pero el asset existente se llama `icon-3d-model.svg`. Corregir ambas referencias y comprobar un producto con modelo 3D. No afecta a productos que solo tienen fotos. |

## Optimización y mantenimiento posteriores

1. **Dividir CSS por componentes cuando lo justifique la medición.** Las cuatro hojas globales de `layout/theme.liquid:289–292` suman **124.158 bytes de origen**, antes de compresión HTTP: base 85.082, premium 21.388, conversión 13.039 y cabecera 4.649. `ds-premium.css` mezcla marca compartida con portada, y `ds-conversion.css` mezcla tarjetas, ficha y carrito. Extraer bloques específicos puede reducir CSS innecesario, pero requiere medir Coverage y preservar el orden de la cascada. Estas cifras no representan transferencia de red ni ahorro garantizado.
2. **Mover recursos de secciones vacías dentro de su condición de renderizado.** `sections/ds-season.liquid:1–4` emite recursos aunque no tenga colección. Revisar también la necesidad de `quick-add.css` en tarjetas DS. La caché evita ciertas transferencias repetidas; etiquetas repetidas no equivalen automáticamente a descargas completas repetidas.
3. **Añadir una comprobación reproducible de calidad.** El repositorio no incluye un comando de validación ni CI versionado. Conviene fijar la versión de Shopify CLI y automatizar Theme Check, sintaxis JS y parseo de JSON/esquemas. Añadir pruebas de comportamiento para cantidades, errores y concurrencia; evitar tests que solo copien la implementación.
4. **Mantener separadas las mejoras medidas y las hipótesis.** Conservar WebP responsivo y la prioridad de la primera imagen, ya presentes. Medir portada, colección y ficha en la misma vista previa y condiciones antes/después. La recomendación de carga por posición y prioridad de la imagen LCP coincide con la [guía oficial de rendimiento de Shopify](https://shopify.dev/docs/storefronts/themes/best-practices/performance).

## Validaciones realizadas y límites

- **37 archivos JavaScript:** `node --check`, sin errores.
- **67 archivos JSON:** parseo correcto en config, locales, sections y templates.
- **52 esquemas Liquid de secciones:** JSON válido.
- **Shopify Theme Check:** ejecución actual completada; **0 errores y 8 advertencias**.
- **`git diff --check`:** sin errores de espacios.
- Reproducciones aisladas con Node/VM para las reglas de cantidad y el feedback concurrente; revisión de rutas de ejecución para los demás hallazgos.

Las ocho advertencias de Theme Check incluyen tres snippets considerados huérfanos, dos nombres de variable, complejidad del snippet de filtros, un `seo_media` sin uso y `offset: continue`. Dos de los supuestos huérfanos (`ds-product-batch` y `ds-sticky-buy`) sí se invocan desde Liquid guardado en `templates/product.json`: no deben eliminarse por esa advertencia. No se recomienda alterar `offset: continue` solo para silenciar el analizador.

No se ejecutó Lighthouse nuevo, no se navegó una vista previa de este commit y no se probó checkout real. Las cifras de rendimiento de la auditoría anterior pertenecen a otra ejecución y no se presentan como resultado actual. El cierre de tanda en el tema sigue siendo una regla de interfaz, ya documentada en la auditoría previa; no se cuenta como hallazgo nuevo.

## Orden de implementación recomendado

1. Corregir cantidades y feedback de errores/concurrencia, con pruebas focalizadas.
2. Eliminar el render redundante del carrito y validar respuestas fuera de orden.
3. Conectar opciones del editor y carga de imágenes secundarias.
4. Resolver accesibilidad y casos secundarios.
5. Medir y, según los resultados, dividir CSS y ajustar cargas por sección.

El entregable de esta auditoría es este informe. El código del tema permanece sin cambios; no se hizo commit, push ni publicación.
