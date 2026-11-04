# Revisión integral de Celebraciones

Fecha local: 2026-11-03. Versión revisada: `69da8d4`, publicada. Auditoría funcional y técnica; sin modificaciones al comportamiento ni publicación adicional. Los escenarios financieros adversos se reprodujeron en memoria con Shopify simulado, sin cobros ni cambios en pedidos reales.

## Resultados prioritarios

### 1. Alta: se puede iniciar un anticipo después de la fecha de recogida

La fecha solo se valida al crear la solicitud (`services/celebraciones/src/store-core.mjs:80`). `accept` (línea 576) y `claimPayment` (línea 436) no vuelven a comprobarla. Tampoco existe vencimiento en la propuesta, aunque el formulario lo promete (`sections/ds-celebracion-solicitud.liquid:108`).

Reproducción: crear solicitud válida para dentro de 14 días; enviar propuesta; avanzar el reloj 30 días; aceptar y solicitar primer pago. Resultado: aceptación permitida y `payment.stage=deposit` con URL. Comprobado con el fixture financiero existente, sin aceptar previamente ni generar draft antes del cambio de reloj. Script local: `C:/Users/Milton/AppData/Local/Temp/dayanas-expiry-audit.mjs`.

Corrección: definir vencimiento y revalidar fecha/vigencia al aceptar y antes del anticipo inicial. Conservar un tratamiento separado para saldos de pedidos ya pagados o preparados: no bloquear automáticamente el cobro de deudas existentes.

### 2. Alta: una propuesta modificada puede dejar sin salida el pago inicial

`services/celebraciones/src/payment-service.mjs:195` devuelve `DRAFT_PROPOSAL_CHANGED` si existe draft sin pagar y la propuesta aceptada ya tiene otra versión.

Reproducción independiente: aceptar USD 100 → generar enlace de anticipo USD 60 → aceptar propuesta nueva USD 110 → conciliar tres veces. Resultado constante: `stage=review`, `url=null`, sin recuperación disponible en el panel. El draft antiguo sigue existiendo.

Corrección: recuperación segura del intento anterior, contemplando pagos concurrentes y enlaces viejos. Como contención, impedir el ajuste en ese estado con explicación y procedimiento efectivo. No sustituir o borrar drafts sin verificar su situación.

### 3. Media: preparar permite continuar tras devolver todo el anticipo

`services/celebraciones/src/store-core.mjs:608` no valida fondos para pasar a `preparing`; `http.mjs` fuerza conciliación antes de `ready`, pero no antes de iniciar preparación.

Reproducción independiente: anticipo USD 90 confirmado → devolución completa confirmada → conciliación muestra recibido USD 0, conservando estado `reserved` → marcar preparación funciona.

Corrección: conciliar y validar los requisitos financieros al iniciar preparación, o diseñar una excepción explícita y auditable. No alterar automáticamente la historia de pagos ni los pedidos ya preparados.

### 4. Media: desaparecen solicitudes antiguas del listado al superar 100

`services/celebraciones/src/store-core.mjs:518` limita el listado a las últimas 100 por creación; `admin-ui.js:350` retira de su estado los IDs ausentes. No existe paginación ni búsqueda.

Reproducción independiente: 101 solicitudes de clientes distintos. La primera sigue almacenada en estado `requested`, pero queda fuera del listado del personal.

Corrección: paginación y búsqueda por referencia, con acceso estable a solicitudes pendientes. No se han perdido datos; el problema es su acceso desde el panel.

### 5. Media: los errores de correos de actualización no son visibles

`services/celebraciones/src/store-core.mjs:235` devuelve el estado del correo inicial exclusivamente. Los estados de `notification_jobs` no llegan al panel.

Reproducción independiente: correo inicial `sent` → comentario de pastelera cuyo transporte devuelve `failed`. La solicitud conserva `emailStatus=sent`, no muestra la notificación fallida y no queda otro intento programado.

Corrección: estado por aviso y resolución desde el panel. Distinguir aceptación del proveedor de entrega efectiva; revisar los resultados ambiguos antes de reenviar para no duplicar correos.

### 6. Media: el horizonte de reservas supera el acceso a pedidos de Shopify

El formulario/servidor permite recogidas hasta 366 días (`store-core.mjs:80`), pero la app en producción no tiene `read_all_orders`. Comprobación real de solo lectura: `/admin/payment-status` devuelve `configured=true`, `mode=REAL`, `currency=USD`, scopes `read_orders`/`write_orders`, sin `read_all_orders`.

