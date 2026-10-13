// Listas de `agy models` para las pruebas. Las dos primeras son reales; la futura es inventada
// para comprobar que el script no depende de versiones concretas.

// agy 1.3.3, 2026-10-11 (con Gemini Pro y Flash 3.6–3.8).
export const LISTA_1110 = [
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'gemini-3.7-flash-high',
  'gemini-3.7-flash-medium',
  'gemini-3.7-flash-low',
  'gemini-3.6-flash-high',
  'gemini-3.6-flash-medium',
  'gemini-3.6-flash-low',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro-low',
  'claude-opus-5-5-low',
  'claude-opus-5-5-medium',
  'claude-opus-5-5-high',
  'claude-sonnet-5-5-low',
  'claude-sonnet-5-5-medium',
  'claude-sonnet-5-5-high',
  'gpt-oss-120b-medium',
];

// agy 1.3.3, 2026-10-12 por la tarde: Google quitó Pro y Flash 3.6–3.7.
export const LISTA_1210 = [
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'claude-opus-5-5-low',
  'claude-opus-5-5-medium',
  'claude-opus-5-5-high',
  'claude-sonnet-5-5-low',
  'claude-sonnet-5-5-medium',
  'claude-sonnet-5-5-high',
  'gpt-oss-120b-medium',
];

// Inventada: versiones nuevas de todas las familias, desordenadas a propósito (las más viejas primero), para que
// el script no dependa del orden en que agy las lista.
export const LISTA_FUTURA = [
  'gemini-3.8-flash-medium',
  'gemini-4.0-flash-high',
  'gemini-4.0-flash-medium',
  'gemini-4.0-flash-low',
  'gemini-3.10-pro-high',
  'gemini-4.0-pro-high',
  'gemini-4.0-pro-low',
  'claude-sonnet-5-5-low',
  'claude-sonnet-6-0-low',
  'claude-sonnet-6-0-medium',
  'claude-opus-6-0-medium',
  'gpt-oss-200b-medium',
];

// Salida de `agy models` tal como la imprime agy (con la línea inicial y tabuladores).
export function salidaModels(lista) {
  return ['Fetching available models...', ...lista.map((m) => `${m}\t${m}`)].join('\n') + '\n';
}
