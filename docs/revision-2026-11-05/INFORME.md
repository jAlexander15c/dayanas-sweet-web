# Revisión del proyecto y propuesta SEO — Dayana’s Sweet

Fecha: 5 de noviembre de 2026. **Solo propuesta: no se ha implementado, publicado ni cambiado configuración de producción.**

## Alcance, fuentes y método

Se revisaron el tema, los dos servicios, los flujos sensibles y el contenido público. La revisión combina lectura de código, pruebas existentes, reproducciones locales con dobles de Shopify/correo, HTML público y navegación de solo lectura. No equivale a certificar que no existen otros errores.

- **Tema publicado:** `origin/main`, commit `f66a6bbd84be9aadf6191b46fabd9b2281e0b711`, confirmado por el coordinador. Se examinó en un worktree temporal desprendido. Las referencias de tema de este informe corresponden a ese commit, salvo indicación explícita.
- **Workers publicados:** checkout `C:/Users/Milton/orca/workspaces/dayanas-sweet-web/inventario-panel`, commit `1dd5c0311f11955f793054b015264c2de974ee2d`. Las referencias `services/*` corresponden a esta fuente. El coordinador había comunicado despliegues Celebraciones `712643e7` e Inventario `9b439a64`; esta auditoría no alteró ni volvió a desplegar esos servicios.
- **Checkout principal:** realmente está en `codex/seguimiento-celebraciones@25f82bb`, con cambios locales. No se trató como producción ni se modificaron sus archivos de aplicación. El `main` local `cb036d9` tampoco sustituye a la referencia publicada confirmada.
- **Modelos:** dos revisores `gpt-6.1-sol`, ambos con esfuerzo **high**, uno para tema y otro para Workers. Elegidos por el riesgo de pagos, concurrencia y permisos y por la necesidad de descartar falsos positivos. La sesión Codex coordinadora realizó el contraste, la investigación SEO y la síntesis. No se usó un modelo distinto para generar recomendaciones comerciales sin evidencia.
- **Sitio público:** HTML de 13 de las 19 URLs del sitemap convencional pudo leerse correctamente. Se inspeccionaron además `robots.txt`, índice y cuatro sub-sitemaps. Seis URLs devolvieron `429 local_rate_limited`; se detallan abajo. No se atribuye ese resultado automáticamente a Googlebot ni a una penalización.

## 1. Resumen ejecutivo: diez acciones de mayor impacto

Los servicios tienen una base sólida: **598 pruebas existentes de backend pasan** y no se confirmó un acceso indebido ni duplicación de cargos. Sin embargo, hay fallos reproducibles de operación y concurrencia que conviene resolver antes de aumentar tráfico. En SEO, el mayor trabajo está en catálogo, contenido comercial y señales locales, acompañado de mejoras técnicas concretas.

| Prioridad | Propuesta | Impacto esperado | Esfuerzo estimado | Responsable sugerido |
|---|---|---|---|---|
| 1 | Limitar y agrupar comentarios/avisos de solicitudes (F1) | Evitar cientos de correos y pérdida de visibilidad de pagos | Medio, 1–2 días | Codex |
| 2 | Escribir solo campos realmente editados en Inventario y revisar concurrencia (F2) | Evitar sobrescribir precios ajenos | Medio/alto, 2–3 días | Codex; revisión Claude |
| 3 | Revalidar cancelación al emitir el enlace de saldo (F3) | No presentar como pagable una orden recién cancelada | Bajo, medio día | Codex |
| 4 | Corregir conflictos falsos y confirmaciones de guardado (F4–F5) | Operación fiable del panel | Medio, 1–2 días | Codex |
| 5 | Corregir foco del carrito y enlaces de ayuda (F6–F7) | Accesibilidad y menos abandono/confusión | Bajo/medio, 1 día | Codex lógica; Claude contenido/UI |
| 6 | Definir claramente qué se envía y qué se recoge; validar cobertura de productos refrigerados | Evitar expectativas incompatibles y orientar SEO local/nacional | Bajo en texto; depende de Dayana | Dayana + Claude |
| 7 | Publicar contenido y productos suficientes para cada categoría prioritaria | Captar búsquedas con intención de compra | Medio/alto, 1–3 semanas | Dayana/admin + Claude |
| 8 | Completar títulos, descripciones y presentación comercial de inicio y pasteles | Mejorar relevancia y presentación en resultados | Bajo/medio, 1–2 días | Claude + admin Shopify |
| 9 | Recuperar datos de organización, añadir breadcrumbs y ordenar indexación | Mejor comprensión de entidad y navegación; menos páginas de escaso valor | Medio, 1–2 días | Codex + datos de Dayana |
| 10 | Medir Search Console/CWV y reducir fuentes; trabajar presencia local verificable | Priorizar por resultados y mejorar carga/descubrimiento local | Medio inicial; continuo | Codex medición; Dayana GBP/contenido |

