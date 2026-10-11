// Verificaciones estáticas de la skill. No prueban el comportamiento del modelo
// (eso se hace a mano con ejemplos/), solo que la skill sea coherente consigo misma y con el script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESPALDO } from '../skills/delegar-antigravity/scripts/agy.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (...ruta) => readFileSync(join(repo, ...ruta), 'utf8').replace(/\r\n/g, '\n');
// La skill instalable vive en skills/<nombre>/; el resto del repo es del proyecto.
const [carpetaSkill] = readdirSync(join(repo, 'skills'));
const raiz = join(repo, 'skills', carpetaSkill);
const texto = leer('skills', carpetaSkill, 'SKILL.md');
const [, frontmatter, cuerpo] = texto.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
const MODELOS = leer('tests', 'modelos-conocidos.txt').split('\n').filter(Boolean);

// Lo que se instala: si agregas un archivo a la skill, agrégalo aquí y en $archivos de install.ps1.
const INSTALABLES = ['LICENSE.txt', 'SKILL.md', 'references/agy-cli.md', 'references/modelos.md', 'scripts/agy.mjs'];

function listar(carpeta) {
  return readdirSync(carpeta).flatMap((n) => {
    const ruta = join(carpeta, n);
    return statSync(ruta).isDirectory() ? listar(ruta) : [relative(raiz, ruta).replace(/\\/g, '/')];
  });
}

// Líneas del cuerpo que quedan fuera de bloques de código.
function lineasFueraDeCodigo() {
  let dentro = false;
  return cuerpo.split('\n').filter((linea) => {
    if (linea.startsWith('```')) {
      dentro = !dentro;
      return false;
    }
    return !dentro;
  });
}

test('el frontmatter cumple el estándar Agent Skills', () => {
  assert.ok(frontmatter, 'SKILL.md debe empezar con frontmatter entre ---');
  const nombre = frontmatter.match(/^name:\s*(.+)$/m)?.[1].trim();
  const descripcion = frontmatter.match(/^description:\s*"(.+)"$/m)?.[1];
  assert.match(nombre ?? '', /^[a-z0-9]+(-[a-z0-9]+)*$/, 'name en minúsculas con guiones');
  assert.ok(nombre.length <= 64, 'name de 64 caracteres como máximo');
  assert.equal(nombre, basename(raiz), 'name debe coincidir con el nombre de la carpeta');
  assert.ok(descripcion, 'description entre comillas dobles y en una sola línea');
  assert.ok(descripcion.length <= 1024, `description de 1024 caracteres como máximo (tiene ${descripcion.length})`);
  assert.doesNotMatch(frontmatter, /[<>]/, 'el frontmatter no admite < ni >');
});

test('la description dice cuándo usarla, con las frases del usuario', () => {
  const descripcion = frontmatter.match(/^description:\s*"(.+)"$/m)[1];
  for (const frase of ['Úsala cuando', 'delega esto', 'usa Antigravity', 'usa agy', 'que lo haga Gemini', 'ahorra tokens', 'en paralelo']) {
    assert.ok(descripcion.includes(frase), frase);
  }
});

test('el cuerpo no usa título de nivel 1, nivel 4 ni divisores', () => {
  for (const linea of lineasFueraDeCodigo()) {
    assert.doesNotMatch(linea, /^#\s/, `título de nivel 1: ${linea}`);
    assert.doesNotMatch(linea, /^####/, `título de nivel 4: ${linea}`);
    assert.doesNotMatch(linea, /^\s*([-*_])(\s*\1){2,}\s*$/, `divisor horizontal: ${linea}`);
  }
});

test('no nombra herramientas propias de un orquestador concreto', () => {
  // La skill sirve a cualquier agente con terminal: describe capacidades, no herramientas.
  const prosa = lineasFueraDeCodigo().join('\n');
  assert.doesNotMatch(prosa, /run_in_background|TodoWrite|ExitPlanMode|\b(Bash|Write|Read|Edit) tool\b|herramienta (Bash|Write|Read|Edit)\b/);
});

test('cabe en el límite recomendado de 500 líneas', () => {
  assert.ok(texto.split('\n').length <= 500);
});

test('la carpeta instalable solo contiene la skill, su script, sus referencias y su licencia', () => {
  assert.deepEqual(readdirSync(join(repo, 'skills')), [carpetaSkill], 'una sola skill en skills/');
  assert.deepEqual(listar(raiz).sort(), INSTALABLES);
});

test('SKILL.md enlaza cada referencia y los enlaces existen', () => {
  const enlaces = [...cuerpo.matchAll(/\]\((references\/[^)]+)\)/g)].map((m) => m[1]);
  const referencias = INSTALABLES.filter((r) => r.startsWith('references/'));
  assert.deepEqual([...new Set(enlaces)].sort(), referencias);
});

