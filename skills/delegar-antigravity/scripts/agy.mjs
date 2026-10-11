#!/usr/bin/env node
// Delega un encargo a Antigravity CLI (agy) y devuelve un resumen breve.
// Node >= 22, sin dependencias. Uso:
//   node agy.mjs --encargo <archivo.md> [--modelo <slug>] [--modo lectura|edicion] [--cwd <proyecto>]
//                [--esfuerzo low|medium|high] [--timeout <s>] [--conversacion <id>] [--esquema <archivo.json>]
//                [--add-dir <carpeta>]... [--respaldo] [--max-respuesta <n>] [--formato texto|json] [--seco]
// Códigos de salida: 0 ok; 2 incompleto (acción denegada o respuesta vacía) o edito_en_lectura; 3 cuota agotada; 1 otro error.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const MODELO_POR_DEFECTO = 'gemini-3.8-flash-medium';

// Cadena de respaldo ante un error de cuota: modelos Gemini de capacidad parecida.
// Nunca cae en un modelo Claude: su cuota en Antigravity es más corta y se reserva para cuando se pide.
export const RESPALDO = {
  'gemini-3.1-pro-high': ['gemini-3.1-pro-low', 'gemini-3.8-flash-high', 'gemini-3.7-flash-high'],
  'gemini-3.1-pro-low': ['gemini-3.8-flash-high', 'gemini-3.7-flash-high'],
  'gemini-3.8-flash-high': ['gemini-3.7-flash-high', 'gemini-3.1-pro-low', 'gemini-3.6-flash-high'],
  'gemini-3.8-flash-medium': ['gemini-3.7-flash-medium', 'gemini-3.6-flash-medium', 'gemini-3.8-flash-high'],
  'gemini-3.8-flash-low': ['gemini-3.7-flash-low', 'gemini-3.6-flash-low', 'gemini-3.8-flash-medium'],
};

const MODOS = { lectura: 'plan', edicion: 'accept-edits' };
const CODIGOS = { ok: 0, seco: 0, incompleto: 2, edito_en_lectura: 2, cuota: 3 };

// Textos con los que agy (o el servicio detrás) avisa de cada problema. El de cuota aún no se ha visto en
// real: cuando aparezca, copia su texto en references/modelos.md y ajusta CUOTA si no coincide.
const CUOTA = /quota|rate.?limit|resource.?exhausted|\b429\b|too many requests|usage limit|limit (?:reached|exceeded)|exhausted|(?:insufficient|no|out of) credits/i;
const AUTH = /authentication required|not authenticated|unauthenticated|log ?in required|please (?:log ?in|sign ?in)/i;
const DENEGADO = /auto-denied|soft[- ]?denied/i;

export function modelosAProbar(modelo, respaldo) {
  if (!respaldo || modelo.startsWith('claude-')) return [modelo];
  return [modelo, ...(RESPALDO[modelo] ?? [])];
}

export function construirArgs({ encargo, modelo, modo = 'lectura', timeout = 600, esfuerzo, conversacion, esquema, addDirs = [] }) {
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
  for (const dir of [dirname(encargo), ...addDirs]) args.push('--add-dir', dir);
  if (esfuerzo) args.push('--effort', esfuerzo);
  if (conversacion) args.push('--conversation', conversacion);
  if (esquema) args.push('--json-schema', esquema);
  return args;
}

export function clasificar({ json, stderr = '', codigo, vencido = false, fallo }) {
  if (vencido) return { estado: 'timeout', detalle: 'agy no terminó dentro del tiempo límite; se cerró su árbol de procesos.' };
  if (fallo) return { estado: 'error', detalle: fallo };
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
    return { estado: 'incompleto', denegado, detalle: stderr.trim().slice(0, 400) || 'agy denegó una acción.' };
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

// Fecha de modificación de cada archivo, para saber qué tocó agy. Con git, solo los archivos con cambios;
// sin git, todo el árbol hasta un tope (si lo supera, no se sabe).
const IGNORADAS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next']);
const TOPE_ARCHIVOS = 20000;

function fotoArchivos(cwd) {
  return fotoGit(cwd) ?? fotoArbol(cwd);
}

function fotoArbol(cwd) {
  const foto = new Map();
  const pendientes = [''];
  while (pendientes.length) {
    const rel = pendientes.pop();
    let entradas;
    try {
      entradas = readdirSync(join(cwd, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      const ruta = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!IGNORADAS.has(e.name)) pendientes.push(ruta);
      } else if (e.isFile()) {
        if (foto.size >= TOPE_ARCHIVOS) return null;
        try {
          foto.set(ruta, statSync(join(cwd, ruta)).mtimeMs);
        } catch {}
      }
    }
  }
  return foto;
}

function fotoGit(cwd) {
  const raiz = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  if (raiz.status !== 0) return null;
  const estado = spawnSync('git', ['-c', 'core.quotepath=off', 'status', '--porcelain', '-uall'], { cwd, encoding: 'utf8' });
  if (estado.status !== 0) return null;
  const foto = new Map();
  for (const linea of estado.stdout.split('\n').filter(Boolean)) {
    const ruta = linea.slice(3).split(' -> ').at(-1).replace(/^"|"$/g, '');
    let fecha = -1;
    try {
      fecha = statSync(join(raiz.stdout.trim(), ruta)).mtimeMs;
    } catch {}
    foto.set(ruta, fecha);
  }
  return foto;
}

function archivosTocados(antes, despues) {
  if (!antes || !despues) return null;
  const rutas = new Set([...antes.keys(), ...despues.keys()]);
  return [...rutas].filter((r) => antes.get(r) !== despues.get(r)).sort();
}

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
  try {
    const texto = readFileSync(archivo, 'utf8').trim();
    const ultima = texto.split('\n').filter(Boolean).at(-1);
    return ultima ? JSON.parse(ultima) : null;
  } catch {
    return null;
  }
}

