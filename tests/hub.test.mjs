// Pruebas de la cuota real (0.8.0) contra un hub falso de Antigravity. No tocan el hub, la cuota ni el uso reales.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gastoCuota, leerCuota, leerEtiquetas } from '../skills/delegar-antigravity/scripts/agy.mjs';
import { LISTA_2411 } from './listas-modelos.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repo, 'skills', 'delegar-antigravity', 'scripts', 'agy.mjs');
const falso = join(repo, 'tests', 'fake-agy.mjs');
const TOKEN = 'csrf-inventado-0000-1111-2222-333344445555';

const temporales = [];
after(() => {
  for (const t of temporales) rmSync(t, { recursive: true, force: true, maxRetries: 3 });
});

function preparar() {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'agy-hub-')));
  temporales.push(base);
  const proyecto = join(base, 'proyecto');
  const carpeta = join(base, 'encargo');
  mkdirSync(proyecto, { recursive: true });
  mkdirSync(carpeta);
  const encargo = join(carpeta, 'encargo.md');
  writeFileSync(encargo, 'Encargo con un dato confidencial inventado: DNI 40871234.\n');
  return {
    base,
    proyecto,
    encargo,
    hub: join(base, 'hub'),
    datos: join(base, 'datos'),
    cache: join(base, 'cache'),
    env: {
      AGY_BIN: falso,
      FAKE_AGY_ESCENARIO: 'exito',
      FAKE_AGY_MODELOS: LISTA_2411.join(','),
      FAKE_AGY_REGISTRO: join(base, 'registro.jsonl'),
      DELEGAR_AGY_CACHE: join(base, 'cache'),
      DELEGAR_AGY_INCIDENCIAS: join(base, 'incidencias.jsonl'),
      DELEGAR_AGY_HOME: join(base, 'agy-home'),
      DELEGAR_AGY_HUB_DIR: join(base, 'hub'),
      DELEGAR_AGY_DATOS: join(base, 'datos'),
      DELEGAR_USO_CLAUDE: join(base, 'uso-claude.json'),
      DELEGAR_AGY_HOY: '2026-11-24',
    },
  };
}

// Responde como el hub de agy: en cada consulta de cuota, la ventana de 5 h sube 2 puntos y la semanal 0,5.
async function hubFalso(dir) {
  let n = 0;
  const vistos = [];
  const servidor = createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (d) => (cuerpo += d));
    req.on('end', () => {
      vistos.push({ ruta: req.url, cuerpo });
      if (req.headers['x-codeium-csrf-token'] !== TOKEN) {
        res.writeHead(401).end('{"code":"unauthenticated"}');
        return;
      }
      if (req.url.endsWith('/RetrieveUserQuotaSummary')) {
        const u5 = 10 + 2 * n;
        const us = 2.5 + 0.5 * n++;
        res.end(
          JSON.stringify({
            response: {
              groups: [
                {
                  displayName: 'Gemini Models',
                  buckets: [
                    { window: 'weekly', remainingFraction: 1 - us / 100, resetTime: '2026-11-30T23:13:15Z' },
                    { window: '5h', remainingFraction: 1 - u5 / 100, resetTime: '2026-11-25T07:12:57Z' },
                  ],
                },
                // proto3 omite remainingFraction cuando es 0: esa ventana está agotada.
                { displayName: 'Claude and GPT models', buckets: [{ window: 'weekly', remainingFraction: 1 }, { window: '5h' }] },
              ],
            },
          }),
        );
      } else if (req.url.endsWith('/GetUserStatus')) {
        res.end(
          JSON.stringify({
            userStatus: {
              name: 'Persona Inventada Quispe',
              email: 'persona.inventada@ejemplo.invalid',
              cascadeModelConfigData: {
                clientModelConfigs: [
                  { modelId: 'gemini-4-neon-high', tagTitle: 'New', tagDescription: 'For most deep reasoning and complex problems' },
                  { modelId: 'gemini-4-hydrogen-medium', tagTitle: 'Leaving Soon', tagDescription: 'Leaving on Dec 15.' },
                ],
              },
            },
          }),
        );
      } else res.writeHead(404).end('{}');
    });
  });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  const puerto = servidor.address().port;
  mkdirSync(dir, { recursive: true });
  // Quedan archivos de hubs cerrados y el PID se reutiliza: uno con un PID muerto y otro con PID vivo sin servidor.
  writeFileSync(join(dir, 'hub_1.json'), JSON.stringify({ pid: 2147483646, httpPort: puerto, csrfToken: TOKEN }));
  writeFileSync(join(dir, 'hub_2.json'), JSON.stringify({ pid: process.pid, httpPort: 1, csrfToken: TOKEN }));
  writeFileSync(join(dir, `hub_${puerto}.json`), JSON.stringify({ pid: process.pid, httpPort: puerto, httpsPort: puerto + 1, csrfToken: TOKEN }));
  const ahora = Date.now() / 1000;
  utimesSync(join(dir, `hub_${puerto}.json`), ahora - 60, ahora - 60);
  return { vistos, cerrar: () => new Promise((listo) => servidor.close(listo)) };
}

