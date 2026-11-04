# Cotización sin cuenta y entrega por web y correo

Estado: maqueta aprobada por el usuario el 2026-11-03. Implementada localmente, pendiente de validación externa y publicación autorizada.

## Experiencia

Se conserva el formulario actual de pastel, referencias y fecha. En contacto, el invitado introduce nombre, correo y teléfono; no se exige crear cuenta. Al guardar recibe una referencia única, por ejemplo DS-000123, y un enlace privado para consultar la propuesta, comentar, aceptar ajustes y pagar en Shopify. La confirmación muestra que la solicitud todavía no reserva la fecha. Se entrega el mismo acceso por correo, con asunto «Recibimos tu solicitud DS-000123».

La web permite abrir el seguimiento y copiar su enlace. Si el envío falla, la solicitud permanece guardada y el acceso web funciona; no se afirma que el correo llegó. No se incluyen fotografías ni comentarios privados en el correo. Recuperación por número solo nunca revela una solicitud.

## Correo vigente (Resend, aprobado por el usuario)

El usuario eligió Resend Free tras confirmar el bloqueo de SMTP Hostinger desde Workers. Envío HTTPS, remitente y Reply-To info@dayanassweet.com, clave RESEND_API_KEY Secret. Dominio verificado mediante tres registros adicionales; recepción, nameservers y buzón siguen en Hostinger. Idempotency-Key estable por solicitud; tracking de clics/aperturas sin activar. Outbox cifrado existente. Respuestas ambiguas de clientes siguen unknown sin reenvío automático. Estado sent significa aceptación del proveedor; la prueba propia fue Delivered y el usuario confirmó recepción.

## Propuesta inicial de correo (sustituida)

Hostinger SMTP, remitente y usuario info@dayanassweet.com, smtp.hostinger.com:465 con TLS. El usuario confirmó SMTP_PASSWORD guardado como Secret y se verificó su nombre mediante Wrangler, sin leer el valor. Sin suscripción nueva ni cambios de DNS. Clave adicional GUEST_ACCESS_KEY (32 bytes base64) para cifrar el acceso pendiente; se configura al activar, no se incluye en Git. SMTP no ofrece idempotency key del proveedor: después de una entrega ambigua no se reintenta automáticamente; queda estado unknown para revisión. Confirmación SMTP indica aceptación por servidor, no entrega a bandeja.

## Acceso y persistencia

- Conservar endpoints autenticados y solicitudes existentes.
- Verificar firma App Proxy incluso para visitante sin customerId, únicamente en rutas guest nuevas.
- Número único asignado en la misma transacción que crea la solicitud; reintentos reutilizan operación y número.
- Capability aleatoria256bits por solicitud. Persistir hash; acceso limitado a esa solicitud. Transportarla por fragmento del enlace y cuerpos POST, nunca como query del proxy ni registro de diagnóstico. Sin dependencia de cookies del proxy.
- La entrega por correo necesita outbox cifrado con secreto dedicado; no guardar token en texto claro. Guardar solicitud y outbox atómicamente, usar Message-ID estable y reintentos limitados únicamente ante fallo inequívoco anterior a aceptación. No reenviar tras respuesta ambigua.
- Validación de contacto, límites de tamaño, honeypot y límites de creación/envío/fotos. Las fotos conservan controles de tipo y tamaño actuales.
- No asociar una solicitud a una cuenta existente sólo porque alguien escribió su correo.

## Pagos

Separar dueño guest de customerId financiero. Draft guest puede omitir purchasingEntity; vincular pedido exclusivamente al draft persistido y tags propios. Mantener anticipo60%, saldo40%, ajustes, dinero confirmado por Shopify y ausencia de reembolsos automáticos. No añadir permisos write_customers para buscar/crear clientes por correo. Confirmar checkout invitado antes de activar.

## Entrega

Implementar detrás de bandera desactivada. Probar migración de datos, aislamiento entre enlaces, autenticados existentes, reintentos, outbox y pagos invitado. Validar en tema no publicado, desktop/móvil y correo de prueba al destinatario autorizado. Publicación sólo cuando estén operativos tanto web como correo; conservar rollback que desactive nuevas solicitudes guest sin perder las creadas.


## Contrato de implementación acordado entre componentes

- GUEST_ENABLED=false por defecto en Worker y guest_enabled=false en secciones Liquid. Acceso a solicitudes guest existentes continúa si se desactiva creación.
- POST /proxy/guest/calendar con {} entrega calendario público (firma Shopify y origen válidos).
- POST /proxy/guest/requests: {input, contact:{name,email,phone}, capability, operationId, website:""}. capability es 32 bytes criptográficos generados en navegador como 64 hex minúsculos; persistir solo hash en autenticación y cifrado AES-GCM en outbox. Reintento con misma capability y operationId devuelve la misma solicitud/referencia. Honeypot website no vacío se rechaza.
- POST /proxy/guest/requests/:id/tracking, comments, accept, payment, payment-sync: body incluye capability y campos normales (tracking solo capability). No listar solicitudes guest ni buscar por correo o número. Token nunca en query ni logs.
- POST /proxy/guest/requests/:id/photos: {capability, name, mimeType, base64, operationId}, máximo 2MB decodificados y 3 fotos. Lectura POST /proxy/guest/requests/:id/photos/:photoId con {capability} devuelve bytes; interfaz usa blob URL privado.
- Snapshot mantiene campos actuales más reference DS-000001, contact y emailStatus (pending/sent/failed/unknown). Creación responde snapshot; UI ya conoce capability y construye enlace /pages/seguimiento-de-tu-pastel?solicitud=<id>#acceso=<capability>. Capturar fragmento al cargar, limpiar URL visible y conservar solo sessionStorage para navegación/recarga.
- Backend ofrece store.createGuestRequest({shop},input,contact,capability,operationId,{encryptedAccess,now}), store.authenticateGuest(shop,id,capability), store.getGuestEmailJobs(shop,now,limit), store.claimGuestEmail(shop,id,now), store.finishGuestEmail(shop,id,{status,nextAttemptAt,now}), store.nextGuestEmailDue(shop). Job contiene id,reference,contact,encryptedAccess,attempts. No exponer encryptedAccess/hash en snapshots.
- createHandler recibe guestEmail:{seal(capability):Promise<string>,wake():Promise<void>} y config.guestEnabled. Mail worker usa AES-GCM con GUEST_ACCESS_KEY y SMTP_PASSWORD; si falta configuración creación falla cerrada. Calendario solo con creación habilitada.
- Límites durables: 5 creaciones/hora por hash del destinatario normalizado (trim y minúsculas, prefijo guest-recipient-v1:), 100 globales/día. Reintentos no consumen otra creación. No usar cabeceras IP como identidad de confianza. Ruling: la IP del peer Cloudflare puede ser compartida por compradores tras Shopify; el límite por destinatario evita bloquearlos y limita abuso contra un buzón.
- Pagos guest: customerId financiero null; no buscar/asociar cliente por email. Validar draft/pedido por ID persistido y tags propios; mantener validaciones monetarias. Email puede usarse para contacto checkout sin conceder acceso.