Los tiempos son estimaciones de implementación y validación, no compromisos de calendario. **No es posible garantizar “#1”**: conviene perseguir consultas concretas de producto/ubicación, pedidos rentables y crecimiento medible. Google tampoco ofrece una fórmula que garantice la primera posición; en resultados locales intervienen relevancia, distancia y notoriedad. [Guía SEO de Google](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [ranking local](https://support.google.com/business/answer/7091).

## 2. Errores confirmados y propuesta de corrección

### F1 — Alto: una solicitud puede generar 500 avisos y correos para Dayana

**Fuente:** `services/celebraciones/src/store-core.mjs:645`, `store-core.mjs:327`, `services/celebraciones/src/staff-alerts.mjs:21` y `:60`.

Cada comentario del cliente genera una notificación independiente. Existe un máximo acumulado de 500 comentarios por solicitud, pero no un límite temporal ni agrupación. Una invitada controla su solicitud sin verificar previamente el correo.

**Reproducción:** en memoria, una solicitud invitada admitió 500 comentarios consecutivos y produjo 500 alertas sin leer y correos pendientes. El comentario 501 devolvió `CONFLICT`. No se enviaron correos reales. Esto puede saturar la bandeja/cola y agotar la conversación, aunque la creación inicial tenga cuotas. No se comprobó si Cloudflare añade controles externos.

**Propuesta:** límites persistentes por solicitud/principal y ventana temporal, presupuesto global de avisos, agrupación de mensajes cercanos y tratamiento preferente de pagos. Mantener respuesta comprensible y reintento. **Codex**, con pruebas de ráfagas y concurrencia. Criterio: una ráfaga no produce un correo por mensaje ni bloquea indefinidamente la conversación legítima.

### F2 — Alto: editar un nombre puede sobrescribir un precio cambiado por otra persona

**Fuente:** `services/inventario/src/admin-ui.js:213`, `services/inventario/src/inventory-service.mjs:136`, `:151` y `:152`.

El formulario envía también precio y SKU aunque no se hayan cambiado. La comparación con el estado esperado se hace antes de varias llamadas asíncronas; después se vuelven a escribir esos valores antiguos.

**Reproducción:** edición de nombre con precio inicial `12.00`; el mock cambió el precio en Shopify a `99.00` después de guardar el nombre. El siguiente paso lo dejó otra vez en `12.00` y respondió `200/SAVED`.

**Propuesta:** distinguir campos modificados y omitir escrituras no solicitadas; releer los campos que sí se modificarán antes de cada etapa relevante, conservar estados parciales y comunicar conflictos. Esto reduce la ventana de carrera; no prometer atomicidad entre sistemas si Shopify no la ofrece. **Codex**, revisión Claude. Criterio: editar solo nombre nunca escribe precio/SKU.

### F3 — Medio: la comprobación final de saldo ignora una cancelación concurrente

**Fuente:** `services/celebraciones/src/payment-service.mjs:478` y `:480`.

Después de obtener la URL de pago se relee el pedido, pero se comparan importes y pagos pendientes sin volver a comprobar `cancelledAt`. La comprobación anterior de cancelación, en `:468`, no cubre este intervalo.

**Reproducción:** primera lectura válida y última lectura cancelada: devuelve `stage: "balance"`, `reviewRequired: false` y URL, conservando la reserva. **No demuestra que Shopify permita cobrar ese pedido cancelado**; demuestra que la aplicación publica un estado incorrecto.

**Propuesta:** aplicar la validación completa al último objeto, retirar URL y mostrar revisión cuando cambie el estado. **Codex**. Añadir regresión de cancelación entre lectura inicial y comprobación final.

### F4 — Medio: espacios en valores existentes impiden editar sin que haya conflicto real

**Fuente:** `services/inventario/src/validation.mjs:10`, `:94`, `:97`; `services/inventario/src/inventory-service.mjs:136`.

El validador recorta espacios del título/SKU esperados y luego compara esos valores con los originales exactos de Shopify. Productos heredados con espacios iniciales/finales fallan incluso al reabrirlos.

**Reproducción:** título `" Brownie "` o SKU `" B-1 "`: `409 PRODUCT_CHANGED`, cero mutaciones. **Propuesta:** validar tipo/longitud de las expectativas sin normalizarlas; normalizar por separado los nuevos valores. **Codex**. Criterio: un producto sin cambios externos permite edición aunque su valor anterior tenga espacios.

### F5 — Medio: un fallo de recarga oculta una categoría guardada correctamente

**Fuente:** `services/inventario/src/admin-ui.js:269`, `:274`, `:281` y `:292`.

Tras éxito se cierran los diálogos y se espera la recarga de categorías. Si falla esa lectura, el error se escribe en un diálogo cerrado, queda la intención pendiente y el mensaje principal sigue en “Guardando en Shopify…”.

