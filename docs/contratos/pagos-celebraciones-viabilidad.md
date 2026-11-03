# Viabilidad de pagos de celebraciones en Shopify Basic

Investigación documental del **3 de noviembre de 2026**, con documentación oficial de Shopify; referencias GraphQL consultadas en la versión **2026-10** (vigente como `latest` en esa fecha). No se llamó a ninguna API de la tienda ni se inspeccionaron credenciales. Este documento no acredita que exista una app instalada, alojamiento, base de datos, pasarela compatible, suscripciones a webhooks o acceso Admin API. El contexto recibido indica que no se detectó app/infraestructura configurada.

## Decisión y alcance

**No se puede declarar viable ni conectar a producción el cobro 60%/40% mediante dos borradores financieros todavía.** Shopify permite crear borradores con artículos personalizados y checkout alojado, pero eso crea dos ventas/pedidos independientes; no equivale a dos pagos nativos de un solo pedido. Faltan resolver el modelo fiscal, la invalidación de checkouts antiguos y la exclusión de cupos compartidos. Son bloqueos de cobro real, no detalles de interfaz.

Se propone conservar el tema como cliente del servicio y evaluar una app/backend externo con registro financiero y reservas persistentes. La opción de dos cobros en Basic queda como **candidata condicionada**. No se usa un descuento del 40% para simular un anticipo, no se marca como pagado algo no recibido y no se cobra automáticamente el saldo. La aceptación de una propuesta únicamente modifica el acuerdo comercial; cada cobro exige una nueva acción expresa del cliente en el checkout.

El contrato de pantalla existente es [seguimiento-celebraciones.md](./seguimiento-celebraciones.md). Este análisis no lo modifica ni implementa pagos, reservas o autenticación.

## Qué admite Shopify y qué exige otro enfoque

