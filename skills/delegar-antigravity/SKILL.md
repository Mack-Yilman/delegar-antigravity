---
name: delegar-antigravity
description: "Delega subtareas pesadas a Antigravity CLI (agy) para ahorrar tus propios tokens: decides si conviene, eliges el modelo Gemini, escribes el encargo en un archivo, lo ejecutas con un script que devuelve un resumen breve y verificas el resultado. Úsala cuando el usuario diga «delega esto», «usa Antigravity», «usa agy», «que lo haga Gemini», «ahorra tokens», «pásaselo a otro agente» o «hazlo en paralelo con otro agente». Propón usarla por tu cuenta cuando la tarea sea grande y mecánica: leer o resumir muchos archivos, redactar borradores largos, refactorizaciones repetitivas en varios archivos, búsquedas amplias en un repositorio o una segunda opinión sobre un diff o un documento."
license: CC BY-NC-ND 4.0
---

## Qué es

Tú eres el orquestador y Antigravity CLI (`agy`) es un ayudante con su propia cuota de modelos. Tú decides qué delegar, redactas el encargo, revisas un resumen breve y verificas. agy hace el trabajo pesado: leer muchos archivos, generar texto largo o editar código.

Delegar ahorra cuando lo que agy va a leer o escribir es mucho mayor que lo que te cuesta escribir el encargo (unas 20 líneas) y leer el resumen (unas 10). Cada llamada tarda entre 15 s y 20 min, y gasta entre 30 y 500 mil tokens de la cuota de Antigravity, no de la tuya: lo más caro son las revisiones de muchos archivos con un modelo de razonamiento alto.

## ¿Conviene delegar?

| Si la tarea es… | Decide |
|---|---|
| Leer, resumir o comparar muchos archivos o documentos largos | Delega en modo lectura |
| Un borrador largo (documentación, informe, pruebas) con instrucciones claras | Delega; pide el borrador en un archivo |
| Un cambio mecánico repetido en varios archivos (renombrar, migrar una API, formato) | Delega en modo edición |
| Buscar en todo un repositorio dónde se usa algo y explicarlo | Delega en modo lectura |
| Una segunda opinión o una revisión de un diff, un plan o un texto | Delega en modo lectura, con otro modelo que el tuyo (ver «Revisiones y auditorías») |
| Varias subtareas independientes a la vez | Un encargo por subcarpeta y una sola llamada con `--lote` (ver «Varios encargos a la vez»); como máximo 5 a la vez |
| Comparar textos palabra por palabra, o datos campo por campo, sin que falte nada | No delegues: un script determinista (un diff, una comparación por campo) es más rápido y fiable. Un modelo de razonamiento puede agotar el tiempo en esto |
| Pequeña: menos de unos 3 archivos o una edición puntual | Hazla tú: el encargo costaría más que la tarea |
| Depende de lo hablado en esta conversación o de tu criterio fino | Hazla tú, o resume ese contexto en el encargo si es corto |
| Incluye datos de pacientes, datos clínicos, datos personales, secretos, `.env`, claves o credenciales | No delegues sin permiso explícito del usuario: lo que lee agy sale a los servidores de Google |
| Requiere autorización del usuario: push, publicar, borrar, enviar correos, tocar Drive o servicios externos | Nunca la delegues; agy solo prepara, tú pides permiso y ejecutas |

La tabla sirve para decidir por tu cuenta. **Si el usuario pide delegar** («delega esto», «usa agy»), delega aunque la tarea sea pequeña o dependa de la conversación: él decidió gastar la cuota de Antigravity en lugar de la tuya. Como mucho, coméntale en una línea que habría salido más barato hacerlo tú. Las dos últimas filas son la excepción: datos sensibles y acciones que requieren autorización.

Si el usuario no pidió delegar y la tarea encaja en las filas de arriba, propónlo en una línea («Esto es grande y mecánico; ¿lo delego a Antigravity con Gemini Flash?») y espera su respuesta.