**Reproducción:** VM/DOM simulado, `category_order` exitoso y fallo únicamente de lectura posterior: recibo exitoso, error invisible e intención conservada. **Propuesta:** confirmar/limpiar la operación al recibir su recibo; manejar por separado la recarga con aviso visible y botón para actualizar. **Codex**, revisión visual Claude. No confundir fallo de visualización con fallo de escritura.

### F6 — Medio: el foco sale del carrito modal con Mayús+Tab

**Fuente:** `assets/cart-drawer.js:41` y `assets/global.js:89`.

En carrito vacío se confina el foco a `.drawer__inner-empty`, pero se enfoca su padre `.drawer__inner`. Mayús+Tab inmediatamente después de abrir escapa del diálogo.

**Evidencia:** reproducido con Chrome usando los archivos reales y en la tienda pública a 390 px. **Propuesta:** enfocar un control dentro del contenedor confinado o usar el mismo contenedor para diálogo/foco. **Codex**; Claude valida visualmente. Probar Tab, Mayús+Tab, Escape y retorno al disparador, vacío y con productos.

### F7 — Medio: ayuda de Contacto enlaza a destinos inexistentes

**Fuente:** `sections/ds-contact.liquid:58` y `:59`; HTML público de `/pages/contact`.

“Preguntas frecuentes” y “Cómo funcionan las tandas” enlazan a `/#ds-preguntas` y `/#ds-tandas`. La portada publicada no contiene esos IDs. El usuario vuelve al inicio sin obtener la respuesta.

**Propuesta:** enlazar a ayuda real y rastreable o incorporar los destinos en el diseño vigente. **Claude**. Criterio: cada enlace muestra el contenido anunciado tanto en móvil como mediante teclado.

### F8 — Bajo: confirmación de eliminación incompatible con títulos existentes largos

**Fuente:** `services/inventario/src/validation.mjs:59` y `:94`.

Se limita a 200 caracteres el título de confirmación/expectativa. Un producto existente de 201 caracteres devuelve `400 VALIDATION` y no puede borrarse desde el panel. No se comprobó si hay productos reales afectados.

**Propuesta:** separar límites de nuevos datos de la capacidad de confirmar/identificar datos heredados admitidos por Shopify. **Codex**. Mantener rol Inventario, estado archivado y confirmación explícita.

### F9 — Bajo: dos pruebas del tema fallan antes de comprobar su funcionalidad

**Fuente:** `tests/orders-settings.test.mjs:95`, `tests/redesign-integration.test.mjs:7`.

En la fuente publicada, `templates/index.json` lleva un comentario de cabecera generado por Shopify. Dos pruebas usan `JSON.parse` directamente y fallan con `Unexpected token '/'`. `check-theme` sí procesa correctamente ese formato: **no es evidencia de un tema inválido**.

**Propuesta:** compartir el lector de JSON con comentarios utilizado por la validación del tema. **Codex**. Criterio: los casos alcanzan sus aserciones y fallan únicamente ante una regresión funcional.

## 3. Recomendaciones y límites que no son errores confirmados

| Área | Evidencia / límite | Propuesta | Impacto / esfuerzo / responsable |
|---|---|---|---|
| Sesión compartida | `services/inventario/src/staff-ui.js:5` guarda bearer en localStorage del origen de tienda; fue una decisión aceptada para App Proxy | Documentar el riesgo de cualquier script ejecutado en ese origen; inventariar apps/scripts y evaluar aislamiento de origen como alternativa futura, sin cambiarlo en esta revisión | Alto potencial / alto si cambia arquitectura / Codex + Dayana |
| Creaciones invitadas | `store-core.mjs:359`: presupuesto global de 100 solicitudes/24 h; direcciones diferentes pueden consumirlo | Separar protección de abuso de disponibilidad legítima, medir rechazos y valorar verificación/controles externos. No afirmar ataque observado | Medio/alto / medio / Codex |
| Borrado concurrente | `inventory-service.mjs:125` lee ARCHIVED; `shopify-client.mjs:286` elimina por ID | Probar reactivación externa entre lectura y borrado; documentar límite de concurrencia y política de operación | Alto si ocurre / medio / Codex |
| Observabilidad | Ambos `wrangler.jsonc` desactivan observabilidad | Métricas y registros sanitizados de colas, antigüedad, errores y operaciones `unknown`; nunca sesiones, fotos ni enlaces privados | Alto operativo / medio / Codex |
| Recuperación de datos | No se revisaron backups ni retención reales | Definir conservación de fotos, solicitudes, recibos y prueba de restauración | Alto / medio / Codex + Dayana |
| Cierre de tanda | Ocultar botones no impide comprar por rutas directas; AGENTS indica que cierre real es stock cero | Comprobar inventario controlado/no continuar vendiendo y procedimiento de stock cero. No inferir fallo sin revisar configuración | Alto / bajo operativo / Dayana + Codex |
| Recogida/envío | Contacto dice “No ofrecemos retiro presencial” (`ds-contact.liquid:81`); pasteles sí publica recogida en Fulshear (`ds-celebracion-solicitud.liquid:74`, `:183`) | Redactar la excepción: productos de tienda por envío; pasteles según recogida acordada, si esa es la política real | Alto comercial / bajo / Dayana + Claude |
| Bebidas refrigeradas | Jugos/capuchino indican refrigeración y consumo en 7 días; instrucciones globales anuncian USPS Priority a todo EE. UU. | Confirmar cobertura, embalaje, conservación y plazos reales por familia antes de prometer envío nacional para todas. No se probó checkout ni se concluye incumplimiento | Alto comercial / pendiente operación / Dayana |
| Fuentes | Portada móvil: 10 descargas, 739.468 bytes; cuatro `ds-r-font-*` suman 499.312. Archivos `.woff2` tienen formato TrueType, coherente con CSS `format('truetype')` | WOFF2 real/subconjuntos, menos variantes y evitar precargas Dawn innecesarias. No cambiar la apariencia aprobada sin revisión | Medio/alto / medio / Codex |
| Hero | `sections/ds-redesign-home.liquid:13`: sin srcset; imagen natural 1983×793 mostrada a 390×235 | Variantes por ancho y sizes adecuados, preservando prioridad alta de la imagen principal | Medio / bajo / Claude/Codex |

