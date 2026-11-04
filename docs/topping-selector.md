# Selector obligatorio de topping

## Configuración y publicación

En **Personalizar tema → Productos → Producto predeterminado → Información del producto**, el bloque **Selector de opción obligatoria** está antes de los botones de compra. Selecciona el producto Brownie Box – Almendras & Chocolate y edita **Etiqueta**, **Nombre de la propiedad de línea**, **Opciones (una por línea)** y **Mensaje de error**. Mantén `Topping` como nombre para obtener `properties[Topping]`. El tema elimina `[` y `]`, espacios exteriores y todos los `_` iniciales del nombre para conservar una propiedad pública; si queda vacío usa `Topping`. No dejes la lista de opciones vacía. Ninguna opción viene seleccionada.

El bloque compara el ID del producto seleccionado con `product.id`: no se muestra en otros productos ni cuando el ajuste está vacío. No se cambió la asignación de plantilla. **Ocultar botones de pago dinámico** está activado: `buy-buttons.liquid` recorre los bloques de la sección y desactiva `show_dynamic_checkout` cuando encuentra este bloque para el producto actual. Así Shop Pay/Comprar ya no se renderizan en ese formulario; el pago desde el carrito continúa disponible. Desactivar ese ajuste vuelve a habilitar esos botones y debe validarse antes de usarlo.

Las tarjetas DS y Dawn (compra estándar y por volumen) y `buy-buttons` consultan el mismo snippet en modo `requires`. La etiqueta de producto **`requiere-opcion`**, editable en Productos → Etiquetas del administrador de Shopify, permite exigir una visita a la ficha sin cambiar código. Hay un fallback por handle `brownie-box-almendras-chocolate`, centralizado en `snippets/ds-topping-picker.liquid`, para que este producto quede cubierto desde ahora. **Si cambias el producto del bloque, añade la etiqueta `requiere-opcion` al nuevo producto y configura el selector en su plantilla**: seleccionar un producto en el bloque no actualiza etiquetas ni protege por sí solo otras secciones. Si se cambia el handle de este brownie, añadir primero la etiqueta. **No se añadió ninguna etiqueta ni se modificaron datos de Shopify**. Cuando un producto requiere opción y la sección no tiene un selector correspondiente, `buy-buttons` muestra el enlace **Elegir topping** a la ficha en lugar del formulario y no renderiza pago dinámico; esto cubre Producto destacado. Las tarjetas con compra rápida desactivada siguen sin mostrar CTA; las agotadas no muestran Elegir topping y ambas conservan tanda cerrada.

Todavía se conserva el variant picker existente y las tres variantes. El topping de la propiedad es una elección independiente de esa variante; cambiar variante no reinicia la elección. Hasta la migración puede aparecer el nombre de variante junto a la propiedad `Topping`, incluso con textos diferentes. **La migración posterior a una sola variante es la que unifica el inventario**, y requiere aprobación aparte. Publicar este cambio de tema junto con esa migración; este trabajo no publica nada.

## Formulario y carrito

Los radios usan `form="product-form-…"` aunque estén fuera del formulario. Dawn incluye esos controles en `FormData(form)`. Cuando el bloque aplica al producto, el formulario omite `novalidate`: sin JavaScript o antes de cargarlo, la validación nativa de `required` bloquea la compra sin topping. Con el componente cargado, el listener `invalid` en captura cancela el aviso nativo y muestra un único error propio con `role="alert"`, sin `aria-live` adicional, marca `aria-invalid` solo en el fieldset y enfoca el primer radio. También valida submit en captura. `product-form.js` verifica su validez antes de cargar o llamar a AJAX, incluso si se llama directamente al handler. Elegir un radio limpia el error. La barra fija móvil pulsa el botón principal, por lo que usa esa misma validación.

`snippets/cart-drawer.liquid` y `sections/main-cart-items.liquid` ya imprimen cada propiedad pública no vacía como `Topping: X`. No se modificaron. `assets/cart.js` cambia cantidad mediante línea y cantidad, sin reemplazar propiedades; sus eventos usan también `item.key`. Shopify distingue líneas con propiedades diferentes aun con el mismo ID de variante. La visualización final en checkout y pedido depende de Shopify y queda por verificar en una sesión real; el tema envía la propiedad al carrito sin transformarla.

## Verificación automatizada

- `node tests/check-theme.mjs`: sintaxis JS, JSON y esquemas.
- `node --test tests/topping-selector.test.mjs`: contrato Liquid por análisis estático y comportamiento del JavaScript real en un DOM mínimo simulado con Node, sin dependencias nuevas.
- Las pruebas no ejecutan Liquid de Shopify ni un navegador real, ni llaman al carrito de Shopify. La separación de líneas y la persistencia en checkout/pedido se comprueban en vista previa con la lista siguiente.

