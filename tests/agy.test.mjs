// Pruebas de scripts/agy.mjs contra el agy falso (tests/fake-agy.mjs). No llaman al agy real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESPALDO, clasificar, construirArgs, limpiarEnlaces, modelosAProbar } from '../skills/delegar-antigravity/scripts/agy.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repo, 'skills', 'delegar-antigravity', 'scripts', 'agy.mjs');
const falso = join(repo, 'tests', 'fake-agy.mjs');
const MODELOS = readFileSync(join(repo, 'tests', 'modelos-conocidos.txt'), 'utf8').split(/\r?\n/).filter(Boolean);

// Un proyecto y una carpeta de encargo nuevos en cada prueba.
function preparar({ git = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'agy-prueba-'));
  const proyecto = join(base, 'proyecto');
  const carpeta = join(base, 'encargo');
  mkdirSync(join(proyecto, 'src'), { recursive: true });
  mkdirSync(carpeta);
  writeFileSync(join(proyecto, 'src', 'calculo.js'), 'module.exports = {};\n');
  if (git) {
    const g = (...a) => spawnSync('git', a, { cwd: proyecto });
    g('init', '-q');
    g('add', '.');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  }
  const encargo = join(carpeta, 'encargo.md');
  writeFileSync(encargo, 'Encargo de prueba.\n');
  return { base, proyecto, carpeta, encargo, registro: join(base, 'registro.jsonl') };
}

function correr(p, escenario, extra = [], env = {}) {
  const r = spawnSync(
    process.execPath,
    [script, '--encargo', p.encargo, '--cwd', p.proyecto, '--formato', 'json', ...extra],
    {
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, AGY_BIN: falso, FAKE_AGY_ESCENARIO: escenario, FAKE_AGY_REGISTRO: p.registro, ...env },
    },
  );
  let resumen;
  try {
    resumen = JSON.parse(r.stdout);
  } catch {
    assert.fail(`la salida no es JSON:\n${r.stdout}\n${r.stderr}`);
  }
  const llamadas = existsSync(p.registro)
    ? readFileSync(p.registro, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    : [];
  return { codigo: r.status, resumen, llamadas };
}

