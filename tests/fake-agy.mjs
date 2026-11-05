// agy falso para las pruebas de scripts/agy.mjs. Imita las salidas reales de agy 1.3.3 (2026-10-11 y 12).
// El escenario se elige con FAKE_AGY_ESCENARIO; cada llamada se anota en FAKE_AGY_REGISTRO (una línea JSON).
//   exito, edita, edita_ignorado, edita_add_dir, toca_encargo, denegado, denegado_url, vacio, modelo_invalido,
//   json_roto, lento, auth, print_timeout
//   cuota: los modelos de FAKE_AGY_CUOTA (separados por comas) responden con error de cuota; el resto, éxito.
//   mudo: los modelos de FAKE_AGY_MUDOS (todos, si no se define) agotan el print timeout y dejan en
//     DELEGAR_AGY_HOME/log un cli-*.log con «stream idle timeout»; el resto, éxito.
//   transitorio: la primera llamada da 503 (o todas, con FAKE_AGY_SIEMPRE); parcial y salida_larga: error con
//   respuesta; salida_larga_vacia; imagen (deja un .jpg en DELEGAR_AGY_HOME/brain/<id>/); json_en_texto;
//   toca_otro_encargo (reescribe los archivos propios de otra carpeta de encargo dentro del --cwd);
//   toca_ajustes (reescribe settings.json); pide_permiso (responde con líneas PERMISO:); comandos (deja una transcripción como la real, agy 1.4.12);
//   denegado_fuera (pidió salir del sandbox, se le denegó y queda vacía la respuesta);
//   lee_y_otro_edita, lectura_inexistente, salida_larga_sigue;
//   trabaja_largo (da FAKE_AGY_PASOS pasos, uno cada FAKE_AGY_CADA_MS, con una pausa de FAKE_AGY_PAUSA_MS en el paso
//   FAKE_AGY_PAUSA_EN, y termina); colgado (da el primer paso y calla; solo ruido en el log, y con FAKE_AGY_MUDO
//   el «stream idle timeout»).
// `agy models` responde con FAKE_AGY_MODELOS (separados por comas; por defecto, la lista del 2026-10-12).
// Como el agy real, un modelo que no está en esa lista da «invalid model selection» en cualquier escenario.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { LISTA_1210, salidaModels } from './listas-modelos.mjs';

const args = process.argv.slice(2);
const valor = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const modelo = valor('--model');
const escenario = process.env.FAKE_AGY_ESCENARIO ?? 'exito';
const lista = process.env.FAKE_AGY_MODELOS ? process.env.FAKE_AGY_MODELOS.split(',') : LISTA_1210;

// Como el agy real, lee stdin hasta el final: si el script lo dejara abierto, esto se colgaría.
for await (const _ of process.stdin);

if (process.env.FAKE_AGY_REGISTRO) {
  appendFileSync(process.env.FAKE_AGY_REGISTRO, JSON.stringify({ args, cwd: process.cwd(), entorno: Object.keys(process.env) }) + '\n');
}

