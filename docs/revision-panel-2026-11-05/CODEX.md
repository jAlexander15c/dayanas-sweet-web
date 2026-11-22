# Revisión del panel del personal — 5 de noviembre de 2026

## Resumen ejecutivo

1. El panel permite gestionar productos, existencias, categorías, personal y Celebraciones desde la tienda; los recorridos locales funcionan en 390 y 1440 px.
2. El fallo más importante deja el stock anterior visible junto a «Guardado en Shopify» cuando falla la recarga posterior a una producción guardada.
3. También se reprodujeron un diálogo que tapa el acceso al caducar la sesión, errores con nombres largos y una espera de acceso sin plazo visible.
4. Pasaron 263 pruebas de Inventario, 347 de Celebraciones, siete recorridos de navegador y la comprobación del tema; quedan límites de contraste, navegación móvil y diagnóstico operativo.
5. Esta entrega contiene análisis y evidencia local: no modifica código de producción, no publica, no utiliza el admin ni altera productos, pagos o correos reales.

## Base, método y límites

- Rama `codex/panel-revision`, base `d94bb38`; worktree `C:/Users/Milton/orca/workspaces/dayanas-sweet-web/panel-revision`.
- Revisión de `services/inventario` y `services/celebraciones`: UI, validación, permisos, almacenamiento, adaptadores Shopify y pruebas existentes. Fecha de las capturas: noche del 5 de noviembre, hora Panamá (6 de noviembre UTC).
- Chrome headless local, ventanas de 390×844 y 1440×1000, `reducedMotion: reduce`. Los usuarios, solicitudes, credenciales de prueba y respuestas de Shopify/Resend son sintéticos.
- Las cinco pruebas de Inventario usan el Worker y Durable Objects locales reales, compilados desde los archivos intactos del checkout. Se sustituyó únicamente el arranque de Wrangler por un adaptador de Miniflare para evitar que `testConfig()` escribiera en `services/`.
- Celebraciones se ejercitó tanto por separado como dentro del portal autenticado. En la prueba integrada, la API de Celebraciones es una respuesta sintética de navegador, **no** un enlace RPC completo entre ambos Workers. Solo en ese arnés se sustituyó el origen permitido de `frame-ancestors` por el origen local HTTP. La autorización del gateway sí está cubierta por sus pruebas unitarias.
- No se verificaron Safari/iPhone físico, lector de pantalla, latencia de la red real, cabeceras que finalmente conserva el proxy de Shopify, entrega real del correo, cobro real ni límites de Cloudflare en producción. Las capturas no certifican esos puntos.
- Incidencia del arnés: Miniflare generó automáticamente una caché `.wrangler/cache/cf.json` en la raíz del worktree. La revisión automática rechazó el comando de limpieza («blocked by policy», sin motivo más específico); queda sin seguimiento y fuera del commit. No se leyó ni se incluye su contenido en la entrega. Los temporales siguientes se dirigieron al directorio ignorado `runtime/`. No hubo cambios en archivos de producción. Esta es una desviación de la restricción literal de escrituras; el commit entregado sí queda limitado al directorio de revisión.

## Hallazgos priorizados

Severidad expresa impacto observado, no una puntuación de vulnerabilidad. **Reproducido** significa una aserción o medida local; **estático** significa lectura de código. S: cambio acotado; M: varios estados/capas; L: cambio de flujo o arquitectura. El esfuerzo incluye validación, no es una estimación contractual.

