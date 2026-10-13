# Historial de versiones

## 0.2.0 — 2026-10-12

Antigravity quitó Gemini Pro y Flash 3.6–3.7 sin aviso, y la cadena de respaldo fija se quedó sin modelos. Esta versión deja de depender de nombres con versión y corrige lo que apareció en el uso real.

- **Modelos según la lista vigente:**
  - `--modelos` muestra lo que hay hoy en `agy models`, agrupado por familia, y a qué modelo se resuelve cada alias;
  - `--modelo` acepta alias (`flash-medium`, `pro-high`, `sonnet-low`, `gpt-oss`…) y los resuelve a la versión más alta disponible. Sin Pro, `pro-*` usa `flash-high` y el resumen lo dice;
  - la lista se guarda unas horas, porque `agy models` tarda unos 12 s, y se refresca si agy rechaza un modelo o con `--refrescar-modelos`.
- **Respaldo dinámico:** ante un error de cuota o un modelo que ya no existe, prueba las versiones anteriores del mismo alias y luego el nivel vecino, siempre con Gemini. Antes, un modelo inexistente cortaba la cadena.
- **Secretos:** si el espacio de trabajo tiene `.env`, `.dev.vars`, claves o credenciales, el script se detiene con el estado `secretos` (código 4) sin ejecutar agy, porque agy puede leerlos aunque el encargo lo prohíba. `--permitir-secretos` lo permite con el permiso del usuario.
- **Archivos tocados:**
  - los archivos del propio script ya no cuentan, así que la carpeta del encargo sirve como `--cwd`;
  - con git, también vigila los archivos ignorados, como `CLAUDE.md` o `.env`;
  - sin git, el resumen avisa que compara fechas y puede incluir cambios de otros procesos.
- **Tiempo agotado por agy:** cuando agy agota su propio tiempo razonando, el estado es `timeout` con la conversación, para rescatarla pidiendo que entregue ya. Antes daba `incompleto`.
- **Denegaciones explicadas:** el detalle de `incompleto` dice si fue la terminal, una herramienta MCP o la lectura de un archivo, y que una sola denegación vacía toda la respuesta.
- `--timeout`, `--margen` y `--max-respuesta` deben ser enteros positivos: un valor inválido hacía que el script cortara a agy al instante.
- En Windows, un `--cwd` de 259 caracteres o más se rechaza con un mensaje claro. Antes fallaba con `spawn … ENOENT`, como si agy no estuviera instalado.
- **SKILL.md:** alias en lugar de nombres con versión, costos reales (hasta 15 min y 500 mil tokens), una sección para revisiones y auditorías (máximo de hallazgos, `--timeout 1200` y verificar cada hallazgo) y una plantilla que pide leer solo los archivos listados.

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
