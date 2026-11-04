# Avisos de la pastelera — validación local

Implementación aislada posterior a 4034149; no publicada ni enviada a clientes. Maqueta aprobada por el usuario, destinatario confirmado y confirmación de propuesta corregida.

- Pruebas de servicio: autorización HTTP, aislamiento por tienda, comentarios invitados, transacciones parciales/finales, duplicados, reinicio durable, reintentos y envío incierto.
- Revisión independiente: corregida pérdida de aviso tras reconciliación incompleta. Los pagos previos se guardan en una base de exclusión; los nuevos esperan un saldo fiable y se deduplican por transacción.
- Chromium local en desktop (1280 px) y móvil (390 px): bandeja, lectura, abrir solicitud, borrador y foco durante actualización automática, confirmación visible al enviar propuesta, además de fotos y modalidades anteriores. Sin errores de ejecución ni desbordamiento horizontal.
- check-theme aprobado: 42 JS, 69 JSON, 57 esquemas. Wrangler dry-run aprobado: sin cambios de secretos, configuración o permisos.
- Correos probados con transporte simulado, incluido HTML y botón autenticado. No se enviaron correos reales ni se realizaron cargos.

El enlace utiliza el Client ID según la construcción oficial de URL embebida de Shopify: https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/lib/auth/get-embedded-app-url.ts . La apertura autenticada desde un correo real queda para la comprobación posterior al despliegue autorizado.
