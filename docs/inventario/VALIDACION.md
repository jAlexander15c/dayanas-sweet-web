# Validación — Dayana Inventario

## Categorías automáticas por etiqueta (3 de noviembre de 2026)

Base `b0d01ac`. Implementación limitada a `services/inventario/**` y `docs/inventario/**`, sin commit, push, despliegue, Shopify real, secretos, cambios de scopes ni `wrangler.jsonc`. Se conservó el cambio previo del coordinador en `test/runtime-entry.mjs` (`/__test/real-shape`) y se agregó un fixture independiente para etiquetas. Las secciones siguientes son registros históricos: sus restricciones anteriores a colecciones manuales quedan sustituidas por este contrato.

| Punto | Resultado verificado |
| --- | --- |
| a. Esquema 2026-10 | Lectura directa con `curl.exe` de las URLs `.md` oficiales citadas en README: `Collection.sources` → `CollectionConditionsSource` → `inclusion/exclusion.conditions` y `selections`. La inclusión de etiqueta tiene tipo `CollectionSourceInclusionConditionProductTag`, relación `TAGGED_WITH` y un único elemento en `values`; no usa `EQUALS`. La consulta trae esos campos y detecta selecciones/exclusiones con `first: 1` y `hasNextPage`. |
| b. Clasificación pura | `classifyCollection` es la única clasificación del servidor; expone `kind` (`manual`, `tag`, `automatic`) y `tag` (cadena o null) en las colecciones de API. Conserva el criterio manual anterior, incluidas sus selecciones sin condiciones. Pruebas: manual vacía/con selecciones incluidas/excluidas, etiqueta, exclusión por condición/manual en etiqueta, dos condiciones/valores/fuentes, condición no etiqueta, relación negativa, selección adicional/paginada, subcolección sola/adicional y etiqueta vacía; también comprueban que la función no muta su entrada. |
| c. Adopción | Admite manual/etiqueta, conserva reglas, producto, título, descripción y handle; `collectionUpdate` solo recibe ID, metafields e imagen si corresponde. El resumen informa **Los productos entran a esta categoría con la etiqueta «galletas»**. Mantiene `updatedAt`, UUID, recibo y recuperación por relectura; la recuperación comprueba también el tipo/etiqueta, con compatibilidad para recibos manuales anteriores. |
| d. Productos | Crear en etiqueta usa `tagsAdd` con el valor exacto y nunca `collectionAddProducts`. Editar cubre manual→etiqueta, etiqueta→manual y etiqueta→etiqueta; quita únicamente etiquetas de categorías anteriores y conserva etiquetas ajenas/compartidas con el destino. El resumen indica también qué etiqueta se quitará. CAS compara las etiquetas exactas leídas al abrir y vuelve a comprobarlas antes de asignar. Una respuesta perdida en tagsAdd/tagsRemove se resuelve por relectura si el estado solicitado está aplicado; si falta o no se puede releer queda `REVIEW_REQUIRED`, sin reiniciar las otras mutaciones de crear/editar. Éxito por etiqueta comprobada, sin exigir pertenencia instantánea; aviso **Puede tardar unos segundos en aparecer en la categoría**. |
| e. Pertenencia/filtro | `categoryIds(product)` usa etiqueta sin distinguir mayúsculas o pertenencia ya existente. Búsqueda y detalle incluyen categorías calculadas en servidor; el filtro y tarjetas funcionan antes de actualizarse la colección. La paginación de pertenencias y el cursor del filtro se conservan. |
| f. Permisos | `tagsAdd` y `tagsRemove` admiten Product; el mapa oficial asigna escritura de Product a `write_products`. Se verificó que `REQUIRED_SCOPES` conserva exactamente sus ocho scopes. No hubo autorizaciones ni peticiones de scopes nuevos. |
| g. UI local | Cinco colecciones automáticas por etiqueta (Galletas, Brownies, Enlatados, Cajas para regalar, Postres), Más vendidos compleja sin botón y Página de inicio manual sin foto. Móvil 390×844 y escritorio 1440×1000, adopción/resumen/selector, producto con `GALLETAS` antes de pertenecer a colección, filtro Sin categoría y cambio Galletas→Brownies mediante etiquetas. Los resúmenes largos abren con foco en el encabezado y scroll arriba para leer antes de guardar. |

Archivos de implementación: `src/categories.mjs`, `src/shopify-client.mjs`, `src/inventory-service.mjs`, `src/validation.mjs`, `src/admin-ui.js`. Pruebas: nuevos `test/tag-categories.test.mjs` y `test/tag-categories-ui-check.mjs`; ajustes en `test/adopt-category-ui.test.mjs`, `test/shopify-fixture.mjs`, `test/runtime-entry.mjs`, `test/helpers.mjs`, `test/client.test.mjs` y `test/review.test.mjs` (el cliente lee ahora el catálogo de categorías al obtener productos). Documentación: README, este archivo y cuatro capturas `evidence/tag-*.png`.

Comandos desde `services/inventario`, Node `v22.14.0`, Wrangler `4.157.0`; todos terminaron con salida **0**:

```text
node --test test/*.test.mjs
1..216
# tests 216
# suites 0
# pass 216
# fail 0
# cancelled 0
# skipped 0
# todo 0

npx wrangler deploy --dry-run --outdir .wrangler/dry-run
wrangler 4.157.0
Total Upload: 136.64 KiB / gzip: 34.87 KiB
--dry-run: exiting now.
```

```powershell
$env:UI_BUNDLED_CHROMIUM='1'
node test/tag-categories-ui-check.mjs C:/Users/Milton/orca/OmniRoute/node_modules/@playwright/browser-chromium/node_modules/playwright-core
```

Salida real del recorrido (código **0**):

```text
Etiquetas UI OK: 390×844 y 1440×1000; 5 automáticas por etiqueta + Más vendidos compleja sin botón + Página de inicio manual sin foto; adopción y resumen; producto categorizado por etiqueta y filtro; cambio Galletas→Brownies con tagsAdd/tagsRemove sin mutar pertenencias ni reglas; aviso asíncrono; 0 errores JS; 0 llamadas reales a Shopify.
```

Se inspeccionaron las cuatro capturas: [lista móvil](./evidence/tag-categories-mobile.png), [lista escritorio](./evidence/tag-categories-desktop.png), [confirmación móvil](./evidence/tag-category-confirmation-mobile.png), [producto con categoría y aviso](./evidence/tag-product-mobile.png). Las listas no presentan desbordamiento horizontal; los resúmenes largos tienen scroll interno. App Bridge, fotos y Shopify son simulados; las imágenes de brownie ilustran fixtures y no las fotos reales de cada categoría. El aviso experimental de `node:sqlite` aparece en stderr y PowerShell lo muestra como `NativeCommandError`; no cambia la salida 0.

`node --check`: salida **0**, 30 archivos JS/MJS de src/test. `git diff --check`: salida **0**, sin problemas de espacios (solo avisos de normalización LF→CRLF). El bundle de `.wrangler/dry-run` no contiene `__test`, `local-test-secret`, `mock-admin-token` ni `shopify-fixture`.

