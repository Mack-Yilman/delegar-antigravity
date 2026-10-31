#!/usr/bin/env node
// Delega un encargo a Antigravity CLI (agy) y devuelve un resumen breve.
// Node >= 22, sin dependencias. Uso:
//   node agy.mjs --encargo <archivo.md> [--modelo <alias|slug>] [--modo lectura|plan|edicion] [--cwd <proyecto>]
//                [--acceso sandbox] [--terminal "<comando>"]... [--web <dominio>]...
//                [--esfuerzo low|medium|high] [--timeout <s>] [--conversacion <id>] [--esquema <archivo.json>]
//                [--add-dir <carpeta>]... [--respaldo] [--permitir-secretos] [--refrescar-modelos]
//                [--max-respuesta <n>] [--formato texto|json] [--seco]
//   node agy.mjs --carpeta <tema>   (crea una carpeta de encargo nueva y única, e imprime su ruta)
//   node agy.mjs --lote <carpeta> [--paralelo <n≤5>] [--cwd <común>] [los mismos flags, salvo --encargo]
//   node agy.mjs --modelos [--refrescar-modelos] [--formato texto|json]
//   node agy.mjs --anotar "<lección: causa y solución>" [--cwd <proyecto>]
//   node agy.mjs --incidencias [--formato texto|json]
// Modelos: alias de gama (rapido-low… potente-high), de familia (flash-medium, argon-high) o nombre exacto.
// Registro central: ~/.delegar-antigravity/incidencias.jsonl (o DELEGAR_AGY_INCIDENCIAS). Datos de agy (log/ y
// brain/): ~/.gemini/antigravity-cli (o DELEGAR_AGY_HOME). Espera antes de reintentar un fallo transitorio:
// DELEGAR_AGY_ESPERA segundos (60).
// Códigos de salida: 0 ok; 2 incompleto, parcial, edito_en_lectura, pide_permiso o un lote con fallos; 3 cuota
// agotada; 4 secretos en el espacio de trabajo; 5 permiso_rechazado; 1 otro error.
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// --- Modelos ---
// Antigravity cambia los modelos sin aviso (el 12/10 quitó Gemini Pro y Flash 3.6–3.7). Por eso el script no
// fija versiones: lee `agy models` y resuelve alias como «flash-medium» a la versión más alta disponible.

export const MODELO_POR_DEFECTO = 'rapido-medium';
const PREFERENCIA_SIN_NIVEL = ['medium', 'high', 'low'];
const NIVELES = ['low', 'medium', 'high'];
// Gamas de Gemini: las familias cambian de nombre (Pro se fue y llegó Argon), así que la skill elige por gama.
// Una familia nueva entra sola: es rápida si su nombre lo dice y potente en cualquier otro caso.
const RAPIDA = /flash|lite|nano/;
export const gama = (familia) => (RAPIDA.test(familia) ? 'rapido' : 'potente');
const GAMAS = ['rapido', 'potente'];
// Familias Gemini que ya existieron: si desaparecen, su alias pasa a su gama (pro-high → potente-high).
const FAMILIAS_GEMINI = ['flash', 'pro', 'argon'];
// Respaldo ante cuota, modelo inexistente, mudo o fallo transitorio: primero las versiones anteriores del mismo
// modelo y luego, en orden, el mejor de cada gama y nivel vecinos. Solo Gemini: la cuota Claude de Antigravity es
// más corta y se reserva para cuando se pide. Lo potente no baja a otro nivel potente: el 25/10, Argon High y
// Medium se quedaron mudos el mismo día.
export const VECINOS = {
  'potente-high': ['rapido-high'],
  'potente-medium': ['rapido-high'],
  'potente-low': ['rapido-high'],
  'rapido-high': ['rapido-medium'],
  'rapido-medium': ['rapido-high', 'rapido-low'],
  'rapido-low': ['rapido-medium'],
};
const ALIAS_FIJOS = [...GAMAS.flatMap((g) => NIVELES.map((n) => `${g}-${n}`)), 'pro-high', 'sonnet-low', 'sonnet-medium', 'opus-medium', 'gpt-oss'];
const HORAS_CACHE = 6;

// gemini-3.8-flash-high, claude-sonnet-5-5-low, gpt-oss-120b-medium.
export function parsearModelo(slug) {
  let m = slug.match(/^gemini-(\d+(?:\.\d+)*)-([a-z]+(?:-[a-z]+)*)-(low|medium|high)$/);
  if (m) return { slug, proveedor: 'gemini', familia: m[2], version: m[1].split('.').map(Number), nivel: m[3] };
  m = slug.match(/^claude-([a-z]+)-(\d+(?:-\d+)*)-(low|medium|high)$/);
  if (m) return { slug, proveedor: 'claude', familia: m[1], version: m[2].split('-').map(Number), nivel: m[3] };
  m = slug.match(/^gpt-oss-(\d+)b-(low|medium|high)$/);
  if (m) return { slug, proveedor: 'gpt', familia: 'gpt-oss', version: [Number(m[1])], nivel: m[2] };
  return null;
}

// Un alias no lleva números: «flash-medium», «pro», «sonnet-low», «gpt-oss».
function parsearAlias(pedido) {
  if (/\d/.test(pedido)) return null;
  const m = pedido.match(/^([a-z]+(?:-[a-z]+)*?)(?:-(low|medium|high))?$/);
  return m ? { familia: m[1], nivel: m[2] } : null;
}

