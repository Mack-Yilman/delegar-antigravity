# Delegar a Antigravity

Una skill para que tu agente de programación (Claude Code, Gemini CLI u otro con terminal) **delegue subtareas pesadas a [Antigravity CLI](https://antigravity.google/docs/cli/headless/) (`agy`)** y ahorre sus propios tokens.

El agente actúa como orquestador:

1. **Decide si conviene delegar.** Sí para leer o resumir muchos archivos, borradores largos, cambios mecánicos en varios archivos, búsquedas amplias o una segunda opinión. No para tareas pequeñas, datos confidenciales ni acciones que requieren tu autorización.
2. **Elige el modelo**: Gemini Flash para lo mecánico y Gemini Pro para lo difícil. Los modelos Claude dentro de Antigravity se usan solo si Gemini falla o tú los pides.
3. **Escribe el encargo** en un archivo fuera de tu repositorio, con una plantilla.
4. **Ejecuta agy** con un script que devuelve un resumen de pocas líneas. La respuesta completa queda en un archivo.
5. **Verifica** con el diff o las pruebas, corrige en la misma conversación si hace falta y te informa en pocas líneas.

```text
estado: ok
modelo: gemini-3.8-flash-medium
tiempo: 99 s · tokens de agy: 105521
archivos tocados: src/almacen.js, src/clientes.js, src/envios.js, src/facturas.js, src/pedidos.js, src/productos.js
respuesta (completa en …/respuesta.md):
Renombré obtenerDato a leerDato en la definición, la exportación y las llamadas de los 6 archivos.
```

## Requisitos

- [Antigravity CLI](https://antigravity.google/docs/cli/) (`agy`) instalado y con la sesión iniciada: ábrelo una vez de forma interactiva.
- Node.js 22 o superior.
- Un agente con terminal que cargue skills (Claude Code, Gemini CLI, Codex…). **No sirve en chats sin terminal** (app de Gemini, Claude.ai), porque necesita ejecutar `agy`.

## Instalación

**Windows (PowerShell), con menú:**

```powershell
irm https://raw.githubusercontent.com/Mack-Yilman/delegar-antigravity/main/install.ps1 | iex
```

**Sin menú,** directo a Claude Code (también `gemini-cli`, `descargas` o `todos`):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Mack-Yilman/delegar-antigravity/main/install.ps1))) -Destino claude-code
```

**Con `npx`,** para uno o varios agentes a la vez:

```bash
npx skills add Mack-Yilman/delegar-antigravity
```

**Gemini CLI:**

```bash
gemini skills install https://github.com/Mack-Yilman/delegar-antigravity --path skills/delegar-antigravity
```

**A mano:** descarga [delegar-antigravity.zip](https://github.com/Mack-Yilman/delegar-antigravity/releases/latest/download/delegar-antigravity.zip) y descomprímelo en la carpeta de skills de tu agente:

| Agente | Carpeta |
|---|---|
| Claude Code | `~/.claude/skills/` o `.claude/skills/` del proyecto |
| Gemini CLI | `~/.gemini/skills/` |
| Otros | La carpeta de skills que indique su documentación |

**Pidiéndoselo a tu agente:** pega este mensaje:

> Instala la skill de https://github.com/Mack-Yilman/delegar-antigravity: copia la carpeta skills/delegar-antigravity completa (SKILL.md, LICENSE.txt, scripts/ y references/) en tu carpeta de skills de usuario.

## Uso

Pídelo con frases como «delega esto», «usa Antigravity», «usa agy», «que lo haga Gemini», «ahorra tokens» o «hazlo en paralelo con otro agente». El agente también te propondrá delegar cuando vea una tarea grande y mecánica.

El script también se puede usar directamente:

```bash
node skills/delegar-antigravity/scripts/agy.mjs --encargo encargo.md --cwd <proyecto> --modelo gemini-3.8-flash-medium --modo lectura --respaldo
```

| Opción | Para qué |
|---|---|
| `--modo lectura` / `edicion` | Solo lectura (por defecto) o crear y editar archivos |
| `--modelo <nombre>` | Modelo de `agy models`; por defecto `gemini-3.8-flash-medium` |
| `--respaldo` | Ante un error de cuota, prueba el siguiente modelo Gemini de la cadena |
| `--conversacion <id>` | Continúa una conversación anterior, para corregir |
| `--timeout <s>` | Tiempo límite, por defecto 600 |
| `--formato json` | Resumen en JSON en lugar de texto |
| `--seco` | Muestra el comando sin ejecutarlo |

Códigos de salida: `0` ok, `2` incompleto (acción denegada o respuesta vacía), `3` cuota agotada y `1` otros errores.

## Seguridad y privacidad

- Lo que lee agy se envía a los servidores de Google. La skill no delega datos de pacientes, datos personales, secretos ni credenciales sin tu permiso explícito.
- agy trabaja con la terminal bloqueada (`--sandbox`) y nunca con `--dangerously-skip-permissions`. Puede crear y editar archivos solo en modo edición, y nunca hace commit, push ni publica nada: el agente revisa el diff y te pide permiso para lo demás.
- Cada delegación gasta la cuota de Antigravity, no la de tu agente.

## Licencia

[CC BY-NC-ND 4.0](LICENSE) © 2026 Mack Chirinos: uso libre citando al autor, sin fines comerciales ni versiones modificadas sin autorización.