**Datos sensibles, aunque el usuario pida usar agy.** agy puede leer **cualquier** archivo de su espacio de trabajo (la carpeta `--cwd` y cada `--add-dir`), aunque el encargo se lo prohíba. Antes de ejecutar, mira qué hay ahí, no solo los archivos del encargo. Si hay datos de pacientes o datos personales (nombres con DNI, diagnósticos, historias clínicas), no ejecutes todavía: dile qué datos son, que saldrán a los servidores de Google, y pregunta si quiere enviarlos igual, anonimizarlos antes o que lo hagas tú. Que el usuario diga «usa agy» no basta: quizá no sabe qué contiene el archivo. Tampoco decidas por tu cuenta que los datos son ficticios o de prueba: pregúntalo.

Con secretos (`.env`, `.dev.vars`, claves, credenciales), el script se detiene solo con el estado `secretos` y la lista. Pregunta al usuario; pasa `--permitir-secretos` solo si dice que sí para esa tarea. Si no, delega desde una carpeta sin esos archivos (por ejemplo, copia ahí solo lo que agy debe leer) o hazlo tú.

## Elegir modelo

Antigravity cambia los modelos sin aviso: un día desaparece Gemini Pro y otro llega una familia nueva (Argon) o una versión nueva, y lo mismo pasa con Claude y GPT. Por eso no elijas por nombre ni por versión: elige por **gama** y **nivel de esfuerzo**, y el script los traduce al mejor modelo que haya hoy.

- **Gama `rapido`:** las familias Flash (y cualquier `lite` o `nano` futura). Para lo mecánico y lo intermedio.
- **Gama `potente`:** todas las demás familias Gemini (hoy Argon; antes Pro; mañana la que llegue). Para lo complejo.
- **Nivel:** `low`, `medium` o `high`. Más nivel es más razonamiento, más minutos y más tokens.

Antes de elegir, si dudas de qué hay hoy, consulta la lista vigente (no gasta tokens; se guarda unas horas y `--refrescar-modelos` la vuelve a pedir):

```bash
node <carpeta de esta skill>/scripts/agy.mjs --modelos
```

Muestra los modelos por familia, qué familias hay en cada gama y a qué modelo se resuelve cada alias. Pasa siempre `--modelo` con un alias o con un nombre exacto de la lista, y el resumen dice cuál usó. Sin `--modelo`, el script usa `rapido-medium`, nunca el modelo por defecto de agy (que puede ser un modelo Claude con cuota más corta).

| Si la tarea es… | Alias |
|---|---|
| Mecánica y corta: extraer, listar, formatear | `rapido-low` |
| Mecánica con algo de criterio: resumir, renombrar en varios archivos | `rapido-medium` (por defecto) |
| Intermedia: borradores, refactorizaciones con criterio, búsquedas con explicación, revisar textos | `rapido-high` |
| Compleja pero acotada: un error sutil en pocos archivos, una decisión de diseño | `potente-medium` |
| La más difícil: arquitectura, auditoría, revisión profunda de un diff | `potente-high` |
| Gemini falló dos veces, o el usuario pide un modelo Claude dentro de agy | `sonnet-low` o `sonnet-medium`, y avisa: gastan una cuota más limitada |
| Solo si el usuario lo pide | `opus`, `gpt-oss` |

Los alias de familia también valen (`flash-high`, `argon-high`, `pro-high`). Si la familia ya no existe, el script usa su gama con el mismo nivel y el resumen lo dice; sin ningún modelo potente, `potente-*` cae en `rapido-high`.

**Regula el esfuerzo:**

- Empieza por el nivel más bajo que alcance para la tarea. Un nivel alto no compensa un encargo vago: primero aclara el encargo.
- Si la respuesta quedó superficial (no vio el error, resumió en vez de analizar, dejó puntos sin responder), sube un nivel, o de `rapido-high` a `potente-medium`, en una tarea nueva con el encargo corregido.
- Si dio `timeout` o `modelo_mudo`, no subas: acota (menos archivos, funciones nombradas, un máximo de hallazgos) o baja de gama.
- La gama potente tarda de 5 a 20 min y a veces se queda muda: úsala solo cuando el criterio importa más que el tiempo, y siempre con `--respaldo`.

