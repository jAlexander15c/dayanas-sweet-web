# Cotización invitada Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Solicitar cotización sin cuenta y recibir número y acceso privado en web y correo.
**Architecture:** Canal guest separado, capability por solicitud, numeración transaccional y outbox durable de correo. Mantener intacto el canal autenticado y reutilizar pagos Shopify verificando relación draft/pedido.
**Tech Stack:** Liquid, JavaScript vanilla, Cloudflare Worker y SQLite Durable Objects, Shopify Admin API2026-10, Hostinger SMTP/TLS.
**Spec:** docs/contratos/cotizacion-invitados.md (maqueta aprobada el 2026-11-03).

## Global Constraints

- Español, sin nueva suscripción de pago; no cambiar configuración global Shopify ni nameservers.
- No publicar antes de maqueta aprobada, correo configurado y prueba QA.
- No registrar capabilities, correos completos ni credenciales en logs.
- Usar worktree aislado desde main0c8840f o más reciente; no tocar inventario/toppings.

## Review Focus

- Acceso por enlace filtrado, referencia adivinada o correo de otra persona: no concede solicitudes ajenas.
- Respuesta perdida tras crear solicitud o aceptar correo: mismo número, sin duplicar envío.
- Fallo de correo después del guardado: acceso web disponible, estado honesto y reintento limitado.
- Pedido de otra identidad o cambios concurrentes de pago: no acreditar ni duplicar dinero.
- Migración y reinicio del Worker: autenticados anteriores y jobs pendientes siguen funcionando.

## Tasks

### 1. Contrato y preparación
- [x] Aprobar maqueta y Hostinger; abrir worktree guest separado desde 0c8840f.
- [x] Confirmar presencia de SMTP_PASSWORD y remitente info@dayanassweet.com; guest permanece desactivado.
- [ ] Configurar GUEST_ACCESS_KEY y verificar autenticación/entrega real SMTP cuando se autorice puesta en marcha.

### 2. Identidad y numeración
Files: src/shopify-auth.mjs, src/http.mjs, src/store-core.mjs, nuevo src/guest-access.mjs y tests correspondientes.
- [x] Tests de firma anónima sólo en guest, número idempotente, hashes y aislamiento. Sin vencimiento automático; revocación mediante revoked_at, sin autoservicio.
- [x] Migración aditiva de dueño guest, referencias y token hash; no alterar customer_id de registros existentes.
- [x] Endpoints POST guest para creación y lectura/acciones con capability, origen validado y límites de abuso.
- [x] Validar reinicio, rollback y replay concurrente con SQLite y adaptador Durable Object.

### 3. Correo durable
Files: nuevo src/quote-email.mjs y test/quote-email.test.mjs; store-core, cloudflare-worker y scheduler.
- [x] Tests de contenido MIME seguro, destinatario, timeout ambiguo y cifrado del acceso pendiente.
- [x] Outbox atómico con solicitud, SMTP con Message-ID estable y backoff limitado solo ante fallo inequívoco. Respuesta ambigua o claim abandonado: unknown sin reenvío.
- [x] Estado sent significa aceptado por servidor, no entrega garantizada; UI comunica errores sin borrar solicitud.

### 4. Pagos invitado
Files: src/shopify-payments.mjs, src/payment-service.mjs y sus tests.
- [x] Tests de draft sin purchasingEntity, correlación del pedido por draft persistido y rechazo de suplantación por correo.
- [x] Mantener ledger, ajustes/descuentos, reapertura y controles de pagos existentes.
- [x] Preflight y recorrido QA invitado sin acceso obligatorio a cuenta; checkout USD60 abierto, sin cobros reales.

### 5. Interfaz y despliegue
Files: sections/ds-celebracion-solicitud.liquid, seguimiento.liquid; assets de solicitud/seguimiento/transporte y tests.
- [x] Añadir contacto guest, confirmación con número/enlace y estado del correo según maqueta.
- [x] Capability en fragmento: captura privada, limpieza de URL visible y transporte POST; fotos mediante lectura autorizada.
- [x] Vista local Liquid+backend desktop/móvil, check-theme y suite completa de autenticados+guest.
- [x] Vista previa Shopify QA 189886300464 y Theme Check oficial: 0 errores, 8 advertencias existentes.
- [ ] Prueba real de correo a destinatario autorizado, publicación autorizada y checkpoint de versiones/resultados.

## Ejecución y decisiones
Maqueta aprobada. Worktree cotizacion-invitados desde 0c8840f. Backend y UI implementados por tareas acotadas; coordinación integra SMTP, alarmas y revisión independiente. Servidor desplegado con Resend y guest=true; publicaci?n autorizada por usuario, ver cierre de QA. Evidencias y pendientes: docs/qa-cotizacion-invitados/VALIDACION.md.

Ruling: cinco altas/hora por destinatario normalizado en lugar de IP del peer, que Shopify puede compartir entre clientes. Se conserva cien/día globales y replay sin consumir cuota. No confiar en X-Forwarded-For para autorización o cuota.
