# Seguimiento de celebraciones — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Ejecución en esta sesión, sin delegación automática.

**Goal:** Llevar el seguimiento aprobado al tema Shopify, conservando la jerarquía visual y conectándolo posteriormente a un servicio autenticado.

**Architecture:** Liquid proporciona la estructura; CSS y JavaScript vanilla presentan el estado recibido del servidor. El tema no decide precios, pagos ni permisos. Esta fase produce una interfaz comprobable mediante datos de prueba; activar la conexión real depende del servicio de cotizaciones.

**Tech Stack:** Dawn 16.0.0, Liquid, CSS, JavaScript vanilla y pruebas Node existentes. Sin React, Tailwind ni build.

**Spec:** `docs/contexto-recuperado-2026-11-03.md`; referencia visual `docs/maquetas-celebraciones/celebraciones-recorrido.html`. El usuario aprobó expresamente el seguimiento reorganizado con «me gusta».

**Estado de ejecución:** contrato e interfaz local implementados; pruebas de cliente realizadas. Ver `2026-11-03-seguimiento-ejecucion.md` para resultados y decisiones. Conexión autenticada y verificaciones de servidor/remotas pendientes; el plan completo no se declara terminado.

## Global Constraints

- Textos en español y prefijo `ds-`; no cambiar el tema activo ni el admin de Shopify.
- Sin push, despliegue ni publicación salvo pedido explícito del usuario.
- Mantener cambios ajenos; verificar el estado de los archivos antes de editar.
- La maqueta no es un sistema real de reservas, mensajes ni pagos.
- Orden aprobado: estado y recogida; total, anticipo y saldo; ajuste pendiente; diseño acordado; comentarios; historial plegado.
- La aceptación precede a aplicar el nuevo precio. El anticipo realmente recibido permanece intacto.
- No cobros ni reembolsos automáticos. Diferencias a favor requieren resolución de la pastelera.
- Comentarios y solicitudes de cambio disponibles hasta que el pastel esté listo; la pastelera determina viabilidad y precio.
- `prefers-reduced-motion`, teclado, desktop y mobile.

## Review Focus

- Otro cliente no debe poder leer una cotización cambiando su identificador: corresponde a autorización del servicio, nunca al tema.
- Una propuesta sustituida no debe aceptarse mediante una pantalla antigua: enviar versión y responder con conflicto.
- Un doble clic no debe crear dos aceptaciones o comentarios: bloquear envío pendiente e identificar la operación en el servicio.
- Una reducción por debajo del anticipo no debe mostrar un saldo negativo como pago exigible.
- Textos del cliente o la pastelera deben mostrarse como texto, sin ejecutar HTML.

## Alcance y dependencia

Este plan cubre solamente el seguimiento del cliente. Solicitud, panel de la pastelera, almacenamiento de imágenes, identidad, cupos y pagos requieren planes propios. La infraestructura propuesta anteriormente no se considera contratada ni configurada. Antes de activar pagos o un endpoint se deben validar las capacidades vigentes de Shopify y la infraestructura disponible. No sustituir esta dependencia con localStorage o datos inventados en la tienda.

### Tarea 1: Contrato y estados del seguimiento

**Files:** crear `docs/contratos/seguimiento-celebraciones.md`.

**Interfaces:** `TrackingSnapshot` contiene `id`, `version`, `status`, `pickup`, `acceptedProposal`, `pendingProposal`, `payments`, `comments`, `history`, `permissions`. Importes en centavos USD enteros; versiones inmutables. Propuestas contienen descripción viable, diferencias, respuesta final, presentación total/desglose y recargo explícito. Pagos provienen de registros confirmados del servicio.

- [ ] Documentar los estados solicitud recibida, cotización disponible, reserva confirmada, en preparación y listo, con sus acciones permitidas por el servidor.
- [ ] Especificar `getTracking(id)`, `postComment(id, text, operationId)` y `acceptProposal(id, proposalVersion, operationId)`; cada mutación devuelve un snapshot autorizado nuevo. Errores: sesión requerida, no encontrado, conflicto de versión, validación y servicio no disponible.
- [ ] Definir escenarios de contrato: acceso ajeno denegado, propuesta sustituida rechazada, repetición idempotente y comentarios bloqueados al estar listo. Estas garantías son obligatorias para el servicio; una prueba de interfaz no las demuestra.

### Tarea 2: Pantalla del seguimiento

**Files:** crear `sections/ds-celebracion-seguimiento.liquid`, `assets/ds-celebracion-seguimiento.css`, `assets/ds-celebracion-seguimiento.js` y `templates/page.celebracion-seguimiento.json`.

**Interfaces:** `mountTracking(root, service)` consume el contrato de la tarea 1. El servicio se inyecta en el entorno local de pruebas; no incluir datos de Sofía ni controles para cambiar a pastelera en la página de producción.

- [ ] Crear estructura Liquid con carga, sesión requerida, error recuperable y contenido; no mostrar importes ficticios durante la carga.
- [ ] Trasladar únicamente el seguimiento aprobado: reserva/pagos, ajuste pendiente destacado, lo solicitado/viable/diferente, respuesta final, conversación e historial plegado.
- [ ] Implementar renderizado con `textContent`, campos etiquetados, estados de envío y mensajes accesibles. El precio vigente solo cambia con el snapshot confirmado tras la aceptación.
- [ ] Calcular presentación del saldo con enteros: total17000 y recibido9000 muestran8000; total7000 y recibido9000 muestran diferencia a favor2000, sin acción de cobro de esa diferencia.
- [ ] Comprobar la pantalla local a 390 y 1024 px, además de ausencia de desbordamiento a320. Conservar el orden semántico al apilar.

### Tarea 3: Verificación de comportamiento y preparación de conexión

**Files:** crear `tests/celebracion-seguimiento.test.mjs` y un fixture local bajo `docs/maquetas-celebraciones/qa/`; actualizar `docs/maquetas-celebraciones/qa/verificacion-recorrido.md`.

**Interfaces:** servicio simulado de `mountTracking` que devuelve snapshots del contrato y permite demorar o rechazar mutaciones. No se distribuye con el tema.

- [ ] Probar saldo17000−9000=8000, precio sin cambio, diferencia a favor, propuesta pendiente sin alterar total y rechazo por versión antigua manteniendo la propuesta vigente.
- [ ] Probar error al enviar sin perder el borrador, doble clic con una sola llamada, texto con etiquetas mostrado literalmente y estado listo sin nuevas solicitudes de ajuste.
- [ ] Ejecutar `node --test tests/celebracion-seguimiento.test.mjs` y `node tests/check-theme.mjs`; registrar resultados reales. Ejecutar Theme Check si está disponible.
- [ ] Revisar visualmente desktop/mobile y teclado. Documentar separadamente lo probado con fixture y lo pendiente contra el servicio real.
- [ ] Antes de conectar: identificar servicio y método de sesión reales, verificar autorización, idempotencia y concurrencia del lado servidor. No habilitar acciones financieras mientras estos controles no estén comprobados.

## Entrega y publicación

La entrega local es revisable sin publicar. Una prueba en tema remoto sin publicar requiere pedido explícito según AGENTS.md; ningún paso de este plan autoriza push a main. La funcionalidad completa solo podrá declararse operativa después de pruebas integradas del servicio, identidad, mensajes y pagos.
