# Backend de celebraciones — ejecución y límites

El usuario pidió conectar el servicio real después de implementar la interfaz. Se inspeccionaron herramientas conectadas, archivos de configuración y ejecutables locales: no se detectó conector Shopify/Cloudflare, app, variables de proyecto ni CLI Shopify/Wrangler. Se solicitó confirmar si existen cuentas/app sin pedir claves; la respuesta sigue pendiente.

## Trabajo realizado

- `services/celebraciones/src/store.mjs`: SQLite persistente, identidad por tienda/cliente, comentarios, propuestas, aceptación e idempotencia en transacciones. El precio/versionado lo determina servidor; pagos permanecen inalterados.
- `shopify-auth.mjs`: firmas App Proxy, HMAC webhook y JWT Admin. Sin secretos reales. El verificador webhook está disponible pero no hay endpoint financiero habilitado.
- `http.mjs`: rutas JSON autorizadas, límite32KB, no-store, origen de mutaciones y lista de personal autorizado.
- `server.mjs`: adaptador HTTP Node que exige configuración explícita; escucha localhost. No se inició contra una tienda real.
- `assets/ds-celebracion-servicio.js`: transporte mismo origen, control de errores y tiempo de espera; activación deshabilitada por defecto en Liquid.
- `.shopifyignore`: se añadió `services/**` sin reemplazar las modificaciones previas.

## Decisiones

- La ausencia de infraestructura no justifica inventar una conexión. El almacenamiento local usa Node/SQLite como implementación verificable; no se asume que pueda desplegarse sin cambios en Workers/D1. Si el alojamiento elegido es Cloudflare, adaptar persistencia y transporte antes del despliegue.
- No se implementó cobro real con dos drafts sin resolver las restricciones encontradas. Ver `docs/contratos/pagos-celebraciones-viabilidad.md`, con fuentes oficiales: Plus para depósitos nativos, checkout ya abierto no necesariamente invalidado al cambiar draft, fiscalidad y cupo compartido pendientes.
- No se marcaron reservas como pagadas mediante aceptación del cliente o una acción arbitraria del panel. El servidor impide esa transición sin un subsistema de pagos/cupos.
- Los tokens, claves y cuentas no se solicitaron en texto ni se modificaron. No hay publicación, app instalada, modificación del admin ni llamadas financieras.

## Pruebas

Corrida integrada final: `node --test services/celebraciones/test/*.test.mjs tests/celebracion-seguimiento.test.mjs tests/celebracion-transporte.test.mjs`:96/96. Incluye persistencia tras reapertura, cuatro conexiones concurrentes, aceptación/sustitución simultánea, aislamiento de propietarios, reintentos, firmas inválidas, permisos del personal, rutas HTTP, payloads de pago rechazados y transporte sin precios/identidad del cliente.

La revisión independiente detectó ambigüedad potencial al permitir parámetros arbitrarios en el formato de firma del proxy. Se cerró el conjunto de parámetros admitidos en la API privada, con prueba fallida antes y correcta después del cambio. Coste de compatibilidad: parámetros nuevos de Shopify requieren revisión expresa antes de aceptarse. La revisión del subagente terminó interrumpida por un filtro de la herramienta; no se afirma revisión de seguridad exhaustiva ni aprobación de producción.

`node tests/check-theme.mjs`:39 JS,68 JSON,53 esquemas. Regresiones de navegador existentes:12/12. Node22.14 emite su advertencia experimental de SQLite. Estos resultados no prueban integración remota ni operación en Cloudflare.

## Pendiente real

Confirmación de cuentas y app, método de cuentas de clientes, alojamiento con almacenamiento persistente, secretos configurados de forma segura, proxy HTTPS real, prueba entre usuarios reales de test, límites de abuso, formulario completo/panel conectados, fotos, horarios/cupos, notificaciones y solución de pagos validada. No activar el checkbox del servicio antes de completar la conexión y las verificaciones. Theme Check y vista previa Shopify siguen pendientes por falta de CLI/conexión.
