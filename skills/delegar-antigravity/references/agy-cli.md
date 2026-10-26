# Referencia de Antigravity CLI (agy) en modo no interactivo

Comprobado con agy 1.3.3 en Windows 11 (2026-10-11 a 15) y con la documentación oficial: antigravity.google/docs/cli/headless, /docs/permissions?tab=cli y /docs/cli/modes. Cuando la documentación y `agy --help` no coinciden, manda lo que hace el binario instalado.

## Flags útiles

| Flag | Para qué |
|---|---|
| `-p "<mensaje>"` | Ejecuta un mensaje y termina (alias `--print`, `--prompt`) |
| `--output-format json` | Un solo objeto JSON al final; `stream-json` emite eventos NDJSON |
| `--model <slug>` | Modelo exacto de `agy models`. El script acepta alias de gama (`rapido-medium`, `potente-high`) o de familia (`flash-medium`) y los resuelve con esa lista |
| `--mode plan` | Según la documentación, solo herramientas de lectura. En modo no interactivo **no impide editar** (comprobado) y a veces prepara un plan en lugar de responder |
| `--mode accept-edits` | Aprueba crear y editar archivos. Sin `--mode`, agy también edita en modo no interactivo (comprobado) |
| `--sandbox` | Restringe la terminal al sandbox del sistema |
| `--print-timeout 600s` | Tiempo límite; la ayuda dice 0s (sin límite) y la documentación 5m: pásalo siempre |
| `--add-dir <carpeta>` | Agrega una carpeta al espacio de trabajo (se puede repetir) |
| `--conversation <id>` / `-c` | Continúa una conversación por ID, o la última |
| `--json-schema <archivo>` | Fuerza una salida estructurada en `structured_output` |
| `--effort low…max` | Esfuerzo de razonamiento. Solo con el nombre base del modelo (`gemini-3.8-flash`); con un nivel en el nombre, agy lo rechaza |
| `--dangerously-skip-permissions` | Aprueba todo, incluida la terminal. No lo uses sin un sí explícito del usuario |

## Salida JSON

```json
{"conversation_id":"…","status":"SUCCESS","response":"…","duration_seconds":13.9,"num_turns":1,
 "usage":{"input_tokens":65192,"output_tokens":739,"thinking_tokens":0,"cache_read_tokens":14277,"total_tokens":65931},
 "denied_actions":[{"action":"command","display_name":"RunCommand"}]}
```

- `status`: `SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`, `INVALID`, `WAITING` o `RUNNING`. Con `ERROR` aparece `error`.
- `denied_actions` solo aparece si se denegó algo.
- Al continuar una conversación, `num_turns` y `usage` son acumulados.
- `response` enlaza los archivos como `[nombre](file:///C:/ruta)`; el script los convierte en rutas relativas.

## Permisos en modo no interactivo

- **Archivos:** dentro del espacio de trabajo (el directorio actual más cada `--add-dir`), agy lee y escribe sin preguntar, **en cualquier modo**. Las ediciones caen en los archivos reales del proyecto. Ningún flag garantiza la solo lectura: el script lo pide en el mensaje y comprueba después qué archivos cambiaron.
- **Terminal:** se deniega sin preguntar. agy sale con código 0, `status` `SUCCESS`, `response` vacío, `denied_actions` y un aviso en la salida de errores. El script lo clasifica como `incompleto`.
- **MCP:** sin regla, toda llamada a una herramienta MCP se deniega igual que la terminal (`denied_actions: [{action: "mcp", display_name: "CallMcpTool"}]`). Se permite con `mcp(servidor/herramienta)` en `permissions.allow`.
- **Web:** abrir una URL (`read_url`) también se deniega y vacía la respuesta (comprobado el 2026-10-13).
- **Una sola denegación vacía toda la respuesta,** aunque otras llamadas hayan funcionado. Para probar permisos, haz una llamada por encargo.
- **Reglas:** se pueden permitir comandos en `~/.gemini/antigravity-cli/settings.json`, con `"permissions": {"allow": ["command(git status)"]}`. La prioridad es deny > ask > allow, y en Windows un comando con subcomandos necesita `regex:`. Cambiar esa configuración es decisión del usuario.

## Contexto que agy carga por sí solo

`AGENTS.md`, `GEMINI.md` y `.agents/rules/*.md` del proyecto, y `~/.gemini/GEMINI.md`. **No carga `CLAUDE.md`** (comprobado): por eso la plantilla del encargo le pide leerlo. También carga las skills de `~/.gemini/config/skills/` y los servidores MCP de `~/.gemini/config/mcp_config.json` (comprobado el 2026-10-12).

## Trampas

