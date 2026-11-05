#!/usr/bin/env bash
# Compila tracky-audiotap (captura nativa del audio del sistema, macOS 14.2+) y lo instala.
# Uso: bridge/macos/build-audiotap.sh [directorio-destino]   (por defecto ~/.local/bin)
# Requiere las Command Line Tools de Xcode (`xcode-select --install`).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="${1:-$HOME/.local/bin}"
mkdir -p "$dest"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "Falta swiftc. Instala las Command Line Tools: xcode-select --install" >&2
  exit 1
fi

out="$dest/tracky-audiotap"
swiftc -O -target "$(uname -m)-apple-macos14.2" \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$here/audiotap/Info.plist" \
  "$here/audiotap/main.swift" -o "$out"
# Firma ad hoc con identificador fijo (macOS asocia el permiso a la firma).
codesign --force --sign - --identifier app.tracky.tracky-audiotap "$out"
echo "✓ tracky-audiotap instalado en $out"
