# Dayana's Sweet — instrucciones compartidas para agentes

Fuente única de instrucciones del proyecto para cualquier agente (Claude Code, Codex u otro worker de Orca).
Lo específico de Claude está en `CLAUDE.md`; el flujo multiagente (Opus coordina; Sonnet, Codex o Claude implementan), en `docs/orquestacion.md`.

## Arquitectura

Un solo repo: tema Shopify de la pastelería artesanal Dayana's Sweet (`C:\Users\Milton\orca\dayanas-sweet-web`).

- Base **Dawn 16.0.0** (Liquid + CSS + JS vanilla) con capa propia `ds-`: secciones `sections/ds-*.liquid`, estilos `assets/ds-*.css`, snippets `snippets/ds-*`. Sin React, Tailwind, bundler ni build step.
- Textos de la tienda en español. Productos, precios y colecciones salen de objetos de Shopify.
- El tema en vivo está conectado a GitHub `main`: todo push a `main` publica en dayanassweet.com.

## Reglas de negocio sensibles

Tratar como impacto alto (ver la política de complejidad en `docs/orquestacion.md`):

- **Tema en vivo**: cualquier cosa que llegue a `main`.
- **Checkout, envíos y carrito**: tarifa de envío, cart drawer, cierre de tanda.
- **Stock y cupos por tanda**: el cierre real es poner stock 0; la interfaz solo lo refleja.

## Interfaz

- En rediseños o UI nueva: primero maqueta (Artifact) y aprobación del usuario, después código.
- Probar en desktop y mobile; respetar `prefers-reduced-motion`.

## Validación antes de entregar

1. `node tests/check-theme.mjs` (sintaxis JS, JSON y esquemas). Theme Check de Shopify aparte, si la CLI está disponible.
2. Cambios de UI: vista previa del tema en desktop y mobile.
3. Informar qué se corrió y su resultado real; si algo no se pudo comprobar, decirlo.

## Ramas y despliegue

- No subir (`git push`) a `main` sin probar antes y sin autorización explícita del usuario; una autorización previa no vale para pushes posteriores.
- Pruebas primero en el tema sin publicar (`shopify theme push --theme <id>`), nunca directo al tema en vivo.
- Sin push, despliegue ni publicación salvo pedido explícito del usuario.

## Límites de trabajo

- Hacer solo lo pedido; no ampliar alcance ni refactorizar de paso.
- No tocar credenciales, configuración global ni permisos.
- No modificar el admin de Shopify (productos, envíos, colecciones) salvo pedido explícito.

## Si trabajas como worker de Orca (Claude o Codex)

- No recibes la conversación del coordinador: tu tarea es el spec. Si tu rol trae un archivo (`.claude/agents/<rol>.md`), sigue su cuerpo aunque no seas Claude.
- Haz solo la tarea, dentro de las rutas asignadas. No lances otros workers ni subagentes salvo autorización en el spec.
- Ante una duda que cambia el resultado (contrato, alcance, archivo fuera de tu área), usa el comando `ask` de tu preámbulo y espera; no adivines.
- Revisa los mensajes del coordinador con `check` antes de empezar cada archivo y antes de terminar.
- Cierra con un único `worker_done` y `--outcome succeeded` o `failed` (nunca escondas un fallo en el texto). En el cuerpo: qué cambiaste, archivos, comprobaciones con su resultado real y pendientes.
