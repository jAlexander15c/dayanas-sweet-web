# Publicación de la opción 1 mediante GitHub

Milton autorizó expresamente el commit, el push a `main` y la activación del tema conectado a GitHub después de revisar la propuesta y su vista previa.

La entrega contiene los 411 archivos del tema probado, incluidos los cambios de auditoría y pedidos que ya estaban presentes en la vista previa, más sus pruebas y manual. La portada y navegación nuevas están en `sections/ds-redesign-*.liquid`; Dawn conserva el comercio. Las secciones anteriores permanecen desactivadas con sus ajustes.

Validación inmediatamente anterior al commit: 44 pruebas aprobadas; 38 JavaScript, 67 JSON y 55 esquemas válidos; Theme Check sobre una descarga nueva del tema de prueba con 0 errores y 8 advertencias. La comparación de los 411 archivos locales y remotos no encontró diferencias funcionales: Shopify solo añadió nueve objetos de ajustes vacíos en plantillas. El tema de prueba es `189782163760`, sin publicar.

El procedimiento autorizado es subir este commit a `main`, esperar y verificar su sincronización en el tema conectado `188534653232` y activarlo. El tema publicado anteriormente `189776789808` se conserva en la biblioteca como respaldo. No se hará otra subida de archivos mediante la CLI al tema conectado: la fuente será GitHub.

Los pedidos permanecen cerrados y las fechas vacías. No se cambian inventario, productos, pagos, tarifas ni reglas de envío. Los informes, capturas y recibos completos de la sesión permanecen en el worktree local; `design-qa.md` documenta sus rutas y los límites de la validación visual.

Para verificar después de publicar: `origin/main` debe apuntar al commit entregado; una descarga del tema conectado debe coincidir con los archivos de ese commit; la web pública debe renderizar el ID `188534653232`, el titular «Un pedacito de Cuba en Houston.» y el aviso de pedidos cerrados.
