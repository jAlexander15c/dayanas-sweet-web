# Pedidos y envíos Implementation Plan

**Continuación de despliegue:** el 1 de noviembre, después de la verificación del editor, Milton autorizó «subelo a live». Se publicaron los archivos revisados del tema `189776789808` mediante `theme publish`, con pruebas repetidas y descarga previa del tema anterior. El tema anterior `188534653232` quedó sin publicar como respaldo. No hubo push a GitHub. Evidencia y comprobación pública en `docs/pedidos-envios-qa.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preparar los controles privados de pedidos y fechas aprobados por Milton en los ajustes nativos de Shopify, con avisos coherentes y sin publicar.

**Architecture:** Reutilizar los identificadores existentes `ds_batch_*` para conservar compatibilidad. Sección «DS · Pedidos y envíos» con interruptor manual, apertura informativa, cierre, envío y mensaje cerrado. Fechas de texto sencillo; el cierre exacto automático existente queda como opción avanzada. Reutilizar Liquid para las fechas y el mensaje compartidos en portada, colección, producto y carrito.

**Tech Stack:** Shopify Liquid, JSON de ajustes y Node para comprobaciones. LiquidJS solo como herramienta externa de pruebas, sin dependencias de ejecución en el tema.

**Spec:** Milton aprobó el 1 de noviembre de 2026 la tabla de campos y el uso del editor de Shopify. Fechas reales pendientes; preparación inicial cerrada y sin fechas inventadas. Instrucciones de conservación se ponen dentro del empaque por Milton.

## Global Constraints

- Trabajar en el worktree aislado existente y conservar modificaciones ajenas. Sin commits, push a GitHub ni publicación. La continuación «Haz todo eso» autoriza cargar y validar un tema de prueba sin publicar, sin modificar el tema en vivo ni productos, pagos, inventario o envíos.
- No crear un panel público ni otra autenticación; se utilizan los ajustes privados del editor de temas.
- El estado es manual. La apertura escrita informa la próxima fecha; no programa apertura ni modifica inventario. El cierre exacto heredado sigue siendo opcional.
- La interfaz queda cerrada si no se habilita expresamente o si falta cierre/envío. No cambia la autoridad del inventario de Shopify ni las reglas de checkout.
- Ocultar las fechas y frases que dependan de datos pendientes; escapar valores introducidos por el administrador.
- Conservar IDs y placeholders antiguos, con alias nuevos `[apertura]`, `[pedidos]`, `[envio]`, `[mensaje_cerrado]`. Sin la palabra «tanda» en las etiquetas nuevas.
- No integrar en esta tarea el rediseño completo de HTML a Liquid ni alterar tarifas, catálogo, conservación o pagos.

## Review Focus

- Fecha vacía y estado no configurado: cerrado, sin valores de ejemplo ni etiquetas incompletas.
- Apertura informativa y cierre exacto heredado: no confundirlos con programación o bloqueo real de checkout.
- Valores con HTML: mostrar texto escapado, sin permitir inyección.
- Mensaje cerrado: un valor compartido en anuncios, portada, producto y carrito.
- Compatibilidad: ajustes existentes y textos con placeholders antiguos siguen funcionando cuando hay datos.

## Task 1: Ajustes y consumidores Liquid

**Files:** `config/settings_schema.json`, campos `ds_batch_*` de `config/settings_data.json`, snippets `ds-batch-state`, `ds-batch-text`, `ds-order-dates`, `ds-product-batch`, `ds-cart-batch`; secciones `ds-batch`, `ds-announcement`, `ds-collection-hero`; mensajes de `sections/header-group.json`; pruebas y manual de pedidos.

- [x] Escribir pruebas de renderizado de Liquid y verificar fallos del estado inicial y de las fechas pendientes.
- [x] Adaptar ajustes y datos locales iniciales; conservar IDs. Separar visualmente las opciones avanzadas y de productos de los campos principales.
- [x] Conectar fechas y mensaje compartidos, con supresión de datos pendientes y escape.
- [x] Ejecutar pruebas, `node tests/check-theme.mjs` y Theme Check si se dispone de la herramienta.
- [x] Generar muestras desde el Liquid real y revisarlas en navegador desktop/mobile; distinguirlas de una prueba del editor Shopify.
- [x] Guardar manual y resultados reales. Revisión independiente de los cambios de estado y consumidores.

## Ejecución autorizada

El «me parece bien» aprueba los campos y el enfoque nativo presentados en conversación. No se vuelve a pedir autorización para este trabajo local. Las pruebas no requieren publicación ni acceso al admin. El editor Shopify y el checkout reales quedan sin verificar hasta disponer de un tema de prueba autorizado.

## Resultado de ejecución

20 pruebas de renderizado aprobadas. Comprobación del tema: 37 JS, 67 JSON, 52 esquemas válidos. Sin cambios CSS ni nuevas dependencias de ejecución. Se incluyó `sections/ds-faq.liquid` para corregir una regresión de respuestas vacías que la revisión independiente detectó por la supresión de valores pendientes; prueba RED y GREEN documentada. También se cubrió y corrigió el mensaje fijo del contador.

La muestra local se generó desde los ajustes y Liquid reales. La revisión visual se completó en la continuación mediante Orca, en escritorio y móvil. La CLI oficial 5.0.0 ejecutó Theme Check sobre los archivos de tema preparados: 0 errores y 8 advertencias. Se generó un ZIP de prueba y se comprobó que contiene pedidos cerrados y fechas vacías.

Tras la autorización de la CLI, se creó y verificó el tema sin publicar `189776789808`. Las fechas temporales se reflejaron en portada, producto y colección en Shopify real; después se restauraron pedidos cerrados y fechas vacías y se descargó de nuevo la configuración para comprobarlo. Se verificó que el tema en vivo `188534653232` no cambió.

La prueba real detectó el aviso oculto en carrito vacío: se añadieron invocaciones en `snippets/cart-drawer.liquid` y `sections/main-cart-items.liquid`. La revisión independiente detectó además la actualización AJAX del último artículo: el aviso se prerenderiza ahora con `empty_notice: true`. Nuevas pruebas RED/GREEN, sin cambios a JavaScript, checkout, stock ni pagos. Aviso visible comprobado en el drawer real.

Milton completó el acceso en la pestaña del espacio de trabajo principal. Se revisaron los campos del editor y se guardó una apertura de prueba con su botón Guardar; una descarga confirmó la persistencia. Se borró el ejemplo y se guardó de nuevo desde el editor. La descarga final confirmó pedidos cerrados y todos los campos de fecha vacíos. La vista previa incrustada quedó en blanco en esa sesión; la comprobación visual de la tienda corresponde a las rutas directas previamente revisadas. Manual, reporte y evidencia: `docs/pedidos-envios.md`, `docs/pedidos-envios-qa.md` y `docs/pedidos-envios-editor-verified.json`. Esta tarea de controles y validación del tema sin publicar queda completada; la integración del rediseño HTML sigue fuera de su alcance.
