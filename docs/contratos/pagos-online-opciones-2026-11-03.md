# Opciones de anticipo online para celebraciones — 3 de noviembre de 2026

> **Actualización de alcance:** el usuario rechazó suscripciones adicionales y quiere cobrar mediante Shopify. La recomendación de apps que sigue se conserva como investigación previa, no como propuesta vigente. Véase la **adenda: alternativa propia sin otra suscripción**, al final.

## Conclusión

**La ruta con mejor respaldo documental para Shopify Basic es Downpay con un producto `Unlisted` por cotización, anticipo en el checkout del cliente y saldo mediante factura del mismo pedido.** Puede operarse manualmente por la chef, sin contratar la API de Downpay. Es una alternativa concreta para probar, no una integración verificada en esta tienda ni una autorización de instalación o gasto.

No se encontró una ruta pública demostrada que tome un importe libre del backend, cree un draft con anticipo online en Basic y cubra además todos los ajustes exigidos. **Depo es candidato para investigar/probar; su ficha comercial no basta para certificarlo.** No implementar dos pedidos de venta para simular anticipo/saldo.

Complementa [pagos-celebraciones-viabilidad.md](./pagos-celebraciones-viabilidad.md). Actualización de contexto recibido: sí existe una app custom instalada con `write_app_proxy`; no tiene permisos de pedidos/pagos. Ese dato se recibió del coordinador, no se comprobó consultando credenciales o el admin.

## Requisitos que no cambian

- Precio personalizado acordado; anticipo ordinario 60%, urgente 100%; saldo hasta 24 horas antes de la entrega.
- Tras un ajuste aceptado: conservar el dinero efectivamente recibido y calcular `saldo = max(totalNuevoAceptado - recibidoNetoConfirmado, 0)`. Nunca volver a cobrar un 60% del precio nuevo como si no existiera el primer pago.
- Cada pago lo inicia y termina el cliente. Aceptar una propuesta no carga una tarjeta. Tampoco debe hacerlo la chef ni un Flow, cron o API de cobro.
- Una venta/pedido con pagos asociados. Un segundo cobro no debe registrar otro pastel ni otro envío ni fingir un descuento del anticipo.
- Si el nuevo precio queda por debajo de lo recibido, revisión humana del excedente; no reembolso automático.

## Comparación y costos publicados

Precios USD, consultados el 03/11/2026; no incluyen la suscripción de Shopify ni comisiones de la pasarela.

| Alternativa | Precio publicado | Evidencia y límite relevante |
| --- | --- | --- |
| Depo Starter | USD 9/mes + 1% + USD 0.20 | Incluye depósitos mediante drafts según ficha comercial; prueba gratuita 14 días. |
| Depo Lite | USD 49/mes + 0.75% + USD 0.15 | Incluye Starter. |
| Depo Pro | USD 149/mes + 0.5% + USD 0.10 | Incluye Lite y soporte prioritario. |
| Downpay Essentials | USD 29/mes; hasta USD 5,000 de valor mensual de pedidos Downpay | Ruta manual con producto y bloque de depósito; sin API incluida. |
| Downpay Standard | USD 49/mes; hasta USD 10,000 | No confundir el nombre del plan con el mecanismo estándar de selling plans. |
| Downpay Pro | USD 99/mes; hasta USD 25,000 | Sin API incluida. |
| Downpay Scale | USD 249/mes; hasta USD 100,000 | API, sandbox/dev y acceso a funciones beta; acceso beta específico no equivale a disponibilidad automática. |