test('agy: éxito de solo lectura con los flags seguros', () => {
  const p = preparar();
  const { codigo, resumen, llamadas } = correr(p, 'exito', ['--modelo', 'gemini-3.8-flash-low']);
  assert.equal(codigo, 0);
  assert.equal(resumen.estado, 'ok');
  assert.equal(resumen.modelo, 'gemini-3.8-flash-low');
  assert.equal(resumen.conversacion, '297fcc3e-19ea-4601-a61a-67a132cb03c1');
  assert.equal(resumen.tokens, 65931);
  const [{ args, cwd }] = llamadas;
  assert.equal(resolve(cwd), resolve(p.proyecto), 'agy corre con el proyecto como directorio de trabajo');
  for (const flag of ['--sandbox', '--output-format', '--print-timeout', '--model', '--add-dir']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--mode') + 1], 'plan');
  assert.equal(args[args.indexOf('--add-dir') + 1], p.carpeta);
  assert.match(args[args.indexOf('-p') + 1], /encargo\.md/);
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
  assert.equal(llamadas[0].args[llamadas[0].args.indexOf('--mode') + 1], 'accept-edits');
  assert.deepEqual(resumen.archivos, ['nuevo.txt']);
});

test('agy: si edita en modo lectura, lo marca y lista los archivos', () => {
  // --mode plan no impide escribir en modo no interactivo (comprobado con agy 1.3.3): el script lo detecta.
  const p = preparar({ git: true });
  const { codigo, resumen, llamadas } = correr(p, 'edita');
  assert.equal(codigo, 2);
  assert.equal(resumen.estado, 'edito_en_lectura');
  assert.deepEqual(resumen.archivos, ['nuevo.txt']);
  assert.match(llamadas[0].args[llamadas[0].args.indexOf('-p') + 1], /solo lectura/);
});

test('agy: sin git, detecta los archivos tocados por su fecha de modificación', () => {
  const p = preparar();
  const { resumen } = correr(p, 'edita', ['--modo', 'edicion']);
  assert.equal(resumen.estado, 'ok');
  assert.deepEqual(resumen.archivos, ['nuevo.txt']);
});

test('agy: el modelo por defecto es explícito, nunca el de la configuración de agy', () => {
  const p = preparar();
  const { llamadas } = correr(p, 'exito');
  const { args } = llamadas[0];
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-3.8-flash-medium');
});

test('agy: pasa esfuerzo, conversación y esquema', () => {
  const p = preparar();
  const esquema = join(p.carpeta, 'esquema.json');
  writeFileSync(esquema, '{"type":"object"}');
  const { llamadas } = correr(p, 'exito', ['--esfuerzo', 'high', '--conversacion', 'abc-123', '--esquema', esquema]);
  const { args } = llamadas[0];
  // agy rechaza «--model gemini-3.8-flash-medium --effort high»: con esfuerzo, el nivel sale del nombre.
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-3.8-flash');
  assert.equal(args[args.indexOf('--effort') + 1], 'high');
  assert.equal(args[args.indexOf('--conversation') + 1], 'abc-123');
  assert.equal(args[args.indexOf('--json-schema') + 1], esquema);
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
  const agotados = ['gemini-3.8-flash-medium', RESPALDO['gemini-3.8-flash-medium'][0]];
  const { codigo, resumen, llamadas } = correr(p, 'cuota', ['--respaldo'], { FAKE_AGY_CUOTA: agotados.join(',') });
  assert.equal(codigo, 0);
  assert.equal(resumen.estado, 'ok');
  assert.equal(resumen.modelo, RESPALDO['gemini-3.8-flash-medium'][1]);
  assert.deepEqual(resumen.intentos.map((i) => i.estado), ['cuota', 'cuota', 'ok']);
  assert.equal(llamadas.length, 3);
});

test('agy: con --respaldo y todo agotado, termina en «cuota»', () => {
  const p = preparar();
  const todos = ['gemini-3.8-flash-medium', ...RESPALDO['gemini-3.8-flash-medium']].join(',');
  const { codigo, resumen } = correr(p, 'cuota', ['--respaldo'], { FAKE_AGY_CUOTA: todos });
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
  assert.equal(llamadas.length, 0);
});

test('agy: rechaza un encargo inexistente y un modo desconocido', () => {
  const p = preparar();
  const r1 = spawnSync(process.execPath, [script, '--encargo', join(p.base, 'no-existe.md')], { encoding: 'utf8' });
  assert.equal(r1.status, 1);
  const r2 = spawnSync(process.execPath, [script, '--encargo', p.encargo, '--modo', 'yolo'], { encoding: 'utf8' });
  assert.equal(r2.status, 1);
});

test('agy: si no encuentra agy, lo dice', () => {
  const p = preparar();
  const r = spawnSync(process.execPath, [script, '--encargo', p.encargo, '--formato', 'json'], {
    encoding: 'utf8',
    env: { ...process.env, AGY_BIN: join(p.base, 'no-hay-agy.exe') },
  });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).estado, 'sin_agy');
});

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
});

test('agy: nunca arma --dangerously-skip-permissions y siempre pasa modelo y tiempo límite', () => {
  const args = construirArgs({ encargo: 'C:/x/encargo.md', modelo: 'gemini-3.8-flash-low', modo: 'edicion', timeout: 600 });
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-3.8-flash-low');
  assert.equal(args[args.indexOf('--print-timeout') + 1], '600s');
  assert.doesNotMatch(readFileSync(script, 'utf8'), /dangerously-skip-permissions/);
});

test('agy: la cadena de respaldo solo usa modelos Gemini conocidos y nunca modelos Claude', () => {
  for (const [modelo, cadena] of Object.entries(RESPALDO)) {
    assert.ok(MODELOS.includes(modelo), modelo);
    for (const m of cadena) {
      assert.ok(MODELOS.includes(m), `${modelo} → ${m}`);
      assert.match(m, /^gemini-/, `${modelo} → ${m}`);
    }
  }
  assert.deepEqual(modelosAProbar('claude-sonnet-5-5-low', true), ['claude-sonnet-5-5-low']);
  assert.deepEqual(modelosAProbar('gemini-3.8-flash-low', false), ['gemini-3.8-flash-low']);
});
