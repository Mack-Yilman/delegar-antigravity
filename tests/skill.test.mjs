// Verificaciones estáticas de la skill. No prueban el comportamiento del modelo
// (eso se hace a mano con ejemplos/), solo que la skill sea coherente consigo misma y con el script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VECINOS, VERSION, resolverModelo } from '../skills/delegar-antigravity/scripts/agy.mjs';
import { LISTA_1025 } from './listas-modelos.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (...ruta) => readFileSync(join(repo, ...ruta), 'utf8').replace(/\r\n/g, '\n');
// La skill instalable vive en skills/<nombre>/; el resto del repo es del proyecto.
const [carpetaSkill] = readdirSync(join(repo, 'skills'));
const raiz = join(repo, 'skills', carpetaSkill);
const texto = leer('skills', carpetaSkill, 'SKILL.md');
const [, frontmatter, cuerpo] = texto.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];

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

test('SKILL.md no fija modelos con versión y sus alias se resuelven con la lista vigente', () => {
  // Antigravity cambia los modelos sin aviso: la skill habla de alias y el script los resuelve con agy models.
  // Los nombres con versión solo pueden aparecer en ejemplos de salida (bloques de código).
  const prosa = lineasFueraDeCodigo().join('\n');
  assert.doesNotMatch(prosa, /\b(?:gemini|claude|gpt-oss)-\d/, 'nombre de modelo con versión fuera de un ejemplo');
  // Los alias son: todo `familia-nivel` del texto y todo lo que diga la columna «Alias» de la tabla de modelos.
  const seccion = prosa.slice(prosa.indexOf('## Elegir modelo'), prosa.indexOf('## Flujo'));
  const columna = seccion
    .split('\n')
    .filter((l) => l.startsWith('|') && !l.startsWith('|---'))
    .slice(1)
    .flatMap((l) => [...l.split('|')[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  const sufijo = [...prosa.matchAll(/`([a-z]+(?:-[a-z]+)*-(?:low|medium|high))`/g)].map((m) => m[1]);
  const alias = [...new Set([...columna, ...sufijo])];
  assert.ok(columna.length >= 6, `la tabla de modelos de SKILL.md no tiene alias: ${columna}`);
  for (const a of alias) assert.ok(resolverModelo(a, LISTA_1025).slug, `alias sin resolver con la lista del 25/10: ${a}`);
});

test('la plantilla del encargo prohíbe con fuerza la terminal y la web, y no recorta el entregable de lectura', () => {
  // Uso real: con «no uses la terminal», Flash la pidió igual y la respuesta quedó vacía; una URL denegada, lo mismo.
  const plantilla = cuerpo.match(/```markdown\n(# Encargo[\s\S]*?)```/)?.[1];
  assert.ok(plantilla, 'SKILL.md debe tener la plantilla del encargo en un bloque markdown');
  assert.match(plantilla, /\*\*Terminal: PROHIBIDA\.\*\*/);
  assert.match(plantilla, /\*\*Web: PROHIBIDA\.\*\*/);
  assert.match(plantilla, /VACÍA/);
  // En lectura, la respuesta final es el entregable: el límite de palabras solo vale en edición.
  const respuesta = plantilla.slice(plantilla.indexOf('## Respuesta final'));
  assert.match(respuesta, /Solo en modo edición/);
  assert.match(plantilla, /Modo lectura: tu respuesta final ES el entregable/);
});

test('la tabla de respaldo de modelos.md es la del script', () => {
  const modelos = leer('skills', carpetaSkill, 'references', 'modelos.md');
  const tabla = {};
  for (const [, pedido, cadena] of modelos.matchAll(/^\| `([a-z]+-(?:low|medium|high))` \| (`[^|]+`) \|$/gm)) {
    tabla[pedido] = [...cadena.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  }
  assert.deepEqual(tabla, VECINOS);
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

test('la versión de package.json es la primera del CHANGELOG y la que anota el script', () => {
  const { version } = JSON.parse(leer('package.json'));
  assert.equal(leer('CHANGELOG.md').match(/^## (\d+\.\d+\.\d+)/m)?.[1], version);
  // El registro de incidencias guarda la versión: debe ser la publicada.
  assert.equal(VERSION, version);
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