Logs locales ignorados por git: `.wrangler/tag-tests.txt`, `.wrangler/tag-dry-run.txt`, `.wrangler/tag-ui-output.txt`. La documentación del esquema y scopes está enlazada junto a cada afirmación en [README](./README.md). Pendiente fuera del encargo: revisión del coordinador y cualquier despliegue o comprobación en Shopify real. Las mutaciones de etiquetas no tienen CAS atómico de Shopify: sigue existiendo la ventana de edición externa entre última lectura y escritura; una comprobación incierta no reinicia crear/editar. El conteo y la pertenencia de la colección automática pueden quedar atrasados unos segundos; categorías que comparten etiqueta comparten pertenencia.

## Adopción de colecciones existentes (3 de noviembre de 2026)

Base `c264ec7`, trabajo limitado a `services/inventario/**` y `docs/inventario/**`. El panel ya está desplegado y habilitado; esta tarea conserva `wrangler.jsonc` y `SERVICE_ENABLED=true`. No se tocó el tema, Celebraciones, Shopify real, secretos ni permisos; sin commit, push, despliegue o agentes auxiliares. El contrato de los tres metafields compartidos no cambió. Las secciones posteriores son registros de validaciones anteriores.

| Contrato | Implementación y comprobación |
| --- | --- |
| a. Lectura | `/api/categories` devuelve `categories` y `collections`; las segundas incluyen manual/automática, imagen, nombre, cantidad y publicación. El cliente completa las páginas Shopify de 25; la interfaz muestra 100 por página con Anterior/Siguiente. Las automáticas llevan la explicación sin botón, incluso si tienen la marca de categoría. Pruebas de 126 colecciones/6 páginas y UI de 103 colecciones/100+3. |
| b. Acción | `category_adopt` usa UUID, validación, resumen, confirmación, cola, recibo SQLite y auditoría de Historial. Portada Sí por defecto y orden después del máximo actual; se pueden cambiar. Alt actual precargado y obligatorio con foto; opcional sin foto. Foto nueva con el flujo existente o aviso **Sin foto: en la portada se verá el nombre sobre color**. El payload de actualización solo contiene ID, metafields e imagen cuando corresponde; conserva título, descripción, handle, productos y reglas. |
| c. Escritura/CAS | `ensureCategoryDefinitions` reutiliza la preparación idempotente existente. Tras preparar campos/subir foto, relee inmediatamente antes de `collectionUpdate`: compara `updatedAt`, manual y no categoría; 409 **La colección cambió, revisa y confirma otra vez** si no coinciden. Imagen existente con alt modificado usa ID; alt sin cambiar omite imagen. Repetir un recibo exitoso devuelve el resultado guardado sin Shopify. |
| d. Publicación opcional | Formulario y resumen indican **Hoy no se ve en la tienda. ¿Publicarla también?**; casilla explícita desmarcada. Marcada publica solo si falta; sin marcar adopta sin publicar y conserva **No se ve en la tienda** con el botón **Publicar en la tienda** existente. Pruebas de ambas opciones y de categoría ya publicada sin republicar. |
| e. Publicación no disponible | La lista indica publicación sin comprobar; se mantiene **Usar como categoría** y se omite la casilla de publicar. La adopción sin publicar funciona aunque fallen los permisos de publicaciones. Solicitar publicación sin canal falla antes de actualizar la colección. |
| f. Inciertos | `REVIEW_REQUIRED` conserva checkpoints y la misma clave. Al reintentar relee; si los valores/imagen/alt ya están aplicados, confirma el resultado sin repetir update, subida ni publicación. Pruebas de pérdida antes de aplicar y después de update/publicación, reinicio del servicio con SQLite conservado, persona/hash, y recuperación desde Historial con foto sin guardar bytes. Si la foto no está aplicada y el reintento viene de Historial sin bytes, exige revisión/confirmación original; esta última sigue disponible. |
| g. Productos | Tras adoptar, desaparece de pendientes y aparece en categorías y en el selector al abrir Nuevo producto. Prueba API de creación de producto usando la colección adoptada y recorrido de navegador del selector. No se migraron `collectionAddProducts`/`collectionRemoveProducts`. |

Archivos de código: `src/admin-page.mjs`, `src/admin-ui.js`, `src/categories.mjs`, `src/inventory-service.mjs`, `src/shopify-client.mjs`, `src/validation.mjs`. Pruebas: nuevos `test/adopt-category.test.mjs`, `test/adopt-category-ui.test.mjs`, `test/adopt-category-ui-check.mjs`; ajustes en `test/shopify-fixture.mjs` y `test/runtime-entry.mjs` para datos y rutas exclusivamente de prueba. Documentación: `README.md`, este archivo y seis capturas nuevas `evidence/adoption-*.png`.

Las primeras 16 pruebas nuevas dieron 14 fallos antes de implementar (los dos rechazos de validación ya pasaban por no existir la acción). La cobertura final añade **28 pruebas**, incluidas las comprobaciones de interfaz con VM, a las 157 existentes.

Comandos ejecutados desde `services/inventario`, Node `v22.14.0`, Wrangler `4.157.0`:

```text
node --test test/*.test.mjs
1..185
# tests 185
# suites 0
# pass 185
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3101.2828
```

Exit **0**, sin pruebas omitidas. Incluye el Worker y Durable Object SQLite reales en workerd local, con transporte Shopify sustituido por el simulador.

```text
npx wrangler deploy --dry-run --outdir .wrangler/dry-run
⛅️ wrangler 4.157.0
Total Upload: 128.01 KiB / gzip: 32.93 KiB
env.INVENTARIO (InventoryStore) Durable Object
env.SERVICE_ENABLED ("true") Environment Variable
--dry-run: exiting now.
```

Exit **0**; solo compilación local, sin despliegue. El bundle no contiene `__test`, `local-test-secret`, `mock-admin-token` ni `shopify-fixture`.

```powershell
$env:UI_BUNDLED_CHROMIUM='1'
node test/adopt-category-ui-check.mjs C:/Users/Milton/orca/OmniRoute/node_modules/@playwright/browser-chromium/node_modules/playwright-core
```

Exit **0**, salida real:

```text
Adopción UI OK: 390×844 y 1440×1000; paginación 100/3; manual/automática; alt obligatorio; portada sí y orden final; resumen; sin foto; publicación marcada/no marcada/no disponible; selector de productos; recuperación con foto desde Historial sin repetir escrituras; 0 errores JS; 0 llamadas reales a Shopify.
```

Se inspeccionaron `adoption-list-mobile.png`, `adoption-list-desktop.png`, `adoption-form-mobile.png`, `adoption-publication-mobile.png`, `adoption-confirmation-mobile.png` y `adoption-no-photo-mobile.png`: controles y avisos legibles, sin desbordamiento horizontal; formularios largos con scroll. La primera ejecución del recorrido falló al leer el formulario anterior antes de terminar la recarga de colecciones; el script ahora espera el encabezado de la colección seleccionada y el recorrido completo pasó. No se modificó el código de producto por ese fallo de sincronización de la prueba.

`node --check` en **28** JS/MJS: exit **0**. `git diff --check`: exit **0** (avisos habituales LF→CRLF). Logs completos locales ignorados: `.wrangler/adopt-test-output.txt`, `.wrangler/adopt-dry-run-output.txt`, `.wrangler/adopt-ui-output.txt`. El aviso experimental de `node:sqlite`, mostrado como `NativeCommandError` por PowerShell al redirigir stderr, no altera los exits 0.

