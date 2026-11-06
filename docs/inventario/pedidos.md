# Pedidos en el panel del personal

Pantalla «Pedidos» del portal `dayanassweet.com/apps/inventario`. Sirve para ver los pedidos de la tienda, saber qué hay que hornear y hacer las acciones del día sin entrar al admin de Shopify.

## Qué hace

| Acción | Quién | Qué pasa en Shopify (Admin GraphQL 2026-10) |
|---|---|---|
| **Lista** (Por preparar / Listos / Entregados, búsqueda, «Para hornear») | inventario o admin | `orders` de los últimos 60 días (hasta 6 páginas de 25) |
| **Detalle** (cliente, productos, totales, saldo, historial) | inventario o admin | `order` |
| **Nota interna** | inventario o admin | Nada: se guarda en Celebraciones (ver abajo) |
| **Marcar despachado** (número de seguimiento, transportista, aviso) | inventario o admin | `fulfillmentCreate` con `trackingInfo` y `notifyCustomer` |
| **Listo para retirar** (Fulshear) | inventario o admin | `fulfillmentOrderLineItemsPreparedForPickup` (Shopify avisa a la clienta) |
| **Entregado** (Fulshear) | inventario o admin | `fulfillmentCreate` con `notifyCustomer: false` |
| **Cobré en efectivo** | admin + contraseña | `orderMarkAsPaid` |
| **Reembolsar** (por línea, envío, monto adicional, motivo, aviso, stock) | admin + contraseña | `suggestedRefund` para el monto y el tope, luego `refundCreate @idempotent` |
| **Editar pedido** (cantidades y productos con stock) | admin + contraseña | `orderEditBegin` → `orderEditSetQuantity(restock: true)` / `orderEditAddVariant` → `orderEditCommit` |
| **Cancelar pedido** (motivo, reembolso, stock, aviso) | admin + contraseña | `orderCancel` (`refundMethod.originalPaymentMethodsRefund`) |

Reglas de negocio:

- **Montos:** la persona nunca escribe el monto que se cobra.
  - En efectivo se registra el `totalOutstandingSet` que devuelve Shopify. Si cambió desde que se abrió la hoja, responde 409 y no cobra.
  - En un reembolso, Shopify calcula el monto con `suggestedRefund`. El panel le suma el monto adicional opcional.
  - El total nunca pasa de `maximumRefundableSet` y tiene que coincidir con el que se vio en la revisión.
- **Pedidos de Celebraciones** (etiqueta `ds-celebraciones`):
  - Las cuatro acciones de dinero se rechazan, en el servidor y en la interfaz, con «Este pedido se cobra desde Celebraciones».
  - Ver, anotar, despachar y los pasos de retiro sí se permiten.
- **Cancelar:** un pedido despachado no se cancela, con el aviso «Un pedido despachado ya no se cancela: se reembolsa.». El panel ofrece «Reembolsar».
- **Editar:**
  - Solo se cambian los productos sin despachar, y solo se ofrecen variantes activas, con inventario controlado y stock mayor que 0.
  - El stock se comprueba en el servidor **solo cuando de verdad se va a escribir**:
    1. Inventario reenvía la edición a Celebraciones sin marca de stock.
    2. Celebraciones resuelve primero la clave. Si ya hay un recibo terminado, lo devuelve sin pedir stock: un reintento de una edición ya aplicada, que se llevó la última unidad, recibe su recibo y no un `NO_STOCK`.
    3. Si va a enviar una escritura nueva o un reintento, y la edición agrega productos o sube cantidades, responde 409 `STOCK_CHECK_REQUIRED` sin tocar Shopify.
    4. Inventario comprueba el stock. Si falta, responde 409 `NO_STOCK`. Si alcanza, repite la llamada con `actor.stockVerified: true`.
  - El navegador no puede saltarse el chequeo. `stockVerified` solo viaja en el actor que arma Inventario; el portal rechaza un `actor` del navegador, y un `stockVerified` dentro del cuerpo se ignora. La pasarela solo acepta `stockVerified` igual a `true` o ausente.
  - Un aumento de una línea existente necesita conocer su variante. Si Shopify no la entrega, solo se puede bajar la cantidad.
