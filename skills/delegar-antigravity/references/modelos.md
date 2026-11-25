# Modelos de agy: gamas, precios, cuota, respaldo y fallos

Antigravity cambia los modelos sin aviso, también los de Claude y GPT: el 12/10 desapareció Gemini Pro, hacia el 20/10 llegó Gemini 4 Argon y el 24/11 llegó Carbon al plan Pro mientras Flash y Argon anunciaban su retiro. El script no fija versiones ni familias: lee `agy models` (unos 12 s, sin gastar tokens), guarda la lista unas horas y resuelve cada alias a la versión más alta disponible. Consulta la lista vigente, con precios y retiros, con `agy.mjs --modelos`.

## La cuota: una sola para todos los Gemini, gastada por costo

Desde el 24/11/2026, `RetrieveUserQuotaSummary` (el servicio que usa `/usage` de agy) tiene dos grupos:

| Grupo | Modelos | Ventanas |
|---|---|---|
| Gemini Models | Neon, Carbon, Argon, Hydrogen, los tres Orchestrator y 3.8 Flash | 5 h y semanal |
| Claude and GPT models | Claude Opus 5.5, Claude Sonnet 5.5 y GPT-OSS 120B | 5 h y semanal |

El texto de Google: *«Within each group, models share a weekly limit and a 5-hour limit. Quota is consumed proportionally to the cost of the tokens. Thus, limits will last longer with shorter tasks or using more cost-effective models. The 5-hour limit smooths out aggregate demand… while your weekly limit is tied directly to your individual tier.»*

Consecuencias:

- **El precio por token es una guía del gasto de cuota, no la medida exacta:** en la calibración del 24/11, Hydrogen, Neon y el Orchestrator gastaron cuota en proporción parecida a su costo, pero Carbon gastó más del doble de lo que su precio de API predice. El % real que da el resumen es lo que vale. El modelo correcto es el más barato por tarea que la haga bien: Google mismo dice de Flash «Use Hydrogen for better quality with lower quota usage», aunque Flash cueste la mitad por token, porque Hydrogen termina con muchos menos tokens.
- **Ante una cuota agotada no sirve cambiar de Gemini:** el script ya no lo hace. Hasta el 18/11, Argon tenía una cuota propia; ya no.
- **Proporción medida:** una tarea gastó 0,71 % de la ventana de 5 h y 0,18 % de la semanal. La semana alcanza para unas 4 ventanas de 5 h llenas.
- La ventana de 5 h empieza con el primer uso y se reinicia 5 h después; la semanal, en la fecha que dé `--cuota`.

**Cómo se lee:** la app y el IDE de Antigravity abren un hub local de agy (`agy --hub`) que responde en `127.0.0.1` con un token CSRF guardado en `~/.gemini/antigravity/daemon/hub_<puerto>.json`. El script elige el archivo más reciente con un PID vivo (quedan cientos de hubs cerrados y el PID se reutiliza), llama a `RetrieveUserQuotaSummary` con `forceRefresh: true` (sin él, el hub devuelve una lectura vieja de varios minutos) y nunca imprime ni guarda el token. Si una ventana no trae `remainingFraction`, está agotada: proto3 omite los ceros. Sin la app ni el IDE abiertos no hay hub, y el resumen trae solo el costo estimado. Nada de esto está documentado: si una versión de agy lo cambia, la skill sigue funcionando sin el % real.

## Gamas

Cada familia Gemini cae en una gama según su nombre, así que una familia nueva entra sola:

| Gama | Familias | Para qué |
|---|---|---|
| `rapido` | Hydrogen (y cualquier Flash, `lite` o `nano` que no se esté retirando) | Lo mecánico y corto |
| `medio` | Hydrogen | El trabajo de agente cotidiano: editar, correr pruebas y comandos, revisiones de criterio. Es el modelo por defecto (`medio-medium`) |
| `potente` | Las que no son de otra gama (hoy Neon; antes, Argon y Pro) | Lo complejo |
| `maximo` | Carbon | Lo más difícil y largo. Solo por su alias: nunca por defecto ni como respaldo |

