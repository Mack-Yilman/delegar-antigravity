---
name: delegar-antigravity
description: "Delega subtareas pesadas a Antigravity CLI (agy) para ahorrar tus propios tokens: decides si conviene, eliges el modelo Gemini, escribes el encargo en un archivo, lo ejecutas con un script que devuelve un resumen breve y verificas el resultado. Úsala cuando el usuario diga «delega esto», «usa Antigravity», «usa agy», «que lo haga Gemini», «ahorra tokens», «pásaselo a otro agente» o «hazlo en paralelo con otro agente». Propón usarla por tu cuenta cuando la tarea sea grande y mecánica: leer o resumir muchos archivos, redactar borradores largos, refactorizaciones repetitivas en varios archivos, búsquedas amplias en un repositorio o una segunda opinión sobre un diff o un documento."
license: CC BY-NC-ND 4.0
---

## Qué es

Tú eres el orquestador y Antigravity CLI (`agy`) es un ayudante con su propia cuota de modelos. Tú decides qué delegar, redactas el encargo, revisas un resumen breve y verificas. agy hace el trabajo pesado: leer muchos archivos, generar texto largo o editar código.

Delegar ahorra cuando lo que agy va a leer o escribir es mucho mayor que lo que te cuesta escribir el encargo (unas 20 líneas) y leer el resumen (unas 10). Cada llamada tarda entre 15 s y unos minutos, y gasta entre 30 y 100 mil tokens de la cuota de Antigravity, no de la tuya.

## ¿Conviene delegar?

| Si la tarea es… | Decide |
|---|---|
| Leer, resumir o comparar muchos archivos o documentos largos | Delega en modo lectura |
| Un borrador largo (documentación, informe, pruebas) con instrucciones claras | Delega; pide el borrador en un archivo |
| Un cambio mecánico repetido en varios archivos (renombrar, migrar una API, formato) | Delega en modo edición |
| Buscar en todo un repositorio dónde se usa algo y explicarlo | Delega en modo lectura |
| Una segunda opinión sobre un diff, un plan o un texto | Delega en modo lectura, con otro modelo que el tuyo |
| Varias subtareas independientes a la vez | Delega cada una en paralelo, con su propio encargo |
| Pequeña: menos de unos 3 archivos o una edición puntual | Hazla tú: el encargo costaría más que la tarea |
| Depende de lo hablado en esta conversación o de tu criterio fino | Hazla tú, o resume ese contexto en el encargo si es corto |
| Incluye datos de pacientes, datos clínicos, datos personales, secretos, `.env`, claves o credenciales | No delegues sin permiso explícito del usuario: lo que lee agy sale a los servidores de Google |
| Requiere autorización del usuario: push, publicar, borrar, enviar correos, tocar Drive o servicios externos | Nunca la delegues; agy solo prepara, tú pides permiso y ejecutas |

La tabla sirve para decidir por tu cuenta. **Si el usuario pide delegar** («delega esto», «usa agy»), delega aunque la tarea sea pequeña o dependa de la conversación: él decidió gastar la cuota de Antigravity en lugar de la tuya. Como mucho, coméntale en una línea que habría salido más barato hacerlo tú. Las dos últimas filas son la excepción: datos sensibles y acciones que requieren autorización.

Si el usuario no pidió delegar y la tarea encaja en las filas de arriba, propónlo en una línea («Esto es grande y mecánico; ¿lo delego a Antigravity con Gemini Flash?») y espera su respuesta.

**Datos sensibles, aunque el usuario pida usar agy.** Antes de ejecutar, mira qué archivos va a leer agy. Si contienen datos de pacientes o datos personales (nombres con DNI, diagnósticos, historias clínicas), secretos o credenciales, no ejecutes todavía. Dile qué datos son, que saldrán a los servidores de Google, y pregunta si quiere enviarlos igual, anonimizarlos antes o que lo hagas tú. Que el usuario diga «usa agy» no basta: quizá no sabe qué contiene el archivo. Tampoco decidas por tu cuenta que los datos son ficticios o de prueba: pregúntalo.

## Elegir modelo

Pasa siempre `--modelo`: si no, agy usaría el modelo por defecto de su configuración, que puede ser un modelo Claude con cuota más corta.

| Si la tarea es… | Modelo |
|---|---|
| Mecánica: resumir, extraer, renombrar, formatear | `gemini-3.8-flash-low` o `gemini-3.8-flash-medium` (por defecto) |
| Intermedia: borradores, refactorizaciones con criterio, búsquedas con explicación | `gemini-3.8-flash-high` o `gemini-3.1-pro-low` |
| Razonamiento difícil: arquitectura, errores sutiles, revisión exigente | `gemini-3.1-pro-high` |
| Gemini falló dos veces, o el usuario pide un modelo Claude dentro de agy | `claude-sonnet-5-5-low` o `-medium`, y avisa: gastan una cuota más limitada |

La cadena de respaldo ante un error de cuota, los tiempos medidos y cómo confirmar los nombres vigentes están en [references/modelos.md](references/modelos.md). Léelo si un modelo falla o si dudas entre dos.

## Flujo

### 1. Escribir el encargo en un archivo

Crea una carpeta nueva por encargo **fuera del repositorio**: el directorio temporal de tu sesión si tienes uno, o `%TEMP%/delegar-antigravity/<AAAAMMDD-HHMM>-<tema>/` (en Linux y macOS, `/tmp/…`). Escribe ahí `encargo.md`. Un archivo evita los límites de longitud y los problemas de comillas de la terminal, y la carpeta guarda la salida y la respuesta completas.

