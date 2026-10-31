// Pruebas de scripts/agy.mjs contra el agy falso (tests/fake-agy.mjs). No llaman al agy real.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODELO_POR_DEFECTO,
  VERSION,
  armarAjustes,
  buscarSecretos,
  cadenaRespaldo,
  carpetaNueva,
  clasificar,
  construirArgs,
  ejecutar,
  extraerJson,
  extraerPermisos,
  gama,
  limpiarEnlaces,
  motivoRechazoComando,
  reglaComando,
  resolverModelo,
  resumirIncidencias,
} from '../skills/delegar-antigravity/scripts/agy.mjs';
import { LISTA_1025, LISTA_1110, LISTA_1210, LISTA_FUTURA } from './listas-modelos.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repo, 'skills', 'delegar-antigravity', 'scripts', 'agy.mjs');
const falso = join(repo, 'tests', 'fake-agy.mjs');

// Un proyecto, una carpeta de encargo y una caché de modelos nuevos en cada prueba. Se borran al terminar:
// hasta la 0.3.0 quedaban en la carpeta temporal (casi 4000 el 2026-10-25).
const temporales = [];
after(() => {
  for (const t of temporales) rmSync(t, { recursive: true, force: true, maxRetries: 3 });
});

function preparar({ git = false } = {}) {
  // En el runner de Windows, tmpdir() da la ruta corta 8.3 (RUNNER~1) y el script usa la larga (realpath).
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'agy-prueba-')));
  temporales.push(base);
  const proyecto = join(base, 'proyecto');
  const carpeta = join(base, 'encargo');
  mkdirSync(join(proyecto, 'src'), { recursive: true });
  mkdirSync(carpeta);
  writeFileSync(join(proyecto, 'src', 'calculo.js'), 'module.exports = {};\n');
  if (git) {
    writeFileSync(join(proyecto, '.gitignore'), 'CLAUDE.md\n');
    writeFileSync(join(proyecto, 'CLAUDE.md'), 'Notas personales.\n');
    const g = (...a) => spawnSync('git', a, { cwd: proyecto });
    g('init', '-q');
    g('add', '.');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  }
  const encargo = join(carpeta, 'encargo.md');
  writeFileSync(encargo, 'Encargo de prueba.\n');
  return {
    base,
    proyecto,
    carpeta,
    encargo,
    cache: join(base, 'cache'),
    registro: join(base, 'registro.jsonl'),
    incidencias: join(base, 'incidencias', 'incidencias.jsonl'),
    agyHome: join(base, 'agy-home'),
  };
}

function correr(p, escenario, extra = [], env = {}, { cwd = p.proyecto, encargo = p.encargo } = {}) {
  const base = encargo ? ['--encargo', encargo, '--cwd', cwd] : [];
  const r = spawnSync(process.execPath, [script, ...base, '--formato', 'json', ...extra], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      AGY_BIN: falso,
      DELEGAR_AGY_CACHE: p.cache,
      // Nunca el registro, los logs ni el brain/ reales del usuario.
      DELEGAR_AGY_INCIDENCIAS: p.incidencias,
      DELEGAR_AGY_HOME: p.agyHome,
      DELEGAR_AGY_ESPERA: '0',
      FAKE_AGY_ESCENARIO: escenario,
      FAKE_AGY_REGISTRO: p.registro,
      ...env,
    },
  });
  let resumen;
  try {
    resumen = JSON.parse(r.stdout);
  } catch {
    assert.fail(`la salida no es JSON:\n${r.stdout}\n${r.stderr}`);
  }
  const todas = existsSync(p.registro)
    ? readFileSync(p.registro, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    : [];
  // «llamadas» son las ejecuciones de un encargo; «consultas», las de `agy models`.
  const llamadas = todas.filter((l) => l.args[0] !== 'models');
  const consultas = todas.filter((l) => l.args[0] === 'models');
  return { codigo: r.status, resumen, llamadas, consultas, stderr: r.stderr };
}

const lista = (l) => ({ FAKE_AGY_MODELOS: l.join(',') });
const arg = (args, flag) => args[args.indexOf(flag) + 1];

// --- Resolver modelos con la lista vigente ---

test('modelos: un alias se resuelve a la versión más alta de su familia y nivel', () => {
  assert.equal(resolverModelo('flash-medium', LISTA_1210).slug, 'gemini-3.8-flash-medium');
  assert.equal(resolverModelo('flash-medium', LISTA_FUTURA).slug, 'gemini-4.0-flash-medium');
  // Las versiones se comparan como números: 4.0 > 3.10 > 3.8.
  assert.equal(resolverModelo('pro-high', LISTA_FUTURA).slug, 'gemini-4.0-pro-high');
  assert.equal(resolverModelo('pro-high', LISTA_1110).slug, 'gemini-3.1-pro-high');
  assert.equal(resolverModelo('sonnet-low', LISTA_1210).slug, 'claude-sonnet-5-5-low');
  assert.equal(resolverModelo('sonnet-low', LISTA_FUTURA).slug, 'claude-sonnet-6-0-low');
  // Sin nivel, prefiere medium.
  assert.equal(resolverModelo('opus', LISTA_FUTURA).slug, 'claude-opus-6-0-medium');
  assert.equal(resolverModelo('gpt-oss', LISTA_FUTURA).slug, 'gpt-oss-200b-medium');
});

test('modelos: sin Pro ni otra familia potente, pro-* se resuelve a flash-high y lo dice', () => {
  for (const pedido of ['pro-high', 'pro-low']) {
    const r = resolverModelo(pedido, LISTA_1210);
    assert.equal(r.slug, 'gemini-3.8-flash-high', pedido);
    assert.match(r.nota, /sin Pro/, pedido);
  }
});

test('modelos: un nombre exacto se respeta y se marca si no está en la lista', () => {
  assert.deepEqual(resolverModelo('gemini-3.8-flash-low', LISTA_1210), { slug: 'gemini-3.8-flash-low', disponible: true });
  assert.equal(resolverModelo('gemini-3.1-pro-low', LISTA_1210).disponible, false);
  assert.equal(resolverModelo('gemini-3.1-pro-low', LISTA_1210).slug, 'gemini-3.1-pro-low');
  // Una familia que no existe no se resuelve.
  assert.equal(resolverModelo('haiku-low', LISTA_1210).slug, null);
  // Sin lista (agy models falló), un nombre exacto pasa tal cual y un alias no se puede resolver.
  assert.equal(resolverModelo('gemini-3.8-flash-low', null).slug, 'gemini-3.8-flash-low');
  assert.equal(resolverModelo('flash-low', null).slug, null);
});

test('modelos: el respaldo prueba versiones anteriores y luego el nivel vecino, solo con Gemini', () => {
  assert.deepEqual(cadenaRespaldo('gemini-3.8-flash-medium', LISTA_1110), [
    'gemini-3.7-flash-medium',
    'gemini-3.6-flash-medium',
    'gemini-3.8-flash-high',
    'gemini-3.8-flash-low',
  ]);
  // Lo potente cae en lo rápido con más razonamiento, sin pasar por otro nivel potente.
  assert.deepEqual(cadenaRespaldo('gemini-3.1-pro-high', LISTA_1110), ['gemini-3.8-flash-high']);
  assert.deepEqual(cadenaRespaldo('gemini-4-argon-high', LISTA_1025), ['gemini-3.8-flash-high']);
  assert.deepEqual(cadenaRespaldo('gemini-4-argon-low', LISTA_1025), ['gemini-3.8-flash-high']);
  assert.deepEqual(cadenaRespaldo('gemini-3.8-flash-high', LISTA_1210), ['gemini-3.8-flash-medium']);
  // Un modelo que ya no existe también tiene respaldo, según su familia y nivel.
  assert.deepEqual(cadenaRespaldo('gemini-3.1-pro-low', LISTA_1210), ['gemini-3.8-flash-high']);
  // Claude y GPT no tienen respaldo, y ninguna cadena cae en ellos.
  assert.deepEqual(cadenaRespaldo('claude-sonnet-5-5-low', LISTA_1210), []);
  for (const l of [LISTA_1110, LISTA_1210, LISTA_1025, LISTA_FUTURA]) {
    for (const m of l.filter((x) => x.startsWith('gemini-'))) {
      for (const r of cadenaRespaldo(m, l)) {
        assert.match(r, /^gemini-/, `${m} → ${r}`);
        assert.ok(l.includes(r), `${m} → ${r} no está en la lista`);
      }
    }
  }
});

test('modelos: el modelo por defecto es un alias, no un nombre con versión', () => {
  assert.doesNotMatch(MODELO_POR_DEFECTO, /\d/);
  assert.equal(resolverModelo(MODELO_POR_DEFECTO, LISTA_1210).slug, 'gemini-3.8-flash-medium');
});