**Niveles:** `low`, `medium` y `high` en todas; `xhigh` (el «Extra» de Antigravity) en Hydrogen y Neon; agy 1.5.16 acepta además `--effort max`. Un alias sin nivel prefiere `medium` y **nunca** elige `xhigh` ni `max`, y el respaldo nunca sube a ellos: se usan solo si el usuario los pide (decisión de Mack, 2026-11-24).

**Dentro de una gama** gana una familia que no se esté retirando, luego la versión más alta y, con la misma versión, Neon. Una familia que se retira se elige solo si no hay otra.

**Orchestrator:** `gemini-pro-orchestrator-neon` (alias `orquestador`) y `gemini-pro-orchestrator` (Carbon, alias `orquestador-maximo`; el de Argon se retira). El modelo grande planifica y deja los pasos rutinarios a Hydrogen: según Google, la misma calidad con menos tokens. Tiene un esfuerzo fijo, sin nivel. Rinde en tareas largas con terminal; en una lectura de una sola pasada no aporta. Probado en modo headless el 24/11 (ver «Tiempos y consumo medidos»).

## Precios (API de Gemini, tier estándar, leídos el 24/11/2026)

La tabla `PRECIOS` del script es la única fuente: el costo de cada delegación y el «× Hydrogen» de `--modelos` se calculan con el precio del día. Un cambio de precio es una línea nueva en `PRECIOS` y otra aquí.

| Modelo | Entrada / salida por millón (USD) | Caché | Lo que dice Google | Evidencia publicada |
|---|---|---|---|---|
| Hydrogen | 1,5 / 7,5 | 0,075 | «For speed and efficiency in execution tasks» | 57 % en Terminal-Bench 4.1; 51 en el índice de Artificial Analysis (54 en xhigh) |
| Neon | 3 / 15 | 0,15 | «For most deep reasoning and complex problems» | 61 en el índice (xhigh); en High, 32 % menos por tarea que Carbon |
| Carbon | 2 / 10 hasta el 30/11/2026; 4 / 20 desde el 01/12/2026 | 0,10; 0,20 | «For your hardest, long-horizon tasks» | 60 en el índice (High) |
| Argon | 2 / 10 hasta el 30/11/2026; 4 / 20 desde el 01/12/2026 | 0,10; 0,20 | «The original Gemini 4 model… Leaving on Nov 30» | 50 en el índice |
| 3.8 Flash | 0,75 / 3,75 hasta el 31/12/2026; 1,5 / 7,5 después | 0,075 | «Use Hydrogen for better quality with lower quota usage. Leaving on Nov 30» | 18 % en Terminal-Bench 4.1 |

El razonamiento (`thinking_tokens`) se cobra como salida. El Orchestrator se cuenta al precio de quien planifica: es una cota superior, porque parte del trabajo va a Hydrogen.

## Retiros

| Modelo | Fecha | Reemplazo |
|---|---|---|
| Gemini 3.8 Flash | 30/11/2026 | Hydrogen (`rapido-*`, `flash-*`) |
| Gemini 4 Argon y Orchestrator (Argon) | 30/11/2026 | Neon (`potente-*`, `argon-*`) |
| GPT-OSS 120B | 30/11/2026 | ninguno |

Desde la fecha, el script los quita de la lista aunque `agy models` aún los muestre. Antes, ninguna gama los elige si hay otra familia, y valen solo por su nombre exacto (decisión de Mack, 2026-11-24: Flash y Argon dejan de usarse desde ese día). Los retiros que Google anuncie después se leen de las etiquetas de Antigravity («Leaving on <fecha>») y se suman solos; `--revisar` avisa para agregarlos a `RETIROS`.

## Alias

