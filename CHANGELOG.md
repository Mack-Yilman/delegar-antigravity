# Historial de versiones

## 0.1.0 — 2026-10-11

Primera versión.

- **Cuándo delegar:** una tabla de decisión según la tarea. Las acciones que requieren autorización del usuario nunca se delegan. Con datos clínicos, personales o secretos, el agente avisa y pregunta antes de ejecutar, aunque el usuario haya pedido usar agy.
- **Elegir el modelo:** una tabla por dificultad, con Gemini Flash por defecto. Los modelos Claude dentro de Antigravity se usan solo si Gemini falla o el usuario los pide.
- **Encargo en un archivo** fuera del repositorio, con una plantilla: contexto, objetivo, archivos, restricciones, entregable, criterio de terminado y una respuesta final breve.
- **`scripts/agy.mjs`**, sin dependencias:
  - arma el comando con flags seguros (`--sandbox`, `--model` y `--print-timeout` siempre; nunca `--dangerously-skip-permissions`);
  - cierra la entrada estándar y guarda la salida en archivos, para que agy no se cuelgue;
  - corta el árbol de procesos si se pasa del tiempo límite;
  - clasifica el resultado (`ok`, `incompleto`, `edito_en_lectura`, `cuota`, `timeout`, `modelo_invalido`, `auth`…);
  - en modo lectura pide no tocar archivos y avisa si agy los cambió igual, porque ningún modo de agy lo impide;
  - cambia de modelo ante un error de cuota con `--respaldo`;
  - lista los archivos que tocó agy;
  - imprime un resumen corto y deja la respuesta completa en un archivo.
- **Referencias:** `modelos.md`, con la cadena de respaldo, los tiempos medidos y los textos de error reales, y `agy-cli.md`, con los flags, el JSON, los permisos y las trampas de la CLI.