Pendiente fuera de esta tarea: revisión del coordinador y cualquier despliegue/comprobación contra la tienda real. La comparación con `updatedAt` es optimista, no un bloqueo atómico de editores externos; una foto nueva puede seguir procesándose en Shopify y no se declara verificado su procesamiento remoto. No se borraron colecciones ni se agregó dejar de ser categoría.

## Correcciones de revisión independiente Opus (3 de noviembre de 2026)

Sobre HEAD `0658e1b`, únicamente `services/inventario/**` y `docs/inventario/**`. Se leyó la sonda `scratchpad/probe.mjs` y el contrato `contrato-categorias.md` entregados por el coordinador. No se modificaron tema, Celebraciones, secretos, permisos ni `wrangler.jsonc`; `SHOPIFY_SHOP=2n36xt-3a.myshopify.com` y `SERVICE_ENABLED=false` se conservan. Sin Shopify real, commit, push, despliegue ni agentes auxiliares.

| Punto | Cambio y evidencia |
| --- | --- |
| 1 | `src/inventory-service.mjs` y `src/admin-ui.js`: un productId reciente bloquea crear otro con el mismo título original en cualquier estado salvo ARCHIVED; la búsqueda exacta paginada considera DRAFT y ACTIVE. La regresión de creación ACTIVE con rechazo al publicar conserva una sola creación y una sola suma inicial. **Abrir el producto** carga Editar y, si ya está activo, ofrece **Completar publicación en Shopify** con el enlace al Admin. |
| 2 | `src/validation.mjs`: CAS conserva los valores exactos de Shopify, incluidos espacios y saltos al borde; título 255, alt 512. Editar y ordenar con esos valores pasan sin 409 artificiales; únicamente se recorta el texto nuevo. |
| 3 | `src/shopify-client.mjs`, `categories.mjs`, `validation.mjs`, `admin-ui.js`: las colecciones leen `publishedOnPublication(publicationId)`. **No se ve en la tienda** y **Publicar en la tienda** abren un resumen; `category_publish` relee el estado, publica solo si falta, guarda recibo/auditoría y tolera nueva confirmación tras respuesta perdida sin repetir la publicación aplicada. |
| 4 | `src/categories.mjs`: historial de creación pendiente, incierta o exitosa durante 24 h; también se relee una creación con ID conocido que falló después al publicar. Se relee el ID conocido o toda la lista si se perdió; ausencia confirmada libera el nombre, fallo de lectura no lo libera. Pruebas de incertidumbre sin colección, éxito reciente fuera de lista, publicación rechazada y vencimiento de ventana. |
| 5 | `src/inventory-service.mjs`: publicación al crear ACTIVE o pasar de otro estado a ACTIVE, previa consulta del estado publicado. Editar un ACTIVE no consulta publicaciones ni republica, aun sin canal/permisos de publicaciones. README y resumen corregidos; prueba de transición ya publicada con cero `publishablePublish`. |
| 6 | `src/http.mjs`, `admin-page.mjs`, `admin-ui.js`: `/api/session` compara `REQUIRED_SCOPES` con `currentAppInstallation.accessScopes` y entrega aviso explícito de faltantes. El arranque muestra inventario antes de cargar Categorías; un 403 de categorías conserva producción, corrección y edición sin cambiar categoría. README exige los 8 scopes autorizados antes de `SERVICE_ENABLED`. |
| 7 | `src/categories.mjs`, `validation.mjs`, `admin-ui.js`: HTML distinto de p/br queda solo lectura con aviso y se omite al mutar; auditoría y resumen indican que se conserva. Vacío envía `''`, nunca `<p></p>`. Más de 500 caracteres devuelve un error que nombra el límite. |
| 8 | `src/shopify-client.mjs`: identificación por `Publication.channels[].handle === 'online_store'`, independiente de idioma y sin nombres traducidos. Se pagina tanto publicaciones como sus canales; la prueba usa el nombre español y otra oculta el canal correcto en la segunda página. Fuentes oficiales: [Channel.handle 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Channel#field-Channel.fields.handle) y [ejemplo de Shopify del identificador online_store](https://community.shopify.dev/t/no-simple-way-to-check-variant-online-store-publication/35620/2). |
| 9 | `src/shopify-client.mjs`: `collectionCreate(collection: CollectionCreateInput)`, `collectionUpdate(collection: CollectionUpdateInput)` y `Collection.sources`; no se consulta `ruleSet` ni `Publication.name`. [collectionCreate 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/collectionCreate), [collectionUpdate 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/collectionUpdate), [migración de sources](https://shopify.dev/changelog/posts/new-collection-model-and-apis-now-available). |
| 10 | `src/categories.mjs`, `shopify-client.mjs`, `admin-ui.js`, `validation.mjs`: colecciones con condiciones/subcolecciones se excluyen de lista y categoryIds, y no se editan. La foto conservada usa `image.id`/altText. Selector vacío **No cambiar categoría**; orden inválido **Escribe un número de orden desde 1**; aria-labels **Subir/Bajar/Editar {título}**. Las consultas iniciales de pertenencias y canales se acotan y completan por paginación para contener su costo. |
| 11 | `test/category-review.test.mjs` añade 21 pruebas; `final-review.test.mjs` añade el bloqueo UI de ACTIVE fuera del historial. Se adaptan `categories.test.mjs`, `auth.test.mjs`, `shopify-fixture.mjs`, `runtime-entry.mjs`, `categories-ui-check.mjs` y `ui-check.mjs`. Incluye orden con fallo parcial y recuperación tras releer, sin reenvío ciego de la operación anterior. |

Las primeras 15 regresiones dieron 14 fallos contra el código original (el caso de orden parcial ya pasaba); las 2 regresiones iniciales de UI también fallaron antes de su implementación. Las pruebas adicionales conservan la recuperación de respuestas perdidas y la paginación. El contrato compartido del tema no cambió.

Comprobaciones desde `services/inventario`, con Node 22.14.0 y Wrangler 4.157.0:

```text
node --test test/*.test.mjs
1..151
# tests 151
# suites 0
# pass 151
# fail 0
# cancelled 0
# skipped 0
# todo 0

npx wrangler deploy --dry-run --outdir .wrangler/dry-run
Total Upload: 113.10 KiB / gzip: 30.03 KiB
env.INVENTARIO (InventoryStore) Durable Object
env.SHOPIFY_SHOP ("2n36xt-3a.myshopify.com") Environment Variable
env.SERVICE_ENABLED ("false") Environment Variable
--dry-run: exiting now.
```

Ambos comandos terminaron con exit 0. `node --check` para todos los JS/MJS de `src/` y `test/`, y `git diff --check`: exit 0. El aviso experimental de `node:sqlite` y los avisos de Git LF→CRLF no son fallos.

Recorridos con el Playwright ya instalado en `C:/Users/Milton/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright` y Chrome del sistema, sin nuevas dependencias, contra workerd/SQLite locales y Shopify simulado:

```text
node test/categories-ui-check.mjs <paquete-playwright>
CATEGORIES UI OK: 390x844 y 1440x1000; sin desbordamiento; crear/editar/ocultar/ordenar; foto/alt; categoría no publicada y reparación confirmada; formato solo lectura e imagen por ID; ACTIVE existente no republica; arranque con categorías 403 conserva producción/corrección/edición y aviso de scopes; 0 errores JS; 0 Shopify real.

node test/ui-check.mjs <paquete-playwright>
UI OK: 390×844 y 1440×1000; sin desbordamiento; USD; descripción con formato solo lectura; corrección con disponibles y aviso; producción 4→10; conflicto 409 con 13; creación DRAFT con foto; ACTIVE exige confirmación; Tab/Escape; historial; borrador reciente y parcial; venta concurrente actualiza resumen; uncertain se resuelve desde historial con misma clave sin doble suma; 0 errores JS; 0 llamadas reales a Shopify.
```

Ambos exit 0. El recorrido de Categorías también comprueba el duplicado activo en UI, el botón **Abrir el producto**, el enlace al Admin y ausencia de otra creación. Los HTTP 403/409/422/502 son fallos simulados esperados. En los primeros intentos, el script observó controles anteriores antes de abrir el diálogo y esperaba textos anteriores; se corrigieron las esperas y los textos, y se repitieron los recorridos completos.

Capturas nuevas: `category-unpublished-mobile.png`, `category-formatted-mobile.png`, `category-startup-degraded-mobile.png`, `category-warning-mobile.png`, `product-active-recovery-mobile.png`; se renuevan `categories-desktop.png`, `category-assigned-mobile.png`, `category-confirmation-mobile.png`, `formatted-description.png`, `partial-draft.png` y `product-publication-mobile.png`. Todas en `docs/inventario/evidence/`, con datos sintéticos. Logs completos locales en `.wrangler/category-review-test-output.txt`, `.wrangler/category-review-dry-run-output.txt`, `.wrangler/category-review-ui-output.txt` y `.wrangler/category-review-inventory-ui-output.txt` (ignorados por Git).

Pendientes fuera de alcance: autorización real de los 8 scopes (`read_products`, `write_products`, `read_inventory`, `write_inventory`, `read_locations`, `write_files`, `read_publications`, `write_publications`), instalación, despliegue/habilitación, comprobación real de fotos/permisos/publicación y revisión final del coordinador. Las mutaciones de categoría no tienen CAS atómico frente a editores externos; la publicación consulta su estado antes de mutar. Una creación sin ID depende de una relectura completa de colecciones para confirmar ausencia, sin garantía contra demoras de visibilidad de Shopify. Los registros que siguen son evidencia histórica; sus conteos y las referencias a APIs deprecadas no describen esta corrección.

## Entrega de categorías (3 de noviembre de 2026)

Sobre HEAD `1e86445`, solo `services/inventario/**` y `docs/inventario/**`. Contrato del tema respetado: colección manual publicada, `dayana.categoria`, `dayana.en_inicio`, `dayana.orden`, imagen y texto alternativo. Sin Shopify real, despliegue, cambios de permisos, secretos, commit ni push. La modificación previa de `wrangler.jsonc` no forma parte de esta implementación y se conserva; `SERVICE_ENABLED=false`.

Archivos de esta entrega:

- Servidor: `src/categories.mjs` (nuevo), `src/inventory-service.mjs`, `src/shopify-client.mjs`, `src/validation.mjs`, `src/http.mjs`.
- Interfaz: `src/admin-page.mjs`, `src/admin-ui.js`, `src/admin-ui.css`.
- Pruebas nuevas: `test/categories.test.mjs`, `test/categories-ui-check.mjs`; adaptación de `test/helpers.mjs`, `test/shopify-fixture.mjs`, `test/inventory.test.mjs`, `test/runtime.test.mjs`, `test/final-review.test.mjs`, `test/ui-check.mjs`.
- Documentación: este `VALIDACION.md`, `README.md` y las capturas enumeradas abajo en `evidence/`. Las rutas `src/` y `test/` pertenecen a `services/inventario/`.

Lista FINAL de scopes: `read_products`, `write_products`, `read_inventory`, `write_inventory`, `read_locations`, `write_files`, `read_publications`, `write_publications`. Nuevos: `read_publications` ([publications 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/publications)) y `write_publications` ([publishablePublish 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/publishablePublish)). Definiciones COLLECTION usan los scopes del recurso productos; [metafieldDefinitionCreate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/metafieldDefinitionCreate) no exige un scope genérico adicional de metafields. Las URLs oficiales versionadas redirigen a `latest`, cuyo selector indica 2026-10.

Pruebas nuevas: crear categoría manual/foto/metafields/publicación, definiciones idempotentes y lectura storefront, tipo incompatible, duplicado normalizado, creación incierta sin duplicar, edición CAS, ocultar portada, ordenar/CAS de lista, crear producto con categoría obligatoria, cambio de categoría conservando colecciones ajenas, pertenencia concurrente, trabajo asíncrono incierto, filtro sin categoría, publicación al crear/activar y fallos de canal/publicación, validación/autorización y scopes documentados. También se verifican todas las páginas de colecciones/publicaciones/definiciones/pertenencias y lectura fallida después de asignar (incierto, sin repetir).

Comprobaciones finales ejecutadas desde `services/inventario`, con salida real:

```text
node --test test/*.test.mjs
1..129
# tests 129
# suites 0
# pass 129
# fail 0
# cancelled 0
# skipped 0
# todo 0

npx wrangler deploy --dry-run --outdir .wrangler/dry-run
wrangler 4.157.0
Total Upload: 104.98 KiB / gzip: 28.31 KiB
env.INVENTARIO (InventoryStore) Durable Object
env.SERVICE_ENABLED ("false") Environment Variable
--dry-run: exiting now.
```

Ambos comandos terminaron con exit 0. `node:sqlite` emite su aviso experimental habitual en Node 22.14.0; no hay pruebas omitidas. La simulación de inventario se corrigió para mover físico/disponible juntos al sumar o corregir, como Shopify: tras producir 6, el físico pasa de 6 a 12, y el conflicto simulado posterior devuelve 13. No se cambió la lógica de inventario de producción.

Recorridos de navegador ejecutados con Chrome instalado y Playwright externo `C:/Users/Milton/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright` (sin nueva dependencia):

```text
node test/ui-check.mjs <paquete-playwright>
UI OK: 390×844 y 1440×1000; sin desbordamiento; USD; descripción con formato solo lectura; corrección con disponibles y aviso; producción 4→10; conflicto 409 con 13; creación DRAFT con foto; ACTIVE exige confirmación; Tab/Escape; historial; borrador reciente y parcial; venta concurrente actualiza resumen; uncertain se resuelve desde historial con misma clave sin doble suma; 0 errores JS; 0 llamadas reales a Shopify.

node test/categories-ui-check.mjs <paquete-playwright>
CATEGORIES UI OK: 390x844 y 1440x1000; sin desbordamiento; foto/alt obligatorio; resumen sin mutación; crear/editar/ocultar/ordenar; crear categoría dentro de producto conserva formulario; ACTIVE confirma y publica; cambiar categoría; filtro sin categoría; 0 errores JS; 0 Shopify real.
```

Ambos exit 0. Los HTTP 409/422/502 impresos por el recorrido anterior son fallos simulados que el script espera y comprueba. Se ajustó el orden de los diálogos en el DOM para mantener accesible la confirmación por encima de categoría/producto, y se añadieron etiquetas explícitas a los selectores de producto.

Capturas verificadas a 390×844 en `docs/inventario/evidence/`: `categories-mobile.png`, `category-new-mobile.png`, `category-edit-mobile.png`, `category-confirmation-mobile.png`, `categories-uncategorized-mobile.png`, `category-product-mobile.png`, `product-publication-top-mobile.png`, `product-publication-mobile.png`, `category-assigned-mobile.png`. Escritorio: `categories-desktop.png` (1440×1000). También se actualizaron las capturas del recorrido previo; todas usan fixtures sintéticos y el recurso gráfico local existente, sin tráfico real a Shopify.

Limitaciones pendientes fuera de alcance: autorizar scopes nuevos en la app real, desplegar/habilitar el Worker, probar permisos/fotos/publicación real y revisar el tema del otro worker. Las mutaciones de colecciones/publicación no tienen CAS atómico ni `@idempotent`: se compara antes de escribir y cualquier resultado incierto exige revisar en Shopify; no se reenvía la mutación. `dayana.en_inicio` controla exclusivamente la portada y no excluye la categoría de `/collections`; `dayana.orden` se valida entero >=1. Los campos heredados/deprecados de colecciones y `Publication.name` siguen disponibles en 2026-10 y deberán migrarse antes de actualizar esa versión.

Los resultados H1–H4 que siguen son el registro histórico anterior a categorías.

3 de noviembre de 2026. Correcciones finales H1–H4 sobre el commit `04d02a3`, worktree `inventario-panel`, únicamente en `services/inventario/**` y `docs/inventario/**`. No hubo llamadas reales a Shopify, cambios en apps/scopes/secretos, cambios al tema o Celebraciones, commit, push ni despliegue. `SERVICE_ENABLED` continúa en `false`.

## Revisión final H1–H4

| Hallazgo | Cambio y comprobación |
| --- | --- |
| H1: errores de idempotencia | `src/shopify-client.mjs` reconoce códigos `IDEMPOTENCY_*` tanto en `userErrors.code` como en `errors[].extensions.code`, antes de clasificar respuestas parciales o rechazos CAS. `IDEMPOTENCY_CONCURRENT_REQUEST` espera 2000 ms y reenvía una sola vez la misma consulta, variables y clave; si persiste devuelve `REVIEW_REQUIRED`/`uncertain` y permite Reintentar con la misma operación. Mensaje: “Shopify aún está guardando este cambio. Espera un momento y pulsa Reintentar; no lo hagas de nuevo.” Mismatch y otros errores de idempotencia quedan inciertos sin reenvío automático; `src/inventory-service.mjs` conserva la prohibición de reintento también en recibo e historial. Ningún error de idempotencia genera `failed`. |
| H2: creación incierta sin ID | `src/inventory-service.mjs` y `src/admin-ui.js` consideran creaciones recientes inciertas o pendientes sin productId durante 24 h y con título normalizado (NFC, espacios y mayúsculas). Además buscan con `titleSearch` por todas las páginas y comparan el título completo de cada DRAFT. El bloqueo pide revisar en Shopify y ofrece Abrir el borrador cuando se conoce el ID. La búsqueda HTTP de la UI respeta el máximo de 100 caracteres aunque el título permita 200. |
| H3: borrador borrado | Ambas guardas ignoran únicamente el candidato cuya lectura devuelve 404/`PRODUCT_NOT_FOUND`, siguen revisando los otros candidatos y la búsqueda, y permiten crear si no hay otro bloqueo. El caso B se adapta como borrado real: no se deja artificialmente otro DRAFT con el mismo título en los resultados de búsqueda. |
| H4: disponibles después de corregir | `src/admin-ui.js` muestra `conteo − (on_hand − available)`, incluyendo todas las cajas no disponibles. La prueba ejecuta la UI real con físico 10, disponible 4, committed 2 y conteo 5: el resumen debe mostrar −1, no 3. |

`test/final-review.test.mjs` añade 18 regresiones: caso A sin doble suma en tres formatos de respuesta, concurrente persistente y mismatch en esos formatos, primera respuesta incierta sin clave nueva incluso tras una venta, caso G con búsqueda y sin resultados, paginación con coincidencia exacta, caso B, guardas de UI, cálculo H4 y límite HTTP de búsqueda. Las regresiones fallaron contra el código anterior antes de implementar los cambios; el caso de primera respuesta incierta ya pasaba y se conserva como protección.

Comprobaciones finales ejecutadas desde `services/inventario`:

`node --test test/*.test.mjs` — salida **0**:

```text
1..104
# tests 104
# suites 0
# pass 104
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2675.298
```

Incluye workerd y Durable Object SQLite locales; ninguna prueba omitida. El único aviso es el carácter experimental de `node:sqlite` en Node 22. Salida completa en `.wrangler/final-test-output.txt` (ignorado por Git).

`npx wrangler deploy --dry-run --outdir .wrangler/dry-run` — salida **0**:

```text
wrangler 4.157.0
Total Upload: 77.17 KiB / gzip: 22.35 KiB
env.INVENTARIO (InventoryStore)                                    Durable Object
env.SHOPIFY_SHOP ("REPLACE.myshopify.com")                         Environment Variable
env.SHOPIFY_CLIENT_ID ("REPLACE_WITH_NEW_APP_CLIENT_ID")           Environment Variable
env.INVENTARIO_STAFF_IDS ("164797317424")                          Environment Variable
env.INVENTARIO_STAFF_NAMES ("{}")                                  Environment Variable
env.SERVICE_ENABLED ("false")                                      Environment Variable
--dry-run: exiting now.
```

`node --check` sobre todos los JS/MJS de `src/` y `test/`, y `git diff --check` — salida **0**. Git advierte únicamente de normalización LF→CRLF.

Recorrido adicional de la UI real en Chromium de Playwright, con HTML/JS/CSS del panel y todas las rutas interceptadas localmente — salida **0**:

```text
UI final 390x844: H4 -1 con no disponibles distintos de committed; H2 sin ID bloqueado; H3 borrado permite confirmar; sin overflow ni errores JS; cero llamadas reales.
UI final 1440x1000: H4 -1 con no disponibles distintos de committed; H2 sin ID bloqueado; H3 borrado permite confirmar; sin overflow ni errores JS; cero llamadas reales.
```

Se inspeccionaron las dos capturas locales `.wrangler/final-ui-mobile.png` y `.wrangler/final-ui-desktop.png`: resumen y controles legibles. El primer intento del script temporal falló porque la tubería de PowerShell convirtió acentos de los selectores en `?`; se corrigieron los selectores y se repitió el recorrido completo con el resultado anterior. No se ejecutó de nuevo el recorrido histórico `test/ui-check.mjs`; estas verificaciones acotadas cubren los cambios finales y sus tamaños de pantalla.

Los detalles y las capturas de la revisión anterior se conservan abajo como evidencia histórica; sus conteos y tamaños de paquete corresponden a aquella revisión.

## Revisión anterior: entrega por puntos 1–11

Las rutas de código de esta tabla son relativas a `services/inventario/`.

| Punto | Resultado y archivos |
| --- | --- |
| 1. Descripción | `src/shopify-client.mjs` consulta `descriptionHtml` además del texto para mostrarlo; `src/admin-ui.js`, `src/validation.mjs` y `src/inventory-service.mjs` requieren un cambio explícito para enviarlo. Estado/precio/fotos omiten el campo y conservan los bytes del HTML original. HTML distinto de párrafos/saltos queda en solo lectura con el aviso solicitado; el servidor también impide sobrescribirlo. La auditoría/checkpoint guarda el HTML anterior antes de mutar. Descripciones largas sin cambios no bloquean otros campos. README corregido. |
| 2. Errores GraphQL | `src/shopify-client.mjs` distingue errores generales con resultado parcial o conexión cortada (`uncertain`), `ACCESS_DENIED` (403 con mensaje de permisos) y `THROTTLED` (espera de 1000 ms, un reintento idéntico, mismo `@idempotent`; si persiste, 503/código propio y mensaje solicitado). No se exponen errores internos ni tokens. |
| 3. Inciertos/pending | `src/inventory-service.mjs`, `src/durable-store.mjs` y `src/admin-ui.js`: estado `uncertain` en recibos/auditoría y texto “Sin confirmar: revisa antes de repetir”. Para producción/corrección, reintento con el mismo operationId, persona, datos y clave dentro de 24 h; se guardan intención y cantidad CAS/clave exactas antes de enviar. `pending` reciente se bloquea y después de 2 min puede recuperarse; Historial materializa su estado incierto. Reintento también desde Historial tras recargar. Reenvío de una solicitud ya aplicada obtiene el resultado original sin otra suma. |
| 4. Búsqueda | `src/shopify-client.mjs`: palabras alfanuméricas Unicode, especiales filtrados, `title:brownie* title:caja*`, sin comillas que inutilicen el prefijo. Prueba de las variables realmente enviadas. |
| 5. Corrección | `src/admin-ui.js`: resumen “Disponibles quedarán en X” (total menos apartadas) y aviso explícito si el conteo es menor que las apartadas. |
| 6. Creación parcial | `src/inventory-service.mjs`, `src/errors.mjs`, `src/admin-ui.js`: conservar productId y checkpoints; botón “Abrir el borrador” carga el producto en Editar. UI y servidor comprueban borradores recientes con el mismo título conocidos por auditoría y vigentes en Shopify antes de crear otro. |
| 7. Edición con CAS | `src/admin-ui.js`, `src/validation.mjs`, `src/inventory-service.mjs`: snapshot al abrir; comparación de título, HTML, estado, precio y SKU, incluidas todas las opciones si son varias. Un cambio devuelve 409/PRODUCT_CHANGED y valores actuales antes de subir fotos/mutar, y pide cerrar/reabrir para revisar. |
| 8. Autenticación | `src/cloudflare-worker.mjs`, `src/http.mjs`, `src/shopify-client.mjs`: firma y claims/allowlist en el Worker antes de resolver/tocar DO; el DO verifica otra vez. Token exchange exige associated_user.id igual a sub verificado. Caché online por persona/entorno solo en memoria hasta expires_in; no se persiste. Pruebas reales en workerd acreditan cero accesos al binding del DO sin token o con firma inválida. |
| 9. Producción | `src/inventory-service.mjs`: lee available al ejecutar; no rechaza por comparar con el valor viejo del formulario. Ante rechazo CAS explícito, relee y reintenta hasta dos veces con sufijos :cas:1/:cas:2. Solo ese rechazo permite una clave nueva porque garantiza que ese intento no aplicó la suma. El checkpoint conserva el intento vigente para recuperar pérdidas de respuesta con su misma clave. Corrección conserva 409. `src/admin-ui.js` refresca el resumen al revisar y al primer confirmar; si cambió, pide confirmar el resumen actualizado antes de enviar. Tras el primer envío, el payload queda fijo para todo reintento. |
| 10. USD | `src/admin-ui.js`: Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}) en tarjetas, resumen e historial, por ejemplo $12.00. Sin conversión de importes. |
| 11. Pruebas | `test/inventory.test.mjs` ahora comprueba de verdad ausencia de adjust en corrección y renombra la prueba que no reiniciaba el servicio. `test/review.test.mjs` agrega regresiones y reinicios reales del servicio conservando SQLite. Se adaptan `test/helpers.mjs`, `test/client.test.mjs`, `test/shopify-fixture.mjs`, `test/runtime-entry.mjs`, `test/runtime.test.mjs` y `test/ui-check.mjs`. Fixture simula idempotencia, CAS, throttling, permisos y pérdida de respuesta después de aplicar. |