// spawnSync bloquearía al hub falso, que corre en este mismo proceso.
function correrAsync(p, args) {
  return new Promise((listo) => {
    const hijo = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...p.env } });
    let salida = '';
    hijo.stdout.on('data', (d) => (salida += d));
    hijo.on('close', (codigo) => listo({ codigo, salida }));
  });
}

test('hub: leerCuota y leerEtiquetas leen el hub vivo, piden refresco y nunca guardan el token ni los datos personales', async () => {
  const p = preparar();
  const hub = await hubFalso(p.hub);
  const antes = { hub: process.env.DELEGAR_AGY_HUB_DIR, datos: process.env.DELEGAR_AGY_DATOS };
  process.env.DELEGAR_AGY_HUB_DIR = p.hub;
  process.env.DELEGAR_AGY_DATOS = p.datos;
  try {
    const c1 = await leerCuota();
    const c2 = await leerCuota();
    const gemini = c2.grupos.find((g) => g.grupo === 'Gemini Models').ventanas;
    assert.equal(gemini['5h'].usado, 12);
    assert.equal(gemini.semana.reinicio, '2026-11-30T23:13:15Z');
    assert.equal(c2.grupos[1].ventanas['5h'].usado, 100);
    const gasto = gastoCuota(c1, c2, 'gemini-4-neon-high');
    assert.equal(gasto['5h'].gasto, 2);
    assert.equal(gasto.semana.gasto, 0.5);
    assert.equal(gastoCuota(c1, c2, 'claude-sonnet-5-5-low').grupo, 'Claude and GPT models');
    // Si la ventana se reinició en medio, no hay gasto que dar: ni si el % bajó ni si cambió la fecha de reinicio.
    assert.equal(gastoCuota(c2, c1, 'gemini-4-neon-high')['5h'].gasto, undefined);
    const reiniciada = structuredClone(c2);
    reiniciada.grupos[0].ventanas['5h'].reinicio = '2026-11-25T12:00:00Z';
    assert.equal(gastoCuota(c1, reiniciada, 'gemini-4-neon-high')['5h'].gasto, undefined);
    assert.ok(hub.vistos.some((v) => JSON.parse(v.cuerpo).forceRefresh === true));
    const etiquetas = await leerEtiquetas();
    assert.deepEqual(etiquetas['gemini-4-hydrogen-medium'], { titulo: 'Leaving Soon', descripcion: 'Leaving on Dec 15.', retiro: '2026-12-15' });
    assert.doesNotMatch(JSON.stringify(etiquetas), /Inventada|ejemplo\.invalid/);
    assert.doesNotMatch(readFileSync(join(p.datos, 'cuota.json'), 'utf8'), new RegExp(TOKEN));
  } finally {
    process.env.DELEGAR_AGY_HUB_DIR = antes.hub;
    process.env.DELEGAR_AGY_DATOS = antes.datos;
    await hub.cerrar();
  }
});

test('hub: sin hub, leerCuota devuelve null', async () => {
  const antes = process.env.DELEGAR_AGY_HUB_DIR;
  process.env.DELEGAR_AGY_HUB_DIR = join(tmpdir(), 'no-existe-hub-delegar');
  try {
    assert.equal(await leerCuota(), null);
  } finally {
    process.env.DELEGAR_AGY_HUB_DIR = antes;
  }
});

