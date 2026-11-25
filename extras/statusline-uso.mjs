#!/usr/bin/env node
// Statusline para Claude Code: contexto, ventana de 5 h y semana de Claude, y la cuota de Gemini en Antigravity que
// guardó la skill delegar-antigravity. Además deja esos números en ~/.claude/uso-claude.json para que
// `agy.mjs --cuota` (y por él, Claude) los vea. No es parte de la skill instalable: se configura aparte.
//
// En ~/.claude/settings.json:
//   "statusLine": { "type": "command", "command": "node C:/Users/<usuario>/.claude/statusline-uso.mjs" }
// Node >= 22, sin dependencias. Nunca falla en voz alta: una statusline rota no debe molestar.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const salidaUso = process.env.DELEGAR_USO_CLAUDE || join(claudeDir, 'uso-claude.json');
const cuotaAgy = join(process.env.DELEGAR_AGY_DATOS || join(homedir(), '.delegar-antigravity'), 'cuota.json');

const leerJson = (texto) => {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
};

// resets_at llega como ISO o como segundos epoch, según la versión.
const aFecha = (v) => (v === undefined || v === null ? undefined : new Date(typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : v));

export function usoDeClaude(d) {
  const rl = d?.rate_limits ?? {};
  const ventana = (...claves) => {
    const v = Array.isArray(rl) ? rl.find((x) => claves.includes(x.kind ?? x.window ?? x.type)) : claves.map((k) => rl[k]).find(Boolean);
    const usado = v?.used_percentage ?? v?.percent_used ?? v?.percentUsed ?? v?.utilization;
    if (usado === undefined || usado === null || Number.isNaN(Number(usado))) return undefined;
    const reinicio = aFecha(v.resets_at ?? v.reset_at ?? v.resetsAt);
    return { usado: Number(usado), reinicio: reinicio && !Number.isNaN(reinicio.getTime()) ? reinicio.toISOString() : undefined };
  };
  return {
    fecha: Date.now(),
    contexto: d?.context_window?.used_percentage ?? undefined,
    '5h': ventana('five_hour', '5h'),
    semana: ventana('seven_day', 'weekly', 'semana'),
  };
}

const dos = (n) => String(n).padStart(2, '0');
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function cuando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = d.toDateString() === new Date().toDateString();
  return ` (${hoy ? `${dos(d.getHours())}:${dos(d.getMinutes())}` : DIAS[d.getDay()]})`;
}
const pct = (n) => `${Math.round(n)}%`;

export function linea(uso, agy, ponytail) {
  const partes = [];
  if (uso.contexto !== undefined) partes.push(`ctx ${pct(uso.contexto)}`);
  if (uso['5h']) partes.push(`5h ${pct(uso['5h'].usado)}${cuando(uso['5h'].reinicio)}`);
  if (uso.semana) partes.push(`sem ${pct(uso.semana.usado)}${cuando(uso.semana.reinicio)}`);
  const gemini = agy?.grupos?.find((g) => /gemini/i.test(g.grupo))?.ventanas;
  if (gemini) {
    const horas = (Date.now() - (agy.fecha ?? 0)) / 3600e3;
    // Más de 6 h sin lectura: el número ya no dice mucho; se marca con «?».
    const viejo = horas > 6 ? '?' : '';
    partes.push(`agy 5h ${pct(gemini['5h']?.usado ?? 0)}${viejo} · sem ${pct(gemini.semana?.usado ?? 0)}${viejo}`);
  }
  return [ponytail, partes.join(' · ')].filter(Boolean).join(' ');
}

function ponytail() {
  try {
    const modo = readFileSync(join(claudeDir, '.ponytail-active'), 'utf8').split(/\r?\n/)[0].trim();
    const color = modo === 'ultra' ? '173' : '108';
    const texto = !modo || modo === 'full' ? '[PONYTAIL]' : `[PONYTAIL:${modo.toUpperCase()}]`;
    return `\x1b[38;5;${color}m${texto}\x1b[0m`;
  } catch {
    return '';
  }
}

async function principal() {
  let entrada = '';
  for await (const trozo of process.stdin) entrada += trozo;
  // Sin rate_limits en esta llamada (antes de la primera respuesta, o con una API key), se conserva la lectura anterior.
  const previo = existsSync(salidaUso) ? leerJson(readFileSync(salidaUso, 'utf8')) ?? {} : {};
  const nuevo = usoDeClaude(leerJson(entrada) ?? {});
  const uso = { ...nuevo, '5h': nuevo['5h'] ?? previo['5h'], semana: nuevo.semana ?? previo.semana };
  try {
    mkdirSync(dirname(salidaUso), { recursive: true });
    const temporal = `${salidaUso}.${process.pid}`;
    writeFileSync(temporal, JSON.stringify(uso) + '\n');
    renameSync(temporal, salidaUso);
  } catch {}
  const agy = existsSync(cuotaAgy) ? leerJson(readFileSync(cuotaAgy, 'utf8')) : null;
  process.stdout.write(linea(uso, agy, ponytail()));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch(() => {});
}