- **De gama** (recomendados): `rapido-low`, `rapido-medium`, `rapido-high`, `medio-low`, `medio-medium` (por defecto), `medio-high`, `potente-low`, `potente-medium`, `potente-high`, `maximo-low`, `maximo-medium` y `maximo-high`; con xhigh, `medio-xhigh` y `potente-xhigh`.
- **Orchestrator:** `orquestador` y `orquestador-maximo`.
- **De familia:** `hydrogen-high`, `neon-high`, `carbon-high`, etc. Si una familia Gemini desaparece o se retira, su alias pasa a su gama con el mismo nivel: `argon-high` se resuelve a Neon High y `flash-low` a Hydrogen Low, y el resumen lo dice. Una gama sin modelos baja: `maximo-*` a `potente-*` del mismo nivel, `potente-*` a `medio-*` y, sin gama media, a `rapido-high`.
- **Otros:** `sonnet-low`, `sonnet-medium`, `opus-medium` y `gpt-oss` (hasta el 30/11). Sin nivel (`opus`), prefiere `medium`.
- **Un nombre exacto** de la lista (`gemini-4-neon-high`, `gemini-pro-orchestrator-neon`) también vale.

| Si la tarea es… | Alias | Por qué |
|---|---|---|
| Mecánica y determinista: contar, comparar, renombrar con un patrón | ninguno: un script | No gasta cuota y no se equivoca |
| Mecánica y corta: extraer, listar, formatear | `rapido-low` | Hydrogen Low, el más barato |
| Editar código, correr pruebas, resumir, renombrar con criterio | `medio-medium` | El equilibrio por defecto |
| Revisión de criterio de un diff o un plan, depuración de varios pasos | `medio-high` | Rindió como Argon High (gym-coach-bot, 13/11) en 3–5 min |
| Compleja con alcance acotado: un error sutil en pocos archivos, una decisión de diseño | `potente-medium` | Razonamiento fuerte, el doble de costo por token |
| Difícil: arquitectura, auditoría, revisión profunda de un diff grande | `potente-high` | El mejor razonamiento de uso normal; 5 a 20 min |
| Larga con terminal: construir algo con sus pruebas, una migración | `orquestador` | Neon piensa y Hydrogen ejecuta lo rutinario |
| La más difícil y larga, o lo que `potente-high` no resolvió | `maximo-high` | Carbon: desde el 1/12, el más caro |
| El usuario pide xhigh | `medio-xhigh` o `potente-xhigh` | Nunca por cuenta propia |
| El usuario pide un modelo Claude, o Gemini falló dos veces | `sonnet-low` o `sonnet-medium` | Otra cuota, más limitada: avisa |
| Solo si el usuario lo pide | `opus` | — |

`--esfuerzo` no se combina con un nivel en el nombre: agy responde «--model gemini-3.8-flash-low conflicts with --effort=high». El script pasa entonces el nombre base (`gemini-4-hydrogen`) con `--effort`, que sí funciona. Casi nunca hace falta: elegir el alias con su nivel es lo mismo.

## Regular el esfuerzo

- **Empieza por el nivel más bajo que alcance:** cada nivel arriba multiplica el tiempo y los tokens, y un nivel alto no compensa un encargo vago.
- **Sube un nivel o de gama** (`medio-high` → `potente-medium` → `potente-high` → `maximo-high`) si la respuesta quedó superficial: no vio el error, resumió en vez de analizar o dejó puntos sin responder. Hazlo en una tarea nueva con el encargo corregido.
- **`xhigh` y `max`, solo a pedido del usuario:** con Hydrogen xhigh, una tarea de dibujo tardó 11 min y otra gastó 965 mil tokens (14/11).
- **Baja de gama o acota** si dio `sin_avance` o `modelo_mudo`: menos archivos, funciones nombradas y un máximo de hallazgos.
- **Lo mecánico nunca va a las gamas potente ni máxima:** tarda más y no sale mejor. Una comparación palabra por palabra no va a ningún modelo: usa un script.

## Respaldo ante modelo inexistente, modelo mudo o fallo transitorio

Con `--respaldo`, el script prueba primero las versiones anteriores del mismo modelo que estén en la lista y luego, en orden, el mejor modelo de cada gama y nivel vecinos. Nunca cae en un modelo Claude ni GPT, nunca sube a Carbon y **nunca cambia de modelo ante un error de cuota** (la cuota es la misma para todos los Gemini). Ante un fallo transitorio, antes reintenta el mismo modelo una vez, tras 60 s.