test('hub: cada delegación dice cuánta cuota gastó y su costo, y lo registra sin el token, el encargo ni datos personales', async () => {
  const p = preparar();
  const hub = await hubFalso(p.hub);
  try {
    const json = await correrAsync(p, ['--encargo', p.encargo, '--cwd', p.proyecto, '--formato', 'json']);
    const resumen = JSON.parse(json.salida);
    assert.equal(resumen.modelo, 'gemini-4-hydrogen-medium');
    assert.equal(resumen.cuota.grupo, 'Gemini Models');
    assert.equal(resumen.cuota['5h'].gasto, 2);
    assert.equal(resumen.cuota.semana.gasto, 0.5);
    assert.equal(resumen.costo_usd, 0.1033);
    // El retiro que anunció Google y la skill no tenía es motivo para revisarla.
    assert.match(resumen.revisar.join(' '), /gemini-4-hydrogen-medium \(2026-12-15\)/);
    const consumo = readFileSync(join(p.datos, 'consumo.jsonl'), 'utf8');
    const [linea] = consumo.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(linea.modelo, 'gemini-4-hydrogen-medium');
    assert.equal(linea.gasto_5h, 2);
    assert.equal(linea.usd, 0.1033);
    const texto = (await correrAsync(p, ['--encargo', p.encargo, '--cwd', p.proyecto])).salida;
    assert.match(texto, /Gemini Models: 5 h [\d.]+ % \(\+2\.0 %\), reinicia .* · semana [\d.]+ % \(\+0\.50 %\).* · costo ≈ USD 0\.10/);
    const todo = json.salida + texto + consumo + readFileSync(join(p.datos, 'cuota.json'), 'utf8') + readFileSync(join(p.cache, 'modelos.json'), 'utf8');
    assert.doesNotMatch(todo, new RegExp(TOKEN));
    assert.doesNotMatch(todo, /40871234|Encargo con|Inventada Quispe|ejemplo\.invalid/);
  } finally {
    await hub.cerrar();
  }
});

test('hub: sin hub, el resumen da el costo y avisa; --cuota usa la última lectura, el consumo y el uso de Claude', () => {
  const p = preparar();
  const correr = (args) => spawnSync(process.execPath, [script, ...args, '--formato', 'json'], { encoding: 'utf8', env: { ...process.env, ...p.env } });
  const resumen = JSON.parse(correr(['--encargo', p.encargo, '--cwd', p.proyecto]).stdout);
  assert.equal(resumen.cuota, undefined);
  assert.equal(resumen.costo_usd, 0.1033);
  const texto = spawnSync(process.execPath, [script, '--encargo', p.encargo, '--cwd', p.proyecto], { encoding: 'utf8', env: { ...process.env, ...p.env } }).stdout;
  assert.match(texto, /costo ≈ USD 0\.10 \(sin % real de cuota: abre Antigravity para verlo\)/);
  writeFileSync(join(p.datos, 'cuota.json'), JSON.stringify({ fecha: Date.now() - 3600e3, grupos: [{ grupo: 'Gemini Models', ventanas: { '5h': { usado: 40 }, semana: { usado: 9 } } }] }));
  writeFileSync(p.env.DELEGAR_USO_CLAUDE, JSON.stringify({ fecha: Date.now() - 120e3, contexto: 42, '5h': { usado: 30 }, semana: { usado: 12 } }));
  const lineas = JSON.parse(correr(['--cuota']).stdout).lineas.join('\n');
  assert.match(lineas, /Gemini Models: 5 h 40\.0 % · semana 9\.0 % \(lectura del /);
  // Las dos ejecuciones son la misma conversación (el agy falso repite su id): tokens y USD acumulados cuentan una vez.
  assert.match(lineas, /delegaciones de las últimas 5 h: gemini-4-hydrogen-medium ×2, 66 mil tokens, ≈ USD 0\.10/);
  assert.match(lineas, /Claude Code \(hace 2 min\): contexto 42\.0 % · 5 h 30\.0 % · semana 12\.0 %/);
});
