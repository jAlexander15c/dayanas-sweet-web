# Entrega: acceso del personal — 2026-11-04

Secciones 1–5 implementadas y corregidas tras revisión independiente. El contrato y la maqueta no se editaron; las decisiones adicionales solicitadas se detallan en **Correcciones de revisión**. Sin commit/push/deploy, secretos reales, cambios al tema/Shopify ni Celebraciones. El interruptor permanece en `false`. Evidencia y cobertura detalladas en [VALIDACION.md](./VALIDACION.md); arquitectura, decisiones y configuración en [README.md](./README.md#portal-del-personal-por-app-proxy-2026-11-04).

## Cambios por archivo

| Archivo en `services/inventario/` | Cambio |
| --- | --- |
| `src/proxy-auth.mjs` (nuevo) | Firma proxy HMAC, tienda, edad y duplicados; cliente no autoriza |
| `src/staff-crypto.mjs` (nuevo) | Tokens aleatorios, SHA-256/HMAC, PBKDF2 100000, política, AES-256-GCM |
| `src/staff-store.mjs` (nuevo) | Tablas de identidad en su DO; ciphertext OFFLINE en el DO original |
| `src/staff-identity.mjs` (nuevo) | Usuarios, sesiones, login/bloqueos, invitaciones, recuperación, permisos y último admin; cola por tienda |
| `src/staff-email.mjs` (nuevo) | Resend inyectable, español, remitente autorizado, errores sin datos sensibles |
| `src/offline-token.mjs` (nuevo) | Exchange OFFLINE con expiración, cifrado y renovación serializada/persistida |
| `src/portal-handler.mjs` (nuevo) | APIs POST, autenticación/roles, adaptación al inventario y extensión RPC Celebraciones/501 |
| `src/staff-ui.js` (nuevo) | Transporte embebido/portal; siete pantallas, usuarios, conexión, recuperación y sesión en navegador |
| `src/admin-page.mjs` | Shell independiente del portal y CSP; assets públicos correctos, Usuarios en embebido |
| `src/admin-ui.js` | Adaptador portal y arranque después de autenticar; lógica de inventario conservada |
| `src/admin-ui.css` | Formularios de acceso, usuarios y seis casillas de código; responsive, áreas 44 px, movimiento reducido existente |
| `src/cloudflare-worker.mjs` | Rutas proxy firmadas, flag, assets; DO de identidad independiente, autenticación RPC y DO/cola originales de inventario |
| `src/http.mjs` | Exporta lector JSON limitado y permite autenticar actor interno verificado; default Bearer sin cambios |
| `src/shopify-client.mjs` | Proveedor de token OFFLINE opcional, 401 externo pide reconexión; sanitiza log de excepciones |
| `wrangler.jsonc` | Flag apagado y regla Text de `staff-ui.js`; conserva `InventoryStore`/`v1`, añade `IDENTITY`/`StaffIdentityStore`/`v2` |
| `test/staff-helpers.mjs` (nuevo) | Fixtures sintéticos, SQLite, reloj y firmas proxy |
| `test/staff-identity.test.mjs` (nuevo) | Seguridad de identidad, límites, expiraciones, revocaciones y concurrencia |
| `test/portal.test.mjs` (nuevo) | Firma/transporte/roles, inventario/auditoría, RPC, cifrado/refresh, Resend/logs |
| `test/portal-runtime-entry.mjs` (nuevo) | Entrada exclusivamente local; bloquea red con Shopify/Resend simulados |
| `test/portal-runtime.test.mjs` (nuevo) | Prueba integral workerd/SQLite de shell/assets/master/invitación/OFFLINE/operación/auditoría/logout |
| `test/portal-ui-check.mjs` (nuevo) | Recorrido navegador completo; 14 capturas en 390/1440 px |
| `test/categories-ui-check.mjs` | Corrige aserción de texto ya obsoleta frente al HEAD inicial; no cambia conducta |
| `test/tag-categories-ui-check.mjs` | Corrige aserción para eliminar grafía exacta `GALLETAS` del fixture existente |

Documentación: `docs/inventario/README.md`, `VALIDACION.md` y esta entrega. Evidencia: 14 nuevas capturas `evidence/portal-{primer-usuario,invitacion,entrar,panel,usuarios,olvide,codigo}-{mobile,desktop}.png`, `portal-npm-test.txt`, `portal-dry-run.txt`, y capturas existentes actualizadas por los recorridos de regresión. `CONTRATO-ACCESO.md` y `maqueta-acceso.html` eran entradas no versionadas en este worktree: no fueron editadas.

## Comprobaciones de la entrega inicial (antes de revisión)

- `npm test`: 241/241 PASS, salida 0 (216 existentes + 25 nuevas).
- `npm run check`: salida 0; 188.73 KiB / gzip 48.41 KiB; sin despliegue.
- Los cinco scripts `ui-check`, `categories-ui-check`, `adopt-category-ui-check`, `tag-categories-ui-check` y `portal-ui-check`: salida 0. Sus resultados, incluyendo los dos fallos iniciales por aserciones obsoletas y la repetición satisfactoria, están explicados en VALIDACION.
- `node --check`: 44 archivos JS/MJS, salida 0. `git diff --check`: salida 0; solo avisos de normalización LF/CRLF. Bundle de producción sin `__test`, credenciales sintéticas o fixtures.
- Revisión visual de capturas: acceso móvil, código móvil y Usuarios desktop, más comprobaciones de geometría en todas las pantallas.

PBKDF2 se mantuvo en **100000**. Referencia local (5 muestras Node): 60.06 ms de pared / 62.4 ms de CPU por hash; no equivale a producción. Hashing dentro del DO (30 s por invocación documentados), no en el Worker Free general (10 ms). El plan y CPU reales siguen por comprobar; no se bajó el coste para aparentar compatibilidad.

## Correcciones de revisión

Todas las rutas de archivo de la tabla son relativas a `services/inventario/`. Se añadieron diez regresiones que fallaron contra la implementación previa (**0/10 PASS, 10 fallos, 0 omitidas**), una por cada comportamiento señalado incluyendo los hallazgos compuestos. Después se añadió una comprobación adicional de autenticación durante PBKDF2: el archivo nuevo contiene once pruebas. Las expectativas anteriores sobre bloqueo global y sustitución de códigos se actualizaron a las correcciones solicitadas; el resto de las pruebas existentes sigue pasando.

| Hallazgo | Cambio y decisión, archivo:línea | Prueba que lo cubre |
| --- | --- | --- |
| I1 | `src/staff-identity.mjs:107`: el global de 50 fallos solo bloquea identificadores sin usuario activo (incluye invitados/desactivados). Una cuenta activa sin bloqueo propio puede entrar con su contraseña correcta. | `test/staff-review.test.mjs:12`: 50 fallos con nombres inventados y después login correcto. |
| I2 | `src/staff-identity.mjs:108`: bloqueos local/global aplicable antes de PBKDF2, mismo 401/código/mensaje. `src/cloudflare-worker.mjs:18`: `IDENTITY` → `StaffIdentityStore`, `idFromName('identity:' + shop)`; login/invitaciones/usuarios van allí. Inventario y Celebraciones conservan el DO original; `connect` y credencial OFFLINE también. `src/staff-store.mjs:10` separa las tablas. `wrangler.jsonc:21` agrega binding y migración SQLite `v2`, mantiene `v1` y `operations`/`audit`. No se migran identidades: nunca existieron en producción. `src/staff-identity.mjs:190` valida sesiones fuera de la cola de contraseñas; RPC lleva errores como datos para conservar 401/403. | `test/staff-review.test.mjs:18` cuenta llamadas reales a `deriveBits` (cero bajo bloqueo), `:28` ejercita el enrutado con namespaces distintos, `:38` valida sesión mientras PBKDF2 está detenido. `test/portal-runtime.test.mjs:22` inspecciona tablas reales en ambos DOs y `:36` comprueba sesión revocada por RPC. |
| I3 | `src/staff-identity.mjs:191`: `recover` hace la misma comprobación HMAC y responde sin esperar búsqueda, cola ni correo. El trabajo se registra con `ctx.waitUntil` (`src/cloudflare-worker.mjs:22`), reserva bajo cola y envía fuera (`src/staff-identity.mjs:81`). **Un intento por emisión**, sin reintento automático ni alarma; timeout existente de 15 s. Fallo consume solo la reserva nueva y cuenta en los topes. `src/staff-identity.mjs:57`: invitación espera el resultado de envío fuera de la cola y al finalizar vuelve a comprobar estado/versión, conservando el enlace previo si falla y sin revivir cancelaciones. | `test/staff-review.test.mjs:49`: respuestas iguales, proveedor detenido y acción `users` completa antes de liberarlo; `:64`: envío de invitación detenido, cola libre y cancelación concurrente. `test/portal-runtime.test.mjs:29`: Resend simulado tarda 300 ms; recuperación y `users` no esperan. |
| M4 | `src/staff-identity.mjs:17`, `:86`, `:125`: máximo **3/h y 6/24 h móviles**, persistido conservando hashes incluso usados/fallidos por 24 h. **Dos códigos vigentes como máximo**; una tercera petición no emite ni invalida los existentes, que sirven hasta vencer/usarse. Contador `reset:user:<uuid>` compartido por usuario/correo: cinco fallos en 15 min pausan 15 min; pedir otro no lo reinicia. Cada error suma a todos los códigos vigentes (máximo cinco por código). Reset correcto revoca todos y limpia login/reset. | `test/staff-review.test.mjs:78`: primer código conservado, máximo dos, seis diarios, reinicio y reapertura tras 24 h; `:97`: fallos compartidos, nuevo código no elude bloqueo, reapertura tras 15 min. Pruebas originales cubren 3/h, fallo de proveedor, vencimiento y revocación. |
| M5 | `src/staff-identity.mjs:147`: contraseña actual errónea incrementa `login:user:<uuid>`; al quinto fallo invalida todas las sesiones. Login por correo/nombre y cambio comparten contador/bloqueo; un cambio correcto lo limpia. | `test/staff-review.test.mjs:109`: dos errores de login + tres de cambio, ambas sesiones revocadas y login correcto bloqueado. |
| M6 | `src/staff-identity.mjs:58`: reenvío de persona cancelada sin contraseña dice «Esta invitación fue cancelada. Reactiva a la persona y después reenvía la invitación». | `test/staff-review.test.mjs:118`; la prueba existente cubre reactivar/reinvitar/aceptar. |
| M7 | `src/staff-ui.js:80`: inicia revocación remota y borra inmediatamente memoria/almacenamiento local, aunque falle la red; vuelve a acceso y muestra aviso si no se confirmó servidor. | `test/staff-review.test.mjs:124` ejecuta el adaptador real con fetch fallido. `test/portal-ui-check.mjs:78` aborta logout en navegador y confirma almacenamiento vacío y acceso después de recargar. |

### Salidas reales posteriores a las correcciones

- `npm test`: **252/252 PASS**, 0 fallos/canceladas/omitidas, salida **0** (241 previas + 11 nuevas). Incluye workerd/SQLite y ambos DOs reales.
- `npm run check`: salida **0**, **192.11 KiB / gzip 49.25 KiB**; bindings `INVENTARIO (InventoryStore)` e `IDENTITY (StaffIdentityStore)`, flag `false`, final `--dry-run: exiting now.`; no desplegado.
- `node test/portal-ui-check.mjs C:/Users/Milton/orca/OmniRoute/node_modules/@playwright/browser-chromium/node_modules/playwright-core`, con `UI_BUNDLED_CHROMIUM=1`: **PASS**, salida **0**; siete pantallas × 390/1440 px, 44 px, CSP, invitación, OFFLINE, usuarios, salir (también sin red), recuperación, cambio de contraseña, login y recarga, 14 capturas temporales. `PORTAL_UI_EVIDENCE_DIR` se dirigió a `%TEMP%/inventario-portal-review-ui` para no modificar evidencia fuera del alcance.
- I3 en workerd con proveedor simulado lento: `recover existente/inexistente 8.6/8.4 ms; proveedor simulado 300 ms, cola libre.` La prueba exige ambas respuestas <200 ms, diferencia <100 ms y administración libre antes de completar el envío; no afirma igualdad exacta del reloj ni tiempos de producción.
- `git diff --check`: salida **0**; solo avisos LF/CRLF. La advertencia experimental de `node:sqlite` no altera el resultado de pruebas.
- `node --check`: **45 archivos JS/MJS** de `src`/`test`, salida **0**. Tras incorporar el proveedor lento se repitieron `npm test` (**252/252**) y el recorrido del portal: ambos salida **0**.

Scripts del revisor, leídos y ejecutados sin editarlos:

```text
hmac.mjs (salida 0)
ruby-style digest 4c68c8624d737112c91818c11017d24d334b524cb5c2b8ba08daa056f7395ddb
doc vector: OK
stale: rejected
tamper: rejected

ident.mjs (original, salida 1)
A login admin tras 50 fallos anónimos: OK
A tras 15 min: OK
D aceptar doble: [ 'fulfilled', 'rejected' ]
E desactivación cruzada: [ 'fulfilled', 'rejected' ] admins activos: 1
F 2h-1ms: OK
F 2h idle: SESSION_REQUIRED
F >12h activo: SESSION_REQUIRED
F almacena token plano? false
G 30 intentos de contraseña actual con sesión robada: [ 'LOGIN_FAILED', 'SESSION_REQUIRED' ] sesión sigue viva: no
H recover ms existente/inexistente: 1 1
TypeError: Cannot read properties of null (reading '0')
```

El último error pertenece a la sección I del script antiguo: lee `h.code()` al terminar la respuesta, pero el envío ahora es diferido. Se repitió **el mismo contenido en memoria**, insertando solamente `await h.flush()` después de cada `recover` del harness; el archivo del revisor quedó intacto. Salida **0**: mismos resultados A–G, `H ...: 1 0`, y `I código de la víctima tras recover ajeno: OK`. La tubería de PowerShell sustituyó tildes por `?` en esa segunda salida; los códigos y resultados se conservaron.

La función `forwardToCelebraciones` y su interfaz no se editaron. El panel embebido conserva autenticación/lista Shopify y sus rutas de inventario; solo las acciones de identidad se encaminan al nuevo DO. No hay pasos de implementación pendientes para estos siete hallazgos; siguen pendientes los pasos operativos autorizados por separado de la sección siguiente.

## Integración y operación pendientes

La integración de Celebraciones usa `window.inventarioPortal.request(path,{method,body})`, el contenedor `#celebraciones-view`, hash `#celebraciones` y `forwardToCelebraciones`; no hay binding declarado aquí. Se agregó `code` a los errores del adaptador para que la otra sesión cierre su vista ante `SESSION_REQUIRED`/`ROLE_REQUIRED`. No se añadieron assets/shell/iframe de Celebraciones.

El coordinador debe configurar `RESEND_API_KEY`, `INVENTARIO_TOKEN_KEY` e `INVENTARIO_CODE_KEY`, comprobar remitente y scopes, configurar el App Proxy/redirección, conectar OFFLINE e invitar al primer administrador desde Shopify, validar proxy/correos/CPU reales y habilitar el flag al desplegar con autorización. No queda trabajo de implementación en el alcance entregado; sí esos pasos operativos y la integración separada.
