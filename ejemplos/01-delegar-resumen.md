# Ejemplo 01 — Una tarea que sí conviene delegar

**Preparación:** un proyecto inventado con git y seis módulos en `src/` (`almacen`, `clientes`, `pedidos`, `productos`, `facturas`, `envios`) y un `CLAUDE.md` propio. La skill está instalada en `.claude/skills/` del proyecto.

**Mensaje del usuario:**

> Necesito un resumen de qué hace cada módulo de src/ y qué exporta, en una tabla. Son varios archivos: delégalo a Antigravity para ahorrar tokens.

**Se espera:**

- Escribe el encargo en un archivo **fuera** del proyecto, con la plantilla.
- Ejecuta `scripts/agy.mjs` con un modelo Gemini Flash y `--modo lectura`.
- No relee los seis archivos por su cuenta para rehacer el trabajo.
- Entrega la tabla e informa en pocas líneas: modelo, tiempo y lo que verificó.
