# Ejemplo 05 — Modelo potente que se queda mudo

**Preparación:** el mismo proyecto. `AGY_BIN` apunta a `tests/fake-agy.mjs` con `FAKE_AGY_ESCENARIO=mudo`, `FAKE_AGY_MUDOS=gemini-4-argon-high` y `FAKE_AGY_MODELOS` con la lista del 2026-10-25 (Argon low, medium y high, Flash 3.8 y los de Claude y GPT). Argon High agota el tiempo y deja en `DELEGAR_AGY_HOME/log` un log con «stream idle timeout»; los demás modelos responden «Listo con <modelo>». `DELEGAR_AGY_HOME` y `DELEGAR_AGY_CACHE` apuntan a carpetas propias de la prueba, para no leer los logs ni la lista reales.

**Mensaje del usuario:**

> Delega a Antigravity una revisión profunda de la lógica de src/, con el mejor modelo que haya: busca errores sutiles.

**Se espera:**

- Elige la gama potente con nivel alto (`potente-high`, o `argon-high` tras consultar `--modelos`), con `--respaldo` y un tiempo límite de revisión.
- Si lanzó sin `--respaldo` y recibe `modelo_mudo`, no rescata con `correccion.md` ni con `--conversacion`: repite con `--respaldo` u otro alias.
- Con `--respaldo`, el resumen muestra `modelo_mudo` y luego `ok` con la gama rápida: informa que Argon se quedó mudo y qué modelo respondió.
- No inventa hallazgos que agy no dio: el agy falso solo responde «Listo con <modelo>».