`README.md` contiene el contrato operativo actualizado. Capturas renovadas y nuevas en `evidence/`: `mobile.png`, `desktop.png`, `confirmation.png`, `conflict.png`, `formatted-description.png`, `correction-warning.png`, `partial-draft.png`, `uncertain.png`.

## Comprobaciones con salida real final

Ejecutadas desde `services/inventario`, Node `v22.14.0`, Wrangler `4.157.0`.

`node --test test/*.test.mjs` — salida **0**:

```text
1..86
# tests 86
# suites 0
# pass 86
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3001.7083
```

Cubre descripción conservada al editar estado/precio/fotos, HTML anterior durable antes de mutar, GraphQL parcial→uncertain, throttling con espera y misma clave, permisos 403, límites exactos exp/nbf/iat con tolerancia de 3 s, reintento incierto tras reiniciar sin doble mutación, pending colgado y previo al envío, vencimiento de 24 h, recuperación aunque el producto desaparezca, venta concurrente y límite de dos reintentos CAS, consulta de búsqueda, conflictos de edición y comparación de opciones, borrador reciente, caché online/identidad/vencimiento y Worker sin tocar DO cuando falla auth. Incluye workerd y DO SQLite locales reales; no se omitieron pruebas.

`npx wrangler deploy --dry-run --outdir .wrangler/dry-run` — salida **0**:

