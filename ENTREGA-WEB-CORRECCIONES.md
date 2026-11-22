# Correcciones listas para el agente Claude «web»

## Solicitud del usuario

> realiza las correciones tu del codigo, utiliza el agente claude, llamado web para subir los cambios ya que tiene permiso

Codex implementó las correcciones en `C:\Users\Milton\orca\dayanas-sweet-web`, sobre `f40d571`. La solicitud de subir estos cambios corresponde al agente «web». No se ha hecho commit, push ni publicación desde Codex.

## Cambios implementados

- Reglas de cantidad recalculadas después de actualizar atributos. El máximo cero se conserva, se informa el límite alcanzado y se impide enviar esa cantidad. Al pasar a una variante sin límite, se limpia el estado anterior del botón de incremento. Las respuestas de reglas pertenecientes a una variante anterior se descartan.
- Errores de conexión visibles tanto en ficha como en tarjeta. El mensaje invita a comprobar el carrito antes de reintentar porque la operación pudo llegar al servidor.
- Feedback asociado al formulario y a la solicitud que lo originaron, incluso con la misma variante en dos tarjetas. Se descartan respuestas anteriores a un reintento.
- El carrito lateral reutiliza las secciones que ya procesa `product-form`, evitando su GET y reemplazo redundantes. Las consultas de refresco pendientes se cancelan al llegar otro cambio o desmontar el componente. Se mantiene el refresco para eventos externos y para la página completa de carrito.
- La colección respeta `quick_add` y `show_secondary_image`. Se retiró de esta sección la modalidad bulk que las tarjetas DS no implementaban y sus recursos asociados.
- Los anuncios repetidos son inertes, incluido el segundo grupo antes de ejecutar JS.
- El riel calcula su estado vacío, flechas y etiquetas sobre los productos realmente mostrados. Las secciones sin productos no cargan el formulario de producto; se retiró CSS de quick-add que no corresponde al marcado DS.
- IDs de contacto vinculados a `section.id`, errores reales del boletín y extensión `.svg` corregida en ambos usos del icono 3D.
- Dos nuevos mensajes de carrito en los 31 idiomas del tema.
- Pruebas locales en `tests/`, excluidas del despliegue mediante `.shopifyignore`.

**Cambio visible deliberado:** la configuración actual de colección contiene `quick_add: "none"` y `show_secondary_image: false`. Ahora se respetan ambos valores: no aparece el botón de compra rápida ni se emite la segunda imagen en esa colección. El enlace principal al producto permanece. Los rieles y temporadas mantienen su compra rápida.

## Validación

```text
node tests/check-theme.mjs
node tests/browser-regressions.mjs
npx.cmd --yes @shopify/cli theme check --path . --output json
git diff --check
```

- Validación estática: 37 JavaScript, 67 JSON y 52 esquemas correctos.
- Chrome headless: 12/12 pruebas de regresión correctas con DOM real y respuestas de Shopify simuladas.
- Las pruebas cubren cambios de reglas, capacidad agotada, recuperación de controles, respuesta de variante anterior, fallos de conexión, respuestas concurrentes, respuestas de reintentos, ausencia de descarga redundante, rechazo de HTML antiguo, refresco de página de carrito, refresco externo del cajón y foco en anuncios repetidos.
- `git diff --check`: sin errores. Git puede mostrar advertencias informativas de conversión LF/CRLF en Windows.
- Theme Check: 0 errores y las mismas 8 advertencias previas, documentadas en la auditoría.

Las pruebas de navegador son aisladas: no representan una compra real ni la vista previa renderizada por Shopify. No se repitió Lighthouse y no se realizó una división general de CSS sin mediciones.

## Entrega y subida

La entrega automática a «web» está pendiente: el intento `orca skills get orca-cli --json` falló porque `orca` no se reconoce como comando en la sesión de Codex. Se pidió al usuario la ruta o el acceso a esa sesión. Este archivo es una entrega preparada, no una confirmación de que Claude lo haya recibido.

Cuando «web» reciba la tarea, revisar el diff y estas pruebas, comprobar las secciones modificadas en la vista previa disponible y subir los cambios por el flujo habitual autorizado por el usuario. Informar commit, destino y resultado. No atribuir una publicación a Shopify si solo se hizo push a Git.
