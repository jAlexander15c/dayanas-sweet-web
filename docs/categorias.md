# Categorías automáticas

La portada activa (`templates/index.json`, sección `redesign`) y `/collections`
usan `snippets/ds-category-grid.liquid` y `assets/ds-categories.css`.
No se necesita añadir un bloque por cada categoría del panel.

## Contrato con el panel

Una categoría es una colección manual publicada en la Tienda online. Sus
metafields de colección, con lectura en storefront, son:

| Metafield | Tipo | Uso |
| --- | --- | --- |
| `ds.categoria` | boolean | Debe valer `true`. |
| `ds.en_inicio` | boolean | Debe valer `true` en ambas páginas. |
| `ds.orden` | number_integer | Ascendente: 1, 2, 3…; empate por título. |

Las colecciones sin ambas banderas verdaderas no se muestran. Los órdenes se
convierten a claves de 20 posiciones; un rango de título natural, sin distinguir
mayúsculas, resuelve empates. Un orden ausente se coloca al final
(`9999999999`). El panel debe utilizar enteros positivos.

La imagen sale de `collection.image` y conserva su descripción alternativa.
Si el alt coincide exactamente con el nombre, se deja vacío para evitar
repeticiones. Sin imagen se muestra un fondo rosa de marca y el nombre, sin
fotografías de otros productos. El nombre accesible del único enlace es siempre
el título de la categoría, sin añadir el contador o el alt de la foto.

Si ninguna colección consultada tiene ninguno de estos tres metafields, se
activan los bloques manuales existentes. Ambas secciones admiten hasta 12;
`/collections` parte de los mismos dos bloques actuales de portada. Estos bloques
de respaldo se editan por sección y no se sincronizan entre editores. En cuanto
existe configuración de metafields, ocultar todas las categorías deja la lista
vacía y no reactiva los bloques.

## Ajustes del editor

En portada, editar «Título del menú»; en `/collections`, «Título». Ambas secciones
ofrecen «Mostrar contador de productos» y «Ocultar categorías sin productos
disponibles», desactivados inicialmente. El contador indica el total de productos
de la colección, incluidos agotados. Ocultar vacías comprueba `product.available`,
por lo que también oculta colecciones con todos sus productos agotados.

## Distribución y accesibilidad

| Categorías | Escritorio (≥990 px) | Tableta (601–989 px) | Móvil (≤600 px) |
| --- | --- | --- | --- |
| 1 | Una tarjeta de ancho completo | Una tarjeta de ancho completo | Una columna |
| 2 | Dos columnas | Dos columnas | Una columna |
| 3 | Tres columnas | Dos columnas; última en la siguiente fila | Una columna |
| 5 | Tres columnas; dos en la siguiente fila | Dos columnas; última en la tercera fila | Una columna |

Entre 6 y 12 continúa la misma grilla. Las columnas usan `minmax(0, 1fr)` y los
nombres largos pueden partirse, evitando que el contenido ensanche la grilla a
360 px. Las tarjetas mantienen las dimensiones grandes y esquinas redondeadas
del diseño actual. El texto blanco aparece sobre una franja opaca `#3a2430`
(contraste superior a 14:1), independiente de la foto. Hay lista `ul/li`, foco
visible, enlaces de al menos 44 px y desactivación del movimiento al solicitarlo
el sistema.

## Cómo probar

```powershell
node tests/check-theme.mjs
node --test tests/categories.test.mjs
```

La segunda prueba hace análisis estático y renderiza el snippet real con LiquidJS
si está disponible. Puede instalarse fuera del repositorio, sin cambiar paquetes
del tema:

```powershell
npm install --prefix "$env:TEMP/ds-category-liquid-tests" liquidjs --no-save --package-lock=false
node --test tests/categories.test.mjs
```

Sin LiquidJS se indican explícitamente los casos de render omitidos. Para el
render local solo se sustituyen el envoltorio Shopify `paginate` por una página
de fixture y los filtros Shopify de imagen/traducción; los filtros de categorías,
ordenación, bloques y markup ejecutan el Liquid original.

En la vista previa de Shopify, crear desde el panel 1, 2, 3 y 5 categorías
publicadas, incluyendo Enlatados; comprobar ambas rutas a 1440, 768 y 360 px.
Cambiar órdenes (2 y 10), empatar dos títulos, quitar una imagen, cambiar
`ds.en_inicio`, probar categorías vacías y agotadas, activar ambos ajustes y
recorrer las tarjetas con Tab. Con metadatos ausentes, comprobar los bloques
Galletas/Brownies y añadir un tercer bloque. Con categorías configuradas pero
ocultas, comprobar que no vuelven los bloques manuales.

## Límites de verificación y de Liquid

No se modifican datos, no se hace theme push y no se publica el tema. Las
distribuciones anteriores describen el CSS y los renders de fixture; falta la
comprobación visual del storefront con datos reales. La CLI de Shopify no estaba
disponible en este entorno para Theme Check o una vista previa del tema.

Se usa la paginación nativa de colecciones, 250 por página, con enlaces cuando
hay más; los filtros y la ordenación operan sobre la página actual. Para tiendas
con más de 250 colecciones, esto no garantiza orden global por metafield ni
respaldo global entre páginas; la tienda contemplada de 1–12 categorías debe
validar también su total de colecciones. La comprobación opcional de disponibilidad
opera sobre los productos que Shopify expone en `collection.products` (hasta 50
sin paginar productos): si los primeros 50 están agotados y hay disponibilidad
solo después, puede ocultar esa colección. Dejar ese ajuste apagado evita esa
limitación; resolverlo para catálogos mayores requiere un indicador de
disponibilidad calculado por el panel o ampliar la fuente de datos.
