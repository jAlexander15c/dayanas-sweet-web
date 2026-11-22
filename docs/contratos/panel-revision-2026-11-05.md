# Contrato: revisión del panel /inventarios (Codex)

Fecha: 2026-11-05 · Coordinador: Claude (term_2edeb327) · Implementador: Codex (term_fcea769b)
Worktree: `C:/Users/Milton/orca/workspaces/dayanas-sweet-web/panel-revision` · Rama `codex/panel-revision` (base main d94bb38)

## Objetivo
Revisión **de solo lectura** del panel del personal en `dayanassweet.com/inventarios` (301 → `/apps/inventario`, app proxy → Worker `services/inventario`, con la vista embebida de Celebraciones `services/celebraciones`). Es donde Dayana maneja la web. Queremos saber qué funciona, qué falla, qué le cuesta y qué se puede mejorar.

## Alcance (tú)
1. **Inventario de funciones**: cada pantalla y acción (productos, producción/stock, fotos, categorías, historial, usuarios/roles, invitación, recuperación, cambio de contraseña, Celebraciones). Para cada una: qué hace, qué toca en Shopify (API/scopes) y qué validaciones tiene.
2. **Uso real en celular** (Dayana lo usa desde el teléfono): recorrido en 390 px y 1440 px con el runtime local que ya existe (`test/portal-ui-check.mjs`, `test/ui-check.mjs`; Playwright en `C:/Users/Milton/AppData/Local/Temp/dayanas-guest-qa-20261103/node_modules/playwright`). Fricciones, pasos de más, textos confusos, estados vacíos/error, accesibilidad (44 px, foco, contraste), tiempos.
3. **Errores y riesgos**: bugs, condiciones de carrera con stock/cupos por tanda, manejo de fallos de Shopify o de red, seguridad (sesiones, roles, CSP, entrada del navegador), observabilidad (hoy `observability.enabled: false`).
4. **Deuda técnica** que frena cambios futuros.
5. **Mejoras propuestas**, cada una con: problema que resuelve, evidencia (`ruta:línea` o captura), esfuerzo (S/M/L), riesgo y si necesita datos/decisión de Dayana.

Fuera de alcance (lo hace el coordinador): catálogo de integraciones externas. Si ves un punto de integración natural en el código, anótalo en una línea.

## Reglas
- **Solo lectura del código de producción.** Sin push, sin `wrangler deploy`, sin tocar el admin de Shopify ni datos reales. Sin secretos en el informe.
- Solo escribes en `docs/revision-panel-2026-11-05/` (informe y capturas). Capturas solo del runtime local con datos de prueba.
- Máximo ~2 h de trabajo; prioriza hallazgos de impacto alto. Si algo no se pudo comprobar, dilo.

## Entrega
- `docs/revision-panel-2026-11-05/CODEX.md`: resumen ejecutivo (5 líneas), tabla de hallazgos ordenada por severidad (`ID | severidad | área | evidencia | propuesta | esfuerzo`), inventario de funciones, lista de mejoras.
- Capturas en `docs/revision-panel-2026-11-05/capturas/`.
- Commit local en `codex/panel-revision` y un único `worker_done` con el resumen y comprobaciones reales.

## Criterios de aceptación
- Cada hallazgo tiene evidencia verificable (ruta:línea, salida de prueba o captura).
- Recorrido móvil y escritorio completado, o motivo concreto si no.
- Ninguna escritura fuera de `docs/revision-panel-2026-11-05/` ni acciones en vivo.
