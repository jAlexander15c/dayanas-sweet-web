# Contrato: acceso con usuario y contraseña (portal del personal)

Estado: borrador del coordinador, 2026-11-04. Maqueta aprobada: `docs/inventario/maqueta-acceso.html`.
Decisión del usuario: **opción A**: todo bajo dayanassweet.com por **App Proxy de Shopify**.
Riesgo aceptado por el usuario: la sesión vive en el almacenamiento del navegador del origen de la tienda
(no hay cookies por el proxy). Se mitiga abajo; no se cambia de opción sin preguntarle.

## 1. Rutas

- App Proxy de la app Dayana Inventario: prefijo `apps`, subruta `inventario`, URL del proxy
  `https://<worker-inventario>/proxy`. Redirección de URL en Shopify: `/inventarios` → `/apps/inventario`.
- El Worker sirve:
  - `GET  /proxy` → página HTML independiente (no Liquid), `noindex`.
  - `GET  /proxy/assets/<archivo>` → JS/CSS del portal.
  - `POST /proxy/api/<acción>` → API JSON. **Toda llamada de API es POST con JSON** (`Content-Type: application/json`).
  - `POST /proxy/api/celebraciones/<ruta>` → reservado para la pasarela a Celebraciones (sección 6).
- Cada petición `/proxy*` verifica la firma del App Proxy (HMAC-SHA256 con el secreto de la app, comparación
  en tiempo constante, `shop` == SHOPIFY_SHOP, `timestamp` dentro de ±600 s). Sin firma válida: 401 sin detalle.
  `logged_in_customer_id` se ignora: no otorga nada.
- El panel embebido actual (`/`, `/admin`, `/api/*` con ID token de App Bridge y lista de personal) sigue igual
  y es la **llave maestra**.
- Interruptor `EXTERNAL_LOGIN_ENABLED` (`"false"` por defecto): si no es `"true"`, `/proxy*` responde 503.

## 2. Sesión (sin cookies)

- Token de sesión: 32 bytes aleatorios en base64url. En servidor solo se guarda su SHA-256.
- El navegador lo guarda en `localStorage` con su vencimiento y lo envía en el campo JSON `session`
  (no en cabeceras: no confiamos en que el proxy las reenvíe).
- Vence a las 12 h desde el inicio o tras 2 h sin uso. `Salir` la borra en servidor.
- Cambiar contraseña, desactivar al usuario o quitarle un permiso invalida todas sus sesiones (`session_version`).
- CSRF: no aplica (no hay credencial ambiental; el token viaja en el cuerpo). Igual se exige JSON y firma de proxy.
- Mitigación del riesgo aceptado: página propia sin el tema ni apps de la tienda, CSP estricta (meta + cabecera),
  sin scripts de terceros, `Referrer-Policy: no-referrer`, tokens de invitación en el fragmento `#` del enlace.

## 3. Identidad compartida

Tabla `users` (SQLite del Durable Object de Inventario):
`id` (uuid, actor estable), `username` (único, `^[a-z0-9._-]{3,32}$`), `name`, `email` (único),
`password_hash` (`pbkdf2-sha256$<iter>$<salt>$<hash>`, iteraciones = 100000, el máximo de Workers),
`roles` (JSON: subconjunto de `admin`, `inventario`, `celebraciones`), `status` (`invited`|`active`|`disabled`),
`session_version`, `created_at`, `created_by`, `last_login_at`, `password_changed_at`.
Tablas `sessions`, `invitations`, `recovery_codes`, `login_attempts` con solo hashes.

- Contraseña: mínimo 10 caracteres, distinta del usuario, fuera de una lista corta de contraseñas comunes.
- Entrar: error genérico; 5 fallos por usuario → pausa de 15 min; límite global de fallos; se calcula un hash
  aunque el usuario no exista.
- Invitación: enlace `https://dayanassweet.com/apps/inventario#invitacion=<token>`, un solo uso, 48 h.
- Recuperar: respuesta siempre genérica; código de 6 dígitos al correo registrado, 10 min, 5 intentos por código,
  máximo 3 códigos por hora y usuario. Al cambiarla se cierran las demás sesiones.
- Administración: solo `admin` invita, desactiva, reactiva, cambia permisos, reenvía o cancela invitaciones.
  Siempre queda al menos un `admin` activo. Desactivar no borra.
- Primer usuario: desde el panel embebido (sección "Usuarios"), con la misma lista de personal de Shopify.
- Auditoría: los eventos de inventario registran `staffId = "user:<id>"` y el nombre; el embebido sigue con el id de Shopify.

## 4. Acceso a la API de Shopify sin ID token

Las sesiones con contraseña no traen ID token. Se usa un token **offline** de la tienda:
obtenido por token exchange (`requested_token_type` offline, con vencimiento y refresh) cuando un miembro de la
lista de personal pulsa "Conectar acceso externo" en el panel embebido; guardado cifrado (AES-GCM, clave en el
secreto `INVENTARIO_TOKEN_KEY`) en el Durable Object; renovado con su refresh token. Sin token válido, el portal
lo dice y pide reconectar desde Shopify.

## 5. Correo

Resend, remitente `info@dayanassweet.com`, secreto `RESEND_API_KEY` propio de este Worker (lo pone el usuario).
Nunca se registran clave, destinatario, token ni código. Fallo del proveedor: se informa sin revelar si el
usuario existe (en recuperación) o como "no se pudo enviar" (en invitación, solo a administradores).

## 6. Pasarela a Celebraciones (para la otra sesión)

- El portal es el único origen. Celebraciones no acepta actor desde el navegador ni por un endpoint público.
- Llamada servidor a servidor por **Service Binding con RPC**: Celebraciones exporta
  `export class StaffGateway extends WorkerEntrypoint` (no alcanzable desde internet) con
  `async handle({ actor, method, path, body })` → `{ status, body }`.
- `actor = { userId, name, roles, shop, aud: "celebraciones", sessionVersion }`. El portal solo llama si
  la sesión es válida y `roles` incluye `celebraciones`. Celebraciones vuelve a comprobar `aud`, `shop` y el rol.
- Binding en el Worker de Inventario: `CELEBRACIONES` → servicio `dayanas-celebraciones`, entrypoint `StaffGateway`.
- Rutas: `POST /proxy/api/celebraciones/<ruta>` → `handle({ method, path: "/<ruta>", body })`.
  En la página, la vista Celebraciones es una pestaña del portal (`#celebraciones`).
- Revocación: desactivar o quitar el rol invalida las sesiones; el siguiente llamado ya no pasa.
- Enlaces de correo de Celebraciones: `https://dayanassweet.com/apps/inventario#celebraciones/<solicitud>`.

## 7. Fuera de este contrato

Despliegue, secretos, configuración del App Proxy en Shopify y la redirección `/inventarios`: los hace el
coordinador con autorización del usuario después de las pruebas. Cambios en la tienda/tema: ninguno.