La imagen hero **no descargó 1,87 MB** en el navegador de prueba: el CDN entregó aproximadamente 118.988 bytes. No deben confundirse pesos del repositorio con transferencia real. Fuentes: `assets/ds-redesign.css:1`, declaraciones en `layout/theme.liquid:80` y precargas en `:311` y `:316`.

## 4. SEO: diagnóstico y estrategia propuesta

### 4.1 Mercado real y objetivo

El sitio comunica origen cubano/artesanal en Houston, venta en español y moneda USD. La página de pasteles ofrece recogida en **Fulshear, Texas 77441**. Por tanto hay dos estrategias distintas:

1. **Pasteles por encargo:** intención local Fulshear/Katy/oeste de Houston, según radio que Dayana atienda realmente. No presentar una dirección en Houston centro ni inventar sucursales.
2. **Productos enviables:** búsquedas de producto, regalos y sabores, inicialmente en español y, si se decide atenderlo, inglés. La cobertura nacional debe verificarse por familia, especialmente refrigerados.

El “#1 en galletas/brownies/jugos” genérico nacional no es un objetivo operativo defendible con seis productos publicados y sin datos de demanda/conversión. Priorizar consultas específicas y medir ventas/solicitudes válidas. Las palabras clave siguientes son **hipótesis por intención**, no resultados de una herramienta de volumen ni estimaciones de tráfico.

### 4.2 Qué se comprobó técnicamente