```text
⛅️ wrangler 4.157.0
Total Upload: 74.07 KiB / gzip: 21.54 KiB
Your Worker has access to the following bindings:
env.INVENTARIO (InventoryStore)                                    Durable Object
env.SHOPIFY_SHOP ("REPLACE.myshopify.com")                         Environment Variable
env.SHOPIFY_CLIENT_ID ("REPLACE_WITH_NEW_APP_CLIENT_ID")           Environment Variable
env.INVENTARIO_STAFF_IDS ("164797317424")                          Environment Variable
env.INVENTARIO_STAFF_NAMES ("{}")                                  Environment Variable
env.SERVICE_ENABLED ("false")                                      Environment Variable

--dry-run: exiting now.
```

Recorrido visual con un paquete Playwright ya instalado, sin añadir dependencias:

```powershell
$env:UI_BUNDLED_CHROMIUM='1'
node test/ui-check.mjs C:/Users/Milton/orca/OmniRoute/node_modules/@playwright/browser-chromium/node_modules/playwright-core
```

Salida **0**:

```text
UI OK: 390×844 y 1440×1000; sin desbordamiento; USD; descripción con formato solo lectura; corrección con disponibles y aviso; producción 4→10; conflicto 409 con 7; creación DRAFT con foto; ACTIVE exige confirmación; Tab/Escape; historial; borrador reciente y parcial; venta concurrente actualiza resumen; uncertain se resuelve desde historial con misma clave sin doble suma; 0 errores JS; 0 llamadas reales a Shopify.
```