Usa esta plantilla y quita lo que no aplique:

```markdown
# Encargo

## Contexto
Proyecto: <ruta absoluta>. Antes de empezar, lee CLAUDE.md, AGENTS.md o README.md
de la raíz del proyecto si existen, para entender sus convenciones.
<2–4 líneas de contexto que agy no puede deducir de los archivos>

## Objetivo
<qué hay que lograr, en una o dos frases>

## Archivos
<cada ruta, relativa a la carpeta del proyecto, que debe leer o editar.
Sin comodines como src/*.js: agy intentaría expandirlos con la terminal,
que está denegada, y la tarea queda incompleta>

## Restricciones
- No uses la terminal: no ejecutes comandos.
- No toques archivos fuera de la lista, ni .env, claves, credenciales o datos personales.
- No hagas commit, push ni borres archivos.
<restricciones propias de la tarea>

## Entregable
<qué produce. En modo lectura, va en la respuesta final.
En modo edición, un entregable largo va en <carpeta del encargo>/resultado.md>

## Terminado cuando
<criterio verificable: «las 12 funciones renombradas», «un resumen por archivo»>

## Respuesta final
Responde en menos de 120 palabras: qué hiciste, qué archivos tocaste y qué dudas quedan.
```

La terminal está denegada para agy: si la tarea necesita correr pruebas o comandos, córrelos tú después.

### 2. Ejecutar con el script

```bash
node <carpeta de esta skill>/scripts/agy.mjs --encargo <carpeta>/encargo.md --cwd <proyecto> --modelo gemini-3.8-flash-medium --modo lectura
```

- `--modo lectura` (por defecto) le pide no tocar archivos. La respuesta completa queda en `respuesta.md`, aunque sea larga. agy no garantiza la solo lectura (ningún modo de agy lo impide), así que el script avisa con `edito_en_lectura` si cambió algo.
- `--modo edicion` le permite crear y editar archivos en el proyecto y en la carpeta del encargo.
- `--respaldo` cambia al siguiente modelo de la cadena si hay error de cuota. Úsalo salvo que el usuario haya pedido un modelo concreto.
- `--timeout <s>` (por defecto 600). Flash suele tardar menos de un minuto; Pro High, varios.
- `--esfuerzo low|medium|high` reemplaza el nivel que trae el nombre del modelo.
- `--add-dir <carpeta>` da acceso a otra carpeta, `--esquema <archivo.json>` pide una respuesta estructurada y `--seco` muestra el comando sin ejecutarlo.

El script cierra la entrada estándar, guarda la salida en archivos, corta el proceso si se pasa del tiempo y nunca usa `--dangerously-skip-permissions`. Si la tarea puede tardar más de un par de minutos, o lanzas varias en paralelo, ejecútalo en segundo plano si tu entorno lo permite y sigue con otra cosa mientras tanto.

En paralelo sobre el mismo proyecto, cada encargo de edición debe tocar archivos distintos, y las tareas de lectura pueden ver cambios a medio hacer de las otras. La lista de «archivos tocados» compara git antes y después, así que puede incluir cambios de otro encargo simultáneo: verifica con el diff.

Si vas a editar un repositorio con cambios sin confirmar, pide al usuario que los confirme o trabaja en una rama o una copia: así el diff de agy queda aislado y se puede deshacer.

### 3. Revisar barato

El script imprime solo un resumen:

```text
estado: ok
modelo: gemini-3.8-flash-medium
tiempo: 21 s · tokens de agy: 76835
conversación: 6e61969b-3aa6-4bc7-bd0f-b69fe586fc36
archivos tocados: src/calculo.js
respuesta (completa en …/respuesta.md):
Agregué multiplicar(a, b) en src/calculo.js y la exporté.
```

Verifica sin releerlo todo: `git diff --stat` y el diff solo de lo que importa, las pruebas del proyecto, o un vistazo a `resultado.md`. Confía en lo que verificas, no en lo que agy dice que hizo. Lee `respuesta.md` completa solo si el resumen aparece recortado y necesitas el resto.

| Estado | Qué hacer |
|---|---|
| `ok` | Verifica y sigue |
| `incompleto` | agy intentó algo denegado (casi siempre la terminal) o no respondió. Reescribe el encargo sin esa necesidad y continúa la conversación |
| `edito_en_lectura` | agy cambió archivos en una tarea de solo lectura. Revisa el diff de esos archivos y revierte lo que no se pidió, sin tocar cambios previos del usuario |
| `cuota` | Repite con `--respaldo` o con otro modelo de la cadena. Si todos fallan, hazlo tú o pregunta al usuario |
| `timeout` | Divide la tarea o sube `--timeout`; revisa con `git status` lo que alcanzó a cambiar |
| `modelo_invalido` | Ejecuta `agy models` y usa un nombre de la lista |
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

## Seguridad

- Nunca uses `--dangerously-skip-permissions` sin un sí explícito del usuario para esa tarea.
- Lo que agy lee sale a los servidores de Google: no delegues datos de pacientes, datos clínicos, datos personales, secretos, `.env` ni credenciales sin permiso explícito.
- agy nunca hace commit, push ni publica nada. Tú revisas el diff antes de seguir y pides permiso al usuario para lo que lo requiera.
- No cambies la configuración ni los permisos de agy (`settings.json`) sin pedirlo al usuario.

Para los flags, el formato del JSON, los permisos y las trampas de la CLI, lee [references/agy-cli.md](references/agy-cli.md).
