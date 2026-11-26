# Contrato: «Cotiza tus dulces» (venta por cotización)

- Fecha: 2026-11-25.
- Rama: `jAlexander15c/cotiza-dulces`.
- Maqueta aprobada: https://claude.ai/artifact/SmEmzjxzHX8AbkRd96d4iz. Su copia local está en `C:\Users\Milton\AppData\Local\Temp\claude\87ebaf8f9146aab4\7748274b-c78e-4bb8-957c-20849473aa3b\scratchpad\cotiza-dulces-maqueta\project\` (`Main`, `Ficha`, `Cotizar`, `Conocenos`, `HeroEscritorio`, `.dc.html`).

## Contexto

Las tandas están suspendidas y la tienda pasa a vender por cotización.
- No se borra el código de tandas: todo depende de un interruptor del tema, para poder volver atrás.
- Los colores y las fuentes salen de los tokens de `assets/ds-redesign.css:38` (`--paper`, `--pink`, `--deep-pink`, `--blush`, `--ink`, `--muted`, `--line`, `--display`, `--body`), nunca de los hex de la maqueta.
- Montserrat se usa hasta el peso 600.
- No se toca el admin de Shopify (productos, colecciones, metacampos).

## Parte A: tema, a cargo del implementador

### A1. Ajustes (`config/settings_schema.json`, grupo «DS · Pedidos y envíos», al principio)

- `ds_quote_mode`:
  - checkbox, etiqueta «Venta por cotización», `default: false`;
  - info: «Oculta precios, carrito y avisos de tanda, y muestra los botones para cotizar. Desactívalo para volver a vender por tandas.»
- `ds_whatsapp`:
  - text, etiqueta «WhatsApp (solo números, con código de país)»;
  - placeholder «13462348436».
- En `config/settings_data.json`, solo en `current`:
  - `"ds_quote_mode": true`;
  - `"ds_whatsapp": "13462348436"`;
  - `"social_instagram_link": "https://www.instagram.com/dayanasweet02/"`.

### A2. Estado de tanda (`snippets/ds-batch-state.liquid`)

- Con `settings.ds_quote_mode`, imprime `'1'` (cerrada) siempre.
- Así el carrito, el checkout y los botones de compra siguen bloqueados aunque alguien active `ds_batch_open`.

### A3. Mensajes de tanda: se ocultan en modo cotización

Cada snippet o sección comprueba `settings.ds_quote_mode` antes que el estado de tanda:
- `snippets/ds-announcement.liquid`: no muestra nada.
- `snippets/ds-collection-hero.liquid`: sin aviso de tanda.
- `snippets/ds-product-batch.liquid` y `snippets/ds-sticky-buy.liquid`: no muestran nada.
- `snippets/ds-order-dates.liquid`, `snippets/ds-batch.liquid` y `snippets/ds-faq.liquid`: no muestran el texto de tanda. Revisar qué imprimen; si es solo tanda, no imprimen nada.
- `snippets/ds-cart-batch.liquid`:
  - en su lugar muestra «Ahora trabajamos por cotización.»;
  - con un enlace «Cotiza tus dulces» a `pages['pasteles-personalizados'].url`.
  - El checkout sigue deshabilitado, porque A2 lo deja cerrado.
- `snippets/card-product.liquid` y `snippets/ds-product-card.liquid`:
  - sin precio y sin «Tanda cerrada», «Cerrado», «Agotado» ni «Quedan N»;
  - el botón o acción de la tarjeta pasa a ser un enlace «Ver y cotizar» a `product.url`.

### A4. Ficha de producto (`sections/main-product.liquid`)

En modo cotización:
- Los bloques `price` y `quantity_selector` no se muestran.
- El bloque `buy_buttons` renderiza el snippet nuevo `snippets/ds-quote-buttons.liquid`, en lugar de `buy-buttons`:
  - Botón principal «Agrégalo a tu cotización» (flecha igual que `ds-r-button`). Enlace: `{{ pages['pasteles-personalizados'].url }}?agregar={{ product.title | url_encode }}`.
  - Texto debajo: «Lo anotamos en tu solicitud. Dayana te envía el precio en la cotización, en menos de 12 horas.»
  - Botón secundario «Pregúntanos por WhatsApp», solo si `settings.ds_whatsapp` no está vacío. Enlace: `https://wa.me/{{ settings.ds_whatsapp | remove: ' ' }}?text={{ 'Hola, quiero preguntar por ' | append: product.title | url_encode }}`. Lleva `target="_blank"` y `rel="noopener"`.
  - Si la página `pasteles-personalizados` no existe, no muestra el botón principal; solo WhatsApp.
- `variant_picker` y `ds_topping` se mantienen. Probar que no haya errores de JS al cambiar de variante sin el formulario de compra.

### A5. Inicio (`sections/ds-redesign-home.liquid` + `templates/index.json`)

Con `settings.ds_quote_mode`, siguiendo `Main.dc.html` y `HeroEscritorio.dc.html`.