| Alias pedido | Vecinos, en orden |
|---|---|
| `maximo-high` | `potente-high` → `medio-high` |
| `maximo-medium` | `potente-medium` → `medio-high` |
| `maximo-low` | `potente-low` → `medio-medium` |
| `potente-xhigh` | `potente-high` → `medio-xhigh` → `rapido-high` |
| `potente-high` | `medio-high` → `rapido-high` |
| `potente-medium` | `medio-high` → `rapido-high` |
| `potente-low` | `medio-medium` → `rapido-high` |
| `medio-xhigh` | `medio-high` → `rapido-high` |
| `medio-high` | `rapido-high` → `medio-medium` |
| `medio-medium` | `rapido-high` |
| `medio-low` | `rapido-medium` |
| `rapido-xhigh` | `rapido-high` → `rapido-medium` |
| `rapido-high` | `rapido-medium` |
| `rapido-medium` | `rapido-high` → `rapido-low` |
| `rapido-low` | `rapido-medium` |

Ejemplo con la lista del 24/11: Carbon High → Neon High → Hydrogen High; Neon High → Hydrogen High. Como `rapido-*` también es Hydrogen, los vecinos repetidos se saltan. Si agy rechaza un modelo que la lista guardada aún tenía, el script refresca la lista y rehace la cadena.

Si la cuota se agota, no sigas probando: dile al usuario cuándo se reinicia (`--cuota` o el texto «Resets in…» del error) y haz la tarea tú, o espera si él lo prefiere.

## Listas observadas

| Fecha | `agy models` |
|---|---|
| 2026-10-11 | Gemini Flash 3.6, 3.7 y 3.8 y Gemini 3.1 Pro (low y high); Claude Opus y Sonnet 5.5; GPT-OSS 120B (agy 1.3.3) |
| 2026-10-12 | Solo Gemini 3.8 Flash; Claude Opus y Sonnet 5.5; GPT-OSS 120B. Google quitó Pro y Flash 3.6–3.7 (agy 1.3.3) |
| 2026-10-25 | Gemini 4 Argon (low, medium y high) y Gemini 3.8 Flash; Claude Opus y Sonnet 5.5; GPT-OSS 120B (agy 1.4.7). Argon ya estaba el 20/10 |
| 2026-11-18 | Gemini 4 Neon y Hydrogen (low a xhigh), Argon (low a high), Orchestrator (Neon y Argon) y 3.8 Flash; Claude Opus y Sonnet 5.5; GPT-OSS 120B (agy 1.5.9). Hydrogen ya estaba el 12/11; Neon llegó el 18/11 |
| 2026-11-24 | Lo mismo más Gemini 4 Carbon (low a high) y Orchestrator (Carbon), ya en el plan Pro; Claude Opus y Sonnet 5.5 con nivel high (agy 1.5.16). Flash, Argon y GPT-OSS con la insignia «Leaving Soon» (30/11) |

## Tiempos y consumo medidos

`duration_seconds` de agy es el tiempo activo del modelo, no el de reloj: el 25/10, una corrida de 20 min dio 617 s. Desde la 0.4.0, el resumen muestra los dos. Desde la 0.8.0, cada resumen trae además el % de cuota gastado y el costo estimado, y `~/.delegar-antigravity/consumo.jsonl` los acumula: esa es la fuente para ampliar esta tabla.

### Calibración del 24/11/2026: la misma revisión con cuatro modelos

Un diff inventado de 162 líneas con 6 errores plantados (validación debilitada, *off-by-one*, IGV antes del descuento, despacho no atómico, `sort` que muta el historial y `writeFile` sin `await`), en modo lectura, en serie y sin otro uso de agy. **Los cuatro encontraron los 6 errores y los mismos 2 errores reales que no estaban plantados**: la calidad fue igual y el costo no.

| Modelo | Reloj | Tokens | Cuota de 5 h | Cuota semanal | USD estimado |
|---|---|---|---|---|---|
| Hydrogen High | 1 min 45 s | 37 mil | 0,36 % | 0,09 % | 0,12 |
| Orchestrator (Neon) | 2 min 46 s | 38 mil | 0,80 % | 0,20 % | 0,30 |
| Neon High | 2 min 56 s | 41 mil | 0,96 % | 0,24 % | 0,39 |
| Carbon High | 5 min 14 s | 43 mil | 2,17 % | 0,54 % | 0,32 (al precio del 24/11) |