- **Retiro o envío:** se detecta por `shippingLine.deliveryCategory`, que contiene «pick», o porque el título dice retiro, pickup o Fulshear. Un pedido sin línea de envío cuenta como retiro.
- **Etapas:**

  | Etapa | Envío | Retiro |
  |---|---|---|
  | Por preparar | todavía no está despachado | todavía no está marcado listo |
  | Listo | despachado | marcado listo desde el panel |
  | Entregado | todos los envíos están en `DELIVERED` | entregado |

  Los pedidos cancelados no se muestran.
- **«Para hornear»:** suma `unfulfilledQuantity` por producto, y por sabor en el detalle, de los pedidos que no están entregados. No cuenta los de Celebraciones, que tienen su propio flujo.

## Permisos y contraseña

- **Transporte:**
  1. El navegador llama a `/apps/inventario/api/pedidos/...` (POST JSON con la sesión).
  2. Inventario autentica la sesión y comprueba el rol.
  3. Inventario llama por RPC a `StaffGateway.handle` de Celebraciones con `actor.aud = 'pedidos'`.
- **Rutas y audiencia:** la pasarela solo acepta las rutas de una lista explícita:
  - `GET /orders`
  - `GET /orders/<id>`
  - `POST /orders/<id>/(note|fulfill|ready|delivered|refund-preview|cash|refund|edit|cancel)`

  Un actor `pedidos` no entra a las rutas de Celebraciones, y un actor `celebraciones` no entra a `/orders`.
- **Roles:**
  - El rol `celebraciones` solo no ve «Pedidos» y recibe 403.
  - `inventario` ve, anota y despacha. Las acciones de dinero no aparecen, y si se fuerzan responden 403 `ROLE_REQUIRED` sin llegar a Celebraciones.
- **Contraseña (step-up):** cobrar, reembolsar, editar y cancelar exigen `admin` y la contraseña en cada acción.
  1. El navegador manda `password`.
  2. Inventario la verifica en `StaffIdentityStore.stepUp`: mismo hash, mismo contador `login:user:<id>` y mismo bloqueo de 15 minutos que el login. Con 5 fallos además cierra las sesiones, como en «Cambiar contraseña».
  3. Solo entonces reenvía el actor con `stepUp: true`.
- **La contraseña nunca sale de Inventario.** No se reenvía, no se guarda y no se registra.
  - El portal rechaza un `password` o un `actor` dentro del cuerpo.
  - La pasarela rechaza un actor con `password` o con un `stepUp` distinto de `true`.
- **Defensa en profundidad:** la pasarela, y también el servicio, responden 403 `STEP_UP_REQUIRED` en las acciones de dinero sin `admin` y `stepUp: true`.
- **Sin contraseña o con una equivocada:** responde 401 (`PASSWORD_REQUIRED` o `PASSWORD_INVALID`) sin ninguna llamada a Shopify.

## Idempotencia

Cada escritura lleva un `operationId`: un UUID que crea el navegador al confirmar. Celebraciones guarda un recibo por operación en su Durable Object (tabla `order_operations`) con estos campos:

- id
- acción
- pedido
- huella SHA-256 de {acción, pedido, parámetros}
- estado `pending`, `succeeded` o `failed`
- respuesta
- el plan exacto de la mutación
- el progreso de la escritura pendiente: hora del último intento e id del job de Shopify (`progress`)
- persona
- monto
- resumen
- fechas

El recibo no guarda datos de la clienta.

| Caso | Resultado |
|---|---|
| Misma clave y mismo contenido, ya terminada | Devuelve la respuesta guardada **sin llamar a Shopify** |
| Misma clave y otro contenido | 409 `OPERATION_REUSED` |
| Misma clave en `pending` (se perdió la respuesta) | **Primero lee el pedido en Shopify.** Si el cambio ya está, marca éxito sin reenviar. Si no se aplicó nada, reenvía exactamente el mismo plan guardado. Si hay una mezcla o cambios ajenos, termina como fallo 409 `REVIEW_REQUIRED`: «Revisa el pedido en Shopify antes de repetir». Nunca se infiere un éxito. |
| Doble toque | Las escrituras se procesan en fila, así que la segunda ve la primera ya terminada |

Cómo se concilia cada acción:

