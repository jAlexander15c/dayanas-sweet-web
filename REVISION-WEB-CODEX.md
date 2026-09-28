# Revisión de código del tema Dayana’s Sweet

## 1. Resumen ejecutivo

1. **Crítica:** cerrar la tanda en los ajustes DS no impide comprar desde la ficha ni pagar un carrito existente.
2. **Alta:** el formulario DS de newsletter devuelve el correo del visitante sin escape dentro de un atributo HTML.
3. **Alta:** el carrusel y los anuncios rotan automáticamente sin un control persistente para pausarlos.
4. **Alta:** las imágenes PNG de respaldo pesan 1,96–2,52 MiB y no tienen versiones adaptativas.
5. **Alta:** los cupos y el precio fijo no siguen la variante seleccionada; además, los enlaces sociales de la portada apuntan a «#» con la configuración versionada.

## 2. Tabla resumen de hallazgos

| Severidad | Categoría | Archivo:línea | Descripción breve |
|---|---|---|---|
| Crítica | Fallas | snippets/ds-product-card.liquid:65; snippets/buy-buttons.liquid:73 | El cierre DS no impide compra desde producto ni checkout. |
| Alta | Fallas | snippets/ds-product-batch.liquid:10; snippets/ds-sticky-buy.liquid:11 | Stock y precio DS se quedan en la variante inicial. |
| Media | Fallas | sections/ds-social.liquid:24; templates/index.json:206 | Enlaces sociales vacíos resuelven a «#». |
| Baja | Fallas | config/settings_data.json:190; sections/main-password-header.liquid:11 | Ajuste de contraseña guardado pero ausente del schema. |
| Media | Fallas | assets/ds-motion.js:13,64,97,168 | Timers, listener y observadores sin limpieza al recargar secciones en el editor. |
| Alta | Rendimiento | sections/ds-hero.liquid:61; assets/ds-cookie-box-concept.png | PNG pesados servidos sin srcset en hero y respaldos. |
| Media | Rendimiento | layout/theme.liquid:285 | CSS de interiores y archivo legado bloquean todas las páginas. |
| Alta | Accesibilidad | assets/ds-motion.js:13; sections/ds-hero.liquid:35 | Movimiento automático sin botón de pausa. |
| Alta | Accesibilidad | sections/ds-social.liquid:28-32 | Fotos enlazadas sin nombre accesible. |
| Media | Accesibilidad | assets/ds-conversion.css:23; assets/ds-premium.css:5 | Contraste insuficiente del texto rojo de cupos. |
| Media | Accesibilidad | assets/ds-premium.css:46 | Anuncios invisibles solo por opacidad siguen accesibles. |
| Baja | Accesibilidad | snippets/ds-product-card.liquid:56 | Encabezados h3 saltan h2 en colección y búsqueda. |
| Baja | SEO | sections/header.liquid:466; config/settings_data.json:171 | Organization omite logo DS y recibe enlaces sameAs vacíos. |
| Alta | Seguridad | sections/ds-social.liquid:11 | form.email sin escape en value. |
| Media | Seguridad | snippets/ds-batch-text.liquid:14-17 | Se insertan valores de ajustes después de escapar el texto. |
| Baja | Seguridad | sections/main-password-footer.liquid:97-103 | Enlace externo sin noopener explícito. |
| Media | Copy/negocio | sections/header-group.json:32; sections/ds-announcement.liquid:2 | Anuncio de pedidos no cambia al cerrar la tanda. |
| Media | Copy/negocio | templates/index.json:137,240,247 | Promesas generales sobre fichas, ingredientes y conservación sin catálogo verificable. |
| Media | Copy/negocio | sections/footer-group.json:33; snippets/ds-product-card.liquid:50 | Interfaz DS fija en español aunque existe selector de idioma. |

## 3. Hallazgos por categoría

### Fallas

#### F1. El cierre de tanda se puede eludir desde la ficha y el carrito — Crítica

**Archivo:línea y evidencia verificada.** snippets/ds-product-card.liquid:65-66 usa «{% if sold_out or settings.ds_batch_open == false %}» para mostrar «Cerrado». snippets/ds-sticky-buy.liquid:7 también condiciona su barra a settings.ds_batch_open. En cambio, templates/product.json:22-26 mantiene buy_buttons con «"show_dynamic_checkout": true»; snippets/buy-buttons.liquid:78-82 deshabilita el botón solo por disponibilidad o stock y líneas 96-98 genera payment_button. sections/main-cart-footer.liquid:109-117 deshabilita checkout solo si «cart == empty». La búsqueda de ds_batch_open en secciones, snippets y assets produjo únicamente las cuatro referencias DS de tarjeta, barra fija, aviso de ficha y encabezado de colección.