| ID | Severidad | Área | Evidencia | Propuesta | Esfuerzo |
|---|---|---|---|---|---|
| R01 | Alta | Stock mostrado después de guardar | Reproducido: `admin-ui.js:306`; [captura](capturas/portal-hallazgo-stock-desactualizado-mobile.png), `audit-findings.log` | Conservar el recibo de éxito, marcar la lista desactualizada y ofrecer recarga explícita | S |
| R02 | Media | Sesión caducada con modal abierto | Reproducido: `staff-ui.js:24`, `admin-page.mjs:22`; [captura](capturas/portal-hallazgo-sesion-modal-mobile.png) | Cerrar diálogos y enfocar acceso cuando se invalida la sesión | S |
| R03 | Media | Edición de producto con nombre largo | Reproducido: `validation.mjs:72`, `:98`; `title-probe.log` | Aceptar el nombre existente sin cambios hasta 255 caracteres y dar error específico para un nombre nuevo inválido | S |
| R04 | Media | Espera de red en el navegador | Reproducido durante 22 s y verificado estáticamente: `staff-ui.js:15`; [captura](capturas/portal-hallazgo-login-pendiente-mobile.png) | Plazos de espera y recuperación; conservar idempotencia cuando el resultado de una escritura es incierto | M |
| R05 | Media | Identificación visual de campos | Medido: `celebraciones/src/admin-ui.css:18`, `embedded-metrics.json`, `contrast.json` | Aumentar contraste del borde de campos vacíos; conservar el foco visible actual | S |
| R06 | Media | Diagnóstico de incidentes | Estático: ambos `wrangler.jsonc:9`, `inventario/src/durable-store.mjs:26` | Observabilidad redactada y correlación por operación; indicadores de cola y resultados inciertos | M |
| R07 | Media, endurecimiento | Contraseñas del personal | Estático: `inventario/src/staff-crypto.mjs:23`, `:30` | Revisar coste de derivación y migración gradual de hashes con medición en Workers | M |
| R08 | Baja | Navegación de Celebraciones integrada | Medido: `inventario/src/admin-ui.css:10`, `embedded-metrics.json`; [móvil](capturas/portal-celebraciones-mobile.png) | Un solo desplazamiento principal y resumen de acciones; diagnóstico y agenda secundarios | M |
| R09 | Baja | Objetivos táctiles secundarios | Medido: etiqueta de filtro 29,25 px y resúmenes 30 px; `embedded-metrics.json` | Ampliar área pulsable a 44 px sin agrandar solo el icono | S |
| R10 | Baja | Historial de operaciones | Estático: `inventario/src/durable-store.mjs:26`, `admin-ui.js:496` | Paginación, filtros y resumen humano antes del detalle técnico | M |
| R11 | Baja | Borradores de Celebraciones | Estático: `celebraciones/src/admin-ui.js:156`, `:290` | Aviso de cambios sin enviar y recuperación de borrador con caducidad/aislamiento por usuario | M |

En la tabla, rutas sin prefijo de servicio para R01–R04 pertenecen a `services/inventario/src/`. Las demás muestran el servicio explícitamente.

### R01 — éxito verdadero, conteo visible antiguo

Preparar 6 cajas sobre 4 disponibles produce un guardado correcto de 10. Al responder 503 a la consulta siguiente, el `catch` vacío conserva las 4 cajas en pantalla y aparece «Guardado en Shopify». Al retirar el fallo y buscar de nuevo aparecen las 10: no es una escritura perdida. La prueba comprueba ambos números. Esto puede llevar a Dayana a repetir mentalmente la producción o desconfiar del guardado; **no se observó una duplicación automática**.

La corrección debe decir «Guardado. No pudimos actualizar la lista», mostrar el resultado confirmado o identificar el número antiguo como desactualizado y permitir recargar. No convertir un recibo confirmado en fallo ni reenviar la mutación. Riesgo de cambio bajo; no necesita decisión de negocio. Aceptación: guardado correcto + recarga fallida nunca presenta el valor anterior como vigente. La recuperación de categorías ya tiene tratamiento más explícito y debe conservarse.

### R02 — la sesión se limpia, pero los diálogos siguen encima

Con la confirmación de producción abierta, un 401 `SESSION_REQUIRED` borra la sesión y muestra el formulario de entrada, pero `#confirmation.open` continúa en `true`; el editor también queda detrás. El texto «Entra otra vez» es correcto, pero la persona debe cerrar capas antes de poder entrar. No es un acceso no autorizado al servidor; queda información anterior visible en el modal.

