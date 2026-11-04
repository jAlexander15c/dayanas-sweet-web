# Cotizaciones sin cuenta — validación y puesta en marcha pendiente

## Cierre de QA y autorización de publicación

El usuario autorizó explícitamente completar pruebas, corregir y publicar. Worker de activación `d2e02f93-77d9-493d-9ac4-c23b9f1e0247`, GUEST_ENABLED=true, GUEST_QA_ENABLED=false. Tema QA no publicado 189886300464 validado antes del push.

- Solicitud real **DS-000001**, marcada PRUEBA QA / NO PREPARAR. Foto privada, comentario cliente, respuesta staff, recarga y acceso rechazado sin enlace comprobados.
- Correo de solicitud a info@dayanassweet.com: Delivered en Resend. Enlace recuperado del propio correo para continuar QA; capability nunca guardada ni impresa.
- Propuesta USD100 aceptada como invitado; checkout Shopify abierto sin login obligatorio con anticipo USD60. No se ingresaron datos de pago ni se realizó cargo; solicitud permanece quoted, no reservada. Comentario final marca prueba terminada y no preparar/cobrar.
- Evidencia sanitizada: production-browser-results.json y capturas real-propuesta-1440/390, real-checkout-1440. Vista móvil y escritorio sin overflow ni errores JS.
- 369/369 tests finales; check-theme: 41JS,69JSON,57esquemas; Theme Check:0errores,8advertencias existentes. Se normalizó codificación de evidencias JSON. Diff-check correcto.
- Revisión independiente Codex: sin bloqueantes nuevos y 30/30 pruebas focalizadas. No se ejecutó revisión Opus; se conserva esta limitación explícita.
- Pendiente inmediato tras push: verificar tema vivo y abrir enlace recibido desde navegador limpio sin preview.

**Actualización 2026-11-04 UTC:** bloqueo de correo resuelto con Resend, dominio verificado y correo propio de prueba **Delivered** según el proveedor. Worker final `0d825db1-7f23-46a7-863a-df5d2dc4cfd8`; invitados y endpoint de prueba apagados. 369/369 pruebas. Detalles y pendientes vigentes en [RESEND.md](RESEND.md). Los estados SMTP y versiones siguientes son históricos.

Trabajo aprobado el 3 de noviembre de 2026. Rama `jAlexander15c/cotizacion-invitados`, base `0c8840f`. Sin commits ni push. Despliegue del servidor y tema QA autorizado posteriormente por el usuario.

## Estado después del despliegue autorizado

- Worker final: `c62db31b-acca-4ea6-b226-a27ae48023e4`. `GUEST_ENABLED=false` y `GUEST_QA_ENABLED=false`; pagos y servicio conservan su configuración anterior. Panel `/admin/payment-status` autenticado: HTTP 200; endpoint temporal de correo desactivado: HTTP 503.
- Se creó `GUEST_ACCESS_KEY` aleatoria como Secret, sin mostrar ni guardar su valor. `SMTP_PASSWORD` preexistente no se leyó ni cambió.
- Tema no publicado `189886300464`, DS Celebraciones QA 20261103: solo archivos `ds-celebracion-*` y plantilla de solicitud. `guest_enabled=true` exclusivamente en esa plantilla remota QA. Tema en vivo sin cambios.
- Vista real Shopify sin sesión, 1440 y 390 px: campos de contacto visibles, sin desbordamiento ni errores JS. Evidencia `remote-browser-results.json` y `tema-qa-contacto-*.png`. La agenda y envío invitado están bloqueados por el flag del servidor; no se creó solicitud real ni se recorrió checkout.
- Suite final: **359/359**, sin omitidas; validación de tema: 41 JS, 69 JSON, 57 esquemas; `git diff --check` correcto. Theme Check oficial encontrado en CLI temporal: 0 errores y 8 advertencias existentes (`theme-check.json`).
- **Bloqueo SMTP confirmado**: la operación única `smtp-qa-20261103` agotó tres intentos previos a autenticación; estado `pending`. Error al conectar: `proxy request failed, cannot connect to the specified address`. DNS de `smtp.hostinger.com`: `172.65.255.143`, rango Cloudflare, destino TCP prohibido para Workers según su documentación. No hubo AUTH, DATA ni aceptación del correo. La contraseña no se pudo validar.
- No reintentar esta operación automáticamente. Para terminar correo se necesita transporte por API o puente SMTP fuera de Cloudflare. Cambiar puerto o contraseña no resuelve la prohibición de destino. No se contrataron ni configuraron otros servicios.
- Pendiente: resolver transporte, confirmar recepción real, recorrido invitado remoto completo y aprobación separada para activar/publicar. No se tocó Inventario ni sus ramas.

El registro siguiente describe la validación local anterior; los pendientes de clave, subida QA y Theme Check quedaron resueltos como se indica arriba.

## Implementado

- Solicitud sin cuenta con nombre, correo y teléfono; número único y enlace privado, fotos y conversación.
- Capability de 256 bits, hash de autenticación y acceso limitado a una solicitud. No se busca por correo ni por número. Se conserva el flujo autenticado.
- Solicitud, referencia, cuota y correo pendiente guardados en una transacción. Reintentos y reinicios conservan el resultado.
- Hostinger SMTP/TLS desde `info@dayanassweet.com`; enlace pendiente cifrado. Se elimina el cifrado al terminar o quedar incierto. SMTP no ofrece entrega exactamente una vez: una respuesta perdida tras DATA o un claim interrumpido queda `unknown`, sin reenvío automático.
- La agenda de alarmas procesa pagos y correo sin que una cola elimine la alarma de la otra.
- Pago invitado sin vinculación automática por correo; se valida la relación del draft/pedido persistido y todos los importes.
- Panel existente muestra referencia, contacto y estado del correo de la solicitud invitada.

