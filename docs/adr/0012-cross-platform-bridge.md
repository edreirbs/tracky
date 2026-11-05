# 0012. Puente e instalación multiplataforma (macOS, Windows y Linux)

- Estado: Aceptado · Fecha: 2026-11-06

## Contexto
La v1 suponía una Mac (mlx-whisper, launchd, `setup-mac.sh` en bash). Tracky debe poder instalarlo
cualquier persona, sin importar su sistema operativo.

## Opciones
1. Un script por sistema (bash + PowerShell) → lógica duplicada que se desincroniza.
2. **Instalador en Python (`scripts/setup.py`, solo biblioteca estándar) + arranque automático en el propio
   puente (`tracky_bridge/autostart.py`)**, con `uv` como único requisito (se instala sin administrador). ✅

## Decisión
Opción 2.
* **Motor**: Mac Apple Silicon → mlx-whisper (large-v3-turbo con ≥ 16 GB, si no small); Windows/Linux/Mac Intel →
  faster-whisper (large-v3-turbo con GPU NVIDIA, si no small en CPU).
* **Arranque automático**: launchd (macOS), carpeta Inicio con un `.vbs` oculto (Windows), systemd de usuario o
  XDG autostart (Linux).
* **Emparejar**: `tracky-bridge pair-now` detiene la instancia de fondo, muestra el código, espera y la vuelve a
  arrancar, igual en los tres sistemas.
* **Audio de los demás**: macOS nativo (`tracky-audiotap`); Windows, compartir **pantalla completa con audio del
  sistema** en Chrome/Edge (sirve para las apps de Teams/Zoom); Linux, compartir la **pestaña** de la junta web.

## Consecuencias
* (+) Un solo instalador probado; el camino Linux se probó completo (instalar, modelo real, arranque, emparejar).
* (−) En Windows y Linux la captura del audio de los demás pide elegir qué compartir al empezar a grabar, y la
  detención automática al colgar se basa en el fin de lo compartido, no en detectar la app de la llamada.
* (−) Windows aún no se ha probado en una máquina real (pendiente T510).