La ficha de [Depo en Shopify](https://apps.shopify.com/deposits-split-payments) publica esos tres planes y afirma soporte de depósitos en drafts, facturas pendientes y cobro automático con tarjeta guardada. No especifica la base exacta del porcentaje ni cuándo se aplica el componente fijo: no calcular el costo total suponiendo que solo grava el anticipo. Su web general muestra otro rango de precios; usar la ficha vigente como referencia y confirmar la pantalla de contratación antes de cualquier gasto.

[Downpay publica](https://getdownpay.com/pricing) cuota mensual y posibles excedentes, sin comisión propia por transacción. El volumen cuenta el valor completo del pedido en el mes del checkout, aunque el saldo se pague después. Hay 7 días de prueba. La [ficha de Shopify](https://apps.shopify.com/downpay) distingue Scale para API y beta. No comprar Scale solo para compartir enlaces manualmente; el límite mensual se elige por volumen. No asumir que la prueba habilita una licencia de sandbox: está listada en Scale.

## Downpay: ruta manual concreta para probar

La guía oficial de [productos a medida](https://docs.downpay.app/en/article/partial-payment-for-bespoke-products-phone-orders-and-invoices-xgiox7/) describe productos `Unlisted`, enlaces de checkout y drafts como tres mecanismos diferentes. Para este caso elegir el primero:

1. Después de aceptar la cotización, la chef crea un producto `Unlisted` exclusivo de esa cotización, con su precio completo real y datos fiscales/recogida correctos. No reutilizar una variante compartida cambiándole el precio entre clientes.
2. Para un ordinario, asigna una opción Downpay de depósito del 60%. Para urgente, comparte la compra de pago completo. La regla de urgencia debe decidir qué enlace se habilita; no dejar una opción del 60% disponible al urgente por accidente.
3. La chef revisa producto, precio y depósito en la vista previa; el servicio guarda el enlace correcto con la versión aceptada. El cliente abre el enlace y paga en Shopify. La compra crea **un pedido parcialmente pagado**; conservar su identificador y transacciones confirmadas.
4. Después de un ajuste aceptado, la chef modifica **ese pedido**, comprueba total recibido y saldo nuevo y prepara su factura actualizada. La pantalla propia no debe anunciar un nuevo importe pagable mientras Shopify conserve otro.
5. Establece la fecha de vencimiento concreta de cada pedido, 24 horas antes de la entrega; no usar una fecha global idéntica para todos. Envía/expone la factura con antelación suficiente para que el cliente complete el pago antes del límite.
6. El cliente paga el saldo por el enlace de factura o `Pay Now`. La chef verifica el pago y el sistema concilia antes de declarar saldo pagado.

Los pasos de correlación con la reserva y publicación en la pantalla propia son diseño propuesto, no funciones garantizadas por Downpay. Shopify aclara que [Unlisted oculta descubrimiento, pero permite comprar mediante URL directa](https://help.shopify.com/en/manual/products/product-status). No es autenticación, enlace individual ni cupo compartido: hay que proteger el acceso en el servicio, evitar recompra y resolver reservas/cupos antes de cobros reales. No incluir datos personales en el nombre o URL del producto.

### Un pedido y cliente ejecutando el saldo

La [guía de conciliación de Downpay](https://docs.downpay.app/en/article/tracking-payments-in-shopify-analytics-1lm4qb1/) declara explícitamente que anticipo y saldo son transacciones del mismo número de pedido; los reembolsos también quedan asociados. Esto elimina el problema técnico de duplicar ventas mediante dos drafts; no certifica el tratamiento fiscal local.

La [guía de cobro](https://docs.downpay.app/en/article/payment-authorization-or-collection-kk9ihv/) documenta pago del saldo por el cliente, factura desde el pedido para tiendas sin multimoneda y recordatorio con botón de checkout. Shopify también documenta [facturas de pedidos con saldo pendiente](https://help.shopify.com/en/manual/fulfillment/managing-orders/payments/deferred-payments). Para esta tienda usar USD y verificar que no esté activa la restricción de multimoneda. No activar cobro automático ni acciones de tarjeta guardada. La tarjeta se guarda como parte de Downpay; el flujo operativo debe prohibir su cargo sin nueva acción del cliente.

La [gestión de pedidos](https://docs.downpay.app/en/article/deposit-order-management-rabwr8/) dice que la fecha de vencimiento **no cobra automáticamente por defecto** y permite cambiarla desde términos de pago. Cambiar la opción general no modifica pedidos ya creados. Sus instrucciones de edición recalculan el saldo futuro; las líneas ya preparadas/entregadas tienen restricciones. No prometer múltiples cuotas posteriores: el flujo estándar admite un saldo futuro; la beta de cobros parciales adicionales tiene otras condiciones.

### Ajustes y límites aún por demostrar

Downpay publica un caso de [precio final variable](https://docs.downpay.app/en/article/take-deposits-for-weight-based-products-15r09f2/): aumentar el total agregando un artículo personalizado al pedido, reducirlo con un descuento real y después enviar factura actualizada. Para pasteles, el aumento sería el costo del cambio aceptado; una reducción sería una corrección real del precio acordado. **No utilizar ese descuento para simular el dinero del anticipo.** La guía advierte limitaciones si ya existen descuentos y contempla reembolso como alternativa; esa alternativa no se ejecutará automáticamente aquí.

Antes de elegir esta ruta, probar al menos USD 150 → anticipo USD 90 → precio nuevo USD 170 → saldo USD 80; y USD 150 → USD 130 → saldo USD 40, con los mismos USD 90 recibidos. **No está demostrado** que una reducción por debajo de lo cobrado pueda reflejarse sin reembolso o automatismo contrario al contrato. También probar un ajuste tras haber pagado el saldo. Esos casos no pueden declararse resueltos por la publicidad de “precio flexible”.

Comprobar el 60% sobre el **total acordado**, incluidos impuestos y entrega: un porcentaje sobre el producto no garantiza por sí solo el mismo porcentaje sobre el total final. Probar centavos, impuestos incluidos/excluidos, recogida y ausencia de cargos duplicados. Probar además un checkout abierto antes de ajustar el precio: no existe aquí una garantía documental de revocación atómica del enlace/pestaña antigua.

## Pasarela: condición previa real

Shopify documenta las [preórdenes con apps](https://help.shopify.com/en/manual/products/purchase-options/pre-orders) para Shopify Payments o PayPal Express. La [guía de Downpay](https://docs.downpay.app/en/article/enable-a-supported-payment-gateway-6g7o1k/) lista además Stripe y ciertos sistemas Authorize.net; Adyen exige Plus, y Bogus Gateway sirve para pruebas. Esa diferencia no permite asumir compatibilidad de la pasarela actual.

No se comprobó cuál usa Dayana's Sweet ni la elegibilidad del negocio. Si se elige PayPal Express, Downpay requiere aprobación de Reference Transactions, aunque comercialmente se opte por que el cliente pague cada saldo. La guía también limita métodos locales y ciertos monederos en depósitos. **Primero identificar pasarela, país/cuenta y aprobación vigente; luego probar el recorrido completo.** No proponer cambiar el país comercial ni dar por disponible Shopify Payments en Panamá.

## API, precio libre y por qué `write_app_proxy` no alcanza

El [SDK de Downpay](https://docs.downpay.app/en/article/storefront-sdk-1sans7j/) pasa un `selling_plan` asociado a un producto/variante al carrito. Eso integra el depósito en Liquid/JS, pero no crea un precio arbitrario a partir de una cotización. El importe aceptado debe existir en el producto o en una ruta de precios compatible.

La [API Downpay](https://docs.downpay.app/en/article/getting-started-with-the-downpay-api-46887k/) exige **Scale** y una clave del proveedor en servidor. Documenta crear/asignar opciones de compra, consultar y autorizar/cobrar saldos. No se encontró un contrato público que convierta una línea libre de draft en un checkout de anticipo customer-action; pagar Scale no demuestra esa capacidad. En este proyecto no usar sus mutaciones de cobro para aceptar propuestas o cobrar al vencer.

Shopify sí permite [crear drafts por API](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/draftOrderCreate) con `write_draft_orders` (o el scope alternativo documentado `write_quick_sale`), sujeto a permisos de usuario. La [línea de draft](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/DraftOrderLineItemInput) admite `originalUnitPriceWithCurrency` para artículos personalizados y `priceOverride` para una variante. Eso prueba precio personalizado, **no depósito nativo en Basic**. Las [opciones preorder no están disponibles en drafts](https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders/create-draft), y los [pagos parciales generales del admin](https://help.shopify.com/en/manual/payments/partial-payments) exigen Plus.

Automatizar productos requeriría permisos adecuados, por ejemplo [`write_products` para variantes](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productVariantsBulkUpdate); editar pedidos usa [`write_order_edits`](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/orderEditBegin). Lectura financiera, webhooks y acceso a datos del cliente deben diseñarse aparte. [`write_app_proxy`](https://shopify.dev/docs/apps/build/online-store/app-proxies) solo habilita la ruta proxy, no concede esos permisos. No se modificó ningún scope.

### Draft beta de Downpay

La [documentación beta](https://docs.downpay.app/en/article/deposits-and-partial-payments-on-draft-orders-uz0vsv/) admite productos y artículos personalizados, conserva todos los pagos en un pedido y contempla tiendas sin Plus. Sin embargo, el cliente recibe una página para **guardar tarjeta**; después la chef pulsa `Collect partial payment` y `Charge`. En planes sin Plus se autoriza primero el saldo completo, se captura el depósito y se libera el resto. No es un checkout donde el cliente ejecuta el anticipo del 60%. El cliente sí puede pagar el saldo con `Pay now`, pero eso no corrige la falta del primer paso requerido. Acceso beta requiere habilitación del proveedor; Scale lista beta, sin garantizar acceso inmediato. No elegir esta ruta para el contrato actual.

## Depo: qué está demostrado y qué falta

La [ficha oficial](https://apps.shopify.com/deposits-split-payments) y la [página del proveedor](https://sidepanda.com/apps/depo) afirman depósitos para drafts y envío de facturas; también enfatizan cobro automático. Son declaraciones comerciales. No se encontró documentación técnica pública suficiente sobre API, scopes, importe libre, checkout inicial, edición posterior o IDs de pedidos generados por el flujo de drafts. No inventar un endpoint ni prometer integración de nuestra app con Depo.

`https://docs.sidepanda.com/` no fue accesible por el navegador de investigación y no resolvió DNS al comprobarlo; el FAQ enlazado en la ficha (`/depo`) tampoco abrió correctamente. Esto limita la evidencia y **no demuestra que Depo carezca de esas funciones**. No se contactó al proveedor.

Para preferir Depo se necesitaría una prueba/documentación verificable de: Basic + draft con artículo libre; cliente paga el primer 60% online; ambos pagos conservan el mismo pedido; saldo por nueva acción del cliente con autocobro deshabilitado; ajustes reales conservan lo recibido; y API publicada o procedimiento manual para extraer un enlace válido. Añadir costo/base de comisión y pasarela compatible. Hasta entonces no se recomienda comprarla ni elegirla por tener “draft deposits” en la ficha.

## Próxima decisión necesaria

**Decidir si se acepta un piloto manual de Downpay Essentials y un producto `Unlisted` por cotización**, condicionado a pasarela compatible y comprobación de los casos anteriores. No requiere Scale para esa operación manual; sí requiere autorizar instalación/suscripción y creación de productos de prueba en un paso posterior. Alternativa: mantener el requisito de importe libre sin productos por cotización, en cuyo caso hace falta demostrar otro proveedor o una ruta soportada antes de implementar cobros.

La prueba no se aprueba solo porque acepte una tarjeta: debe confirmar anticipo exacto, mismo pedido, saldo por cliente, ausencia de autocobro, aumentos/reducciones, exceso recibido, ajuste tras saldo, enlaces antiguos y conciliación. Cupos compartidos y fiscalidad siguen siendo dependencias del contrato previo; una app de depósitos no las resuelve automáticamente.

## Verificación y límites de esta investigación

Solo lectura de fuentes oficiales de Shopify y proveedores. No se instalaron apps, contrataron planes, enviaron mensajes, tocaron secretos/permisos, crearon productos/pedidos ni procesaron pagos. No se hicieron pruebas de checkout, pasarela, fiscalidad o integración. Solo se creó este documento; la recomendación es documental y condicional.

Se ejecutó `node tests/check-theme.mjs`: **correcto**, 40 archivos JavaScript, 69 JSON y 54 esquemas de sección. No se ejecutó Theme Check de Shopify ni vista previa desktop/mobile porque no se modificó UI. El repo contiene cambios previos ajenos a esta investigación; no se alteraron.

## Adenda: alternativa propia sin otra suscripción

**Sí hay respaldo oficial para probar un draft inicial del 60% que, después del pago, se amplía con el 40% restante en el mismo pedido y se cobra por un nuevo checkout de Shopify.** Es un candidato técnico razonable en Basic, sin Depo/Downpay ni dos pedidos diferentes. No se ha probado en esta tienda y no equivale al depósito nativo de un pedido que ya mostraba el precio completo desde el principio.

El costo adicional de app mensual sería cero; siguen existiendo comisiones de Shopify/pasarela y costos de backend que no se han cuantificado. No se modificaron permisos ni se hicieron llamadas a APIs de la tienda.

### Qué demuestra Shopify

La [guía de edición por API](https://shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps/edit-orders) admite pedidos originados en drafts y el ciclo `orderEditBegin → mutaciones de edición → orderEditCommit`. Exige `write_order_edits`, datos protegidos autorizados y moneda de la tienda; no documenta requisito Plus para ese ciclo. No permite editar pedidos archivados; el acceso por defecto cubre 60 días, ampliable con `read_all_orders`. La guía también dice que `notifyCustomer: true` envía factura con la que el cliente paga el saldo pendiente.

La [ayuda de edición de productos](https://help.shopify.com/en/manual/fulfillment/managing-orders/editing-orders/products) confirma añadir artículos personalizados, actualizar el total y enviar factura con enlace al checkout cuando el cliente debe más. Si la edición produce un importe a devolver, el reembolso se ejecuta por separado: editar y notificar no devuelve dinero automáticamente. Por tanto, un pedido inicialmente pagado no queda técnicamente condenado a permanecer cerrado a cualquier cobro adicional.

[`orderEditAddCustomItem`](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/orderEditAddCustomItem) añade una línea con título, importe y cantidad al pedido existente; necesita commit para guardarse. El precio no puede ser negativo y la cantidad debe ser positiva. No carga una tarjeta. [`orderEditCommit`](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/orderEditCommit) aplica los cambios al pedido original y permite `notifyCustomer: false` para preparar primero el resultado sin enviar la factura durante la aceptación de la propuesta.

### Recorrido propuesto, sin cobrar al aceptar

Ejemplo ilustrativo con totales finales ya conciliados con impuestos: precio acordado USD 150, anticipo USD 90, saldo USD 60.

1. Crear **un** draft de USD 90, con línea descriptiva `Anticipo pastel [reserva]`, cliente y tratamiento fiscal correctos. Publicar su `invoiceUrl` únicamente a su cliente. La cotización completa de USD 150 y su versión permanecen en la reserva propia.
2. El cliente termina el checkout; el draft se convierte en pedido. No llamar `draftOrderComplete`, `orderMarkAsPaid` ni registrar pagos ficticios. Confirmar que los USD 90 son un cobro exitoso, no una autorización/pago pendiente, y guardar el `orderGid` real.
3. En ese mismo pedido, iniciar una edición y añadir la línea `Saldo pastel [reserva]` de USD 60. Revisar cálculos y guardar con `notifyCustomer: false`. Esperar a que el pedido refleje total USD 150, recibido USD 90 y pendiente USD 60 antes de publicar el botón de saldo.
4. Cuando corresponda, mostrar el enlace de cobro adicional o enviar la factura del mismo pedido. El cliente entra a Shopify y paga los USD 60. Confirmar otra transacción del mismo `orderGid`; no crear otro draft ni capturar automáticamente la tarjeta inicial.
5. Para urgente, crear inicialmente un draft del 100% y omitir la incorporación del saldo. La entrega sigue bloqueada hasta dinero confirmado y verificación del resto de condiciones comerciales.

El período intermedio es importante: Shopify verá un pedido **pagado por USD 90** antes de añadir los USD 60. No debe mostrarse al cliente como “pastel completamente pagado” ni disparar entrega/archivo desde esa primera señal. Shopify documenta opciones de [fulfillment automático y archivo](https://help.shopify.com/en/manual/checkout-settings/order-processing); comprobar las configuraciones y automatismos existentes antes del piloto, sin cambiarlos en esta investigación. La reserva debe seguir pendiente de saldo aunque temporalmente `fullyPaid` sea verdadero en Shopify.

### Enlace de saldo: existe un campo oficial

La ruta para el botón propio es:

`Order.paymentCollectionDetails.additionalPaymentCollectionUrl`

[`OrderPaymentCollectionDetails`](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/OrderPaymentCollectionDetails) describe expresamente pagos adicionales después de una edición. `additionalPaymentCollectionUrl` es nullable y requiere `read_orders`: si no existe o el saldo no coincide, no publicar un enlace supuesto. No inventar `Order.invoiceUrl` ni reutilizar el `DraftOrder.invoiceUrl` inicial para el segundo pago. La documentación acredita la finalidad del campo; no acredita vigencia indefinida ni revocación al editar.

Como alternativa de factura por correo, [`orderInvoiceSend`](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/orderInvoiceSend) existe y requiere `write_orders`. También puede notificarse al hacer commit según la guía. Esas operaciones mandan comunicaciones: implementarlas solo en la acción prevista por el flujo autorizado. Obtener la URL para el botón no obliga a enviar un correo.

### Ajustes: reemplazar el componente comercial, conservar el libro de pagos

No agregar otra línea del saldo completo en cada ajuste. Eso acumularía precio. Persistir los IDs de las líneas gestionadas por la reserva y mantener una representación final cuyo total sea el precio aceptado. [`orderEditSetQuantity`](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/orderEditSetQuantity) permite llevar una línea a cantidad cero, conservándola en el historial, y agregar su sustituta en la misma sesión. No ofrece cambio libre de precio de la línea existente; se propone retirar la línea de saldo anterior y añadir la nueva, sin descuento ficticio.

Separar **valor de líneas** y **dinero recibido**. En el ejemplo, sea `A = 90` el componente inicial, `T` el precio final aceptado y `R` el recibido neto confirmado. Mientras `T >= A`, conservar la línea inicial y reemplazar el componente comercial de saldo por `T - A`; el dinero aún exigible es `max(T - R, 0)`. Después de haber cobrado un saldo, esas dos cantidades ya no son necesariamente iguales.

| Situación ilustrativa | Representación comercial propuesta | Dinero que falta |
| --- | --- | --- |
| Anticipo 90; precio cambia a 170 | 90 + saldo comercial 80 | 80 |
| Anticipo 90; precio cambia a 130 | 90 + saldo comercial 40 | 40 |
| Ya recibió 150; precio cambia a 170 | 90 + saldo comercial 80; conserva ambos pagos anteriores | 20 |
| Recibió 90; precio cambia a 70 | Revisión humana: retirar componentes anteriores y representar precio corregido 70, sin línea negativa | 0; excedente 20 pendiente de resolución |

La última fila requiere una prueba específica de representación/reportes; Shopify indica que la edición no ejecuta el reembolso. No poner el precio final 90 para esconder los 20, no borrar una transacción ni crear una devolución automática. Si no puede reflejarse el precio nuevo y el excedente claramente, dejarlo en revisión humana sin emitir otro cobro.

[`CalculatedOrder`](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/CalculatedOrder) permite revisar `totalPriceSet`, `totalOutstandingSet` y `taxLines` antes del commit. Tras guardarlo, volver a leer el pedido real. La equivalencia entre sus importes y el acuerdo debe incluir impuestos, envíos y redondeos; los números anteriores no instruyen a fijar `taxable: false`.

### Fiscalidad, categoría y recogida: el bloqueo no es “dos ventas”, sino qué representa la primera

Dos componentes de precio en **un** pedido son técnicamente distintos de dos pedidos por el pastel completo: 90 + 60 puede sumar una sola venta de 150 sin descuento de depósito. **Pero en el primer checkout Shopify registra una venta de 90 y todavía no el pastel completo de 150.** Antes de usarlo hay que validar que ese registro inicial y su ampliación posterior son admisibles para anticipos, comprobantes e impuestos de la tienda. Si el anticipo debe registrarse como pasivo o la factura inicial debe contener el valor completo, esta arquitectura puede no servir aunque el checkout funcione.

El esquema 2026-10 de `orderEditAddCustomItem` tiene `taxable` por defecto `true`, `requiresShipping` por defecto `false` y `locationId` para cálculo fiscal; si falta este último, Shopify elige una ubicación. No asumir la ubicación correcta ni que escribir “pastel” asigna su categoría. El [changelog reciente de Shopify Tax managed mode](https://shopify.dev/changelog/posts/managed-mode-for-shopify-tax-is-released) advierte que, en tiendas con ese modo, `taxable` se ignora incluso con API 2026-10 y una línea sin categoría tributa a la tasa estándar. `productCategoryId` para líneas custom se documenta desde 2027-01, aún versión candidata en esta fecha. No usarlo suponiendo que existe en 2026-10. Comprobar el modo fiscal real; no se presupone Shopify Tax managed mode en esta tienda.

La [creación de drafts](https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders/create-draft) usa por defecto dirección de envío para impuestos y, si falta, facturación. `requiresShipping: false` evita exigir envío físico, pero no acredita recogida nativa ni origen fiscal correcto. No escribir una dirección falsa del cliente ni añadir dos portes. Elegir y probar la recogida desde el pedido inicial; no asumir que puede convertirse después desde otro método.

Las [restricciones de edición](https://help.shopify.com/en/manual/fulfillment/managing-orders/editing-orders/considerations) incluyen: líneas sin entregar, incompatibilidad con Shop Pay Installments, posibles bloqueos mientras un pago esté pendiente, ausencia de checkout acelerado para el cobro adicional y tarifas de envío sin recálculo automático. Los pedidos con entrega local no se pueden editar. Un draft convertido en pedido sí evita la restricción general de pedidos importados por apps. Además, una edición en otro día puede aparecer como otra fila/pedido en ciertos informes, aunque no crea un nuevo pedido: no confundir apariencia del reporte con otro `orderGid`. La compatibilidad exacta de recogida y API se debe probar, no inferir de que el admin permita editar recogidas.

### Idempotencia y pagos concurrentes

La alternativa reduce la cantidad de checkouts iniciales, pero no elimina la necesidad de un registro durable. Clave única por tienda/reserva/versión/operación, bloqueo local por pedido y estados de operación persistidos. Guardar draft, pedido, sesión de edición y líneas antes de entregar enlaces. Un webhook repetido del anticipo no debe añadir otra línea de saldo; tampoco un nuevo estado pagado después del saldo debe reiniciar el flujo.

La [guía de idempotencia](https://shopify.dev/docs/apps/build/apis/graphql-admin/implementing-idempotency) limita sus garantías a mutaciones que admiten la directiva correspondiente. No se encontró una garantía `@idempotent` para `draftOrderCreate`, `orderEditAddCustomItem` o `orderEditCommit`. Ante timeout, primero consultar el estado real y el marcador/IDs persistidos; no repetir a ciegas el alta de draft, el añadido de saldo ni el commit. La incertidumbre que no se puede conciliar pasa a revisión humana.

Confirmar pagos mediante [`OrderTransaction`](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/OrderTransaction): ID único, moneda, importe, tipo, estado y flag de prueba. Sumar solo `SALE`/`CAPTURE` exitosos aceptados por la política, no `AUTHORIZATION`; no sumar otra vez los USD 90 al recibir un evento posterior. Conciliar con `Order.totalReceivedSet`, `totalRefundedSet` y `netPaymentSet`. No hay una captura parcial automática del 100%: el primer checkout cobra su total de 90 y el segundo cobra el pendiente de la edición.

El bloqueo propio no impide que el cliente pague desde una pestaña Shopify mientras se edita el saldo. Probar el enlace adicional antes y después de reemplazar la línea, dos pestañas y pago concurrente con commit. No se encontró garantía oficial de que una URL antigua quede revocada de manera atómica. Hasta demostrar el comportamiento, impedir la emisión de un enlace sustituto durante conciliación y manejar cualquier pago tardío conservando el dinero real recibido, sin cobro ni reembolso compensatorio automático.

### Conjunto mínimo de bloqueos antes de aprobar implementación/cobro

| Bloqueo concreto | Evidencia mínima de salida |
| --- | --- |
| Modelo fiscal y logístico | Aceptar el registro inicial de anticipo como venta parcial ampliada; base/impuestos/recogida correctos en ambos recibos; sin segundo pastel ni porte. Revisar categoría/default y reportes de edición. |
| Permisos y persistencia | App con `write_draft_orders`, lectura de pedidos/transacciones y `write_order_edits`; `write_orders` si enviará facturas por esa mutación. Acceso a pedidos de más de 60 días cuando sea necesario, datos protegidos, BD y conciliación durable. El actual `write_app_proxy` no basta. |
| Elegibilidad operativa | Pago inicial realmente cobrado, pedido editable/sin archivar, sin entrega automática ni local delivery incompatible; pasarela real permite pagar saldo tras edición en USD. Cupo compartido no depende de las dos líneas custom, que no gestionan stock. |
| Integración y carreras | Prueba 150→90→añadir60→pagar60 en el mismo `orderGid`; ajustes a170/130/70, ajuste tras saldo pagado, reintentos con respuesta perdida, webhooks duplicados, impuesto/redondeo y checkout antiguo concurrente. |

**Próximo paso recomendado:** aprobar solamente el diseño de una prueba aislada de esta ruta propia, sin suscripción adicional. Primero validar el modelo del primer comprobante y confirmar la pasarela; después demostrar el ciclo con pagos de prueba y permisos autorizados. No hay base todavía para activar cobros reales, pero tampoco hay motivo documental para descartarla por la restricción Plus de depósitos nativos: se trata de una edición con cobro adicional, una función diferente.

Esta adenda usa fuentes públicas oficiales de Shopify; no se enviaron correos ni se tocó el admin. Se volvió a ejecutar `node tests/check-theme.mjs` después de añadirla: correcto, 40 JS, 69 JSON y 54 esquemas. La adenda solo añade documentación y no altera código/UI; no hubo pruebas de integración ni de pago.
