#!/usr/bin/env bash
# Instala y configura el puente local de Whisper de Tracky en una Mac, SIN preguntas
# (lo corre Claude Code durante /tracky-setup; también sirve a mano). Idempotente.
#
#   scripts/setup-mac.sh install --origin https://tu-sitio.netlify.app [--model auto|large|small]
#   scripts/setup-mac.sh pair            # muestra el código y espera a que lo escribas en la app
#   scripts/setup-mac.sh status          # diagnóstico corto (lo usa /tracky-doctor)
#
# No usa sudo ni Homebrew. El audio nunca sale de la Mac.
set -euo pipefail
cd "$(dirname "$0")/.."

CONF_DIR="$HOME/.config/tracky-bridge"
LOG="$CONF_DIR/logs/bridge.log"
LABEL="app.tracky.tracky-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
export PATH="$HOME/.local/bin:$PATH"

say() { printf '%s\n' "$*"; }
need_macos() { [[ "$(uname -s)" == "Darwin" ]] || { say "✗ Este script es para macOS."; exit 1; }; }

choose_model() {
  local want="$1" arch mem_gb
  arch="$(uname -m)"
  mem_gb=$(( $(sysctl -n hw.memsize) / 1073741824 ))
  if [[ "$arch" == "arm64" ]]; then
    ENGINE="mlx-whisper"
    if [[ "$want" == "large" || ( "$want" == "auto" && $mem_gb -ge 16 ) ]]; then
      MODEL="mlx-community/whisper-large-v3-turbo"
    else
      MODEL="mlx-community/whisper-small-mlx"
    fi
  else
    ENGINE="faster-whisper"
    MODEL="small"
    [[ "$want" == "large" ]] && MODEL="large-v3-turbo"
  fi
  say "→ Mac ${arch}, ${mem_gb} GB de RAM: motor ${ENGINE}, modelo ${MODEL}"
}

write_config() {
  mkdir -p "$CONF_DIR"
  local cfg="$CONF_DIR/config.toml" origins_line=""
  [[ -f "$cfg" ]] && origins_line="$(grep -E '^allowed_origins' "$cfg" || true)"
  {
    [[ -n "$origins_line" ]] && printf '%s\n' "$origins_line"
    printf 'engine = "%s"\nmodel = "%s"\nlanguage = "es"\n' "$ENGINE" "$MODEL"
  } > "$cfg"
}

agent_loaded() { launchctl list 2>/dev/null | grep -q "$LABEL"; }
stop_agent() { [[ -f "$PLIST" ]] && launchctl unload "$PLIST" >/dev/null 2>&1 || true; }

cmd_install() {
  local origin="" model="auto"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --origin) origin="$2"; shift 2 ;;
      --model) model="$2"; shift 2 ;;
      *) say "Opción desconocida: $1"; exit 2 ;;
    esac
  done
  need_macos
  [[ -n "$origin" ]] || { say "✗ Falta --origin https://tu-sitio.netlify.app"; exit 2; }

  if ! command -v uv >/dev/null 2>&1; then
    say "→ Instalando uv (gestor de Python, sin sudo)…"
    curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null
    export PATH="$HOME/.local/bin:$PATH"
  fi
  say "✓ uv $(uv --version | awk '{print $2}')"

  choose_model "$model"
  say "→ Instalando tracky-bridge…"
  if [[ "$ENGINE" == "faster-whisper" ]]; then
    uv tool install --force --python 3.12 "./bridge[faster]" >/dev/null
  else
    uv tool install --force --python 3.12 ./bridge >/dev/null
  fi
  say "✓ $(command -v tracky-bridge)"

  write_config
  tracky-bridge set-origin "$origin"

  say "→ Descargando el modelo de Whisper (solo la primera vez; puede tardar varios minutos)…"
  tracky-bridge warmup

  say "→ Audio de Teams/Zoom sin compartir pantalla (tracky-audiotap)…"
  if [[ "$(sw_vers -productVersion | cut -d. -f1)" -lt 14 ]]; then
    say "  (Requiere macOS 14.2+; se usará 'compartir pestaña'.)"
  elif ! xcode-select -p >/dev/null 2>&1; then
    xcode-select --install >/dev/null 2>&1 || true
    say "ACCION_USUARIO: macOS abrió el instalador de 'Command Line Tools'. Acéptalo y, al terminar, vuelve a correr este paso."
  else
    bridge/macos/build-audiotap.sh >/dev/null && say "✓ tracky-audiotap compilado"
  fi

  stop_agent
  tracky-bridge install-autostart
  say "✓ Instalación lista. Siguiente paso: scripts/setup-mac.sh pair"
}

cmd_pair() {
  need_macos
  command -v tracky-bridge >/dev/null || { say "✗ Primero: scripts/setup-mac.sh install"; exit 1; }
  mkdir -p "$(dirname "$LOG")"
  stop_agent
  local tmp; tmp="$(mktemp)"
  tracky-bridge pair > "$tmp" 2>&1 &
  local pid=$!
  for _ in $(seq 1 120); do grep -q "Código de emparejamiento" "$tmp" && break; sleep 1; done
  local code; code="$(grep -o 'Código de emparejamiento: [0-9]*' "$tmp" | grep -o '[0-9]*$' || true)"
  if [[ -z "$code" ]]; then
    kill "$pid" 2>/dev/null || true
    say "✗ El puente no arrancó:"; tail -20 "$tmp"; exit 1
  fi
  say "CODIGO_EMPAREJAMIENTO: $code"
  say "Escríbelo en Tracky → pestaña Grabar → 'Empareja el puente' (vence en 2 minutos)."
  for _ in $(seq 1 180); do grep -q "Emparejado con la app" "$tmp" && break; sleep 1; done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  [[ -f "$PLIST" ]] && launchctl load "$PLIST" >/dev/null 2>&1 || true
  if grep -q "Emparejado con la app" "$tmp"; then
    say "✓ Emparejado. El puente quedó corriendo en segundo plano y arrancará solo con tu Mac."
  else
    say "✗ No se emparejó a tiempo. Vuelve a correr: scripts/setup-mac.sh pair"; exit 1
  fi
  rm -f "$tmp"
}

cmd_status() {
  need_macos
  say "tracky-bridge: $(command -v tracky-bridge || echo 'NO instalado')"
  say "Arranque automático: $(agent_loaded && echo 'activo' || echo 'inactivo')"
  if curl -fsS --max-time 3 http://127.0.0.1:47831/health >/dev/null 2>&1; then
    say "Puente: responde en 127.0.0.1:47831"
  else
    say "Puente: NO responde (revisa $LOG)"
  fi
  command -v tracky-bridge >/dev/null && tracky-bridge doctor || true
}

case "${1:-}" in
  install) shift; cmd_install "$@" ;;
  pair) cmd_pair ;;
  status) cmd_status ;;
  *) sed -n '2,9p' "$0"; exit 2 ;;
esac