function imprimir(resumen, formato) {
  if (formato === 'json') {
    process.stdout.write(JSON.stringify(resumen, null, 2) + '\n');
    return;
  }
  const lineas = [`estado: ${resumen.estado}`];
  if (resumen.comando) lineas.push(`comando: ${resumen.comando}`);
  if (resumen.modelo) lineas.push(`modelo: ${resumen.modelo}`);
  if (resumen.intentos?.length > 1) lineas.push(`intentos: ${resumen.intentos.map((i) => `${i.modelo} (${i.estado})`).join(' → ')}`);
  if (resumen.segundos !== undefined) lineas.push(`tiempo: ${resumen.segundos} s · tokens de agy: ${resumen.tokens ?? '?'}`);
  if (resumen.conversacion) lineas.push(`conversación: ${resumen.conversacion}`);
  if (resumen.archivos !== undefined) {
    lineas.push(`archivos tocados: ${resumen.archivos === null ? 'no se sabe (proyecto sin git y demasiado grande)' : resumen.archivos.join(', ') || 'ninguno'}`);
  }
  if (resumen.denegado?.length) lineas.push(`denegado: ${resumen.denegado.join(', ')}`);
  if (resumen.detalle) lineas.push(`detalle: ${resumen.detalle}`);
  if (resumen.respuesta !== undefined) lineas.push(`respuesta (completa en ${resumen.respuesta_completa}):`, resumen.respuesta);
  process.stdout.write(lineas.join('\n') + '\n');
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
      'max-respuesta': { type: 'string', default: '2000' },
      formato: { type: 'string', default: 'texto' },
      seco: { type: 'boolean', default: false },
    },
  });
  if (!o.encargo) throw new Error('falta --encargo <archivo>');
  const encargo = resolve(o.encargo);
  if (!existsSync(encargo)) throw new Error(`no existe el encargo: ${encargo}`);
  if (!MODOS[o.modo]) throw new Error(`--modo debe ser lectura o edicion, no «${o.modo}»`);
  const cwd = resolve(o.cwd);
  const timeout = Number(o.timeout);
  const carpeta = dirname(encargo);
  const opciones = {
    encargo,
    modo: o.modo,
    timeout,
    esfuerzo: o.esfuerzo,
    conversacion: o.conversacion,
    esquema: o.esquema && resolve(o.esquema),
    addDirs: o['add-dir'].map((d) => resolve(d)),
  };

  const bin = ubicarAgy();
  if (!bin) {
    imprimir({ estado: 'sin_agy', detalle: 'No se encontró agy en el PATH ni en la carpeta de instalación. Instálalo o define AGY_BIN.' }, o.formato);
    return 1;
  }
  if (o.seco) {
    const args = construirArgs({ ...opciones, modelo: o.modelo });
    imprimir({ estado: 'seco', comando: [bin, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ') }, o.formato);
    return 0;
  }

  const antes = fotoArchivos(cwd);
  const intentos = [];
  let final;
  for (const modelo of modelosAProbar(o.modelo, o.respaldo)) {
    const salida = join(carpeta, 'agy-salida.json');
    const errores = join(carpeta, 'agy-errores.txt');
    const inicio = Date.now();
    const r = await ejecutar(bin, construirArgs({ ...opciones, modelo }), {
      cwd,
      salida,
      errores,
      limiteMs: (timeout + Number(o.margen)) * 1000,
    });
    const json = leerJson(salida);
    const stderr = readFileSync(errores, 'utf8');
    final = { modelo, json, inicio, ...clasificar({ json, stderr, ...r }) };
    intentos.push({ modelo, estado: final.estado });
    if (final.estado !== 'cuota') break;
  }

  const { json } = final;
  const archivos = archivosTocados(antes, fotoArchivos(cwd));
  if (o.modo === 'lectura' && archivos?.length) {
    final.estado = 'edito_en_lectura';
    final.detalle = 'agy modificó archivos aunque era una tarea de solo lectura: revisa el diff y revierte lo que no se pidió.';
    intentos.at(-1).estado = final.estado;
  }
  const resumen = {
    estado: final.estado,
    modelo: final.modelo,
    intentos,
    segundos: Math.round(json?.duration_seconds ?? (Date.now() - final.inicio) / 1000),
    tokens: json?.usage?.total_tokens,
    conversacion: json?.conversation_id || undefined,
    archivos,
    denegado: final.denegado,
    detalle: final.detalle,
  };
  const texto = json?.structured_output !== undefined ? JSON.stringify(json.structured_output, null, 2) : json?.response ?? '';
  if (texto) {
    const completa = join(carpeta, 'respuesta.md');
    writeFileSync(completa, texto);
    const limpia = limpiarEnlaces(texto, cwd).trim();
    const max = Number(o['max-respuesta']);
    resumen.respuesta = limpia.length > max ? limpia.slice(0, max) + `\n… [recortada: ${limpia.length} caracteres en total]` : limpia;
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