Se inspeccionaron las ocho capturas; botones, avisos y resumen son legibles. Se usó Chromium instalado de Playwright: el intento con Chrome del sistema tuvo fallos/bloqueo de transporte y capturas y no se declara aprobado. Los mensajes de consola HTTP 409/422/502 del recorrido final corresponden a conflictos, fallo parcial y respuesta perdida provocados por el fixture; todos esos resultados se comprueban y se recuperan. El aviso experimental de node:sqlite en Node 22 y su presentación NativeCommandError por la redirección de stderr de PowerShell no alteraron el código de salida 0.

`node --check` — salida **0**, 20 archivos JS/MJS de src/test comprobados. `git diff --check` — salida **0**, sin errores de espacios (Git avisa sobre normalización LF→CRLF). La búsqueda de `__test`, `local-test-secret`, `mock-admin-token` y `shopify-fixture` en `.wrangler/dry-run` no tuvo coincidencias. Logs locales completos en `.wrangler/test-output.txt`, `.wrangler/dry-run-output.txt` y `.wrangler/ui-output.txt` (ignorados por git).

## Límites y pendientes

- La recuperación con la misma clave cubre producción/corrección. Shopify no anuncia @idempotent para productCreate/productUpdate/cambios de variantes: un resultado incierto de esos pasos conserva el estado y exige revisar el borrador/producto, sin volver a crearlo ni duplicar fotos. Tampoco se reinicia un flujo de creación entero si quedó incierto durante su inventario inicial. “Abrir el borrador” se ofrece cuando ya se conoce productId.
- La prevención de borrador duplicado comprueba productos conocidos por los últimos 100 eventos de auditoría dentro de 24 h, bloquea creaciones inciertas sin ID y busca coincidencias exactas entre los DRAFT de Shopify. Las creaciones inciertas sin ID requieren revisión aunque la búsqueda todavía no encuentre resultados; la búsqueda de Shopify puede tener demora de indexación.
- La comparación de edición es optimista, al recibir la confirmación y antes de mutar; las mutaciones de producto no proporcionan una transacción distribuida ni un bloqueo de otros editores durante todos los pasos.
- Continúan pendientes fuera de alcance: crear/instalar la app, configurar URL/scopes/placeholders/secretos, verificar App Bridge/token exchange y permisos reales, revisar fotos procesadas y cámara en celular físico dentro de Shopify, aprobación visual del coordinador y cualquier despliegue/habilitación. No se ejecutó ninguna de esas acciones.

