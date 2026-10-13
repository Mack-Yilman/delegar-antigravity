#!/usr/bin/env node
// Delega un encargo a Antigravity CLI (agy) y devuelve un resumen breve.
// Node >= 22, sin dependencias. Uso:
//   node agy.mjs --encargo <archivo.md> [--modelo <alias|slug>] [--modo lectura|edicion] [--cwd <proyecto>]
//                [--esfuerzo low|medium|high] [--timeout <s>] [--conversacion <id>] [--esquema <archivo.json>]
//                [--add-dir <carpeta>]... [--respaldo] [--permitir-secretos] [--refrescar-modelos]
//                [--max-respuesta <n>] [--formato texto|json] [--seco]
//   node agy.mjs --modelos [--refrescar-modelos] [--formato texto|json]
// Códigos de salida: 0 ok; 2 incompleto o edito_en_lectura; 3 cuota agotada; 4 secretos en el espacio de trabajo;
// 1 otro error.
import { spawn, spawnSync } from 'node:child_process';
import {
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

export const MODELO_POR_DEFECTO = 'flash-medium';
const PREFERENCIA_SIN_NIVEL = ['medium', 'high', 'low'];
// Si la familia pedida no aparece en `agy models`, se usa este alias en su lugar.
const SUSTITUTOS = { pro: 'flash-high' };
// Respaldo ante cuota o modelo inexistente: primero las versiones anteriores del mismo nivel y luego, en orden,
// la versión más nueva de cada nivel vecino. Solo Gemini: la cuota Claude de Antigravity es más corta y se
// reserva para cuando se pide.
export const VECINOS = {
  'pro-high': ['pro-low', 'flash-high'],
  'pro-low': ['flash-high'],
  'flash-high': ['flash-medium'],
  'flash-medium': ['flash-high', 'flash-low'],
  'flash-low': ['flash-medium'],
};
const ALIAS_COMUNES = ['flash-low', 'flash-medium', 'flash-high', 'pro-low', 'pro-high', 'sonnet-low', 'sonnet-medium', 'opus-medium', 'gpt-oss'];
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
  const candidatos = lista
    .map(parsearModelo)
    .filter((p) => p && p.familia === alias.familia && (!alias.nivel || p.nivel === alias.nivel));
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
  const sustituto = SUSTITUTOS[alias.familia];
  const otro = sustituto && mejor(parsearAlias(sustituto), lista);
  if (otro) {
    const familia = alias.familia[0].toUpperCase() + alias.familia.slice(1);
    return { slug: otro, nota: `sin ${familia} en agy models` };
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
  for (const vecino of VECINOS[`${p.familia}-${p.nivel}`] ?? []) {
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
    writeFileSync(temporal, JSON.stringify({ bin, fecha, modelos }));
    renameSync(temporal, archivo);
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

const MODOS = { lectura: 'plan', edicion: 'accept-edits' };
const CODIGOS = { ok: 0, seco: 0, modelos: 0, incompleto: 2, edito_en_lectura: 2, cuota: 3, secretos: 4 };

// Textos con los que agy (o el servicio detrás) avisa de cada problema. El de cuota aún no se ha visto en
// real: cuando aparezca, copia su texto en references/modelos.md y ajusta CUOTA si no coincide.
const CUOTA = /quota|rate.?limit|resource.?exhausted|\b429\b|too many requests|usage limit|limit (?:reached|exceeded)|exhausted|(?:insufficient|no|out of) credits/i;
const AUTH = /authentication required|not authenticated|unauthenticated|log ?in required|please (?:log ?in|sign ?in)/i;
const DENEGADO = /auto-denied|soft[- ]?denied/i;
const PRINT_TIMEOUT = /print.?timeout/i;
const EXPLICA_DENEGADO = {
  command: 'la terminal (agy no puede ejecutar comandos: quita esa necesidad del encargo y córrelos tú)',
  mcp: 'una herramienta MCP (sin regla mcp(servidor/herramienta) en permissions.allow: quítala del encargo o pide al usuario que la permita)',
  read_file: 'leer un archivo (quizá fuera del espacio de trabajo: da rutas dentro de --cwd o agrega la carpeta con --add-dir)',
};

export function construirArgs({ encargo, modelo, modo = 'lectura', timeout = 600, esfuerzo, conversacion, esquema, addDirs = [], cwd }) {
  // --mode plan no impide escribir en modo no interactivo, y a veces prepara un plan en lugar de responder:
  // el mensaje lo deja explícito y el script detecta después cualquier archivo tocado.
  const mensaje =
    `Lee el archivo ${encargo} y cumple el encargo que contiene.` +
    (modo === 'lectura'
      ? ' Es una tarea de solo lectura: no crees, modifiques ni borres archivos, y responde directamente con el resultado en tu respuesta final, sin preparar un plan ni pedir confirmación.'
      : '');
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
  return args;
}

export function clasificar({ json, stderr = '', codigo, vencido = false, fallo }) {
  if (vencido) {
    return { estado: 'timeout', detalle: 'agy no terminó dentro del tiempo límite; se cerró su árbol de procesos. Divide la tarea o sube --timeout.' };
  }
  if (fallo) return { estado: 'error', detalle: fallo };
  if (PRINT_TIMEOUT.test(stderr)) {
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
    return { estado: stderr.trim() ? 'error' : 'json_invalido', detalle };
  }
  if (json.status !== 'SUCCESS') {
    const texto = `${json.error ?? ''}\n${stderr}`.trim();
    const detalle = (texto || `status ${json.status}`).slice(0, 400);
    if (/invalid model selection/i.test(texto)) return { estado: 'modelo_invalido', detalle };
    if (AUTH.test(texto)) return { estado: 'auth', detalle };
    if (CUOTA.test(texto)) return { estado: 'cuota', detalle };
    return { estado: 'error', detalle };
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
function ejecutar(bin, args, { cwd, salida, errores, limiteMs }) {
  return new Promise((listo) => {
    const out = openSync(salida, 'w');
    const err = openSync(errores, 'w');
    const [comando, previos] = /\.m?js$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
    let vencido = false;
    let temporizador;
    const cerrar = (resultado) => {
      clearTimeout(temporizador);
      closeSync(out);
      closeSync(err);
      listo({ vencido, ...resultado });
    };
    const hijo = spawn(comando, [...previos, ...args], {
      cwd,
      stdio: ['ignore', out, err],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    temporizador = setTimeout(() => {
      vencido = true;
      matarArbol(hijo.pid);
    }, limiteMs);
    hijo.on('error', (e) => cerrar({ fallo: e.message }));
    hijo.on('exit', (codigo) => cerrar({ codigo }));
  });
}

// --- Archivos del espacio de trabajo ---

const IGNORADAS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next']);
const TOPE_ARCHIVOS = 20000;
// Lo que el script escribe junto al encargo: no son cambios de agy.
const PROPIOS = ['agy-salida.json', 'agy-errores.txt', 'respuesta.md'];

// Recorre una carpeta sin entrar en IGNORADAS. `visitar` devuelve false en una carpeta para no entrar en ella.
// Devuelve false si se pasó del tope de archivos.
function recorrer(base, visitar) {
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
        if (++archivos > TOPE_ARCHIVOS) return false;
        visitar(ruta, e);
      }
    }
  }
  return true;
}

// agy lee cualquier archivo del espacio de trabajo aunque el encargo lo prohíba (leyó un .dev.vars el 12/10).
const SECRETO = /^(?:\.env(?:\..+)?|\.dev\.vars(?:\..+)?|.+\.(?:key|pem|p12|pfx|token)|credenciales.*|credentials.*|id_rsa|id_ed25519)$/i;
const CARPETA_SECRETA = /^(?:secrets|secretos)$/i;
const EJEMPLO = /\.(?:example|sample|template|ejemplo)$/i;

function buscarSecretos(carpetas, cwd) {
  const hallados = new Set();
  for (const carpeta of carpetas) {
    recorrer(carpeta, (ruta, e) => {
      const relativa = () => relative(cwd, join(carpeta, ruta)).replace(/\\/g, '/');
      if (e.isDirectory()) {
        if (!CARPETA_SECRETA.test(e.name)) return true;
        hallados.add(relativa() + '/');
        return false;
      }
      if (SECRETO.test(e.name) && !EJEMPLO.test(e.name)) hallados.add(relativa());
    });
  }
  return [...hallados].sort();
}

// Fecha de modificación de cada archivo, para saber qué tocó agy. Con git, los archivos con cambios y los
// ignorados (CLAUDE.md, .env); sin git, todo el árbol hasta un tope (si lo supera, no se sabe).
function fotoArchivos(cwd) {
  return fotoGit(cwd) ?? fotoArbol(cwd);
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

function archivosTocados(antes, despues, propios) {
  if (!antes || !despues) return null;
  const excluir = new Set(propios.map((p) => relative(antes.base, p).replace(/\\/g, '/')));
  const rutas = new Set([...antes.mapa.keys(), ...despues.mapa.keys()]);
  return [...rutas].filter((r) => !excluir.has(r) && antes.mapa.get(r) !== despues.mapa.get(r)).sort();
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

function imprimir(resumen, formato) {
  if (formato === 'json') {
    process.stdout.write(JSON.stringify(resumen, null, 2) + '\n');
    return;
  }
  const lineas = [`estado: ${resumen.estado}`];
  if (resumen.lista) lineas.push(`lista: ${resumen.lista}`);
  for (const [grupo, modelos] of Object.entries(resumen.grupos ?? {})) lineas.push(`${grupo}: ${modelos.join(', ')}`);
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
  if (resumen.segundos !== undefined) lineas.push(`tiempo: ${resumen.segundos} s · tokens de agy: ${resumen.tokens ?? '?'}`);
  if (resumen.conversacion) lineas.push(`conversación: ${resumen.conversacion}`);
  if (resumen.archivos !== undefined) {
    const lista = resumen.archivos === null ? 'no se sabe (proyecto sin git y demasiado grande)' : resumen.archivos.join(', ') || 'ninguno';
    lineas.push(`archivos tocados: ${lista}${resumen.sin_git ? ' (sin git: incluye cambios de cualquier proceso)' : ''}`);
  }
  if (resumen.denegado?.length) lineas.push(`denegado: ${resumen.denegado.join(', ')}`);
  if (resumen.secretos?.length) lineas.push(`secretos: ${resumen.secretos.join(', ')}`);
  if (resumen.disponibles?.length) lineas.push(`disponibles: ${resumen.disponibles.join(', ')}`);
  if (resumen.detalle) lineas.push(`detalle: ${resumen.detalle}`);
  for (const aviso of resumen.avisos ?? []) lineas.push(`aviso: ${aviso}`);
  if (resumen.respuesta !== undefined) lineas.push(`respuesta (completa en ${resumen.respuesta_completa}):`, resumen.respuesta);
  process.stdout.write(lineas.join('\n') + '\n');
}

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

// --- Programa ---

async function listarModelos(bin, o) {
  const lista = await obtenerModelos(bin, { refrescar: o['refrescar-modelos'] });
  const resumen = { estado: lista.modelos ? 'modelos' : 'error', avisos: lista.aviso ? [lista.aviso] : undefined };
  if (lista.modelos) {
    resumen.lista = `${lista.origen}, ${fechaLocal(lista.fecha)}`;
    resumen.grupos = agruparModelos(lista.modelos);
    resumen.alias = {};
    for (const alias of ALIAS_COMUNES) {
      const r = resolverModelo(alias, lista.modelos);
      resumen.alias[alias] = r.slug ? `${r.slug}${r.nota ? ` (${r.nota})` : ''}` : 'no disponible';
    }
  }
  imprimir(resumen, o.formato);
  return CODIGOS[resumen.estado] ?? 1;
}

async function principal() {
  const { values: o } = parseArgs({
    options: {
      encargo: { type: 'string' },
      modelo: { type: 'string', default: MODELO_POR_DEFECTO },
      modo: { type: 'string', default: 'lectura' },
      cwd: { type: 'string', default: process.cwd() },
      esfuerzo: { type: 'string' },
      timeout: { type: 'string', default: '600' },
      margen: { type: 'string', default: '30' },
      conversacion: { type: 'string' },
      esquema: { type: 'string' },
      'add-dir': { type: 'string', multiple: true, default: [] },
      respaldo: { type: 'boolean', default: false },
      'permitir-secretos': { type: 'boolean', default: false },
      modelos: { type: 'boolean', default: false },
      'refrescar-modelos': { type: 'boolean', default: false },
      'max-respuesta': { type: 'string', default: '2000' },
      formato: { type: 'string', default: 'texto' },
      seco: { type: 'boolean', default: false },
    },
  });
  let encargo, cwd, timeout, margen, maxRespuesta;
  if (!o.modelos) {
    if (!o.encargo) throw new Error('falta --encargo <archivo>');
    if (!existsSync(o.encargo)) throw new Error(`no existe el encargo: ${resolve(o.encargo)}`);
    if (!MODOS[o.modo]) throw new Error(`--modo debe ser lectura o edicion, no «${o.modo}»`);
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
  const opciones = {
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
  const secretos = buscarSecretos([...new Set([cwd, carpeta, ...addDirs])], cwd);
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
  const avisos = () => [lista.aviso, secretos.length && 'el espacio de trabajo tiene secretos y se permitió delegar igual'].filter(Boolean);
  const sinModelo = (detalle) => {
    imprimir({ estado: 'modelo_invalido', detalle, disponibles: lista.modelos ?? undefined, avisos: avisos() }, o.formato);
    return 1;
  };
  if (!pedido.slug) return sinModelo(`«${o.modelo}» no corresponde a ningún modelo de agy models. Elige uno de los disponibles.`);
  if (pedido.disponible === false && !o.respaldo) return sinModelo(`${pedido.slug} no está en agy models. Elige uno de los disponibles o usa --respaldo.`);
  const extra = { pedido: o.modelo !== pedido.slug ? o.modelo : undefined, nota: pedido.nota };

  if (o.seco) {
    const args = construirArgs({ ...opciones, modelo: pedido.slug });
    imprimir(
      {
        estado: 'seco',
        comando: [bin, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
        modelo: pedido.slug,
        ...extra,
        secretos: secretos.length ? secretos : undefined,
        avisos: lista.aviso ? [lista.aviso] : undefined,
      },
      o.formato,
    );
    return 0;
  }

  const antes = fotoArchivos(cwd);
  const intentos = [];
  const probados = new Set();
  let pendientes = [pedido.slug, ...(o.respaldo ? cadenaRespaldo(pedido.slug, lista.modelos) : [])];
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
    });
    const json = leerJson(salida);
    const stderr = readFileSync(errores, 'utf8');
    final = { modelo, json, inicio, ...clasificar({ json, stderr, ...r }) };
    intentos.push({ modelo, estado: final.estado });
    if (!o.respaldo) break;
    if (final.estado === 'modelo_invalido') {
      // La caché listaba un modelo que agy ya no tiene: se refresca y se rehace la cadena.
      if (!refrescada) {
        await refrescar();
        pendientes = cadenaRespaldo(pedido.slug, lista.modelos).filter((m) => !probados.has(m));
      }
      continue;
    }
    if (final.estado !== 'cuota') break;
  }
  if (!final) return sinModelo('Ningún modelo de la cadena de respaldo está en agy models.');

  const { json } = final;
  const despues = fotoArchivos(cwd);
  const archivos = archivosTocados(antes, despues, PROPIOS.map((n) => join(carpeta, n)));
  if (o.modo === 'lectura' && archivos?.length) {
    final.estado = 'edito_en_lectura';
    final.detalle = 'agy modificó archivos aunque era una tarea de solo lectura: revisa el diff y revierte lo que no se pidió.';
    intentos.at(-1).estado = final.estado;
  }
  if (final.estado === 'modelo_invalido') await refrescar();
  const resumen = {
    estado: final.estado,
    modelo: final.modelo,
    ...(final.modelo === pedido.slug ? extra : {}),
    intentos,
    segundos: Math.round(json?.duration_seconds ?? (Date.now() - final.inicio) / 1000),
    tokens: json?.usage?.total_tokens,
    conversacion: json?.conversation_id || undefined,
    archivos,
    sin_git: antes && !antes.git ? true : undefined,
    denegado: final.denegado,
    detalle: final.detalle,
    disponibles: final.estado === 'modelo_invalido' ? lista.modelos ?? undefined : undefined,
    avisos: avisos().length ? avisos() : undefined,
  };
  const texto = json?.structured_output !== undefined ? JSON.stringify(json.structured_output, null, 2) : json?.response ?? '';
  const completa = join(carpeta, 'respuesta.md');
  // Una respuesta vieja de otra ejecución no debe pasar por la de esta.
  rmSync(completa, { force: true });
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