| Trampa | Solución |
|---|---|
| Con la entrada estándar abierta, agy espera para siempre | El script la cierra |
| Capturar la salida con una tubería: un proceso nieto puede retenerla y bloquear al orquestador | El script escribe la salida en archivos |
| Pedirle que busque un archivo «en algún lugar»: recorre todo el disco | Da rutas relativas al proyecto en el encargo |
| Un comodín en el encargo (`src/*.js`): agy intenta expandirlo con la terminal, se lo deniegan y la respuesta queda vacía o a medias (comprobado) | Lista cada archivo por su nombre; obtén la lista tú antes de escribir el encargo |
| Los archivos que lee nombran comandos (un README, un CLAUDE.md, una guía con `node script.mjs …`): Flash High pidió la terminal aunque el encargo decía «no la uses», y perdió 161 s de trabajo (2026-10-15) | «**Terminal: PROHIBIDA.** … una sola petición deja VACÍA tu respuesta», más dónde están ya los resultados de esos comandos. Con ese texto, 8 de 8 ejecuciones terminaron `ok`. Si el archivo no es necesario, no se lo pases |
| El encargo sugiere consultar una fuente en línea y agy abre la URL: denegada, respuesta vacía | «**Web: PROHIBIDA**» en el encargo; si necesita esa fuente, descárgala tú y pásala como archivo |
| Comparar dos textos largos palabra por palabra: Flash High agotó el tiempo razonando, y el rescate «entrega ya» también (2026-10-14) | Un script determinista. agy sirve para juzgar las diferencias que el script encuentre |
| Mensajes largos o con comillas como argumento en Windows | El mensaje solo apunta al archivo del encargo |
| El modelo por defecto de agy puede ser un modelo Claude | El script pasa siempre `--model` |
| La carpeta del proyecto no está entre las confiables de agy | No afecta al modo no interactivo (comprobado) |
| Con varias carpetas en el espacio de trabajo, una ruta relativa puede resolverse en la equivocada | El encargo dice la ruta absoluta del proyecto y que las rutas son relativas a ella |
| Varios agy a la vez en el mismo proyecto ven los cambios a medio hacer de los otros | En paralelo, cada encargo de edición toca archivos distintos |
| Sin sesión iniciada, agy falla con «authentication required» | El usuario abre `agy` una vez de forma interactiva |
| agy lee secretos del espacio de trabajo (`.dev.vars`, `.env`) aunque el encargo lo prohíba (comprobado) | El script se detiene con `secretos`; delega desde una carpeta sin ellos o con el permiso del usuario |
| Los modelos cambian sin aviso: un nombre que ayer funcionaba da «invalid model selection» | El script resuelve alias con `agy models` y, con `--respaldo`, salta al siguiente |
| En una revisión grande, agy gasta todo `--print-timeout` razonando y responde vacío | Pide un máximo de hallazgos; rescata la conversación con «entrega ya lo que tengas» |
| Con `--mode accept-edits`, una vez agy quedó `incompleto` por `read_file` denegado, sin decir qué archivo; en modo lectura, la misma carpeta funcionó (causa sin confirmar) | Da rutas dentro de `--cwd`; si se repite, haz tú la edición |
| En modo edición, «guárdalo en esta carpeta» hizo que agy escribiera junto al encargo y no en `--cwd` (2026-10-15) | Nombra la carpeta de destino con su ruta absoluta |
| agy genera imágenes con un subagente (`generate_image`, que acepta fotos de entrada), pero las guarda en `brain/<conversación>/` como JPG y luego responde que no tiene esa herramienta (2026-10-20) | El script las lista en `generados`; cópialas tú. Con fotos de personas reales altera el rostro aunque el prompt lo prohíba |
| `duration_seconds` del JSON es tiempo activo del modelo, no de reloj | El script mide el reloj aparte |

## Log y carpeta de cada conversación

- **`~/.gemini/antigravity-cli/log/cli-<AAAAMMDD_HHMMSS>.log`:** uno por ejecución. Trae `Created conversation <id>` y los reintentos internos de agy, que no salen en stderr ni en el JSON:
  - `run.go] Run: attempt 1 failed (<motivo>), retrying in 4s`, donde el motivo es «stream idle timeout (5m0s)», «UNAVAILABLE (code 503)…» o «INTERNAL (code 500)…»;
  - `poll.go] Print mode: print timeout after <t> with turn in progress after <n> polls (printed=<n>)`.

  Los errores de los hooks de agy van a otro archivo, `~/.gemini/antigravity-cli/cli.log`. El script busca el log por el id de la conversación (variable `DELEGAR_AGY_HOME` para otra carpeta).
- **`~/.gemini/antigravity-cli/brain/<id>/`:** lo que agy genera en esa conversación (imágenes, `plan.md`), más su transcripción interna en `.system_generated/`, que el script no lista.
