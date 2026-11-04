# Avisos de respuestas y pagos para la pastelera

El usuario eligió ambos canales: correo y panel. Maqueta: `docs/maquetas-celebraciones/avisos-pastelera.html`, presentada como imagen y aprobada con «Si dale». Destinatario confirmado: Dayanaoramasgalano@gmail.com.

## Comportamiento

- Confirmación visible al enviar propuesta (corrección local ya probada). No afirmar entrega del correo por haber guardado la propuesta.
- Avisos privados para personal autorizado cuando un cliente añade un comentario y cuando Shopify confirma un nuevo importe recibido. No avisar por una mera apertura del checkout ni repetir al sincronizar.
- Bandeja persistente con contador de no leídos, fecha, referencia, abrir solicitud y marcar leído. Actualización periódica solo con panel visible; conservar borradores y no mover el foco al recibir avisos.
- Un correo por evento nuevo hacia un destinatario de la tienda confirmado por el usuario; nunca aceptar destinatarios desde un payload del cliente. Enlace al panel autenticado, sin enlaces privados de cliente ni datos de tarjeta.
- Usar cola durable y transporte existente con clave idempotente. Distinguir pendiente, aceptado por proveedor, fallido y resultado incierto. No reenviar automáticamente resultados inciertos.
- Los eventos se registran junto a la mutación correspondiente. Los avisos no modifican la contabilidad ni la lógica de cobro. No generar avisos retroactivos al desplegar.

## Validación prevista

Pruebas de autorización, aislamiento por tienda, idempotencia de comentario/pago, repetición de sincronización, pagos parciales, reintentos del proveedor, persistencia y no exposición al cliente. Comprobación de interfaz móvil/desktop y borradores durante actualización. Sin correos reales, cargos ni despliegue durante desarrollo.

## Publicación

El usuario autorizó esta publicación con «si publicalo». Worktree aislado; se conserva 30ed6e4 (cambio de inicio desde Shopify) y se coordina con Claude. No se modifican archivos de Inventario ni datos de la tienda.