- **Para una revisión de este tamaño, Hydrogen High basta** y gasta un tercio que Neon y un sexto que Carbon. Sube a Neon o Carbon cuando la tarea sea grande o difícil de verdad, no por prudencia.
- **Carbon ya gasta cuota como un modelo más caro de lo que dice su precio de API:** 2,3 veces la de Neon con un costo estimado menor. La cuota por USD estimado fue de unos 3 % de 5 h por dólar en Hydrogen, 2,5 en Neon, 2,7 en el Orchestrator y 6,9 en Carbon. Para Carbon, el costo en USD del resumen subestima el gasto: guíate por el % real.
- **El Orchestrator gastó 16 % menos que Neon solo** con el mismo resultado, incluso en una tarea de lectura.
- La ventana semanal gastó siempre la cuarta parte que la de 5 h: la semana equivale a unas 4 ventanas de 5 h llenas. Con este tamaño de revisión, una ventana de 5 h alcanza para unas 280 con Hydrogen High, 100 con Neon High o 45 con Carbon High.

| Tarea | Modelo | Tiempo | Tokens de agy | Cuota gastada |
|---|---|---|---|---|
| Editar una función, crear 4 pruebas y correrlas (sandbox) | Orchestrator (Neon) | 2 min | 59 mil | 0,71 % de 5 h; 0,18 % semanal |
| Leer 2 archivos pequeños y listar funciones | Flash Low | 20 s | 66 mil | — |
| Editar un archivo y crear otro | Flash Low | 21 s | 77 mil | — |
| Renombrar una función en 6 archivos y leer CLAUDE.md | Flash Medium | 99 s | 106 mil | — |
| Explicar una función de un archivo | Claude Sonnet Low | 12 s | 28 mil | — |
| Redactar el README de un proyecto | Flash High | 174–300 s | 136 mil | — |
| Auditar un proyecto entero (12 hallazgos, 2 falsos) | Flash High | ~570 s | 190 mil | — |
| Auditar una skill (11 de 12 hallazgos aplicados) | Argon High | 535 s | 79 mil | — |
| Revisar un plugin (5–6 de 6 hallazgos reales) | Argon High | 8–11 min | 77–193 mil | — |
| Revisar un diff de 880 líneas en 14 archivos | Flash High | 900 s (agotó el tiempo) | 118 mil solo de razonamiento, sin respuesta | — |
| Revisar un diff de 160 KB y 11 archivos | Argon High | 20 min, mudo | 393 mil, sin respuesta | — |
| Segunda opinión sobre un diff de un plugin | Flash High | 11–17 min | 245–364 mil (6 o 7 de 8 hallazgos reales) | — |
| Segunda opinión sobre el diff de la 0.7.0 de esta skill (5 de 6 hallazgos aplicados) | Hydrogen High | 3 min | 88 mil | — |
| Pruebas TDD y una guía (gym-coach-bot) | Hydrogen Medium | 103–116 s | — | — |
| Revisar dos diffs (3 hallazgos reales) | Hydrogen High | 3–5 min | — | — |
| Dibujar un sprite de 4 etapas validando con un script | Hydrogen XHigh | 11 min | — | — |

Las dos segundas opiniones muestran por qué el precio por token engaña: Flash High gastó de 3 a 4 veces más tokens que Hydrogen High en una tarea parecida, así que Hydrogen salió más barato aun costando el doble por token.

**En paralelo:** 5 tareas Gemini a la vez no agotaron la cuota (2026-10-15). 5 tareas con Claude dentro de agy (unos 130 mil tokens cada una) sí la agotaron, y se repone en unas 5 h (2026-10-13). Por eso `--respaldo` nunca cae en Claude. Con tareas en paralelo, el % gastado que da cada resumen incluye lo de las otras.

