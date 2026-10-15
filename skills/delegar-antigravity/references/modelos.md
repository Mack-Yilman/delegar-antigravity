# Modelos de agy: alias, respaldo y cuota

Antigravity cambia los modelos sin aviso, también los de Claude y GPT. El script no fija versiones: lee `agy models` (unos 12 s, sin gastar tokens), guarda la lista unas horas y resuelve cada alias a la versión más alta disponible. Consulta la lista vigente con `agy.mjs --modelos`.

## Alias

Un alias es `familia-nivel`, sin números: `flash-low`, `flash-medium`, `flash-high`, `pro-low`, `pro-high`, `sonnet-low`, `sonnet-medium`, `sonnet-high`, `opus-low`, `opus-medium`, `opus-high` y `gpt-oss`. Sin nivel (`opus`), prefiere `medium`. Un nombre exacto de la lista (`gemini-3.8-flash-high`) también vale.

| Si la tarea es… | Alias | Por qué |
|---|---|---|
| Mecánica y corta: extraer, listar, formatear | `flash-low` | El más rápido y barato |
| Mecánica con algo de criterio: resumir, renombrar en varios archivos | `flash-medium` | Por defecto del script |
| Intermedia: borradores, refactorizaciones, búsquedas explicadas | `flash-high` o `pro-low` | Más razonamiento sin el costo de Pro High |
| Difícil: arquitectura, errores sutiles, revisión exigente | `pro-high` | El mejor razonamiento de Gemini; tarda varios minutos |
| Gemini falló dos veces, o el usuario lo pide | `sonnet-low` o `sonnet-medium` | Cuota más limitada en Antigravity: úsalo con moderación y avisa |
| Solo si el usuario lo pide | `opus`, `gpt-oss` | — |

**Si una familia desaparece:** sin Pro, `pro-low` y `pro-high` se resuelven a `flash-high`, y el resumen lo dice («sin Pro en agy models»). Si desaparece otra familia, el alias da `modelo_invalido` con la lista de `disponibles`.

`--esfuerzo` no se combina con un nivel en el nombre: agy responde «--model gemini-3.8-flash-low conflicts with --effort=high». El script pasa entonces el nombre base (`gemini-3.8-flash`) con `--effort`, que sí funciona. Casi nunca hace falta: elegir el alias con su nivel es lo mismo.

## Respaldo ante un error de cuota o un modelo que ya no existe

Con `--respaldo`, el script prueba primero las versiones anteriores del mismo alias que estén en la lista y después, en orden, la versión más nueva de cada alias vecino. Nunca cae en un modelo Claude ni GPT.

| Alias pedido | Vecinos, en orden |
|---|---|
| `pro-high` | `pro-low` → `flash-high` |
| `pro-low` | `flash-high` |
| `flash-high` | `flash-medium` |
| `flash-medium` | `flash-high` → `flash-low` |
| `flash-low` | `flash-medium` |

Por ejemplo, con la lista del 2026-10-11, `gemini-3.8-flash-medium` sin cuota probaba `gemini-3.7-flash-medium`, `gemini-3.6-flash-medium`, `gemini-3.8-flash-high` y `gemini-3.8-flash-low`. Si agy rechaza un modelo que la lista guardada aún tenía, el script refresca la lista y rehace la cadena.

Si toda la cadena falla por cuota, no sigas probando: haz la tarea tú o pregunta al usuario. Para ver la cuota restante, el usuario puede abrir `agy` y escribir `/usage`.

## Listas observadas

| Fecha | `agy models` (agy 1.3.3) |
|---|---|
| 2026-10-11 | Gemini Flash 3.6, 3.7 y 3.8 y Gemini 3.1 Pro (low y high); Claude Opus y Sonnet 5.5; GPT-OSS 120B |
| 2026-10-12 | Solo Gemini 3.8 Flash; Claude Opus y Sonnet 5.5; GPT-OSS 120B. Google quitó Pro y Flash 3.6–3.7 (la app de Antigravity tampoco los mostraba): quizá vuelvan |

