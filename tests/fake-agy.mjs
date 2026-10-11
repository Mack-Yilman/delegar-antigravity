// agy falso para las pruebas de scripts/agy.mjs. Imita las salidas reales de agy 1.3.3 (2026-10-11).
// El escenario se elige con FAKE_AGY_ESCENARIO; cada llamada se anota en FAKE_AGY_REGISTRO (una línea JSON).
//   exito, edita, denegado, vacio, modelo_invalido, json_roto, lento, auth
//   cuota: los modelos de FAKE_AGY_CUOTA (separados por comas) responden con error de cuota; el resto, éxito.
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2);
const valor = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const modelo = valor('--model');
const escenario = process.env.FAKE_AGY_ESCENARIO ?? 'exito';

// Como el agy real, lee stdin hasta el final: si el script lo dejara abierto, esto se colgaría.
for await (const _ of process.stdin);

if (process.env.FAKE_AGY_REGISTRO) {
  appendFileSync(process.env.FAKE_AGY_REGISTRO, JSON.stringify({ args, cwd: process.cwd() }) + '\n');
}

const uso = { input_tokens: 65192, output_tokens: 739, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 65931 };
const exito = (response, extra = {}) => ({
  conversation_id: valor('--conversation') ?? '297fcc3e-19ea-4601-a61a-67a132cb03c1',
  status: 'SUCCESS',
  response,
  duration_seconds: 13.87,
  num_turns: 1,
  usage: uso,
  ...extra,
});
const fallo = (error) => ({ conversation_id: '', status: 'ERROR', response: '', error, duration_seconds: 0, num_turns: 0, usage: uso });
const salir = (objeto, codigo = 0, stderr = '') => {
  process.stdout.write(JSON.stringify(objeto) + '\n');
  if (stderr) process.stderr.write(stderr + '\n');
  process.exit(codigo);
};

switch (escenario) {
  case 'exito':
    salir(exito(`Listo con ${modelo}. Revisé [calculo.js](file:///${process.cwd().replace(/\\/g, '/')}/src/calculo.js).\n`));
    break;
  case 'edita':
    writeFileSync(join(process.cwd(), 'nuevo.txt'), 'creado por agy falso\n');
    salir(exito('Creé nuevo.txt.\n'));
    break;
  case 'largo':
    salir(exito('x'.repeat(5000)));
    break;
  case 'denegado':
    salir(
      exito('', { duration_seconds: 2.43, denied_actions: [{ action: 'command', display_name: 'RunCommand' }] }),
      0,
      'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.',
    );
    break;
  case 'vacio':
    salir(exito(''));
    break;
  case 'modelo_invalido': {
    const error = `invalid model selection (--model "${modelo}" --effort ""): model ${modelo} is not recognized as a known model or custom model in settings`;
    salir(fallo(error), 1, `error: ${error}`);
    break;
  }
  case 'cuota': {
    const agotados = (process.env.FAKE_AGY_CUOTA ?? '').split(',');
    if (agotados.includes(modelo)) {
      const error = `RESOURCE_EXHAUSTED: quota exceeded for model ${modelo}`;
      salir(fallo(error), 1, `error: ${error}`);
    }
    salir(exito(`Listo con ${modelo}.\n`));
    break;
  }
  case 'auth':
    process.stderr.write('error: authentication required\n');
    process.exit(1);
    break;
  case 'json_roto':
    process.stdout.write('{"status":"SUCC');
    process.exit(0);
    break;
  case 'lento':
    // Un nieto que sobrevive al padre, como el «find» que colgó a otro orquestador 40 minutos.
    {
      const nieto = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'inherit' });
      if (process.env.FAKE_AGY_NIETO) writeFileSync(process.env.FAKE_AGY_NIETO, String(nieto.pid));
    }
    setTimeout(() => salir(exito('tarde')), 120000);
    break;
  default:
    process.stderr.write(`escenario desconocido: ${escenario}\n`);
    process.exit(9);
}