La regla de respaldo, los tiempos medidos, los textos de error reales y la lista observada en cada fecha están en [references/modelos.md](references/modelos.md). Léelo si un modelo falla o si dudas entre dos.

## Flujo

### 1. Escribir el encargo en un archivo

Crea una carpeta nueva por encargo **fuera del repositorio** con el script, que la hace única y devuelve su ruta:

```bash
node <carpeta de esta skill>/scripts/agy.mjs --carpeta <tema>
```

La crea en `%TEMP%/delegar-antigravity/<AAAAMMDD-HHMM>-<tema>/` (en Linux y macOS, `/tmp/…`) y agrega un sufijo si ese nombre ya existe. No armes el nombre a mano ni reutilices una carpeta existente: otra sesión en paralelo pudo elegir el mismo nombre, y escribir en su carpeta pisa su encargo. Escribe ahí `encargo.md`; para una corrección de la misma tarea, usa la misma carpeta. Un archivo evita los límites de longitud y los problemas de comillas de la terminal, y la carpeta guarda la salida y la respuesta completas.

Si agy debe trabajar con documentos que no están en un proyecto (secciones extraídas de un documento, textos sueltos), guárdalos en esa misma carpeta y úsala también como `--cwd`: así su espacio de trabajo no incluye nada más. En Windows, la ruta de `--cwd` debe tener menos de 259 caracteres (si no, el script la rechaza): si el directorio temporal de tu sesión es muy profundo, usa `%TEMP%/delegar-antigravity/…`.

Usa esta plantilla y quita lo que no aplique:

```markdown
# Encargo

## Contexto
Proyecto: <ruta absoluta>. Las rutas de abajo son relativas a ella.
<Solo si la tarea toca código del proyecto: «Antes de empezar, lee CLAUDE.md o
AGENTS.md de la raíz, si existen, para seguir sus convenciones.» (y ponlo en Archivos)>
<2–4 líneas de contexto que agy no puede deducir de los archivos>

## Objetivo
<qué hay que lograr, en una o dos frases>

## Archivos
<cada ruta, relativa a la carpeta del proyecto, que debe leer o editar.
Sin comodines como src/*.js: agy intentaría expandirlos con la terminal,
que está denegada, y la tarea queda incompleta>

## Restricciones
- **Terminal: PROHIBIDA.** No ejecutes ningún comando (ni node, ls, cat, git ni
  scripts): una sola petición deja VACÍA tu respuesta y se pierde todo el trabajo.
  <Si los archivos nombran comandos: «Sus resultados ya están en: <archivos>».>
- **Web: PROHIBIDA.** No abras URL ni busques en internet: una URL denegada también
  deja vacía tu respuesta. Trabaja solo con los archivos de la lista.
- Lee solo los archivos de la lista; no busques otros.
- No toques archivos fuera de la lista, ni .env, claves, credenciales o datos personales.
- No hagas commit, push ni borres archivos.
<restricciones propias de la tarea>

## Entregable
<Modo lectura: tu respuesta final ES el entregable, completo y sin preámbulo.
Modo edición: los archivos editados y, si hay un texto largo, <ruta absoluta de la
carpeta del encargo>/resultado.md (con «esta carpeta», agy elige por su cuenta).
Si es una lista de hallazgos o puntos, pon un máximo y un formato corto: «como máximo
6, los más importantes primero, cada uno en 3 líneas»>

## Terminado cuando
<criterio verificable: «las 12 funciones renombradas», «un resumen por archivo»>

## Respuesta final
<Solo en modo edición: «Responde en menos de 120 palabras: qué hiciste, qué archivos
tocaste y qué dudas quedan». En modo lectura, quita esta sección: un límite de palabras
recortaría el entregable.>
```

