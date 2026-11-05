"""`tracky-bridge`: arranca el puente local de Whisper."""

from __future__ import annotations

import argparse
import asyncio
import shutil
import subprocess
import sys
from pathlib import Path

from aiohttp import web

from . import __version__, autostart
from .config import config_dir, load_config, save_origin
from .engines import available_engines, create_engine
from .security import Pairing, TokenStore
from .speakers import create_diarizer
from .system_audio import check as check_system_audio
from .system_audio import call_watcher, find_helper, source_factory



def _store() -> TokenStore:
    return TokenStore(config_dir() / "token.sha256")


def _exe() -> str | None:
    return shutil.which("tracky-bridge")


def _log() -> Path:
    return config_dir() / "logs" / "bridge.log"


def install_autostart() -> int:
    exe = _exe()
    if not exe:
        print("No encontré `tracky-bridge` en el PATH. Instálalo con `uv tool install`.")
        return 1
    path = autostart.install(exe, _log())
    print(f"✓ Arranque automático instalado: {path}")
    print(f"  Bitácora: {_log()} (sin audio ni texto de las juntas)")
    return 0


async def _serve_until_paired(app: web.Application, port: int, store: TokenStore, timeout_s: int) -> bool:
    """Sirve solo hasta que la app se empareje (o se acabe el tiempo)."""
    before = store.path.stat().st_mtime_ns if store.path.exists() else 0
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    try:
        for _ in range(timeout_s):
            await asyncio.sleep(1)
            if store.path.exists() and store.path.stat().st_mtime_ns != before:
                return True
        return False
    finally:
        await runner.cleanup()


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
    parser.add_argument("command", nargs="?", default="serve", choices=["serve", "pair", "unpair", "doctor", "install-autostart", "check-system-audio", "set-origin", "warmup", "pair-now"])
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
    if args.command == "warmup":
        # Descarga y carga el modelo una vez (para que la primera junta no espere la descarga).
        engine = create_engine(cfg)
        print(f"Descargando/cargando {engine.name} · {engine.model}…", flush=True)
        engine.load()
        print("✓ Modelo listo.")
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
    if args.command == "pair-now":
        # Emparejar sin pelear por el puerto con la instancia de arranque automático (cualquier SO).
        autostart.stop()
        code = pairing.new_code()
        print(f"CODIGO_EMPAREJAMIENTO: {code}", flush=True)
        print("Escríbelo en Tracky → Grabar → 'Empareja el puente' (vence en 2 minutos).", flush=True)
        app = __import__("tracky_bridge.server", fromlist=["create_app"]).create_app(cfg, engine, store, pairing)
        ok = asyncio.run(_serve_until_paired(app, cfg.port, store, 180))
        autostart.start(_exe(), _log())
        print("✓ Emparejado. El puente sigue corriendo en segundo plano." if ok else "✗ No se emparejó a tiempo; repite: tracky-bridge pair-now")
        return 0 if ok else 1
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