Shopify documenta que solo se accede por defecto a pedidos de los últimos 60 días: [consulta Order](https://shopify.dev/docs/api/admin-graphql/latest/queries/order). Por tanto, un pedido creado al cobrar el anticipo puede quedar fuera de acceso antes de recoger el pastel, afectando la conciliación, el saldo o el marcado como listo. Esto es una incompatibilidad de configuración y horizonte; no se probó contra un pedido antiguo real.

Corrección: obtener el acceso correspondiente o ajustar el horizonte operativo. Requiere decidir la política y, si se amplían permisos, autorización expresa para cambiar la configuración de la app.

## Detalles de interfaz confirmados

7. **Sesión de cliente vencida sin acción de acceso:** el seguimiento muestra «Inicia sesión para consultar tu pastel», pero no tiene un enlace de inicio de sesión dentro de ese flujo. Reproducido interceptando una respuesta 401 en la vista local. Añadir acceso que preserve la solicitud y distinguirlo del caso invitado que necesita su enlace privado completo.

8. **Apartado vacío de cambios:** si la pastelera no escribe cambios, permanece visible «Lo que cambia respecto a tu foto» sin contenido (`assets/ds-celebracion-seguimiento.js:205`, `sections/ds-celebracion-seguimiento.liquid:69`). Reproducido en móvil. Ocultarlo o mostrar «Sin cambios respecto a tu referencia».

Reproducciones de interfaz: `C:/Users/Milton/AppData/Local/Temp/dayanas-ui-audit.mjs`.

## Comprobaciones y límites

- Suite completa existente: **379/379 aprobadas**. Estos nuevos escenarios no estaban cubiertos por esa suite.
- Revisión independiente del backend: **294/294 pruebas aprobadas**, más reproducciones específicas de los hallazgos 2–5. Sin nuevos hallazgos de aislamiento entre invitados, destinatario o duplicación de correos en lo revisado.
- Validación de tema: 41 JavaScript, 69 JSON, 57 esquemas correctos.
- Vista previa de formulario y panel a 390 y 1440 px: obligatorios, mensajes rojos, notas opcionales y retorno conservando borrador funcionan, sin desbordamiento.
- Diez vistas previas de correo: cinco eventos en móvil y escritorio; botón con enlace original y sin mostrar la clave privada como texto.
- Publicación anterior comprobada: correo real de actualización entregado a la dirección de pruebas del negocio y botón privado funcional después de recargar; formulario y botón Volver publicados verificados.
- Esta auditoría consultó configuración real, pero no cobró, reembolsó ni modificó solicitudes de clientes. Los escenarios de pagos adversos se simularon localmente. No sustituye una prueba de cobro real, ni certifica el renderizado en todos los clientes de correo.
- No se cambiaron permisos, credenciales ni configuración global. No se publicó ninguna corrección nueva durante la auditoría.

## Correcciones posteriores a la auditoría

Preparadas en la rama `jAlexander15c/cotizacion-invitados`, sin publicación nueva:

- Vencimiento de propuesta y anticipo inicial: validación al aceptar y pagar; conciliación conservada para pedidos ya pagados. La revisión independiente añadió cobertura del enlace vencido en lecturas, repeticiones y páginas abiertas.
- Propuesta con checkout inicial pendiente: se consulta Shopify antes de permitir cambios; si sigue sin pago, se bloquea el cambio con explicación. Un desajuste antiguo queda en revisión. No se reemplazan ni cancelan drafts automáticamente: un enlace abierto fuera de la app puede seguir siendo pagable en Shopify y requiere intervención manual.
- Preparación: conciliación previa y comprobación del anticipo neto requerido. Un anticipo totalmente reembolsado no permite iniciar preparación.
- Listado: paginación y búsqueda por referencia, identificador o nombre, conservando los borradores de edición.
- Correos: estado individual de las actualizaciones y reintento de fallos confirmados. Los resultados ambiguos requieren revisar Resend para evitar duplicados; «Aceptado» no significa entrega al destinatario.
- Seguimiento: acceso a la sesión conservando la solicitud, instrucciones diferenciadas para invitados y texto para propuestas sin cambios.

Resuelto con autorización explícita del usuario: se añadió `read_all_orders` en la versión activa `celebraciones-pedidos-antiguos` de Dayana Celebraciones y se confirmó «Todos los pedidos» en la instalación de la tienda. La consulta real de `/admin/payment-status` confirmó `configured=true`, `mode=REAL`, `currency=USD`, `missingScopes=[]` y `read_all_orders` entre los permisos concedidos. Se conserva el horizonte de reservas de hasta un año. No se consultó un pedido real de más de 60 días: la verificación fue del permiso efectivo concedido al servicio.

La consulta real encontró una solicitud en revisión que corresponde a «PRUEBA TÉCNICA 2 — NO ELABORAR», creada anteriormente en modo TEST y pagada con tarjeta de prueba. No se modificó ni se intentó cobrar de nuevo en modo REAL.

Las comprobaciones de interfaz de esta corrección usan datos sintéticos a 390 y 1440 px; los escenarios financieros usan Shopify simulado. La publicación y la comprobación del nuevo código en el tema remoto siguen pendientes.

Verificación final local: **411/411 pruebas aprobadas**, sin omisiones, ejecutadas con `--test-concurrency=1` después de que la ejecución simultánea agotara la memoria del equipo. Panel a 390 y 1440 px: paginación, búsqueda, reintento de fallo confirmado, protección de envío ambiguo y fondos requeridos para preparación aprobados. `check-theme`: 41 JavaScript, 69 JSON y 57 esquemas correctos; `git diff --check` sin errores. Theme Check: cero errores y ocho advertencias preexistentes.