La terminal y la web están denegadas para agy, y basta una petición para vaciar la respuesta. Si la tarea necesita correr pruebas o comandos, córrelos tú antes o después y pásale la salida en un archivo. Cualquier archivo que nombre comandos (un README, un CLAUDE.md, una guía) tienta al modelo a pedir la terminal: por eso la restricción va en mayúsculas y dice dónde están los resultados.

### 2. Ejecutar con el script

```bash
node <carpeta de esta skill>/scripts/agy.mjs --encargo <carpeta>/encargo.md --cwd <proyecto> --modelo rapido-medium --modo lectura --respaldo
```

- `--modo lectura` (por defecto) le pide no tocar archivos. La respuesta completa queda en `respuesta.md`, aunque sea larga. agy no garantiza la solo lectura (ningún modo de agy lo impide), así que el script avisa con `edito_en_lectura` si cambió algo.
- `--modo edicion` le permite crear y editar archivos en el proyecto y en la carpeta del encargo.
- `--respaldo` reintenta una vez un fallo pasajero de la plataforma y cambia a otro modelo Gemini si hay error de cuota, si el modelo ya no existe o si se quedó mudo. Úsalo salvo que el usuario haya pedido un modelo concreto.
- `--timeout <s>` (por defecto 600). La gama rápida suele tardar menos de un minuto; las revisiones grandes y la gama potente, hasta 20.
- `--esfuerzo low|medium|high` reemplaza el nivel que trae el nombre del modelo.
- `--esquema <archivo.json>` pide una respuesta estructurada: el JSON queda en `respuesta.json`, aunque agy lo haya escrito dentro del texto. Si no trae un JSON válido, el estado es `incompleto`.
- `--add-dir <carpeta>` da acceso a otra carpeta y `--seco` muestra el comando sin ejecutarlo.

El script cierra la entrada estándar, guarda la salida en archivos, corta el proceso si se pasa del tiempo y nunca usa `--dangerously-skip-permissions`. También lee el log de agy de esa ejecución, donde quedan los reintentos internos que no salen en stderr. Cada ejecución agrega una línea a `historial.jsonl` en la carpeta del encargo (modelo, estado, tiempo, tokens, el texto de error de agy y esos reintentos): consúltalo si un fallo no se entiende, porque `agy-errores.txt` se sobrescribe en cada intento. Si la tarea puede tardar más de un par de minutos, ejecútalo en segundo plano si tu entorno lo permite y sigue con otra cosa mientras tanto.

**Varios encargos a la vez.** Crea una carpeta con una subcarpeta por encargo, cada una con su `encargo.md` (y los archivos que deba leer), y lánzalos con una sola llamada:

```bash
node <carpeta de esta skill>/scripts/agy.mjs --lote <carpeta> --modelo rapido-high --respaldo --paralelo 5
```

Corre hasta 5 a la vez, cada uno en su subcarpeta como espacio de trabajo (o en el `--cwd` común que pases) y con las mismas protecciones. Devuelve solo una tabla con el estado de cada uno y deja en cada subcarpeta su `respuesta.md` y su `resumen.json`. Un `--esquema` relativo se busca dentro de cada subcarpeta. Sale con 2 si alguno no terminó en `ok`: lee el `resumen.json` de ese y sigue la tabla de estados. Con un `--cwd` común, cada encargo de edición debe tocar archivos distintos.

**Para saber qué tocó agy,** el script compara los archivos antes y después. Con git, mira los archivos con cambios y los ignorados (como `CLAUDE.md` o `.env`). Sin git, compara las fechas de modificación de todo el árbol, y entonces también ve lo que cambie otro proceso, tú incluido. También vigila la carpeta del encargo y las de `--add-dir`, salvo `encargo.md` y `correccion.md`, que escribes tú. Por eso, delega en un proyecto con git, y no edites tú los archivos del proyecto mientras agy trabaja.