function compararVersion(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function mejor(alias, lista) {
  const esGama = GAMAS.includes(alias.familia);
  const candidatos = lista
    .map(parsearModelo)
    .filter(
      (p) =>
        p &&
        (esGama ? p.proveedor === 'gemini' && gama(p.familia) === alias.familia : p.familia === alias.familia) &&
        (!alias.nivel || p.nivel === alias.nivel),
    );
  candidatos.sort(
    (a, b) =>
      compararVersion(b.version, a.version) || PREFERENCIA_SIN_NIVEL.indexOf(a.nivel) - PREFERENCIA_SIN_NIVEL.indexOf(b.nivel),
  );
  return candidatos[0]?.slug ?? null;
}

export function resolverModelo(pedido, lista) {
  const alias = parsearAlias(pedido);
  if (!alias) return lista ? { slug: pedido, disponible: lista.includes(pedido) } : { slug: pedido };
  if (!lista) return { slug: null };
  const elegido = mejor(alias, lista);
  if (elegido) return { slug: elegido };
  const nombre = alias.familia[0].toUpperCase() + alias.familia.slice(1);
  // Una familia Gemini que desapareció pasa a su gama, con el mismo nivel.
  if (FAMILIAS_GEMINI.includes(alias.familia)) {
    const deGama = { familia: gama(alias.familia), nivel: alias.nivel };
    const otro = mejor(deGama, lista);
    if (otro) return { slug: otro, nota: `sin ${nombre} en agy models: uso ${deGama.familia}-${alias.nivel ?? 'medium'}` };
  }
  // Sin ningún modelo potente, lo más cercano es el rápido con más razonamiento.
  if (gama(alias.familia) === 'potente' && (FAMILIAS_GEMINI.includes(alias.familia) || alias.familia === 'potente')) {
    const otro = mejor({ familia: 'rapido', nivel: 'high' }, lista);
    if (otro) return { slug: otro, nota: `sin ${alias.familia === 'potente' ? 'modelos potentes' : nombre} en agy models: uso rapido-high` };
  }
  return { slug: null };
}

export function cadenaRespaldo(slug, lista) {
  const p = parsearModelo(slug);
  if (!p || p.proveedor !== 'gemini' || !lista) return [];
  const gemini = lista.filter((m) => parsearModelo(m)?.proveedor === 'gemini');
  const cadena = gemini
    .map(parsearModelo)
    .filter((m) => m.familia === p.familia && m.nivel === p.nivel && compararVersion(m.version, p.version) < 0)
    .sort((a, b) => compararVersion(b.version, a.version))
    .map((m) => m.slug);
  for (const vecino of VECINOS[`${gama(p.familia)}-${p.nivel}`] ?? []) {
    const s = mejor(parsearAlias(vecino), gemini);
    if (s && s !== slug && !cadena.includes(s)) cadena.push(s);
  }
  return cadena;
}

export function leerListaModelos(texto) {
  return texto
    .split(/\r?\n/)
    .map((l) => l.match(/^([a-z0-9][a-z0-9.-]*[a-z0-9])\t/)?.[1])
    .filter(Boolean);
}

function fechaLocal(ms) {
  const d = new Date(ms);
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

// `agy models` tarda unos 12 s y no gasta tokens: se guarda unas horas y se refresca si agy rechaza un modelo.
async function obtenerModelos(bin, { refrescar = false } = {}) {
  const carpeta = process.env.DELEGAR_AGY_CACHE || join(tmpdir(), 'delegar-antigravity');
  mkdirSync(carpeta, { recursive: true });
  const archivo = join(carpeta, 'modelos.json');
  let cache = null;
  try {
    cache = JSON.parse(readFileSync(archivo, 'utf8'));
    if (cache.bin !== bin || !Array.isArray(cache.modelos) || !cache.modelos.length) cache = null;
  } catch {}
  if (cache && !refrescar && Date.now() - cache.fecha < HORAS_CACHE * 3600e3) {
    return { modelos: cache.modelos, fecha: cache.fecha, origen: 'caché' };
  }
  const salida = join(carpeta, `agy-models-${process.pid}.txt`);
  const errores = join(carpeta, `agy-models-${process.pid}-errores.txt`);
  const r = await ejecutar(bin, ['models'], { cwd: carpeta, salida, errores, limiteMs: 30000 });
  const modelos = !r.vencido && r.codigo === 0 ? leerListaModelos(readFileSync(salida, 'utf8')) : [];
  const problema = r.vencido ? 'no respondió en 30 s' : readFileSync(errores, 'utf8').trim().split('\n')[0] || `código ${r.codigo}`;
  rmSync(salida, { force: true });
  rmSync(errores, { force: true });
  if (modelos.length) {
    const fecha = Date.now();
    const temporal = `${archivo}.${process.pid}`;
    // Con varias delegaciones en paralelo, Windows puede negar el reemplazo (EPERM, EBUSY): la caché es opcional.
    try {
      writeFileSync(temporal, JSON.stringify({ bin, fecha, modelos }));
      renameSync(temporal, archivo);
    } catch {
      rmSync(temporal, { force: true });
    }
    return { modelos, fecha, origen: 'agy models' };
  }
  if (cache) {
    return {
      modelos: cache.modelos,
      fecha: cache.fecha,
      origen: 'caché',
      aviso: `agy models falló (${problema}); uso la lista guardada del ${fechaLocal(cache.fecha)}.`,
    };
  }
  return { modelos: null, aviso: `agy models falló (${problema}): sin lista de modelos, solo valen nombres exactos.` };
}

function agruparModelos(lista) {
  const grupos = {};
  for (const slug of lista) {
    const p = parsearModelo(slug);
    const clave = !p ? 'otros' : p.proveedor === 'gpt' ? 'gpt-oss' : `${p.proveedor} ${p.familia}`;
    (grupos[clave] ??= []).push(slug);
  }
  return grupos;
}

// --- Ejecución de agy ---

const MODOS = { lectura: 'plan', plan: 'plan', edicion: 'accept-edits' };
const CODIGOS = { ok: 0, seco: 0, modelos: 0, incompleto: 2, edito_en_lectura: 2, parcial: 2, pide_permiso: 2, cuota: 3, secretos: 4, permiso_rechazado: 5 };

// Textos con los que agy (o el servicio detrás) avisa de cada problema. El de cuota aún no se ha visto en
// real: cuando aparezca, copia su texto en references/modelos.md y ajusta CUOTA si no coincide.
// Sin «limit exceeded» ni «exhausted» sueltos: un límite de contexto no es cuota y cambiar de modelo no lo arregla.
const CUOTA = /quota|rate.?limit|resource.?exhausted|\b429\b|too many requests|(?:usage|request) limit|(?:insufficient|no|out of) credits/i;
const AUTH = /authentication required|not authenticated|unauthenticated|log ?in required|please (?:log ?in|sign ?in)/i;
const DENEGADO = /auto-denied|soft[- ]?denied/i;
const PRINT_TIMEOUT = /print.?timeout/i;
// Fallos de la plataforma que pasan solos (vistos el 16/10 y el 20/10): reintentar suele bastar.
// Sin «internal» ni «unavailable» sueltos: con /i atraparían trazas de Node (node:internal/…) y errores permanentes.
const TRANSITORIO = /stream was interrupted|no capacity available|\bcode 50[0234]\b|internal error encountered/i;
const SALIDA_LARGA = /output token limit/i;
// En cli.log, el modelo abrió su llamada final y no devolvió nada en 5 min (Argon, 20/10 y 25/10).
const MUDO = /stream idle timeout/i;
const CONSEJO_SALIDA = ' Pide como máximo 6 hallazgos o puntos, en formato corto y sin razonamiento en la respuesta.';
const EXPLICA_DENEGADO = {
  command: 'la terminal, sin permiso para ese comando (decide tú: dale acceso con --acceso sandbox o --terminal "<comando>" al continuar con --conversacion, o córrelo tú)',
  mcp: 'una herramienta MCP (sin regla mcp(servidor/herramienta) en permissions.allow: quítala del encargo o pide al usuario que la permita)',
  read_file: 'leer un archivo (quizá fuera del espacio de trabajo: da rutas dentro de --cwd o agrega la carpeta con --add-dir)',
  read_url: 'abrir una URL (dale acceso con --web <dominio> o pásale el contenido en un archivo)',
};

// --- Permisos por encargo ---
// agy deniega la terminal en modo no interactivo salvo que una regla la permita. --settings da esas reglas solo para
// esta ejecución, sin tocar settings.json: el orquestador abre y cierra accesos en cada llamada, y agy no decide nada.
// Comprobado con agy 1.4.12 (2026-10-31): el sandbox de Windows no deja leer el perfil, no deja a los comandos escribir
// en ningún sitio (tampoco en el proyecto, aunque la documentación diga lo contrario) y no tiene red. Es el límite
// real: las reglas «deny» no ven un comando prohibido encadenado con «;».

const SHELLS = /^(?:powershell|pwsh|cmd|bash|sh|zsh|wsl)(?:\.exe)?(?:\s|$)/i;
// Un intérprete debe nombrar qué corre: con una opción delante, la regla le dejaría agregar -c o -e (node --test y
// python -m sí nombran qué corren).
const INTERPRETES = /^(?:node|python3?|py|ruby|perl|deno|bun)(?:$|\s+(?!--test(?:\s|$)|-m\s)-|\s+eval(?:\s|$))/i;
// Una herramienta sin subcomando, o con una opción antes de él (git -C . push), autorizaría los prohibidos.
const SIN_SUBCOMANDO = /^(?:git|npm|pnpm|yarn|npx|wrangler|docker|cargo|go)(?:$|\s+-)/i;
const PROHIBIDOS = [
  'git\\s+(?:push|commit|reset|clean)',
  'gh',
  '(?:npm|pnpm|yarn)\\s+publish',
  'wrangler\\s+(?:deploy|publish|delete|secret)',
  'cf',
  'rm',
  'rmdir',
  'rd',
  'del',
  'Remove-Item',
  'curl',
  'wget',
  'iwr',
  'irm',
  'Invoke-WebRequest',
  'Invoke-RestMethod',
  'sudo',
  'runas',
  'format',
];
const REGLAS_DENY = PROHIBIDOS.map((c) => `command(regex:(?i)^${c}(\\s.*)?$)`);
const ES_PROHIBIDO = new RegExp(`^(?:${PROHIBIDOS.join('|')})(?:\\s|$)`, 'i');

// Devuelve el motivo por el que no se autoriza un comando, o null.
export function motivoRechazoComando(comando) {
  if (!comando || comando === '*') return 'un comodín o un comando vacío autorizaría cualquier cosa';
  if (/[&|;$<>`\r\n]/.test(comando)) return 'no puede llevar operadores ni variables de la terminal (& | ; $ < > y comillas invertidas)';
  // curl.exe o C:\x\gh.exe son lo mismo que curl y gh.
  comando = comando.replace(/^\S*[\\/]/, '').replace(/^(\S+?)\.(?:exe|cmd|bat|ps1)(?=\s|$)/i, '$1');
  if (SHELLS.test(comando)) return 'una terminal dentro de la terminal ejecutaría cualquier cosa';
  if (INTERPRETES.test(comando)) return 'un intérprete suelto o con código en línea ejecutaría cualquier cosa: nombra el script o usa --acceso sandbox';
  if (SIN_SUBCOMANDO.test(comando)) return 'nombra el subcomando (por ejemplo, «git status» o «npm test»)';
  if (ES_PROHIBIDO.test(comando)) return 'publicar, borrar, confirmar o salir a la red lo hace el orquestador, con permiso del usuario';
  return null;
}

// Exacto, con argumentos, sin poder encadenar nada: en Windows, un comando con subcomandos también exige regex.
// Flash suele anteponer «Set-Location "<carpeta>"; »: sin este prefijo se le denegaba el comando que se le autorizó.
// Solo espacios y tabuladores: un salto de línea encadena comandos igual que «;», y \s y [^…] lo aceptarían.
const PREFIJO_CARPETA = `(?:(?:Set-Location|cd)(?:[ \\t]+-Path)?[ \\t]+[^&|;$<>\`\\r\\n]+;[ \\t]*)?`;
export const reglaComando = (comando) =>
  `command(regex:^${PREFIJO_CARPETA}${comando.replace(/[.*+?^()[\]{}\\/]/g, '\\$&').replace(/\s+/g, '[ \\t]+')}([ \\t][^&|;$<>\`\\r\\n]*)?$)`;

// Devuelve los ajustes de esta sesión, o null si no se dio ningún acceso (entonces no se pasa --settings).
// Con «permissions», --settings reemplaza las reglas de settings.json (2026-10-31: se perdieron las MCP del usuario):
// se copian para que sus allow, ask y, sobre todo, sus deny sigan vigentes.
export function armarAjustes({ sandbox = false, terminal = [], web = [], usuario = {} }) {
  if (!sandbox && !terminal.length && !web.length) return null;
  const lista = (clave) => (Array.isArray(usuario[clave]) ? usuario[clave] : []);
  const ajustes = {
    enableTerminalSandbox: true,
    permissions: {
      allow: [...lista('allow'), ...terminal.map(reglaComando), ...web.map((d) => `read_url(${d})`)],
      ask: lista('ask'),
      deny: [...lista('deny'), ...REGLAS_DENY],
    },
  };
  if (sandbox) ajustes.toolPermission = 'proceed-in-sandbox';
  return ajustes;
}

function permisosDelUsuario() {
  try {
    return JSON.parse(readFileSync(join(carpetaAgy(), 'settings.json'), 'utf8')).permissions ?? {};
  } catch {
    return {};
  }
}

// Con terminal, los comandos de agy heredan el entorno y su salida va a Google (2026-10-31: se veían los tokens de
// Claude Code). Se conservan solo las credenciales con las que agy mismo puede iniciar sesión.
const VARIABLE_SENSIBLE = /token|secret|passw|credential|key$|_key_|_pat$|_dsn$|^claude|^anthropic/i;
const URL_CON_CLAVE = /:\/\/[^/\s:@]*:[^/\s@]+@/;
const CREDENCIALES_DE_AGY = new Set(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']);
export const entornoSinSecretos = (entorno) =>
  Object.fromEntries(Object.entries(entorno).filter(([k, v]) => CREDENCIALES_DE_AGY.has(k.toUpperCase()) || !(VARIABLE_SENSIBLE.test(k) || URL_CON_CLAVE.test(v))));

// Los pedidos de agy, una línea «PERMISO: <comando> — <por qué>», aunque venga en una lista, en negrita o con comillas.
// En mayúsculas, como se le pide: «Permiso: solo lectura» es texto normal de una respuesta.
export function extraerPermisos(texto) {
  const pedidos = [...texto.matchAll(/^[\s>*_`«"'-]*PERMISO\b[*_]*:[*_]*\s*(.+?)[\s»"]*$/gm)].map((m) => m[1].replace(/\*\*/g, ''));
  return [...new Set(pedidos)];
}

// Lo que agy pidió ejecutar, según su transcripción: el resumen no se fía de lo que dice su respuesta.
export function comandosDeAgy(conversacion, desde) {
  if (!conversacion) return [];
  let texto;
  try {
    texto = readFileSync(join(carpetaAgy(), 'brain', conversacion, '.system_generated', 'logs', 'transcript.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const comandos = [];
  for (const linea of texto.split('\n')) {
    let paso;
    try {
      paso = JSON.parse(linea);
    } catch {
      continue;
    }
    if (Date.parse(paso.created_at) < desde - 2000) continue;
    for (const llamada of paso.tool_calls ?? []) {
      if (llamada.name !== 'run_command' || !llamada.args?.CommandLine) continue;
      let comando = llamada.args.CommandLine;
      try {
        comando = JSON.parse(comando);
      } catch {}
      comandos.push({ comando: String(comando).slice(0, 200), fuera_del_sandbox: String(llamada.args.BypassSandbox) === 'true' || undefined });
    }
  }
  return comandos.slice(-20);
}

const PIDE_PERMISO =
  ' Si necesitas un comando o un acceso que no tienes, no lo intentes: una sola petición denegada vacía tu respuesta y pierdes todo el trabajo. Termina lo que puedas, entrégalo y agrega una línea por pedido: «PERMISO: <comando exacto> — <por qué>». Tu orquestador decide y te responde.';
const CON_TERMINAL =
  ' Tu orquestador te da acceso a la terminal para esta tarea. Los comandos corren en un sandbox: pueden leer el proyecto y correr pruebas, pero no escribir archivos ni usar la red. Edita los archivos con tus herramientas de edición, no con comandos. Si un comando falla por el sandbox, no lo reintentes fuera de él (BypassSandbox): se denegará.';
// Con --add-dir, los comandos arrancan en una carpeta que no se controla (ni el orden ni el directorio de lanzamiento
// la fijaron el 2026-10-31), casi nunca el proyecto. El prefijo es determinista y la regla de --terminal lo admite.
const ENTRAR_AL_PROYECTO = (cwd) => ` Tus comandos arrancan en otra carpeta: empieza cada uno exactamente con Set-Location "${cwd}"; y luego el comando, sin git -C ni rutas relativas a otra carpeta.`;
// Según la documentación, una regla allow deja salir del sandbox; comprobado el 2026-10-31: sin BypassSandbox sigue dentro.
const POR_NOMBRE = (comandos) =>
  ` Excepción: estos comandos, y solo estos, puedes correrlos con BypassSandbox=true si necesitan escribir o usar la red: ${comandos.join(', ')}. Tras el Set-Location, escríbelos tal cual, sin rutas absolutas, y uno por llamada.`;
// El historial de la conversación aún dice que tenía terminal: sin este aviso, la pide y vacía su respuesta.
const SIN_ACCESO_AHORA = ' En esta llamada ya no tienes acceso a la terminal: no ejecutes comandos.';
const SIN_RAZONAMIENTO = ' Tu respuesta final es solo el entregable: sin razonamiento, borradores ni notas de lo que vas pensando.';

export function construirArgs({ encargo, modelo, modo = 'lectura', timeout = 600, esfuerzo, conversacion, esquema, addDirs = [], cwd, ajustes, conTerminal = false, terminal = [], accesoRetirado = false }) {
  // --mode plan no impide escribir en modo no interactivo, y a veces prepara un plan en lugar de responder:
  // el mensaje lo deja explícito y el script detecta después cualquier archivo tocado.
  const POR_MODO = {
    lectura:
      ' Es una tarea de solo lectura: no crees, modifiques ni borres archivos, y responde directamente con el resultado en tu respuesta final, sin preparar un plan ni pedir confirmación.' +
      SIN_RAZONAMIENTO,
    plan:
      ` Es la fase de plan: no crees, modifiques ni borres archivos${conTerminal ? '' : ', ni ejecutes comandos'}. Responde directamente, sin pedir confirmación, con los pasos, los archivos que tocarás y una línea por cada comando o acceso que vas a necesitar: «PERMISO: <comando exacto> — <por qué>».` +
      SIN_RAZONAMIENTO,
    edicion: '',
  };
  const mensaje =
    `Lee el archivo ${encargo} y cumple el encargo que contiene.` +
    POR_MODO[modo] +
    (conTerminal ? CON_TERMINAL + (cwd ? ENTRAR_AL_PROYECTO(cwd) : '') : '') +
    (terminal.length ? POR_NOMBRE(terminal) : '') +
    (accesoRetirado && !conTerminal ? SIN_ACCESO_AHORA : '') +
    (conTerminal || ajustes ? PIDE_PERMISO : '');
  // agy rechaza un nivel en el nombre más --effort («conflicts with --effort»): con esfuerzo, va el nombre base.
  const nombre = esfuerzo ? modelo.replace(/-(low|medium|high)$/, '') : modelo;
  const args = ['-p', mensaje, '--model', nombre, '--mode', MODOS[modo], '--sandbox'];
  args.push('--output-format', 'json', '--print-timeout', `${timeout}s`);
  // El cwd ya es parte del espacio de trabajo: no se repite con --add-dir.
  const dirs = [dirname(encargo), ...addDirs].filter((d, i, todos) => (!cwd || relative(cwd, d) !== '') && todos.indexOf(d) === i);
  for (const dir of dirs) args.push('--add-dir', dir);
  if (esfuerzo) args.push('--effort', esfuerzo);
  if (conversacion) args.push('--conversation', conversacion);
  if (esquema) args.push('--json-schema', esquema);
  if (ajustes) args.push('--settings', ajustes);
  return args;
}

export function clasificar({ json, stderr = '', codigo, vencido = false, fallo, sinCerrar, fallosLog = [] }) {
  if (vencido) {
    const cierre = sinCerrar
      ? `no respondió al cierre: el proceso ${sinCerrar} puede seguir vivo, ciérralo a mano`
      : 'se cerró su árbol de procesos';
    return { estado: 'timeout', detalle: `agy no terminó dentro del tiempo límite; ${cierre}. Divide la tarea o sube --timeout.` };
  }
  if (fallo) return { estado: 'error', detalle: fallo };
  // Con un error o un corte, agy a veces deja la respuesta completa o casi (20/10 y 22/10).
  const largo = json?.response?.trim().length ?? 0;
  const parcial = (motivo, texto = '') => ({
    estado: 'parcial',
    detalle:
      `agy terminó con «${motivo.split('\n')[0].slice(0, 160)}», pero dejó ${largo} caracteres en respuesta.md: puede estar completa. ` +
      'Léela antes de reintentar; si está cortada, continúa con --conversacion pidiendo solo lo que falta.' +
      (SALIDA_LARGA.test(texto) ? CONSEJO_SALIDA : ''),
  });
  if (PRINT_TIMEOUT.test(stderr)) {
    if (largo) return parcial('print timeout');
    if (fallosLog.some((f) => MUDO.test(f))) {
      return {
        estado: 'modelo_mudo',
        detalle:
          'el modelo leyó los archivos pero su llamada final no devolvió nada («stream idle timeout» en cli.log) hasta agotar --print-timeout. El rescate con correccion.md no sirve en este fallo: cambia de modelo (con --respaldo el script ya lo hace) o acota mucho el encargo.',
      };
    }
    return {
      estado: 'timeout',
      detalle:
        'agy agotó su --print-timeout. Rescate: escribe correccion.md pidiendo que entregue ya lo que tenga, sin leer más, y continúa con --conversacion <id>.',
    };
  }
  if (!json) {
    const detalle = stderr.trim().slice(0, 400) || `agy salió con código ${codigo} sin JSON.`;
    if (AUTH.test(stderr)) return { estado: 'auth', detalle };
    if (CUOTA.test(stderr)) return { estado: 'cuota', detalle };
    if (TRANSITORIO.test(stderr)) return { estado: 'transitorio', detalle };
    return { estado: stderr.trim() ? 'error' : 'json_invalido', detalle };
  }
  if (json.status !== 'SUCCESS') {
    const texto = `${json.error ?? ''}\n${stderr}`.trim();
    const detalle = (texto || `status ${json.status}`).slice(0, 400);
    if (/invalid model selection/i.test(texto)) return { estado: 'modelo_invalido', detalle };
    if (AUTH.test(texto)) return { estado: 'auth', detalle };
    if (CUOTA.test(texto)) return { estado: 'cuota', detalle };
    if (largo) return parcial(texto || `status ${json.status}`, texto);
    if (TRANSITORIO.test(texto)) {
      return { estado: 'transitorio', detalle: `${detalle}\nFallo pasajero de la plataforma: reintenta en un minuto o usa --respaldo, que reintenta solo.` };
    }
    return { estado: 'error', detalle: detalle + (SALIDA_LARGA.test(texto) ? CONSEJO_SALIDA : '') };
  }
  const denegado = (json.denied_actions ?? []).map((a) => a.action);
  if (denegado.length || DENEGADO.test(stderr)) {
    const que = denegado.length ? [...new Set(denegado)].map((a) => EXPLICA_DENEGADO[a] ?? a).join('; ') : 'una acción';
    const aviso = stderr.trim() ? ` stderr: ${stderr.trim().slice(0, 200)}` : '';
    return { estado: 'incompleto', denegado, detalle: `agy pidió ${que}. Una sola denegación deja vacía toda la respuesta.${aviso}` };
  }
  if (!json.response?.trim() && json.structured_output === undefined) {
    return { estado: 'incompleto', denegado, detalle: 'agy terminó sin respuesta.' };
  }
  return { estado: 'ok', denegado };
}

function ubicarAgy() {
  if (process.env.AGY_BIN) return existsSync(process.env.AGY_BIN) ? process.env.AGY_BIN : null;
  const nombre = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const candidatos = (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d.replace(/^"|"$/g, ''), nombre));
  candidatos.push(
    process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'agy', 'bin', nombre) : join(homedir(), '.local', 'bin', nombre),
  );
  return candidatos.find((c) => existsSync(c)) ?? null;
}

// Carpeta de datos de agy: log/ tiene un cli-<fecha>.log por ejecución y brain/<conversación>/ lo que genera.
const carpetaAgy = () => process.env.DELEGAR_AGY_HOME || join(homedir(), '.gemini', 'antigravity-cli');

// Los reintentos internos de agy («attempt 1 failed (…)») solo quedan en su log, no en stderr ni en el JSON.
// Sin id de conversación, solo se usa el log si hubo uno en esa ventana: con tareas en paralelo no se adivina.
export function leerLogAgy({ desde, conversacion }) {
  const dir = join(carpetaAgy(), 'log');
  let candidatos;
  try {
    candidatos = readdirSync(dir)
      .filter((n) => /^cli-.*\.log$/.test(n))
      .map((n) => join(dir, n))
      // Por creación, no por modificación: agy crea un log por proceso, y el del intento anterior de --respaldo
      // (misma conversación con --conversacion) se modificó hasta justo antes de este intento.
      .filter((f) => {
        const s = statSync(f);
        return (s.birthtimeMs || s.mtimeMs) >= desde - 2000;
      });
  } catch {
    return [];
  }
  const textos = candidatos.map((f) => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return '';
    }
  });
  const propios = conversacion ? textos.filter((t) => t.includes(conversacion)) : textos.length === 1 ? textos : [];
  return propios.flatMap((t) => [...t.matchAll(/attempt \d+ failed \((.+)\), retrying/g)].map((m) => m[1].slice(0, 200)));
}

// agy guarda imágenes y planes en brain/<conversación>/ y a veces responde como si no los hubiera hecho.
function generadosEnBrain(conversacion, desde) {
  if (!conversacion) return [];
  const base = join(carpetaAgy(), 'brain', conversacion);
  const hallados = [];
  recorrer(base, (ruta, e) => {
    if (e.isDirectory()) return e.name !== '.system_generated';
    try {
      if (statSync(join(base, ruta)).mtimeMs >= desde - 2000) hallados.push(join(base, ruta).replace(/\\/g, '/'));
    } catch {}
  });
  return hallados.sort();
}

function matarArbol(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }
}

// stdin cerrado (agy se cuelga si queda abierto) y salida a archivos, nunca a una tubería:
// un nieto de agy que sobreviva podría retenerla y bloquear al orquestador.
// Si el proceso no muere tras matarlo (pasó una vez que el tiempo límite no cortó una tarea de 20 min),
// se vuelve igual a los `esperaTrasMatar` ms: el orquestador nunca espera para siempre.
export function ejecutar(bin, args, { cwd, salida, errores, limiteMs, matar = matarArbol, esperaTrasMatar = 15000, env = process.env }) {
  return new Promise((listo) => {
    const out = openSync(salida, 'w');
    const err = openSync(errores, 'w');
    const [comando, previos] = /\.m?js$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
    let vencido = false;
    let cerrado = false;
    let temporizador;
    let ultimatum;
    // Node puede emitir «error» y luego «exit»: cerrar dos veces los descriptores lanzaría EBADF.
    const cerrar = (resultado) => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(temporizador);
      clearTimeout(ultimatum);
      closeSync(out);
      closeSync(err);
      listo({ vencido, ...resultado });
    };
    const hijo = spawn(comando, [...previos, ...args], {
      cwd,
      env,
      stdio: ['ignore', out, err],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    temporizador = setTimeout(() => {
      vencido = true;
      matar(hijo.pid);
      ultimatum = setTimeout(() => cerrar({ sinCerrar: hijo.pid }), esperaTrasMatar);
    }, limiteMs);
    hijo.on('error', (e) => cerrar({ fallo: e.message }));
    hijo.on('exit', (codigo) => cerrar({ codigo }));
  });
}

// --- Archivos del espacio de trabajo ---

const IGNORADAS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next']);
const TOPE_ARCHIVOS = 20000;
// Lo que el script escribe junto al encargo: no son cambios de agy.
const PROPIOS = ['agy-salida.json', 'agy-errores.txt', 'respuesta.md', 'respuesta.json', 'historial.jsonl', 'resumen.json', 'lote-errores.txt', 'agy-permisos.json'];
// Lo que escribe el orquestador para agy. Editarlo mientras agy trabaja (p. ej., reforzar el encargo de varias
// tareas en paralelo) daba un falso edito_en_lectura.
const ENTRADAS = ['encargo.md', 'correccion.md'];

// Recorre una carpeta sin entrar en IGNORADAS. `visitar` devuelve false en una carpeta para no entrar en ella.
// Devuelve false si se pasó del tope de archivos.
function recorrer(base, visitar, tope = TOPE_ARCHIVOS) {
  const pendientes = [''];
  let archivos = 0;
  while (pendientes.length) {
    const rel = pendientes.pop();
    let entradas;
    try {
      entradas = readdirSync(join(base, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      const ruta = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!IGNORADAS.has(e.name) && visitar(ruta, e) !== false) pendientes.push(ruta);
      } else if (e.isFile()) {
        if (++archivos > tope) return false;
        visitar(ruta, e);
      }
    }
  }
  return true;
}

// agy lee cualquier archivo del espacio de trabajo aunque el encargo lo prohíba (leyó un .dev.vars el 12/10).
const SECRETO =
  /^(?:\.env(?:\..+)?|\.dev\.vars(?:\..+)?|.+\.(?:key|pem|p12|pfx|token|jks|keystore)|credenciales.*|credentials.*|client_secret.*\.json|service[-_]?account.*\.json|\.netrc|\.pgpass|id_(?:rsa|dsa|ecdsa|ed25519))$/i;
const CARPETA_SECRETA = /^(?:secrets|secretos)$/i;
const EJEMPLO = /\.(?:example|sample|template|ejemplo)$/i;

// Devuelve los secretos hallados y si la búsqueda recorrió todo (se detiene en TOPE_ARCHIVOS por carpeta).
export function buscarSecretos(carpetas, cwd, tope = TOPE_ARCHIVOS) {
  const hallados = new Set();
  let completa = true;
  for (const carpeta of carpetas) {
    const entera = recorrer(carpeta, (ruta, e) => {
      const relativa = () => relative(cwd, join(carpeta, ruta)).replace(/\\/g, '/');
      if (e.isDirectory()) {
        if (!CARPETA_SECRETA.test(e.name)) return true;
        hallados.add(relativa() + '/');
        return false;
      }
      if (SECRETO.test(e.name) && !EJEMPLO.test(e.name)) hallados.add(relativa());
    }, tope);
    if (!entera) completa = false;
  }
  return { secretos: [...hallados].sort(), completa };
}

const dentroDe = (base, ruta) => {
  const rel = relative(base, ruta);
  return !rel.startsWith('..') && !isAbsolute(rel);
};

// Fecha de modificación de cada archivo, para saber qué tocó agy. En el --cwd: con git, los archivos con cambios
// y los ignorados (CLAUDE.md, .env); sin git, todo el árbol hasta un tope (si lo supera, no se sabe). Además,
// el árbol de cada carpeta extra (la del encargo y las de --add-dir) que quede fuera: agy también escribe ahí.
function fotoArchivos(cwd, extras = []) {
  const principal = fotoGit(cwd) ?? fotoArbol(cwd);
  if (!principal) return null;
  const fotos = [principal];
  for (const dir of extras) {
    if (fotos.some((f) => dentroDe(f.base, dir))) continue;
    const foto = fotoArbol(dir);
    if (foto) fotos.push(foto);
  }
  return fotos;
}

function fotoArbol(cwd) {
  const mapa = new Map();
  const completo = recorrer(cwd, (ruta, e) => {
    if (!e.isFile()) return;
    try {
      mapa.set(ruta, statSync(join(cwd, ruta)).mtimeMs);
    } catch {}
  });
  return completo ? { base: cwd, git: false, mapa } : null;
}

function fotoGit(cwd) {
  const raiz = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  if (raiz.status !== 0) return null;
  const base = resolve(raiz.stdout.trim());
  const git = (...args) => spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: base, encoding: 'utf8' });
  const estado = git('status', '--porcelain', '-uall');
  if (estado.status !== 0) return null;
  const rutas = estado.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).split(' -> ').at(-1));
  // Las carpetas ignoradas enteras (node_modules/) salen con «/» final y se omiten.
  const ignorados = git('ls-files', '--others', '--ignored', '--exclude-standard', '--directory');
  if (ignorados.status === 0) rutas.push(...ignorados.stdout.split('\n').filter((l) => l && !l.endsWith('/')));
  const mapa = new Map();
  for (const ruta of rutas.map((r) => r.replace(/^"|"$/g, ''))) {
    let fecha = -1;
    try {
      fecha = statSync(join(base, ruta)).mtimeMs;
    } catch {}
    mapa.set(ruta, fecha);
  }
  return { base, git: true, mapa };
}

// Rutas relativas a la base del --cwd; las de carpetas extra salen como «../encargo/resultado.md».
function archivosTocados(antes, despues, excluir) {
  if (!antes || !despues || antes.length !== despues.length) return null;
  const clave = (ruta) => (process.platform === 'win32' ? resolve(ruta).toLowerCase() : resolve(ruta));
  const excluidos = new Set(excluir.map(clave));
  // Otra carpeta de encargo dentro del espacio de trabajo (una ejecución anterior o una en paralelo): sus archivos
  // los escribe el script o el orquestador, no agy (falso edito_en_lectura del 19/10).
  // En un lote, resumen.json aparece antes que agy-salida.json: también cuenta la carpeta que tiene encargo.md.
  const deOtroEncargo = (absoluta) =>
    [...PROPIOS, ...ENTRADAS].includes(basename(absoluta)) &&
    ['agy-salida.json', 'encargo.md'].some((n) => existsSync(join(dirname(absoluta), n)));
  const tocados = [];
  antes.forEach((a, i) => {
    const d = despues[i];
    for (const r of new Set([...a.mapa.keys(), ...d.mapa.keys()])) {
      const absoluta = join(a.base, r);
      if (excluidos.has(clave(absoluta)) || a.mapa.get(r) === d.mapa.get(r) || deOtroEncargo(absoluta)) continue;
      tocados.push(relative(antes[0].base, absoluta).replace(/\\/g, '/'));
    }
  });
  return tocados.sort();
}

// --- Salida ---

// agy enlaza los archivos como [nombre](file:///C:/ruta/absoluta#L2): se reemplazan por la ruta relativa,
// y el texto del enlace se conserva cuando no es el nombre del archivo (p. ej., una función).
export function limpiarEnlaces(texto, cwd) {
  return texto.replace(/\[([^\]]*)\]\(file:\/\/\/?([^)\s]+)\)/g, (_, nombre, ruta) => {
    const [archivo, ancla = ''] = decodeURIComponent(ruta).split('#');
    let absoluta = archivo;
    if (process.platform !== 'win32' && !absoluta.startsWith('/')) absoluta = '/' + absoluta;
    const rel = relative(cwd, absoluta);
    const corta = (rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : absoluta).replace(/\\/g, '/');
    const enlace = '`' + corta + (ancla ? `#${ancla}` : '') + '`';
    const texto = nombre.replace(/`/g, '').trim();
    return !texto || texto === basename(absoluta) || texto === corta ? enlace : `${texto} (${enlace})`;
  });
}

function leerJson(archivo) {
  let texto;
  try {
    texto = readFileSync(archivo, 'utf8').trim();
  } catch {
    return null;
  }
  for (const candidato of [texto, texto.split('\n').filter(Boolean).at(-1)]) {
    try {
      if (candidato) return JSON.parse(candidato);
    } catch {}
  }
  return null;
}

// Con --esquema, agy no siempre llena structured_output: a veces el JSON viene en la respuesta, solo, en un bloque
// de código o entre texto (visto en tesis-salud). Devuelve el último objeto JSON válido, o undefined.
export function extraerJson(texto) {
  const candidatos = [texto.trim(), ...[...texto.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]).reverse()];
  // Entre texto: desde cada «{», empezando por el último, hasta la última «}». Así una llave suelta antes del
  // JSON («el campo {id}») o un borrador anterior no lo arruinan.
  const fin = texto.lastIndexOf('}');
  for (let i = texto.lastIndexOf('{', fin); i !== -1; i = i ? texto.lastIndexOf('{', i - 1) : -1) {
    candidatos.push(texto.slice(i, fin + 1));
  }
  for (const c of candidatos) {
    try {
      const valor = JSON.parse(c);
      if (valor && typeof valor === 'object') return valor;
    } catch {}
  }
  return undefined;
}

function imprimir(resumen, formato) {
  if (formato === 'json') {
    process.stdout.write(JSON.stringify(resumen, null, 2) + '\n');
    return;
  }
  const lineas = [`estado: ${resumen.estado}`];
  if (resumen.lista) lineas.push(`lista: ${resumen.lista}`);
  for (const [grupo, modelos] of Object.entries(resumen.grupos ?? {})) lineas.push(`${grupo}: ${modelos.join(', ')}`);
  for (const [g, familias] of Object.entries(resumen.gamas ?? {})) lineas.push(`gama ${g}: ${familias.join(', ')}`);
  if (resumen.alias) {
    lineas.push('alias:');
    for (const [alias, slug] of Object.entries(resumen.alias)) lineas.push(`  ${alias} → ${slug}`);
  }
  if (resumen.comando) lineas.push(`comando: ${resumen.comando}`);
  if (resumen.modelo) {
    const origen = [resumen.pedido && `pedido: ${resumen.pedido}`, resumen.nota].filter(Boolean).join('; ');
    lineas.push(`modelo: ${resumen.modelo}${origen ? ` (${origen})` : ''}`);
  }
  if (resumen.intentos?.length > 1) lineas.push(`intentos: ${resumen.intentos.map((i) => `${i.modelo} (${i.estado})`).join(' → ')}`);
  if (resumen.segundos !== undefined) {
    // duration_seconds es tiempo activo del modelo: el 25/10 dio 617 s en una corrida de 20 min de reloj.
    const agy = resumen.segundos_agy !== undefined && resumen.segundos_agy !== resumen.segundos ? ` (agy: ${resumen.segundos_agy} s activos)` : '';
    lineas.push(`tiempo: ${duracion(resumen.segundos)} de reloj${agy} · tokens de agy: ${resumen.tokens ?? '?'}`);
  }
  if (resumen.tabla) lineas.push(...resumen.tabla);
  if (resumen.conversacion) lineas.push(`conversación: ${resumen.conversacion}`);
  if (resumen.archivos !== undefined) {
    const lista = resumen.archivos === null ? 'no se sabe (proyecto sin git y demasiado grande)' : resumen.archivos.join(', ') || 'ninguno';
    lineas.push(`archivos tocados: ${lista}${resumen.sin_git ? ' (sin git: incluye cambios de cualquier proceso)' : ''}`);
  }
  if (resumen.accesos) lineas.push(`accesos dados: ${resumen.accesos.join(', ')}`);
  if (resumen.comandos?.length) {
    lineas.push(`comandos de agy: ${resumen.comandos.map((c) => c.comando + (c.fuera_del_sandbox ? ' (pidió salir del sandbox)' : '')).join(' | ')}`);
  }
  if (resumen.permisos_pedidos?.length) {
    lineas.push('permisos que pide agy:', ...resumen.permisos_pedidos.map((p) => `  - ${p}`));
  }
  if (resumen.fallos_log?.length) lineas.push(`reintentos internos de agy: ${resumen.fallos_log.join(' | ')}`);
  if (resumen.generados?.length) lineas.push(`generados por agy fuera del proyecto: ${resumen.generados.join(', ')}`);
  if (resumen.respuesta_json) lineas.push(`json: ${resumen.respuesta_json}`);
  if (resumen.denegado?.length) lineas.push(`denegado: ${resumen.denegado.join(', ')}`);
  if (resumen.secretos?.length) lineas.push(`secretos: ${resumen.secretos.join(', ')}`);
  if (resumen.disponibles?.length) lineas.push(`disponibles: ${resumen.disponibles.join(', ')}`);
  if (resumen.detalle) lineas.push(`detalle: ${resumen.detalle}`);
  for (const aviso of resumen.avisos ?? []) lineas.push(`aviso: ${aviso}`);
  if (resumen.respuesta !== undefined) lineas.push(`respuesta (completa en ${resumen.respuesta_completa}):`, resumen.respuesta);
  process.stdout.write(lineas.join('\n') + '\n');
}

const duracion = (s) => (s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);

function entero(nombre, valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${nombre} debe ser un entero positivo, no «${valor}»`);
  return n;
}

const LARGO_MAXIMO_CWD = 258;

function rutaReal(ruta) {
  try {
    return realpathSync.native(ruta);
  } catch {
    return resolve(ruta);
  }
}

// --- Registro central de incidencias ---
// Los fallos de agy quedaban repartidos en los CLAUDE.md de cada proyecto y algunos se perdían. El script anota
// solo cada ejecución que no termina en ok, y el orquestador agrega lecciones con --anotar; --incidencias las
// resume para mejorar la skill. Nunca guarda el encargo ni la respuesta: pueden tener datos del usuario.

export const VERSION = '0.5.0';

function archivoIncidencias() {
  return process.env.DELEGAR_AGY_INCIDENCIAS || join(homedir(), '.delegar-antigravity', 'incidencias.jsonl');
}

function registrarIncidencia(entrada) {
  const archivo = archivoIncidencias();
  try {
    mkdirSync(dirname(archivo), { recursive: true });
    appendFileSync(archivo, JSON.stringify({ fecha: fechaLocal(Date.now()), version: VERSION, ...entrada }) + '\n');
  } catch {}
}

export function leerIncidencias(archivo = archivoIncidencias()) {
  let texto;
  try {
    texto = readFileSync(archivo, 'utf8');
  } catch {
    return [];
  }
  return texto
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

const contar = (valores) => {
  const cuenta = {};
  for (const v of valores) cuenta[v] = (cuenta[v] ?? 0) + 1;
  return Object.entries(cuenta).sort((a, b) => b[1] - a[1]);
};

// Resumen en markdown para revisar qué falla y qué se aprendió.
export function resumirIncidencias(entradas, archivo) {
  const incidencias = entradas.filter((e) => e.tipo === 'incidencia');
  const lecciones = entradas.filter((e) => e.tipo === 'leccion');
  if (!entradas.length) return `Sin incidencias registradas en ${archivo}.`;
  const lineas = [`## Incidencias de agy (${archivo})`, ''];
  const fechas = entradas.map((e) => e.fecha).filter(Boolean).sort();
  lineas.push(`${incidencias.length} incidencias y ${lecciones.length} lecciones, del ${fechas[0]} al ${fechas.at(-1)}.`, '');
  const tabla = (titulo, filas) => {
    if (!filas.length) return;
    lineas.push(`| ${titulo} | Veces |`, '|---|---|', ...filas.map(([k, n]) => `| ${k} | ${n} |`), '');
  };
  tabla('Estado', contar(incidencias.flatMap((i) => (i.intentos ?? [{ estado: i.estado }]).map((t) => t.estado).filter((e) => e !== 'ok'))));
  tabla('Modelo', contar(incidencias.map((i) => i.modelo).filter(Boolean)));
  tabla('Acción denegada', contar(incidencias.flatMap((i) => i.denegado ?? [])));
  tabla('Versión', contar(incidencias.map((i) => i.version).filter(Boolean)));
  if (incidencias.length) {
    lineas.push('### Últimas incidencias', '');
    for (const i of incidencias.slice(-10)) {
      const error = i.stderr ? ` · stderr: ${i.stderr.split('\n')[0].slice(0, 160)}` : '';
      lineas.push(`- ${i.fecha} · ${i.proyecto ?? '?'} · ${i.estado} · ${i.modelo ?? '?'}${error}`);
    }
    lineas.push('');
  }
  if (lecciones.length) {
    lineas.push('### Lecciones', '');
    for (const l of lecciones) lineas.push(`- ${l.fecha} · ${l.proyecto ?? '?'}: ${l.texto}`);
  }
  return lineas.join('\n').trim();
}

// --- Programa ---

async function listarModelos(bin, o) {
  const lista = await obtenerModelos(bin, { refrescar: o['refrescar-modelos'] });
  const resumen = { estado: lista.modelos ? 'modelos' : 'error', avisos: lista.aviso ? [lista.aviso] : undefined };
  if (lista.modelos) {
    resumen.lista = `${lista.origen}, ${fechaLocal(lista.fecha)}`;
    resumen.grupos = agruparModelos(lista.modelos);
    const gemini = lista.modelos.map(parsearModelo).filter((p) => p?.proveedor === 'gemini');
    resumen.gamas = {};
    for (const p of gemini) {
      const familias = (resumen.gamas[gama(p.familia)] ??= []);
      if (!familias.includes(p.familia)) familias.push(p.familia);
    }
    // Los alias de gama primero; luego los de cada familia Gemini presente, aunque sea nueva.
    const deFamilias = gemini.map((p) => `${p.familia}-${p.nivel}`);
    resumen.alias = {};
    for (const alias of [...new Set([...ALIAS_FIJOS, ...deFamilias])]) {
      const r = resolverModelo(alias, lista.modelos);
      resumen.alias[alias] = r.slug ? `${r.slug}${r.nota ? ` (${r.nota})` : ''}` : 'no disponible';
    }
  }
  imprimir(resumen, o.formato);
  return CODIGOS[resumen.estado] ?? 1;
}

// Carpeta nueva y única para un encargo. En la evaluación de la 0.4.0, dos sesiones en paralelo eligieron el mismo
// nombre (fecha y tema) y una pisó el encargo de la otra; otra reutilizó una carpeta vieja aunque la skill lo
// prohibía. mkdirSync sin recursive falla si ya existe: así ninguna carpeta se comparte.
export function carpetaNueva(tema, base = process.env.DELEGAR_AGY_CARPETAS || join(tmpdir(), 'delegar-antigravity')) {
  const limpio = tema.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'encargo';
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  const nombre = `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}-${limpio}`;
  mkdirSync(base, { recursive: true });
  for (let i = 1; ; i++) {
    const ruta = join(base, i === 1 ? nombre : `${nombre}-${i}`);
    try {
      mkdirSync(ruta);
      return ruta;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

// Varios encargos independientes con una sola llamada del orquestador: cada subcarpeta con encargo.md se ejecuta
// como un proceso hijo de este script (con todas sus protecciones), hasta 5 a la vez, y solo vuelve una tabla.
const PARALELO_MAXIMO = 5;

async function correrLote(o, cwdComun) {
  const raiz = rutaReal(o.lote);
  const paralelo = entero('paralelo', o.paralelo);
  if (paralelo > PARALELO_MAXIMO) throw new Error(`--paralelo admite hasta ${PARALELO_MAXIMO} encargos a la vez (lo probado sin agotar la cuota)`);
  let carpetas;
  try {
    carpetas = readdirSync(raiz, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(raiz, e.name, 'encargo.md')))
      .map((e) => join(raiz, e.name))
      .sort();
  } catch {
    throw new Error(`no existe --lote: ${raiz}`);
  }
  if (!carpetas.length) throw new Error(`--lote: ninguna subcarpeta de ${raiz} tiene encargo.md`);
  const comunes = ['--modelo', o.modelo, '--modo', o.modo, '--timeout', o.timeout, '--margen', o.margen, '--max-respuesta', o['max-respuesta'], '--formato', 'json'];
  if (o.esfuerzo) comunes.push('--esfuerzo', o.esfuerzo);
  for (const flag of ['respaldo', 'permitir-secretos', 'seco']) if (o[flag]) comunes.push(`--${flag}`);
  if (o.acceso) comunes.push('--acceso', o.acceso);
  for (const c of o.terminal) comunes.push('--terminal', c);
  for (const d of o.web) comunes.push('--web', d);
  for (const dir of o['add-dir']) comunes.push('--add-dir', resolve(dir));
  // Una sola consulta de modelos antes de lanzar: así los hijos usan la caché en lugar de pedirla 5 veces.
  const bin = ubicarAgy();
  if (bin) await obtenerModelos(bin, { refrescar: o['refrescar-modelos'] });

  const uno = (carpeta) =>
    new Promise((listo) => {
      const args = [fileURLToPath(import.meta.url), '--encargo', join(carpeta, 'encargo.md'), '--cwd', cwdComun ? resolve(cwdComun) : carpeta, ...comunes];
      if (o.esquema) {
        const propio = join(carpeta, o.esquema);
        args.push('--esquema', isAbsolute(o.esquema) ? o.esquema : existsSync(propio) ? propio : resolve(o.esquema));
      }
      // Salida a archivos, como con agy: nada retiene una tubería.
      const salida = join(carpeta, 'resumen.json');
      const errores = join(carpeta, 'lote-errores.txt');
      const [out, err] = [openSync(salida, 'w'), openSync(errores, 'w')];
      const hijo = spawn(process.execPath, args, { stdio: ['ignore', out, err], windowsHide: true });
      let cerrado = false;
      // Node puede emitir «error» y luego «exit»: cerrar dos veces lanzaría EBADF y tumbaría el lote.
      const cerrar = (codigo) => {
        if (cerrado) return;
        cerrado = true;
        closeSync(out);
        closeSync(err);
        let resumen;
        try {
          resumen = JSON.parse(readFileSync(salida, 'utf8'));
          rmSync(errores, { force: true });
        } catch {
          resumen = { estado: 'error', detalle: readFileSync(errores, 'utf8').trim().slice(0, 300) || `código ${codigo}` };
        }
        listo({ carpeta: basename(carpeta), ...resumen });
      };
      hijo.once('error', () => cerrar(null));
      hijo.once('exit', cerrar);
    });

  const resultados = new Array(carpetas.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < carpetas.length) {
      const i = siguiente++;
      resultados[i] = await uno(carpetas[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(paralelo, carpetas.length) }, trabajador));

  const buenos = new Set(['ok', 'seco']);
  const tabla = ['| Encargo | Estado | Modelo | Tiempo |', '|---|---|---|---|'];
  for (const r of resultados) tabla.push(`| ${r.carpeta} | ${r.estado} | ${r.modelo ?? '?'} | ${r.segundos !== undefined ? duracion(r.segundos) : '?'} |`);
  const fallidos = resultados.filter((r) => !buenos.has(r.estado));
  const resumen = {
    estado: fallidos.length ? 'lote_con_fallos' : 'ok',
    lote: raiz,
    encargos: resultados.map(({ carpeta, estado, modelo, segundos, detalle, respuesta_completa }) => ({ carpeta, estado, modelo, segundos, detalle, respuesta_completa })),
    tabla: o.formato === 'json' ? undefined : tabla,
    detalle: fallidos.length
      ? `${fallidos.length} de ${resultados.length} sin ok: ${fallidos.map((r) => `${r.carpeta} (${r.estado}: ${(r.detalle ?? '').slice(0, 120)})`).join('; ')}. El resumen completo de cada uno está en su resumen.json.`
      : `las respuestas están en <subcarpeta>/respuesta.md; el resumen de cada una, en su resumen.json.`,
  };
  imprimir(resumen, o.formato);
  return fallidos.length ? 2 : 0;
}

async function principal() {
  const { values: o } = parseArgs({
    options: {
      encargo: { type: 'string' },
      modelo: { type: 'string', default: MODELO_POR_DEFECTO },
      modo: { type: 'string', default: 'lectura' },
      cwd: { type: 'string' },
      lote: { type: 'string' },
      carpeta: { type: 'string' },
      paralelo: { type: 'string', default: '5' },
      esfuerzo: { type: 'string' },
      timeout: { type: 'string', default: '600' },
      margen: { type: 'string', default: '30' },
      conversacion: { type: 'string' },
      esquema: { type: 'string' },
      'add-dir': { type: 'string', multiple: true, default: [] },
      acceso: { type: 'string' },
      terminal: { type: 'string', multiple: true, default: [] },
      web: { type: 'string', multiple: true, default: [] },
      respaldo: { type: 'boolean', default: false },
      'permitir-secretos': { type: 'boolean', default: false },
      modelos: { type: 'boolean', default: false },
      'refrescar-modelos': { type: 'boolean', default: false },
      'max-respuesta': { type: 'string', default: '2000' },
      formato: { type: 'string', default: 'texto' },
      seco: { type: 'boolean', default: false },
      anotar: { type: 'string' },
      incidencias: { type: 'boolean', default: false },
    },
  });
  // En un lote, cada encargo trabaja en su subcarpeta salvo que se pida un --cwd común.
  const cwdComun = o.cwd;
  o.cwd ??= process.cwd();
  if (o.anotar !== undefined) {
    const texto = o.anotar.trim();
    if (!texto) throw new Error('--anotar necesita el texto de la lección');
    registrarIncidencia({ tipo: 'leccion', proyecto: basename(rutaReal(o.cwd)), texto: texto.slice(0, 1000) });
    imprimir({ estado: 'anotado', detalle: `lección guardada en ${archivoIncidencias()}` }, o.formato);
    return 0;
  }
  if (o.incidencias) {
    const entradas = leerIncidencias();
    if (o.formato === 'json') process.stdout.write(JSON.stringify(entradas, null, 2) + '\n');
    else process.stdout.write(resumirIncidencias(entradas, archivoIncidencias()) + '\n');
    return 0;
  }
  if (o.carpeta !== undefined) {
    const ruta = carpetaNueva(o.carpeta);
    if (o.formato === 'json') imprimir({ estado: 'carpeta', carpeta: ruta }, 'json');
    else process.stdout.write(ruta.replace(/\\/g, '/') + '\n');
    return 0;
  }
  // Antes de nada: un acceso rechazado no debe lanzar ni un solo encargo.
  o.terminal = o.terminal.map((c) => c.trim().replace(/\s+/g, ' '));
  o.web = o.web.map((d) => d.trim().toLowerCase());
  const rechazos = [
    ...(o.acceso !== undefined && o.acceso !== 'sandbox' ? [`--acceso «${o.acceso}»: el único valor es sandbox`] : []),
    ...o.terminal.flatMap((c) => {
      const motivo = motivoRechazoComando(c);
      return motivo ? [`--terminal «${c}»: ${motivo}`] : [];
    }),
    ...o.web.filter((d) => !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(d)).map((d) => `--web «${d}»: da un dominio concreto, sin comodines ni rutas`),
  ];
  if (rechazos.length) {
    imprimir({ estado: 'permiso_rechazado', detalle: `No se ejecutó nada. ${rechazos.join('; ')}.` }, o.formato);
    return CODIGOS.permiso_rechazado;
  }
  if (o.lote !== undefined) return correrLote(o, cwdComun);
  let encargo, cwd, timeout, margen, maxRespuesta;
  if (!o.modelos) {
    if (!o.encargo) throw new Error('falta --encargo <archivo>');
    if (!existsSync(o.encargo)) throw new Error(`no existe el encargo: ${resolve(o.encargo)}`);
    if (!MODOS[o.modo]) throw new Error(`--modo debe ser lectura, plan o edicion, no «${o.modo}»`);
    if (!existsSync(o.cwd)) throw new Error(`no existe --cwd: ${resolve(o.cwd)}`);
    timeout = entero('timeout', o.timeout);
    margen = entero('margen', o.margen);
    maxRespuesta = entero('max-respuesta', o['max-respuesta']);
    encargo = rutaReal(o.encargo);
    cwd = rutaReal(o.cwd);
    // En Windows, CreateProcess no acepta un directorio de trabajo de 259 caracteres o más: spawn daría ENOENT
    // aunque agy exista (pasó con una carpeta del encargo dentro de un directorio temporal anidado).
    if (process.platform === 'win32' && cwd.length > LARGO_MAXIMO_CWD) {
      throw new Error(
        `--cwd tiene ${cwd.length} caracteres y Windows no ejecuta procesos en una carpeta de más de ${LARGO_MAXIMO_CWD}: usa una ruta más corta, como %TEMP%\\delegar-antigravity\\<tema>`,
      );
    }
  }

  const bin = ubicarAgy();
  if (!bin) {
    imprimir({ estado: 'sin_agy', detalle: 'No se encontró agy en el PATH ni en la carpeta de instalación. Instálalo o define AGY_BIN.' }, o.formato);
    return 1;
  }
  if (o.modelos) return listarModelos(bin, o);

  const carpeta = dirname(encargo);
  const addDirs = o['add-dir'].map((d) => rutaReal(d));
  const conTerminal = o.acceso === 'sandbox' || o.terminal.length > 0;
  const ajustes = armarAjustes({ sandbox: o.acceso === 'sandbox', terminal: o.terminal, web: o.web, usuario: permisosDelUsuario() });
  const archivoPermisos = join(carpeta, 'agy-permisos.json');
  // Cada llamada da sus propios accesos: al continuar sin flags, no queda ninguno de la anterior.
  const accesoRetirado = Boolean(o.conversacion) && existsSync(archivoPermisos);
  rmSync(archivoPermisos, { force: true });
  if (ajustes) writeFileSync(archivoPermisos, JSON.stringify(ajustes, null, 2) + '\n');
  const accesos = ajustes
    ? [...(o.acceso === 'sandbox' ? ['sandbox'] : []), ...o.terminal.map((c) => `terminal: ${c}`), ...o.web.map((d) => `web: ${d}`)]
    : undefined;
  const opciones = {
    ajustes: ajustes ? archivoPermisos : undefined,
    conTerminal,
    terminal: o.terminal,
    accesoRetirado,
    encargo,
    modo: o.modo,
    timeout,
    esfuerzo: o.esfuerzo,
    conversacion: o.conversacion,
    esquema: o.esquema && resolve(o.esquema),
    addDirs,
    cwd,
  };

  // Antes de gastar nada: agy podría leer los secretos aunque el encargo lo prohíba.
  const { secretos, completa: busquedaCompleta } = buscarSecretos([...new Set([cwd, carpeta, ...addDirs])], cwd);
  const avisoBusqueda = busquedaCompleta
    ? null
    : `la búsqueda de secretos se detuvo en ${TOPE_ARCHIVOS} archivos por carpeta: puede haber secretos sin detectar; revisa tú el espacio de trabajo o delega desde una carpeta más pequeña`;
  if (secretos.length && !o['permitir-secretos'] && !o.seco) {
    imprimir(
      {
        estado: 'secretos',
        secretos,
        detalle:
          'agy puede leer cualquier archivo del espacio de trabajo aunque el encargo lo prohíba, y lo que lee sale a los servidores de Google. Pregunta al usuario: si acepta, repite con --permitir-secretos; si no, delega desde una carpeta sin esos archivos o hazlo tú.',
      },
      o.formato,
    );
    return CODIGOS.secretos;
  }

  let lista = await obtenerModelos(bin, { refrescar: o['refrescar-modelos'] });
  let refrescada = lista.origen !== 'caché';
  const refrescar = async () => {
    if (refrescada) return;
    lista = await obtenerModelos(bin, { refrescar: true });
    refrescada = true;
  };
  let pedido = resolverModelo(o.modelo, lista.modelos);
  if (!pedido.slug || pedido.disponible === false) {
    await refrescar();
    pedido = resolverModelo(o.modelo, lista.modelos);
  }
  const avisos = () =>
    [lista.aviso, avisoBusqueda, secretos.length && 'el espacio de trabajo tiene secretos y se permitió delegar igual'].filter(Boolean);
  const sinModelo = (detalle) => {
    registrarIncidencia({ tipo: 'incidencia', proyecto: basename(cwd), modo: o.modo, pedido: o.modelo, estado: 'modelo_invalido', detalle });
    imprimir({ estado: 'modelo_invalido', detalle, disponibles: lista.modelos ?? undefined, avisos: avisos() }, o.formato);
    return 1;
  };
  if (!pedido.slug) return sinModelo(`«${o.modelo}» no corresponde a ningún modelo de agy models. Elige uno de los disponibles.`);
  if (pedido.disponible === false && !o.respaldo) return sinModelo(`${pedido.slug} no está en agy models. Elige uno de los disponibles o usa --respaldo.`);
  const extra = { pedido: o.modelo !== pedido.slug ? o.modelo : undefined, nota: pedido.nota };

  if (o.seco) {
    const args = construirArgs({ ...opciones, modelo: pedido.slug });
    const avisosSeco = [lista.aviso, avisoBusqueda].filter(Boolean);
    imprimir(
      {
        estado: 'seco',
        comando: [bin, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
        modelo: pedido.slug,
        ...extra,
        secretos: secretos.length ? secretos : undefined,
        avisos: avisosSeco.length ? avisosSeco : undefined,
      },
      o.formato,
    );
    return 0;
  }

  const extras = [carpeta, ...addDirs];
  const antes = fotoArchivos(cwd, extras);
  // Un comando autorizado con --terminal corre fuera del sandbox y podría darse permisos permanentes.
  const fechaAjustes = () => {
    try {
      return statSync(join(carpetaAgy(), 'settings.json')).mtimeMs;
    } catch {
      return null;
    }
  };
  const ajustesAntes = fechaAjustes();
  const intentos = [];
  const registros = [];
  const probados = new Set();
  let pendientes = [pedido.slug, ...(o.respaldo ? cadenaRespaldo(pedido.slug, lista.modelos) : [])];
  const reintentados = new Set();
  const inicioTotal = Date.now();
  const espera = Number(process.env.DELEGAR_AGY_ESPERA ?? 60) * 1000;
  let final;
  while (pendientes.length) {
    const modelo = pendientes.shift();
    probados.add(modelo);
    if (lista.modelos && !lista.modelos.includes(modelo)) {
      intentos.push({ modelo, estado: 'no_disponible' });
      continue;
    }
    const salida = join(carpeta, 'agy-salida.json');
    const errores = join(carpeta, 'agy-errores.txt');
    const inicio = Date.now();
    const r = await ejecutar(bin, construirArgs({ ...opciones, modelo }), {
      cwd,
      salida,
      errores,
      limiteMs: (timeout + margen) * 1000,
      env: ajustes ? entornoSinSecretos(process.env) : process.env,
    });
    const json = leerJson(salida);
    const stderr = readFileSync(errores, 'utf8');
    const fallosLog = leerLogAgy({ desde: inicio, conversacion: json?.conversation_id || opciones.conversacion });
    final = { modelo, json, inicio, fin: Date.now(), fallosLog, ...clasificar({ json, stderr, fallosLog, ...r }) };
    intentos.push({ modelo, estado: final.estado });
    registros.push({
      fecha: fechaLocal(inicio),
      modelo,
      estado: final.estado,
      segundos: Math.round((final.fin - inicio) / 1000),
      segundos_agy: json?.duration_seconds !== undefined ? Math.round(json.duration_seconds) : undefined,
      tokens: json?.usage?.total_tokens,
      conversacion: json?.conversation_id || undefined,
      denegado: final.denegado?.length ? final.denegado : undefined,
      fallos_log: fallosLog.length ? fallosLog : undefined,
      stderr: stderr.trim().slice(0, 500) || undefined,
    });
    if (!o.respaldo) break;
    if (final.estado === 'modelo_invalido') {
      // La caché listaba un modelo que agy ya no tiene: se refresca, se vuelve a resolver el alias (quizá ya hay
      // un reemplazo, como Argon en lugar de Pro) y se rehace la cadena.
      if (!refrescada) {
        await refrescar();
        const nuevo = resolverModelo(o.modelo, lista.modelos).slug ?? pedido.slug;
        pendientes = [nuevo, ...cadenaRespaldo(nuevo, lista.modelos)].filter((m, i, todos) => !probados.has(m) && todos.indexOf(m) === i);
      }
      continue;
    }
    // Un fallo pasajero se reintenta una vez con el mismo modelo tras una espera (lo que funcionó en los arneses
    // de transcriptor y clinical-logic-mentor); si se repite, sigue la cadena.
    if (final.estado === 'transitorio' && !reintentados.has(modelo)) {
      reintentados.add(modelo);
      pendientes.unshift(modelo);
      await new Promise((listo) => setTimeout(listo, espera));
      continue;
    }
    if (!['cuota', 'modelo_mudo', 'transitorio'].includes(final.estado)) break;
  }
  if (!final) return sinModelo('Ningún modelo de la cadena de respaldo está en agy models.');

  const { json } = final;
  const marcar = (estado, detalle) => {
    final.estado = estado;
    final.detalle = detalle;
    intentos.at(-1).estado = estado;
    registros.at(-1).estado = estado;
  };
  let estructurado = json?.structured_output;
  if (opciones.esquema && estructurado === undefined && final.estado === 'ok') {
    estructurado = extraerJson(json.response);
    if (estructurado === undefined) {
      marcar('incompleto', 'pediste --esquema y la respuesta no trae un JSON válido: continúa con --conversacion pidiendo «responde solo con el JSON, sin texto alrededor».');
    }
  }
  const despues = fotoArchivos(cwd, extras);
  const excluir = [...PROPIOS, ...ENTRADAS].map((n) => join(carpeta, n)).concat(encargo);
  const archivos = archivosTocados(antes, despues, excluir);
  if (o.modo !== 'edicion' && archivos?.length) {
    marcar('edito_en_lectura', 'agy modificó archivos aunque era una tarea de solo lectura: revisa el diff y revierte lo que no se pidió.');
  }
  const idConversacion = json?.conversation_id || opciones.conversacion;
  const comandos = comandosDeAgy(idConversacion, final.inicio);
  registros.at(-1).comandos = comandos.length ? comandos : undefined;
  registros.at(-1).accesos = accesos;
  const permisosPedidos = extraerPermisos(json?.response ?? '');
  if (permisosPedidos.length && final.estado === 'ok' && o.modo !== 'plan') {
    marcar('pide_permiso', 'agy entregó lo que pudo y pide más acceso. Decide cada pedido: continúa con --conversacion y los --terminal o --web que apruebes, o responde en correccion.md por qué no.');
  }
  if (final.denegado?.includes('command') && comandos.length) {
    const ultimo = comandos.at(-1);
    final.detalle += ` Último comando pedido: «${ultimo.comando}»${ultimo.fuera_del_sandbox ? ', fuera del sandbox: reintentó así porque dentro falló; mira por qué falló antes de darle más acceso' : ''}.`;
  }
  // Una línea por ejecución: agy-salida.json y agy-errores.txt se sobrescriben en cada intento y en cada
  // continuación, y un fallo raro (cuota, cuelgue) no se repite a pedido.
  try {
    appendFileSync(join(carpeta, 'historial.jsonl'), registros.map((r) => JSON.stringify(r) + '\n').join(''));
  } catch {}
  // Al registro central va toda ejecución con algún intento fallido, aunque el respaldo haya terminado en ok
  // (así se captura el texto real de un error de cuota).
  // Pedir permiso no es un fallo: es el flujo normal.
  const fallido = registros.find((r) => !['ok', 'pide_permiso'].includes(r.estado));
  if (fallido) {
    registrarIncidencia({
      tipo: 'incidencia',
      proyecto: basename(cwd),
      modo: o.modo,
      pedido: o.modelo,
      modelo: final.modelo,
      estado: final.estado,
      intentos: intentos.length > 1 ? intentos : undefined,
      segundos: registros.at(-1).segundos,
      segundos_agy: registros.at(-1).segundos_agy,
      tokens: registros.at(-1).tokens,
      denegado: fallido.denegado,
      accesos,
      fallos_log: registros.flatMap((r) => r.fallos_log ?? []).slice(0, 5).join(' | ') || undefined,
      detalle: final.estado === 'ok' ? undefined : final.detalle?.slice(0, 300),
      stderr: fallido.stderr?.slice(0, 300),
    });
  }
  if (final.estado === 'modelo_invalido') await refrescar();
  const generados = generadosEnBrain(idConversacion, final.inicio);
  if (ajustes && fechaAjustes() !== ajustesAntes) {
    lista.aviso = [lista.aviso, 'settings.json de agy cambió durante esta ejecución: revísalo, puede haberse dado permisos permanentes.'].filter(Boolean).join(' ');
  }
  const resumen = {
    estado: final.estado,
    modelo: final.modelo,
    ...(final.modelo === pedido.slug ? extra : {}),
    intentos,
    // De reloj y desde el primer intento: duration_seconds de agy es solo el tiempo activo del modelo.
    segundos: Math.round((final.fin - inicioTotal) / 1000),
    segundos_agy: registros.at(-1).segundos_agy,
    tokens: json?.usage?.total_tokens,
    conversacion: json?.conversation_id || undefined,
    archivos,
    accesos,
    comandos: comandos.length ? comandos : undefined,
    permisos_pedidos: permisosPedidos.length ? permisosPedidos : undefined,
    sin_git: antes && !antes[0].git ? true : undefined,
    fallos_log: final.fallosLog.length ? final.fallosLog : undefined,
    generados: generados.length ? generados : undefined,
    denegado: final.denegado,
    detalle: final.detalle,
    disponibles: final.estado === 'modelo_invalido' ? lista.modelos ?? undefined : undefined,
    avisos: avisos().length ? avisos() : undefined,
  };
  const texto = json?.structured_output !== undefined ? JSON.stringify(json.structured_output, null, 2) : json?.response ?? '';
  const completa = join(carpeta, 'respuesta.md');
  const archivoJson = join(carpeta, 'respuesta.json');
  // Una respuesta vieja de otra ejecución no debe pasar por la de esta.
  rmSync(completa, { force: true });
  rmSync(archivoJson, { force: true });
  if (opciones.esquema && estructurado !== undefined) {
    writeFileSync(archivoJson, JSON.stringify(estructurado, null, 2) + '\n');
    resumen.respuesta_json = archivoJson;
  }
  if (texto) {
    writeFileSync(completa, texto);
    const limpia = limpiarEnlaces(texto, cwd).trim();
    resumen.respuesta = limpia.length > maxRespuesta ? limpia.slice(0, maxRespuesta) + `\n… [recortada: ${limpia.length} caracteres en total]` : limpia;
    resumen.respuesta_completa = completa;
  }
  imprimir(resumen, o.formato);
  return CODIGOS[final.estado] ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().then(
    (codigo) => process.exit(codigo),
    (e) => {
      process.stderr.write(`agy.mjs: ${e.message}\n`);
      process.exit(1);
    },
  );
}