| Elemento | Diagnóstico observado | Propuesta / propietario | Impacto / esfuerzo |
|---|---|---|---|
| Inicio | Title solo `Dayana’s Sweet`; falta meta description. H1 de marca “Un pedacito de Cuba en Houston” | Añadir título comercial y descripción específica en Preferencias de Shopify; conservar voz de marca y explicar oferta debajo del H1. Admin/Claude | Alto / bajo |
| Meta descriptions | Ausentes en inicio, Contacto, pasteles, seguimiento, cajas para regalar y Noticias; presentes en cinco productos legibles y Jugos | Priorizar páginas comerciales. No rellenar mecánicamente todas ni usar meta keywords. Admin/Claude | Medio/alto / bajo |
| H1 | Exactamente un H1 en las 13 respuestas HTML 200 analizadas | Conservar estructura; no contar encabezados ocultos de drawers como múltiples H1. Hacer el de pasteles más específico | Medio / bajo |
| Canónicas | Una canónica absoluta y coherente en esas 13 páginas | Mantener; revisar parámetros/filtros y versiones idiomáticas cuando existan, sin canonicalizar productos distintos a una colección | Medio / bajo |
| Idioma | `html lang="es"`; cabecera observada `es-US`; no se observó conjunto de hreflang | No es un fallo si solo existe español. Si se publica inglés, URLs propias, traducción revisada, canónicas y hreflang recíprocos | Alto mercado adicional / alto |
| Product | Cinco fichas legibles contienen JSON-LD Product con Offer, precio USD y disponibilidad; sin error de parseo | Mantener `product | structured_data` (`sections/main-product.liquid:752`). Validar Rich Results/Merchant Center y políticas reales; no inventar ratings/GTIN | Medio/alto / medio |
| Entidad de marca | Ningún JSON-LD en inicio/Contacto/pasteles analizados. Dawn tiene Organization en `sections/header.liquid:461` y WebSite en `:488`, pero está deshabilitado en `sections/header-group.json:22`; la cabecera activa es la propia | Recuperar Organization/WebSite; añadir Bakery/LocalBusiness solo con datos reales y condiciones adecuadas. Codex + Dayana | Medio / medio |
| BreadcrumbList | Migas visibles en colecciones, sin BreadcrumbList en respuestas analizadas | Añadir marcado de las migas que realmente se muestran. Codex | Medio / bajo |
| Sitemap | Índice accesible; cuatro sitemaps convencionales enumeran 19 URLs; además existe sitemap de descubrimiento agentic | Enviar/verificar sitemap en Search Console; no editar manualmente XML generado por Shopify. Admin | Alto diagnóstico / bajo |
| Robots | Accesible; permite contenido público y bloquea distintas rutas privadas/filtros; declara sitemap | Mantener reglas razonables. Robots no sustituye autenticación ni garantiza desindexación | Medio / bajo |
| Seguimiento | `/pages/seguimiento-de-tu-pastel` aparece en sitemap, sin noindex observado; muestra shell genérico sin solicitud | Proponer `noindex` para esta utilidad y exclusión del sitemap mediante mecanismo Shopify disponible, sin bloquear el rastreo que debe leer noindex. No es una fuga de datos demostrada | Bajo/medio / bajo |
| Colecciones vacías | Cajas para regalar: HTTP 200, 0 productos. Noticias: sin artículos en HTML. Galletas no pudo leerse directamente | Decidir cuáles se van a desarrollar; no mantener páginas vacías como destinos comerciales. No redirigir indiscriminadamente todo a inicio ni noindex automático por agotamiento temporal | Medio / bajo/medio |
| Alt | 25 imágenes en inicio, todas con atributo alt; 20 vacíos, principalmente iconos decorativos. Hero y colecciones con imagen tienen textos descriptivos | No “corregir” todos los alt vacíos: son adecuados para decoración. Revisar imágenes informativas del producto/cart por contexto | Bajo/medio / bajo |
| Rendimiento | Hero y fuentes medidos; scripts de tema observados usan defer/module y hay estilos/precargas globales | Reducir fuentes/CSS no usado después de medir; no eliminar a ciegas recursos de Shopify o funciones de compra | Medio/alto / medio |

