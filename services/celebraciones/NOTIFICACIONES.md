# Correos de actualizaciones de la pastelera

Se encola un aviso cuando la pastelera guarda una propuesta, escribe un comentario o cambia el estado a `preparing`/`ready`. Las respuestas del cliente, los rechazos de validación y la repetición de una misma operación no crean avisos adicionales. Solo se notifican cambios realizados después de activar esta versión.

El evento y la modificación se guardan en una sola transacción SQLite. El Worker persiste una alarma antes de ejecutar esas rutas y procesa la cola sin depender de una pestaña abierta. La cola comparte el programador con pagos y el correo inicial, pero mantiene identificadores y estados independientes. No cambia la lógica de cobro ni confirma reservas por correo.

Para invitados se usa el contacto de la solicitud. Cada aviso incluye un acceso derivado mediante HMAC con separación de propósito; solo se guarda su hash. Los enlaces anteriores siguen funcionando y la revocación de la solicitud invalida todos. Para clientes con cuenta se consulta el contacto por el ID de Shopify guardado, usando el permiso `read_customers` existente; el enlace conserva la autenticación normal. El destinatario queda fijado antes del primer envío para mantener el mismo contenido en los reintentos. La consulta usa `customer` y `defaultEmailAddress.emailAddress` de Admin GraphQL 2026-10.

Los correos contienen el tipo de actualización y el enlace, sin copiar conversaciones ni fotos. Resend recibe un identificador estable por evento. Solo se reintentan fallos conocidos como temporales, hasta tres intentos; una aceptación incierta o una interrupción durante el envío queda `unknown` para evitar duplicados. Un problema de correo no elimina la actualización guardada. Los estados se conservan en `notification_jobs`; esta entrega no añade indicadores nuevos al panel.

## Validación local — 2026-11-03

Los cinco avisos incluyen ahora una alternativa HTML con la marca, colores rosados, número de solicitud y botón «Ver mi cotización». Se conserva el texto original como respaldo. El botón usa exactamente el enlace privado original, sin acortadores, imágenes externas ni seguimiento añadido. Todo texto variable se escapa antes de insertarlo en HTML. Diez vistas previas comprobadas en navegador: los cinco avisos a 390 y 1440 px, sin desbordamiento ni claves de acceso visibles en el texto. La apariencia final en un buzón real queda pendiente hasta publicar.

- Suite completa: 379/379 aprobadas (con `DS_QA_ROOT` apuntando al entorno existente de pruebas).
- `node tests/check-theme.mjs`: 41 archivos JS, 69 JSON y 57 esquemas válidos.
- Shopify Theme Check: 0 errores y las 8 advertencias preexistentes del tema.
- `git diff --check`: correcto.
- Wrangler `deploy --dry-run`: correcto, sin desplegar.
- Prueba integrada en workerd/Miniflare con el Worker real y SQLite Durable Objects: propuesta y mensaje programan alarmas, envío único ante replay y enlaces de invitado funcionales. Solo la frontera HTTP externa de Resend se simula; no se enviaron estos avisos a buzones reales durante esta validación.
- Revisión independiente Codex: sin hallazgos bloqueantes/importantes; 59/59 comprobaciones focalizadas. Opus no estaba disponible en esta sesión.

Pendiente: publicación autorizada y comprobación de entrega real de los avisos nuevos. Esta modificación no cambia el tema ni requiere nuevas claves, servicios o permisos.

Referencia de la consulta: https://shopify.dev/docs/api/admin-graphql/2026-10/queries/customer