Centralizar el cierre de diálogos, el estado pendiente y el foco al invalidar la sesión. No guardar ni repetir la operación al volver a entrar. Riesgo bajo; sin decisión de Dayana. Aceptación: un 401 desde cualquier modal devuelve una única pantalla de acceso operable con teclado.

### R03 — un título válido existente bloquea cambios ajenos al título

La validación aplica primero el máximo de 200 al título enviado y solo después intenta conservar exactamente `expected.title`, cuyo límite es 255. Prueba con cambio de estado: 200 caracteres → 200/SAVED y una mutación; 201 y 255 → 400/VALIDATION, cero mutaciones y «Revisa los datos e inténtalo otra vez». No afecta a sumar producción, que usa otra rama de validación. La eliminación de títulos de 255, arreglada anteriormente, sí pasa su prueba.

Preservar el nombre existente antes de la validación de nuevo título, o unificar explícitamente el contrato de edición. Añadir error de campo comprensible. Riesgo bajo; no exige renombrar productos ni decisión comercial.

### R04 — una petición pendiente deja el acceso bloqueado

Se dejó pendiente la respuesta de login durante 22 segundos: el botón seguía deshabilitado sin plazo ni alternativa de cancelación. `staff-ui.js` no establece `AbortSignal` o temporizador. La medición demuestra esos 22 segundos; la ausencia de plazo se establece por código, no por una espera infinita observada. El cliente Shopify del servidor sí tiene un timeout de 20 segundos (`shopify-client.mjs:46`), que no resuelve una conexión navegador-servidor suspendida.

Aplicar límites distintos para consultas, acceso y escrituras. En estas últimas, perder la respuesta no demuestra que no se guardó: mantener el `operationId`, consultar recibo/historial y explicar «resultado sin confirmar». Riesgo medio por idempotencia; sin decisión comercial, pero conviene acordar el texto con Dayana.

### R05 — bordes de campos demasiado tenues

