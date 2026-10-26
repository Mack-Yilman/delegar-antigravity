# Modelos de agy: gamas, alias, respaldo y fallos

Antigravity cambia los modelos sin aviso, también los de Claude y GPT: el 12/10 desapareció Gemini Pro y hacia el 20/10 llegó Gemini 4 Argon. El script no fija versiones ni familias: lee `agy models` (unos 12 s, sin gastar tokens), guarda la lista unas horas y resuelve cada alias a la versión más alta disponible. Consulta la lista vigente con `agy.mjs --modelos`.

## Gamas

Cada familia Gemini cae en una gama según su nombre, así que una familia nueva entra sola:

| Gama | Familias | Para qué |
|---|---|---|
| `rapido` | Las que tienen `flash`, `lite` o `nano` en el nombre (hoy, Flash) | Lo mecánico e intermedio: rápido y barato |
| `potente` | Todas las demás (hoy, Argon; antes, Pro) | Lo complejo: más razonamiento, más minutos |

Cada gama tiene tres niveles de esfuerzo: `low`, `medium` y `high`. El alias `potente-high` es «el mejor razonamiento que haya hoy»: Argon High el 25/10, y el día que llegue un Gemini 5 potente, ese, sin cambiar la skill.

## Alias

- **De gama** (recomendados): `rapido-low`, `rapido-medium` (por defecto), `rapido-high`, `potente-low`, `potente-medium` y `potente-high`.
- **De familia:** `flash-medium`, `argon-high`, etc. Si una familia Gemini desaparece, su alias pasa a su gama con el mismo nivel: `pro-high` se resuelve hoy a Argon High, y el resumen lo dice («sin Pro en agy models: uso potente-high»). Sin ningún modelo potente, `potente-*` y `argon-*` caen en `rapido-high`.
- **Otros:** `sonnet-low`, `sonnet-medium`, `opus-medium` y `gpt-oss`. Sin nivel (`opus`), prefiere `medium`.
- **Un nombre exacto** de la lista (`gemini-3.8-flash-high`) también vale.

| Si la tarea es… | Alias | Por qué |
|---|---|---|
| Mecánica y corta: extraer, listar, formatear | `rapido-low` | El más rápido y barato |
| Mecánica con algo de criterio: resumir, renombrar en varios archivos | `rapido-medium` | El equilibrio por defecto |
| Intermedia: borradores, refactorizaciones, búsquedas explicadas, revisiones de textos | `rapido-high` | Más razonamiento sin los minutos de la gama potente |
| Compleja con alcance acotado: un error sutil en pocos archivos, una decisión de diseño | `potente-medium` | Razonamiento fuerte; menos riesgo de quedarse mudo que High |
| La más difícil: arquitectura, auditoría, revisión profunda de un diff | `potente-high` | El mejor razonamiento disponible; 5 a 20 min |
| Gemini falló dos veces, o el usuario lo pide | `sonnet-low` o `sonnet-medium` | Cuota más limitada en Antigravity: úsalo con moderación y avisa |
| Solo si el usuario lo pide | `opus`, `gpt-oss` | — |

`--esfuerzo` no se combina con un nivel en el nombre: agy responde «--model gemini-3.8-flash-low conflicts with --effort=high». El script pasa entonces el nombre base (`gemini-3.8-flash`) con `--effort`, que sí funciona. Casi nunca hace falta: elegir el alias con su nivel es lo mismo.

## Regular el esfuerzo

- **Empieza por el nivel más bajo que alcance:** cada nivel arriba multiplica el tiempo y los tokens, y un nivel alto no compensa un encargo vago.
- **Sube un nivel** (o de `rapido-high` a `potente-medium`) si la respuesta quedó superficial: no vio el error, resumió en vez de analizar o dejó puntos sin responder. Hazlo en una tarea nueva con el encargo corregido.
- **Baja de gama o acota** si dio `timeout` o `modelo_mudo`: menos archivos, funciones nombradas y un máximo de hallazgos.
- **Lo mecánico nunca va a la gama potente:** tarda más y no sale mejor. Una comparación palabra por palabra no va a ningún modelo: usa un script.

## Respaldo ante cuota, modelo inexistente, modelo mudo o fallo transitorio

Con `--respaldo`, el script prueba primero las versiones anteriores del mismo modelo que estén en la lista y después, en orden, el mejor modelo de cada gama y nivel vecinos. Nunca cae en un modelo Claude ni GPT. Ante un fallo transitorio, antes reintenta el mismo modelo una vez, tras 60 s.

| Alias pedido | Vecinos, en orden |
|---|---|
| `potente-high` | `rapido-high` |
| `potente-medium` | `rapido-high` |
| `potente-low` | `rapido-high` |
| `rapido-high` | `rapido-medium` |
| `rapido-medium` | `rapido-high` → `rapido-low` |
| `rapido-low` | `rapido-medium` |

Lo potente no baja a otro nivel potente: el 25/10, Argon High y Argon Medium se quedaron mudos el mismo día. Si agy rechaza un modelo que la lista guardada aún tenía, el script refresca la lista y rehace la cadena.

Si toda la cadena falla por cuota, no sigas probando: haz la tarea tú o pregunta al usuario. Para ver la cuota restante, el usuario puede abrir `agy` y escribir `/usage`.

## Listas observadas

