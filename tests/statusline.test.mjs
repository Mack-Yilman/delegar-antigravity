// Pruebas de extras/statusline-uso.mjs (no es parte de la skill instalable).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linea, usoDeClaude } from '../extras/statusline-uso.mjs';

const script = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'extras', 'statusline-uso.mjs');
const base = mkdtempSync(join(tmpdir(), 'statusline-'));
after(() => rmSync(base, { recursive: true, force: true, maxRetries: 3 }));

test('statusline: lee contexto y ventanas en los formatos posibles de rate_limits', () => {
  const objeto = usoDeClaude({
    context_window: { used_percentage: 42 },
    rate_limits: { five_hour: { used_percentage: 30, resets_at: '2026-11-25T07:00:00Z' }, seven_day: { used_percentage: 12, resets_at: 1764543600 } },
  });
  assert.equal(objeto.contexto, 42);
  assert.deepEqual(objeto['5h'], { usado: 30, reinicio: '2026-11-25T07:00:00.000Z' });
  assert.equal(objeto.semana.reinicio, new Date(1764543600 * 1000).toISOString());
  const lista = usoDeClaude({ rate_limits: [{ kind: 'five_hour', percentUsed: 7 }] });
  assert.equal(lista['5h'].usado, 7);
  assert.equal(lista.semana, undefined);
  // Sin datos (API key, primera respuesta), no inventa números.
  assert.deepEqual(Object.keys(usoDeClaude({})).filter((k) => usoDeClaude({})[k] !== undefined), ['fecha']);
});

test('statusline: arma la línea con Claude y la cuota de agy, y marca la de agy si es vieja', () => {
  const uso = { contexto: 42, '5h': { usado: 30.4 }, semana: { usado: 12 } };
  const agy = { fecha: Date.now(), grupos: [{ grupo: 'Gemini Models', ventanas: { '5h': { usado: 3.2 }, semana: { usado: 1 } } }] };
  assert.equal(linea(uso, agy, ''), 'ctx 42% · 5h 30% · sem 12% · agy 5h 3% · sem 1%');
  assert.equal(linea(uso, { ...agy, fecha: Date.now() - 7 * 3600e3 }, ''), 'ctx 42% · 5h 30% · sem 12% · agy 5h 3%? · sem 1%?');
  assert.equal(linea({}, null, '[P]'), '[P]');
});

test('statusline: como comando, escribe uso-claude.json y no falla con una entrada rota', () => {
  const salida = join(base, 'uso-claude.json');
  const datos = join(base, 'datos');
  mkdirSync(datos);
  writeFileSync(join(datos, 'cuota.json'), JSON.stringify({ fecha: Date.now(), grupos: [{ grupo: 'Gemini Models', ventanas: { '5h': { usado: 50 }, semana: { usado: 5 } } }] }));
  const env = { ...process.env, DELEGAR_USO_CLAUDE: salida, DELEGAR_AGY_DATOS: datos, CLAUDE_CONFIG_DIR: base };
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify({ context_window: { used_percentage: 10 } }), encoding: 'utf8', env });
  assert.equal(r.stdout, 'ctx 10% · agy 5h 50% · sem 5%');
  assert.equal(JSON.parse(readFileSync(salida, 'utf8')).contexto, 10);
  const roto = spawnSync(process.execPath, [script], { input: 'no es json', encoding: 'utf8', env });
  assert.equal(roto.status, 0);
  // Una llamada sin rate_limits (o con null) no borra la última lectura de 5 h y semana ni la vuelve 0 %.
  spawnSync(process.execPath, [script], { input: JSON.stringify({ rate_limits: { five_hour: { used_percentage: 30 }, seven_day: { used_percentage: 12 } } }), encoding: 'utf8', env });
  const sinLimites = spawnSync(process.execPath, [script], { input: JSON.stringify({ context_window: { used_percentage: 5 }, rate_limits: { five_hour: { used_percentage: null } } }), encoding: 'utf8', env });
  assert.equal(sinLimites.stdout, 'ctx 5% · 5h 30% · sem 12% · agy 5h 50% · sem 5%');
});