## Tiempos y consumo medidos

| Tarea | Modelo | Tiempo | Tokens de agy |
|---|---|---|---|
| Leer 2 archivos pequeños y listar funciones | Gemini 3.8 Flash Low | 20 s | 66 mil |
| Editar un archivo y crear otro | Gemini 3.8 Flash Low | 21 s | 77 mil |
| Continuar una conversación con una pregunta | Gemini 3.8 Flash Low | 34 s | 94 mil (acumulado) |
| Renombrar una función en 6 archivos y leer CLAUDE.md | Gemini 3.8 Flash Medium | 99 s | 106 mil |
| Explicar una función de un archivo | Claude Sonnet 5.5 Low | 12 s | 28 mil |
| Responder «hola» sin leer archivos | Gemini 3.8 Flash con esfuerzo alto | 5 s | 13 mil |
| Corregir un párrafo con 14 reglas | Gemini 3.8 Flash Medium | ~65 s | 25 mil |
| Corregir un párrafo con 14 reglas | Gemini 3.1 Pro High | ~260 s | 57 mil |
| Redactar el README de un proyecto | Gemini 3.8 Flash High | 174 s | 136 mil |
| Revisar la lógica de un proyecto (halló 2 errores reales) | Gemini 3.1 Pro High | 416 s | 190 mil |
| Auditar un proyecto entero (12 hallazgos, 2 falsos) | Gemini 3.8 Flash High | ~570 s | 190 mil |
| Revisar un diff de 880 líneas en 14 archivos | Gemini 3.8 Flash High | 900 s (agotó el tiempo) | 118 mil solo de razonamiento, sin respuesta |
| Rescatar esa revisión con «entrega ya» en la misma conversación | Gemini 3.8 Flash High | 80 s | 522 mil (acumulado) |
| Comparar ítem por ítem dos textos de unos 7 y 10 KB | Gemini 3.8 Flash High | Agotó el tiempo; el rescate también | 70 mil (32 mil de razonamiento), sin respuesta |
| Revisar una parte de un documento largo (9 partes, 5 en paralelo) | Gemini 3.8 Flash High | 161–517 s | 71–192 mil por parte |
| Segunda opinión sobre un diff de un plugin | Gemini 3.8 Flash High | 11–17 min | 245–364 mil (6 o 7 de 8 hallazgos reales) |

**En paralelo:** 5 tareas Gemini a la vez no agotaron la cuota (2026-10-15). 5 tareas con Claude dentro de agy (unos 130 mil tokens cada una) sí la agotaron, y se repone en unas 5 h (2026-10-13). Por eso `--respaldo` nunca cae en Claude.

Una tarea mínima dentro de un proyecto ya consume más de 60 mil tokens con Gemini, porque agy carga contexto del espacio de trabajo: no delegues tareas pequeñas. Sonnet Low gastó menos de la mitad en una tarea parecida, pero su cuota es más limitada. En las revisiones grandes, Flash High puede gastar todo el tiempo razonando: pide un máximo de hallazgos y usa `--timeout 1200`.

## Textos de error reales

| Situación | Texto de agy |
|---|---|
| Modelo inexistente | `invalid model selection (--model "…" --effort ""): model … is not recognized as a known model or custom model in settings` |
| Terminal denegada | `jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.` |
| Agotó su propio tiempo | `[agy] print timeout after 6m40s with turn in progress; returning partial output` (2026-10-14, con `--print-timeout 400s`), con `response` vacío; la conversación sigue disponible |
| Cuota agotada | Aún no se ha capturado el texto exacto. El 2026-10-13 se agotó la cuota Claude dentro de agy y el texto no se guardó. Desde la versión 0.3.0, `historial.jsonl` guarda el stderr de cada ejecución: cuando aparezca, cópialo aquí y comprueba que el script lo clasifique como `cuota` |