if (args[0] === 'models') {
  if (process.env.FAKE_AGY_MODELS_FALLA) {
    process.stderr.write('error: authentication required\n');
    process.exit(1);
  }
  process.stdout.write(salidaModels(lista));
  process.exit(0);
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
const invalido = () => {
  const error = `invalid model selection (--model "${modelo}" --effort ""): model ${modelo} is not recognized as a known model or custom model in settings`;
  salir(fallo(error), 1, `error: ${error}`);
};
const ERROR_SALIDA_LARGA =
  'Your previous response was cut off because it exceeded the output token limit\nPlease continue from where you left off, keeping your response shorter\nRetries remaining: 3';

// Un nombre base (gemini-3.8-flash, con --effort) vale si la lista tiene alguno de sus niveles.
if (modelo && !lista.includes(modelo) && !lista.some((m) => m.startsWith(`${modelo}-`))) invalido();

switch (escenario) {
  case 'exito':
    salir(exito(`Listo con ${modelo}. Revisé [calculo.js](file:///${process.cwd().replace(/\\/g, '/')}/src/calculo.js).\n`));
    break;
  case 'edita':
    writeFileSync(join(process.cwd(), 'nuevo.txt'), 'creado por agy falso\n');
    salir(exito('Creé nuevo.txt.\n'));
    break;
  case 'crlf_doble':
    // Lo que dejó Flash al editar un archivo CRLF en Inti (2026-11-01); el binario lleva NUL y no se toca.
    writeFileSync(join(process.cwd(), 'doble.txt'), 'uno\r\r\ndos\r\r\r\ntres\r\n');
    writeFileSync(join(process.cwd(), 'bin.dat'), Buffer.from('a\0b\r\r\n', 'latin1'));
    salir(exito('Edité doble.txt.\n'));
    break;
  case 'edita_ignorado':
    // Un archivo que git ignora (como CLAUDE.md o .dev.vars en los repos del usuario).
    appendFileSync(join(process.cwd(), 'CLAUDE.md'), 'editado por agy falso\n');
    salir(exito('Edité CLAUDE.md.\n'));
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
  case 'print_timeout':
    // agy agotó su propio --print-timeout razonando: responde vacío, pero la conversación sigue disponible.
    // Texto real del 2026-10-14 (--print-timeout 400s).
    salir(exito('', { duration_seconds: 417.3, num_turns: 2 }), 0, '[agy] print timeout after 6m40s with turn in progress; returning partial output');
    break;
  case 'denegado_url':
    salir(
      exito('', { duration_seconds: 5.1, denied_actions: [{ action: 'read_url', display_name: 'ReadUrl' }] }),
      0,
      'jetski: no output produced — a tool required the "read_url" permission that headless mode cannot prompt for, so it was auto-denied.',
    );
    break;
  case 'toca_encargo':
    // Simula al orquestador reforzando el encargo mientras agy trabaja: el archivo de entrada cambia.
    appendFileSync(valor('-p').match(/Lee el archivo (.+?) y cumple/)[1], '- Terminal: PROHIBIDA.\n');
    salir(exito('Listo.\n'));
    break;
  case 'edita_add_dir':
    // Escribe en la carpeta del encargo (llega como --add-dir), fuera del --cwd.
    writeFileSync(join(valor('--add-dir'), 'plan.md'), 'plan que nadie pidió\n');
    salir(exito('Dejé un plan.\n'));
    break;
  case 'modelo_invalido':
    invalido();
    break;
  case 'cuota': {
    const agotados = (process.env.FAKE_AGY_CUOTA ?? '').split(',');
    if (agotados.includes(modelo)) {
      const error = `RESOURCE_EXHAUSTED: quota exceeded for model ${modelo}`;
      salir(fallo(error), 1, `error: ${error}`);
    }
    salir(exito(`Listo con ${modelo}.\n`));
    break;
  }
  case 'mudo': {
    const mudos = process.env.FAKE_AGY_MUDOS?.split(',');
    if (mudos && !mudos.includes(modelo)) salir(exito(`Listo con ${modelo}.\n`));
    // Líneas reales de cli-20261025_195337.log (agy 1.4.7), con otro id.
    const id = 'aaaa1111-2222-3333-4444-555566667777';
    const dir = join(process.env.DELEGAR_AGY_HOME, 'log');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `cli-${Date.now()}.log`),
      [
        `I1025 19:53:42.325734       1 server.go:1225] Created conversation ${id} (backend=BACKEND_TYPE_UNSPECIFIED)`,
        'I1025 20:04:00.332556     780 run.go:301] Run: attempt 1 failed (stream reading error: stream idle timeout (5m0s): context deadline exceeded), retrying in 4s',
        'W1025 20:08:42.424312       1 poll.go:188] Print mode: print timeout after 15m0s with turn in progress after 35242 polls (printed=10)',
      ].join('\n') + '\n',
    );
    salir(
      { ...exito('', { duration_seconds: 618.2, num_turns: 3 }), conversation_id: id },
      0,
      '[agy] print timeout after 15m0s with turn in progress; returning partial output',
    );
    break;
  }
  case 'transitorio': {
    // Cuenta sus propias llamadas (sin las de `agy models`) en el registro de llamadas.
    const previas = readFileSync(process.env.FAKE_AGY_REGISTRO, 'utf8')
      .trim()
      .split('\n')
      .filter((l) => JSON.parse(l).args[0] !== 'models').length;
    if (previas === 1 || process.env.FAKE_AGY_SIEMPRE) {
      // Texto real del 2026-10-16 (historial de transcriptor-academico).
      const error = `API error (attempt 1): UNAVAILABLE (code 503): No capacity available for model ${modelo} on the server`;
      salir({ ...fallo(error), duration_seconds: 542.1 }, 1, `error: ${error}`);
    }
    salir(exito(`Listo con ${modelo}.\n`));
    break;
  }
  case 'parcial':
    // Real del 2026-10-20 (Argon High, 19 min): error, pero la respuesta estaba completa.
    salir({ ...fallo('The stream was interrupted. Please continue the task you were working on.'), response: '## Hallazgos\n1. Uno.\n2. Dos.\n', duration_seconds: 1158 }, 1);
    break;
  case 'salida_larga':
  case 'salida_larga_vacia': {
    // Real del 2026-10-22 (Flash High, 10 hallazgos).
    const error = ERROR_SALIDA_LARGA;
    salir({ ...fallo(error), response: escenario === 'salida_larga' ? '## Hallazgos\n1. Uno.\n2. Do' : '', duration_seconds: 541 }, 1);
    break;
  }
  case 'imagen': {
    const id = '297fcc3e-19ea-4601-a61a-67a132cb03c1';
    const dir = join(process.env.DELEGAR_AGY_HOME, 'brain', id);
    mkdirSync(join(dir, '.system_generated', 'logs'), { recursive: true });
    writeFileSync(join(dir, '.system_generated', 'logs', 'transcript.jsonl'), '{}\n');
    writeFileSync(join(dir, 'logo_1761400000.jpg'), 'jpg');
    salir(exito('No tengo una herramienta para generar imágenes.\n'));
    break;
  }
  case 'toca_ajustes':
    writeFileSync(join(process.env.DELEGAR_AGY_HOME, 'settings.json'), '{"permissions":{"allow":["command(*)"]}}');
    salir(exito('Listo.\n'));
    break;
  case 'pide_permiso':
    salir(exito('Corregí el error y corrí las pruebas.\n\n- **PERMISO:** `git log --oneline -1` — para informar el último commit\nPERMISO: npm publish — para publicar\n'));
    break;
  case 'comandos':
  case 'denegado_fuera': {
    const id = '297fcc3e-19ea-4601-a61a-67a132cb03c1';
    const dir = join(process.env.DELEGAR_AGY_HOME, 'brain', id, '.system_generated', 'logs');
    mkdirSync(dir, { recursive: true });
    const hora = new Date().toISOString();
    const pasos = [
      { step_index: 0, type: 'USER_INPUT', created_at: '2020-01-01T00:00:00Z', tool_calls: [{ name: 'run_command', args: { CommandLine: '"de otro turno"' } }] },
      { step_index: 1, type: 'PLANNER_RESPONSE', created_at: hora, tool_calls: [{ name: 'run_command', args: { BypassSandbox: 'false', CommandLine: '"node --test"' } }] },
      { step_index: 2, type: 'PLANNER_RESPONSE', created_at: hora, tool_calls: [{ name: 'read_file', args: {} }] },
    ];
    if (escenario === 'denegado_fuera') {
      pasos.push({ step_index: 3, type: 'PLANNER_RESPONSE', created_at: hora, tool_calls: [{ name: 'run_command', args: { BypassSandbox: 'true', CommandLine: '"git commit -m x"' } }] });
    }
    writeFileSync(join(dir, 'transcript.jsonl'), pasos.map((p) => JSON.stringify(p)).join('\n') + '\n');
    if (escenario === 'comandos') salir(exito('Pruebas en verde.\n'));
    salir(
      exito('', { denied_actions: [{ action: 'command', display_name: 'RunCommand' }] }),
      0,
      'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.',
    );
    break;
  }
  case 'lee_y_otro_edita': {
    const id = '297fcc3e-19ea-4601-a61a-67a132cb03c1';
    const dir = join(process.env.DELEGAR_AGY_HOME, 'brain', id, '.system_generated', 'logs');
    mkdirSync(dir, { recursive: true });
    const hora = new Date().toISOString();
    const pasos = [
      { step_index: 1, type: 'PLANNER_RESPONSE', created_at: hora, tool_calls: [{ name: 'read_file', args: {} }] },
    ];
    if (process.env.FAKE_AGY_ESCRIBE) {
      pasos.push({ step_index: 2, type: 'PLANNER_RESPONSE', created_at: hora, tool_calls: [{ name: 'write_file', args: {} }] });
    }
    writeFileSync(join(dir, 'transcript.jsonl'), pasos.map((p) => JSON.stringify(p)).join('\n') + '\n');
    writeFileSync(join(process.cwd(), 'ajeno.txt'), 'cambiado por otro proceso\n');
    salir(exito('Revisé.\n'));
    break;
  }
  case 'lectura_inexistente': {
    const id = '297fcc3e-19ea-4601-a61a-67a132cb03c1';
    const dir = join(process.env.DELEGAR_AGY_HOME, 'brain', id, '.system_generated', 'logs');
    mkdirSync(dir, { recursive: true });
    const hora = new Date().toISOString();
    const pasos = [
      { step_index: 1, type: 'PLANNER_RESPONSE', created_at: hora, tool_calls: [{ name: 'read_file', args: {} }] },
      { type: 'GENERIC', status: 'ERROR', error: 'file does not exist', created_at: hora },
      { type: 'GENERIC', status: 'ERROR', error: 'file does not exist', created_at: hora },
      {
        type: 'GENERIC',
        status: 'ERROR',
        error:
          'permission check failed for read_file "C:/fuera/package.json": user denied permission for read_file(C:/fuera/package.json)\nDo not attempt to circumvent this denial.',
        created_at: hora,
      },
    ];
    writeFileSync(join(dir, 'transcript.jsonl'), pasos.map((p) => JSON.stringify(p)).join('\n') + '\n');
    salir(
      exito('', { denied_actions: [{ action: 'read_file', display_name: 'ReadFile' }] }),
      0,
      'jetski: no output produced — a tool required the "read_file" permission that headless mode cannot prompt for, so it was auto-denied.',
    );
    break;
  }
  case 'salida_larga_sigue': {
    const id = '297fcc3e-19ea-4601-a61a-67a132cb03c1';
    const dir = join(process.env.DELEGAR_AGY_HOME, 'brain', id, '.system_generated', 'logs');
    mkdirSync(dir, { recursive: true });
    const hora = new Date().toISOString();
    const pasos = [
      { type: 'PLANNER_RESPONSE', created_at: hora, content: 'look under the tree, razonamiento cortado' },
      { type: 'ERROR_MESSAGE', created_at: hora, error: ERROR_SALIDA_LARGA },
      { type: 'PLANNER_RESPONSE', created_at: hora, content: '## Hallazgos\n1. Uno.\n2. Dos.\n' },
    ];
    writeFileSync(join(dir, 'transcript.jsonl'), pasos.map((p) => JSON.stringify(p)).join('\n') + '\n');
    salir(
      {
        ...fallo(ERROR_SALIDA_LARGA),
        conversation_id: id,
        response: 'look under the tree, razonamiento cortado## Hallazgos\n1. Uno.\n2. Dos.\n',
        duration_seconds: 541,
      },
      1,
    );
    break;
  }
  case 'json_en_texto':
    salir(exito('Aquí está el resultado:\n```json\n{"hallazgos": [{"titulo": "uno"}]}\n```\nEspero que sirva.\n'));
    break;
  case 'toca_otro_encargo': {
    // Otra delegación (anterior o en paralelo) reescribe sus archivos en su carpeta, dentro del --cwd.
    const otra = join(process.cwd(), 'otro-encargo');
    // FAKE_AGY_ARCHIVOS elige cuáles (p. ej., solo resumen.json, que en un lote aparece antes que agy-salida.json).
    const nombres = process.env.FAKE_AGY_ARCHIVOS?.split(',') ?? ['agy-salida.json', 'respuesta.md', 'historial.jsonl', 'encargo.md'];
    for (const n of nombres) writeFileSync(join(otra, n), `${Date.now()}\n`);
    // Con FAKE_AGY_RAIZ, además edita un respuesta.md del proyecto, que no es de ninguna carpeta de encargo.
    if (process.env.FAKE_AGY_RAIZ) writeFileSync(join(process.cwd(), 'respuesta.md'), 'editado por agy falso\n');
    salir(exito('Listo.\n'));
    break;
  }
  case 'trabaja_largo':
  case 'colgado': {
    // Como el agy real (sonda del 2026-10-31): escribe transcript.jsonl en vivo y su primer paso trae el mensaje.
    // Solo --conversation fija el id; si no, uno propio por proceso, para las pruebas en paralelo.
    const id = valor('--conversation') ?? `f${process.pid}-0000-4000-8000-000000000000`;
    const dir = join(process.env.DELEGAR_AGY_HOME, 'brain', id, '.system_generated', 'logs');
    mkdirSync(dir, { recursive: true });
    const transcript = join(dir, 'transcript.jsonl');
    const paso = (type, extra = {}) => appendFileSync(transcript, JSON.stringify({ type, created_at: new Date().toISOString(), ...extra }) + '\n');
    paso('USER_INPUT', { content: valor('-p') });
    if (escenario === 'colgado') {
      // Ruido real del log, una línea por minuto: no es avance. FAKE_AGY_MUDO agrega el reintento tras un silencio.
      const logs = join(process.env.DELEGAR_AGY_HOME, 'log');
      mkdirSync(logs, { recursive: true });
      const log = join(logs, `cli-${process.pid}.log`);
      appendFileSync(log, `Created conversation ${id}\n`);
      if (process.env.FAKE_AGY_MUDO) appendFileSync(log, 'Run: attempt 1 failed (stream reading error: stream idle timeout (5m0s): context deadline exceeded), retrying in 4s\n');
      setInterval(() => appendFileSync(log, 'W code_assist_client.go:207] AICode FetchConfig failed\n'), 50);
      const nieto = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'inherit' });
      if (process.env.FAKE_AGY_NIETO) writeFileSync(process.env.FAKE_AGY_NIETO, String(nieto.pid));
      break;
    }
    let dados = 0;
    const total = Number(process.env.FAKE_AGY_PASOS ?? 8);
    const pausa = () => (dados === Number(process.env.FAKE_AGY_PAUSA_EN ?? -1) ? Number(process.env.FAKE_AGY_PAUSA_MS) : Number(process.env.FAKE_AGY_CADA_MS ?? 200));
    const dar = () => {
      paso('PLANNER_RESPONSE', { content: 'CONTENIDO-SECRETO-DEL-PASO', tool_calls: [{ name: 'read_file', args: {} }] });
      if (++dados >= total) salir({ ...exito('Terminé.\n'), conversation_id: id });
      setTimeout(dar, pausa());
    };
    setTimeout(dar, pausa());
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