test('los modelos nombrados existen en agy', () => {
  const archivos = ['SKILL.md', 'references/modelos.md', 'references/agy-cli.md'].map((r) => leer('skills', carpetaSkill, r));
  for (const contenido of archivos) {
    for (const [, slug] of contenido.matchAll(/`((?:gemini|claude|gpt-oss)-[a-z0-9.-]+[a-z0-9])`/g)) {
      // Un nombre base (gemini-3.8-flash) vale si agy lista sus niveles: se usa con --effort.
      assert.ok(MODELOS.includes(slug) || MODELOS.some((m) => m.startsWith(`${slug}-`)), `modelo desconocido: ${slug}`);
    }
  }
});

test('la cadena de respaldo de modelos.md es la del script', () => {
  const modelos = leer('skills', carpetaSkill, 'references', 'modelos.md');
  const tabla = {};
  for (const [, pedido, cadena] of modelos.matchAll(/^\| `([^`]+)` \| (`[^|]+`) \|$/gm)) {
    tabla[pedido] = [...cadena.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  }
  assert.deepEqual(tabla, RESPALDO);
});

test('los flags que cita SKILL.md existen en el script o en agy', () => {
  const script = leer('skills', carpetaSkill, 'scripts', 'agy.mjs');
  const ajenos = ['--dangerously-skip-permissions', '--stat']; // de agy y de git diff
  for (const [flag] of cuerpo.matchAll(/--[a-z][a-z-]+/g)) {
    const opcion = flag.slice(2);
    assert.ok(script.includes(`${opcion}: {`) || script.includes(`'${opcion}': {`) || ajenos.includes(flag), `flag desconocido: ${flag}`);
  }
});

test('la licencia es CC BY-NC-ND 4.0 a nombre de Mack Chirinos en todas partes', () => {
  assert.match(frontmatter, /^license: CC BY-NC-ND 4\.0/m);
  for (const archivo of [leer('LICENSE'), leer('skills', carpetaSkill, 'LICENSE.txt')]) {
    assert.match(archivo, /Copyright \(c\) \d{4} Mack Chirinos/);
    assert.match(archivo, /by-nc-nd\/4\.0/);
  }
  assert.match(leer('LICENSE'), /Attribution-NonCommercial-NoDerivatives 4\.0\s+International Public\s+License/);
  const paquete = JSON.parse(leer('package.json'));
  assert.equal(paquete.license, 'CC-BY-NC-ND-4.0');
  assert.equal(paquete.author, 'Mack Chirinos');
});

test('la versión de package.json es la primera del CHANGELOG', () => {
  const { version } = JSON.parse(leer('package.json'));
  assert.equal(leer('CHANGELOG.md').match(/^## (\d+\.\d+\.\d+)/m)?.[1], version);
});

test('el instalador de PowerShell apunta a la skill, copia todos sus archivos y no lleva BOM', () => {
  const bytes = readFileSync(join(repo, 'install.ps1'));
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'un BOM rompe «irm | iex» en PowerShell 7');
  const ps = bytes.toString('utf8');
  assert.ok(ps.includes(`$nombre = '${carpetaSkill}'`), '$nombre debe ser el nombre de la skill');
  assert.ok(ps.includes('/main/skills/$nombre'), 'debe descargar desde skills/<nombre>');
  assert.ok(ps.includes('/releases/latest/download/$nombre.zip'), 'debe usar el .zip de la Release');
  assert.ok(![...bytes].some((b) => b > 127), 'solo ASCII: las tildes van como \\uXXXX');
  const lista = ps.match(/\$archivos = (.+)/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(lista.sort(), INSTALABLES, 'el respaldo desde main debe bajar todos los archivos');
});