Una tarea mínima dentro de un proyecto ya consume más de 60 mil tokens con Gemini, porque agy carga contexto del espacio de trabajo: no delegues tareas pequeñas. En las revisiones grandes, pide como máximo 6 hallazgos en formato corto: con 10 hallazgos, Flash High pasó el límite de salida.

**Los tiempos agotados de esta tabla no son el tiempo que la tarea necesitaba:** hasta la 0.5.0, el límite fijo cortaba corridas vivas. Desde la 0.6.0, el script corta solo si no hay pasos nuevos en todo el plazo.

| Modelo | Plazo inicial sin pasos nuevos | Tope contra bucles |
|---|---|---|
| `rapido-low`, `medio-low` | 15 min | 2 h |
| `rapido-medium`, `medio-medium` | 20 min | 2 h |
| `rapido-high`, `medio-high` | 30 min | 2 h |
| `potente-*`, `maximo-*`, el Orchestrator y cualquier `xhigh` o `max` | 45 min | 4 h |

El plazo crece hasta 3 veces el silencio más largo visto en la corrida. Estos valores salen de pocas corridas medidas: si `--incidencias` muestra `sin_avance` en tareas sanas, súbelos en `PLAZOS`.

**Argon era intermitente:** el 24/10 terminó dos revisiones en 8 y 10 min, y el 25/10 se quedó mudo tres veces seguidas, incluso con 4 archivos. El script lo detecta (`modelo_mudo`) y, con `--respaldo`, pasa al siguiente de la cadena.

## Textos de error reales

| Situación | Texto de agy | Estado |
|---|---|---|
| Modelo inexistente | `invalid model selection (--model "…" --effort ""): model … is not recognized as a known model or custom model in settings` | `modelo_invalido` |
| Terminal denegada | `jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.` | `incompleto` |
| Herramienta MCP denegada | Lo mismo con `the "mcp" permission` (Flash High, 19/11, dos veces: pidió una herramienta MCP que el encargo no nombraba) | `incompleto` |
| Agotó su propio tiempo | `[agy] print timeout after 6m40s with turn in progress; returning partial output`, con `response` vacío; la conversación sigue disponible | `timeout` |
| Modelo mudo | En `cli.log`: `run.go:301] Run: attempt 1 failed (stream reading error: stream idle timeout (5m0s): context deadline exceeded), retrying in 4s` y luego `poll.go:188] Print mode: print timeout after 15m0s with turn in progress after 35242 polls (printed=10)`. En stderr solo se ve el *print timeout* | `modelo_mudo` |
| Sin capacidad | `API error (attempt 1): UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-medium on the server` | `transitorio` |
| Error interno | En `cli.log`: `attempt 1 failed (INTERNAL (code 500): Internal error encountered.), retrying in 4s` | `transitorio` |
| Conexión cortada | `The stream was interrupted. Please continue the task you were working on.` A veces con la respuesta completa | `transitorio` o `parcial` |
| Sin red | `error: There was a network issue connecting to the server, please try again.`, con `write tcp …: wsasend` y `lookup daily-cloudcode-pa.googleapis.com: no such host` en `cli.log` (20/11) | `transitorio` |
| Arranque fallido | `error: failed to start conversation: backend returned an empty conversation id` (21/11, a los 6 s) | `transitorio` |
| Respuesta demasiado larga | `Your previous response was cut off because it exceeded the output token limit` / `Please continue from where you left off, keeping your response shorter`, con la respuesta casi completa | `parcial` |
| Cuota agotada | `error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 130h36m34s.` y `AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED (code 429): …"}` (Argon, 05/11 y 15/11). Puede llegar a mitad de una tarea: el 15/11 cortó una corrida a los 18 min | `cuota` |
| Cuota de imágenes | `429 Too Many Requests … "You have exhausted your capacity on this model. Your quota will reset after 4h37m14s."` en `cli.log`, con `quotaResetTimeStamp` (gemini-3.1-flash-image, 10/11). agy termina `ok` sin imagen | `ok` (revisa `generados`) |
| Esquema inválido | `INVALID_ARGUMENT (code 400): * GenerateContentRequest.tools[12].function_declarations[0].parameters.properties[…].items: missing field`: un arreglo de `--esquema` sin `items` | `error` |
