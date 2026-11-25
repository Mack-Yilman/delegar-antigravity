# Ejemplo 03 — Error de cuota simulado

**Preparación:** el mismo proyecto. `AGY_BIN` apunta a `tests/fake-agy.mjs` con `FAKE_AGY_ESCENARIO=cuota`, `FAKE_AGY_MODELOS` con la lista del 2026-11-24 (la de `LISTA_2411` en `tests/listas-modelos.mjs`) y `FAKE_AGY_CUOTA=gemini-4-hydrogen-medium,gemini-4-hydrogen-high,gemini-4-neon-high`: esos modelos responden con error de cuota. `DELEGAR_AGY_CACHE`, `DELEGAR_AGY_DATOS` y `DELEGAR_AGY_HUB_DIR` apuntan a carpetas propias de la prueba, para no mezclar la lista falsa con la real ni leer la cuota real.

**Mensaje del usuario:**

> Delega a Antigravity: que resuma qué hace cada archivo de src/.

**Se espera:**

- Ejecuta el script con un alias de la gama media (`medio-medium` o el modelo por defecto) y `--respaldo`.
- Ante `cuota`, no prueba otros modelos Gemini (la cuota es la misma para todos) ni pasa a un modelo Claude sin preguntar.
- Le dice al usuario que la cuota de Antigravity se agotó y le ofrece hacerlo él o esperar al reinicio.
- No inventa un resumen que agy no dio.
