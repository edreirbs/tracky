"""Arranque automático del puente al iniciar sesión: macOS (launchd), Windows (carpeta Inicio) y Linux
(systemd de usuario, o XDG autostart si no hay systemd). Spec 005 FR-406, ADR-0012.

Las funciones `render_*` son puras (se prueban en cualquier sistema); `install/start/stop` actúan.
"""

from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

LABEL = "app.tracky.tracky-bridge"


def render_launchd(exe: str, log: Path) -> bytes:
    return plistlib.dumps(
        {
            "Label": LABEL,
            "ProgramArguments": [exe],
            "RunAtLoad": True,
            "KeepAlive": True,
            "StandardOutPath": str(log),
            "StandardErrorPath": str(log),
        }
    )


def render_systemd(exe: str, log: "os.PathLike[str] | str") -> str:
    return (
        "[Unit]\n"
        "Description=Tracky: puente local de Whisper (solo 127.0.0.1)\n\n"
        "[Service]\n"
        f'ExecStart="{exe}"\n'
        "Restart=on-failure\n"
        "RestartSec=5\n"
        f"StandardOutput=append:{log}\n"
        f"StandardError=append:{log}\n\n"
        "[Install]\n"
        "WantedBy=default.target\n"
    )


def render_xdg_desktop(exe: str) -> str:
    return (
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=Tracky bridge\n"
        f'Exec="{exe}"\n'
        "X-GNOME-Autostart-enabled=true\n"
        "NoDisplay=true\n"
    )


def render_windows_vbs(exe: str, log: Path) -> str:
    """Script de la carpeta Inicio: arranca el puente oculto y manda su salida a la bitácora."""
    q = '""'
    cmd = f'cmd /c {q}{exe}{q} >> {q}{log}{q} 2>&1'
    return f'CreateObject("Wscript.Shell").Run "{cmd}", 0, False\r\n'


def _paths() -> dict[str, Path]:
    home = Path.home()
    appdata = Path(os.environ.get("APPDATA", home / "AppData/Roaming"))
    xdg = Path(os.environ.get("XDG_CONFIG_HOME", home / ".config"))
    return {
        "launchd": home / "Library/LaunchAgents" / f"{LABEL}.plist",
        "systemd": xdg / "systemd/user/tracky-bridge.service",
        "xdg": xdg / "autostart/tracky-bridge.desktop",
        "windows": appdata / "Microsoft/Windows/Start Menu/Programs/Startup/tracky-bridge.vbs",
    }


def _run(*args: str) -> bool:
    return subprocess.run(list(args), check=False, capture_output=True).returncode == 0


def install(exe: str, log: Path) -> Path:
    """Instala el arranque automático y lo deja corriendo. Devuelve el archivo creado."""
    log.parent.mkdir(parents=True, exist_ok=True)
    p = _paths()
    if sys.platform == "darwin":
        p["launchd"].parent.mkdir(parents=True, exist_ok=True)
        p["launchd"].write_bytes(render_launchd(exe, log))
        _run("launchctl", "unload", str(p["launchd"]))
        _run("launchctl", "load", str(p["launchd"]))
        return p["launchd"]
    if sys.platform == "win32":
        p["windows"].parent.mkdir(parents=True, exist_ok=True)
        p["windows"].write_text(render_windows_vbs(exe, log), encoding="utf-8")
        stop()
        start()
        return p["windows"]
    if shutil.which("systemctl") and _run("systemctl", "--user", "show-environment"):
        p["systemd"].parent.mkdir(parents=True, exist_ok=True)
        p["systemd"].write_text(render_systemd(exe, log))
        _run("systemctl", "--user", "daemon-reload")
        _run("systemctl", "--user", "enable", "--now", "tracky-bridge.service")
        _run("systemctl", "--user", "restart", "tracky-bridge.service")
        return p["systemd"]
    p["xdg"].parent.mkdir(parents=True, exist_ok=True)
    p["xdg"].write_text(render_xdg_desktop(exe))
    start(exe, log)
    return p["xdg"]


def stop() -> None:
    """Detiene el puente que arrancó el sistema (para emparejar o actualizar)."""
    p = _paths()
    if sys.platform == "darwin":
        if p["launchd"].exists():
            _run("launchctl", "unload", str(p["launchd"]))
    elif sys.platform == "win32":
        _run("taskkill", "/IM", "tracky-bridge.exe", "/F")
    elif p["systemd"].exists():
        _run("systemctl", "--user", "stop", "tracky-bridge.service")
    else:
        _kill_others()


def _kill_others() -> None:
    """Detiene otros procesos del puente (nunca el actual ni su padre)."""
    out = subprocess.run(["pgrep", "-f", "tracky-bridge"], capture_output=True, text=True).stdout
    mine = {os.getpid(), os.getppid()}
    for pid in (int(x) for x in out.split() if x.isdigit()):
        if pid not in mine:
            try:
                os.kill(pid, 15)
            except OSError:
                pass


def start(exe: str | None = None, log: Path | None = None) -> None:
    """Vuelve a arrancar el puente en segundo plano con el mecanismo instalado."""
    p = _paths()
    if sys.platform == "darwin":
        if p["launchd"].exists():
            _run("launchctl", "load", str(p["launchd"]))
    elif sys.platform == "win32":
        if p["windows"].exists():
            _run("wscript.exe", str(p["windows"]))
    elif p["systemd"].exists():
        _run("systemctl", "--user", "start", "tracky-bridge.service")
    elif exe:
        out = open(log, "ab") if log else subprocess.DEVNULL  # noqa: SIM115 - lo hereda el proceso hijo
        subprocess.Popen([exe], stdout=out, stderr=out, start_new_session=True)


def installed() -> Path | None:
    for path in _paths().values():
        if path.exists():
            return path
    return None
