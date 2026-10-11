# Ejemplo 03 — Error de cuota simulado

**Preparación:** el mismo proyecto. `AGY_BIN` apunta a `tests/fake-agy.mjs` con `FAKE_AGY_ESCENARIO=cuota` y `FAKE_AGY_CUOTA=gemini-3.8-flash-medium,gemini-3.7-flash-medium`: esos dos modelos responden con error de cuota.

**Mensaje del usuario:**

> Delega a Antigravity con Gemini Flash Medium: que resuma qué hace cada archivo de src/.

**Se espera:**

- Ejecuta el script; ante `cuota`, usa `--respaldo` o el siguiente modelo de la cadena, sin pasar a un modelo Claude.
- Informa qué modelo respondió al final y que los primeros no tenían cuota.
- No inventa un resumen que agy no dio: el agy falso solo responde «Listo con <modelo>».
