# Puesta en marcha de Celebraciones

## Copia preparada

Rama `codex/celebraciones-release`, basada en `origin/main` cb036d9. Incluye exclusivamente Celebraciones y su acceso desde «Cómo pedir». Los cambios ajenos de la carpeta original no forman parte de esta entrega.

Tema de prueba: `189886300464`, sin publicar. Las dos plantillas están habilitadas en esta copia. El acceso desde «Cómo pedir» aparece cuando la página de solicitud sea visible. El servicio continúa en TEST, limitado a la cuenta piloto.

## Comprobaciones realizadas

- 272 pruebas integradas correctas, incluidas recuperación de pagos simultáneos, aumentos y reducciones.
- `check-theme`: 41 JavaScript, 69 JSON y 57 esquemas válidos.
- Shopify Theme Check: cero errores, ocho advertencias preexistentes.
- Formulario y seguimiento revisados visualmente en escritorio y móvil390.
- Pedidos ficticios #1001 y #1002: anticipo y saldo cobrados en Shopify; desarchivo automático del segundo. Shopify Payments restaurado a pagos reales.
- Ajustes del segundo pedido100→110→120→115→110 conservaron100 recibidos. Shopify rechazó el checkout antiguo de15, actualizó a10 y confirmó únicamente ese pago ficticio. Resultado final110/110/0 y Listo para recoger. Shopify Payments restauradoOFF.

## Orden de publicación pendiente

1. Validación terminada. Worker QA7ba55987-b2e9-422e-a8e7-9e433f724b66 sigue TEST/allowlist. Esta copia tiene wrangler.jsonc preparado para REAL y sin allowlist; NO desplegarla hasta la autorización de publicación.
2. Último fetch confirmó main en cb036d9. Revalidarlo si transcurre tiempo antes de publicar. No reemplazar archivos del trabajo de inventario ni del selector de toppings.
3. Obtener autorización explícita para este push a main, conforme a AGENTS.md; todavía no se ha hecho ningún push.
4. Publicar la copia probada mediante el flujo GitHub del tema. Conservar preparación y archivo automáticos de Shopify.
5. Asignar las plantillas a las páginas ya creadas, sin duplicarlas: Pasteles personalizados163671245104 → celebracion-solicitud; Seguimiento de tu pastel163671343408 → celebracion-seguimiento. Hacerlas visibles.
6. Desplegar el servicio en REAL y habilitar el acceso normal; Shopify Payments debe seguir con test desactivado. No cobrar tarjetas reales como prueba.
7. Verificar enlaces de acceso y de seguimiento, inicio de sesión, disponibilidad de agenda y panel. Registrar versiones y resultados en el checkpoint.

Los pedidos técnicos están marcados NO ELABORAR. No repetir sus cobros ni considerar los importes ficticios ingresos reales. El servicio no emite reembolsos automáticos.
