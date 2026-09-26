---
name: design-from-brief
description: "Diseña o rediseña secciones y páginas del tema Shopify de Dayana's Sweet (Dawn 16 + capa propia ds-*) a partir de un brief mínimo, combinando design-taste-frontend (dirección visual, dials, reglas anti-slop), impeccable (modo de superficie, craft floor, proceso de construcción y QA acotado) y emil-design-eng (decisiones de motion y pulido de componentes). Al invocarse, SOLO debe pedir tres cosas: el objetivo del diseño, la línea de diseño, e imágenes (logos y otros assets de marca). Nunca pide nada más."
user-invocable: true
argument-hint: "[objetivo del diseño]"
---

# Diseño desde Brief — Dayana's Sweet

Orquesta tres skills ya instaladas — `design-taste-frontend`, `impeccable`, `emil-design-eng` — para producir secciones, plantillas o rediseños del tema Shopify de Dayana's Sweet (pastelería artesanal) a partir de la menor cantidad de información posible del usuario.

## Contexto fijo del repo (no se pregunta, se asume)

- **Stack:** tema Shopify basado en **Dawn 16.0.0** (Liquid + CSS + JS vanilla). No hay React, Tailwind, bundler ni build step. Todo lo que se construya debe ser Liquid/CSS/JS nativo del tema. Ignora cualquier recomendación de stack o librería de `design-taste-frontend` que no aplique a un tema Shopify.
- **Capa propia `ds-`:** el diseño de marca vive encima de Dawn con prefijo `ds-`:
  - Secciones: `sections/ds-*.liquid` (`ds-hero`, `ds-story`, `ds-collection`, `ds-universe`, `ds-faq`, `ds-signoff`, …).
  - Estilos: `assets/ds-premium.css`, `ds-reference.css`, `ds-polish.css`, `ds-conversion.css`, cargados en ese orden en `layout/theme.liquid` después de `base.css`. `dayanas-theme.css` es legado.
  - Motion: `assets/animations.js` (Dawn) más lo que se agregue a la capa `ds-`.
  - Imágenes de marca: `assets/logo-badge.png`, `assets/logo-horizontal.png` y fotos `assets/ds-*.png`.
- **Tipografía actual:** Fraunces (títulos) + Poppins (texto), configuradas en `config/settings_data.json` y servidas por Shopify (`font_face`). Mantenlas salvo que la línea de diseño pida otra cosa explícitamente; si se cambian, hazlo vía los settings del tema, no con `@import` externos.
- **Idioma:** textos de la tienda en español.

## Regla central: solo tres preguntas

Al ser invocado, pide **únicamente** estas tres cosas, en un solo turno:

1. **Objetivo del diseño** — qué se diseña (portada, sección nueva, página de producto, colección, carrito, rediseño de una sección existente…) y para qué sirve.
2. **Línea de diseño** — estilo o dirección visual deseada (referencias, adjetivos de marca, ejemplos de tiendas/sitios que le gusten, o "mantener la línea actual" / "libre").
3. **Imágenes** — logos, fotos de productos u otros assets de marca nuevos (o confirmación de que se usan los que ya están en `assets/`).

Si el usuario ya dio alguno de estos tres datos en su mensaje inicial, no lo repreguntes — pide solo lo que falte, en el mismo formato de tres puntos.

**No preguntes nada más.** Nunca pidas paleta, tipografía, stack, estructura de secciones, nivel de animación, dispositivo objetivo, ni ningún otro detalle técnico o de diseño: todo eso se infiere del repo y de las tres skills base. Si el usuario ofrece esos detalles espontáneamente, úsalos.

## Flujo una vez recibidas las tres respuestas

Primero lee el estado actual, define la dirección y muéstrala como Artifact para aprobación (paso 2.5); una vez aprobada, construye en una sola pasada completa (no preguntes de nuevo, no itere en bucle abierto):

0. **Auditoría rápida del tema actual**
   Antes de proponer nada, revisa lo que ya existe y es relevante al objetivo: `layout/theme.liquid`, la plantilla afectada en `templates/*.json`, las secciones `ds-*` implicadas, las variables y colores de la capa `ds-` en `assets/ds-*.css` y los esquemas de color en `config/settings_data.json`. Casi todo trabajo aquí es un **rediseño sobre algo existente**: la propuesta debe partir de la identidad actual, no ignorarla.

