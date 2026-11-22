# Modalidades de pago — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** La pastelera elige anticipo 60 %, pago completo anticipado o pago completo contra entrega por cotización.
**Architecture:** Persistir `paymentMode` (`deposit`, `full`, `delivery`) en cada propuesta. Los datos anteriores conservan el modo derivado de urgencia; los cobros Shopify ya iniciados conservan su importe y representación. Contra entrega reserva al aceptar y mantiene deuda hasta registro explícito de la pastelera, sin simular confirmación de Shopify.
**Tech Stack:** Liquid, JavaScript vanilla, servicio Node/Cloudflare y SQLite existentes.
**Spec:** Maqueta `docs/maquetas-celebraciones/eleccion-pago.html`, aprobada por el usuario el 2026-11-04, incluidas las tres opciones y reserva al aceptar contra entrega.

## Global Constraints
- Sin push, despliegue, cambios de credenciales ni configuración global.
- Conservar cambios ajenos del workspace. Sin commits.
- Opciones disponibles también para urgentes; defaults normal=deposit, urgente=full.
- Solo staff elige condiciones y registra pagos contra entrega. Cliente solo acepta la propuesta vigente.
- Modalidad bloqueada después de iniciar checkout o aceptar contra entrega. Cambios de precio conservan pagos; no reembolsos automáticos.

## Review Focus
- Enlaces antiguos: no permitir cambio de modalidad después de iniciar pago (store y tests).
- Propuestas antiguas: conservar defaults y títulos Shopify, sin migración destructiva (payment-service tests).
- Contra entrega: reserva sin afirmar pago y permite listo antes del cobro (store/HTTP tests).
- Doble clic, reintento y precio cambiado: registro idempotente por versión, importe calculado en servidor (store/HTTP tests).
- Cliente o staff no autorizado: no pueden registrar cobro ni cambiar modo mediante payload (HTTP tests).

### Task 1: Contrato y cobro
- [x] Añadir pruebas de modo, compatibilidad, autorización, bloqueo y registro contra entrega en `services/celebraciones/test/payment-options.test.mjs`.
- [x] Modificar `src/store-core.mjs`: normalizar modo, publicarlo, aceptar/reservar contra entrega, guardar historial, bloquear cambios en cobros iniciados; `recordDeliveryPayment(actor,id,proposalVersion,operationId)` registra saldo recibido con fuente staff y fecha.
- [x] Modificar `src/payment-service.mjs`: crear cobro 100 % según modo explícito usando el adaptador existente; contra entrega nunca crea checkout. Conservar estado financiero antiguo.
- [x] Modificar `src/http.mjs`: ruta admin para cobro contra entrega; listo permite contra entrega pendiente sin reconciliación Shopify.
- [x] Ejecutar pruebas del servicio.

### Task 2: Panel y seguimiento
- [x] `src/admin-page.mjs` y `src/admin-ui.js`: selector aprobado, preview de importes, modo en propuestas, bloqueo visible y registro explícito de recibido contra entrega.
- [x] `assets/ds-celebracion-seguimiento.js`: mostrar condiciones antes de aceptar y después, etiquetas de cobro correctas, sin enlace online contra entrega ni falsa confirmación Shopify.
- [x] Ajustar textos de solicitud/seguimiento y guía para condiciones elegidas por pastelera.
- [x] Pruebas UI/controller y vista local desktop/mobile con fixtures, sin datos privados.

### Task 3: Verificación
- [x] `node --test services/celebraciones/test/*.test.mjs`, pruebas de tracking, `node tests/check-theme.mjs`; Theme Check si CLI disponible.
- [x] Revisión independiente del cambio sensible según `docs/orquestacion.md`; corregir hallazgos y repetir pruebas afectadas.
- [x] Informar resultados reales y limitaciones, sin publicar.

## Alcance añadido y cierre
- A petición del usuario, fotos de referencia ampliables en móvil/PC, con zoom, cierre y retorno del foco.
- Evidencia y límites: docs/maquetas-celebraciones/qa/payment-options/validacion.md.
