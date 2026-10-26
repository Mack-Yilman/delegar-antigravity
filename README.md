# Delegar a Antigravity

Una skill para que **Claude Code**, o cualquier otro LLM que disponga de una terminal, **delegue subtareas pesadas a [Antigravity CLI](https://antigravity.google/docs/cli/headless/) (`agy`)** y ahorre sus propios tokens.

El agente actúa como orquestador:

1. **Decide si conviene delegar.** Sí para leer o resumir muchos archivos, borradores largos, cambios mecánicos en varios archivos, búsquedas amplias o una segunda opinión. No para tareas pequeñas, datos confidenciales ni acciones que requieren tu autorización.
2. **Elige el modelo por gama y nivel de esfuerzo,** no por nombre, porque Antigravity cambia los modelos sin aviso: la gama rápida (Gemini Flash) para lo mecánico e intermedio, y la gama potente (hoy Gemini 4 Argon, antes Pro) para lo complejo. El script traduce la gama al mejor modelo de la lista vigente de `agy models`, así que una familia o versión nueva entra sola. Los modelos Claude dentro de Antigravity se usan solo si Gemini falla o tú los pides.
3. **Escribe el encargo** en un archivo fuera de tu repositorio, en una carpeta única que crea el script (así dos sesiones en paralelo nunca comparten carpeta), con una plantilla que prohíbe a agy la terminal y la web, porque una sola petición le deja la respuesta vacía.
4. **Ejecuta agy** con un script que devuelve un resumen de pocas líneas. La respuesta completa queda en un archivo.
5. **Verifica** con el diff o las pruebas, corrige en la misma conversación si hace falta y te informa en pocas líneas.
6. **Anota lo aprendido** en un registro central de incidencias, común a todos tus proyectos.

```text
estado: ok
modelo: gemini-3.8-flash-medium (pedido: rapido-medium)
tiempo: 104 s de reloj (agy: 99 s activos) · tokens de agy: 105521
archivos tocados: src/almacen.js, src/clientes.js, src/envios.js, src/facturas.js, src/pedidos.js, src/productos.js
respuesta (completa en …/respuesta.md):
Renombré obtenerDato a leerDato en la definición, la exportación y las llamadas de los 6 archivos.
```

## Requisitos

- [Antigravity CLI](https://antigravity.google/docs/cli/) (`agy`) instalado y con la sesión iniciada: ábrelo una vez de forma interactiva.
- Node.js 22 o superior.
- Claude Code, o cualquier otro LLM con terminal que cargue skills. **No sirve en chats sin terminal** (app de Gemini, Claude.ai), porque necesita ejecutar `agy`.

## Instalación

**Windows (PowerShell), con menú:**

```powershell
irm https://raw.githubusercontent.com/Mack-Yilman/delegar-antigravity/main/install.ps1 | iex
```

**Sin menú,** directo a Claude Code (también `descargas` o `todos`):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Mack-Yilman/delegar-antigravity/main/install.ps1))) -Destino claude-code
```

**Con `npx`,** para uno o varios agentes a la vez:

```bash
npx skills add Mack-Yilman/delegar-antigravity
```

**A mano:** descarga [delegar-antigravity.zip](https://github.com/Mack-Yilman/delegar-antigravity/releases/latest/download/delegar-antigravity.zip) y descomprímelo en la carpeta de skills de tu agente:

| Agente | Carpeta |
|---|---|
| Claude Code | `~/.claude/skills/` o `.claude/skills/` del proyecto |
| Otro LLM con terminal | La carpeta de skills que indique su documentación |

**Pidiéndoselo a tu agente:** pega este mensaje:

> Instala la skill de https://github.com/Mack-Yilman/delegar-antigravity: copia la carpeta skills/delegar-antigravity completa (SKILL.md, LICENSE.txt, scripts/ y references/) en tu carpeta de skills de usuario.

## Uso

Pídelo con frases como «delega esto», «usa Antigravity», «usa agy», «que lo haga Gemini», «ahorra tokens» o «hazlo en paralelo con otro agente». El agente también te propondrá delegar cuando vea una tarea grande y mecánica.

El script también se puede usar directamente:

```bash
# Crea una carpeta de encargo única e imprime su ruta; escribe ahí encargo.md
node skills/delegar-antigravity/scripts/agy.mjs --carpeta resumen-src
node skills/delegar-antigravity/scripts/agy.mjs --encargo <carpeta>/encargo.md --cwd <proyecto> --modelo rapido-medium --modo lectura --respaldo
```

**Qué modelo pedir.** Se pide por gama y nivel de esfuerzo, y el script elige el mejor modelo que haya hoy:

| Tarea | Alias |
|---|---|
| Mecánica: extraer, listar, formatear, resumir | `rapido-low` o `rapido-medium` (por defecto) |
| Intermedia: borradores, refactorizaciones, revisar textos | `rapido-high` |
| Compleja pero acotada: un error sutil en pocos archivos | `potente-medium` |
| La más difícil: arquitectura, auditoría, revisión profunda | `potente-high` (de 5 a 20 min) |

La gama rápida son las familias Flash; la potente, todas las demás (hoy Gemini 4 Argon). Una familia o versión nueva entra sola, sin actualizar la skill.

| Opción | Para qué |
|---|---|
| `--carpeta <tema>` | Crea en `%TEMP%/delegar-antigravity/` una carpeta de encargo nueva (`<fecha>-<hora>-<tema>`, con sufijo si ya existe) e imprime su ruta |
| `--modo lectura` / `edicion` | Solo lectura (por defecto) o crear y editar archivos |
| `--modelos` | Lista los modelos vigentes por familia, qué familias hay en cada gama y a qué modelo se resuelve cada alias hoy |
| `--modelo <alias o nombre>` | Un alias de gama (`rapido-low`, `rapido-medium`, `rapido-high`, `potente-low`, `potente-medium`, `potente-high`), de familia (`flash-high`, `argon-high`, `sonnet-low`…) o un nombre exacto. Se resuelve a la versión más alta de `agy models`; por defecto `rapido-medium`. Si una familia desaparece, su alias pasa a su gama (hoy `pro-high` usa Argon High) |
| `--respaldo` | Reintenta una vez un fallo pasajero (sin capacidad, error interno, conexión cortada) y, ante un error de cuota, un modelo que ya no existe o uno que se quedó mudo, prueba otro modelo Gemini |
| `--lote <carpeta>` | Corre cada subcarpeta que tenga `encargo.md`, hasta 5 a la vez (`--paralelo`), y devuelve una tabla |
| `--esquema <archivo.json>` | Pide una respuesta estructurada; el JSON queda en `respuesta.json` aunque agy lo escriba dentro del texto |
| `--permitir-secretos` | Ejecuta aunque el espacio de trabajo tenga `.env`, claves o credenciales; el agente solo lo usa con tu permiso |
| `--conversacion <id>` | Continúa una conversación anterior, para corregir |
| `--timeout <s>` | Tiempo límite, por defecto 600; usa 1200 para revisiones grandes |
| `--formato json` | Resumen en JSON en lugar de texto |
| `--seco` | Muestra el comando sin ejecutarlo |
| `--anotar "<lección>"` | Guarda en el registro central la causa de un fallo y cómo se resolvió |
| `--incidencias` | Resume en markdown el registro central: qué falla, con qué modelo y qué se aprendió |

Códigos de salida: `0` ok; `2` incompleto (acción denegada o respuesta vacía), parcial (un error que dejó respuesta), archivos editados en una tarea de lectura o un lote con fallos; `3` cuota agotada; `4` secretos en el espacio de trabajo y `1` otros errores (entre ellos `modelo_mudo` y `transitorio`).

El script lee además el log que agy deja por cada ejecución en `~/.gemini/antigravity-cli/log/`, porque ahí quedan los reintentos internos que no salen en su salida: así distingue un modelo que se quedó mudo de un simple tiempo agotado. Y avisa si agy dejó archivos en su carpeta `brain/` (imágenes, planes) en lugar del proyecto.

La lista de `agy models` tarda unos 12 s, así que el script la guarda unas horas en la carpeta temporal y la refresca si agy rechaza un modelo (o con `--refrescar-modelos`).

**Lo que queda guardado:**

- En la carpeta del encargo: `respuesta.md` con la respuesta completa (y `respuesta.json` con `--esquema`), `agy-salida.json` y `agy-errores.txt` de la última ejecución, `historial.jsonl` con una línea por ejecución y, en un lote, `resumen.json`.
- En `~/.delegar-antigravity/incidencias.jsonl`: un registro central, fuera de tus proyectos, de cada ejecución que no terminó en `ok` y de las lecciones anotadas con `--anotar`. Guarda el estado, el modelo, las acciones denegadas y el texto de error de agy, nunca el encargo ni la respuesta. Sirve para ver qué falla en todos tus proyectos y mejorar la skill. Puedes cambiar la ruta con la variable `DELEGAR_AGY_INCIDENCIAS`.

## Seguridad y privacidad

- Lo que lee agy se envía a los servidores de Google, y agy puede leer cualquier archivo de su espacio de trabajo aunque el encargo se lo prohíba. La skill no delega datos de pacientes, datos personales, secretos ni credenciales sin tu permiso explícito, y el script se detiene solo si encuentra `.env`, `.dev.vars`, claves o credenciales (también `client_secret*.json`, cuentas de servicio y `.netrc`). Si copias documentos a la carpeta del encargo, el agente te ofrece borrarla al terminar.
- agy trabaja con la terminal bloqueada (`--sandbox`) y nunca con `--dangerously-skip-permissions`. Ningún modo de agy impide que edite archivos: en una tarea de lectura, el script compara los archivos antes y después y avisa si cambió alguno. agy nunca hace commit, push ni publica nada: el agente revisa el diff y te pide permiso para lo demás.
- Cada delegación gasta la cuota de Antigravity, no la de tu agente.

## Licencia

[CC BY-NC-ND 4.0](LICENSE) © 2026 Mack Chirinos: uso libre citando al autor, sin fines comerciales ni versiones modificadas sin autorización.