El estilo computado del campo de búsqueda de Celebraciones es borde `#e8c9d6`, fondo `#fffcfd`: **1,497:1**; frente al papel `#fff7fa`, **1,449:1**. La misma regla se aplica a los campos vacíos y áreas de texto. Su límite es el principal indicio del área editable cuando no hay contenido. Proponer al menos 3:1 para ese indicio, conforme a [WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Esto no significa que cada borde decorativo o botón con texto necesite 3:1.

Los colores principales de texto y botones medidos sí superan 4,5:1 (5,94–13,96 en los pares de Celebraciones y 6,48–13,26 en Inventario). No se hizo auditoría exhaustiva de cada combinación, placeholder o estado. Riesgo bajo; si cambia la apariencia, presentar muestra visual para aprobación antes de implementar, según AGENTS.md.

### R06 — información disponible, pero poca detección operativa

Ambos Workers declaran `observability.enabled: false`. Existen recibos durables, estados de correo, mensajes de error y trazas puntuales del cliente, pero eso no equivale a alertas operativas ni a una vista histórica consultable de incidentes. No se verificó si hay un sistema externo adicional habilitado en Cloudflare.

Proponer eventos estructurados de duración/resultado, identificador de operación, error normalizado y estado de reintento; métricas de cola de correo/pagos y operaciones inciertas. Excluir cuerpos, tokens, contraseñas, enlaces privados y datos de clientes. Riesgo medio por privacidad/coste; Dayana/coordinador deben definir responsables y plazo de conservación. No activar logging indiscriminado.

### R07 — fortalecer hashes sin bloquear el panel

PBKDF2-HMAC-SHA256 utiliza 100.000 iteraciones y el verificador solo acepta esa cifra. Hay sal aleatoria y no se guarda la contraseña en claro; no se encontró ni se probó una filtración. [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) recomienda actualmente 600.000 para PBKDF2-HMAC-SHA256 y preferir algoritmos resistentes a memoria cuando el entorno lo permite.

Medir CPU/latencia del Worker, permitir versiones de parámetros y migrar al autenticar correctamente; conservar verificación de hashes anteriores. No multiplicar el coste a ciegas: la identidad comparte recursos y podría empeorar la disponibilidad. Riesgo medio; decisión técnica con presupuesto de capacidad, sin pedir a Dayana que elija criptografía.

### R08–R11 — fricciones y deuda de uso

- **R08:** con una solicitud sintética, el documento hijo mide 6.245 px en móvil dentro de una ventana de 717 px; el padre también desplaza (1.205 frente a 844). En escritorio: 4.251/850 px y padre 1.182/1.000. Son tamaños de esta muestra, no una constante de todos los pedidos. Avisos, agenda, diagnóstico, propuesta y conversación compiten por espacio. Proponer navegación a «Resumen / Propuesta / Conversación / Preparación» y un único desplazamiento principal. Riesgo medio; necesita maqueta y elección de prioridades por Dayana.
- **R09:** los botones visibles muestreados cumplen 44 px; la etiqueta pulsable «Ver productos sin categoría» mide 29,25 px y los desplegables «Fechas cerradas / Historial de propuestas» 30 px. La etiqueta permite pulsar más que el cuadrado de 23 px, pero no alcanza el objetivo del contrato. [44×44 es WCAG 2.5.5 nivel AAA](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html), no se presenta aquí como una infracción automática de AA. Riesgo bajo; ajuste visual acotado.
- **R10:** la consulta devuelve los últimos 100 eventos sin paginación; el detalle expone JSON, GID y pasos. Los eventos anteriores siguen almacenados: no es prueba de pérdida de datos. Mostrar «sumó 6; de 4 a 10», autor y hora; ofrecer filtros y un bloque técnico opcional. Riesgo medio; Dayana decide cuánto historial consulta y si necesita exportación.
- **R11:** los borradores de comentario/propuesta están en un `Map` de memoria; se conservan al cambiar de solicitud, pero no sobreviven a recarga/cierre. El riesgo se deduce del almacenamiento, no de un pedido real perdido. Proponer aviso al abandonar y borrador con caducidad, ligado a usuario/solicitud/versión y borrado al salir. Riesgo medio por privacidad y propuestas obsoletas; Dayana decide si quiere recuperación local en equipos compartidos.

## Inventario de funciones y contratos

Los permisos siguientes son los requeridos por el código revisado, **no** una afirmación sobre los scopes concedidos ahora en la tienda. Prefijo `I` = Inventario; `C` = Celebraciones. Las operaciones de Shopify usan Admin GraphQL; las del portal llevan sesión del personal y firma del app proxy, no un token de Shopify proporcionado por el navegador.

| Pantalla / acción | Qué hace y qué toca | Permisos y validaciones relevantes | Evidencia / cobertura |
|---|---|---|---|
| Entrada / salir / volver a abrir | Sesión propia en `sessionStorage`; registro de sesión en IdentityStore | Usuario activo, versión de sesión, 12 h absolutas y 2 h inactividad; salir limpia sesión aun con fallo de red | `I/staff-ui.js:13`, `I/staff-identity.mjs:40`; recorrido portal |
| Primera invitación / conectar tienda | Desde la app embebida, crea primer administrador y obtiene conexión offline | JWT Shopify autorizado; conexión cifrada; no se puede asumir identidad desde JSON del navegador | `I/portal-handler.mjs:18`; recorrido portal + pruebas portal |
| Invitar / reenviar / cancelar | Correo de invitación y estado local de personal | Rol admin, usuario/correo/nombre válidos; vínculo de 48 h, un uso; reenvío fallido no destruye invitación anterior | `I/staff-identity.mjs`; portal e identidad |
| Permisos / desactivar / reactivar | Cambia roles admin, inventario, celebraciones; revoca sesiones por versión | Debe quedar un administrador activo; cada API comprueba rol; admin no implica automáticamente acceso comercial | `I/staff-ui.js:99`, `I/staff-identity.mjs:33`; pruebas de roles |
| Recuperar contraseña / OTP / cambiar clave | Correo de código y actualización del hash local | Respuesta genérica, caducidad, límites de intentos/envíos; nueva contraseña y repetición; cambio invalida sesiones | `I/staff-identity.mjs`, `I/staff-crypto.mjs`; recorrido OTP y cambio |
| Buscar productos / ver más / sin categoría | Consulta productos y cantidades disponibles/apartadas por ubicación; paginación | `read_products`, `read_inventory`, `read_locations`; consulta ≤100 caracteres, GID/cursor validados | `I/http.mjs`, `I/shopify-client.mjs:273`; UI escritorio/móvil |
| Agregar producción | Suma unidades disponibles a variante/ubicación | `write_inventory`; entero positivo, comparación del conteo, idempotencia, recibo; no suma silenciosamente si hay conflicto | `I/inventory-service.mjs`, `I/shopify-client.mjs:300`; conflictos y replay probados |
| Corregir existencias | Establece conteo físico incluyendo apartadas y exige motivo | `write_inventory`; cantidad ≥0, CAS, aviso si queda por debajo de comprometido; ubicación/variante válidas | `I/validation.mjs:62`, `I/shopify-client.mjs:303`; captura de advertencia |
| Nuevo producto / publicar | Crea borrador, precio/SKU, inventario, fotos/categoría; activa al final si se confirma | `write_products`, `write_inventory`, `write_files`, `read/write_publications`; precio decimal, enteros, confirmación ACTIVE y recibos por paso | `I/inventory-service.mjs:62`; borrador parcial/reciente, publicación probados |
| Editar producto / foto / categoría | Cambia campos permitidos, conserva HTML con formato; añade hasta 3 fotos por cambio | `write_products`, `write_files`; comparación de valores esperados, omite precio/SKU sin cambio; JPEG/PNG/WebP ≤5 MB; metadatos escapados | `I/validation.mjs:72`, `I/admin-ui.js:108`; edición y categorías |
| Archivar / eliminar | Estado archivado; eliminación solo tras confirmación textual | `write_products`; relectura de producto, nombre normalizado y rol; no eliminación accidental de producto activo | `I/inventory-service.mjs`; prueba F8 de 255 caracteres pasa |
| Crear / editar categoría | Colección, foto/alt, descripción, posición y presencia en portada | `write_products`, `write_files`, `read/write_publications`; alt requerido, orden entero, conserva descripciones con formato | `I/shopify-client.mjs:218`, `I/admin-ui.js:402`; categorías UI |
| Adoptar colección / categoría por etiquetas | Marca colección existente como categoría, conserva reglas/productos; puede publicar si se confirma | Reglas automáticas complejas quedan no editables; tagsAdd/tagsRemove para categorías por etiqueta; metacampos `dayana.*` | `I/admin-ui.js:385`; adopción y tags UI |
| Historial / recuperar incierta | Recibo con antes/después/pasos; reintento seguro solo donde está soportado | Mismo `operationId`, identidad/fingerprint, ventanas de reintento y protección contra doble escritura | `I/durable-store.mjs:26`, `I/inventory-service.mjs:35`; respuesta perdida/replay |
| Solicitudes de Celebraciones | Lista, búsqueda, paginación, detalle/contacto, propuesta vigente/pendiente e historial | Rol celebraciones; gateway con rutas/métodos/query permitidos; cuerpo ≤32 KB | `C/staff-gateway.mjs:14`; unidad + UI sintética |
| Fotos de referencia | Miniatura, abrir, ampliar/ajustar, cerrar con Escape y devolver foco | Solo foto de la solicitud autorizada; imagen validada JPEG/PNG/WebP ≤2 MiB; blob revocado al cambiar/salir | `C/store-core.mjs:124`, `C/admin-ui.js:166`; UI separada e integrada |
| Propuesta | Diseño, respuesta, base/recargo, total/desglose, anticipo60% / completo / contra entrega | Importes enteros del servidor; versión/idempotencia, condición bloqueada al iniciar cobro/reserva según reglas; enviar propuesta guarda datos/cola de correo, no cobra por sí solo | `C/admin-ui.js:353`, `C/store-core.mjs`; payment-options + UI |
| Comentarios y avisos | Conversación, confirmación visible, avisos de respuesta/pago, marcar leído, refresco30s | Límite de comentarios; alertas agrupadas; correo fallido reintentable, ambiguo sin reenvío ciego; proveedor aceptado no significa leído | `C/admin-ui.js:389`, `:494`; staff-alerts, correo y UI |
| Conexión / sincronizar pagos | Consulta scopes, moneda, ubicaciones y estado financiero; reconciliación de pedidos | Cliente exige `write_draft_orders`, `read_orders` (o write_orders), `write_order_edits`, `read_customers`, `write_orders`; ubicaciones si dispone read_locations | `C/payment-service.mjs:38`, `C/shopify-payments.mjs:247`; pruebas de pagos |
| Flujo online relacionado | Draft orders, pedido y ediciones de saldo al aceptar/pagar según condición | Importe calculado por servidor, propiedad de solicitud, versión, cancelaciones/reembolsos, idempotencia; la pastelera no marca pago online arbitrariamente | `C/shopify-payments.mjs:261`, `:294`, `:351`; 347 pruebas globales |
| Pago contra entrega recibido | Registra en el libro de la solicitud un pago ya recibido | Confirmación explícita y modalidad válida; no carga una tarjeta ni prueba una transacción de Shopify | `C/http.mjs:153`, `C/admin-page.mjs`; payment-options |
| Preparar / listo / agenda | Avanza estados según reserva/pagos; abrir/cerrar fecha para nuevas solicitudes | Revalida pago en servidor; excepciones contra entrega; cerrar fecha conserva solicitudes existentes | `C/http.mjs`, `C/admin-ui.js:421`; unidad y lectura de flujo |

Referencia de scopes generales de Inventario: `services/inventario/src/shopify-client.mjs:7`. La conexión offline necesita esos permisos; la UI avisa los faltantes. El panel admite únicamente el subconjunto de gestión mostrado, no sustituye todo Shopify (variantes complejas, HTML enriquecido o gestión completa de fotos siguen fuera).

## Stock, cupos, fallos y seguridad

**Protecciones confirmadas por código/pruebas:** cantidades comparadas con Shopify antes de escribir, claves de idempotencia y recibos durables, serialización de operaciones de inventario, relectura al detectar conflicto, guardado por pasos, publicación al final, recuperación explícita de resultado incierto. Las pruebas cubren venta concurrente, edición externa de precio/SKU, conflicto de stock, creación parcial y reintento sin duplicación. No se debe debilitar este comportamiento al simplificar la interfaz.

El conteo de productos y el calendario de pasteles son mecanismos diferentes. La agenda cierra nuevas solicitudes para una fecha; no equivale a poner stock a cero. No existe una acción específica de «cerrar tanda» en este panel. Si Dayana necesita esa función, debe definirse qué productos/ubicaciones afecta, cómo trata unidades apartadas y quién puede reabrirla. Es una propuesta de negocio de riesgo alto, no un bug demostrado ni una corrección incluida aquí.

**Identidad y entradas:** la firma del proxy precede al acceso; la app embebida valida JWT; los roles se verifican en servidor por petición. El gateway no acepta un actor suministrado por el cliente, solo el actor confiable del binding. Los tokens de personal se guardan hasheados en servidor; la conexión offline se cifra. Las pruebas rechazan sesión ajena, rol revocado, métodos/rutas/cuerpos no permitidos y manipulación de precios/identidad. El contenido de usuario se escapa o inserta como texto en las vistas revisadas. No se identificó un bypass de autorización en esta revisión; esto no es una prueba de penetración exhaustiva.

La CSP del portal restringe scripts/estilos/conexión al propio origen, restringe imágenes y niega ancestros; la vista hija permite el origen de la tienda. Hay no-store, no-referrer, nosniff y noindex en las respuestas del Worker. Debe comprobarse separadamente qué cabeceras conserva Shopify en vivo. `sessionStorage` evita persistencia normal entre sesiones y limpia la copia antigua de localStorage, pero sigue siendo accesible a JavaScript del mismo origen; no protege frente a una futura inyección ni garantiza borrado físico en restauraciones del navegador. No se encontró una inyección que explote ese riesgo.

**Errores y vacíos:** se ven avisos claros de permisos/categorías degradadas, conflictos, borrador parcial, correo incierto, agenda no cargada y falta de resultados. La prueba integrada conserva capturas de vacío y 503 de Celebraciones. Las excepciones concretas que requieren arreglo son R01–R04. Las respuestas ambiguas de pagos/correos no deben convertirse en reintentos ciegos.

## Uso, accesibilidad y propuestas adicionales

- Las capturas muestran texto legible, controles principales grandes, nombres de acciones concretos y confirmación antes de escribir. No hubo desbordamiento horizontal en los estados probados. No se midió rendimiento real: los tests locales simulan las respuestas y no justifican prometer un tiempo de carga en la tienda.
- Foco/Escape: las pruebas de producto y fotos ejercitan diálogo y cierre; existe `:focus-visible` y reducción de movimiento en ambos estilos. R02 es la excepción de foco/estado. No se ejecutó navegación exhaustiva con lector de pantalla ni zoom de texto al 200%.
- Mantener un resumen de conexión simple («Conectado / necesita atención») y pasar scopes/GID a «Detalles técnicos». La información es útil para soporte, pero no para la tarea diaria. Evidencia: `C/admin-ui.js:68`, tarjeta de conexión en capturas. Esfuerzo S, riesgo bajo, requiere maqueta si se rediseña.
- Mostrar avisos sin leer en la navegación principal. Hoy `refreshAlerts` vive en el hijo y comienza al cargar Celebraciones; entrar solo a Productos no muestra un contador global. No significa que se pierda el correo. Esfuerzo M, riesgo medio (frecuencia/estado compartido); Dayana debe elegir prioridad de avisos.
- Fotos desde móvil: explicar tipos/tamaño antes de elegir archivo y ofrecer previsualización/compresión si se decide ampliarlo; no se probó HEIC real. Los formatos permitidos son explícitos; no afirmar que todos los iPhone fallan. Esfuerzo M, riesgo medio por calidad/privacidad; Dayana elige calidad mínima.
- Reutilizar un componente de feedback/recibo y una política de sesión/timeout entre Inventario y Celebraciones. Hoy hay implementaciones y estados distintos; R01 y R02 muestran el coste. Separar módulos grandes solo al tocar el flujo correspondiente, sin una reescritura general. Esfuerzo M, riesgo medio.
- Punto natural de integración para el coordinador: `portal-handler.mjs:9` y la cola durable de avisos permiten conectar funciones nuevas conservando identidad, rol y recibos; el catálogo de proveedores queda fuera de este informe.

## Comprobaciones y evidencia entregada

| Comprobación | Resultado real | Archivo |
|---|---|---|
| Inventario, todas las `.test.mjs` excepto las dos de arranque Wrangler | **263/263 pasan**, 0 fallos | `inventario-unit.log` |
| Celebraciones, suite completa con resolución de dependencias existentes | **347/347 pasan**, 0 fallos | `celebraciones-complete.log` |
| Tema: `node tests/check-theme.mjs` | **42 JS, 69 JSON y 57 esquemas válidos** | `check-theme.log` |
| Portal: primer usuario, invitación, acceso, recuperación, cambio clave, salir | PASS en 390/1440, 14 capturas del recorrido | `portal-ui-check.log` |
| Inventario: producción, corrección, conflicto, alta, borrador/resultado incierto | PASS en 390/1440 | `ui-check.log` |
| Categorías: alta/edición/publicación y fallo de catálogo | PASS | `categories-ui-check.log` |
| Categorías por etiquetas y reglas complejas | PASS | `tag-categories-ui-check.log` |
| Adopción: paginación, foto/alt, publicación, respuesta perdida | PASS | `adopt-category-ui-check.log` |
| Celebraciones separado: búsqueda/paginación, correos, preparación y fotos | PASS en 390/1440 | `celebraciones-ui-check.log` |
| Celebraciones dentro del portal: entrada, foto, vacío, error, geometría | PASS en 390/1440, sin errores JS de página | `embedded-ui-check.log` |
| R01–R04: stock obsoleto, modal/sesión, espera y nombres largos | Fallos **reproducidos como aserciones de auditoría**, no corregidos | `audit-findings.log`, `title-probe.log` |
| Medidas de tamaño y contraste | Valores brutos guardados | `embedded-metrics.json`, `contrast.json` |

La primera ejecución completa de Celebraciones tuvo 338 pruebas aprobadas y dos archivos que no pudieron cargar `esbuild`/`miniflare`, ausentes en este worktree. `dependency-loader.mjs` resuelve las instalaciones ya disponibles en el worktree vecino sin instalar nada ni alterar archivos de producción. Los nueve casos de esos archivos pasaron después y se volvió a ejecutar la suite completa: 347/347. Se conservan ambos logs para que el historial sea verificable.

Las primeras pruebas de arnés también requirieron ajustar rutas de recursos y el origen permitido para localhost; no se contabilizaron como fallos del producto. `capturas/categories-ui-failure.png` es una captura transitoria de un error de ruta del arnés, no un hallazgo del panel; se conserva identificada como tal. `ExperimentalWarning` de SQLite/loader aparece envuelto como `NativeCommandError` en algunos logs de PowerShell: no implica fallo de test; la salida final y el código de salida son los indicados arriba.

No se ejecutó Shopify Theme Check ni un despliegue de previsualización: no se cambiaron archivos del tema. Tampoco se ejercitaron endpoints reales con credenciales. Queda pendiente una sesión guiada con Dayana en Safari para validar comodidad, restauración de pestañas, teclado/fotos y prioridades de mejoras; cualquier mutación de prueba real necesita su alcance propio.

### Capturas principales

- [Inventario móvil](capturas/portal-panel-mobile.png) y [escritorio](capturas/portal-panel-desktop.png).
- [Stock desactualizado](capturas/portal-hallazgo-stock-desactualizado-mobile.png), [sesión caducada](capturas/portal-hallazgo-sesion-modal-mobile.png), [login pendiente](capturas/portal-hallazgo-login-pendiente-mobile.png).
- [Celebraciones integrada móvil](capturas/portal-celebraciones-mobile.png), [escritorio](capturas/portal-celebraciones-desktop.png), [foto ampliada](capturas/portal-celebraciones-foto.png), [vacío](capturas/portal-celebraciones-vacio.png), [error](capturas/portal-celebraciones-error.png).
- [Detalle completo de Celebraciones a 390 px](capturas/celebraciones-390.png) y [a 1440 px](capturas/celebraciones-1440.png); son vistas separadas, útiles para leer todo el detalle que queda dentro del iframe.
- El resto de `capturas/` documenta los estados de autenticación, categorías, confirmación, conflictos y recuperación. Solo datos de prueba.

## Orden propuesto de trabajo

1. Corregir R01, R02 y R03 con pruebas de regresión específicas. No necesitan decisiones comerciales ni cambiar las protecciones de Shopify.
2. Resolver R04 y diseñar observabilidad R06; mantener distinción entre «no guardado» y «resultado desconocido».
3. Presentar a Dayana una maqueta de navegación móvil y contraste/tamaño (R05, R08, R09), incluyendo dónde ver los avisos.
4. Planificar R07 con medición de CPU y migración reversible; después historial y borradores según uso real (R10–R11).

No hay arreglo, push, despliegue o cambio de admin autorizado por esta revisión. El coordinador recibe este informe y el commit local para decidir la siguiente tarea.
