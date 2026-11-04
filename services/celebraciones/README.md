# Servicio de celebraciones

## Avisos privados para la pastelera

La bandeja **Avisos** muestra respuestas nuevas de clientes (incluidos invitados) y pagos confirmados por Shopify. Se actualiza cada 30 segundos con el panel visible sin reemplazar borradores. **Ver solicitud** abre el detalle; **Marcar leído** conserva el aviso en el historial. Se muestran hasta 50 avisos, con prioridad para los no leídos.

Los mismos eventos generan correos a **Dayanaoramasgalano@gmail.com**, destinatario confirmado por el usuario. El enlace abre el panel autenticado de Shopify. El estado del correo distingue pendiente, aceptado por el proveedor, fallido y envío incierto; aceptado no significa leído. Los reintentos conocidos son limitados y un resultado incierto no se reenvía automáticamente. Marcar leído no cancela el correo.

Los pagos aparecen después de la reconciliación existente con Shopify (normalmente cada cinco minutos, o al actualizar el estado del pago). Abrir un checkout no confirma un pago. Cada transacción genera como máximo un aviso; los pagos anteriores a esta función quedan excluidos. Los registros manuales contra entrega realizados por la pastelera no generan un aviso de pago Shopify.

Backend con persistencia SQLite y autenticación Shopify. Instalado y probado con una cuenta real de Shopify y pagos ficticios. Actualmente está limitado a la cuenta piloto mediante `PAYMENTS_MODE=TEST` y `TEST_CUSTOMER_IDS`; el tema público aún no está activado. Estado y operación: [CLOUDFLARE.md](CLOUDFLARE.md).

## Qué implementa

- Solicitudes del cliente, lectura privada y comentarios persistentes.
- Cotizaciones publicadas por personal autorizado, aceptación versionada y operación idempotente.
- Acceso del cliente por App Proxy firmado; acceso de pastelera por token de sesión Admin firmado y lista de personal autorizado.
- Estado de pedido comprobado dentro de transacciones. Aceptar una cotización no marca la reserva como pagada.
- Transporte del tema en `assets/ds-celebracion-servicio.js`, desactivado por defecto en la sección.
- Fotos privadas, agenda abierta/cerrada por fecha y validación de recogida en America/Chicago.
- Modalidad por propuesta (`paymentMode`): `deposit` (60/40 en Shopify), `full` (100 % en Shopify), `delivery` (contra entrega registrado por staff en Celebraciones). Legacy sin campo: normales60/urgentes100; estados Shopify existentes mantienen su representación. Conciliación online mediante transacciones confirmadas y alarmas persistentes.
- Desarchivo de pedidos propios antes de añadir el saldo, con `write_orders` autorizado. No modifica los ajustes generales de preparación/archivo.

## Ejecutar pruebas

Desde la raíz del repositorio:

```powershell
node --test services/celebraciones/test/*.test.mjs
node --test tests/celebracion-seguimiento.test.mjs tests/celebracion-transporte.test.mjs
node tests/check-theme.mjs
```

El servidor Node local usa `node:sqlite` (experimental en Node 22.14). Cloudflare usa `src/cloudflare-worker.mjs` y `src/durable-store.mjs` sobre SQLite de Durable Objects. Ambos comparten las reglas de `src/store-core.mjs`. Se probaron el runtime local y el recorrido real de solicitud, propuesta, aceptación, pagos ficticios y seguimiento a través de Shopify.

## Configuración requerida para conectar

El proceso lee variables de entorno; no escribe ni proporciona valores de credenciales:

