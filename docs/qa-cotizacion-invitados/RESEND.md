# Cambio autorizado a Resend

## Completado 2026-11-04 UTC

- Dominio verificado; tres registros DNS en Hostinger. MX, SPF raíz, Shopify y nameservers preservados. Recepción y tracking de Resend sin activar.
- Usuario guardó `RESEND_API_KEY` como Secret; se comprobó su nombre, sin leer el valor.
- Worker final `0d825db1-7f23-46a7-863a-df5d2dc4cfd8`, GUEST_ENABLED=false y GUEST_QA_ENABLED=false.
- Prueba única `resend-qa-20261103`: respuesta `sent`; panel de Resend muestra **Delivered** a info@dayanassweet.com, asunto **Prueba de correo de cotizaciones**. No se ha comprobado ubicación en bandeja frente a spam.
- 369/369 pruebas aprobadas, incluidas construcción real de Request con workerd/Miniflare y límites de reintentos. Check-theme y diff-check correctos.
- La prueba detectó redirect:error incompatible con Workers. Se corrigió a manual, sin seguir redirecciones. Regresión reproducida fallando en workerd y verificada después.
- La prueba SMTP anterior se conserva en su registro. El test de Resend usa registro por transporte. Los conflictos se lanzan fuera de blockConcurrencyWhile para no reiniciar el Durable Object.
- Solo el test manual de Resend permite reintentar el mismo operationId incierto hasta 3 veces, con 60 s de separación y dentro de 23 h desde el primer intento, cubierto por Idempotency-Key de Resend (24 h). No hay reenvío automático de jobs de cliente ambiguos.
- Pendiente: recorrido remoto invitado completo antes de activar la función pública. No se publicó tema/main.

Los pasos siguientes son el procedimiento de configuración original; dominio, clave, despliegue y prueba propia ya se completaron.

El usuario eligió Resend gratuito después del bloqueo TCP de Hostinger. No autoriza contratar planes de pago ni publicar el tema en vivo.

## Configuración pendiente en la cuenta

1. Crear/iniciar sesión en Resend Free.
2. Añadir `dayanassweet.com` como dominio de envío y copiar únicamente los registros que muestre esa cuenta en Hostinger. Mantener los MX de recepción de Hostinger en la raíz. No habilitar recepción en Resend ni mover nameservers. No inventar valores DKIM/SPF.
3. Desactivar seguimiento de aperturas y clics: el enlace contiene una credencial privada.
4. Crear API key con permiso Sending access limitado al dominio. Guardar directamente como `RESEND_API_KEY`, Secret, en el Worker `dayanas-celebraciones`. No pegarla en chat, archivos ni logs. No rotar `GUEST_ACCESS_KEY`.
5. Desplegar el cambio del servidor con invitados desactivados. Para la prueba autorizada al buzón propio, activar temporalmente GUEST_QA_ENABLED y usar `resend-qa-20261103` en el registro independiente de Resend. No borrar el registro. Una vez aceptada, no reenviar. Desactivar el endpoint después.
6. Confirmar recepción real y completar el recorrido invitado antes de activar la función pública.

## Implementación local

- HTTPS a `https://api.resend.com/emails`; remitente y Reply-To fijos `info@dayanassweet.com`.
- Usa el mensaje de texto ya generado, conserva cifrado del enlace y estados del outbox. No envía fotos ni comentarios.
- Idempotency-Key estable derivada del Message-ID; timeout 12 s. Resend deduplica por 24 h. Conservamos política conservadora: timeout, fallo de red, 5xx o respuesta ambigua quedan `unknown`, sin reenvío automático incluso fuera de esa ventana; solo 429 explícito queda pendiente para reintento limitado.
- `sent` significa aceptación por Resend, no entrega confirmada al buzón.
- El Worker requiere RESEND_API_KEY, sin fallback automático al SMTP bloqueado. Código SMTP anterior sigue disponible para pruebas históricas pero no se utiliza en el Worker.
- Sin cambios de UI, checkout ni Inventario. SMTP_PASSWORD no se lee ni se elimina.

Fuentes: https://resend.com/docs/api-reference/emails/send-email y https://resend.com/docs/dashboard/emails/idempotency-keys