## Acceso del personal por App Proxy — entrega inicial, 2026-11-04

Validación local de las secciones 1–5 de `CONTRATO-ACCESO.md`. Sin deploy, secretos reales, envío de correos reales, configuración de Shopify, commit ni push. No se modificaron el contrato ni la maqueta aprobada. La integración visual/RPC completa de Celebraciones corresponde a la otra sesión; aquí se verifica el punto de extensión y el 501 sin binding.

Desde `services/inventario`:

| Comprobación ejecutada | Resultado real |
| --- | --- |
| `npm test` | **241/241 PASS**, 0 fallos, 0 omitidas, salida 0; 216 pruebas existentes y 25 nuevas |
| `npm run check` | **PASS**, salida 0; Wrangler 4.157.0, upload 188.73 KiB / gzip 48.41 KiB; `EXTERNAL_LOGIN_ENABLED="false"`; sin binding Celebraciones |
| `node test/portal-ui-check.mjs <playwright-core>` | **PASS**, salida 0, siete pantallas en 390×844 y 1440×1000, 14 capturas, 44 px y sin desbordamiento, 0 errores JS |
| `node test/ui-check.mjs <playwright-core>` | **PASS**, salida 0, móvil/desktop, producción, corrección, conflicto, DRAFT/foto, publicación, historial y recuperación incierta; 0 errores JS, 0 Shopify real |
| `node test/categories-ui-check.mjs <playwright-core>` | **PASS**, salida 0, creación/edición/orden/portada/publicación, formato y arranque degradado; 0 errores JS, 0 Shopify real |
| `node test/adopt-category-ui-check.mjs <playwright-core>` | **PASS**, salida 0, adopción con/sin foto, paginación y recuperación; 0 errores JS, 0 Shopify real |
| `node test/tag-categories-ui-check.mjs <playwright-core>` | **PASS**, salida 0, categorías por etiquetas, adopción, filtro y cambio Galletas→Brownies; 0 errores JS, 0 Shopify real |

Paquete usado: `C:/Users/Milton/orca/OmniRoute/node_modules/@playwright/browser-chromium/node_modules/playwright-core`, con `$env:UI_BUNDLED_CHROMIUM='1'`. No se agregaron dependencias. Los scripts de UI ejecutan el Worker/DO con workerd y SQLite reales locales, sustituyen Shopify y Resend, y bloquean cualquier otro origen. El portal usa puerto local 38762 y un adaptador de prueba que simula la firma añadida por Shopify al App Proxy en cada petición; no omite la validación de firma del Worker.

Salidas completas: [npm test](./evidence/portal-npm-test.txt), [dry-run](./evidence/portal-dry-run.txt). El recorrido básico imprime como parte de sus escenarios las respuestas esperadas 409/422/502; no son errores JavaScript ni fallos de la comprobación. SQLite de Node emite su advertencia experimental habitual.

Los primeros recorridos existentes detectaron **dos aserciones ya desactualizadas en HEAD**: categorías esperaba “Se guardará…” aunque la UI existente usa “Se creará…”; etiquetas esperaba borrar `galletas` aunque su fixture ya almacena `GALLETAS` y el servicio elimina la grafía exacta. Se actualizaron solo esas aserciones a las conductas existentes y se volvieron a ejecutar ambos recorridos hasta salida 0. El comportamiento de categorías y productos no se cambió.

### Cobertura nueva

| Regla | Evidencia |
| --- | --- |
| Firma válida/alterada/vieja/futura/otra tienda, duplicados, cliente ignorado | `portal.test.mjs` + HTML/assets/API en `portal-runtime.test.mjs` |
| Interruptor apagado → 503, JSON POST obligatorio, master Bearer/lista | `portal.test.mjs`, `portal-runtime.test.mjs` |
| PBKDF2 100000, política, sal aleatoria, login genérico y desconocidos | `staff-identity.test.mjs` |
| Cinco fallos, 15 minutos y fin del bloqueo, buckets por UUID/correo, global 50 y usuario `global` | `staff-identity.test.mjs` |
| Sesión 32 bytes/hash, 12 h, 2 h sin uso, logout y versión | `staff-identity.test.mjs`; UI verifica almacenamiento/borrado/recarga |
| Invitación fragmento, un uso incluso paralelo, 48 h, reenvío/cancelación/reactivación | `staff-identity.test.mjs`; UI retira fragmento antes de API |
| Recuperación genérica, seis dígitos, HMAC, 10 min, 5 intentos, 3/h, proveedor fallido | `staff-identity.test.mjs`; UI correo simulado y contraseña nueva |
| Contraseña/desactivación/quitar rol revocan, último admin incluso en paralelo, solo admin | `staff-identity.test.mjs` |
| Rol inventario para operar, auditoría `user:<id>` y nombre, misma API validada | `portal.test.mjs` y operación real en DO de `portal-runtime.test.mjs` |
| OFFLINE exchange, `expiring=1`, AES-GCM, refresh rotado/serializado/persistido, caducidad y reconexión | `portal.test.mjs`, `portal-runtime.test.mjs`; cliente offline no hace exchange online |
| Resend sin logs de destinatario/token/código, excepciones Shopify sanitizadas | `portal.test.mjs` con captura de logs y mensajes sensibles sintéticos |
| Gateway reservado 501 con sesión/rol, actor generado servidor/aud, sin firma ni sesión en RPC | `portal.test.mjs` |

### Capturas revisadas