| Variable | Uso |
| --- | --- |
| `SHOPIFY_APP_SECRET` | Secreto de la app, solo servidor |
| `SHOPIFY_SHOP` | Dominio canónico `nombre.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | Identificador de la app para validar audiencia |
| `STOREFRONT_ORIGIN` | Origen HTTPS exacto de la tienda, sin barra final |
| `SHOPIFY_STAFF_IDS` | IDs de personal autorizados separados por comas; vacío deniega el panel |
| `SERVICE_ENABLED` | Habilita las rutas del cliente; no sustituye autenticación ni allowlist |
| `PAYMENTS_ENABLED` | Habilita la integración de pagos |
| `PAYMENTS_MODE` | `TEST` o `REAL`; valida el modo de las transacciones Shopify |
| `TEST_CUSTOMER_IDS` | Clientes piloto permitidos en TEST; vacío deniega todos |
| `CELEBRACIONES_DB` | Ruta persistente de SQLite fuera del tema y de rutas públicas |
| `PORT` | Puerto local, predeterminado8787 |

Con variables ya configuradas de forma segura: `node services/celebraciones/src/server.mjs`. Escucha únicamente en127.0.0.1; para Shopify requiere alojamiento/proxy HTTPS, disco persistente, copias de seguridad, límites de tráfico y app instalada. No imprime secretos ni cuerpos de solicitudes.

No introducir claves en el chat, archivos Liquid, assets, enlaces ni git. No usar una sesión del cliente para administrar propuestas.

## Rutas

Proxy de Shopify `/apps/celebraciones` → URL HTTPS del servicio con prefijo `/proxy`.

- `POST /proxy/requests`: `{ input: { requestText, pickup: { label } }, operationId }`.
- `GET /proxy/requests/:id`: snapshot autorizado.
- `POST /proxy/requests/:id/comments`: `{ text, operationId }`.
- `POST /proxy/requests/:id/accept`: `{ proposalVersion, operationId }`.
- `POST /proxy/requests/:id/payment`: `{ operationId }`; crea o recupera checkout autorizado.
- `POST /proxy/requests/:id/payment-sync`: `{ operationId }`; concilia con Shopify.
- `GET /admin/payment-status`: comprueba scopes, moneda y conexión con diagnóstico seguro.
- `GET /admin/requests/:id`: requiere sesión Admin y personal autorizado.
- `POST /admin/requests/:id/comments`: `{ text, operationId }`.
- `POST /admin/requests/:id/proposals`: `{ proposal, operationId }`; el servidor asigna versión y total.
- `POST /admin/requests/:id/status`: `{ status, operationId }`; contra entrega permite preparar y marcar listo con deuda pendiente, las demás modalidades requieren conciliación Shopify para listo.
- `POST /admin/requests/:id/delivery-payment`: `{ proposalVersion, operationId }`; solo staff autorizado, saldo calculado en servidor, idempotencia y versión vigente sin propuesta pendiente. Registro local de recibido, sin transacción Shopify; disponible incluso después de listo. La aceptación contra entrega reserva si la fecha está disponible. El registro conserva fuente y fecha; `operations.principal` identifica al staff que confirmó.

Las mutaciones usan JSON salvo la carga binaria de fotos. El navegador del cliente no envía identidad, precio aceptado ni pagos. El servidor verifica la firma de Shopify y la propiedad en cada llamada. Los cambios del cliente requieren `Origin` igual al configurado; el recorrido real del proxy ya se comprobó en el piloto.

La API privada acepta únicamente los cinco parámetros firmados de Shopify (`signature`, `shop`, `logged_in_customer_id`, `path_prefix`, `timestamp`). No añadir parámetros arbitrarios: el formato canónico de firma usa concatenación sin separadores. Si Shopify añade un parámetro, la API rechazará la solicitud hasta revisar explícitamente esa compatibilidad.

El formulario valida `details` en servidor, incluyendo fecha, anticipación, horario y composición del pastel. `pickup.label` es descriptivo y por sí solo no valida una reserva. La agenda cerrada bloquea solicitudes nuevas; los pedidos existentes se conservan.

## Activación pendiente

1. Terminar la comprobación de ajustes de precio conservando pagos confirmados.
2. Preparar páginas y enlaces de navegación con las plantillas propias y activar «Servicio conectado» en el tema destinado a publicación.
3. Pasar el servicio a REAL únicamente en la puesta en marcha autorizada. Mantener Shopify Payments fuera del modo de prueba.
4. Publicar después de la validación del tema y la autorización correspondiente. Enlace de seguimiento: página asignada a la plantilla con `?solicitud=<id>`.

La autorización para desarrollar no reemplaza la comprobación de la configuración real. Nunca declarar el sistema operativo por haber pasado únicamente las pruebas locales.