| Acción | Se da por hecha cuando… |
|---|---|
| Efectivo | el saldo es 0 (con el mismo saldo de antes, se reenvía) |
| Reembolso | hay un reembolso cuya nota lleva `panel <8 primeros caracteres del id>`, además de la clave `@idempotent` |
| Cancelar | el job de Shopify terminó (`job.done`) **y** el pedido tiene `cancelledAt`; ver abajo |
| Despachar | aparece el número de seguimiento |
| Entregado | el pedido está `FULFILLED` |
| Editar | cada cambio del plan guardado llegó a su cantidad objetivo, cada producto agregado aparece como línea nueva con **su variante y su cantidad**, y no hay cambios ajenos (líneas no tocadas con otra cantidad, líneas nuevas que el plan no pidió). Todo en el punto de partida → reintento. Cualquier otra cosa → `REVIEW_REQUIRED` |
| Listo para retirar | se reenvía, porque Shopify no expone una marca legible; como mucho se repite el aviso «listo» |

**Cancelar es asíncrono.** [`orderCancel`](https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderCancel) devuelve un `job { id done }`; el pedido se cancela y se reembolsa cuando ese job termina.

- Si `done` es `false`, el panel guarda el id del job, deja la operación en `pending` y responde 202 `{ state: 'processing', retryable: true }`.
- En el reintento, y también al abrir el detalle, consulta primero [`job(id:)`](https://shopify.dev/docs/api/admin-graphql/latest/queries/job) y después el pedido. Nunca reenvía `orderCancel` mientras el job siga pendiente.
- Job terminado y pedido con `cancelledAt` → éxito. Job terminado sin `cancelledAt` → fallo 409 `CANCEL_FAILED`: «Shopify terminó sin cancelar el pedido. Revisa el pedido en Shopify antes de repetir.». Job desconocido para Shopify y pedido sin cancelar → `REVIEW_REQUIRED`.
- **El reembolso de la cancelación** viaja en el mismo job. Si se pidió reembolso, el éxito exige además que el pago neto quede en 0. Si el pedido ya está cancelado pero el reembolso todavía no aparece, mientras el job siga en curso se espera. Con el job terminado, la operación termina con éxito y con el aviso «El pedido se canceló, pero Shopify todavía no muestra el reembolso. Revisa los pagos del pedido en Shopify.».
- Si se perdió la respuesta y no se conoce el id del job, no se reenvía hasta 2 minutos después del último intento (`CANCEL_SETTLE_MS`). Antes de eso, el reintento responde «procesando». Pasado ese tiempo, si el pedido sigue sin cancelar, se reenvía una vez el mismo plan.
- Mientras haya una cancelación en curso, el detalle muestra «Shopify está procesando la cancelación de este pedido.» y oculta «Cancelar pedido».

En la interfaz, la clave solo se descarta ante un rechazo que garantiza que Shopify no recibió el cambio: validación, permisos, monto o pedido distinto, stock, `userErrors` de Shopify o `OPERATION_REUSED`. En ese caso se corrige el formulario y el próximo intento usa una clave nueva.

- Contraseña equivocada o faltante: se conserva el mismo cambio y la misma clave, y solo se vuelve a pedir la contraseña.
- Sin respuesta, 5xx, 502 `REVIEW_REQUIRED` con `state: 'uncertain'` o 202 «procesando»: solo queda «Reintentar», sin «Volver» ni Escape. El reintento usa la misma clave y el mismo contenido. Es el mismo flujo que el resto del panel, con el plazo de 30 s de `staff-ui.js`.
- Otro 4xx que pueda venir de una operación ya registrada, como `REVIEW_REQUIRED` o `CANCEL_FAILED`: muestra el mensaje y conserva la clave. Se puede cerrar.

Qué dice Shopify sobre la idempotencia (consultado en shopify.dev, 2026-10):

- [`refundCreate`](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/refundCreate) admite `@idempotent(key:)` desde 2026-01 y lo **exige** desde 2026-04. El panel usa `@idempotent(key: operationId)`.
- [`orderMarkAsPaid`](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/orderMarkAsPaid), [`orderCancel`](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/orderCancel), [`fulfillmentCreate`](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/fulfillmentCreate), [`fulfillmentOrderLineItemsPreparedForPickup`](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/fulfillmentOrderLineItemsPreparedForPickup) y [`orderEditCommit`](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/orderEditCommit) no mencionan clave de idempotencia. Para ellas, la protección es el recibo con conciliación.
  - Además, `orderMarkAsPaid` exige saldo positivo, y `orderCancel` no deja cancelar dos veces.
  - `orderCancel` es asíncrono: devuelve un job, que se consulta con `job(id:)` antes de afirmar la cancelación.
- Página general: [Idempotent requests](https://shopify.dev/docs/api/usage/idempotent-requests): «Mutations that accept an @idempotent directive specify that they do in their descriptions».

## Nota interna e historial

- **Nota interna:**
  - No toca `order.note`. Esa nota de la clienta se muestra solo para leer, como «Nota del cliente».
  - La nota interna vive en Celebraciones (tabla `order_notes`): hasta 2000 caracteres, quién la guardó y cuándo.
  - Usa control de versión: si otra persona guardó antes, responde 409 `NOTE_CONFLICT` y muestra el texto nuevo.
- **Historial del pedido:** combina los eventos de Shopify con cada acción del panel. Para estas últimas indica quién, cuándo, qué y el monto, y marca «sin confirmar» o «no se aplicó» cuando corresponde.

## Límites conocidos y pendientes

- **Faltan permisos de despacho en la app de Celebraciones:** `read_merchant_managed_fulfillment_orders` y `write_merchant_managed_fulfillment_orders`.
  - El código ya está implementado. Mientras falten los permisos, Shopify responde `ACCESS_DENIED` y el panel muestra: «Falta un permiso de Shopify para despachar desde el panel. Mientras tanto, despacha desde el admin de Shopify.».
  - Lo demás sigue funcionando.
  - Agregarlos en `shopify.app.toml` y reautorizar le corresponde al coordinador con la dueña.
- **Variante de cada línea:** la app de Celebraciones no tiene `read_products`.
  - La lista de variantes con stock y la comprobación de stock usan el cliente sin conexión de Inventario (`read_products` y `read_inventory`).
  - La variante de cada línea se pide aparte y se tolera si falta. Sin ella, la edición solo permite bajar cantidades de esa línea.
- **Reembolsos:**
  - «Regresar al stock» devuelve al inventario las cajas no despachadas (`restockType: CANCEL`). Las ya despachadas se reembolsan sin regresar stock (`NO_RESTOCK`), porque `RETURN` exige una ubicación.
  - Se paga a la forma de pago original. El panel no muestra los últimos 4 dígitos de la tarjeta.
- **Editar:** el «Nuevo total» de la revisión es una estimación con precios unitarios. El total final lo calcula Shopify al guardar.
- **Lista:** cubre los últimos 60 días, hasta 150 pedidos. Si hay más, el panel lo avisa.
- **Pedidos con más de 100 líneas:** no se editan desde el panel.
- **Celebraciones con pago contra entrega:** sigue cobrándose desde su propio flujo.

## Pruebas

- `services/celebraciones/test/orders-service.test.mjs`: cliente, servicio y pasarela contra un Shopify simulado (`test/fake-shopify-orders.mjs`). En el simulador, `orderCancel` devuelve un job pendiente y cancela solo cuando el job termina. Cubre:
  - doble toque
  - respuesta perdida después de que Shopify aplicó el cambio
  - cancelación asíncrona: job pendiente sin reenvío, job terminado sin cancelar, reembolso que no aparece, job leído antes que el pedido, reenvío solo pasado el tiempo de espera
  - conciliación de edición por variante y cantidad, con mezcla y cambios ajenos → `REVIEW_REQUIRED`
  - stock pedido solo antes de escribir, nunca para un recibo
  - misma clave con otro contenido
  - topes de reembolso
  - Celebraciones
  - permisos
  - `ACCESS_DENIED`
  - que no haya salida a consola
- `services/inventario/test/pedidos.test.mjs`: portal, identidad y pasarela reales. Cubre:
  - roles
  - contraseña y bloqueo compartido con el login
  - que la contraseña no se reenvíe
  - stock al editar
  - reintento de una edición ya aplicada que consumió la última unidad: devuelve el recibo, no `NO_STOCK`
- `services/inventario/test/pedidos-ui-check.mjs`: navegador a 390×844 y 1440×1000 con las acciones a–g, la respuesta perdida en el cobro, un 503 en el reembolso que conserva la clave y la cancelación asíncrona («procesando» → «Reintentar» con la misma clave). Las capturas quedan en `docs/inventario/evidence/pedidos-*.png`.
