# Panel /inventarios: revisión, integraciones y plan

2026-11-05 · Coordinador: Claude · Revisión técnica: Codex (`CODEX.md`, 63 capturas) · Base main d94bb38

> **Archivo (2026-11-22).** Este plan ya se ejecutó: la fase 1 (R01, R02, R03, R04 y R09) está en main desde `2bcfee2`, y Pedidos (I2b) desde `165e188`. Aquí se guardan solo el informe, la revisión de Codex y el contrato. Las capturas, los logs y el arnés de pruebas quedaron en la rama local `codex/panel-revision`.

## Resumen

1. El panel funciona: productos, existencias, fotos, categorías, personal y Celebraciones. Pasan Inventario 263/263, Celebraciones 347/347 y siete recorridos en navegador a 390 y 1440 px.
2. Hay **4 fallos reproducidos**, todos de arreglo acotado. El más importante (R01): después de guardar la producción, si falla la recarga, se sigue viendo el stock viejo junto a "Guardado".
3. **Falta el lado de los pedidos.** Dayana maneja el inventario aquí, pero prepara, despacha, cobra y reembolsa desde el admin de Shopify.
4. La app de Celebraciones ya tiene permisos de pedidos (`read_orders`, `write_orders`, `write_order_edits`; ver `CODEX.md`, inventario de funciones). Los pedidos pueden llegar al panel a través de ella, sin reautorizar la app de Inventario con esos permisos.

## A. Arreglos (hallazgos de Codex, verificados por el coordinador)

| ID | Qué pasa | Severidad | Esfuerzo | Verificación del coordinador |
|---|---|---|---|---|
| R01 | Guardado correcto y recarga fallida → se sigue mostrando el stock anterior | Alta | S | `services/inventario/src/admin-ui.js:306`: el error se descarta con un `catch` vacío ✔ |
| R02 | La sesión caduca con un diálogo abierto → el diálogo queda encima de la pantalla de entrada | Media | S | Reproducido por Codex (captura) |
| R03 | Un producto cuyo nombre tiene entre 201 y 255 caracteres no se puede editar | Media | S | `validation.mjs:71` aplica el límite de 200 antes de conservar el nombre existente (255) ✔ |
| R04 | La entrada se queda esperando sin límite si la red se cuelga | Media | M | Reproducido 22 s; sin `AbortSignal` en `staff-ui.js` |
| R05 | Los bordes de los campos vacíos casi no se ven (1,45-1,50:1) | Media | S | Medido. Cambia la apariencia: maqueta antes |
| R06 | Registros de errores desactivados en los dos Workers | Media | M | `wrangler.jsonc`: `observability.enabled: false` ✔ |
| R07 | Contraseñas del personal con PBKDF2 a 100.000 iteraciones | Media | M | **Corrección:** Workers no permite más de 100.000 iteraciones de PBKDF2, así que no se puede subir a 600.000. La salida es otro algoritmo (scrypt de `node:crypto` o Argon2 en WASM), midiendo la CPU, con migración gradual al entrar. |
| R08 | Celebraciones dentro del panel: dos barras de desplazamiento y pantalla muy larga en el celular | Baja | M | Medido. Necesita maqueta |
| R09 | Dos controles secundarios de 29-30 px | Baja | S | Medido |
| R10 | El historial muestra solo los últimos 100, con detalle técnico | Baja | M | Estático |
| R11 | Los borradores de Celebraciones se pierden al recargar | Baja | M | Estático |

## B. Integraciones nuevas (catálogo del coordinador)

| # | Integración | Valor | Esfuerzo | Costo | Depende de |
|---|---|---|---|---|---|
| I1 | **Pedidos de la tanda**: lista de producción por producto, hoja de empaque, retiro o envío | Muy alto | M | 0 | Permisos de pedidos (vía Celebraciones o reautorizando) |
| I2 | **Marcar despachado (con seguimiento) o listo para retirar**, con el aviso nativo de Shopify | Muy alto | M | 0 | Permiso de despacho |
| I2b | **Reembolsos, cancelaciones y edición de pedidos** | Alto | M-L | 0 | Solo rol administrador, volver a pedir la contraseña, revisión antes de confirmar, tope según Shopify, clave contra el doble clic, historial |
| I2c | **Marcar pagado en efectivo** (`orderMarkAsPaid`) | Alto | S | 0 | Dayana activa "Efectivo al retirar" en Ajustes > Pagos; unificar con "Pago contra entrega" de Celebraciones |
| I3 | **Cerrar tanda en un paso** (stock 0 en bloque) y fechas de tanda editables | Alto | M | 0 | Hoy no existe ninguna acción de cierre (confirmado por Codex) |
| I4 | Resumen por tanda (ventas, cajas, más pedidos) | Medio | S-M | 0 | I1 |
| I5 | Shopify Email: "abrimos pedidos" a los suscriptores de la portada | Alto | S | 0 hasta la cuota gratuita | Sin código |
| I6 | Shopify Flow: alertas de stock bajo, etiquetas y recordatorios | Medio | S | 0 | Verificar el plan |
| I7 | Agenda de Celebraciones en Google Calendar (enlace ICS privado) | Medio | S | 0 | — |
| I8 | Canal de Facebook e Instagram | Medio | S | 0 | Cuenta de Meta Business |
| I9 | Google Merchant Center y Business Profile | Medio | S | 0 | Datos de Dayana |
| I10 | Avisos por WhatsApp | Medio | M-L | por mensaje | Meta o Twilio, plantillas |
| I11 | Etiquetas USPS desde el panel | Bajo por ahora | L | por etiqueta | EasyPost o Shippo; la API de Admin no compra etiquetas de Shopify Shipping |
| I12 | Alertas de errores por correo (junto con R06) | Medio | S | 0 | — |
| I13 | Reseñas de producto | Medio | S | 0 o plan | App |
| I14 | Contabilidad (QuickBooks o Wave) | Bajo | S | plan | App |

## C. Plan propuesto

| Fase | Contenido | Por qué primero |
|---|---|---|
| 1. Arreglos rápidos | R01, R02, R03, R09 (+R04) | Bajo riesgo; R01 evita que Dayana dude de un guardado |
| 2. Pedidos | I1 + I2 + I2b + I2c (+I4) | Es la mayor parte del trabajo de cada tanda; maqueta primero |
| 3. Tanda | I3 | Evita vender stock que no existe |
| 4. Sin código | I5, I6, I12/R06 | Resultado inmediato |
| 5. Endurecimiento | R07, R10, R11, R05, R08 | Con maqueta donde cambia la apariencia |
| 6. Cuentas externas | I7-I11, I13, I14 | Cuando Dayana tenga las cuentas y los datos |

## Decisiones pendientes de Dayana o del usuario
1. Aprobar el orden de las fases.
2. Pedidos en el panel: ¿todas las acciones (despachar, reembolsar, cancelar, editar, cobrar en efectivo) o empezar solo por ver y despachar?
3. Activar "Efectivo al retirar" en Shopify (Ajustes > Pagos).
4. Canal de aviso al cliente: correo de Shopify o WhatsApp.
5. Las fases 2, 3, 5 (R05, R08) cambian la interfaz: maqueta antes de construir.

## Límites de esta revisión
Sin Safari ni iPhone físico, sin lector de pantalla y sin probar la red real ni las cabeceras del proxy de Shopify. La integración visual con Celebraciones se probó con una API sintética. Ver `CODEX.md`, sección "Base, método y límites".
