# Modelos de agy: elección, respaldo y cuota

Nombres según `agy models` (agy 1.3.3, 2026-10-11). Antigravity cambia los modelos con frecuencia: si un nombre da `modelo_invalido`, ejecuta `agy models` y usa uno de la lista. El nivel de razonamiento va en el nombre (`-low`, `-medium`, `-high`).

## Tabla de elección

| Si la tarea es… | Modelo | Por qué |
|---|---|---|
| Mecánica y corta: extraer, listar, formatear | `gemini-3.8-flash-low` | El más rápido y barato |
| Mecánica con algo de criterio: resumir, renombrar en varios archivos | `gemini-3.8-flash-medium` | Por defecto del script |
| Intermedia: borradores, refactorizaciones, búsquedas explicadas | `gemini-3.8-flash-high` o `gemini-3.1-pro-low` | Más razonamiento sin el costo de Pro High |
| Difícil: arquitectura, errores sutiles, revisión exigente | `gemini-3.1-pro-high` | El mejor razonamiento de Gemini; tarda varios minutos |
| Gemini falló dos veces, o el usuario lo pide | `claude-sonnet-5-5-low` o `-medium` | Cuota más limitada en Antigravity: úsalo con moderación |
| Solo si el usuario lo pide | `claude-opus-5-5-*`, `gpt-oss-120b-medium` | — |

`--esfuerzo` no se combina con un nivel en el nombre: agy responde «--model gemini-3.8-flash-low conflicts with --effort=high». El script pasa entonces el nombre base (`gemini-3.8-flash`) con `--effort`, que sí funciona. Casi nunca hace falta: elegir el modelo con su nivel es lo mismo.

## Cadena de respaldo ante un error de cuota

Con `--respaldo`, el script prueba en orden hasta que uno responda. Nunca cae en un modelo Claude.

| Modelo pedido | Respaldo, en orden |
|---|---|
| `gemini-3.1-pro-high` | `gemini-3.1-pro-low` → `gemini-3.8-flash-high` → `gemini-3.7-flash-high` |
| `gemini-3.1-pro-low` | `gemini-3.8-flash-high` → `gemini-3.7-flash-high` |
| `gemini-3.8-flash-high` | `gemini-3.7-flash-high` → `gemini-3.1-pro-low` → `gemini-3.6-flash-high` |
| `gemini-3.8-flash-medium` | `gemini-3.7-flash-medium` → `gemini-3.6-flash-medium` → `gemini-3.8-flash-high` |
| `gemini-3.8-flash-low` | `gemini-3.7-flash-low` → `gemini-3.6-flash-low` → `gemini-3.8-flash-medium` |

Si toda la cadena falla por cuota, no sigas probando: haz la tarea tú o pregunta al usuario. Para ver la cuota restante, el usuario puede abrir `agy` y escribir `/usage`.

## Tiempos y consumo medidos

| Tarea | Modelo | Tiempo | Tokens de agy |
|---|---|---|---|
| Leer 2 archivos pequeños y listar funciones | `gemini-3.8-flash-low` | 20 s | 66 mil |
| Editar un archivo y crear otro | `gemini-3.8-flash-low` | 21 s | 77 mil |
| Continuar una conversación con una pregunta | `gemini-3.8-flash-low` | 34 s | 94 mil (acumulado) |
| Renombrar una función en 6 archivos y leer CLAUDE.md | `gemini-3.8-flash-medium` | 99 s | 106 mil |
| Explicar una función de un archivo | `claude-sonnet-5-5-low` | 12 s | 28 mil |
| Responder «hola» sin leer archivos | `gemini-3.8-flash` con `--effort high` | 5 s | 13 mil |
| Corregir un párrafo con 14 reglas | `gemini-3.8-flash-medium` | ~65 s | 25 mil |
| Corregir un párrafo con 14 reglas | `gemini-3.1-pro-high` | ~260 s | 57 mil |

Una tarea mínima dentro de un proyecto ya consume más de 60 mil tokens con Gemini, porque agy carga contexto del espacio de trabajo: no delegues tareas pequeñas. Sonnet Low gastó menos de la mitad en una tarea parecida, pero su cuota es más limitada.

## Textos de error reales

| Situación | Texto de agy |
|---|---|
| Modelo inexistente | `invalid model selection (--model "…" --effort ""): model … is not recognized as a known model or custom model in settings` |
| Terminal denegada | `jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.` |
| Cuota agotada | Aún no se ha visto. Cuando aparezca, copia aquí su texto exacto y comprueba que el script lo clasifique como `cuota` |