test('agy: --modelos lista lo vigente por familia y cómo se resuelve cada alias', () => {
  const p = preparar();
  const { codigo, resumen, llamadas } = correr(p, 'exito', ['--modelos'], lista(LISTA_1210), { encargo: null });
  assert.equal(codigo, 0);
  assert.equal(resumen.estado, 'modelos');
  assert.deepEqual(resumen.grupos['gemini flash'], ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low']);
  assert.equal(resumen.grupos['gemini pro'], undefined);
  assert.equal(resumen.alias['flash-medium'], 'gemini-3.8-flash-medium');
  assert.match(resumen.alias['pro-high'], /gemini-3\.8-flash-high.*sin Pro/);
  assert.equal(llamadas.length, 0);
});

test('agy: la lista de modelos se guarda en caché y se refresca a pedido', () => {
  const p = preparar();
  correr(p, 'exito');
  const { consultas } = correr(p, 'exito');
  assert.equal(consultas.length, 1, 'la segunda ejecución usa la caché');
  const { consultas: despues } = correr(p, 'exito', ['--refrescar-modelos']);
  assert.equal(despues.length, 2);
});

test('agy: un alias se resuelve y el resumen dice qué se pidió', () => {
  const p = preparar();
  const { resumen, llamadas } = correr(p, 'exito', ['--modelo', 'pro-high'], lista(LISTA_1210));
  assert.equal(resumen.estado, 'ok');
  assert.equal(resumen.modelo, 'gemini-3.8-flash-high');
  assert.equal(resumen.pedido, 'pro-high');
  assert.match(resumen.nota, /sin Pro/);
  assert.equal(arg(llamadas[0].args, '--model'), 'gemini-3.8-flash-high');
});

test('agy: un modelo que no está en la lista no se ejecuta y el resumen trae los disponibles', () => {
  const p = preparar();
  const { codigo, resumen, llamadas } = correr(p, 'exito', ['--modelo', 'gemini-3.1-pro-low'], lista(LISTA_1210));
  assert.equal(codigo, 1);
  assert.equal(resumen.estado, 'modelo_invalido');
  assert.ok(resumen.disponibles.includes('gemini-3.8-flash-medium'));
  assert.equal(llamadas.length, 0);
});

test('agy: con --respaldo, un modelo que ya no existe salta al siguiente de la cadena', () => {
  const p = preparar();
  const { codigo, resumen, llamadas } = correr(p, 'exito', ['--modelo', 'gemini-3.1-pro-low', '--respaldo'], lista(LISTA_1210));
  assert.equal(codigo, 0);
  assert.equal(resumen.modelo, 'gemini-3.8-flash-high');
  assert.deepEqual(resumen.intentos.map((i) => i.estado), ['no_disponible', 'ok']);
  assert.equal(llamadas.length, 1);
});

test('agy: si agy rechaza un modelo de la caché, refresca la lista y sigue con el respaldo', () => {
  const p = preparar();
  correr(p, 'exito', ['--modelos'], lista(LISTA_1110), { encargo: null });
  // Google quita Flash 3.7 entre una llamada y otra: la caché aún lo lista.
  const { resumen, consultas } = correr(p, 'exito', ['--modelo', 'gemini-3.7-flash-medium', '--respaldo'], lista(LISTA_1210));
  assert.equal(resumen.estado, 'ok');
  assert.equal(resumen.modelo, 'gemini-3.8-flash-high');
  assert.deepEqual(resumen.intentos.map((i) => i.estado), ['modelo_invalido', 'ok']);
  assert.equal(consultas.length, 2, 'la de --modelos y un solo refresco');
});

test('agy: si agy models falla, un nombre exacto sigue funcionando y lo avisa', () => {
  const p = preparar();
  const { resumen } = correr(p, 'exito', ['--modelo', 'gemini-3.8-flash-low'], { FAKE_AGY_MODELS_FALLA: '1' });
  assert.equal(resumen.estado, 'ok');
  assert.match(resumen.avisos.join('\n'), /agy models/);
  const { codigo, resumen: r2 } = correr(p, 'exito', ['--modelo', 'flash-low'], { FAKE_AGY_MODELS_FALLA: '1' });
  assert.equal(codigo, 1);
  assert.equal(r2.estado, 'modelo_invalido');
});

// --- Ejecutar un encargo ---

test('agy: éxito de solo lectura con los flags seguros', () => {
  const p = preparar();
  const { codigo, resumen, llamadas } = correr(p, 'exito', ['--modelo', 'gemini-3.8-flash-low']);
  assert.equal(codigo, 0);
  assert.equal(resumen.estado, 'ok');
  assert.equal(resumen.modelo, 'gemini-3.8-flash-low');
  assert.equal(resumen.pedido, undefined);
  assert.equal(resumen.conversacion, '297fcc3e-19ea-4601-a61a-67a132cb03c1');
  assert.equal(resumen.tokens, 65931);
  const [{ args, cwd }] = llamadas;
  assert.equal(resolve(cwd), resolve(p.proyecto), 'agy corre con el proyecto como directorio de trabajo');
  for (const flag of ['--sandbox', '--output-format', '--print-timeout', '--model', '--add-dir']) assert.ok(args.includes(flag), flag);
  assert.equal(arg(args, '--mode'), 'plan');
  assert.equal(arg(args, '--add-dir'), p.carpeta);
  assert.match(arg(args, '-p'), /encargo\.md/);
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  // La respuesta completa queda junto al encargo y el resumen acorta los enlaces file:///.
  assert.ok(existsSync(join(p.carpeta, 'respuesta.md')));
  assert.match(resumen.respuesta, /src\/calculo\.js/);
  assert.doesNotMatch(resumen.respuesta, /file:\/\//);
});

test('agy: el modo edición usa accept-edits y lista los archivos tocados', () => {
  const p = preparar({ git: true });
  const { codigo, resumen, llamadas } = correr(p, 'edita', ['--modo', 'edicion']);
  assert.equal(codigo, 0);
  assert.equal(arg(llamadas[0].args, '--mode'), 'accept-edits');
  assert.deepEqual(resumen.archivos, ['nuevo.txt']);
  assert.equal(resumen.sin_git, undefined);
});

test('agy: si edita en modo lectura, lo marca y lista los archivos', () => {
  // --mode plan no impide escribir en modo no interactivo (comprobado con agy 1.3.3): el script lo detecta.
  const p = preparar({ git: true });
  const { codigo, resumen, llamadas } = correr(p, 'edita');
  assert.equal(codigo, 2);
  assert.equal(resumen.estado, 'edito_en_lectura');
  assert.deepEqual(resumen.archivos, ['nuevo.txt']);
  assert.match(arg(llamadas[0].args, '-p'), /solo lectura/);
});

test('agy: detecta la edición de un archivo que git ignora', () => {
  // CLAUDE.md, .env y .dev.vars están en el .gitignore de los repos del usuario: git status no los ve.
  const p = preparar({ git: true });
  const { resumen } = correr(p, 'edita_ignorado');
  assert.equal(resumen.estado, 'edito_en_lectura');
  assert.deepEqual(resumen.archivos, ['CLAUDE.md']);
});

test('agy: sin git, detecta los archivos tocados por su fecha de modificación y lo avisa', () => {
  const p = preparar();
  const { resumen } = correr(p, 'edita', ['--modo', 'edicion']);
  assert.equal(resumen.estado, 'ok');
  assert.deepEqual(resumen.archivos, ['nuevo.txt']);
  assert.equal(resumen.sin_git, true);
});

test('agy: con la carpeta del encargo como --cwd, sus propios archivos no cuentan como tocados', () => {
  // El patrón del revisor de tesis-salud: las secciones extraídas viven junto al encargo.
  const p = preparar();
  writeFileSync(join(p.carpeta, 'seccion.md'), 'Texto de una sección.\n');
  for (const vez of [1, 2]) {
    const { codigo, resumen, llamadas } = correr(p, 'exito', [], {}, { cwd: p.carpeta });
    assert.equal(resumen.estado, 'ok', `vez ${vez}: ${resumen.detalle}`);
    assert.equal(codigo, 0);
    assert.deepEqual(resumen.archivos, []);
    assert.equal(llamadas.at(-1).args.filter((a) => a === '--add-dir').length, 0, 'no repite el cwd con --add-dir');
  }
});

test('agy: editar el encargo o la corrección mientras agy trabaja no es «edito_en_lectura»', () => {
  // Pasó al reforzar el encargo de varias tareas en paralelo: el orquestador escribe esos archivos, no agy.
  for (const git of [false, true]) {
    const p = preparar({ git });
    const { resumen } = correr(p, 'toca_encargo', [], {}, { cwd: p.carpeta });
    assert.equal(resumen.estado, 'ok', `git: ${git}`);
    assert.deepEqual(resumen.archivos, [], `git: ${git}`);
    const correccion = join(p.carpeta, 'correccion.md');
    writeFileSync(correccion, 'Entrega ya.\n');
    const { resumen: r2 } = correr(p, 'toca_encargo', ['--conversacion', 'abc'], {}, { encargo: correccion });
    assert.equal(r2.estado, 'ok', `corrección, git: ${git}`);
  }
});

test('agy: vigila también la carpeta del encargo y las de --add-dir, fuera del --cwd', () => {
  const p = preparar({ git: true });
  const { codigo, resumen } = correr(p, 'edita_add_dir');
  assert.equal(codigo, 2);
  assert.equal(resumen.estado, 'edito_en_lectura');
  assert.deepEqual(resumen.archivos, ['../encargo/plan.md']);
  // En modo edición, lo que escribe ahí (p. ej., resultado.md) se lista y no es un error.
  const p2 = preparar({ git: true });
  const r2 = correr(p2, 'edita_add_dir', ['--modo', 'edicion']);
  assert.equal(r2.resumen.estado, 'ok');
  assert.deepEqual(r2.resumen.archivos, ['../encargo/plan.md']);
});

test('agy: historial.jsonl guarda una línea por ejecución, con el texto de stderr', () => {
  // agy-salida.json y agy-errores.txt se sobrescriben: sin historial, el texto de un fallo se pierde.
  const p = preparar();
  correr(p, 'exito');
  const { resumen } = correr(p, 'print_timeout', ['--conversacion', '297fcc3e-19ea-4601-a61a-67a132cb03c1']);
  assert.equal(resumen.estado, 'timeout');
  const lineas = readFileSync(join(p.carpeta, 'historial.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0].estado, 'ok');
  assert.equal(lineas[0].modelo, 'gemini-3.8-flash-medium');
  assert.equal(lineas[0].tokens, 65931);
  assert.equal(lineas[1].estado, 'timeout');
  assert.match(lineas[1].stderr, /print timeout after 6m40s/);
  assert.equal(lineas[1].conversacion, '297fcc3e-19ea-4601-a61a-67a132cb03c1');
  // El historial es del script: no cuenta como archivo tocado.
  assert.deepEqual(resumen.archivos, []);
});

test('agy: con --respaldo, el historial anota cada intento', () => {
  const p = preparar();
  correr(p, 'cuota', ['--respaldo'], { FAKE_AGY_CUOTA: 'gemini-3.8-flash-medium' });
  const lineas = readFileSync(join(p.carpeta, 'historial.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lineas.map((l) => l.estado), ['cuota', 'ok']);
  assert.match(lineas[0].stderr, /RESOURCE_EXHAUSTED/);
});

// --- Registro central de incidencias ---

const incidencias = (p) =>
  existsSync(p.incidencias) ? readFileSync(p.incidencias, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];

test('incidencias: una ejecución ok no se registra; una fallida sí, sin el encargo ni la respuesta', () => {
  const p = preparar();
  writeFileSync(p.encargo, 'Encargo con un dato confidencial inventado: DNI 40871234.\n');
  correr(p, 'exito');
  assert.deepEqual(incidencias(p), []);
  correr(p, 'denegado');
  const [i] = incidencias(p);
  assert.equal(i.tipo, 'incidencia');
  assert.equal(i.estado, 'incompleto');
  assert.deepEqual(i.denegado, ['command']);
  assert.equal(i.proyecto, 'proyecto');
  assert.equal(i.version, VERSION);
  assert.match(i.stderr, /auto-denied/);
  assert.doesNotMatch(readFileSync(p.incidencias, 'utf8'), /40871234|Encargo con/);
});

test('incidencias: con respaldo que termina en ok, igual registra el error de cuota con su texto', () => {
  const p = preparar();
  correr(p, 'cuota', ['--respaldo'], { FAKE_AGY_CUOTA: 'gemini-3.8-flash-medium' });
  const [i] = incidencias(p);
  assert.equal(i.estado, 'ok');
  assert.deepEqual(i.intentos.map((t) => t.estado), ['cuota', 'ok']);
  assert.match(i.stderr, /RESOURCE_EXHAUSTED/);
});

test('incidencias: edito_en_lectura y un modelo inexistente también se registran', () => {
  const p = preparar({ git: true });
  correr(p, 'edita');
  correr(p, 'exito', ['--modelo', 'gemini-3.1-pro-low'], lista(LISTA_1210));
  assert.deepEqual(incidencias(p).map((i) => i.estado), ['edito_en_lectura', 'modelo_invalido']);
});

test('incidencias: --anotar guarda una lección y --incidencias las resume en markdown', () => {
  const p = preparar();
  correr(p, 'denegado');
  const previo = correr(p, 'print_timeout');
  const anotar = correr(p, 'exito', ['--anotar', 'Flash pidió la terminal porque el README nombraba comandos'], {}, { encargo: null });
  assert.equal(anotar.codigo, 0);
  assert.equal(anotar.resumen.estado, 'anotado');
  // El registro del agy falso es acumulado: --anotar no agrega llamadas.
  assert.equal(anotar.llamadas.length + anotar.consultas.length, previo.llamadas.length + previo.consultas.length, 'no necesita agy');
  const leccion = incidencias(p).at(-1);
  assert.equal(leccion.tipo, 'leccion');
  assert.match(leccion.texto, /README/);
  const r = spawnSync(process.execPath, [script, '--incidencias'], {
    encoding: 'utf8',
    env: { ...process.env, AGY_BIN: join(p.base, 'no-hay-agy.exe'), DELEGAR_AGY_INCIDENCIAS: p.incidencias },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /2 incidencias y 1 lecciones/);
  assert.match(r.stdout, /\| incompleto \| 1 \|/);
  assert.match(r.stdout, /\| timeout \| 1 \|/);
  assert.match(r.stdout, /\| command \| 1 \|/);
  assert.match(r.stdout, /print timeout after 6m40s/);
  assert.match(r.stdout, /README nombraba comandos/);
  assert.match(resumirIncidencias([], 'x.jsonl'), /Sin incidencias/);
});

test('agy: si no puede guardar la caché de modelos, sigue con la lista obtenida', () => {
  // Con varias tareas en paralelo, Windows puede negar el reemplazo del archivo de caché.
  const p = preparar();
  mkdirSync(join(p.cache, 'modelos.json'), { recursive: true });
  const { codigo, resumen } = correr(p, 'exito');
  assert.equal(codigo, 0);
  assert.equal(resumen.estado, 'ok');
});

test('agy: el modelo por defecto es explícito, nunca el de la configuración de agy', () => {
  const p = preparar();
  const { llamadas } = correr(p, 'exito');
  assert.equal(arg(llamadas[0].args, '--model'), 'gemini-3.8-flash-medium');
});

test('agy: pasa esfuerzo, conversación y esquema', () => {
  const p = preparar();
  const esquema = join(p.carpeta, 'esquema.json');
  writeFileSync(esquema, '{"type":"object"}');
  const { llamadas } = correr(p, 'exito', ['--esfuerzo', 'high', '--conversacion', 'abc-123', '--esquema', esquema]);
  const { args } = llamadas[0];
  // agy rechaza «--model gemini-3.8-flash-medium --effort high»: con esfuerzo, el nivel sale del nombre.
  assert.equal(arg(args, '--model'), 'gemini-3.8-flash');
  assert.equal(arg(args, '--effort'), 'high');
  assert.equal(arg(args, '--conversation'), 'abc-123');
  assert.equal(arg(args, '--json-schema'), esquema);
});

test('agy: una acción denegada es «incompleto» aunque agy salga con 0', () => {
  const p = preparar();
  const { codigo, resumen } = correr(p, 'denegado');
  assert.equal(codigo, 2);
  assert.equal(resumen.estado, 'incompleto');
  assert.deepEqual(resumen.denegado, ['command']);
});

test('agy: una URL denegada es «incompleto» y el detalle lo explica', () => {
  const p = preparar();
  const { codigo, resumen } = correr(p, 'denegado_url');
  assert.equal(codigo, 2);
  assert.equal(resumen.estado, 'incompleto');
  assert.deepEqual(resumen.denegado, ['read_url']);
  assert.match(resumen.detalle, /URL/);
});

test('agy: una respuesta vacía sin denegaciones también es «incompleto»', () => {
  const p = preparar();
  const { codigo, resumen } = correr(p, 'vacio');
  assert.equal(codigo, 2);
  assert.equal(resumen.estado, 'incompleto');
});

test('agy: si agy agota su propio tiempo, es «timeout» y conserva la conversación para rescatarla', () => {
  const p = preparar();
  const { codigo, resumen } = correr(p, 'print_timeout', ['--timeout', '900']);
  assert.equal(codigo, 1);
  assert.equal(resumen.estado, 'timeout');
  assert.equal(resumen.conversacion, '297fcc3e-19ea-4601-a61a-67a132cb03c1');
  assert.match(resumen.detalle, /--conversacion/);
});

test('agy: modelo inválido, sin sesión y JSON roto se distinguen', () => {
  for (const [escenario, estado] of [['modelo_invalido', 'modelo_invalido'], ['auth', 'auth'], ['json_roto', 'json_invalido']]) {
    const p = preparar();
    const { codigo, resumen } = correr(p, escenario);
    assert.equal(resumen.estado, estado, escenario);
    assert.equal(codigo, 1, escenario);
  }
});

test('agy: sin --respaldo, un error de cuota se informa y no cambia de modelo', () => {
  const p = preparar();
  const { codigo, resumen, llamadas } = correr(p, 'cuota', [], { FAKE_AGY_CUOTA: 'gemini-3.8-flash-medium' });
  assert.equal(codigo, 3);
  assert.equal(resumen.estado, 'cuota');
  assert.equal(llamadas.length, 1);
  assert.match(resumen.detalle, /quota/);
});

test('agy: con --respaldo, recorre la cadena hasta un modelo con cuota', () => {
  const p = preparar();
  const cadena = cadenaRespaldo('gemini-3.8-flash-medium', LISTA_1110);
  const agotados = ['gemini-3.8-flash-medium', cadena[0]];
  const { codigo, resumen, llamadas } = correr(p, 'cuota', ['--respaldo'], { ...lista(LISTA_1110), FAKE_AGY_CUOTA: agotados.join(',') });
  assert.equal(codigo, 0);
  assert.equal(resumen.estado, 'ok');
  assert.equal(resumen.modelo, cadena[1]);
  assert.deepEqual(resumen.intentos.map((i) => i.estado), ['cuota', 'cuota', 'ok']);
  assert.equal(llamadas.length, 3);
});

test('agy: con --respaldo y todo agotado, termina en «cuota»', () => {
  const p = preparar();
  const todos = ['gemini-3.8-flash-medium', ...cadenaRespaldo('gemini-3.8-flash-medium', LISTA_1110)].join(',');
  const { codigo, resumen } = correr(p, 'cuota', ['--respaldo'], { ...lista(LISTA_1110), FAKE_AGY_CUOTA: todos });
  assert.equal(codigo, 3);
  assert.equal(resumen.estado, 'cuota');
});

test('agy: el tiempo límite mata el árbol de procesos y no se cuelga', () => {
  const p = preparar();
  const nieto = join(p.base, 'nieto.pid');
  const inicio = Date.now();
  const { codigo, resumen } = correr(p, 'lento', ['--timeout', '1', '--margen', '1'], { FAKE_AGY_NIETO: nieto });
  assert.equal(resumen.estado, 'timeout');
  assert.equal(codigo, 1);
  assert.ok(Date.now() - inicio < 30000, 'debe volver poco después del tiempo límite');
  const pid = Number(readFileSync(nieto, 'utf8'));
  let vivo = true;
  try {
    process.kill(pid, 0);
  } catch {
    vivo = false;
  }
  if (vivo) process.kill(pid);
  assert.equal(vivo, false, 'el nieto de agy también debe terminar');
});

test('agy: si el proceso no muere tras matarlo, ejecutar vuelve igual y da su PID', async () => {
  // Una vez el tiempo límite no cortó una tarea de 20 min. Se simula un cierre que no surte efecto.
  const p = preparar();
  const nieto = join(p.base, 'nieto.pid');
  const previo = { escenario: process.env.FAKE_AGY_ESCENARIO, nieto: process.env.FAKE_AGY_NIETO };
  process.env.FAKE_AGY_ESCENARIO = 'lento';
  process.env.FAKE_AGY_NIETO = nieto;
  const inicio = Date.now();
  let r;
  try {
    r = await ejecutar(falso, [], {
      cwd: p.proyecto,
      salida: join(p.carpeta, 'salida.json'),
      errores: join(p.carpeta, 'errores.txt'),
      limiteMs: 500,
      matar: () => {},
      esperaTrasMatar: 500,
    });
  } finally {
    for (const [clave, valor] of [['FAKE_AGY_ESCENARIO', previo.escenario], ['FAKE_AGY_NIETO', previo.nieto]]) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
    if (r?.sinCerrar) process.kill(r.sinCerrar);
    if (existsSync(nieto)) {
      try {
        process.kill(Number(readFileSync(nieto, 'utf8')));
      } catch {}
    }
  }
  assert.ok(Date.now() - inicio < 10000);
  assert.equal(r.vencido, true);
  assert.ok(r.sinCerrar > 0);
  const c = clasificar({ ...r, json: null, stderr: '' });
  assert.equal(c.estado, 'timeout');
  assert.match(c.detalle, new RegExp(`proceso ${r.sinCerrar}`));
});

test('agy: la respuesta larga se recorta en el resumen pero queda completa en el archivo', () => {
  const p = preparar();
  const { resumen } = correr(p, 'largo', ['--max-respuesta', '300']);
  assert.ok(resumen.respuesta.length < 400);
  assert.equal(readFileSync(join(p.carpeta, 'respuesta.md'), 'utf8').length, 5000);
});

test('agy: --seco muestra el comando sin ejecutar agy', () => {
  const p = preparar();
  const { codigo, resumen, llamadas } = correr(p, 'exito', ['--seco']);
  assert.equal(codigo, 0);
  assert.equal(resumen.estado, 'seco');
  assert.ok(resumen.comando.includes('--sandbox'));
  assert.ok(resumen.comando.includes('gemini-3.8-flash-medium'));
  assert.equal(llamadas.length, 0);
});

// --- Secretos ---

test('agy: si el espacio de trabajo tiene secretos, no ejecuta agy salvo con --permitir-secretos', () => {
  const p = preparar();
  writeFileSync(join(p.proyecto, '.env'), 'CLAVE=inventada\n');
  writeFileSync(join(p.proyecto, 'src', 'servidor.pem'), 'inventado\n');
  const { codigo, resumen, llamadas, consultas } = correr(p, 'exito');
  assert.equal(codigo, 4);
  assert.equal(resumen.estado, 'secretos');
  assert.deepEqual(resumen.secretos.sort(), ['.env', 'src/servidor.pem']);
  assert.equal(llamadas.length + consultas.length, 0, 'ni siquiera consulta los modelos');
  const permitido = correr(p, 'exito', ['--permitir-secretos']);
  assert.equal(permitido.resumen.estado, 'ok');
  assert.equal(permitido.llamadas.length, 1);
});

test('agy: también revisa las carpetas de --add-dir y no bloquea los archivos de ejemplo', () => {
  const p = preparar();
  writeFileSync(join(p.proyecto, '.env.example'), 'CLAVE=\n');
  const otra = join(p.base, 'otra');
  mkdirSync(otra);
  writeFileSync(join(otra, '.dev.vars'), 'SECRETO=inventado\n');
  const { resumen } = correr(p, 'exito', ['--add-dir', otra]);
  assert.equal(resumen.estado, 'secretos');
  assert.equal(resumen.secretos.length, 1);
  assert.match(resumen.secretos[0], /\.dev\.vars$/);
});

test('agy: detecta credenciales comunes además de .env y claves', () => {
  const p = preparar();
  const nombres = ['client_secret_123.apps.googleusercontent.com.json', 'service-account.json', '.netrc', '.pgpass', 'id_ecdsa', 'release.keystore'];
  for (const n of nombres) writeFileSync(join(p.proyecto, n), 'inventado\n');
  writeFileSync(join(p.proyecto, 'package.json'), '{}\n');
  const { secretos, completa } = buscarSecretos([p.proyecto], p.proyecto);
  assert.deepEqual(secretos, [...nombres].sort());
  assert.equal(completa, true);
});

test('agy: si la búsqueda de secretos se detiene por el tope, lo avisa', () => {
  const p = preparar();
  for (let i = 0; i < 5; i++) writeFileSync(join(p.proyecto, `a${i}.txt`), '');
  assert.equal(buscarSecretos([p.proyecto], p.proyecto, 3).completa, false);
  assert.equal(buscarSecretos([p.proyecto], p.proyecto).completa, true);
});

test('agy: --seco informa los secretos sin bloquear', () => {
  const p = preparar();
  writeFileSync(join(p.proyecto, '.env'), 'CLAVE=inventada\n');
  const { codigo, resumen } = correr(p, 'exito', ['--seco']);
  assert.equal(codigo, 0);
  assert.equal(resumen.estado, 'seco');
  assert.deepEqual(resumen.secretos, ['.env']);
});

// --- Argumentos ---

test('agy: rechaza un encargo inexistente, un modo desconocido y números inválidos', () => {
  const p = preparar();
  const env = { ...process.env, AGY_BIN: falso, DELEGAR_AGY_CACHE: p.cache };
  const r1 = spawnSync(process.execPath, [script, '--encargo', join(p.base, 'no-existe.md')], { encoding: 'utf8', env });
  assert.equal(r1.status, 1);
  const r2 = spawnSync(process.execPath, [script, '--encargo', p.encargo, '--modo', 'yolo'], { encoding: 'utf8', env });
  assert.equal(r2.status, 1);
  // Number('abc') es NaN y setTimeout(NaN) dispara al instante: mataría a agy apenas empieza.
  for (const [flag, valor] of [['--timeout', 'abc'], ['--margen', '-1'], ['--max-respuesta', '0']]) {
    const r = spawnSync(process.execPath, [script, '--encargo', p.encargo, '--cwd', p.proyecto, flag, valor], { encoding: 'utf8', env });
    assert.equal(r.status, 1, `${flag} ${valor}`);
    assert.match(r.stderr, new RegExp(flag.slice(2)), `${flag} ${valor}`);
  }
});

test('agy: en Windows, rechaza un --cwd de 259 caracteres o más con un mensaje claro', { skip: process.platform !== 'win32' }, () => {
  // CreateProcess no acepta ese directorio de trabajo y spawn da ENOENT aunque agy exista.
  const p = preparar();
  const largo = join(p.base, 'x'.repeat(Math.max(1, 270 - p.base.length - 1)));
  mkdirSync(largo, { recursive: true });
  const r = spawnSync(process.execPath, [script, '--encargo', p.encargo, '--cwd', largo], {
    encoding: 'utf8',
    env: { ...process.env, AGY_BIN: falso, DELEGAR_AGY_CACHE: p.cache },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--cwd tiene \d+ caracteres/);
});

test('agy: si no encuentra agy, lo dice', () => {
  const p = preparar();
  const r = spawnSync(process.execPath, [script, '--encargo', p.encargo, '--formato', 'json'], {
    encoding: 'utf8',
    env: { ...process.env, AGY_BIN: join(p.base, 'no-hay-agy.exe'), DELEGAR_AGY_CACHE: p.cache },
  });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).estado, 'sin_agy');
});

// --- Funciones puras ---

test('agy: los enlaces file:/// se vuelven rutas relativas sin perder su texto', () => {
  const cwd = process.platform === 'win32' ? 'C:\\p\\proyecto' : '/p/proyecto';
  const raiz = process.platform === 'win32' ? 'C:/p/proyecto' : 'p/proyecto';
  assert.equal(limpiarEnlaces(`[calculo.js](file:///${raiz}/src/calculo.js)`, cwd), '`src/calculo.js`');
  assert.equal(limpiarEnlaces(`[leerDato](file:///${raiz}/src/almacen.js#L2)`, cwd), 'leerDato (`src/almacen.js#L2`)');
  assert.equal(limpiarEnlaces(`[\`texto.js\`](file:///${raiz}/src/texto.js)`, cwd), '`src/texto.js`');
});

test('agy: clasificar reconoce los textos reales de agy', () => {
  assert.equal(clasificar({ json: { status: 'SUCCESS', response: 'hola' }, stderr: '', codigo: 0 }).estado, 'ok');
  assert.equal(
    clasificar({ json: { status: 'ERROR', error: 'invalid model selection (--model "x")' }, stderr: '', codigo: 1 }).estado,
    'modelo_invalido',
  );
  for (const texto of ['RESOURCE_EXHAUSTED', 'Quota exceeded', 'rate limit reached', 'HTTP 429 Too Many Requests']) {
    assert.equal(clasificar({ json: { status: 'ERROR', error: texto }, stderr: '', codigo: 1 }).estado, 'cuota', texto);
  }
  assert.equal(clasificar({ json: { status: 'ERROR', error: 'usage limit reached' }, stderr: '', codigo: 1 }).estado, 'cuota');
  // Un límite de contexto no es cuota: cambiar de modelo con --respaldo no lo arregla.
  for (const texto of ['context length limit exceeded', 'maximum context window exhausted', 'token limit exceeded']) {
    assert.equal(clasificar({ json: { status: 'ERROR', error: texto }, stderr: '', codigo: 1 }).estado, 'error', texto);
  }
  // El texto real del print timeout (2026-10-14).
  const pt = clasificar({ json: { status: 'SUCCESS', response: '' }, stderr: '[agy] print timeout after 6m40s with turn in progress; returning partial output', codigo: 0 });
  assert.equal(pt.estado, 'timeout');
  // Una respuesta exitosa que menciona «quota» no es un error de cuota.
  assert.equal(clasificar({ json: { status: 'SUCCESS', response: 'la quota del API' }, stderr: '', codigo: 0 }).estado, 'ok');
  const mcp = clasificar({ json: { status: 'SUCCESS', response: '', denied_actions: [{ action: 'mcp' }] }, stderr: 'jetski: no output produced', codigo: 0 });
  assert.equal(mcp.estado, 'incompleto');
  assert.match(mcp.detalle, /MCP/);
});

test('agy: nunca arma --dangerously-skip-permissions y siempre pasa modelo y tiempo límite', () => {
  const args = construirArgs({ encargo: 'C:/x/encargo.md', modelo: 'gemini-3.8-flash-low', modo: 'edicion', timeout: 600 });
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.equal(arg(args, '--model'), 'gemini-3.8-flash-low');
  assert.equal(arg(args, '--print-timeout'), '600s');
  assert.doesNotMatch(readFileSync(script, 'utf8'), /dangerously-skip-permissions/);
});

// --- 0.4.0: gamas de modelos ---

test('gamas: rapido-* y potente-* eligen la versión más alta de su gama, con familias nuevas incluidas', () => {
  assert.equal(gama('flash'), 'rapido');
  assert.equal(gama('flash-lite'), 'rapido');
  assert.equal(gama('argon'), 'potente');
  assert.equal(resolverModelo('potente-high', LISTA_1025).slug, 'gemini-4-argon-high');
  assert.equal(resolverModelo('potente-low', LISTA_1025).slug, 'gemini-4-argon-low');
  assert.equal(resolverModelo('rapido-medium', LISTA_1025).slug, 'gemini-3.8-flash-medium');
  assert.equal(resolverModelo('argon-medium', LISTA_1025).slug, 'gemini-4-argon-medium');
  // Una familia inventada de versión mayor gana sin tocar el código; Pro 4.0 sigue disponible por su nombre.
  assert.equal(resolverModelo('potente-high', LISTA_FUTURA).slug, 'gemini-5-xenon-high');
  assert.equal(resolverModelo('pro-high', LISTA_FUTURA).slug, 'gemini-4.0-pro-high');
  assert.equal(resolverModelo('rapido-high', LISTA_FUTURA).slug, 'gemini-4.0-flash-high');
  assert.equal(resolverModelo('potente-high', LISTA_1110).slug, 'gemini-3.1-pro-high');
  // Las gamas nunca eligen Claude ni GPT.
  assert.equal(resolverModelo('potente-medium', LISTA_1210).slug, 'gemini-3.8-flash-high');
});

test('gamas: sin Pro, pro-* pasa a la gama potente con su nivel; sin potentes, a rapido-high', () => {
  const alto = resolverModelo('pro-high', LISTA_1025);
  assert.equal(alto.slug, 'gemini-4-argon-high');
  assert.match(alto.nota, /sin Pro.*potente-high/);
  assert.equal(resolverModelo('pro-low', LISTA_1025).slug, 'gemini-4-argon-low');
  assert.equal(resolverModelo('pro', LISTA_1025).slug, 'gemini-4-argon-medium');
  // Si Argon también se va, Argon y las gamas potentes caen en lo rápido con más razonamiento.
  for (const pedido of ['argon-high', 'potente-low']) {
    const r = resolverModelo(pedido, LISTA_1210);
    assert.equal(r.slug, 'gemini-3.8-flash-high', pedido);
    assert.match(r.nota, /rapido-high/, pedido);
  }
  // Una familia que nunca fue de Gemini no se adivina.
  assert.equal(resolverModelo('haiku-low', LISTA_1025).slug, null);
});

test('gamas: el modelo por defecto es rapido-medium y --modelos muestra gamas y alias de las familias presentes', () => {
  assert.equal(resolverModelo(MODELO_POR_DEFECTO, LISTA_1025).slug, 'gemini-3.8-flash-medium');
  const p = preparar();
  const { resumen } = correr(p, 'exito', ['--modelos'], lista(LISTA_1025), { encargo: null });
  assert.deepEqual(resumen.gamas, { potente: ['argon'], rapido: ['flash'] });
  assert.equal(resumen.alias['potente-high'], 'gemini-4-argon-high');
  assert.equal(resumen.alias['argon-low'], 'gemini-4-argon-low');
  assert.match(resumen.alias['pro-high'], /gemini-4-argon-high.*sin Pro/);
});

// --- 0.4.0: fallos vistos en el uso real ---

test('agy: Argon mudo («stream idle timeout» en cli.log) es «modelo_mudo», sin consejo de rescate', () => {
  const p = preparar();
  const { codigo, resumen } = correr(p, 'mudo', ['--modelo', 'argon-high'], lista(LISTA_1025));
  assert.equal(codigo, 1);
  assert.equal(resumen.estado, 'modelo_mudo');
  assert.doesNotMatch(resumen.detalle, /correccion\.md pidiendo/);
  assert.match(resumen.fallos_log.join('\n'), /stream idle timeout/);
  const incidencia = readFileSync(p.incidencias, 'utf8');
  assert.match(incidencia, /modelo_mudo/);
  assert.match(incidencia, /stream idle timeout/);
});

test('agy: con --respaldo, un modelo mudo pasa directo a rapido-high', () => {
  const p = preparar();
  const env = { ...lista(LISTA_1025), FAKE_AGY_MUDOS: 'gemini-4-argon-high' };
  const { codigo, resumen, llamadas } = correr(p, 'mudo', ['--modelo', 'potente-high', '--respaldo'], env);
  assert.equal(codigo, 0);
  assert.deepEqual(resumen.intentos, [
    { modelo: 'gemini-4-argon-high', estado: 'modelo_mudo' },
    { modelo: 'gemini-3.8-flash-high', estado: 'ok' },
  ]);
  assert.equal(llamadas.length, 2);
});

test('agy: un log de otra conversación no se atribuye a esta ejecución', () => {
  const p = preparar();
  const dir = join(p.agyHome, 'log');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cli-otro.log'), 'Created conversation 00000000-0000-0000-0000-000000000000\nRun: attempt 1 failed (stream reading error: stream idle timeout (5m0s)), retrying in 4s\n');
  const { resumen } = correr(p, 'print_timeout');
  assert.equal(resumen.estado, 'timeout');
  assert.equal(resumen.fallos_log, undefined);
});

test('agy: un 503 es «transitorio»; con --respaldo se reintenta el mismo modelo y termina en ok', () => {
  const p = preparar();
  const sin = correr(p, 'transitorio', ['--modelo', 'rapido-medium'], lista(LISTA_1025));
  assert.equal(sin.codigo, 1);
  assert.equal(sin.resumen.estado, 'transitorio');
  assert.match(sin.resumen.detalle, /--respaldo/);
  const q = preparar();
  const con = correr(q, 'transitorio', ['--modelo', 'rapido-medium', '--respaldo'], lista(LISTA_1025));
  assert.equal(con.codigo, 0);
  assert.deepEqual(con.resumen.intentos.map((i) => `${i.modelo} ${i.estado}`), [
    'gemini-3.8-flash-medium transitorio',
    'gemini-3.8-flash-medium ok',
  ]);
});

test('agy: un fallo transitorio que se repite sigue la cadena de respaldo', () => {
  const p = preparar();
  const { resumen } = correr(p, 'transitorio', ['--modelo', 'rapido-low', '--respaldo'], { ...lista(LISTA_1025), FAKE_AGY_SIEMPRE: '1' });
  assert.equal(resumen.estado, 'transitorio');
  assert.deepEqual(resumen.intentos.map((i) => i.modelo), ['gemini-3.8-flash-low', 'gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-medium']);
});

test('agy: un error con respuesta es «parcial»: guarda respuesta.md y dice que la lea antes de reintentar', () => {
  const p = preparar();
  const { codigo, resumen } = correr(p, 'parcial');
  assert.equal(codigo, 2);
  assert.equal(resumen.estado, 'parcial');
  assert.match(resumen.detalle, /stream was interrupted.*respuesta\.md/s);
  assert.match(readFileSync(join(p.carpeta, 'respuesta.md'), 'utf8'), /Hallazgos/);
  const larga = correr(preparar(), 'salida_larga');
  assert.equal(larga.resumen.estado, 'parcial');
  assert.match(larga.resumen.detalle, /como máximo 6/);
  const vacia = correr(preparar(), 'salida_larga_vacia');
  assert.equal(vacia.resumen.estado, 'error');
  assert.match(vacia.resumen.detalle, /como máximo 6/);
});

test('agy: el tiempo del resumen es de reloj y aparte va el tiempo activo de agy', () => {
  const p = preparar();
  const { resumen } = correr(p, 'mudo', ['--modelo', 'argon-high'], lista(LISTA_1025));
  assert.equal(resumen.segundos_agy, 618);
  assert.ok(resumen.segundos < 60, `reloj: ${resumen.segundos}`);
  const historial = readFileSync(join(p.carpeta, 'historial.jsonl'), 'utf8');
  assert.match(historial, /"segundos_agy":618/);
  // En texto se ven los dos.
  const r = spawnSync(process.execPath, [script, '--encargo', p.encargo, '--cwd', p.proyecto, '--modelo', 'argon-high'], {
    encoding: 'utf8',
    env: { ...process.env, AGY_BIN: falso, DELEGAR_AGY_CACHE: p.cache, DELEGAR_AGY_INCIDENCIAS: p.incidencias, DELEGAR_AGY_HOME: p.agyHome, FAKE_AGY_ESCENARIO: 'mudo', FAKE_AGY_REGISTRO: p.registro, ...lista(LISTA_1025) },
  });
  assert.match(r.stdout, /tiempo: \d+ s de reloj \(agy: 618 s activos\)/);
});

test('agy: los archivos propios de otra carpeta de encargo dentro del --cwd no son «edito_en_lectura»', () => {
  const p = preparar();
  const otra = join(p.proyecto, 'otro-encargo');
  mkdirSync(otra);
  for (const n of ['agy-salida.json', 'respuesta.md', 'historial.jsonl', 'encargo.md']) writeFileSync(join(otra, n), 'viejo\n');
  const { resumen } = correr(p, 'toca_otro_encargo');
  assert.equal(resumen.estado, 'ok');
  assert.deepEqual(resumen.archivos, []);
  // Un respuesta.md fuera de una carpeta de encargo sí cuenta.
  const q = preparar();
  writeFileSync(join(q.proyecto, 'respuesta.md'), 'viejo\n');
  mkdirSync(join(q.proyecto, 'otro-encargo'));
  const r = correr(q, 'toca_otro_encargo', [], { FAKE_AGY_RAIZ: '1' });
  assert.equal(r.resumen.estado, 'edito_en_lectura');
  assert.deepEqual(r.resumen.archivos, ['respuesta.md']);
});

test('agy: lista lo que agy dejó en brain/<conversación>/, sin sus archivos internos', () => {
  const p = preparar();
  const { resumen } = correr(p, 'imagen');
  assert.equal(resumen.generados.length, 1);
  assert.match(resumen.generados[0], /brain\/297fcc3e-19ea-4601-a61a-67a132cb03c1\/logo_1761400000\.jpg$/);
});

test('agy: con --esquema y el JSON dentro del texto, lo extrae a respuesta.json', () => {
  const p = preparar();
  const esquema = join(p.carpeta, 'esquema.json');
  writeFileSync(esquema, '{"type":"object"}');
  const { resumen } = correr(p, 'json_en_texto', ['--esquema', esquema]);
  assert.equal(resumen.estado, 'ok');
  assert.deepEqual(JSON.parse(readFileSync(resumen.respuesta_json, 'utf8')), { hallazgos: [{ titulo: 'uno' }] });
  const sinJson = correr(preparar(), 'exito', ['--esquema', esquema]);
  assert.equal(sinJson.resumen.estado, 'incompleto');
  assert.match(sinJson.resumen.detalle, /solo con el JSON/);
});

// --- 0.4.0: lo que encontró la segunda opinión de Argon High sobre el diff ---

test('agy: el resumen.json de otro encargo de un lote, antes de su agy-salida.json, no es «edito_en_lectura»', () => {
  const p = preparar();
  mkdirSync(join(p.proyecto, 'otro-encargo'));
  writeFileSync(join(p.proyecto, 'otro-encargo', 'encargo.md'), 'Encargo.\n');
  const { resumen } = correr(p, 'toca_otro_encargo', [], { FAKE_AGY_ARCHIVOS: 'resumen.json' });
  assert.equal(resumen.estado, 'ok');
});

test('agy: si la caché listaba un modelo retirado, tras refrescar vuelve a resolver el alias', () => {
  const p = preparar();
  correr(p, 'exito', ['--modelos'], lista(LISTA_1110), { encargo: null });
  // La caché aún tiene Pro 3.1; agy ya solo tiene Argon y Flash.
  const { resumen } = correr(p, 'exito', ['--modelo', 'pro-high', '--respaldo'], lista(LISTA_1025));
  assert.equal(resumen.estado, 'ok');
  assert.equal(resumen.modelo, 'gemini-4-argon-high');
  assert.deepEqual(resumen.intentos.map((i) => i.estado), ['modelo_invalido', 'ok']);
});

test('agy: con --conversacion, el log de un intento anterior no convierte este en «modelo_mudo»', (t) => {
  const p = preparar();
  const dir = join(p.agyHome, 'log');
  mkdirSync(dir, { recursive: true });
  const viejo = join(dir, 'cli-anterior.log');
  writeFileSync(viejo, 'Created conversation 297fcc3e-19ea-4601-a61a-67a132cb03c1\nRun: attempt 1 failed (stream reading error: stream idle timeout (5m0s)), retrying in 4s\n');
  if (!statSync(viejo).birthtimeMs) return t.skip('este sistema de archivos no da la fecha de creación');
  // Creado antes del margen de 2 s, aunque se haya modificado hasta ahora (como el del intento anterior).
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
  utimesSync(viejo, new Date(), new Date());
  const { resumen } = correr(p, 'print_timeout', ['--conversacion', '297fcc3e-19ea-4601-a61a-67a132cb03c1']);
  assert.equal(resumen.estado, 'timeout');
});

test('agy: --carpeta crea una carpeta nueva cada vez, aunque el tema y el minuto coincidan', () => {
  const p = preparar();
  const env = { DELEGAR_AGY_CARPETAS: join(p.base, 'encargos') };
  const crear = () => spawnSync(process.execPath, [script, '--carpeta', 'Resumen de src/ (módulos)'], { encoding: 'utf8', env: { ...process.env, ...env } }).stdout.trim();
  const [una, otra] = [crear(), crear()];
  assert.match(una, /\/\d{8}-\d{4}-resumen-de-src-modulos$/);
  // En el mismo minuto, la segunda lleva el sufijo -2; si cambió el minuto, otro nombre. Nunca la misma.
  assert.notEqual(otra, una);
  assert.ok(existsSync(una) && existsSync(otra));
  assert.notEqual(carpetaNueva('x', join(p.base, 'b')), carpetaNueva('x', join(p.base, 'b')));
});

test('extraerJson: JSON puro, en bloque de código o entre texto; nada si no hay', () => {
  assert.deepEqual(extraerJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extraerJson('Texto\n```json\n{"a":2}\n```\nmás'), { a: 2 });
  assert.deepEqual(extraerJson('Resultado: {"a":3} fin'), { a: 3 });
  assert.deepEqual(extraerJson('Para el campo {id} el resultado es {"id": 1}'), { id: 1 });
  assert.deepEqual(extraerJson('{"borrador": 1}\n{"final": {"a": 2}}'), { final: { a: 2 } });
  assert.equal(extraerJson('sin json'), undefined);
  assert.equal(extraerJson('"solo un texto"'), undefined);
});

test('clasificar: textos reales de fallos transitorios, mudos y de salida larga', () => {
  for (const texto of [
    'The stream was interrupted. Please continue the task you were working on.',
    'API error (attempt 1): UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-medium on the server',
    'INTERNAL (code 500): Internal error encountered.',
  ]) {
    assert.equal(clasificar({ json: { status: 'ERROR', error: texto, response: '' }, codigo: 1 }).estado, 'transitorio', texto);
  }
  // Un error permanente o una traza de Node no son transitorios.
  for (const texto of ['Error: Cannot find module at node:internal/modules/cjs/loader', 'the requested tool is unavailable']) {
    assert.equal(clasificar({ json: { status: 'ERROR', error: texto, response: '' }, codigo: 1 }).estado, 'error', texto);
  }
  const pt = '[agy] print timeout after 15m0s with turn in progress; returning partial output';
  const mudo = clasificar({ json: { status: 'SUCCESS', response: '' }, stderr: pt, codigo: 0, fallosLog: ['stream reading error: stream idle timeout (5m0s): context deadline exceeded'] });
  assert.equal(mudo.estado, 'modelo_mudo');
  assert.equal(clasificar({ json: { status: 'SUCCESS', response: '' }, stderr: pt, codigo: 0, fallosLog: ['UNAVAILABLE (code 503)'] }).estado, 'timeout');
  assert.equal(clasificar({ json: { status: 'SUCCESS', response: 'medio' }, stderr: pt, codigo: 0 }).estado, 'parcial');
});

// --- 0.4.0: lote ---

function prepararLote(p, nombres) {
  const raiz = join(p.base, 'lote');
  for (const n of nombres) {
    mkdirSync(join(raiz, n), { recursive: true });
    writeFileSync(join(raiz, n, 'encargo.md'), `Encargo ${n}.\n`);
  }
  mkdirSync(join(raiz, 'sin-encargo'));
  return raiz;
}

test('lote: corre cada subcarpeta con encargo.md, deja su resumen.json y devuelve una tabla', () => {
  const p = preparar();
  const raiz = prepararLote(p, ['a', 'b', 'c']);
  const { codigo, resumen, llamadas, consultas } = correr(p, 'exito', ['--lote', raiz, '--paralelo', '2', '--modelo', 'rapido-low'], lista(LISTA_1025), { encargo: null });
  assert.equal(codigo, 0);
  assert.equal(resumen.estado, 'ok');
  assert.deepEqual(resumen.encargos.map((e) => `${e.carpeta} ${e.estado} ${e.modelo}`), ['a ok gemini-3.8-flash-low', 'b ok gemini-3.8-flash-low', 'c ok gemini-3.8-flash-low']);
  for (const n of ['a', 'b', 'c']) {
    assert.equal(JSON.parse(readFileSync(join(raiz, n, 'resumen.json'), 'utf8')).estado, 'ok');
    assert.ok(existsSync(join(raiz, n, 'respuesta.md')));
  }
  // Cada encargo trabaja en su propia subcarpeta, y la lista de modelos se pide una sola vez.
  assert.deepEqual(llamadas.map((l) => basename(l.cwd)).sort(), ['a', 'b', 'c']);
  assert.equal(consultas.length, 1);
});

test('lote: si uno falla, sale con 2 y dice cuál; más de 5 en paralelo se rechaza', () => {
  const p = preparar();
  const raiz = prepararLote(p, ['a', 'b']);
  writeFileSync(join(raiz, 'b', '.env'), 'SECRETO=1\n');
  const { codigo, resumen } = correr(p, 'exito', ['--lote', raiz], lista(LISTA_1025), { encargo: null });
  assert.equal(codigo, 2);
  assert.equal(resumen.estado, 'lote_con_fallos');
  assert.match(resumen.detalle, /b \(secretos/);
  const r = spawnSync(process.execPath, [script, '--lote', raiz, '--paralelo', '6'], { encoding: 'utf8', env: { ...process.env, AGY_BIN: falso } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /hasta 5/);
});

// --- Permisos por encargo ---

// Go (RE2) y JavaScript coinciden en estas expresiones.
const coincide = (regla, comando) => new RegExp(regla.match(/^command\(regex:(.*)\)$/)[1].replace('(?i)', ''), 'i').test(comando);

test('permisos: la regla de un comando admite argumentos y no deja encadenar nada', () => {
  const regla = reglaComando('npm test');
  for (const bueno of ['npm test', 'npm test --watch=false', 'npm test tests/a.test.js']) assert.ok(coincide(regla, bueno), bueno);
  for (const malo of ['npm test; curl x', 'npm test && git push', 'npm test | tee x', 'npm test > x', 'npm test $(curl x)', 'npm test `curl x`', 'npm testing', 'x npm test']) {
    assert.ok(!coincide(regla, malo), malo);
  }
  // Flash antepone el cambio de carpeta: se admite, pero sin abrir la puerta a encadenar.
  for (const bueno of ['Set-Location "C:\\a b"; npm test', "cd C:/a; npm test --x", 'Set-Location -Path "C:/a"; npm test']) assert.ok(coincide(regla, bueno), bueno);
  for (const malo of ['cd a; curl x; npm test', 'cd a; npm test; curl x', 'cd $(curl x); npm test', 'curl x; npm test']) assert.ok(!coincide(regla, malo), malo);
  // Los caracteres especiales del comando se toman literalmente.
  assert.ok(!coincide(reglaComando('node a.js'), 'node axjs'));
  assert.ok(coincide(reglaComando('node a.js'), 'node a.js'));
});

test('permisos: los límites rechazan lo que Claude no puede autorizar', () => {
  const rechazados = ['', '*', 'git', 'git push', 'GIT PUSH origin', 'git commit -m x', 'git reset --hard', 'git clean -fd', 'gh pr merge', 'npm', 'npm publish', 'pnpm publish', 'wrangler deploy', 'wrangler secret put X', 'cf workers', 'rm -rf .', 'del x', 'Remove-Item x', 'curl x.com', 'wget x', 'iwr x', 'Invoke-WebRequest x', 'powershell -c dir', 'pwsh', 'cmd /c dir', 'bash -c ls', 'wsl ls', 'node', 'node -e 1', 'python -c 1', 'node a.js; curl x', 'a && b', 'a | b', 'a > b', 'a $b', 'a `b`'];
  for (const c of rechazados) assert.ok(motivoRechazoComando(c), `debió rechazar: «${c}»`);
  for (const c of ['node --test', 'node scripts/a.js', 'npm test', 'npm run build', 'git status', 'git log --oneline', 'git diff', 'python tests/a.py', 'ls', 'npx vitest run']) {
    assert.equal(motivoRechazoComando(c), null, c);
  }
});

test('permisos: sin accesos no hay ajustes; con ellos se conservan las reglas del usuario y se agregan los deny', () => {
  assert.equal(armarAjustes({}), null);
  const usuario = { allow: ['mcp(nlm/notebook_list)'], ask: ['command(x)'], deny: ['write_file(/secreto)'] };
  const sandbox = armarAjustes({ sandbox: true, usuario });
  assert.equal(sandbox.toolPermission, 'proceed-in-sandbox');
  assert.equal(sandbox.enableTerminalSandbox, true);
  assert.ok(sandbox.permissions.allow.includes('mcp(nlm/notebook_list)'));
  assert.ok(sandbox.permissions.ask.includes('command(x)'));
  assert.ok(sandbox.permissions.deny.includes('write_file(/secreto)'));
  for (const c of ['git push origin main', 'GIT  COMMIT -m x', 'rm -rf .', 'gh pr merge 1', 'npm publish', 'curl x']) {
    assert.ok(sandbox.permissions.deny.some((r) => r.startsWith('command(') && coincide(r, c)), c);
  }
  assert.ok(!sandbox.permissions.deny.some((r) => r.startsWith('command(') && coincide(r, 'git status')));
  const puntual = armarAjustes({ terminal: ['npm test'], web: ['example.com'] });
  assert.equal(puntual.toolPermission, undefined, 'un comando puntual no abre toda la terminal');
  assert.ok(puntual.permissions.allow.includes('read_url(example.com)'));
  assert.ok(puntual.permissions.allow.some((r) => coincide(r, 'npm test')));
});

test('agy: sin flags de acceso no hay --settings y la terminal sigue como siempre', () => {
  const p = preparar();
  const { resumen, llamadas } = correr(p, 'exito', ['--modelo', 'gemini-3.8-flash-medium']);
  assert.equal(resumen.estado, 'ok');
  assert.equal(resumen.accesos, undefined);
  const args = llamadas[0].args;
  assert.ok(!args.includes('--settings'));
  assert.ok(args.includes('--sandbox'));
  assert.doesNotMatch(arg(args, '-p'), /PERMISO/);
  assert.ok(!existsSync(join(p.carpeta, 'agy-permisos.json')));
});

test('agy: --acceso sandbox escribe los permisos solo para esa ejecución, combinados con los del usuario', () => {
  const p = preparar({ git: true });
  mkdirSync(p.agyHome, { recursive: true });
  const original = JSON.stringify({ permissions: { allow: ['mcp(nlm/notebook_list)'] } });
  writeFileSync(join(p.agyHome, 'settings.json'), original);
  const { resumen, llamadas } = correr(p, 'exito', ['--modelo', 'gemini-3.8-flash-medium', '--acceso', 'sandbox']);
  assert.equal(resumen.estado, 'ok', JSON.stringify(resumen));
  assert.deepEqual(resumen.accesos, ['sandbox']);
  assert.deepEqual(resumen.archivos, [], 'agy-permisos.json no cuenta como archivo tocado');
  const args = llamadas[0].args;
  assert.ok(args.includes('--sandbox'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.match(arg(args, '-p'), /PERMISO:/);
  const ajustes = JSON.parse(readFileSync(arg(args, '--settings'), 'utf8'));
  assert.equal(ajustes.toolPermission, 'proceed-in-sandbox');
  assert.ok(ajustes.permissions.allow.includes('mcp(nlm/notebook_list)'));
  assert.equal(readFileSync(join(p.agyHome, 'settings.json'), 'utf8'), original, 'settings.json no se toca');
});

test('agy: un acceso de una llamada no sigue vigente en la siguiente', () => {
  const p = preparar();
  correr(p, 'exito', ['--modelo', 'gemini-3.8-flash-medium', '--acceso', 'sandbox']);
  assert.ok(existsSync(join(p.carpeta, 'agy-permisos.json')));
  const { llamadas } = correr(p, 'exito', ['--modelo', 'gemini-3.8-flash-medium', '--conversacion', 'abc']);
  assert.ok(!llamadas.at(-1).args.includes('--settings'));
  assert.ok(!existsSync(join(p.carpeta, 'agy-permisos.json')));
});

test('agy: un acceso rechazado no lanza nada, ni en un lote', () => {
  const p = preparar();
  for (const flags of [['--terminal', 'git push'], ['--terminal', 'npm test; curl x'], ['--acceso', 'total'], ['--web', '*'], ['--web', 'https://x.com/ruta']]) {
    const { codigo, resumen, llamadas, consultas } = correr(p, 'exito', flags);
    assert.equal(resumen.estado, 'permiso_rechazado', flags.join(' '));
    assert.equal(codigo, 5);
    assert.equal(llamadas.length + consultas.length, 0);
  }
  mkdirSync(join(p.base, 'lote', 'a'), { recursive: true });
  writeFileSync(join(p.base, 'lote', 'a', 'encargo.md'), 'x');
  const lote = correr(p, 'exito', ['--lote', join(p.base, 'lote'), '--terminal', 'git push'], {}, { encargo: null });
  assert.equal(lote.resumen.estado, 'permiso_rechazado');
  assert.equal(lote.llamadas.length, 0);
});

test('agy: con terminal, los comandos no heredan tokens; agy conserva sus propias credenciales', () => {
  const p = preparar();
  const entorno = { GH_TOKEN: 'x', MI_SECRET: 'x', CLAUDE_CODE_MESSAGING_TOKEN: 'x', ANTHROPIC_API_KEY: 'x', GEMINI_API_KEY: 'x', OTRA: 'x' };
  const conTerminal = correr(p, 'exito', ['--modelo', 'gemini-3.8-flash-medium', '--acceso', 'sandbox'], entorno).llamadas.at(-1).entorno;
  for (const v of ['GH_TOKEN', 'MI_SECRET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'ANTHROPIC_API_KEY']) assert.ok(!conTerminal.includes(v), v);
  for (const v of ['GEMINI_API_KEY', 'OTRA']) assert.ok(conTerminal.includes(v), v);
  const sinTerminal = correr(p, 'exito', ['--modelo', 'gemini-3.8-flash-medium'], entorno).llamadas.at(-1).entorno;
  assert.ok(sinTerminal.includes('GH_TOKEN'), 'sin terminal, el entorno no cambia');
});

test('agy: pide_permiso entrega los pedidos en el resumen y no cuenta como incidencia', () => {
  const p = preparar();
  const { codigo, resumen } = correr(p, 'pide_permiso', ['--modelo', 'gemini-3.8-flash-medium', '--modo', 'edicion', '--terminal', 'node --test']);
  assert.equal(resumen.estado, 'pide_permiso');
  assert.equal(codigo, 2);
  assert.deepEqual(resumen.permisos_pedidos, ['`git log --oneline -1` — para informar el último commit', 'npm publish — para publicar']);
  assert.ok(!existsSync(p.incidencias));
});

test('agy: --modo plan no permite editar, y sus pedidos no cambian el estado ok', () => {
  const p = preparar({ git: true });
  const plan = correr(p, 'pide_permiso', ['--modelo', 'gemini-3.8-flash-medium', '--modo', 'plan']);
  assert.equal(plan.resumen.estado, 'ok');
  assert.equal(plan.resumen.permisos_pedidos.length, 2);
  const mensaje = arg(plan.llamadas[0].args, '-p');
  assert.match(mensaje, /fase de plan/);
  assert.match(mensaje, /ni ejecutes comandos/);
  assert.equal(arg(plan.llamadas[0].args, '--mode'), 'plan');
  assert.equal(correr(p, 'edita', ['--modelo', 'gemini-3.8-flash-medium', '--modo', 'plan']).resumen.estado, 'edito_en_lectura');
});

test('agy: el resumen lista los comandos de esta ejecución según la transcripción de agy', () => {
  const p = preparar();
  const { resumen } = correr(p, 'comandos', ['--modelo', 'gemini-3.8-flash-medium', '--acceso', 'sandbox']);
  assert.deepEqual(resumen.comandos, [{ comando: 'node --test' }]);
  const h = readFileSync(join(p.carpeta, 'historial.jsonl'), 'utf8');
  assert.match(h, /node --test/);
  assert.match(h, /"accesos":\["sandbox"\]/);
});

test('agy: si agy pidió salir del sandbox, el detalle lo dice y el registro central no guarda el comando', () => {
  const p = preparar();
  const { resumen } = correr(p, 'denegado_fuera', ['--modelo', 'gemini-3.8-flash-medium', '--acceso', 'sandbox']);
  assert.equal(resumen.estado, 'incompleto');
  assert.match(resumen.detalle, /git commit -m x/);
  assert.match(resumen.detalle, /fuera del sandbox/);
  const central = readFileSync(p.incidencias, 'utf8');
  assert.match(central, /"accesos":\["sandbox"\]/);
  assert.doesNotMatch(central, /git commit -m x.*"comandos"/);
});

test('agy: --seco muestra --settings y --sandbox cuando hay accesos', () => {
  const p = preparar();
  const { resumen } = correr(p, 'exito', ['--modelo', 'gemini-3.8-flash-medium', '--terminal', 'git status', '--seco']);
  assert.match(resumen.comando, /--settings/);
  assert.match(resumen.comando, /--sandbox/);
});

test('con terminal, el mensaje da el prefijo para entrar al proyecto y nombra lo autorizado', () => {
  const base = { encargo: 'C:/enc/encargo.md', modelo: 'm', cwd: 'C:/proy', modo: 'edicion' };
  const conTerminal = construirArgs({ ...base, conTerminal: true, ajustes: 'x.json', terminal: ['npm test'] });
  assert.match(conTerminal[1], /BypassSandbox=true si necesitan escribir o usar la red: npm test\./);
  assert.match(conTerminal[1], /Set-Location "C:\/proy"; /);
  assert.ok(coincide(reglaComando('npm test'), 'Set-Location "C:/proy"; npm test'), 'el prefijo que da el mensaje lo admite la regla');
  assert.doesNotMatch(construirArgs({ ...base, conTerminal: true, ajustes: 'x.json' })[1], /BypassSandbox=true/);
});

test('modo lectura y plan piden la respuesta sin razonamiento visible; edición no', () => {
  const base = { encargo: 'C:/x/encargo.md', modelo: 'm', cwd: 'C:/x' };
  for (const modo of ['lectura', 'plan']) assert.match(construirArgs({ ...base, modo }).at(2 - 1), /sin razonamiento/);
  assert.doesNotMatch(construirArgs({ ...base, modo: 'edicion' })[1], /sin razonamiento/);
});

test('extraerPermisos entiende listas, negrita y comillas, y no toma otras líneas', () => {
  assert.deepEqual(extraerPermisos('Hice esto.\n* PERMISO: npm i — x\n> **PERMISO**: a b\nEl PERMISO: no cuenta aquí\n'), ['npm i — x', 'a b']);
  assert.deepEqual(extraerPermisos('sin pedidos'), []);
});