En paralelo sobre el mismo proyecto, cada encargo de edición debe tocar archivos distintos, y las tareas de lectura pueden ver cambios a medio hacer de las otras. La lista de «archivos tocados» puede incluir cambios de otro encargo simultáneo: verifica con el diff.

Si vas a editar un repositorio con cambios sin confirmar, pide al usuario que los confirme o trabaja en una rama o una copia: así el diff de agy queda aislado y se puede deshacer.

### 3. Revisar barato

El script imprime solo un resumen:

```text
estado: ok
modelo: gemini-3.8-flash-medium (pedido: rapido-medium)
tiempo: 24 s de reloj (agy: 21 s activos) · tokens de agy: 76835
conversación: 6e61969b-3aa6-4bc7-bd0f-b69fe586fc36
archivos tocados: src/calculo.js
respuesta (completa en …/respuesta.md):
Agregué multiplicar(a, b) en src/calculo.js y la exporté.
```

Verifica sin releerlo todo: `git diff --stat` y el diff solo de lo que importa, las pruebas del proyecto, o un vistazo a `resultado.md`. Confía en lo que verificas, no en lo que agy dice que hizo. Lee `respuesta.md` completa solo si el resumen aparece recortado y necesitas el resto.

El tiempo de reloj es el que esperó el usuario; los segundos activos de agy solo cuentan lo que trabajó el modelo. Si el resumen trae `generados por agy fuera del proyecto`, son archivos que agy dejó en su propia carpeta (imágenes, planes), aunque su respuesta diga que no pudo crearlos: cópialos a donde hagan falta.

| Estado | Qué hacer |
|---|---|
| `ok` | Verifica y sigue |
| `incompleto` | agy intentó algo denegado o no respondió; `detalle` dice qué. Una sola denegación deja vacía toda la respuesta. Terminal o URL: refuerza la prohibición en el encargo y dale en un archivo lo que buscaba. MCP: quita esa herramienta del encargo. Leer un archivo: da rutas dentro del espacio de trabajo. Luego continúa la conversación |
| `edito_en_lectura` | agy cambió archivos en una tarea de solo lectura. Revisa el diff de esos archivos y revierte lo que no se pidió, sin tocar cambios previos del usuario. Sin git, primero descarta que sean cambios tuyos |
| `cuota` | Repite con `--respaldo` o con otro alias. Si todos fallan, hazlo tú o pregunta al usuario |
| `parcial` | agy terminó con un error o un corte, pero dejó una respuesta. Lee `respuesta.md` antes de nada: suele estar completa o casi. Si está cortada, continúa con `--conversacion` pidiendo solo lo que falta; si el detalle habla del límite de salida, pide menos puntos y en formato corto |
| `timeout` | Si hay `conversación`, rescátala una vez: escribe `correccion.md` pidiendo que entregue ya lo que tenga, sin leer más, y continúa con `--conversacion`. Si el rescate también vence, no insistas: divide la tarea, acota el entregable o hazla tú. Sin conversación, divide la tarea o sube `--timeout` |
| `modelo_mudo` | El modelo leyó todo, pero su llamada final no devolvió nada. **No rescates** (el rescate cae en la misma llamada muda): repite con `--respaldo`, que pasa a la gama rápida, o con otro alias, y acota el encargo. Si ya venía de `--respaldo`, toda la cadena falló: hazla tú o divídela |
| `transitorio` | Un fallo pasajero de la plataforma (sin capacidad, error interno, conexión cortada). `--respaldo` ya reintentó y cambió de modelo; sin él, espera un minuto y repite con `--respaldo` |
| `modelo_invalido` | El modelo no existe hoy: elige otro de `disponibles` o usa un alias |
| `secretos` | El espacio de trabajo tiene secretos: pregunta al usuario antes de usar `--permitir-secretos` |
| `auth` | Pide al usuario que abra `agy` una vez para iniciar sesión |
| `sin_agy` | agy no está instalado; díselo al usuario y haz la tarea tú |
| `error` o `json_invalido` | Lee `detalle` y `agy-errores.txt` en la carpeta del encargo |