La plantilla ya admite `page_description` (`layout/theme.liquid:28`); completar campos del admin es preferible a introducir una descripción genérica fija en todas las páginas. Google puede formar o reescribir títulos y snippets: las metas propuestas no son una garantía de presentación exacta. [Títulos](https://developers.google.com/search/docs/appearance/title-link), [descripciones](https://developers.google.com/search/docs/appearance/snippet).

Ejemplos para revisión de Dayana, **no aplicados**:

- Inicio: **“Dayana’s Sweet | Dulces artesanales desde Houston”**. Descripción: “Descubre brownies, conservas y bebidas hechas por encargo. Consulta la próxima fecha de envío y cotiza tu pastel personalizado con Dayana.” Ajustar familias disponibles y cobertura antes de publicar.
- Pasteles: **“Pasteles personalizados en Fulshear y Katy | Dayana’s Sweet”**, solo si Katy forma parte del mercado atendido. Descripción centrada en ocasión, cotización y recogida acordada, sin prometer entrega inmediata.
- Brownies: **“Brownies de chocolate y almendras por encargo | Dayana’s Sweet”**, alineado con el producto real. No introducir “sin gluten”, “saludable” u otras propiedades no confirmadas.

### 4.3 Diagnóstico por categoría y mapa de palabras clave

| Categoría / destino | Estado y oportunidad | Consultas objetivo propuestas | Contenido/acción | Impacto / esfuerzo / dueño |
|---|---|---|---|---|
| Galletas — `/collections/galletas` | Visible en portada y sitemap; no hay productos identificables como galletas en el sitemap de seis productos. HTML directo limitado por 429: **no se afirma colección vacía sin comprobarla** | “galletas artesanales por encargo”, “galletas con chocolate Houston”; “cookies delivery Houston” solo con contenido/servicio real | Confirmar productos activos, sabores, tamaño/unidades por caja, ingredientes/alérgenos, conservación, fechas/envío; fotos reales. Colección con introducción útil y enlaces a fichas | Alto si es línea prioritaria / medio-alto / Dayana/admin + Claude |
| Brownies — `/collections/brownies` | Un producto público en sitemap, “Brownie Box – Almendras & Chocolate”; ficha/colección limitaron lectura. Debe diferenciarse de “Postres” y “Más vendidos” | “brownies de chocolate y almendras”, “caja de brownies para regalar”, “brownie box delivery” | Confirmar cantidad, peso/tamaño, textura, alérgenos, empaque/regalo y cobertura. No duplicar el mismo texto entre producto y colección | Alto / medio / Dayana + Claude |
| Conservas saladas — `/collections/conservas-saladas` | Producto Tomate Confitada, $10, descripción gastronómica; faltan en el texto leído contenido neto y conservación | “tomates confitados en aceite de oliva”, “tomates confitados artesanales”, “conservas saladas artesanales” | Preferir nombre correcto “Tomates confitados” sin cambiar URL por capricho; especificar cantidad, uso, conservación y cobertura confirmada. Guía útil de usos enlazada al producto | Medio/alto / medio / Dayana/admin + Claude |
| Jugos y bebidas — `/collections/jugos-y-bebidas` | Cuatro productos, $4 cada uno, 250 ml; ingredientes/refrigeración/7 días presentes. Capuchino figura como categoría Product “Jugos” | “jugo de guayaba 250 ml”, “jugo de piña y coco”, “capuchino frío por encargo”; términos locales según cobertura | Mantener datos concretos; aclarar azúcar/leche, conservación y entrega. Ajustar tipo de producto capuchino si conviene. No prometer “detox”, beneficios médicos ni “sin azúcar” | Medio / medio / Dayana/admin |
| Celebraciones — `/pages/pasteles-personalizados` | Formulario completo, recogida Fulshear y condiciones de pago; falta meta description y contenido comercial/portfolio suficiente antes del formulario | “pasteles personalizados Fulshear”, “pasteles de cumpleaños Katy”, “custom cakes Fulshear”, “pastel de guayaba Houston” solo si se ofrece | Galería propia con permiso, estilos y tamaños/porciones, sabores reales, antelación, radio/recogida, proceso y FAQ útil. Enlace claro a cotizar. No exponer fotos de referencia de clientas como portfolio sin permiso | Muy alto / medio-alto / Dayana + Claude; Codex SEO técnico |

No convertir cada variación de ciudad en una página casi idéntica. Una página local completa y verificable puede servir a varias zonas; crear páginas adicionales solo si aportan información propia. Para inglés, traducir navegación, condiciones y fichas completas, no insertar palabras sueltas. [Versiones localizadas](https://developers.google.com/search/docs/specialty/international/localized-versions).

### 4.4 Competidores públicos y diferenciación

Muestra de competidores encontrados para Fulshear/Katy; **no es un ranking de Maps ni una medición de cuota de mercado**:

- [The Creative Baker](https://www.thecreativebaker.com/menu): comunica Fulshear, zonas atendidas, tamaños/porciones y precios orientativos. Oportunidad para Dayana: explicar dimensiones y expectativas antes de cotizar.
- [The Station Bakery](https://www.thestationbakery.com/order-a-cake): separa pedidos, precios/tamaños y sabores. Oportunidad: enlazado claro entre información y solicitud.
- [Elly’s Bakery](https://ellysbakery.com/): explica recogida en Katy, especialidad cultural y proceso de pedido. Oportunidad: concretar la propuesta cubana de Dayana con productos e historia propios.
- [Katy Bakes](https://katybakestx.com/): variedad visible, ocasiones y zonas de servicio. Oportunidad: contenido por ocasión respaldado por un catálogo disponible.

No copiar sus textos/fotos, no adoptar sus precios sin calcular costes y no afirmar que Dayana ofrece los mismos productos. La ventaja posible está en especialidad, experiencia y claridad operativa, no en repetir “Houston” en cada frase.

### 4.5 Google Business Profile, reseñas y SEO local

No se pudo identificar de forma inequívoca una ficha propia mediante las búsquedas realizadas. **Eso no demuestra que no exista**. Falta enlace directo o acceso de lectura a la ficha y Search Console.

Propuesta para Dayana:

1. Confirmar si existe perfil verificado y qué atención presencial/recogida/servicio local se presta realmente. Un negocio exclusivamente online no es elegible; una dirección publicada no prueba por sí sola elegibilidad. No crear perfiles duplicados ni domicilios ficticios. [Elegibilidad de Google](https://support.google.com/business/answer/13763036).
2. Si corresponde, mantener nombre real, categoría principal adecuada, horario real —incluidas condiciones por cita—, teléfono y web coherentes. Decidir correctamente cómo representar dirección/zona de servicio según operación y reglas del perfil.
3. Incorporar fotos propias recientes, catálogo y enlace directo a la cotización. Pedir reseñas a clientes reales de forma neutral y responderlas; no fabricar ni ofrecer incentivos por valoraciones positivas.
4. Conseguir menciones legítimas de negocios/eventos/cámaras locales cuando haya colaboración real. No comprar paquetes de enlaces ni crear directorios masivos.

Impacto esperado: **alto para demanda local si es elegible**; esfuerzo medio inicial y trabajo continuo. Google relaciona resultados locales con información completa, relevancia, distancia y notoriedad; no se puede controlar la ubicación del buscador. [Documentación de ranking local](https://support.google.com/business/answer/7091).

### 4.6 Datos estructurados: qué añadir y qué evitar

- **Organization/WebSite:** identidad consistente, URL, logo y perfiles oficiales confirmados; no depender del JSON-LD de una sección Dawn que ya no se renderiza.
- **Bakery/LocalBusiness:** considerar solo tras confirmar datos, ubicación/atención y campos exigidos. Si no se desea publicar una dirección apropiada para ese marcado, no inventarla para conseguir un resultado enriquecido. [LocalBusiness](https://developers.google.com/search/docs/appearance/structured-data/local-business).
- **Product:** conservar fuente Shopify para precio/disponibilidad; revisar políticas de envío/devolución y Merchant Center si se decide participar. El dato estructurado y el feed deben corresponder a lo visible. [Product](https://developers.google.com/search/docs/appearance/structured-data/product).
- **BreadcrumbList:** derivarlo de navegación visible y URLs canónicas; no inventar jerarquías. [BreadcrumbList](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb).
- No añadir AggregateRating sin reseñas auténticas elegibles ni prometer estrellas/FAQ enriquecidas por insertar JSON-LD. Validar con las herramientas de Google antes de publicar.

### 4.7 Plan por fases y medición

| Fase | Trabajo propuesto | Resultado verificable | Impacto / esfuerzo |
|---|---|---|---|
| Rápido: primera semana tras aprobación | F1–F7; completar inicio/pasteles; corregir ayuda y política recogida/envío; revisar destinos vacíos; acceso de lectura a GSC/GBP | Reproducciones corregidas; cero enlaces de ayuda sin destino; páginas prioritarias con título/descripcion propios; baseline documentada | Alto / medio |
| Primer mes | Contenido de cinco categorías, fichas completas, portfolio, entidad/breadcrumbs, fuentes, medición mobile; inglés solo si hay capacidad de atención | Catálogo coherente; schema validado; Search Console sin errores técnicos prioritarios; medición de solicitudes/pedidos por landing | Alto / medio-alto |
| Continuo | Disponibilidad y calendario correctos; fotos/reseñas reales; guías útiles, menciones locales, seguimiento semanal y revisión mensual | Más consultas pertinentes y pedidos válidos; menos abandonos/incidencias; ajustes según datos | Alto acumulativo / medio recurrente |

Medir por separado **marca/no marca**, móvil/desktop y páginas de producto/colección/pasteles. Indicadores: páginas comerciales indexadas, impresiones/clics/CTR por consulta, solicitudes válidas, conversión a reserva/pago, ingresos/margen y tiempo de respuesta. No fijar un crecimiento porcentual inventado sin línea base. La posición media sirve como señal, no como único objetivo.

Core Web Vitals debe medirse con datos de usuarios reales cuando haya muestra suficiente: objetivos orientativos al percentil 75 **LCP ≤2,5 s, INP ≤200 ms, CLS ≤0,1**. Una navegación local o un tamaño de imagen no sustituye CrUX/Search Console. [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals).

## 5. Qué depende de cada parte

| Parte | Responsabilidad |
|---|---|
| Codex | Correcciones de concurrencia, pagos, cuotas/avisos, estado de UI, foco, pruebas, schema derivado, medición y optimización técnica |
| Claude | Contenido/UI, navegación de ayuda, integración coherente de páginas, revisión visual desktop/mobile y coordinación de publicación posterior |
| Admin Shopify | Metadatos SEO de tienda/colecciones/productos, productos activos y canales, imágenes/alt, tipos, políticas, menús y eventual traducción |
| Dayana | Datos y fotos verdaderos, permisos de portfolio, servicio/recogida/envío, conservación, catálogo rentable, reseñas y elegibilidad/gestión de Google Business |
| Ambos agentes | Revisiones cruzadas y una publicación coordinada cuando se aprueben cambios. No publicar desde el checkout local antiguo |

## 6. Comprobaciones, resultados y límites

### Pruebas ejecutadas

| Fuente / comando | Resultado real |
|---|---|
| Workers `1dd5c03`: `npm test` dentro de `services/inventario` | **255/255 PASS**, 0 omitidas |
| Workers `1dd5c03`: `npm test` dentro de `services/celebraciones` | **343/343 PASS**, 0 omitidas |
| Tema publicado `f66a6bb`: `node tests/check-theme.mjs` | **PASS: 42 JS, 69 JSON, 57 esquemas** |
| Tema publicado: `node --test tests/celebracion-solicitud.test.mjs tests/celebracion-seguimiento.test.mjs tests/celebracion-transporte.test.mjs tests/celebracion-invitados.test.mjs tests/celebracion-seguimiento-browser.test.mjs` | **50/50 PASS**, incluye navegador de seguimiento |
| Tema publicado: `node --test tests/orders-settings.test.mjs tests/categories.test.mjs tests/redesign-home.test.mjs tests/redesign-integration.test.mjs tests/redesign-navigation.test.mjs tests/topping-selector.test.mjs` | **74 PASS / 2 FAIL**, ambos por lectura JSON con comentario (F9), no ocultados. Se utilizó `$env:DS_QA_ROOT='C:/Users/Milton/AppData/Local/Temp/ds-category-liquid-tests'`, dependencia LiquidJS temporal ya existente, sin instalar paquetes |
| Harness principal `node C:/Users/Milton/orca/dayanas-sweet-web/tests/browser-regressions.mjs`, ejecutado con cwd del worktree publicado | **12/12 PASS** contra assets `f66a6bb`. El harness no forma parte del commit publicado; origen y assets se distinguen explícitamente |
| Reproducciones adicionales de Workers | F1–F5 y límite F8 reproducidos en memoria/mock/VM; sin tráfico de pagos/correos reales |
| Navegador público de solo lectura | Portada móvil 390 px sin overflow horizontal; foco del carrito vacío falla; recursos tipográficos/hero medidos |
| Rama local, comprobación auxiliar | check-theme 40 JS/69 JSON/54 esquemas; 34 pruebas de frontend y una ejecución auxiliar de 12 browser-regressions PASS. **No sustituyen validación de producción** |

Las pruebas aprobadas no cubrían los escenarios límite hallados. No se modificaron tests para hacerlos pasar.

La configuración publicada anuncia cierre el **15 de noviembre a las 23:59, hora de Houston**, y envío el **18 de noviembre** (`config/settings_data.json:3`). `snippets/ds-batch-state.liquid:16` cierra la interfaz ante configuración incompleta, interruptor apagado o vencimiento. No se detectó defecto adicional en esa lógica. Theme Check de Shopify no se ejecutó: la CLI no estaba disponible en el PATH del entorno de revisión.

### Lectura pública y limitaciones SEO

Lecturas 200: inicio; productos tomate, jugo verde, guayaba, piña coco y capuchino; Contacto; privacidad; pasteles; seguimiento; Cajas para regalar; Jugos y bebidas; Noticias. Cada una presentó un H1 y canónica propia; se analizaron metadatos, imágenes, enlaces y JSON-LD del HTML recibido.

Sin HTML utilizable por `429 local_rate_limited`: producto Brownie Box y colecciones Más vendidos, Galletas, Brownies, Postres y Conservas saladas. Se respetó el carácter de solo lectura y no se intentó saltar protecciones. Seis URLs **quedan pendientes de una lectura fiable**: no se inventan sus metadatos ni contenido. `robots.txt` y sitemaps sí fueron accesibles. La búsqueda `site:` no aportó una muestra útil; **no permite concluir que Google tenga cero páginas indexadas**.

La API de PageSpeed respondió `429 RESOURCE_EXHAUSTED` por cuota del servicio: **no hay puntuación Lighthouse/PSI válida ni datos CrUX en este informe**. El navegador integrado de la herramienta tampoco estuvo disponible; la inspección visual limitada se realizó mediante navegador de pruebas del revisor. No se midió INP real, no se consultaron Search Console/Analytics/GBP privados ni volúmenes de palabras clave. No se ejecutó Rich Results Test contra todas las URLs.

No se comprobó en el admin inventario efectivo, sobreventa, tarifas, zonas de envío, permisos desplegados, backups ni recepción real de Gmail. No se hicieron compras, cargos, envíos de formularios, cambios de stock ni pruebas de ataque contra producción. No se confirmó bypass de autenticación, duplicación de cargos ni fuga de solicitudes privadas.

### Hallazgos descartados o solo locales

- La pérdida de idempotencia de creación al recargar aparece en el checkout local antiguo, pero **está corregida en `f66a6bb`**: `assets/ds-celebracion-solicitud.js:104` recupera intención y `:130` persiste antes del POST. No proponer corregirla otra vez en producción.
- Se descartó un supuesto fallo de foco por `prefers-reduced-motion`: la transición exterior sí instala el confinamiento; F6 es un problema distinto de foco inicial.
- Los alt vacíos decorativos, la ausencia de hreflang con una sola lengua y el stock cero como cierre real no se clasificaron como errores.
- Los pesos PNG en Git no se usaron como si fueran descarga real del usuario.

## 7. Orden de ejecución sugerido tras aprobación

Primero resolver fallos operativos de datos/pagos/avisos con pruebas; después claridad comercial y páginas prioritarias; finalmente ampliar contenido, señales locales e idioma según demanda. Preparar cada cambio contra las fuentes publicadas indicadas y revisar desktop/mobile. Esta entrega deja las propuestas listas para decidir; **ninguna corrección se aplicó durante la auditoría**.
