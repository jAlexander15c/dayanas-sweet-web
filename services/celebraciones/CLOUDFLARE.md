# Estado de Cloudflare y conexión Shopify

Actualizado: 2026-11-03.

## Estado vigente tras las pruebas de pagos

- Worker desplegado: `7ba55987-b2e9-422e-a8e7-9e433f724b66`.
- `SERVICE_ENABLED=true`, `PAYMENTS_ENABLED=true`, `PAYMENTS_MODE=TEST`; acceso limitado al cliente piloto `31396852597040`.
- App `Dayana Celebraciones`, versión `dayana-celebraciones-5`, instalada con `write_app_proxy,write_draft_orders,read_orders,write_order_edits,read_locations,read_customers,write_orders`. Preflight real confirmó los permisos.
- Personal autorizado: `164797317424`. Autenticación del cliente mediante App Proxy firmado; panel mediante JWT de Shopify.
- Dos pedidos ficticios comprobados: #1001 por150 (90+60) y #1002 por100 (60+40). El segundo se desarchivó automáticamente por la app antes de añadir el saldo, sin modificar la configuración global.
- Shopify Payments volvió a pagos reales tras cada prueba; el modo de prueba de Shopify está desactivado. El modo TEST del servicio es independiente y sigue restringiendo el acceso público.
- Validación de la copia de entrega sobre main actualizado: check-theme41JS/69JSON/57esquemas; Theme Check sin errores y8advertencias preexistentes. El primer piloto llegó a Listo para recoger y cerró comentarios; se verificó intercambio cliente/pastelera y presentación desktop/mobile.
- Segundo piloto completado: aumentos100→110→120 y reducciones120→115→110 conservaron100 recibidos. El checkout antiguo de15 rechazó el importe sustituido, actualizó a10 y cobró sólo10 con Visa ficticia. Resultado final110/110/0; no repetir pagos.
- Copia de entrega aislada: 272/272 pruebas integradas correctas (240 backend), con revisión independiente de recuperación, descuentos propios y allocations históricas0. Configuración de release preparada para REAL, todavía NO desplegada; el Worker remoto sigue TEST/allowlist.
- Tema sin publicar `189886300464`; tema público sin cambios. Páginas creadas y ocultas: Pasteles personalizados163671245104 y Seguimiento de tu pastel163671343408.
- Pendiente: autorización explícita del push de esta entrega a main, publicación de páginas ya creadas y activación REAL del servicio. No repetir pagos ni recrear solicitudes piloto.

Checkpoints detallados y operaciones ejecutadas: [contexto recuperado](../../docs/contexto-recuperado-2026-11-03.md). Las secciones siguientes conservan el historial inicial; sus flags y pendientes no describen el estado vigente.

## Historial inicial

## Despliegue confirmado

- Worker: `dayanas-celebraciones`.
- URL: https://dayanas-celebraciones.dayanas-celebraciones-service.workers.dev
- Versión desplegada: `d7be555b-e23a-4f30-9f1e-ff716a9adbbd` (panel, fotos, calendario y acceso del personal; versión inicial `23d92cb2-d62a-438c-9c49-4c508fc15750`).
- Persistencia: binding `CELEBRATIONS`, clase `CelebrationStore`, SQLite Durable Objects.
- `SERVICE_ENABLED=false`; las rutas privadas responden 503 con `UNAVAILABLE`.
- No se modificó DNS, Hostinger ni el tema publicado en Shopify.

El usuario creó y verificó la cuenta de Cloudflare y autorizó el acceso de Wrangler (lectura de cuenta/usuario, escritura Workers y acceso en segundo plano). El primer intento falló por correo sin verificar; el siguiente despliegue terminó correctamente.

## Acceso local de Wrangler

OAuth guardado mediante keyring; no copiar secretos a archivos del repositorio. En este entorno Windows, Wrangler necesita resolver el paquete keyring instalado en el servicio. Desde esta carpeta se usó una variable de proceso, sin cambiar configuración global:

```powershell
$env:npm_config_prefix = (Get-Location).Path
npx wrangler deploy
```

La instrucción anterior es una operación de publicación: ejecutarla solo dentro del alcance autorizado. No publica el tema Shopify.

## Comprobaciones completadas

- 101 pruebas integradas de backend y transporte/controlador del tema, correctas antes del despliegue.
- Runtime local de Wrangler: creación firmada, aislamiento por cliente, idempotencia concurrente, propuesta del personal, aceptación sin pago ficticio, rechazo de versión antigua y rechazo sin firma.
- Despliegue remoto correcto; lectura remota de `/proxy/requests/test` devuelve 503 `UNAVAILABLE`, según la configuración desactivada.

Estas comprobaciones todavía no validan firmas, cuentas de cliente ni permisos a través de una instalación real en Shopify.

## Shopify: app creada e instalada

Dev Dashboard: organización Dayana’s Sweet, `236167337`. App `443298971649`, creada e instalada tras autorización explícita del usuario:

- Nombre: `Dayana Celebraciones`.
- URL de app: URL del Worker indicada arriba.
- App incrustada en el admin de Shopify.
- Único alcance solicitado: `write_app_proxy`.
- Sin instalación heredada ni URLs de redirección OAuth añadidas.

Versión `dayana-celebraciones-2` lanzada con proxy `/apps/celebraciones` hacia `/proxy` del Worker. Instalación confirmada por apertura del iframe Dayana Celebraciones en el admin de la tienda. Cliente público `76bab560bfbcd26f94c8fd493bd2dbaa`; dominio canónico comprobado en HTML público: `2n36xt-3a.myshopify.com`.

Secreto transferido desde el botón de copia de Shopify a `wrangler secret put SHOPIFY_APP_SECRET` por entrada estándar, sin imprimirlo ni guardarlo en el repositorio. `wrangler secret list` confirma su presencia. El primer vaciado del portapapeles falló por cadena vacía; se corrigió reemplazándolo por un espacio. No repetir la carga del secreto.

La prueba pública del proxy devuelve 500 HTML de Shopify mientras el Worker permanece desactivado; todavía no confirma firmas ni autenticación real.

La URL raíz sirve el panel aprobado y carga App Bridge. Sesión real comprobada dentro de Shopify; personal autorizado `164797317424`, verificado mediante JWT y configurado explícitamente. El panel carga solicitudes y agenda. No hay solicitudes reales creadas. El flag `SERVICE_ENABLED` bloquea las rutas del cliente; el panel requiere autenticación y allowlist independientemente de ese flag.

Implementados formulario, panel, fotos privadas, horarios America/Chicago y agenda abierta/cerrada por día. Última suite integrada:128/128. Tema QA189886300464 creado desde copia del tema live más archivos nuevos; ThemeCheck0errores8warnings anteriores. No cambió el tema live.

Pendiente: prueba con cliente Shopify real, integración de pagos online sin suscripciones adicionales (decisión explícita del usuario) y pruebas completas antes de activar/publish. Se está evaluando draft anticipo + añadir saldo al mismo pedido; no hay cobro ni conciliador implementados. Impuestos y scopes de pedidos aún por resolver. Ver `../../docs/contratos/pagos-online-opciones-2026-11-03.md` y checkpoints del contexto.

Referencia oficial de configuración del proxy y su alcance: https://shopify.dev/docs/apps/build/online-store/app-proxies/index