## Comprobado antes del despliegue

- Base antes del cambio: 240 pruebas del servidor aprobadas.
- Suite conjunta final con `DS_QA_ROOT` apuntando al entorno temporal de pruebas: `node --test services/celebraciones/test/*.test.mjs tests/*.test.mjs`, 355/355 aprobadas, sin omitidas. Incluye dos procesadores concurrentes sobre store real y correo cifrado: un único envío SMTP simulado.
- `node tests/check-theme.mjs`: 41 JavaScript, 69 JSON y 57 esquemas válidos.
- `git diff --check`: correcto.
- Worker: empaquetado `wrangler deploy --dry-run` correcto, sin publicación.
- Chrome con Liquid real y servidor/store reales, firmas Shopify sintéticas y correo simulado: 1440 y 390 px, alta, foto privada, comentario, recarga, retirada del fragmento, rechazo del acceso en navegador sin enlace, sin desbordamientos ni errores JS. Ver `browser-results.json` y capturas.
- Pruebas adicionales de interfaz: 1180, 390 y 320 px, movimiento reducido, reintentos y recuperación de fotos al recargar, fallo de correo y portapapeles denegado.
- `wrangler secret list` confirmó únicamente los nombres: `SHOPIFY_APP_SECRET` y `SMTP_PASSWORD`. No se leyó su valor. Se resolvió el paquete keyring con `npm_config_prefix` solo en el proceso, sin modificar configuración global.
- Handshake de lectura desde esta máquina con smtp.hostinger.com:465: certificado válido, TLSv1.3 y AUTH PLAIN LOGIN anunciados. Solo EHLO/QUIT; no se intentó autenticación ni envío. No demuestra conectividad desde Cloudflare.

## Registro de pendientes al terminar la preparación local

- Revisión independiente terminada: cuota compartida corregida y verificada por el revisor (14/14 pruebas focalizadas); sin hallazgos importantes pendientes. La revisión aprobó preparación local con flags apagados, no activación.
- No se ha comprobado autenticación ni entrega real SMTP. No se enviaron correos.
- Falta configurar `GUEST_ACCESS_KEY`: 32 bytes aleatorios codificados en base64, tipo Secret, separada de la contraseña del buzón. No rotarla con correos pendientes; si se pierde, sus accesos cifrados no podrán enviarse (el enlace web sigue funcionando).
- `GUEST_ENABLED=false` en Worker y `guest_enabled=false` por defecto en el tema. La desactivación bloquea nuevas solicitudes, conserva el acceso privado a las existentes y el procesamiento de correos ya aceptados.
- Enlaces sin vencimiento automático en esta entrega. La columna `revoked_at` admite revocación en almacenamiento, sin interfaz de autoservicio ni recuperación por correo. Quien tenga el enlace puede acceder a esa solicitud.
- Cuotas conservadoras: 5 altas/hora por destinatario normalizado y 100/día globales. La revisión detectó que la IP del transporte puede compartirse detrás de Shopify; se corrigió el contrato para no bloquear a clientes independientes. No se confía en cabeceras IP aportadas por el cliente.
- Falta vista previa en tema Shopify no publicado y recorrido de checkout invitado real sin cobro real. La vista local no demuestra comportamiento de Shopify App Proxy ni de checkout.
- Shopify CLI no está en PATH: no se ejecutó Theme Check oficial.
- Toda subida a tema QA, despliegue Worker, envío real de prueba o publicación requiere la autorización correspondiente. No se tocó Dayana Inventario ni sus ramas.

## Reproducir la vista local

Instalar `playwright` y `liquidjs` en un directorio temporal y señalarlo con `DS_QA_ROOT`; Chrome debe estar instalado. Desde la raíz del worktree:

```powershell
node tests/guest-preview-server.mjs
# En otra terminal, con el mismo DS_QA_ROOT:
node tests/guest-browser-check.mjs
```

El servidor solo escucha en 127.0.0.1:8793 y usa SQLite en memoria. Las solicitudes de prueba no llegan a Shopify ni a Hostinger.

Referencias de transporte: [Hostinger SMTP](https://www.hostinger.com/support/4305847-set-up-hostinger-email-on-your-applications-and-devices/) y [Cloudflare TCP/TLS](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/). La compatibilidad documental no sustituye la prueba real pendiente.

## Registro de trabajo delegado

- `guest_backend`: gpt-6.1-sol/high; servidor, persistencia y pagos. Primera entrega 266/266; corrección de cuota 269/269. Autor original corrigió el hallazgo con regresiones rojo→verde.
- `guest_frontend`: gpt-6.1-sol/high; formulario, transporte y seguimiento. 41/41 pruebas focalizadas; revisión visual posterior del coordinador con Liquid real.
- `guest_review`: gpt-6-astra/high; revisión independiente sin edición. Hallazgo importante de cuota y menor de documentación, ambos resueltos; verificación final PASS. Esta revisión fue de Codex; no se ejecutó revisión Opus en esta sesión.
- Coordinador: SMTP, cifrado, alarmas, datos de contacto en panel, integración, 355/355 pruebas y navegador real. No se modificaron las otras ramas ni los archivos indicados por el coordinador de Inventario.
- Costo: no disponible. No se crearon commits. Los cambios externos posteriores están enumerados en el estado de despliegue al principio.
