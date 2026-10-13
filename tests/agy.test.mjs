// Pruebas de scripts/agy.mjs contra el agy falso (tests/fake-agy.mjs). No llaman al agy real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODELO_POR_DEFECTO,
  cadenaRespaldo,
  clasificar,
  construirArgs,
  limpiarEnlaces,
  resolverModelo,
} from '../skills/delegar-antigravity/scripts/agy.mjs';
import { LISTA_1110, LISTA_1210, LISTA_FUTURA } from './listas-modelos.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repo, 'skills', 'delegar-antigravity', 'scripts', 'agy.mjs');
const falso = join(repo, 'tests', 'fake-agy.mjs');

// Un proyecto, una carpeta de encargo y una caché de modelos nuevos en cada prueba.
function preparar({ git = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'agy-prueba-'));
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
  return { base, proyecto, carpeta, encargo, cache: join(base, 'cache'), registro: join(base, 'registro.jsonl') };
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

test('modelos: sin Pro, pro-* se resuelve a flash-high y lo dice', () => {
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
  assert.deepEqual(cadenaRespaldo('gemini-3.1-pro-high', LISTA_1110), ['gemini-3.1-pro-low', 'gemini-3.8-flash-high']);
  assert.deepEqual(cadenaRespaldo('gemini-3.8-flash-high', LISTA_1210), ['gemini-3.8-flash-medium']);
  // Un modelo que ya no existe también tiene respaldo, según su familia y nivel.
  assert.deepEqual(cadenaRespaldo('gemini-3.1-pro-low', LISTA_1210), ['gemini-3.8-flash-high']);
  // Claude y GPT no tienen respaldo, y ninguna cadena cae en ellos.
  assert.deepEqual(cadenaRespaldo('claude-sonnet-5-5-low', LISTA_1210), []);
  for (const l of [LISTA_1110, LISTA_1210, LISTA_FUTURA]) {
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