### 4. Corregir en la misma conversación

Si el resultado está cerca pero tiene fallos, no lo rehagas tú: escribe `correccion.md` en la misma carpeta con lo que falta y continúa con `--conversacion <id>` del resumen. agy conserva lo que ya leyó, así que la corrección sale más rápida y barata que empezar de nuevo. Tras dos correcciones fallidas, termina tú la tarea o sube de modelo.

### 5. Informar al usuario

En pocas líneas: qué delegaste, con qué modelo, cuánto tardó, el resultado y qué verificaste tú. Por ejemplo:

```text
Delegué a Antigravity (gemini-3.8-flash-medium, 48 s) el renombrado en 14 archivos.
Verifiqué el diff (14 archivos, solo renombres) y las pruebas pasan.
```

Si copiaste documentos del usuario a la carpeta del encargo (secciones de un texto, código de otro proyecto), esa copia queda en el directorio temporal. Al terminar, ofrece borrar la carpeta.

### 6. Anotar lo aprendido

El script anota solo, en un registro central fuera de los proyectos (`~/.delegar-antigravity/incidencias.jsonl`), cada ejecución que no termina en `ok`: estado, modelo, acciones denegadas y el texto de error de agy. Nunca guarda el encargo ni la respuesta. Tú solo agregas la causa cuando la descubres y no es obvia, en una línea, sin datos del usuario:

```bash
node <carpeta de esta skill>/scripts/agy.mjs --anotar "<qué falló, por qué y qué lo resolvió>" --cwd <proyecto>
```

Por ejemplo: «Flash pidió la terminal porque el README del proyecto nombraba comandos; se resolvió dándole la salida en un archivo». No anotes lo que ya explica el `detalle` del resumen. Para ver qué falla más a menudo y qué se aprendió, en cualquier proyecto: `agy.mjs --incidencias`.

## Revisiones y auditorías

Una revisión de un diff grande o de un proyecto entero es lo que más tarda y más tokens gasta. Además, el modelo de agy puede desconocer APIs o versiones recientes y señalar como error algo que es válido.

- Usa `--timeout 1200`, `--respaldo` y pide en el entregable como máximo 6 hallazgos, priorizados y en formato corto: con 10, la respuesta pasó el límite de salida.
- Lista solo los archivos que importan; para un diff, guarda el diff en un archivo de la carpeta del encargo y pásale ese archivo.
- Si el repositorio tiene `CLAUDE.md`, secretos o documentos que agy no debe ver, trabaja sobre una copia: `git archive HEAD` de los archivos que importan, desempaquetada en la carpeta del encargo, más el diff. Usa esa carpeta como `--cwd`.
- Para una segunda opinión de criterio, `potente-high`; para una revisión mecánica (erratas, consistencia), `rapido-high`.
- **Verifica cada hallazgo antes de aplicarlo:** lee el código señalado y, si el hallazgo depende de una API externa, confírmalo en su documentación. Descarta los falsos y dile al usuario cuántos hubo.
- **Recalibra la gravedad:** los modelos rápidos tienden a inflarla y marcan una errata o un detalle de estilo como crítico. Asigna tú el nivel antes de informar.

## Seguridad

- Nunca uses `--dangerously-skip-permissions` sin un sí explícito del usuario para esa tarea.
- Lo que agy lee sale a los servidores de Google: no delegues datos de pacientes, datos clínicos, datos personales, secretos, `.env` ni credenciales sin permiso explícito.
- agy nunca hace commit, push ni publica nada. Tú revisas el diff antes de seguir y pides permiso al usuario para lo que lo requiera.
- No cambies la configuración ni los permisos de agy (`settings.json`) sin pedirlo al usuario.

Para los flags, el formato del JSON, los permisos y las trampas de la CLI, lee [references/agy-cli.md](references/agy-cli.md).
