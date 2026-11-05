#!/usr/bin/env python3
"""Instala y configura el puente local de Whisper de Tracky en macOS, Windows o Linux, SIN preguntas.
Lo corre Claude Code durante /tracky-setup (también sirve a mano). Idempotente. Solo biblioteca estándar.

    uv run --no-project --python 3.12 scripts/setup.py install --origin https://tu-sitio.netlify.app [--model auto|large|small]
    uv run --no-project --python 3.12 scripts/setup.py pair      # muestra el código y espera a que lo escribas en la app
    uv run --no-project --python 3.12 scripts/setup.py status    # diagnóstico corto (lo usa /tracky-doctor)

Requisito previo: `uv` (https://docs.astral.sh/uv/). No usa sudo/administrador. El audio nunca sale de la computadora.
"""

from __future__ import annotations

import argparse
import ctypes
import os
import platform
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONF_DIR = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "tracky-bridge"


def say(msg: str) -> None:
    print(msg, flush=True)


# ------------------------------------------------------------------------------------------------
# Detección del equipo y elección del modelo (spec 005 FR-405)
# ------------------------------------------------------------------------------------------------
def ram_gb() -> int:
    try:
        if sys.platform == "darwin":
            return int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).strip()) // 2**30
        if sys.platform == "win32":

            class MemStatus(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong)] + [
                    (n, ctypes.c_ulonglong)
                    for n in ("total", "avail", "totalPage", "availPage", "totalVirtual", "availVirtual", "availExt")
                ]

            st = MemStatus()
            st.dwLength = ctypes.sizeof(MemStatus)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))  # type: ignore[attr-defined]
            return int(st.total // 2**30)
        with open("/proc/meminfo") as f:
            kb = int(re.search(r"MemTotal:\s+(\d+)", f.read()).group(1))  # type: ignore[union-attr]
            return kb // 2**20
    except Exception:
        return 8


def has_nvidia() -> bool:
    return shutil.which("nvidia-smi") is not None and subprocess.run(["nvidia-smi"], capture_output=True).returncode == 0


def choose_model(system: str, machine: str, ram: int, nvidia: bool, want: str = "auto") -> tuple[str, str, str]:
    """Devuelve (motor, modelo, extra de instalación). Pura: se prueba en CI."""
    if system == "darwin" and machine == "arm64":
        large = want == "large" or (want == "auto" and ram >= 16)
        return "mlx-whisper", "mlx-community/whisper-large-v3-turbo" if large else "mlx-community/whisper-small-mlx", ""
    # Windows, Linux y Mac Intel: faster-whisper (GPU NVIDIA si hay; si no, CPU con int8).
    if want == "large" or (want == "auto" and nvidia):
        return "faster-whisper", "large-v3-turbo", "faster"
    return "faster-whisper", "small", "faster"


# ------------------------------------------------------------------------------------------------
# Utilidades
# ------------------------------------------------------------------------------------------------
def bridge_exe() -> str | None:
    found = shutil.which("tracky-bridge")
    if found:
        return found
    for cand in (Path.home() / ".local/bin/tracky-bridge", Path.home() / ".local/bin/tracky-bridge.exe"):
        if cand.exists():
            return str(cand)
    return None


def run(*args: str) -> None:
    subprocess.run(list(args), check=True)


def write_engine_config(engine: str, model: str) -> None:
    CONF_DIR.mkdir(parents=True, exist_ok=True)
    cfg = CONF_DIR / "config.toml"
    keep = [ln for ln in (cfg.read_text().splitlines() if cfg.exists() else []) if ln.startswith("allowed_origins")]
    cfg.write_text("\n".join([*keep, f'engine = "{engine}"', f'model = "{model}"', 'language = "es"']) + "\n")


# ------------------------------------------------------------------------------------------------
# Comandos
# ------------------------------------------------------------------------------------------------
def cmd_install(origin: str, want: str) -> int:
    if not re.match(r"^https://[a-z0-9.-]+(:\d+)?/?$", origin) and not origin.startswith("http://localhost"):
        say("✗ --origin debe verse como https://tu-sitio.netlify.app")
        return 2
    if not shutil.which("uv"):
        say("✗ Falta uv. Instálalo primero (ver /tracky-setup, paso 9) y repite.")
        return 1

    system, machine = sys.platform, platform.machine().lower()
    machine = "arm64" if machine in ("arm64", "aarch64") else machine
    ram, nvidia = ram_gb(), has_nvidia()
    engine, model, extra = choose_model(system, machine, ram, nvidia, want)
    say(f"→ {platform.system()} {machine}, {ram} GB de RAM{', GPU NVIDIA' if nvidia else ''}: motor {engine}, modelo {model}")

    say("→ Instalando tracky-bridge…")
    target = f"{ROOT / 'bridge'}[{extra}]" if extra else str(ROOT / "bridge")
    run("uv", "tool", "install", "--force", "--python", "3.12", target)
    subprocess.run(["uv", "tool", "update-shell"], capture_output=True)
    exe = bridge_exe()
    if not exe:
        say("✗ No encontré tracky-bridge después de instalarlo. Abre una terminal nueva y repite.")
        return 1
    say(f"✓ {exe}")

    write_engine_config(engine, model)
    run(exe, "set-origin", origin.rstrip("/"))

    say("→ Descargando el modelo de Whisper (solo la primera vez; puede tardar varios minutos)…")
    run(exe, "warmup")

    if system == "darwin":
        say("→ Audio de Teams/Zoom sin compartir pantalla (tracky-audiotap, macOS 14.2+)…")
        if subprocess.run(["xcode-select", "-p"], capture_output=True).returncode != 0:
            subprocess.run(["xcode-select", "--install"], capture_output=True)
            say("ACCION_USUARIO: macOS abrió el instalador de 'Command Line Tools'. Acéptalo y, al terminar, repite este paso.")
        else:
            subprocess.run([str(ROOT / "bridge/macos/build-audiotap.sh")], check=False)
    elif system == "win32":
        say("ℹ Audio de los demás en Windows: al grabar, comparte la PANTALLA con 'Compartir audio del sistema' (Chrome/Edge).")
    else:
        say("ℹ Audio de los demás en Linux: al grabar, comparte la PESTAÑA de la junta (Meet/Teams/Zoom web) con audio.")

    run(exe, "install-autostart")
    say("✓ Instalación lista. Siguiente paso: scripts/setup.py pair")
    return 0


def cmd_pair() -> int:
    exe = bridge_exe()
    if not exe:
        say("✗ Primero: scripts/setup.py install --origin <url>")
        return 1
    return subprocess.run([exe, "pair-now"]).returncode


def cmd_status() -> int:
    exe = bridge_exe()
    say(f"tracky-bridge: {exe or 'NO instalado'}")
    try:
        with urllib.request.urlopen("http://127.0.0.1:47831/health", timeout=3) as r:  # noqa: S310 - solo localhost
            say(f"Puente: responde ({r.status}) en 127.0.0.1:47831")
    except Exception:
        say(f"Puente: NO responde (revisa {CONF_DIR / 'logs/bridge.log'})")
    if exe:
        subprocess.run([exe, "doctor"])
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Instalador multiplataforma del puente de Tracky")
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("install")
    i.add_argument("--origin", required=True)
    i.add_argument("--model", default="auto", choices=["auto", "large", "small"])
    sub.add_parser("pair")
    sub.add_parser("status")
    a = p.parse_args()
    if a.cmd == "install":
        return cmd_install(a.origin, a.model)
    return cmd_pair() if a.cmd == "pair" else cmd_status()


if __name__ == "__main__":
    raise SystemExit(main())