| Capacidad | Evidencia oficial | Consecuencia para Basic |
| --- | --- | --- |
| Anticipo porcentual en borrador con términos de pago | El requisito de depósito en drafts está restringido a Plus. El campo GraphQL `DraftOrderInput.deposit`, incorporado en 2026-07, conserva esa restricción. | No usar `deposit: 60%` suponiendo que Basic lo permite. [Changelog de depósitos](https://shopify.dev/changelog/draft-order-deposit-fields-now-available-in-the-admin-and-customer-account-graphql-apis). |
| Varios pagos parciales sobre un pedido con términos de pago | La función de cobro/registro de pagos parciales requiere Plus. | Los términos de pago, por sí solos, no habilitan la división requerida en Basic. [Pagos parciales](https://help.shopify.com/en/manual/payments/partial-payments). |
| Borrador con importe personalizado y pago mediante enlace | `draftOrderCreate` admite artículos personalizados, requiere `write_draft_orders` y devuelve errores de usuario. No reserva inventario por defecto. | Sirve como primitiva para cobrar un importe completo independiente; no demuestra que sea un anticipo contable. [Crear borrador](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/draftOrderCreate). |
| Precálculo de impuestos, descuentos y envío | `draftOrderCalculate` calcula sin crear el borrador, con datos del cliente y dirección. | Debe comprobarse el total real antes de publicar un enlace; la cotización visual no sustituye ese cálculo. [Calcular borrador](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/draftOrderCalculate). |

La restricción anterior se refiere a depósitos en drafts/términos y a la función general de pagos parciales del admin. **No significa que toda modalidad de anticipo sea imposible en Basic.** Shopify también documenta preórdenes mediante apps, con pago parcial y método de pago guardado; exige Shopify Payments o PayPal Express. Es un flujo distinto que debe evaluarse por separado y no valida los dos drafts personalizados. [Preórdenes](https://help.shopify.com/en/manual/products/purchase-options/pre-orders).

La alternativa de preórdenes requiere productos/variantes y políticas de venta, una app y acceso a los scopes protegidos correspondientes. Las apps creadas directamente en el admin no pueden usar esas opciones; para una sola tienda Shopify remite al Dev Dashboard. El mecanismo permite cobrar después sin contactar al cliente, por lo que debe demostrarse expresamente que la app elegida respeta **saldo solo por acción del cliente**, precios ajustables aceptados y cupo compartido. No se recomienda una app concreta sin esa prueba. [Opciones de compra para apps](https://shopify.dev/docs/apps/build/purchase-options), [políticas de pagos diferidos](https://shopify.dev/docs/apps/build/purchase-options/deferred).

Capturar el 60% de una autorización del 100% tampoco resuelve por sí solo el problema: la captura múltiple depende del proveedor y del plan, tiene un plazo de autorización y no permite asumir un saldo superior después de un ajuste. No cambiar la configuración global de captura para esta función. [Autorización y captura](https://help.shopify.com/en/manual/payments/payment-authorization).

## Modelo candidato: reserva comercial y cobros separados

Esta es una propuesta de backend, **no una garantía de Shopify ni una arquitectura aprobada**:

1. Una reserva comercial propia contiene cliente autorizado, fecha/franja, versión de propuesta aceptada, precio y desglose fiscal aprobados, historial, cupo y libro de pagos. Los pedidos financieros de Shopify se vinculan a ella; no son reservas nuevas.
2. El anticipo inicial ordinario solicita el 60% del total acordado según una regla de redondeo explícita, pendiente de aprobar. El saldo nominal inicial es el complemento exacto, para que ambos importes sumen el total. Un urgente solicita el 100%; el criterio que hace un pedido urgente debe venir del contrato de negocio, no se inventa aquí.
3. Después de un ajuste aceptado, `saldoExigible = max(totalAceptadoNuevo - recibidoNetoConfirmado, 0)`. No se vuelve a calcular el anticipo como 60% del total nuevo ni se cambia el registro histórico de lo cobrado. Una propuesta pendiente conserva el total anterior hasta aceptación.
4. Un total de USD 150 con USD 90 recibidos pasa a USD 170: quedan USD 80. Si pasa a USD 70, no hay cobro pendiente y quedan USD 20 a favor para resolución humana. No hay reembolso automático.
5. Idealmente hay un cobro de anticipo y uno de saldo. Un ajuste después de ambos pagos, reintentos ambiguos o enlaces sustituidos exige más intentos financieros o revisión humana. Por tanto, **exactamente dos IDs de draft durante toda la vida de la reserva** no es compatible con cualquier ajuste; distinguir dos etapas comerciales de la cantidad histórica de intentos.

El saldo debe manejar devoluciones y otros movimientos confirmados. El contrato actual de pantalla solo admite pagos positivos `confirmed`; antes de soportar reembolsos reales hace falta ampliar su semántica o definir una proyección neta auditable. Un reembolso no se puede ocultar manteniendo la suma original como dinero disponible.

## Crear un checkout financiero sin alterar el acuerdo

La entrada propuesta usa una línea personalizada con `variantId: null`, `quantity: 1`, `title` descriptivo y `originalUnitPriceWithCurrency` en USD. Ese campo representa el precio anterior a descuentos; no garantiza que coincida con el total final con impuestos. `requiresShipping` y `taxable` son controles de líneas personalizadas. Un título como “Anticipo reserva …” no determina la clasificación fiscal. [Campos de línea de borrador](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/DraftOrderLineItemInput).

Para impedir descuentos añadidos al acuerdo, establecer explícitamente `acceptAutomaticDiscounts: false`, `allowDiscountCodesInCheckout: false`, no enviar `discountCodes` ni `appliedDiscount`, y comprobar que el resultado calculado conserva descuentos cero. Etiquetas, atributos y metafields pueden ayudar a correlacionar los registros, pero no reemplazan la relación persistente propia ni autorizan acceso al cliente. [Entrada del borrador](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/DraftOrderInput).

Guardar el ID de draft antes de entregar su `invoiceUrl`. Shopify define esta URL como el enlace de checkout de la factura y expone `DraftOrder.order` para el pedido creado desde ese borrador. La URL es nullable: no mostrar éxito si no existe o hay `userErrors`. El servicio entrega solo el enlace del intento vigente a una sesión autorizada; no registra la URL completa en analítica o mensajes públicos. [Objeto DraftOrder](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/DraftOrder).

No ejecutar `draftOrderComplete` para fingir un cobro ni enviar facturas automáticamente durante la aceptación de propuestas. Presentar un enlace es distinto de enviar un correo o cargar una tarjeta. La implementación debe obtener consentimiento para el importe concreto y el cliente finaliza el checkout.

## Bloqueo fiscal, descuentos y recogida

**Dos drafts no deben contener cada uno el pastel completo a precio completo.** Eso duplicaría la base comercial registrada. Tampoco se debe registrar un pedido completo de USD 150 más otro “anticipo” de USD 90 como dos ventas, o descontar el anticipo del segundo mediante un descuento comercial sin validar su efecto fiscal y de reportes. Vincularlos con un `reservationId` no compensa impuestos, ingresos, descuentos ni envíos automáticamente.

Antes de aceptar esta arquitectura se necesita una decisión fiscal aplicable a la tienda: si el anticipo se reconoce como parte gravada de la venta o como pasivo/depósito, cuándo nace el impuesto, cómo se distribuyen base e impuesto entre cobros y cómo se corrige tras ajustes o devoluciones. No se presupone una tasa ni exención para pasteles. Shopify Tax usa categorías para determinar obligaciones y exenciones de productos; una línea libre no aporta aquí una categoría de producto equivalente. [Categorías e impuestos](https://help.shopify.com/en/manual/taxes/shopify-tax/product-categories-tax).

Ejemplo de prueba, no instrucción fiscal: si el acuerdo final de USD 150 ya incluye impuestos, crear una línea “Anticipo” de USD 90 y permitir que Shopify añada impuestos por fuera cobra más del 60% acordado. Si se prorratea base e impuesto entre las dos ventas, hay que demostrar el total y el redondeo de ambas; si el anticipo es un pasivo, una línea normal de venta podría ser un modelo contable incorrecto aunque no lleve impuestos. No fijar `taxExempt: true` ni `taxable: false` para hacer coincidir importes sin fundamento fiscal. Shopify atribuye al comerciante la verificación de las tasas y obligaciones aplicables. [Shopify Tax](https://help.shopify.com/en/manual/taxes/shopify-tax/).

Para recogida, evitar dos tarifas y dos preparaciones del mismo pastel. `requiresShipping: false` suprime el requisito físico de la línea financiera, pero **no acredita recogida nativa ni origen fiscal correcto**. La documentación del admin permite seleccionar pickup en un draft; también indica que, por defecto, sus impuestos usan dirección de envío y, si falta, facturación. No introducir la dirección de recogida como dirección falsa del cliente. [Crear drafts: impuestos y entrega](https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders/create-draft).

La API consultada ofrece `shippingLine` con precio, título y `shippingRateHandle`; escribir “Recogida” y precio cero no demuestra una selección nativa de ubicación. El backend deberá probar la ruta compatible para la ubicación real o mantener la preparación/recogida únicamente en la reserva comercial con el tratamiento fiscal validado. No generar dos fulfillments operativos ni considerar el anticipo como un pastel entregado. [ShippingLineInput](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/ShippingLineInput).

## Confirmación de dinero: webhook, vínculo e idempotencia

`orders/paid` ocurre al pagarse una orden; `order_transactions/create` comunica creación o cambios a estados success/failure/error de una transacción. Son señales para conciliar, no importes a sumar ciegamente. Suscribirse también a cambios relevantes de pedidos y reembolsos según el modelo final. [Temas de webhook](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/WebhookSubscriptionTopic).

El ejemplo oficial de payload de `orders/paid` no ofrece un `draft_order_id` en el que basar el contrato. No inventar ese campo ni usar `source_name` como identificador único. Persistir la relación `tienda + reserva + intento + draftGid`, y confirmar el `orderGid` mediante `DraftOrder.order` cuando siga vinculado. Usar atributos de correlación generados por el servidor como respaldo y demostrar su presencia en los pedidos reales; ante una relación ambigua, poner en conciliación humana, sin reservar ni sumar el pago al azar. [Referencia de webhooks](https://shopify.dev/docs/api/webhooks/2026-10?reference=toml#list-of-topics-orders/paid).

Consultar las transacciones de la orden y comprobar ID, moneda, tipo, estado, pasarela y flag `test`. Guardar cada ID de transacción una sola vez, ligado a la tienda y pedido. Una autorización solo retiene fondos; `CAPTURE` transfiere lo autorizado y `SALE` combina autorización/captura. Solo los movimientos exitosos admitidos por la política entran al libro; una autorización, fallo, pendiente o callback del navegador no confirma anticipo. Los pagos manuales requieren un procedimiento humano que respalde su recepción, pues un registro manual no acredita por sí mismo una transferencia bancaria. [OrderTransaction](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/OrderTransaction), [tipos de transacción](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/OrderTransactionKind), [estados](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/OrderTransactionStatus).

Conciliar el libro con `Order.totalReceivedSet`, `totalRefundedSet` y `netPaymentSet` y conservar centavos USD; no confundir el precio de la orden con dinero cobrado ni restar comisiones de pasarela del importe pagado por el cliente. `netPaymentSet` es recibido menos reembolsado. El dinero “real recibido” en este contrato significa cobro confirmado/registrado conforme a esa política, no liquidación bancaria irrevocable: disputas y devoluciones posteriores requieren tratamiento. [Order](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order).

El receptor verifica HMAC sobre el cuerpo original, acepta únicamente la tienda/app esperada, persiste la entrega antes de responder y procesa una cola durable. Deduplicar `X-Shopify-Webhook-Id`; `X-Shopify-Event-Id` permite correlacionar entregas de la misma acción. La restricción única de transacción evita duplicar el dinero incluso con varias suscripciones. [Verificación y duplicados](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries).

No se garantiza el orden ni la llegada de todos los webhooks. Se necesita conciliación periódica con Shopify, reintentos, monitoreo y una bandeja de excepciones. La reserva se calcula desde estado persistente confirmado, nunca desde el orden de llegada de eventos. [Garantías y conciliación de webhooks](https://shopify.dev/docs/apps/build/webhooks).

La creación de intentos requiere una clave de operación propia, única por reserva/etapa/versión, bloqueo y registro durable de estado. La documentación limita `@idempotent` a mutaciones que lo declaran; `draftOrderCreate` consultada no documenta esa garantía. Un timeout después de crear el draft puede dejar un recurso existente sin respuesta: no crear otro automáticamente; conciliar por la operación persistida y su correlación, o escalar la ambigüedad. Una búsqueda sin resultados no prueba por sí sola que Shopify nunca recibió la primera llamada. [Idempotencia GraphQL](https://shopify.dev/docs/apps/build/apis/graphql-admin/implementing-idempotency).

## Bloqueo: enlaces antiguos y ajustes concurrentes

La documentación de `draftOrderUpdate` advierte expresamente que actualizar un draft con checkout iniciado lo desvincula del checkout. **La actualización no impide terminar ese checkout ni crear su orden**, y el draft puede quedar abierto después del pago. Por tanto, recalcular el saldo o reemplazar la URL en el frontend no invalida una pestaña antigua; además puede perderse el enlace `DraftOrder.order`. [Advertencia de actualización](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/draftOrderUpdate).

`draftOrderDelete` elimina un borrador, pero la documentación consultada no promete la revocación atómica de un checkout ya iniciado ni proporciona un TTL de `invoiceUrl` configurable. `reserveInventoryUntil` es una caducidad de retención de inventario, no del cobro. No declarar que eliminar el draft “cancela todos los pagos posibles”. Eliminar un draft completado tampoco es un reembolso ni cancelación de su orden. [Eliminar draft](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/draftOrderDelete).

Contrato candidato de intentos: `creating → active → paid`, o `active → retiring → retired`, con estados `unknown` y `needs_review` para carreras. Al aceptar un ajuste, detener la emisión del saldo sustituto, conciliar todos los intentos anteriores y retirar el draft impagado solo mediante una ruta demostrada. Una URL intermediaria propia con expiración impide nuevas redirecciones, pero no recupera el checkout Shopify que el cliente ya abrió. No basta como control de cobro.

**Condición de salida:** obtener de Shopify una garantía/ruta soportada de revocación para este caso y probarla con la pasarela real en entorno de pruebas. Si no existe, decidir explícitamente entre impedir ajustes mientras un checkout sea cobrable, usar una solución de pago con revocación verificable, o aceptar un flujo humano de conciliación para cobros tardíos. Esta última opción detecta y corrige; no satisface una promesa de “imposible cobrar el enlace viejo”. Nunca ocultar un pago tardío porque su propuesta ya caducó, ni emitir automáticamente otro cobro o reembolso para compensarlo.

## Bloqueo: cupo compartido al pagar

La reserva requiere una fuente autoritativa común para custom y pasteles de catálogo. Una línea personalizada no descuenta stock de un producto de cupo. El pago del saldo tampoco debe consumir un segundo cupo.

Una transacción de base de datos puede evitar que dos workers consuman el mismo cupo local; no evita que dos checkouts Shopify externos cobren primero y sus webhooks lleguen después. El diseño debe demostrar una retención limitada anterior al checkout, liberación segura y confirmación única al pagar, o un recurso de stock compartido compatible con **ambos** canales. Un cron local que vence el cupo antes de revocar el checkout permite cobrar una reserva ya liberada. Si la pasarela/checkout no impide ese caso, hace falta una política explícita de pago tardío y revisión humana; no se puede prometer pago = cupo confirmado sin excepciones.

No crear variantes de cupo, cambiar inventario o modificar el admin en esta investigación. Su contrato y su autorización son dependencias de implementación.

## Pruebas y decisiones exigidas antes del primer cobro

| Bloqueo | Evidencia mínima pendiente |
| --- | --- |
| App e infraestructura | App instalada con scopes mínimos; secreto solo en servidor; autenticación y propiedad de reservas; BD con restricciones únicas; cola/webhooks HTTPS; conciliador y recuperación. Sin esta evidencia no existe un backend real conectado. |
| Impuestos y contabilidad | Decisión fiscal sobre anticipo/saldo, clasificación, recogida, inclusión de impuestos y ajustes; dos recibos cuyo total, base e impuestos concilien una venta sin duplicación. |
| Checkout vigente | Pagar desde pestaña abierta antes de ajuste/eliminación/expiración; demostrar el resultado y el vínculo al pedido. Dos ventanas, cobro simultáneo y respuesta perdida. No emitir cobros reales hasta resolver la garantía requerida. |
| Importes | Ordinario 60% + complemento; urgente 100%; aumento/reducción antes y después de pagos; total nuevo menor al recibido; redondeo de centavos; descuentos y envío cero cuando corresponda. |
| Libro financiero | Entregas duplicadas, desordenadas y ausentes; autorización sin captura; fallo, pago manual, reembolso parcial y pago de test; transacción vinculada una sola vez y sin sumar el total cotizado. |
| Cupo | Dos clientes compiten por el último cupo por canales distintos; expiración mientras checkout sigue abierto; webhook tardío/duplicado; anticipo y saldo consumen solo una reserva. |
| Idempotencia | Repetir una intención y perder respuesta de `draftOrderCreate`; no crear un segundo enlace cobrable por reintento incierto. |

La opción Plus simplifica el modelo de una venta con depósito, pero requiere decisión comercial de plan y aún necesita autenticación, cambios de precio, conciliación y cupo. Una app de preórdenes o depósitos puede ser alternativa en Basic, sujeta a compatibilidad demostrada con este flujo. **No hay base documental suficiente para certificar hoy los dos drafts como solución que garantice a la vez fiscalidad correcta, revocación de pagos antiguos y cupo compartido.**

## Comprobación realizada

Se contrastaron las páginas oficiales enlazadas, el esquema GraphQL vigente y el contrato local de seguimiento. No se hicieron pruebas de integración, checkout, pasarela, impuestos de la tienda, webhooks ni carreras de reserva. Ninguna afirmación de este documento debe presentarse al cliente como backend implementado o pago conectado.
