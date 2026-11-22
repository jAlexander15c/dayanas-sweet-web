# Registro — seguimiento de celebraciones

Plan: `2026-11-03-seguimiento-celebraciones.md`.

## Alcance realizado

- Contrato documentado en `docs/contratos/seguimiento-celebraciones.md`.
- Sección Liquid, plantilla, CSS y JavaScript nuevos; no se modificaron archivos de producción preexistentes.
- API `DSTracking.mountTracking(root, service, id)` con servicio inyectado. No hay endpoint, datos ficticios ni conexión automática en el tema. Sin integración, muestra disponibilidad pendiente.
- Fixture separado bajo `docs/maquetas-celebraciones/qa/`, generado con `node tests/render-seguimiento-fixture.mjs`. Sustituye ajustes por defaults; no es un motor Liquid ni una vista previa Shopify.

## Decisiones de ejecución

- Rama `codex/seguimiento-celebraciones`, creada desde main. Se trabajó en el checkout compartido para conservar el contexto y los archivos previos sin copiarlos; no es un worktree aislado. Riesgo: cambios ajenos siguen presentes y cualquier futuro commit debe seleccionar rutas expresamente. No se hizo commit ni push.
- El usuario autorizó subagentes y selección de modelo/esfuerzo. GPT-6.1 Sol medium documentó el contrato; Sol high hizo estructura/CSS y otro Sol high revisó la lógica. Integración y pruebas en la sesión principal.
- Pruebas específicas del controlador antes del código (fallo inicial observado); pruebas DOM del render mediante navegador real. Los controles del servidor quedan pendientes y no se afirman garantizados por el cliente.
- Aceptar una propuesta inicial no se presenta como reserva; el snapshot del servidor conserva el estado real. No se incorpora checkout hasta validar la integración.

## Verificación

- `node --test tests/celebracion-seguimiento.test.mjs`: 9/9.
- `node tests/browser-regressions.mjs`: 12/12 regresiones existentes.
- `node tests/check-theme.mjs`: 38 JS, 68 JSON, 53 esquemas válidos.
- Navegador sobre HTML derivado del Liquid y CSS/JS reales: desglose pendiente, borrador conservado tras error, HTML mostrado como texto, doble clic con una llamada, saldo80 tras total170 y pagos90, cierre al estar listo, sin desbordamiento: 7/7 comprobaciones.
- Capturas inspeccionadas a390 y690 px. A1024 la captura de Orca repite mosaicos (limitación observada previamente); no usarla como evidencia visual de1024. Comprobado sin desbordamiento a320.
- Sin Theme Check: CLI Shopify no disponible. Sin vista previa del tema remoto ni integración real.

## Revisión independiente y correcciones

Se corrigieron los tres hallazgos: clave de reintento conservada por operación aunque haya otras acciones intermedias; rechazo de pagos con identificadores duplicados; desglose de la propuesta pendiente visible antes de aceptar. Los dos primeros se reprodujeron con tests fallidos y luego verdes; el tercero falló y pasó en navegador. Sin hallazgos diferidos de esa revisión.

## Pendiente para funcionamiento real

Servicio autenticado, autorización por solicitud, idempotencia duradera, concurrencia, almacenamiento de comentarios/fotos, integración Shopify de pagos/cupos y flujo de inicio de sesión. La interfaz local no demuestra esas garantías. Requieren inspección y validación del entorno disponible antes de implementarse o activarse. Publicación y pruebas remotas siguen sujetas a las reglas de AGENTS.md.