1. **Lectura de brief y dirección visual — `design-taste-frontend`**
   Invoca esta skill (Skill tool) usando objetivo + línea de diseño + lo encontrado en el paso 0 como brief. Deja que infiera: audiencia (clientes de una pastelería artesanal comprando online), "Design Read", los tres dials (`DESIGN_VARIANCE`, `MOTION_INTENSITY`, `VISUAL_DENSITY`), paleta, estrategia de imágenes y las reglas anti-slop de layout/copy/hero. El stack está fijado (ver Contexto fijo).
   Los logos y fotos existentes en `assets/` y los que entregue el usuario son "brand assets que ya existen" — material de partida, nunca opcional; nunca inventes un logo.

2. **Modo de superficie y piso de calidad — `impeccable`**
   Invoca esta skill para elegir el modo (normalmente *persuade* para portada/colecciones, *operate* para carrito y checkout-adjacent), planear la superficie (flujo de refinamiento si es rediseño, `shape`/`new-work` si es una sección nueva) y aplicar el craft floor antes de tocar cualquier UI. Disciplina de verificación acotada: construir completo, inspeccionar una vez (desktop + mobile), corregir en un solo lote, confirmar con una ronda más como máximo.

2.5. **Propuesta visual como Artifact — obligatorio antes de generar código**
   Con la dirección decidida y **antes de escribir o modificar cualquier archivo del tema** (secciones, snippets, plantillas, CSS, JS, settings), construye una maqueta estática en HTML y publícala con la herramienta `Artifact`. Debe usar los logos, fotos y fuentes reales (Fraunces/Poppins desde Google Fonts, imágenes de `assets/` subidas como assets del artifact) y mostrar: la paleta aplicada, el primer viewport, las secciones afectadas y, si aplica, las pantallas clave de compra (colección, producto, carrito/cart drawer). Comparte el enlace con un resumen corto (concepto, paleta, tipografía, motion) y **espera la aprobación explícita del usuario**. Si pide cambios, actualiza el mismo artifact y vuelve a esperar. Esto no cuenta como pregunta extra: es la entrega de la propuesta.

3. **Construcción en el tema**
   Tras la aprobación, implementa siguiendo las convenciones del repo:
   - Secciones nuevas como `sections/ds-<nombre>.liquid`, con `{% schema %}` completo: `name` con prefijo `"DS · …"`, labels en español, textos e imágenes editables desde el editor de temas (nada de copy hardcodeado que la dueña no pueda cambiar), y `presets` si deben poder agregarse desde el editor.
   - Colocar/ordenar secciones editando `templates/*.json`, no el layout.
   - Estilos en la capa `ds-` existente (el archivo que corresponda por responsabilidad), reutilizando sus variables; no toques `base.css` ni los `component-*.css` de Dawn salvo que sea imprescindible.
   - Productos, precios y colecciones siempre desde objetos de Shopify (`product`, `collection`, `section.settings`), nunca datos inventados en el markup.
   - Respeta `prefers-reduced-motion` y mantén el carrito/cart drawer de Dawn funcional.

4. **Motion y pulido de componentes — `emil-design-eng`**
   Invoca esta skill sobre lo ya construido para decidir qué se anima y qué no, easing/duración, estados hover/presión, y el resto del marco de decisión de animación. Es la capa final sobre la estructura, no un sustituto.

5. **Assets de imagen**
   Usa tal cual las imágenes de marca existentes y las que entregue el usuario. Imágenes nuevas del tema van a `assets/ds-*.{png,jpg,webp}` optimizadas; las de productos se gestionan desde el admin de Shopify, no en el repo. Para imágenes que falten, sigue la prioridad de `design-taste-frontend` (generación → reales/stock → placeholder etiquetado) y avisa al final qué placeholders quedaron pendientes.

6. **Prueba y cierre**
   - Prueba los cambios (vista previa del tema con `shopify theme dev` si la CLI está disponible; si no, revisión de Liquid/CSS y la maqueta) en desktop y mobile, y reporta el resultado.
   - Resume en pocas líneas las decisiones tomadas (dirección visual, dials, paleta, tipografía, motion, archivos tocados).
   - **No hagas `git push` a `main`** sin haber probado y sin autorización explícita del usuario en ese momento (regla del `CLAUDE.md` del repo; una autorización previa no vale).

## Qué no hacer

- No preguntar más de las tres cosas iniciales, bajo ninguna circunstancia.
- No pedir confirmación dial por dial de `design-taste-frontend`, ni el modo de `impeccable`, ni las curvas de `emil-design-eng`.
- No omitir ninguna de las tres skills base: siempre se combinan las tres, en el orden de este flujo.
- No modificar archivos del tema antes de que el usuario apruebe la propuesta publicada como Artifact (paso 2.5).
- No introducir frameworks, build steps ni dependencias externas (CDNs de JS/CSS) en el tema.
- No subir a `main` sin prueba y autorización explícita.
