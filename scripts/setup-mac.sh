#!/usr/bin/env bash
# Instala el puente local de Whisper en tu Mac (Apple Silicon) y, opcionalmente, su arranque automático.
# Uso (desde la raíz del repo):  ./scripts/setup-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Este script es para macOS." >&2
  exit 1
fi
[[ "$(uname -m)" == "arm64" ]] || echo "Aviso: no es Apple Silicon; mlx-whisper no estará disponible (usa faster-whisper)."

if ! command -v uv >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "→ Instalando uv con Homebrew…"
    brew install uv
  else
    echo "Necesitas uv (https://docs.astral.sh/uv/) o Homebrew. Instala uno y vuelve a correr este script." >&2
    exit 1
  fi
fi

echo "→ Instalando tracky-bridge (incluye mlx-whisper)…"
uv tool install --force ./bridge
uv tool update-shell >/dev/null 2>&1 || true
export PATH="$HOME/.local/bin:$PATH"

echo
tracky-bridge doctor
echo

if [[ -d "$HOME/.cache/huggingface/hub/models--mlx-community--whisper-large-v3-turbo" ]]; then
  echo "✓ El modelo mlx-community/whisper-large-v3-turbo ya está descargado: no hay que bajar nada."
else
  echo "→ La primera vez que arranque, el puente descargará mlx-community/whisper-large-v3-turbo (~1.5 GB)."
fi

echo "→ Compilando tracky-audiotap (audio de Teams/Zoom sin compartir pantalla)…"
if ! xcode-select -p >/dev/null 2>&1; then
  echo "  Faltan las Command Line Tools de Xcode. Se abrirá el instalador; al terminar, vuelve a correr este script."
  xcode-select --install || true
elif bridge/macos/build-audiotap.sh; then
  echo "→ Prueba del audio del sistema: macOS pedirá permiso la primera vez (acepta)."
  tracky-bridge check-system-audio || echo "  (Puedes repetirla luego con: tracky-bridge check-system-audio)"
fi
echo

read -r -p "¿Arrancar el puente automáticamente al iniciar sesión? [S/n] " ans
if [[ ! "$ans" =~ ^[Nn]$ ]]; then
  tracky-bridge install-autostart
  if [[ -s "$HOME/.config/tracky-bridge/token.sha256" ]]; then
    echo "✓ El puente ya está emparejado con la app: no necesitas código."
  else
    echo "El código de emparejamiento aparecerá en: ~/.config/tracky-bridge/logs/bridge.log"
    sleep 4
    grep -o "Código de emparejamiento: [0-9]*" "$HOME/.config/tracky-bridge/logs/bridge.log" | tail -1 || true
  fi
else
  echo "Para iniciarlo manualmente: tracky-bridge"
fi
echo
echo "Listo. Abre una pestaña nueva de Terminal para usar el comando tracky-bridge."
