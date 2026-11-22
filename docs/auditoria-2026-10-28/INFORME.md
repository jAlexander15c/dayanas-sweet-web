# Auditoría de Dayana’s Sweet

Revisión del 28 de octubre de 2026 de [dayanassweet.com](https://dayanassweet.com/) y del tema local. La tienda tiene una identidad visual coherente y una navegación que funciona en los tamaños probados, pero necesita resolver el cierre real de ventas, el catálogo de prueba y la información comercial antes de reabrir pedidos.

Se registran **13 hallazgos y riesgos**: 5 con prioridad P1, 7 con P2 y 1 con P3. P1 significa resolver antes de reabrir; P2, corregir en la siguiente iteración; P3, ajuste editorial. Dos hallazgos técnicos proceden de revisar el JavaScript publicado y no de provocar errores en una compra real.

## Alcance y evidencia

Se recorrieron portada, catálogo, ficha del tomate, carrito existente, navegación móvil, categoría vacía, búsqueda predictiva y completa, panel de filtros, boletín, preguntas frecuentes, contacto, privacidad y página 404. Se inspeccionaron 19 URL por HTTP: 15 respondieron 200; tres rutas habituales de políticas y la URL de prueba inexistente respondieron 404. El inventario incluye los cuatro productos y las seis colecciones del sitemap, además del catálogo general.

La revisión visual utilizó Chrome, escritorio a 1440 × 1000, móvil a 390 × 844 y tablet a 768 × 1024. La ficha también se comprobó a 320 píxeles: no presentó desbordamiento horizontal. Las capturas se guardaron e inspeccionaron en esta carpeta. Algunas incluyen elementos de extensiones del navegador; no se atribuyen al tema.

Las observaciones de la tienda publicada se distinguen del código local, que ya tenía cambios pendientes al iniciar. No se modificaron archivos del tema ni productos, stock, envíos o ajustes del administrador. El carrito tenía 16 artículos antes de esta revisión; se observó sin cambiar sus cantidades ni contenido. No se enviaron mensajes, suscripciones ni pedidos.

## Hallazgos que deben resolverse antes de reabrir

### H1 El cierre visual no coincide con la disponibilidad de Shopify

**P1 · Estado contradictorio confirmado; bloqueo del checkout sin verificar.** La interfaz anuncia tanda cerrada y desactiva el pago del carrito. Sin embargo, los cuatro productos devuelven `available: true` en sus respuestas públicas `.js`; el marcado Product del tomate declara `InStock`. Los productos de prueba también siguen disponibles para Shopify.

Esto indica que el cierre de la interfaz no basta para demostrar el cierre real de ventas. No se intentó completar ni eludir el checkout. Hay que verificar en el administrador el stock por variante y ubicación, y que no se permita seguir vendiendo sin existencias. Según las instrucciones del proyecto, el cierre real exige stock cero. Después debe comprobarse con un carrito anterior al cierre y con una sesión que permanezca abierta durante el cambio de tanda.

Evidencia: pasos 2, 3 y 4; `public-evidence.json`, apartados `products` y `structured`; `snippets/ds-batch-state.liquid` y `config/settings_schema.json`.

### H2 Tres de los cuatro productos públicos son de prueba

**P1 · Confirmado.** El 75 % del catálogo lleva “PRUEBA”, avisa que no está disponible para la venta y carece de imágenes. Aparece tanto en el catálogo como en “Los más pedidos” y en recomendaciones. Sus URL figuran en el sitemap, por lo que están expuestas a rastreo; esto no demuestra que Google ya las haya indexado.

Retirar estos productos de los canales públicos y de las colecciones comerciales, o sustituirlos por fichas finales con fotografía, presentación y precio confirmados. La condición de producto de prueba debe quedar fuera de la tienda pública. Este cambio requiere una tarea explícita de administración de Shopify.

Evidencia: paso 2 y `public-evidence.json`; los tres productos tienen `images: 0`.

### H3 La ficha real no explica cantidad ni conservación

**P1 · Confirmado.** El tomate cuesta $10 y tiene una descripción de ingredientes y usos, pero la ficha no identifica cantidad neta, instrucciones de conservación, condiciones tras abrir el frasco ni vida útil. Tampoco presenta una declaración específica de alérgenos o contacto cruzado. La advertencia general de equipos compartidos se encuentra en Contacto, lejos de la decisión de compra.

Añadir la información verificada del producto junto al precio y la descripción. El peso público de la variante puede ser un dato logístico y no debe convertirse automáticamente en cantidad neta. El snippet local `ds-product-batch` solo aporta conservación genérica a productos identificados como galletas; los demás dependen de su propia descripción.

Evidencia: paso 3; `snippets/ds-product-batch.liquid` y descripción pública del tomate. No se evalúa aquí la seguridad de la receta ni el cumplimiento de etiquetado alimentario.

### H4 Faltan políticas comerciales accesibles

**P1 · Confirmado.** Las rutas `/policies/shipping-policy`, `/policies/refund-policy` y `/policies/terms-of-service` responden 404. El pie solo enlaza la política de privacidad. Las preguntas frecuentes explican que no hay retiro y prometen envío gratis desde $100, pero no detallan cobertura, plazos orientativos ni cómo se resuelven daños, retrasos o incidencias con alimentos.

Preparar y publicar las políticas reales de envío y resolución de incidencias, y las condiciones comerciales aplicables; enlazarlas desde el pie y donde se decide la compra. Verificar además que la configuración del checkout cumpla la promesa de envío gratis. Las rutas ausentes no son enlaces rotos del menú actual: son información comercial que no se encontró publicada en esas ubicaciones.

Evidencia: pasos 10 y 11; estados HTTP de `public-evidence.json`. Es una observación de información y confianza del comprador, no un dictamen legal.

### H5 El JavaScript publicado no garantiza un aviso visible al fallar la red

**P1 · Riesgo sustentado en código publicado.** En el `catch` de `product-form.js` se registra el error y se emite un evento de plataforma, pero no se llama al aviso visible del formulario ni se publica el error que consume el feedback de las tarjetas. El indicador de carga termina y el botón vuelve a habilitarse. Si la respuesta se pierde después de que el servidor aceptó el artículo, un reintento puede resultar confuso.

El código local contiene un tratamiento distinto y pasó la prueba de errores de red en tarjeta y ficha. Antes de publicar esa versión hay que validarla en un tema sin publicar, con aviso que invite a comprobar el carrito antes de reintentar. No se simuló una interrupción de red en producción con la tanda cerrada.

Evidencia: `public-assets/product-form.js`, manejador `catch`; `assets/product-form.js`; prueba local “Network errors show feedback on both card and product page”. La diferencia descrita es semántica; no se infiere solo de que Shopify minifique los archivos.

## Hallazgos de la siguiente iteración

### H6 Los avisos de cierre no llevan a la suscripción

**P2 · Confirmado.** La ficha, el catálogo y el carrito piden suscribirse mediante texto sin enlace ni formulario cercano. El visitante debe encontrar por su cuenta el boletín de la portada. Durante el cierre, esa es la acción útil principal y queda separada del aviso.

Añadir un enlace claro al formulario o una suscripción junto al estado cerrado. Mostrar la próxima apertura únicamente cuando exista una fecha confirmada. Evidencia: pasos 2, 3, 4 y 8.

### H7 El texto del boletín tiene contraste insuficiente

**P2 · Confirmado mediante estilos calculados.** El párrafo de 17 px y la etiqueta de correo de 14 px usan blanco al 75 % sobre `rgb(208,58,103)`. Al componer la transparencia, el contraste es aproximadamente **3,26:1**, inferior a 4,5:1 para texto normal. El título grande no tiene el mismo requisito que esos textos. [Referencia de W3C sobre contraste de texto](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Usar una combinación que supere 4,5:1 para párrafo y etiqueta. Como referencia de esta medición, blanco completamente opaco sobre ese fondo da aproximadamente 4,68:1. Verificar de nuevo estados y tamaños tras el ajuste. Evidencia: paso 8 y `manual-evidence.json`.

### H8 La lupa de búsqueda desaparece sobre el fondo

**P2 · Confirmado.** En los resultados completos, el botón de enviar búsqueda tiene fondo blanco, color blanco y el SVG hereda ese color: contraste **1:1**. El control mantiene su nombre accesible y Enter ejecuta la búsqueda, pero su icono no se ve. La información visual necesaria para identificar controles debe alcanzar 3:1 según [W3C sobre contraste no textual](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

Corregir la combinación efectiva de fondo y color, comprobando la cascada de estilos en escritorio y móvil. Evidencia: paso 6, captura `10-resultados-mobile.jpg` y `manual-evidence.json`. La regla local de `ds-pages.css` pretende un fondo rosa; hay que verificar el resultado renderizado, no solo esa declaración.

### H9 Postres vacío atribuye el problema a filtros inexistentes

**P2 · Confirmado.** La categoría principal Postres tiene cero productos y propone quitar filtros, aunque no hay filtros activos. El enlace de eliminación devuelve a la misma colección vacía.

Distinguir colección sin catálogo de una búsqueda filtrada sin resultados. Ofrecer volver al menú o recibir aviso de apertura; revisar si conviene mantener esa categoría en la navegación mientras esté vacía. Evidencia: paso 5 y `sections/main-collection-product-grid.liquid`.

### H10 Faltan descripciones SEO e imagen para compartir

**P2 · Confirmado.** Nueve páginas comerciales inspeccionadas carecen de `meta description`: portada, catálogo general, las seis colecciones y Contacto. La portada tiene como título solo la marca, `og:description` genérica y ninguna `og:image`. La ficha real sí aporta descripción e imagen social.

Definir descripciones específicas desde las fuentes de contenido de Shopify y una imagen social de marca. Revisar el título de portada para explicar qué se vende y su ubicación cuando corresponda. No se puede inferir una caída de posicionamiento o tráfico sin datos de buscadores y analítica. Evidencia: `public-evidence.json`, campos `description`, `title` y `ogImage`.

### H11 La invitación a Instagram no tiene enlace

**P2 · Confirmado.** “Síguenos @dayanassweet” aparece como texto; no se encontró ningún enlace a Instagram, Facebook o TikTok en la portada. Quien quiera comprobar el perfil debe buscarlo fuera de la web.

Configurar el perfil verificado y enlazarlo desde el bloque. El tema local admite `profile_link`, pero tener la opción en el esquema no equivale a tenerla configurada. Evidencia: paso 8, `sections/ds-social.liquid` y `manual-evidence.json`.

### H12 El feedback de tarjetas publicadas depende del último formulario

**P2 · Riesgo sustentado en código publicado.** El `ds-motion.js` servido utiliza una variable global `lastCardForm`. Al enviar una segunda tarjeta antes de recibir la primera respuesta, el feedback puede perderse; si ambas tarjetas corresponden a la misma variante, puede asignarse a la tarjeta equivocada.

El código local relaciona eventos con formulario y solicitud, y pasó las pruebas de concurrencia y respuesta antigua. Validar esa versión con la misma variante presente en dos secciones antes de publicarla. No se provocaron altas simultáneas en el carrito de producción.

Evidencia: `public-assets/ds-motion.js`, funciones `cardFor` e `initCartFeedback`; `assets/ds-motion.js`; pruebas locales de concurrencia y reintento.

## Ajuste editorial

### H13 Privacidad conserva una referencia de teléfono vacía

**P3 · Confirmado.** El apartado Contacto contiene “llámenos al” sin número. Sí aporta otros medios de contacto, por lo que no deja al visitante sin alternativa.

Completar el teléfono si es un canal real o retirar esa frase. Evidencia: paso 11 y captura `18-privacidad-desktop.jpg`.

## Recorrido visual y estado de cada paso

### Paso 1 Portada en escritorio móvil y tablet

**Estado: funciona, con problemas de conversión y SEO.** Jerarquía visual clara, marca consistente y navegación adaptada. El menú se transforma en panel móvil. El CTA principal medido alcanza aproximadamente 4,68:1. El enlace para saltar al contenido muestra foco visible. La revisión a 320 px se limita a la ficha de producto.

![Portada de escritorio](01-inicio-desktop.jpg)

![Portada móvil](06-inicio-mobile.jpg)

![Portada de tablet](14-inicio-tablet.jpg)

### Paso 2 Catálogo general

**Estado: requiere correcciones antes de vender.** Cuatro productos, tres de prueba sin fotografía; avisos de cierre coherentes visualmente. H1, H2 y H6.

![Catálogo de escritorio con productos de prueba](02-catalogo-desktop.jpg)

### Paso 3 Ficha del tomate

**Estado: información insuficiente.** Precio y descripción legibles, fotografía real y aviso de cierre. Faltan los datos de H3 y una acción hacia la suscripción de H6.

![Ficha del tomate en escritorio](03-producto-desktop.jpg)

![Ficha del tomate en móvil](12-producto-mobile.jpg)

### Paso 4 Carrito existente

**Estado: cierre visual correcto, control real pendiente de verificar.** Pago deshabilitado y aviso visible en ambos tamaños. Escape cierra el panel y devuelve el foco al activador. No se modificaron las 16 unidades preexistentes. No se comprobó un carrito vacío ni se finalizó una compra. H1 y H6.

![Carrito en escritorio](04-carrito-desktop.jpg)

![Carrito en móvil](13-carrito-mobile.jpg)

### Paso 5 Menú móvil y categoría Postres

**Estado: navegación funcional, destino vacío mal explicado.** El menú abre y permite entrar en la categoría. El mensaje del destino necesita el ajuste de H9.

![Menú móvil abierto](07-menu-mobile.jpg)

![Colección Postres vacía](08-postres-mobile.jpg)

### Paso 6 Búsqueda predictiva y resultados

**Estado: funcional con defecto visual.** “tomate” produce una sugerencia y una ficha en resultados; Enter navega correctamente. El resultado predictivo tiene nombre accesible repetido por imagen y texto, una mejora menor posible. La lupa invisible de H8 sí requiere corrección.

![Resultado predictivo móvil](09-busqueda-mobile.jpg)

![Resultados completos en móvil](10-resultados-mobile.jpg)

### Paso 7 Panel móvil de filtros y ordenación

**Estado: funcional en la operación probada.** Abre, permite elegir precio descendente y Aplicar cierra el panel; la URL conserva `sort_by=price-descending`. Con un solo resultado no se evalúa visualmente el orden relativo de varios productos. No se afirma que todas las combinaciones de filtros estén probadas.

![Panel móvil de filtros](11-filtros-mobile.jpg)

### Paso 8 Boletín y redes

**Estado: necesita mejorar contraste y acceso al perfil.** Etiqueta y campo de correo presentes. Se comprobó foco de teclado visible en el campo y en su contenedor; no se envió una dirección ni se verificó la entrega de correo. H6, H7 y H11.

![Boletín con foco visible y bloque de redes](15-boletin-desktop.jpg)

### Paso 9 Preguntas frecuentes

**Estado: funcional, con información comercial parcial.** El acordeón abre y aclara envío sin retiro, umbral de gratuidad y diferencia entre despacho y llegada. Falta la información más completa descrita en H4.

![Preguntas frecuentes con explicación de envío](16-preguntas-desktop.jpg)

### Paso 10 Contacto

**Estado: validación inicial correcta.** Nombre, correo y mensaje tienen etiquetas. El envío vacío se detiene y enfoca el correo obligatorio con aviso del navegador. No se mandó un mensaje ni se verificó la recepción o el estado de éxito del servidor.

![Validación del formulario de contacto](05-contacto-desktop.jpg)

### Paso 11 Privacidad y acceso a políticas

**Estado: privacidad accesible, información comercial incompleta.** Privacidad responde 200 y enlaza las opciones de tratamiento de datos. El enlace fue observado; no se ejerció una opción de privacidad. H4 y H13.

![Final de privacidad con teléfono incompleto](18-privacidad-desktop.jpg)

### Paso 12 Recuperación ante una página inexistente

**Estado: correcto.** Respuesta HTTP 404 real, explicación y enlaces a catálogo e inicio. Se siguió el enlace al menú con éxito.

![Página 404 de escritorio](17-error-404-desktop.jpg)

## Validación técnica y rendimiento

| Comprobación | Resultado real |
| --- | --- |
| `node tests/check-theme.mjs` | Pasó: 37 JavaScript, 67 JSON y 52 esquemas. Valida sintaxis; no equivale a Theme Check completo. |
| `node tests/browser-regressions.mjs` | Pasó: 12 de 12, con respuestas de carrito aisladas y código local. |
| Inventario HTTP de 19 URL | 15 respuestas 200; tres rutas de políticas ausentes y la página de prueba devolvieron 404. |
| `robots.txt` y `sitemap.xml` | Responden 200; sitemap expone los cuatro productos públicos. |
| Redirección HTTP | HTTP redirige a HTTPS mediante 301. |
| Metadatos | Canonical presente y un H1 en cada página pública con respuesta 200 inspeccionada; nueve páginas comerciales sin descripción. |
| Marcado estructurado | Organization y Product presentes; disponibilidad contradictoria con el cierre visual. |
| Respuesta inicial de portada | Una muestra con curl: TTFB 0,470 s; descarga HTML total 0,526 s y 145.083 bytes. No incluye renderizado ni recursos. |
| PageSpeed Insights móvil | No obtuvo resultados: API respondió 429 por cuota agotada. Respuesta guardada. |
| Shopify Theme Check | No se ejecutó: no se encontró la CLI Shopify en PATH. |

La capa propia utiliza JS vanilla y ofrece variantes WebP de imágenes, carga diferida y prioridad de la primera imagen del hero. Es una base razonable para rendimiento, pero esta auditoría **no asigna puntuación Lighthouse ni resultados LCP, INP o CLS**. El tamaño de HTML o una muestra de TTFB no los sustituyen. Se recomienda medir esas métricas en móvil con una herramienta disponible y tráfico real antes de atribuir lentitud a un componente.

La revisión del código encontró tratamiento de `prefers-reduced-motion` y controles de pausa. No se pudo verificar la emulación de esa preferencia mediante DevTools en esta sesión; queda comprobación de código, no certificación visual de todos los efectos. Tampoco se certifica WCAG completo: faltan lector de pantalla, zoom al 200/400 %, todas las combinaciones de teclado y dispositivos físicos.

No se hizo una prueba de penetración, revisión de infraestructura o permisos del administrador. No se verificaron pagos reales, tarifas por código postal, existencias exactas ni recepción de correos. La disponibilidad pública y el cierre visual de H1 son señales suficientes para pedir la comprobación operativa, pero no prueban que se haya podido finalizar una venta cerrada.

## Orden de resolución

1. Verificar y hacer efectivo el cierre de stock; retirar el catálogo de prueba de la tienda pública.
2. Completar ficha del producto real y políticas de envío e incidencias; comprobar la promesa de gratuidad en el checkout.
3. Probar en un tema sin publicar las correcciones locales de carrito, errores y concurrencia. Publicar solo con autorización explícita.
4. Corregir contraste, lupa, acceso a suscripción, categoría vacía y enlaces sociales.
5. Completar SEO y el teléfono de privacidad; medir rendimiento y ejecutar una compra de prueba controlada cuando esté autorizada.

## Archivos de respaldo

- `public-evidence.json`: estados, metadatos, textos de HTML, productos y referencias a assets públicos. El texto extraído del HTML puede incluir elementos ocultos; las observaciones visuales se basan en las capturas y el DOM del navegador.
- `manual-evidence.json`: estilos medidos, contraste, pruebas manuales y límites.
- `check-theme.txt` y `browser-regressions.txt`: salidas reales de las comprobaciones locales.
- `pagespeed-response.json`: respuesta de cuota de PageSpeed Insights.
- `public-assets/`: copia de cuatro JavaScript publicados para sustentar H5 y H12.
- `collect-public.mjs`: recolector reproducible que solo realiza lecturas públicas.

El informe y sus evidencias son los únicos archivos añadidos durante esta auditoría. No se hizo commit, push, despliegue ni publicación.
