# tracky-bridge

Puente local entre Tracky y el Whisper de tu computadora (spec 001; ADR-0007 de meeting-recording).
Escucha solo en `127.0.0.1:47831`, exige `Origin`/`Host` estrictos y un token de emparejamiento, y
**nunca escribe audio a disco**.

Lo instala y configura `/tracky-setup` con `scripts/setup-mac.sh`. Comandos útiles:

| Comando | Para qué |
|---|---|
| `tracky-bridge` | Arranca el puente (normalmente lo hace `launchd` al iniciar sesión) |
| `tracky-bridge set-origin https://tu-sitio.netlify.app` | Origen permitido de tu PWA |
| `tracky-bridge warmup` | Descarga y carga el modelo de Whisper |
| `tracky-bridge pair` | Muestra un código nuevo para emparejar la app |
| `tracky-bridge check-system-audio` | Prueba (y solicita) el permiso de audio del sistema |
| `tracky-bridge doctor` | Diagnóstico corto |

Desarrollo: `uv run pytest` y `uv run tracky-bridge --dev --engine fake`.
