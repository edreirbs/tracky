"""`tracky-bridge`: arranca el puente local de Whisper."""

from __future__ import annotations

import argparse
import asyncio
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

from aiohttp import web

from . import __version__
from .config import config_dir, load_config, save_origin
from .engines import available_engines, create_engine
from .security import Pairing, TokenStore
from .speakers import create_diarizer
from .system_audio import check as check_system_audio
from .system_audio import call_watcher, find_helper, source_factory

LAUNCH_AGENT_LABEL = "app.tracky.tracky-bridge"


def _store() -> TokenStore:
    return TokenStore(config_dir() / "token.sha256")


def install_autostart() -> int:
    if sys.platform != "darwin":
        print("El arranque automático solo está implementado para macOS.")
        return 1
    exe = shutil.which("tracky-bridge")
    if not exe:
        print("No encontré `tracky-bridge` en el PATH. Instálalo con pipx o `uv tool install`.")
        return 1
    plist_path = Path.home() / "Library/LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist"
    plist_path.parent.mkdir(parents=True, exist_ok=True)
    logs = config_dir() / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    plist_path.write_bytes(
        plistlib.dumps(
            {
                "Label": LAUNCH_AGENT_LABEL,
                "ProgramArguments": [exe],
                "RunAtLoad": True,
                "KeepAlive": True,
                "StandardOutPath": str(logs / "bridge.log"),
                "StandardErrorPath": str(logs / "bridge.log"),
            }
        )
    )
    subprocess.run(["launchctl", "unload", str(plist_path)], check=False, capture_output=True)
    subprocess.run(["launchctl", "load", str(plist_path)], check=True)
    print(f"✓ Arranque automático instalado: {plist_path}")
    print(f"  Bitácora: {logs / 'bridge.log'} (sin audio ni texto de las juntas)")
    return 0


def _check_system_audio(setting: str) -> int:
    """Prueba la captura (y, la primera vez, hace que macOS pida el permiso)."""
    factory = source_factory(setting)
    if factory is None:
        print("No está disponible: requiere macOS 14.2+ y tracky-audiotap (bridge/macos/build-audiotap.sh).")
        return 1
    print("Reproduce algo con sonido (un video) durante 6 segundos…", flush=True)
    peak, failure = asyncio.run(check_system_audio(factory))
    if failure == "no_data":
        print("✗ No llegó audio: macOS no envía nada mientras no suena algo. Pon un video con sonido y repite.")
        print("  Si macOS acaba de pedir el permiso, acéptalo y repite la prueba.")
        return 1
    if failure:
        print(f"✗ La captura falló: {failure}")
        return 1
    if peak < 1e-4:
        print("✗ No llegó sonido. Revisa Ajustes del Sistema → Privacidad y seguridad →")
        print("  Grabación de pantalla y audio del sistema → activa tracky-audiotap, y que algo esté sonando.")
        return 1
    print(f"✓ Audio del sistema capturado (nivel máximo {peak:.2f}).")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tracky-bridge", description="Puente local entre la app y Whisper.")
    parser.add_argument("command", nargs="?", default="serve", choices=["serve", "pair", "unpair", "doctor", "install-autostart", "check-system-audio", "set-origin"])
    parser.add_argument("value", nargs="?", help="Para set-origin: https://tu-sitio.netlify.app")
    parser.add_argument("--dev", action="store_true", help="Permite el origen http://localhost:5173")
    parser.add_argument("--port", type=int)
    parser.add_argument("--engine")
    parser.add_argument("--model")
    parser.add_argument("--speakers", help="auto | off | fake: distinguir voces")
    parser.add_argument("--system-audio", help="auto | off | fake | ruta a tracky-audiotap")
    args = parser.parse_args(argv)

    cfg = load_config(dev=args.dev or None, port=args.port, engine=args.engine, model=args.model, system_audio=args.system_audio, speakers=args.speakers)
    store = _store()

    if args.command == "set-origin":
        if not args.value:
            print("Uso: tracky-bridge set-origin https://tu-sitio.netlify.app")
            return 2
        try:
            path = save_origin(args.value)
        except ValueError as e:
            print(f"✗ {e}")
            return 2
        print(f"✓ Origen permitido guardado en {path}")
        return 0
    if args.command == "unpair":
        store.clear()
        print("✓ Emparejamiento eliminado. La próxima vez se pedirá un código nuevo.")
        return 0
    if args.command == "doctor":
        print(f"tracky-bridge {__version__}")
        print(f"Motores detectados: {', '.join(available_engines()) or 'ninguno'}")
        hf = Path.home() / ".cache/huggingface/hub"
        cached = sorted(p.name for p in hf.glob("models--*whisper*")) if hf.exists() else []
        print("Modelos en caché de Hugging Face:", *([f"  - {c}" for c in cached] or ["  (ninguno)"]), sep="\n")
        print(f"Emparejado: {'sí' if store.is_paired() else 'no'}")
        print(f"Orígenes permitidos: {', '.join(sorted(cfg.origins())) or 'ninguno — corre tracky-bridge set-origin <url>'}")
        helper = find_helper()
        print(f"Audio del sistema (tracky-audiotap): {helper or 'no instalado — corre bridge/macos/build-audiotap.sh'}")
        return 0
    if args.command == "install-autostart":
        return install_autostart()
    if args.command == "check-system-audio":
        return _check_system_audio(cfg.system_audio)

    engine = create_engine(cfg)
    print(f"tracky-bridge {__version__} · motor {engine.name} · modelo {engine.model}")
    print("Cargando modelo (la primera vez puede tardar)…", flush=True)
    engine.load()

    pairing = Pairing(store)
    if args.command == "pair" or not store.is_paired():
        code = pairing.new_code()
        print(f"\n  Código de emparejamiento: {code}   (vence en 2 minutos)\n", flush=True)

    if not cfg.origins():
        print("⚠️  No hay origen permitido: corre `tracky-bridge set-origin https://tu-sitio.netlify.app`.", flush=True)
    origins = ", ".join(sorted(cfg.origins()))
    print(f"✓ Escuchando en http://127.0.0.1:{cfg.port}  ·  orígenes permitidos: {origins}", flush=True)
    system_audio = source_factory(cfg.system_audio)
    print(f"Audio del sistema: {'disponible' if system_audio else 'no disponible (se usará compartir pestaña)'}", flush=True)
    diarizer = create_diarizer(cfg.speakers)
    print(f"Distinción de voces: {'activa' if diarizer else 'desactivada'}", flush=True)
    app = __import__("tracky_bridge.server", fromlist=["create_app"]).create_app(
        cfg, engine, store, pairing, system_audio, diarizer, call_watcher(cfg.system_audio)
    )
    web.run_app(app, host="127.0.0.1", port=cfg.port, print=None, access_log=None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