**Ajustes nuevos en el schema**, con estos `default`:

| Ajuste | Valor |
|---|---|
| `quote_title` | «Dulces cubanos para cada» |
| `quote_title_em` | «celebración.» |
| `quote_text` | «Pasteles de cumpleaños, postres y salados cubanos, hechos a mano en Fulshear.» |
| `quote_cta` | «Cotiza tus dulces» |
| `quote_secondary` | «Mira lo que preparamos» |
| `quote_note` | «Te enviamos tu cotización en menos de 12 horas.» |
| `steps_title` | «Así se cotiza» |
| `step_1` | «**Cuéntanos tu pastel** y, si quieres, los postres o salados que quieras sumar.» |
| `step_2` | «**Dayana te envía la cotización** en menos de 12 horas.» |
| `step_3` | «**Aceptas y reservas tu fecha.** Recoges en Fulshear, TX.» |
| `quote_menu_text` | «Mira lo que preparamos y súmalo a la cotización de tu pastel.» |
| `contact_title` | «¿Prefieres escribirnos?» |
| `contact_text` | «Respondemos en menos de 1 hora.» |
| `news_title` | «Novedades y ofertas» |
| `news_text` | «Sabores nuevos, fechas especiales y ofertas, directo a tu correo.» |
| `news_button` | «Suscribirme» |
| `news_note` | «Puedes darte de baja cuando quieras.» |
| `news_success` | «¡Listo! Te escribiremos con novedades y ofertas.» |

Los pasos son `richtext` o `inline_richtext`, por las negritas.

**Portada:**
- `h1` con `quote_title`, más `<em>` con `quote_title_em`.
- Párrafo con `quote_text`.
- Botón principal `quote_cta`, que lleva a la página `pasteles-personalizados`. Botón secundario (`ds-r-button--secondary`) `quote_secondary`, que lleva a `#menu`.
- Nota `quote_note`.
- Sin aviso de cerrado y sin `ds-r-hero--closed`.

**Secciones:**
- La sección de tanda se reemplaza por «Así se cotiza», con 3 pasos numerados en `<ol role="list">`.
- Menú `#menu`:
  - título `menu_title` y texto `quote_menu_text`;
  - sin el botón «Ver todo el menú»;
  - cuadrícula con `use_blocks: true` y `hide_empty: true`.
- Bloque de contacto `contact_title` / `contact_text`:
  - «WhatsApp (346) 234-8436», a `https://wa.me/{{ settings.ds_whatsapp }}`, solo si existe. El número visible se forma con los 10 últimos dígitos: `(XXX) XXX-XXXX`.
  - «Instagram @dayanasweet02», a `settings.social_instagram_link`, solo si existe. El usuario se deriva de la URL.
  - Ambos en pestaña nueva, con `rel="noopener"`.
- Bloque «Novedades y ofertas»:
  - reutiliza **el mismo** `{% form 'customer', id: newsletter_id %}` actual, con `contact[tags]=newsletter`, etiqueta de correo y estados de éxito y error;
  - siempre visible en modo cotización;
  - el enlace de las demás piezas sigue apuntando a `#{{ newsletter_id }}`.

**Sin modo cotización**, todo queda exactamente como hoy.

**Bloques de `templates/index.json` (`redesign`):** se reemplazan `cookies` y `brownies` por, en este orden:

| Bloque | Título | Destino | `link_label` | `fallback_image` |
|---|---|---|---|---|
| `pasteles` | «Pasteles de cumpleaños» | `url: shopify://pages/pasteles-personalizados`, sin colección | «Cotiza tu pastel» | `pastel` |
| `postres` | «Postres» | colección `postres` | «Ver postres» | `plain` |
| `salados` | «Salados» | colección `salados` | «Ver salados» | `plain` |
| `jugos` | «Jugos y bebidas» | colección `jugos-y-bebidas` | «Ver jugos y bebidas» | `plain` |

### A6. Cuadrícula (`snippets/ds-category-grid.liquid` + schema del bloque `category`)

- Parámetro nuevo `use_blocks`: si vale `true`, se salta el modo automático por metacampos y usa los bloques.
  - Hoy la tienda en vivo usa el modo automático y muestra Galletas, Brownies, Conservas saladas y Jugos.
- Ajuste nuevo del bloque: `url` (tipo `url`, «Enlace si no hay colección»).
  - Un bloque con `url` y sin colección siempre es visible (no lo afecta `hide_empty`) y enlaza a esa `url`.
  - Un bloque sin colección **y** sin `url`, con `hide_empty`, se oculta. Así la colección `salados`, que aún no existe, no se muestra.
- Imagen: primero `block.settings.image`, luego `category.image` y por último el respaldo.
- Opciones nuevas de `fallback_image`:
  - `pastel`: fondo `--blush` con `ds-r-cupcake.png` centrado;
  - `plain`: fondo `--blush` sin imagen.
  - Se mantienen `cookies` y `brownies`.

### A7. Cabecera (`sections/ds-redesign-header.liquid`)