| Fecha | `agy models` |
|---|---|
| 2026-10-11 | Gemini Flash 3.6, 3.7 y 3.8 y Gemini 3.1 Pro (low y high); Claude Opus y Sonnet 5.5; GPT-OSS 120B (agy 1.3.3) |
| 2026-10-12 | Solo Gemini 3.8 Flash; Claude Opus y Sonnet 5.5; GPT-OSS 120B. Google quitó Pro y Flash 3.6–3.7 (agy 1.3.3) |
| 2026-10-25 | Gemini 4 Argon (low, medium y high) y Gemini 3.8 Flash; Claude Opus y Sonnet 5.5; GPT-OSS 120B (agy 1.4.7). Argon ya estaba el 20/10 |

## Tiempos y consumo medidos

`duration_seconds` de agy es el tiempo activo del modelo, no el de reloj: el 25/10, una corrida de 20 min dio 617 s. Desde la 0.4.0, el resumen muestra los dos.

| Tarea | Modelo | Tiempo | Tokens de agy |
|---|---|---|---|
| Leer 2 archivos pequeños y listar funciones | Flash Low | 20 s | 66 mil |
| Editar un archivo y crear otro | Flash Low | 21 s | 77 mil |
| Renombrar una función en 6 archivos y leer CLAUDE.md | Flash Medium | 99 s | 106 mil |
| Explicar una función de un archivo | Claude Sonnet Low | 12 s | 28 mil |
| Corregir un párrafo con 14 reglas | Flash Medium | ~65 s | 25 mil |
| Corregir un párrafo con 14 reglas | Pro High | ~260 s | 57 mil |
| Redactar el README de un proyecto | Flash High | 174–300 s | 136 mil |
| Revisar la lógica de un proyecto (halló 2 errores reales) | Pro High | 416 s | 190 mil |
| Auditar un proyecto entero (12 hallazgos, 2 falsos) | Flash High | ~570 s | 190 mil |
| Auditar una skill (11 de 12 hallazgos aplicados) | Argon High | 535 s | 79 mil |
| Revisar un diff de 1390 líneas | Argon High | ~5 min | — |
| Revisar un plugin (5–6 de 6 hallazgos reales) | Argon High | 8–11 min | 77–193 mil |
| Revisar un diff de 880 líneas en 14 archivos | Flash High | 900 s (agotó el tiempo) | 118 mil solo de razonamiento, sin respuesta |
| Rescatar esa revisión con «entrega ya» en la misma conversación | Flash High | 80 s | 522 mil (acumulado) |
| Revisar un diff de 160 KB y 11 archivos | Argon High | 20 min, mudo | 393 mil, sin respuesta |
| Revisar 4 archivos con funciones nombradas | Argon Medium | 15 min, mudo | 84 mil, sin respuesta |
| Revisar una parte de un documento largo (9 partes, 5 en paralelo) | Flash High | 161–517 s | 71–192 mil por parte |
| Segunda opinión sobre un diff de un plugin | Flash High | 11–17 min | 245–364 mil (6 o 7 de 8 hallazgos reales) |

**En paralelo:** 5 tareas Gemini a la vez no agotaron la cuota (2026-10-15). 5 tareas con Claude dentro de agy (unos 130 mil tokens cada una) sí la agotaron, y se repone en unas 5 h (2026-10-13). Por eso `--respaldo` nunca cae en Claude.

Una tarea mínima dentro de un proyecto ya consume más de 60 mil tokens con Gemini, porque agy carga contexto del espacio de trabajo: no delegues tareas pequeñas. En las revisiones grandes, pide como máximo 6 hallazgos en formato corto y usa `--timeout 1200`: con 10 hallazgos, Flash High pasó el límite de salida.

**Argon es intermitente:** el 24/10 terminó dos revisiones en 8 y 10 min, y el 25/10 se quedó mudo tres veces seguidas, incluso con 4 archivos. No depende del tamaño. El script lo detecta (`modelo_mudo`) y, con `--respaldo`, pasa a `rapido-high`.

## Textos de error reales

| Situación | Texto de agy | Estado |
|---|---|---|
| Modelo inexistente | `invalid model selection (--model "…" --effort ""): model … is not recognized as a known model or custom model in settings` | `modelo_invalido` |
| Terminal denegada | `jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.` | `incompleto` |
| Agotó su propio tiempo | `[agy] print timeout after 6m40s with turn in progress; returning partial output`, con `response` vacío; la conversación sigue disponible | `timeout` |
| Modelo mudo | En `cli.log`: `run.go:301] Run: attempt 1 failed (stream reading error: stream idle timeout (5m0s): context deadline exceeded), retrying in 4s` y luego `poll.go:188] Print mode: print timeout after 15m0s with turn in progress after 35242 polls (printed=10)`. En stderr solo se ve el *print timeout* | `modelo_mudo` |
| Sin capacidad | `API error (attempt 1): UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-medium on the server` | `transitorio` |
| Error interno | En `cli.log`: `attempt 1 failed (INTERNAL (code 500): Internal error encountered.), retrying in 4s` | `transitorio` |
| Conexión cortada | `The stream was interrupted. Please continue the task you were working on.` A veces con la respuesta completa | `transitorio` o `parcial` |
| Respuesta demasiado larga | `Your previous response was cut off because it exceeded the output token limit` / `Please continue from where you left off, keeping your response shorter`, con la respuesta casi completa | `parcial` |
| Cuota agotada | Aún no se ha capturado el texto exacto. El 2026-10-13 se agotó la cuota Claude dentro de agy y el texto no se guardó. El registro central guarda el stderr de cada fallo: cuando aparezca, cópialo aquí y comprueba que el script lo clasifique como `cuota` | `cuota` |
