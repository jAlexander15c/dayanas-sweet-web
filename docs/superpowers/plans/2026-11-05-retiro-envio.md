# Retiro y envío — plan y estado

**Objetivo aprobado:** elegir retiro gratis o envío antes de pagar, conservando las tarifas actuales de Shopify.
**Diseño aprobado:** `output/retiro-envio-propuesta.html` (usuario: «dale», luego «hazlo tu»).
**Arquitectura:** selección nativa en el checkout de Shopify. El tema informa de las opciones; no calcula tarifas ni simula la selección mediante atributos del carrito.
**Dirección en Shopify:** 4319 Freya Pointe Dr, Fulshear, TX 77441. El contexto anterior del proyecto la escribía «Point».

- [x] Activado y guardado el retiro gratuito en la ubicación existente 113932599600. Tarifas de envío sin cambios.
- [x] Usuario confirmó 24 horas. Comprobada disponibilidad de retiro en producto y checkout sin modificar inventario.
- [x] Actualizar los textos locales de contacto y preguntas frecuentes que niegan el retiro.
- [x] Ejecutar `node tests/check-theme.mjs` y revisar el diff: válidos 40 JS, 69 JSON y 54 esquemas; `git diff --check` sin errores (advertencias de conversión LF/CRLF). Se conservan los cambios preexistentes del formulario de contacto.
- [ ] Verificar retiro y envío en checkout, en desktop y mobile, sin completar un pago.

## Condiciones de entrega

No publicar el tema antes de activar y comprobar el retiro. No modificar tarifas, stock ni credenciales. No hacer push a main.

## Resultado de Shopify

Se recuperó el acceso mediante Chrome nativo. Shopify confirmó «Se guardaron los cambios». Checkout de escritorio comprobado: Envío y Retiro seleccionables; retiro GRATIS en 4319 Freya Pointe Dr y normalmente listo en 24 horas. El carrito de prueba mostró total $59.10 con envío Priority Mail Express y $24.00 con retiro. No se realizó pago. Se eliminó el único capuchino añadido para la prueba; se conservaron los cinco jugos verdes preexistentes.

Pendiente: comprobación móvil y publicación de los textos locales (no se realizó push ni despliegue). Shopify CLI no disponible en PATH. La funcionalidad de retiro ya está activa independientemente de los textos locales.
