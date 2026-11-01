# Integrar opción 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Convertir el prototipo ya elegido en el tema Shopify revisable para GitHub, corrigiendo la diferencia entre la web publicada y la propuesta esperada.

**Architecture:** Nuevas secciones `ds-redesign-home`, `ds-redesign-header` y `ds-redesign-footer`, CSS `ds-redesign.css` y JS `ds-redesign.js`. El contenido usa Liquid y formularios nativos de Shopify. Conservar las secciones anteriores desactivadas para no perder sus ajustes. Reutilizar estado y fechas centralizados y el cart drawer de Dawn, sin cambiar comercio.

**Tech Stack:** Liquid, CSS y JavaScript vanilla de Dawn 16. Sin build ni dependencias de ejecución nuevas.

**Spec:** `docs/redesign/opcion-1/index.html`, `style.css`, `textos.md` y `qa/textos-desktop.png`. Milton eligió opción 1, pidió estos textos, autorizó toda la implementación y espera ver esa propuesta en la web. Su pregunta sobre GitHub corrige el flujo de integración, no pide otro diseño. No se requiere repetir la elección.

## Global Constraints

- Trabajo en la rama aislada existente, preservando cambios previos. Sin commit ni push a main mientras se prepara y prueba el resultado; el push a main requiere autorización explícita para ese push según AGENTS.md.
- Pruebas remotas solo en un tema nuevo sin publicar. El tema actual publicado no se sobrescribe.
- Productos, precios y colecciones proceden de Shopify; categorías configurables mediante objetos de colección.
- La suscripción utiliza `{% form 'customer' %}` con éxito/error reales, nunca una confirmación simulada. No enviar datos durante QA.
- La búsqueda utiliza `routes.search_url`, la cuenta `routes.account_url` y el carrito su ruta y drawer nativos.
- Fechas iniciales vacías y pedidos cerrados. Sin modificaciones a stock, catálogo, transporte, checkout o pagos.
- Imágenes y tipografías de la propuesta existentes; permitir reemplazarlas desde el editor. No generar nuevos assets ni modificar fotografías.
- Sin reseñas, cifras de ventas, años de experiencia ni promesas no confirmadas. No usar «tanda» en el contenido nuevo.
- Móvil de 390 y 320 px, escritorio de 1260 px; foco visible, diálogos accesibles y movimiento reducido.

## Review Focus

- Reemplazos AJAX del carrito conservan el icono y su enlace en el nuevo encabezado.
- Secciones recargadas por el editor no duplican eventos ni pierden el cierre/foco de diálogos.
- No hay titulares enormes heredados, márgenes de Dawn ni colores de la portada anterior que alteren la referencia.
- Rutas de colección/cuenta/búsqueda válidas, sin URL absolutas a otra tienda ni inventario falso.
- Apertura opcional y fechas compartidas no producen frases vacías ni abren ventas sin datos.

## Task 1: Portada real

**Files:** crear `sections/ds-redesign-home.liquid`, `tests/redesign-home.test.mjs`.

- [x] Pruebas de renderizado RED para estados cerrado, apertura opcional y abierto; fechas escapadas; categorías reales y formulario nativo.
- [x] Portada conforme al HTML aprobado: hero de tres líneas, banda de aviso/formulario y dos categorías grandes. Texto editable y fotos configurables.
- [x] GREEN de sus pruebas y esquema JSON válido.

## Task 2: Navegación y pie reales

**Files:** crear `sections/ds-redesign-header.liquid`, `sections/ds-redesign-footer.liquid`, `assets/ds-redesign.js`, `tests/redesign-navigation.test.mjs`.

- [x] Pruebas RED de rutas y contrato del icono del carrito.
- [x] Encabezado fiel al prototipo con menú móvil, Cómo pedir, búsqueda real y cuenta real. Pie sencillo de marca y políticas nativas, sin la leyenda de prototipo.
- [x] Diálogos con Escape, foco devuelto, interacción móvil y recarga del editor.
- [x] GREEN de pruebas y `node --check`.

## Task 3: Estilos, assets y configuración

**Files:** crear `assets/ds-redesign.css`, copiar assets `ds-r-*`; modificar `layout/theme.liquid`, `templates/index.json`, `sections/header-group.json`, `sections/footer-group.json`.

- [x] Copiar assets existentes y licencias sin alterar imágenes. Cargar tipografía y CSS nuevos al final, con clases `ds-r-*` aisladas.
- [x] Conectar secciones nuevas y dejar las antiguas desactivadas; no perder sus ajustes.
- [x] Mantener las pruebas existentes válidas y correr todas las pruebas de pedidos/navegación/portada, `check-theme` y Theme Check sobre el contenido desplegable.

## Task 4: Prueba real y entrega para GitHub

- [x] Preparar tema nuevo sin publicar con la integración completa.
- [x] Comprobar visualmente contra el prototipo, escritorio y móvil, menús/búsqueda/carrito/formulario sin enviar suscripciones ni compras.
- [x] Revisión independiente acotada del contrato de carrito y rutas; corregir hallazgos importantes con prueba RED/GREEN.
- [x] Guardar `design-qa.md`, capturas y resultado real. Entregar enlace revisable y archivos listos para GitHub, indicando cualquier pendiente de publicación.

## Registro

Ruling: el prototipo aprobado es la fuente visual y de contenido; la publicación anterior solo activó el panel y conservó el diseño viejo. Se corrige la integración, sin plantear otra propuesta ni alterar productos.
Ruling: el grupo anterior se conserva desactivado para no borrar configuración comercial previa. Las nuevas secciones son las únicas activas de la portada/cabecera/pie.

Resultado: 44/44 pruebas, check-theme 38 JS/67 JSON/55 esquemas, Theme Check 0 errores/8 advertencias. QA visual conjunta aprobada en design-qa.md. Dos P2 de revisi?n independiente corregidos con RED/GREEN; uno visual corregido y recapturado. Tema nuevo sin publicar 189782163760, con drawer restaurado, pedidos cerrados y fechas vac?as confirmadas por descarga. GitHub/main/publicaci?n quedan pendientes de autorizaci?n espec?fica; no son una casilla de esta preparaci?n.