**Por qué importa.** El ajuste de tema es presentación, no una restricción de venta. Se pueden aceptar pedidos cuando el negocio indica que terminó la tanda. Shopify define product.available por las variantes, sin considerar este ajuste ([objeto Product](https://shopify.dev/docs/api/liquid/objects/product)).

**Solución propuesta.** Condicionar el render de buy-buttons y los accesos a checkout al estado DS para coherencia visual. Para impedir realmente pedidos, controlar la disponibilidad en Shopify (por ejemplo, publicación en el canal o una validación de checkout disponible en el plan); deshabilitar HTML/CSS por sí solo no protege rutas directas. Probar ficha, compra dinámica, carrito lleno y compra como invitado con menú cerrado.

#### F2. Cupos y precio fijo no siguen la variante seleccionada — Alta

**Archivo:línea y evidencia verificada.** snippets/ds-product-batch.liquid:10-13 fija «assign variant = product.selected_or_first_available_variant» durante el render y líneas 30-31 imprime variant.inventory_quantity. snippets/ds-sticky-buy.liquid:11 imprime el precio de esa misma variante. assets/ds-motion.js:89-102 solo encuentra el botón principal, hace submit.click() y observa su posición: no actualiza stock ni precio. templates/product.json:12-16 activa un selector de variantes.

**Por qué importa.** Al elegir otra variante, el texto DS puede describir el stock y el precio de la inicial. El inventario es propiedad de cada variante ([objeto Variant](https://shopify.dev/docs/api/liquid/objects/variant)). **Límite:** no se pudo probar un producto real.

**Solución propuesta.** Actualizar los nodos DS cuando Dawn actualice variante, precio e inventario; ocultar «Quedan N» si la variante activa no tiene inventario controlado. Probar dos variantes con precios y stocks distintos y una agotada.

#### F3. Enlaces sociales sin destino en la portada versionada — Media

**Archivo:línea y evidencia verificada.** sections/ds-social.liquid:24-28 calcula «link = block.settings.link | default: section.settings.profile_link» y después «href="{{ link | default: '#' }}"». Los cuatro bloques de templates/index.json:173-209 no tienen link y la sección solo guarda title, text y color_scheme; no guarda profile_link.

**Por qué importa.** «Síguenos» y tres fotos abren una pestaña al fragmento de la misma página. Un override del editor de Shopify podría corregirlo en producción, pero no está en el repositorio.

**Solución propuesta.** Configurar la URL real del perfil o no renderizar el enlace cuando falte; dejar la foto sin enlace mientras no haya destino.

#### F4. Ajuste huérfano de cabecera de contraseña — Baja

**Archivo:línea y evidencia verificada.** config/settings_data.json:190-194 guarda «"type": "main-password-header"» y «"color_scheme": "scheme-1"»; sections/main-password-header.liquid:8-12 declara «"settings": []».

**Por qué importa.** El valor no tiene control ni consumo y confunde al editar el tema. Shopify separa schema y datos de ajustes ([arquitectura del tema](https://shopify.dev/docs/storefronts/themes/architecture)). No hay evidencia de fallo visible.

**Solución propuesta.** Eliminar el dato huérfano cuando se edite el tema o declarar y usar el ajuste.

#### F5. Interacciones DS sin limpieza al descargar secciones — Media

**Archivo:línea y evidencia verificada.** assets/ds-motion.js:13 crea un setInterval para anuncios; líneas 47-50 crean timeouts para el hero; línea 64 añade un listener a document por hero; líneas 97-102 crean IntersectionObserver para la barra fija. Línea 168 escucha shopify:section:load, pero el archivo no escucha shopify:section:unload ni desconecta esos recursos.

**Por qué importa.** En el editor de Shopify, una sección se sustituye sin recargar la página. Tras editarla varias veces, los timers y listeners anteriores siguen referenciando nodos retirados; el efecto visible y la memoria consumida pueden crecer. Shopify pide limpiar listeners y variables en [shopify:section:unload](https://shopify.dev/docs/storefronts/themes/best-practices/editor/integrate-sections-and-blocks). **Hipótesis razonable:** no se midió una fuga en el editor; la ausencia de limpieza está verificada.

**Solución propuesta.** Registrar por sección los intervalos, timeouts, observadores y handlers; en shopify:section:unload ejecutar clearInterval, clearTimeout, disconnect y removeEventListener. Probar varias recargas seguidas del hero, anuncio y ficha en el editor.

### Rendimiento

#### R1. Respaldos PNG grandes sin imagen adaptativa — Alta

**Archivo:línea y evidencia verificada.** sections/ds-hero.liquid:59 usa image_url e image_tag con widths, sizes, eager y fetchpriority para imágenes configuradas; línea 61 usa «src="{{ fallbacks[fb_index] | asset_url }}"» sin srcset cuando falta la imagen. templates/index.json:6-34 no asigna imágenes a las tres diapositivas. Lectura de archivos PNG: assets/ds-brownie.png = 2.054.254 bytes, 1254×1254; assets/ds-cookie-box-concept.png = 2.639.046 bytes, 1254×1254; assets/ds-editorial-cookies.png = 2.263.155 bytes, 1536×1024. sections/ds-categories.liquid:24 y sections/ds-social.liquid:32 también sirven respaldos con asset_url sin srcset.

**Por qué importa.** El primer hero puede ser LCP y el navegador descarga el PNG completo en móvil. Shopify recomienda image_tag con srcset/sizes ([imágenes adaptativas](https://shopify.dev/docs/storefronts/themes/best-practices/performance/use-responsive-images)); web.dev recomienda prioridad alta solo para la primera imagen visible ([Fetch Priority](https://web.dev/articles/fetch-priority)). **No se midió LCP real.**

**Solución propuesta.** Exportar respaldos WebP/AVIF optimizados en varios tamaños o convertirlos en imágenes configurables de Shopify para usar image_url | image_tag. Mantener dimensiones reservadas y prioridad alta solo en el primer slide. Medir bytes y LCP después.

#### R2. CSS de interiores y legado en todas las rutas — Media

**Archivo:línea y evidencia verificada.** layout/theme.liquid:285-289 inserta incondicionalmente base.css, dayanas-theme.css, ds-premium.css, ds-conversion.css y ds-pages.css. assets/dayanas-theme.css:1 solo dice «Legacy overrides replaced by ds-premium.css». Los tres CSS DS ocupan 17.371, 11.027 y 22.127 bytes en disco, respectivamente.

**Por qué importa.** Las hojas en head bloquean el render ([web.dev, Render-blocking CSS](https://web.dev/articles/critical-rendering-path/render-blocking-css)); ds-pages.css contiene estilos de búsqueda, blog, contraseña y 404 que no necesita la portada. El impacto real requiere waterfall.

**Solución propuesta.** Retirar la referencia legada y cargar estilos de interiores por plantilla si la medición confirma beneficio; conservar un CSS DS compartido para elementos comunes.

### Accesibilidad

#### A1. Rotación automática sin pausa persistente — Alta

**Archivo:línea y evidencia verificada.** assets/ds-motion.js:13-18 rota anuncios con setInterval y líneas 47-50 programa el siguiente slide con setTimeout. Líneas 60-64 solo pausan el hero en hover, foco o pestaña oculta. sections/ds-hero.liquid:35-41 ofrece puntos de navegación, no pausa. sections/ds-announcement.liquid:1-9 tampoco incluye pausa. assets/ds-motion.js:3,10,49 sí considera prefers-reduced-motion al inicializar.

**Por qué importa.** Contenido que se actualiza automáticamente durante más de cinco segundos junto a otros contenidos requiere pausa, detención u ocultación según [WCAG 2.2, 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide). Hover/foco solo suspenden temporalmente; los anuncios no se suspenden así.

**Solución propuesta.** Agregar controles visibles «Pausar/Reanudar» para ambos componentes, con estado persistente y aria-pressed; actualizar aria-current de los puntos del hero.

#### A2. Enlaces de fotos sin nombre accesible — Alta

**Archivo:línea y evidencia verificada.** sections/ds-social.liquid:28-34 crea un enlace cuya única descendencia en la rama de respaldo es «<img ... alt="">». Los tres bloques de fotos en templates/index.json:174-191 solo establecen fallback, así que usan esa rama.

**Por qué importa.** El enlace queda sin texto ni nombre accesible. W3C identifica este patrón como fallo F89 de [WCAG 2.4.4/4.1.2](https://www.w3.org/WAI/WCAG21/Techniques/failures/F89).

**Solución propuesta.** Dar al enlace un aria-label de destino concreto, por ejemplo «Ver Dayana’s Sweet en Instagram»; conservar alt vacío solo si la imagen es decorativa.

#### A3. Contraste insuficiente del rojo de cupos — Media

**Archivo:línea y evidencia verificada.** assets/ds-premium.css:5-6 define --ds-red:#E14B26, --ds-peach:#F7DDCE y --ds-paper:#FFF4F8. assets/ds-conversion.css:5,23 pinta el texto «Quedan N» a 13 px en rojo sobre la tarjeta melocotón; líneas 93-94 usa el mismo rojo en el aviso de stock de ficha. Cálculo sRGB: rojo/melocotón = **3,09:1** y rojo/papel = **3,73:1**.

**Por qué importa.** El texto normal requiere 4,5:1 según [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).

**Solución propuesta.** Usar un rojo de texto más oscuro, por ejemplo #A83319: **5,14:1** sobre melocotón y **6,20:1** sobre papel.

#### A4. Anuncios inactivos ocultos solo visualmente — Media

**Archivo:línea y evidencia verificada.** sections/ds-announcement.liquid:3-7 renderiza todos los mensajes y permite enlace; assets/ds-premium.css:46-47 oculta los inactivos con «opacity:0», sin hidden, inert ni aria-hidden. assets/ds-motion.js:15-17 solo alterna clases. En la configuración versionada los enlaces están vacíos (sections/header-group.json:33,40,47).

**Por qué importa.** La opacidad no elimina mensajes del árbol accesible. **Hipótesis razonable condicionada:** si se configuran enlaces, los invisibles pueden entrar en la tabulación. La duplicación de mensajes accesibles sí se desprende del código actual.

**Solución propuesta.** Sincronizar hidden/inert o aria-hidden y tabindex con is-on; probar lectura lineal y Tab con enlaces configurados.

#### A5. Salto de jerarquía de encabezados en grillas — Baja

**Archivo:línea y evidencia verificada.** snippets/ds-product-card.liquid:56 fija «<h3 class="ds-card__title">»; sections/ds-collection-hero.liquid:17 y sections/main-search.liquid:70 proporcionan el h1 de esas páginas. La grilla DS no tiene un h2 propio antes de los productos.

**Por qué importa.** El salto dificulta recorrer la estructura por encabezados; W3C recomienda niveles que expresen jerarquía ([técnica H42 para WCAG 1.3.1](https://www.w3.org/WAI/WCAG22/Techniques/html/H42)). No se afirma que haya dos h1.

**Solución propuesta.** Pasar nivel de heading al snippet según contexto o añadir un h2 «Productos/Resultados» antes de la grilla.

### SEO

#### S1. Organization no refleja el logo DS ni enlaces reales — Baja

**Archivo:línea y evidencia verificada.** sections/header.liquid:461-480 emite Organization; «logo» solo se genera bajo «{% if settings.logo %}» y sameAs incluye siempre nueve settings.social_*_link. config/settings_data.json:171-179 guarda los nueve enlaces como cadenas vacías; la configuración current no contiene logo (se inspeccionaron sus claves; línea 3 solo contiene logo_width). sections/header.liquid:208 sí muestra el asset ds-logo-horizontal.png.

**Por qué importa.** El logo visible no está representado en JSON-LD con los ajustes versionados y sameAs lleva valores vacíos. Google recomienda logo y URLs reales para [Organization](https://developers.google.com/search/docs/appearance/structured-data/organization); no se afirma pérdida de ranking.

**Solución propuesta.** Configurar un logo o añadir fallback DS al JSON-LD, omitir sameAs vacíos y validar el HTML real. No añadir LocalBusiness ni dirección sin datos confirmados.

### Seguridad

#### G1. Correo sin escape dentro de value — Alta

**Archivo:línea y evidencia verificada.** sections/ds-social.liquid:11 contiene «value="{{ form.email }}». Las implementaciones hermanas sí escapan: sections/ds-password.liquid:25 usa «form.email | escape» y sections/ds-contact.liquid:31 también.

**Por qué importa.** El dato puede venir de un visitante tras un error del formulario. Shopify advierte que Liquid no escapa toda salida automáticamente ([seguridad Shopify](https://shopify.dev/docs/apps/build/security/following-security-best-practices)); OWASP exige codificación en atributos HTML ([XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)). **Hipótesis razonable, explotación no verificada:** si Shopify devuelve el valor malformado sin normalizarlo, podría romper el atributo. No se enviaron formularios ni payloads.

**Solución propuesta.** Cambiar a «value="{{ form.email | escape }}» y probar la respuesta de error en un entorno de prueba.

#### G2. Sustitución después del escape en textos DS — Media

**Archivo:línea y evidencia verificada.** snippets/ds-batch-text.liquid:14-18 primero hace «assign out = out | escape» y después «replace: '[tanda]', ds_name | replace: '[cierre]', ds_close ...»; los valores vienen de settings.ds_batch_* sin escape (líneas 9-12). sections/ds-announcement.liquid:5 llama al snippet con «escape: true».

**Por qué importa.** El parámetro promete texto seguro, pero HTML presente en ajustes se inserta después. El origen son ajustes del editor, no visitantes; por eso es endurecimiento de seguridad. OWASP recomienda codificar al final para el contexto de salida ([XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)).

**Solución propuesta.** Escapar cada valor de sustitución antes de reemplazar cuando escape sea true, o escapar el resultado completo para entradas de texto plano; mantener ruta separada para richtext legítimo.

#### G3. Enlace externo sin noopener explícito — Baja

**Archivo:línea y evidencia verificada.** sections/main-password-footer.liquid:97-103 contiene «href="//www.shopify.com"», «rel="nofollow"» y «target="_blank"», sin noopener. sections/ds-social.liquid:26,28 sí usa rel="noopener".

**Por qué importa.** noopener separa contextos entre pestañas y cubre navegadores antiguos; los actuales suelen hacerlo implícitamente ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/noopener)). No se observó explotación.

**Solución propuesta.** Usar rel="nofollow noopener noreferrer" si se desea esa política.

### Copy/negocio

#### C1. El anuncio no cambia cuando cierra el menú — Media

**Archivo:línea y evidencia verificada.** sections/header-group.json:32 configura «[tanda]: pedidos hasta el [cierre]» y línea 39 «Horneamos el [horneado] y despachamos [despacho]». sections/ds-announcement.liquid:2-6 muestra todos los bloques sin consultar settings.ds_batch_open; snippets/ds-product-card.liquid:65 sí lo consulta.

**Por qué importa.** Al cerrar una tanda, la barra puede seguir anunciando una fecha vencida y sugerir pedidos abiertos. templates/index.json:219 también llama «tanda actual» a fechas sin condición. La fecha real depende de la operación.

**Solución propuesta.** Separar mensajes de menú abierto/cerrado y activar el adecuado según el ajuste; actualizar fechas antes de reabrir.

#### C2. Promesas generales no comprobables con el código del tema — Media

**Archivo:línea y evidencia verificada.** templates/index.json:137 afirma que cada postre «indica en su ficha cómo conservarlo»; línea 240 repite esa promesa; líneas 246-247 dicen que ingredientes específicos se consultan en cada descripción y afirman contacto cruzado; sections/ds-contact.liquid:73 repite el texto sobre equipos compartidos.

**Por qué importa.** **Hipótesis razonable:** el repo no contiene las descripciones del catálogo ni datos del obrador para verificar las afirmaciones, incluidos los tres productos de «PRUEBA» activos según el encargo. No se afirma que sean falsas. La conservación de galletas **sí coincide** con el contexto recibido: config/settings_schema.json:1530-1534 y templates/index.json:239-240 dicen 4 días fuera, 8 en nevera y 3 meses congeladas.

**Solución propuesta.** Auditar cada ficha en Shopify Admin; completar ingredientes, alérgenos y conservación con datos aprobados o suavizar «cada producto». Confirmar también las instrucciones de recalentado antes de tratarlas como consejo universal.

#### C3. Capa DS fija en español con selector de idiomas — Media

**Archivo:línea y evidencia verificada.** sections/footer-group.json:33 activa «"enable_language_selector": true» y existen locales/es.default.json y locales/en.json. snippets/ds-product-card.liquid:50,66,72-79 fija «Agotado en esta tanda», «Agregar», «Cerrado» y «Elegir»; sections/ds-password.liquid:19,32,46,48,58 fija etiquetas en español.

**Por qué importa.** Si hay mercados con inglés u otros idiomas publicados, el flujo queda mezclado. La existencia de locales no confirma qué idiomas están activos; el efecto es condicional. Shopify recomienda locales para texto de interfaz ([Locales](https://shopify.dev/docs/storefronts/themes/architecture/locales)).

**Solución propuesta.** Mover cadenas DS de interfaz a claves t para los idiomas publicados y traducir copy editorial mediante ajustes; ocultar selector si solo se atiende en español.

## 4. Lo que está bien

- **Compra y stock:** snippets/ds-product-card.liquid:13-17,29-30,65-80 distingue disponibilidad, inventario controlado y productos con variantes. assets/product-form.js:1-3 protege customElements.define frente a una segunda carga. No hay código DS que exija cuenta para checkout, aunque la configuración real de cuentas no se pudo comprobar.
- **Imágenes configuradas:** sections/ds-hero.liquid:58-59, snippets/ds-product-card.liquid:42-44 y sections/ds-contact.liquid:44 usan image_url/image_tag, widths, sizes y carga diferida cuando corresponde. El primer slide se marca eager/high.
- **SEO base:** layout/theme.liquid:8,21-32 tiene canonical, título, descripción condicional y metaetiquetas; snippets/meta-tags.liquid:16-39 contiene OG/Twitter; sections/main-product.liquid:749-750 genera Product structured_data. La portada tiene h1 en el primer slide (sections/ds-hero.liquid:18-22) y la 404 tiene su h1 (sections/ds-404.liquid:4). Shopify documenta estos metadatos ([guía SEO](https://shopify.dev/docs/storefronts/themes/seo/metadata)).
- **Formularios y seguridad base:** contacto y contraseña usan formularios nativos de Shopify (sections/ds-contact.liquid:10; sections/ds-password.liquid:17,47). Shopify indica que hCaptcha protege formularios de cliente, contacto y comentarios sin integrarlo manualmente ([Shopify CAPTCHA](https://shopify.dev/docs/storefronts/themes/trust-security/captcha)); su estado efectivo no se comprobó. Los enlaces sociales DS y el enlace de regalo a la tienda sí usan rel="noopener" (sections/ds-social.liquid:26,28; templates/gift_card.liquid:204-205).
- **Accesibilidad intencional:** enlace para saltar al contenido (layout/theme.liquid:333-349), foco visible global (assets/ds-premium.css:17), reducción de movimiento (assets/ds-premium.css:231-237) y etiquetas de campos. Íconos decorativos con aria-hidden="true" (snippets/ds-icon.liquid:6).
- **Integridad y casos especiales:** todos los JSON de templates, sections, config y locales cargaron en el parser; cotejo de tipos/ajustes de templates contra schemas sin IDs faltantes. Las claves del locale inglés tienen correspondencia en es.default.json. El template de regalo usa json para la cadena del QR (templates/gift_card.liquid:220-228), foco visible e impresión (líneas 135-138). La página 404 y contraseña tienen secciones propias correctamente referenciadas por sus templates.
- **Búsqueda predictiva y carrito:** layout/theme.liquid:405-410 conserva los scripts de búsqueda predictiva y cajón de Dawn; sections/main-search.liquid:274 usa la tarjeta DS sin cambiar el formulario de búsqueda. assets/cart-drawer.js:102-111 y 125-139 solicitan y actualizan el cajón completo, donde snippets/cart-drawer.liquid:491 inserta el aviso DS. El uso de innerHTML en assets/predictive-search.js:255 recibe HTML de la respuesta de sección Shopify; no se encontró un innerHTML nuevo en assets/ds-motion.js. No se pudo verificar el comportamiento en navegador.

## 5. Plan de acción priorizado

### Quick wins

1. Escapar form.email en ds-social y corregir el orden de escape en ds-batch-text; probar render de errores.
2. Configurar Instagram o quitar enlaces «#»; dar nombre accesible a cada foto enlazada.
3. Oscurecer el rojo de texto pequeño; añadir pausa/reanudación a anuncio y hero; corregir el ajuste huérfano de contraseña y limpiar recursos DS en shopify:section:unload.
4. Hacer que el anuncio siga el estado abierto/cerrado; revisar próximas fechas de cierre, horneado y despacho.
5. Retirar carga legada de dayanas-theme.css cuando se autorice editar el tema; depurar sameAs y logo estructurado.

### Trabajo mayor

1. Cerrar la tanda en ficha, compra dinámica, carrito y disponibilidad real de Shopify; probar rutas directas y checkout invitado.
2. Sincronizar cupos y precio DS con la variante activa, incluida una agotada y reglas de cantidad.
3. Optimizar imágenes de respaldo, condicionar CSS por plantilla y medir transferencia, LCP y CLS en móvil.
4. Traducir la interfaz DS para idiomas publicados y validar cada ficha activa frente a promesas de ingredientes, conservación y envío.
5. Repetir la auditoría de producción con cabeceras, robots, sitemap, páginas clave, teclado/lector, métricas y datos estructurados cuando el acceso público funcione.

## 6. Metodología y límites de la revisión

- **Base y alcance:** árbol limpio en c9242fe79a5e226e299ecf5612f1044c2fb65c15. Se consultó git diff 0987db2..HEAD para identificar cambios frente al primer commit disponible; ese commit ya se llama «Dayana's Sweet rediseño v4», por lo que **no equivale a Dawn 16 upstream limpio**. Se inspeccionaron todos los sections/ds-*.liquid, snippets/ds-*.liquid, assets/ds-*.css, assets/ds-motion.js, assets/dayanas-theme.css, layout/theme.liquid, layout/password.liquid, templates/*.json, templates/gift_card.liquid, config/settings_*.json, locales es.default y en, además de componentes Dawn modificados y JS relacionado. Se buscaron nombres de archivos sensibles/secretos versionados y patrones de código; no apareció una credencial evidente, sin pretender auditoría forense de todo el historial.
- **Comprobaciones estáticas:** parseo de todos los JSON de templates, sections, config y locales; cotejo automatizado de tipos/ajustes de templates con schemas; comparación de claves EN/ES; lectura de dimensiones y bytes PNG; cálculo sRGB de contraste. No se ejecutó Theme Check ni navegador visual, y no se modificó el código del tema.
- **Web pública:** se intentaron consultas de solo lectura a https://dayanassweet.com/ y www (HEAD), /robots.txt, /sitemap.xml, /collections/all, /cart, /search?q=PRUEBA y una ruta 404; la herramienta web también intentó abrir home, carrito, búsqueda y 404. Todos los accesos directos fallaron antes de recibir HTTP: «curl: (7) Failed to connect to dayanassweet.com port 443 ... Could not connect to server»; la herramienta web devolvió «URL ... is not accessible via this tool». Se probó /products/prueba como URL tentativa, **no como producto identificado**. Así que **no hay HTML ni cabeceras observadas**: no se concluye nada sobre código HTTP de 404, CSP/HSTS, robots, sitemap, indexación, aspecto real, rendimiento ni productos en producción. No se enviaron formularios ni pedidos.
- **Acceso faltante:** sin Shopify Admin, catálogo, inventario, configuración de Markets/idiomas, políticas de checkout, analíticas/Search Console, tarjeta de regalo real ni tema de prueba. Las **hipótesis razonables** requieren verificación allí. Las observaciones **verificadas** describen código y configuración versionada, que pueden diferir de overrides en la tienda en vivo.


## 7. Anexo: verificación en vivo (Claude, 2026-09-26)

Codex no pudo conectarse a la web pública desde su sandbox. Esta parte se comprobó después con `curl` de solo lectura contra https://dayanassweet.com:

- **Cabeceras de seguridad (las gestiona Shopify, bien):** `strict-transport-security: max-age=7889238`, `x-frame-options: DENY`, `content-security-policy: block-all-mixed-content; frame-ancestors 'none'; upgrade-insecure-requests`, `X-Content-Type-Options: nosniff`. Las cookies de sesión llevan `HttpOnly; Secure; SameSite=Lax`. No hay `Referrer-Policy` ni `Permissions-Policy`, pero el tema no las puede definir en Shopify; no requiere acción.
- **404:** una ruta inexistente devuelve HTTP 404 real, no un soft-404.
- **robots.txt y sitemap.xml:** los dos responden (sitemap con HTTP 200).
- **Confirma R2:** la cabecera `link` de la portada precarga `dayanas-theme.css` (el archivo legado vacío) y `ds-pages.css` en todas las páginas.
- **Spot-check de G1 y F1:** los dos se confirmaron en el código (`sections/ds-social.liquid:11` sin `| escape`; `ds_batch_open` solo aparece en 4 archivos de presentación y no en buy-buttons ni en el carrito).
