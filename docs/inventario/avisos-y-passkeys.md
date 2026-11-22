# Avisos por correo a Dayana y entrada con Face ID o huella

## Avisos por correo (Celebraciones)

Los correos van a la dirección fija de `staffRecipient` (`services/celebraciones/src/staff-alerts.mjs`), desde `info@dayanassweet.com`. El correo nunca lleva datos de la clienta: ni el nombre, ni el contacto, ni el texto de los mensajes. Trae solo la referencia, los montos o la fecha pedida, y el enlace al panel, que pide iniciar sesión.

| Evento | Asunto | Cuándo |
|---|---|---|
| Solicitud nueva | «Nueva solicitud de pastel · DS-…» | Al crearla, con cuenta o como invitada; incluye la fecha pedida en hora de Houston. |
| Propuesta aceptada | «Propuesta aceptada · DS-…» | Cuando la clienta acepta: total y qué falta (anticipo, pago completo o «contra entrega: reservada»). |
| Mensaje de la clienta | «Nuevo mensaje de la clienta · DS-…» | Agrupado: varios mensajes seguidos generan un solo correo. |
| Pago confirmado | «Pago confirmado · DS-…» | Monto y saldo pendiente. |

Cada aviso también aparece en la bandeja de avisos del panel. Usa la misma cola durable de antes: reintenta los envíos que fallan y nunca reenvía uno cuyo resultado se desconoce. Repetir una operación (el mismo `operationId`) no duplica el aviso.

Los pedidos de la tienda (galletas, envíos) no pasan por aquí. Para recibir un correo con cada pedido nuevo de la tienda, se agrega la dirección de Dayana en Shopify, en **Configuración → Notificaciones → Notificaciones al personal**.

## Entrar con Face ID o huella (passkeys, Inventario)

- **Activar:** dentro del panel, en «Face ID / huella» (o en el aviso que aparece después de entrar con contraseña). Se hace en dos toques:
  1. Escribir la contraseña y tocar **Continuar**. El servidor la verifica con el mismo contador y el mismo bloqueo de 15 minutos que el login.
  2. Tocar **Activar Face ID o huella**. El teléfono crea la llave.

  Si la contraseña es incorrecta, el teléfono no llega a crear nada.
- **Entrar:** en la pantalla de entrada, con «Entrar con Face ID o huella». Se crea una sesión normal de 12 horas.
- **Quitar:** desde la misma sección, cada aparato tiene el botón «Quitar».

  Al desactivar a una persona o al recuperar su contraseña por correo, se borran todos sus aparatos.
- **Seguridad:**
  - La cara o la huella nunca salen del aparato. El servidor guarda solo la llave pública (JWK).
  - Se exige la verificación del usuario, y se comprueban el origen y el `rpId`, que salen de `PORTAL_PUBLIC_URL`.
  - El desafío va firmado con HMAC (`INVENTARIO_CODE_KEY`), dura 5 minutos y se usa una sola vez. Pedir opciones no guarda nada.
  - Un contador de firmas que retrocede se rechaza, porque indica una llave copiada.
  - Las acciones de dinero en Pedidos siguen pidiendo la contraseña.
- **Código:** `services/inventario/src/webauthn.mjs` (CBOR, COSE→JWK, ES256/RS256, DER→raw), `staff-identity.mjs` (acciones `passkey-*`) y `staff-ui.js`.

## Pruebas

- `services/celebraciones/test/staff-alerts.test.mjs`: avisos de solicitud nueva y de propuesta aceptada. Comprueba que se envían una sola vez y sin datos de la clienta.
- `services/inventario/test/passkeys.test.mjs`: un autenticador de software firma con claves P-256 y RSA reales. Cubre la activación con contraseña y su bloqueo, el desafío firmado, de un solo uso y ligado a la persona, el rechazo de otro origen, otro `rpId`, sin verificación, una firma ajena o un contador que retrocede, y quitar, desactivar o recuperar.
- `services/inventario/test/passkey-ui-check.mjs`: corre en Chrome real con el autenticador virtual (CDP WebAuthn) sobre `https://dayanassweet.com/apps/inventario` interceptado. Recorre la activación en dos toques, la entrada sin contraseña, el rechazo sin verificación, quitar un aparato y un aparato sin biometría, a 390 y 1440 px, sin errores JS.
