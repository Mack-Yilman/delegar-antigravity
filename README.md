# Delegar a Antigravity

Una skill para que **Claude Code**, o cualquier otro LLM que disponga de una terminal, **delegue subtareas pesadas a [Antigravity CLI](https://antigravity.google/docs/cli/headless/) (`agy`)** y ahorre sus propios tokens.

El agente actúa como orquestador:

1. **Decide si conviene delegar.** Sí para leer o resumir muchos archivos, borradores largos, cambios mecánicos en varios archivos, búsquedas amplias o una segunda opinión. No para tareas pequeñas, datos confidenciales ni acciones que requieren tu autorización.
2. **Elige el modelo por gama, nivel y costo,** no por nombre, porque Antigravity cambia los modelos sin aviso. Primero mira si basta un script sin IA; si no, Gemini 4 Hydrogen para casi todo (el modelo por defecto), Gemini 4 Neon para lo complejo, el Orchestrator para tareas largas con terminal y Gemini 4 Carbon solo para lo más difícil. Como todos los Gemini comparten una cuota que se gasta según el precio de los tokens, el agente conoce el precio de cada modelo en cada fecha y cuánta cuota gastó cada delegación. Los niveles Extra (`xhigh`) y `max` solo se usan si tú los pides. Lo que Google retira (3.8 Flash y Argon, el 30/11/2026) deja de usarse solo. Los modelos Claude dentro de Antigravity se usan solo si Gemini falla o tú los pides.
3. **Escribe el encargo** en un archivo fuera de tu repositorio, en una carpeta única que crea el script (así dos sesiones en paralelo nunca comparten carpeta). Por defecto, la plantilla le prohíbe a agy la terminal y la web, porque una sola petición denegada le deja la respuesta vacía.
4. **Le da solo los accesos que hacen falta,** en cada llamada: agy trabaja como su subagente, le propone un plan y le pide permiso (ver [Terminal bajo control](#terminal-bajo-control)).
5. **Ejecuta agy** con un script que devuelve un resumen de pocas líneas. La respuesta completa queda en un archivo.
6. **Verifica** con el diff o las pruebas, corrige en la misma conversación si hace falta y te informa en pocas líneas.
7. **Anota lo aprendido** en un registro central de incidencias, común a todos tus proyectos.

```text
estado: ok
modelo: gemini-4-hydrogen-medium (pedido: medio-medium)
tiempo: 104 s de reloj (agy: 99 s activos) · tokens de agy: 105521
Gemini Models: 5 h 14.2 % (+1.2 %), reinicia 18:20 · semana 3.1 % (+0.30 %), reinicia 30/11 18:13 · costo ≈ USD 0.17
archivos tocados: src/almacen.js, src/clientes.js, src/envios.js, src/facturas.js, src/pedidos.js, src/productos.js
respuesta (completa en …/respuesta.md):
Renombré obtenerDato a leerDato en la definición, la exportación y las llamadas de los 6 archivos.
```

## Terminal bajo control

Desde la 0.5.0, tu agente puede dejar que agy corra comandos, por ejemplo sus pruebas, sin tocar tu configuración: los permisos valen para una sola llamada y nunca se guardan.

1. **Plan:** agy propone pasos y escribe qué comandos necesitará.
2. **Revisión:** tu agente lo revisa y decide los accesos.
3. **Ejecución:** agy trabaja con esos accesos. Si necesita otro, entrega lo que tiene y lo pide.
4. **Verificación:** tu agente ve qué comandos corrió, según la transcripción de agy, revisa el diff y corre las pruebas por su cuenta.

| Acceso | Qué permite |
|---|---|
| Ninguno (por defecto) | Solo archivos del espacio de trabajo |
| `--acceso sandbox` | Cualquier comando en el sandbox de Antigravity: lee el proyecto y corre pruebas, pero sin escribir archivos, sin red y sin ver el resto de tu perfil. agy edita con sus herramientas de archivos |
| `--terminal "npm run build"` | Solo ese comando, sin encadenar otros, y puede salir del sandbox para compilar o instalar. **Fuera del sandbox tiene todo tu acceso de usuario:** tu agente revisa antes lo que va a ejecutar |
| `--web docs.ejemplo.com` | Solo ese dominio |

**Lo que el script nunca autoriza,** aunque se lo pidan: `git push`, `git commit`, `gh`, publicar, desplegar, borrar, `curl`, terminales dentro de la terminal, intérpretes con código en línea, comodines y comandos encadenados. Además, nunca usa `--dangerously-skip-permissions` y quita los tokens y claves del entorno de agy.

**Límites que debes conocer:**

- El sandbox de Antigravity necesita Windows 11 24H2 o posterior, Linux o macOS. Según su documentación, sin él `--acceso sandbox` no da terminal. Se probó solo en Windows 11 24H2.
- Lo que protege de verdad es el sandbox: agy puede burlar las reglas de denegación encadenando comandos.
- El sandbox deja leer la carpeta temporal del sistema y los `.env` del proyecto (ahí protege el bloqueo por secretos del script).
- Las pruebas que escriben caché o temporales (vitest, vite, jest) fallan dentro del sandbox con EPERM: tu agente las corre él o autoriza ese comando con `--terminal`.
- Lo que agy lea o la salida de sus comandos sale a los servidores de Google.

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
node skills/delegar-antigravity/scripts/agy.mjs --encargo <carpeta>/encargo.md --cwd <proyecto> --modelo medio-medium --modo lectura --respaldo
```

**Qué modelo pedir.** Se pide por gama y nivel de esfuerzo, y el script elige el mejor modelo que haya hoy:

| Tarea | Alias | Modelo (24/11/2026) |
|---|---|---|
| Mecánica y determinista: contar, comparar, renombrar con un patrón | ninguno: un script | — |
| Mecánica y corta: extraer, listar, formatear | `rapido-low` | Hydrogen Low |
| Editar código, correr pruebas, resumir (la mayoría) | `medio-medium` (por defecto) | Hydrogen Medium |
| Revisión de criterio de un diff o un plan | `medio-high` | Hydrogen High |
| Compleja: un error sutil, arquitectura, auditoría | `potente-medium` o `potente-high` | Neon |
| Larga con terminal: construir algo con sus pruebas | `orquestador` | Neon planifica, Hydrogen ejecuta |
| La más difícil y larga, o lo que Neon High no resolvió | `maximo-high` u `orquestador-maximo` | Carbon |
| Solo si tú lo pides | `medio-xhigh` o `potente-xhigh` | El nivel Extra, el más caro |

Precios (USD por millón de tokens, entrada/salida): Hydrogen 1,5/7,5; Neon 3/15; Carbon 2/10 hasta el 30/11/2026 y 4/20 desde el 1/12. `--modelos` siempre muestra los de hoy. El precio por token engaña: Hydrogen cuesta el doble que Flash por token, pero termina con muchos menos tokens y gasta menos cuota por tarea, como dice Google mismo. Una familia o versión nueva entra sola, sin actualizar la skill. La evidencia de cada modelo está en `references/modelos.md`.

**Cuota.** Todos los Gemini comparten un límite de 5 h y uno semanal (Claude y GPT tienen otros), y cada tarea gasta según el precio de sus tokens. Con la app o el IDE de Antigravity abiertos, el script lee el % real del servicio local de agy (el mismo que usa `/usage`) antes y después de cada delegación, y el resumen dice cuánto gastó. `--cuota` lo resume con lo gastado por modelo en las últimas 5 h y 7 días. Sin Antigravity abierto, el resumen da solo el costo estimado. Ese servicio no está documentado: si una versión de agy lo cambia, la skill sigue funcionando sin el % real.

**Tu propio uso de Claude Code (opcional).** [`extras/statusline-uso.mjs`](extras/statusline-uso.mjs) es una statusline que muestra el contexto, la ventana de 5 h y la semana de Claude junto a la cuota de Gemini (`ctx 42% · 5h 30% (18:20) · sem 12% (lun) · agy 5h 3% · sem 1%`), y la guarda para que `--cuota` la muestre al agente. Así el agente sabe cuándo le conviene delegar más. Cópiala a `~/.claude/` y agrega en `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "node C:/Users/<tu usuario>/.claude/statusline-uso.mjs" }
```

La statusline corre en Claude Code en la terminal. En la extensión de VS Code no se ejecutó (24/11/2026): ahí `--cuota` muestra la última lectura que dejó una sesión de terminal.

| Opción | Para qué |
|---|---|
| `--carpeta <tema>` | Crea en `%TEMP%/delegar-antigravity/` una carpeta de encargo nueva (`<fecha>-<hora>-<tema>`, con sufijo si ya existe) e imprime su ruta |
| `--modo lectura` / `edicion` | Solo lectura (por defecto) o crear y editar archivos |
| `--modelos` | Lista los modelos vigentes por familia, la gama, el precio de hoy, el rol que da Google, los retiros y cambios de precio de los próximos 30 días, y a qué modelo se resuelve cada alias hoy |
| `--modelo <alias o nombre>` | Un alias de gama (`rapido-*`, `medio-*`, `potente-*` o `maximo-*`, con `low`, `medium`, `high` o `xhigh`), `orquestador`, `orquestador-maximo`, un alias de familia (`hydrogen-high`, `neon-high`, `carbon-high`, `sonnet-low`…) o un nombre exacto. Se resuelve a la versión más alta de `agy models`; por defecto `medio-medium`. Si una familia desaparece o se retira, su alias pasa a su gama (`argon-high` usa Neon High) |
| `--respaldo` | Reintenta una vez un fallo pasajero (sin capacidad, error interno, conexión cortada) y, ante un modelo que ya no existe o uno que se quedó mudo, prueba otro modelo Gemini de la gama de abajo (Carbon → Neon → Hydrogen). Ante una cuota agotada no cambia: la cuota es la misma para todos los Gemini |
| `--cuota` | % real de cada ventana de Antigravity y cuándo se reinicia, lo gastado por modelo en las últimas 5 h y 7 días y, si la statusline lo guarda, tu uso de Claude Code |
| `--revisar` | Dice si hay que actualizar la skill: modelos nuevos o sin precio, retiros anunciados, versión de agy, incidencias desde esta versión y días sin una versión nueva |
| `--lote <carpeta>` | Corre cada subcarpeta que tenga `encargo.md`, hasta 5 a la vez (`--paralelo`), y devuelve una tabla |
| `--esquema <archivo.json>` | Pide una respuesta estructurada; el JSON queda en `respuesta.json` aunque agy lo escriba dentro del texto |
| `--permitir-secretos` | Ejecuta aunque el espacio de trabajo tenga `.env`, claves o credenciales; el agente solo lo usa con tu permiso |
| `--conversacion <id>` | Continúa una conversación anterior, para corregir |
| `--timeout <s>` | Tope contra bucles: sin el flag, 2 h en las gamas rápida y media, y 4 h en la potente, la máxima, el Orchestrator o con `xhigh`; `0` lo quita |
| `--sin-avance <s>` | Corta si no hay pasos nuevos en ese plazo; sin el flag, se adapta a la tarea; `0` lo desactiva |
| `--estado <carpeta>` | Dice cómo va una ejecución, sin gastar tokens |
| `--formato json` | Resumen en JSON en lugar de texto |
| `--seco` | Muestra el comando sin ejecutarlo |
| `--anotar "<lección>"` | Guarda en el registro central la causa de un fallo y cómo se resolvió |
| `--incidencias` | Resume en markdown el registro central: qué falla, con qué modelo y qué se aprendió |

Códigos de salida: `0` ok; `2` incompleto (acción denegada o respuesta vacía), parcial (un error que dejó respuesta), archivos editados por agy en una tarea de lectura o un lote con fallos; `3` cuota agotada; `4` secretos en el espacio de trabajo y `1` otros errores (entre ellos `modelo_mudo` y `transitorio`).

**Las tareas largas no se cortan por tiempo.** Cada 30 s, el script mira la transcripción que agy escribe en vivo, sin gastar tokens y sin interrumpirlo. Solo lo corta si no da ningún paso nuevo en todo el plazo, que empieza según el modelo (de 15 min con `rapido-low` a 45 con `potente` o `xhigh`) y crece hasta 3 veces el silencio más largo visto en esa corrida. Si lo corta, conserva la conversación para rescatarla. Mientras tanto, `--estado <carpeta>` dice qué lleva hecho y hace cuánto fue su último paso. No puede decir cuánto falta: una llamada en curso no recibe mensajes, así que al modelo no se le puede preguntar.

El script lee además el log que agy deja por cada ejecución en `~/.gemini/antigravity-cli/log/`, porque ahí quedan los reintentos internos que no salen en su salida: así distingue un modelo que se quedó mudo de un simple tiempo agotado. Y avisa si agy dejó archivos en su carpeta `brain/` (imágenes, planes) en lugar del proyecto.

La lista de `agy models` tarda unos 12 s, así que el script la guarda unas horas en la carpeta temporal y la refresca si agy rechaza un modelo (o con `--refrescar-modelos`).

**Lo que queda guardado:**

- En la carpeta del encargo: `respuesta.md` con la respuesta completa (y `respuesta.json` con `--esquema`), `respuesta-final.md` (el entregable limpio cuando agy siguió tras un corte por límite de salida), `agy-salida.json` y `agy-errores.txt` de la última ejecución, `historial.jsonl` con una línea por ejecución y, en un lote, `resumen.json`.
- En `~/.delegar-antigravity/incidencias.jsonl`: un registro central, fuera de tus proyectos, de cada ejecución que no terminó en `ok` y de las lecciones anotadas con `--anotar`. Guarda el estado, el modelo, las acciones denegadas y el texto de error de agy, nunca el encargo ni la respuesta. Sirve para ver qué falla en todos tus proyectos y mejorar la skill. Puedes cambiar la ruta con la variable `DELEGAR_AGY_INCIDENCIAS`.
- En `~/.delegar-antigravity/consumo.jsonl` y `cuota.json`: una línea por ejecución con el modelo, los tokens, el costo estimado y el % de cuota gastado, y la última lectura de la cuota. Solo metadatos: ni el encargo, ni la respuesta, ni el token del servicio local de agy. La carpeta se cambia con `DELEGAR_AGY_DATOS`.

**¿Cuándo actualizar la skill?** Cada resumen avisa con `revisar skill` si apareció un modelo nuevo o sin precio, si Google anunció un retiro que la skill no conoce o si pasaron 30 días sin una versión nueva. `--revisar` da el informe completo, con la versión de agy y las incidencias desde la última versión.

## Seguridad y privacidad

- Lo que lee agy se envía a los servidores de Google, y agy puede leer cualquier archivo de su espacio de trabajo aunque el encargo se lo prohíba. La skill no delega datos de pacientes, datos personales, secretos ni credenciales sin tu permiso explícito, y el script se detiene solo si encuentra `.env`, `.dev.vars`, claves o credenciales (también `client_secret*.json`, cuentas de servicio y `.netrc`). Si copias documentos a la carpeta del encargo, el agente te ofrece borrarla al terminar.
- agy trabaja sin terminal salvo que tu agente le dé acceso para esa llamada, siempre con `--sandbox` y nunca con `--dangerously-skip-permissions`. Ningún modo de agy impide que edite archivos: en una tarea de lectura, el script compara los archivos antes y después y avisa si cambió alguno (distingue si fue agy o otro proceso según las herramientas que usó). En una de edición, si agy dejó saltos de línea `\r\r\n` en un archivo de texto, el script los corrige y lo avisa. agy nunca hace commit, push ni publica nada: el agente revisa el diff y te pide permiso para lo demás.
- Cada delegación gasta la cuota de Antigravity, no la de tu agente.
- Para el % real de cuota, el script lee el token CSRF que la app de Antigravity guarda en `~/.gemini/antigravity/daemon/hub_<puerto>.json` y consulta solo `127.0.0.1`. El token no se imprime ni se guarda. Para las fechas de retiro consulta además el estado de tu cuenta en ese mismo servicio, que trae tu nombre y tu correo: de esa respuesta solo toma el modelo, su etiqueta y su descripción.

## Licencia

[CC BY-NC-ND 4.0](LICENSE) © 2026 Mack Chirinos: uso libre citando al autor, sin fines comerciales ni versiones modificadas sin autorización.