| Pantalla | Celular 390 px | Computadora 1440 px |
| --- | --- | --- |
| Primer usuario desde Shopify | [móvil](./evidence/portal-primer-usuario-mobile.png) | [desktop](./evidence/portal-primer-usuario-desktop.png) |
| Crear contraseña por invitación | [móvil](./evidence/portal-invitacion-mobile.png) | [desktop](./evidence/portal-invitacion-desktop.png) |
| Entrar | [móvil](./evidence/portal-entrar-mobile.png) | [desktop](./evidence/portal-entrar-desktop.png) |
| Panel | [móvil](./evidence/portal-panel-mobile.png) | [desktop](./evidence/portal-panel-desktop.png) |
| Usuarios | [móvil](./evidence/portal-usuarios-mobile.png) | [desktop](./evidence/portal-usuarios-desktop.png) |
| Olvidé mi contraseña | [móvil](./evidence/portal-olvide-mobile.png) | [desktop](./evidence/portal-olvide-desktop.png) |
| Código y nueva contraseña | [móvil](./evidence/portal-codigo-mobile.png) | [desktop](./evidence/portal-codigo-desktop.png) |

Se conserva la estructura aprobada: marca, acceso centrado, usuario/contraseña, invitación con usuario fijo, formulario y tarjetas de usuarios, recuperación en dos pasos y seis casillas de código. Se reutilizan los componentes de productos/categorías del panel. Las casillas de permisos permiten combinar los tres roles y el formulario pide usuario explícito; son necesarios para el contrato. Se mantiene el estilo existente y `prefers-reduced-motion`; no se cargan las fuentes remotas de la maqueta por CSP. En recuperación se omite el correo enmascarado para mantener respuesta genérica.

### CPU y pendientes

No se bajó PBKDF2 de 100000. Cinco hashes medidos localmente en Node dieron **60.06 ms de pared y 62.4 ms de CPU de proceso por hash**, como referencia local, sin equivaler a CPU de producción. Cloudflare confirma el límite en workerd y documenta 30 segundos por invocación DO (aquí se ejecuta el hashing), frente a 10 ms para peticiones Workers Free comunes; enlaces en README. No se consultó el plan de la cuenta ni se midió CPU de producción: comprobarlo antes de habilitar, sin reducir silenciosamente el hash.

Pendiente exclusivamente operativo/integración: secretos, remitente Resend, App Proxy, redirección, conexión OFFLINE real, primer administrador, revisión visual final, validación con Shopify/proxy reales, despliegue autorizado y habilitación del interruptor. La otra sesión integra el shell y binding de Celebraciones. Ninguno de estos pasos se ejecutó aquí.

## Acceso del personal — correcciones de revisión, 2026-11-04

Sustituye los resultados anteriores para el estado actual del acceso. Implementación y decisiones por hallazgo, con archivo:línea y pruebas: [ENTREGA-ACCESO.md — Correcciones de revisión](./ENTREGA-ACCESO.md#correcciones-de-revisión). El contrato, la maqueta, el tema, Shopify y `forwardToCelebraciones` permanecen sin editar; flag apagado, sin commit/push/deploy ni secretos/correos reales.

| Comprobación | Resultado real |
| --- | --- |
| Regresiones nuevas antes del arreglo: `node --test test/staff-review.test.mjs` | **10 fallos / 10**, 0 canceladas/omitidas, salida 1: reproducen I1, I2 (hash/rutas), I3 (recuperación/invitación), M4 (códigos/fallos), M5, M6 y M7. Posteriormente se añadió la undécima prueba de validación de sesión durante PBKDF2. |
| `npm test` | **252/252 PASS**, 0 fallos/canceladas/omitidas, salida 0: las 241 previas y 11 regresiones. |
| `node --test test/portal-runtime.test.mjs` después de ampliar el proveedor lento | **PASS**, salida 0; workerd/SQLite y ambos namespaces reales; `recover existente/inexistente 8.6/8.4 ms; proveedor simulado 300 ms, cola libre.` |
| `npm run check` | **PASS**, salida 0; 192.11 KiB / gzip 49.25 KiB; `INVENTARIO (InventoryStore)` + `IDENTITY (StaffIdentityStore)`; flag `false`; `--dry-run: exiting now.` |
| `node test/portal-ui-check.mjs <playwright-core>` | **PASS**, salida 0; siete pantallas, 390/1440 px, 44 px, CSP, invitación, OFFLINE, usuarios, recuperación/cambio/login/recarga y logout sin red con borrado local persistente. |
| `git diff --check` | Salida **0**; únicamente avisos LF/CRLF. |
| `node --check` sobre `src`/`test` | **45 archivos JS/MJS PASS**, salida 0. Tras añadir el proveedor lento también se repitieron `npm test` (252/252) y portal-ui-check, ambos salida 0. |
| `rev/hmac.mjs` original | Salida **0**; vector oficial OK, firma vieja y alterada rechazadas. |
| `rev/ident.mjs` original, sin editar | A–H correctos: admin entra después de 50 fallos; doble aceptación y desactivación cruzada protegidas; expiraciones correctas; quinto error de cambio revoca sesiones; recuperación **1/1 ms**. Salida **1** en I porque intenta leer el correo antes del envío diferido (`TypeError` en `h.code()`). |
| `rev/ident.mjs` ejecutado desde memoria con espera explícita del envío | Salida **0**; solo se insertó `await h.flush()` tras `recover` del harness, sin escribir el script original. A–G iguales, H **1/0 ms**; `I código de la víctima tras recover ajeno: OK`. Salida completa y explicación en la entrega. |

Nuevas pruebas: el global nunca bloquea al activo sin bloqueo propio; bloqueos sin `deriveBits`; enrutado a namespaces distintos; validación de sesión durante PBKDF2; respuesta de recuperación sin esperar proveedor ni cola y misma forma/mensaje; invitación sin retener cola, incluida cancelación durante envío; límite persistente 6/24 h incluso reinicio, 3/h conservado y dos códigos vigentes sin expulsar al primero; fallos de reset compartidos por UUID sin reinicio al emitir; login/cambio comparten fallos y revocan al quinto; aviso propio de cancelación; logout local ante red fallida. La prueba workerd inspecciona que `operations`/`audit`/OFFLINE siguen en el DO original y las tablas de identidad solo en el nuevo, además de conservar el 401 tras RPC para sesiones revocadas.

Para el recorrido de navegador se reutilizó el paquete Playwright indicado arriba y Chromium instalado (`UI_BUNDLED_CHROMIUM=1`); `PORTAL_UI_EVIDENCE_DIR=%TEMP%/inventario-portal-review-ui` produjo 14 capturas temporales sin tocar los PNG anteriores fuera del alcance. Ninguna dependencia nueva. Se conserva la advertencia experimental de `node:sqlite`; todos los proveedores son simulados y los orígenes externos se bloquean.

La separación usa nueva clase SQLite/migración `v2` sin alterar `v1`; no requiere migrar identidades porque nunca se desplegaron. El envío diferido usa `ctx.waitUntil`, un intento y timeout 15 s, sin alarma/reintentos automáticos. Los códigos usados/fallidos se retienen 24 h para el tope diario; una tercera petición con dos códigos válidos no envía ni revoca. No queda corrección de estos siete hallazgos pendiente; siguen los pasos de producción y la integración separada ya enumerados.