En modo cotización:
- La navegación queda: Menú (`#menu` o `/#menu` fuera del inicio, como hoy), **«Cotiza tus dulces»** (enlace a la página), Conócenos y Contacto. Sustituye al botón «Cómo pedir».
- En lugar del ícono del carrito (`#cart-icon-bubble`), un ícono de WhatsApp (`aria-label="Escríbenos por WhatsApp"`, 44×44 px) a `https://wa.me/{{ settings.ds_whatsapp }}`.
  - En escritorio puede ser una píldora con el texto «WhatsApp», como en `HeroEscritorio.dc.html`.
  - Sin `ds_whatsapp`, no se muestra nada en ese lugar.
- El diálogo «Cómo pedir» puede quedar sin cambios.

**«Conócenos»**, en ambos modos: `about_body` toma el texto de la opción A de `Conocenos.dc.html`.
- Actualizar el `default` y también el valor guardado, si existe en `sections/header-group.json` u otro JSON.

### A8. Pruebas del tema

- Actualizar las pruebas que fijan textos o estructura y que cambian con esto: `tests/redesign-home.test.mjs`, `orders-settings.test.mjs`, `diseno-fase4.test.mjs`, `diseno-fase2.test.mjs`, `redesign-integration`, `redesign-navigation` y `topping-selector`.
  - Mantener las aserciones del modo tandas, que siguen siendo válidas.
- Agregar `tests/cotiza-dulces.test.mjs` con aserciones de fuente sobre A1–A7.

### A9. Fuera de la parte A

- No tocar `sections/ds-celebracion-solicitud.liquid`, `assets/ds-celebracion-solicitud.*`, `tests/celebracion-solicitud.test.mjs` ni `services/`.
- Esos archivos son de la parte B.

## Parte B: formulario y servicio, a cargo del coordinador

**B1. Celebraciones (`services/celebraciones/src/store-core.mjs`, `detailsInput`).**
- `details` admite dos claves opcionales: `cake` (boolean, por defecto `true`) y `extras` (texto, `empty: true`, límite 2000).
- Con `cake === false`:
  - `tiers` y `decorations` son `[]`;
  - `coating` es `''`;
  - `extras` es obligatorio (1 a 2000 caracteres);
  - la fecha y el horario se validan igual.
- Con `cake` ausente o `true`, todo funciona como hoy. Una solicitud antigua sin claves nuevas sigue siendo válida.

**B2. Formulario (`sections/ds-celebracion-solicitud.liquid` + `assets/ds-celebracion-solicitud.js` + `.css`):**
- Pregunta inicial «¿Tu pedido incluye pastel?», con las opciones «Sí, con pastel» y «Sin pastel, solo postres o salados».
- Con «Sin pastel» se ocultan pisos, diámetro, sabores y cobertura.
- Campo «¿Quieres sumar postres o salados?», que es obligatorio sin pastel.
- `?agregar=` prellena ese campo. Se asigna como `textarea.value`, con un máximo de 200 caracteres.
- `requestText` incluye «Postres o salados: …».
- Casilla desmarcada de novedades. Si está marcada, al enviar se manda además el formulario `customer` (etiqueta `newsletter`). Es mejor esfuerzo: si falla, no bloquea la cotización.
- Plazo «en menos de 12 horas».
- La galería solo se muestra si hay fotos cargadas.

**B3. Panel de Dayana:** sin cambios, porque los extras viajan en `requestText`.

**B4. Orden de publicación:** primero Celebraciones y después el tema.

## Criterios de aceptación

1. Con `ds_quote_mode` en `false`, el inicio, la ficha, las tarjetas, el carrito y la cabecera renderizan igual que en `origin/main`. Las pruebas actuales del modo tandas siguen en verde.
2. Con `ds_quote_mode` en `true`:
   - ningún precio visible en el inicio, las tarjetas, la ficha ni los rieles;
   - ningún botón de compra ni de carrito;
   - ningún texto de «tanda», «cerrado» ni «agotado» visible;
   - checkout deshabilitado en el carrito.
3. La ficha enlaza a `/pages/pasteles-personalizados?agregar=<título codificado>`. WhatsApp abre `wa.me/13462348436`.
4. En el inicio en vivo hoy se ven «Pasteles de cumpleaños» y «Jugos y bebidas». Postres (vacía) y Salados (inexistente) no se ven.
5. La suscripción del inicio envía `form_type=customer` con `contact[tags]=newsletter`.
6. 390 px y 1440 px:
   - sin desborde horizontal;
   - táctiles de al menos 44 px;
   - contraste AA;
   - foco visible;
   - sin errores de JS;
   - `prefers-reduced-motion` respetado.
7. Celebraciones:
   - solicitud sin pastel con extras: 201;
   - sin pastel y sin extras: 422 `VALIDATION`;
   - solicitud antigua: 201.
8. `node tests/check-theme.mjs`, `node --test tests/*.test.mjs` y `npm test` en `services/celebraciones`: todo en verde.
