# Administrar pedidos y fechas de envío

**Estado actual:** publicado el 1 de noviembre de 2026, por petición expresa de Milton («subelo a live»). El tema activo es `189776789808`. El anterior, `188534653232`, permanece sin publicar como respaldo. Los pedidos siguen cerrados y las fechas vacías. [Abrir el editor del tema publicado](https://2n36xt-3a.myshopify.com/admin/themes/189776789808/editor). La descripción siguiente conserva el registro de preparación y pruebas anterior a la publicación.

Los controles están preparados en el tema local y cargados en el tema sin publicar **DS - Pedidos envios - QA 20261101** (ID `189776789808`). [Abrir el editor del tema de prueba](https://2n36xt-3a.myshopify.com/admin/themes/189776789808/editor). La ruta es **Ajustes del tema → DS · Pedidos y envíos**. El acceso lo protege la cuenta administrativa de Shopify; no se crea otro panel ni contraseña. Se comprobó el guardado de una apertura de prueba desde el editor y su posterior borrado, verificado descargando los ajustes de Shopify. Quedó cerrado y sin fechas configuradas.

## Uso habitual

1. Con **Pedidos abiertos** desactivado, puedes mantener la web visible con los pedidos cerrados y dejar las fechas vacías.
2. Si quieres anunciar la próxima apertura, escribe su fecha en **Próxima apertura**. Ese campo es informativo y no abre pedidos automáticamente.
3. Antes de abrir, completa **Cierre de pedidos**, incluyendo hora y «hora de Houston», y **Fecha de envío**. Se escriben como quieres que aparezcan ante el cliente. Ejemplo de formato: «viernes 6 de noviembre, 8 p. m., hora de Houston». El ejemplo no es una fecha de venta confirmada.
4. Revisa los productos e inventario en Shopify y activa **Pedidos abiertos** cuando corresponda. Guarda los cambios del editor. Si falta cierre o envío, la interfaz permanece cerrada aunque marques el interruptor.
5. Para cerrar, desactiva **Pedidos abiertos** y guarda. Coordina el cierre con el stock de los productos.

La fecha de envío indica el día en que los pedidos salen de Houston. No es una garantía de llegada.

## Información compartida

Las fechas proceden de los mismos ajustes en la sección de pedidos de la portada, el encabezado de colección, la ficha de producto y el carrito. La barra de anuncios usa los mismos valores mediante los marcadores del tema. Las filas de fechas pendientes y los mensajes que dependen de una fecha pendiente se ocultan.

**Mensaje con los pedidos cerrados** controla el aviso de portada, compra de producto, colección y carrito. La barra configurada lo lee con `[mensaje_cerrado]`. El contador heredado usa ese mismo aviso al vencer.

Marcadores disponibles para los textos del editor:

| Marcador | Valor |
| --- | --- |
| `[apertura]` | Próxima apertura |
| `[cierre]` | Cierre de pedidos |
| `[envio]` | Fecha de envío |
| `[mensaje_cerrado]` | Aviso compartido de pedidos cerrados |
| `[pedidos]` | Nombre opcional de la apertura |

Los marcadores antiguos `[tanda]`, `[horneado]` y `[despacho]` siguen funcionando con sus ajustes anteriores. Si un texto depende de un valor pendiente, se omite ese texto completo. No añadas nombres o preparación opcionales a una frase imprescindible si los vas a dejar vacíos.

## Opciones avanzadas

El nombre de la apertura y el día de preparación son opcionales. Los campos principales bastan para la operación manual.

El **Cierre exacto de la interfaz** conserva el comportamiento heredado del contador. Se puede dejar vacío. Si se utiliza, requiere una fecha ISO 8601 con el desfase correcto de Houston y debe coincidir con el cierre anunciado. Al vencer, la interfaz se presenta cerrada en nuevos renderizados; una página ya abierta muestra el aviso del contador. Este ajuste no programa una apertura ni modifica el inventario.

## Límites de esta entrega

El control del tema cambia la interfaz y sus botones; no es un bloqueo del checkout ni modifica productos o inventario. Para impedir compras por enlaces directos, el cierre real debe coordinarse con stock 0 y la configuración de inventario de Shopify. No se cambian tarifas, pagos o reglas de envío.

El rediseño HTML elegido continúa como prototipo separado; estos controles están implementados en las secciones Liquid existentes y se reutilizarán al integrar ese diseño en Shopify. La entrega se cargó solo al tema de prueba y no se publicó. [Abrir la vista previa](https://dayanassweet.com/?preview_theme_id=189776789808). Las instrucciones de cuidado y conservación dentro del empaque quedan a cargo de Milton.

## Comprobaciones locales

Pruebas de renderizado con LiquidJS 10.30.1, instalado como herramienta externa al tema. Ejemplo en PowerShell, desde la raíz del worktree:

```powershell
$ordersQaRoot = Join-Path $env:TEMP 'dayanas-orders-qa-20261101'
npm.cmd install --prefix $ordersQaRoot --no-save --package-lock=false liquidjs@10.30.1
$env:DS_QA_ROOT = $ordersQaRoot
node --test tests/orders-settings.test.mjs
node tests/check-theme.mjs
node tests/render-orders-preview.mjs
```

No se añade un build ni dependencias de ejecución al tema. La última orden genera `docs/redesign/opcion-1/qa/pedidos-envios.html`, una muestra local de solo lectura que utiliza los ajustes y Liquid reales. No guarda nada en Shopify. La vista previa real comprobó valores de fechas de ejemplo y su restauración a pedidos cerrados; no se crearon pedidos ni pagos. También se verificó el guardado y borrado desde los controles del editor, después de que Milton completó el acceso.

La implementación sigue los [ajustes nativos de temas de Shopify](https://shopify.dev/docs/storefronts/themes/architecture/settings/input-settings).