Resultado local del 2026-11-03, tras las correcciones A–H: `node tests/check-theme.mjs` pasó (39 archivos JavaScript, 67 JSON y 55 esquemas); `node --test tests/topping-selector.test.mjs` pasó (14/14); `git diff --check` pasó. La prueba de cambio de ID de variante es simulada y no ejecuta `product-info.js`. Los contratos de Liquid, incluido el saneamiento de nombres y la omisión de `novalidate`, se verifican estáticamente; no equivalen a renderizar Shopify. No se encontraron `shopify` ni `theme-check` en PATH, por lo que Theme Check no se ejecutó.

## Cambios por archivo

| Archivo | Cambio |
| --- | --- |
| `sections/main-product.liquid` | Tipo de bloque `ds_topping`, seis ajustes y render del snippet. |
| `templates/product.json` | Instancia para el brownie antes de `buy_buttons`, conservando `variant_picker`. |
| `snippets/ds-topping-picker.liquid` | Radios de propiedad sin elección inicial, comparación de ID, error accesible y detección central de tarjetas. |
| `assets/ds-topping-picker.css` | Pills con variables de Dawn, área mínima de 44 px, foco y movimiento reducido. |
| `assets/ds-topping-picker.js` | Validación de submit, error/foco, limpieza al elegir y liberación de listeners al retirar el bloque. |
| `assets/product-form.js` | Guarda mínima antes del envío AJAX usando controles asociados al formulario. |
| `snippets/buy-buttons.liquid` | Omite `novalidate` con selector aplicable, controla pago dinámico y enlaza a la ficha si falta selector local. |
| `snippets/ds-product-card.liquid` | Enlace a elegir topping en lugar de compra rápida para el producto requerido. |
| `snippets/card-product.liquid` | Enlace equivalente para compra estándar y por volumen de Dawn. |
| `locales/es.default.json` | Traducción `Elegir topping`. |
| `tests/topping-selector.test.mjs` | Catorce pruebas de contrato, validación, envío y compatibilidad de carrito. |
| `docs/topping-selector.md` | Configuración, decisiones, resultados y pendientes manuales. |

## Lista manual para una vista previa autorizada

- [ ] Desktop: en el brownie aparece el bloque antes de comprar; no hay radio elegido. Otro producto y un bloque sin producto seleccionado no muestran el selector.
- [ ] Desktop: intentar agregar sin topping muestra el mensaje configurado, no añade artículos y enfoca el primer radio. Elegir cualquiera limpia el error y permite agregar. Revisar que el request `/cart/add` lleve `properties[Topping]` con el valor elegido.
- [ ] Sin JavaScript y con carga diferida del componente: no se agrega sin topping; la validación nativa funciona antes de cargar y solo se muestra el error propio después de cargar.
- [ ] Producto destacado con brownie o producto etiquetado: muestra Elegir topping hacia su ficha, sin formulario de compra ni pago dinámico; otro producto mantiene su compra habitual.
- [ ] Nombre de propiedad: probar `[Topping]`, `__Topping`, `_Mi_Topping` y `[]___`; confirmar respectivamente `Topping`, `Topping`, `Mi_Topping` y el fallback `Topping` en el carrito.
- [ ] Mobile: pills con área táctil mínima de 44 px, texto sin cortes y foco visible; probar la barra fija de compra sin selección y con selección.
- [ ] Teclado/lector: Tab entra al grupo, flechas cambian la elección y Espacio selecciona; el error se anuncia y `aria-invalid` vuelve a `false` al elegir. Revisar con movimiento reducido activado.
- [ ] Cambiar variante después de elegir topping conserva la elección y permite agregar la variante elegida. Confirmar el mismo resultado después de migrar a una variante.
- [ ] Compra acelerada: no hay Shop Pay/Comprar ya para el brownie con el ajuste activado; otro producto conserva su configuración de botones dinámicos.
- [ ] Tarjetas del rail DS y colección, y tarjetas Dawn con compra estándar/por volumen: se muestra **Elegir topping**, enlaza al brownie y no permite agregar desde la tarjeta. Otro producto mantiene su comportamiento. Probar agotado/tanda cerrada sin romper sus estados.
- [ ] Carrito lateral: añadir dos cajas de la misma variante con toppings diferentes crea dos líneas, cada una muestra `Topping: X`; incrementar, reducir y eliminar una línea conserva la propiedad y no cambia la otra.
- [ ] Página de carrito: repetir cambio de cantidades y recargar; confirmar las propiedades y líneas separadas.
- [ ] Checkout: revisar `Topping: X` y cantidades en cada artículo, incluyendo navegación de vuelta al carrito.
- [ ] Pedido de prueba autorizado: confirmar `Topping: X` en los artículos del pedido en Shopify y en la preparación del pedido.

No se ejecutó vista previa remota, checkout ni pedido: no se proporcionó una sesión de vista previa y el alcance prohíbe subir el tema. Theme Check requiere la CLI de Shopify o `theme-check`; informar su disponibilidad real en la entrega.
