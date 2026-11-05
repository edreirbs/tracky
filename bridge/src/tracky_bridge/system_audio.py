"""Audio del sistema capturado de forma nativa (T001b, ADR-0009).

En macOS 14.2+ el puente lanza `tracky-audiotap` (Swift, Core Audio process tap), que escribe PCM
float32 16 kHz mono por stdout. El audio solo pasa por esa tubería en memoria: nunca se escribe a
disco ni sale de la computadora.
"""

from __future__ import annotations

import asyncio
import json
import math
import shutil
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Protocol

import numpy as np

from .engines import SAMPLE_RATE

BLOCK = SAMPLE_RATE // 10  # 100 ms
HELPER_NAME = "tracky-audiotap"


class AudioSource(Protocol):
    async def start(self) -> None: ...

    async def read_block(self) -> np.ndarray | None:
        """Bloque float32 de 100 ms, o None si la captura terminó."""
        ...

    def failure(self) -> str | None:
        """Código de error tras terminar (p. ej. `tap_create`), si lo hubo."""
        ...

    async def stop(self) -> None: ...


class HelperSource:
    """Lee el audio de `tracky-audiotap` por una tubería."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.proc: asyncio.subprocess.Process | None = None
        self._failure: str | None = None

    async def start(self) -> None:
        self.proc = await asyncio.create_subprocess_exec(
            str(self.path),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

    async def read_block(self) -> np.ndarray | None:
        assert self.proc and self.proc.stdout
        try:
            data = await self.proc.stdout.readexactly(BLOCK * 4)
        except asyncio.IncompleteReadError:
            await self._collect_failure()
            return None
        return np.frombuffer(data, dtype="<f4")

    async def _collect_failure(self) -> None:
        if not self.proc or not self.proc.stderr:
            return
        try:
            err = (await asyncio.wait_for(self.proc.stderr.read(), timeout=2)).decode(errors="replace")
        except asyncio.TimeoutError:
            err = ""
        for line in err.splitlines():
            if line.startswith("error:"):
                parts = line.split()
                self._failure = parts[1] if len(parts) > 1 else "capture_failed"
        if self._failure is None:
            self._failure = "capture_ended"

    def failure(self) -> str | None:
        return self._failure

    async def stop(self) -> None:
        proc = self.proc
        if not proc or proc.returncode is not None:
            return
        if proc.stdin:
            proc.stdin.close()  # el ayudante termina al ver EOF en stdin
        try:
            await asyncio.wait_for(proc.wait(), timeout=2)
        except asyncio.TimeoutError:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=2)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()


class FakeSource:
    """Fuente de prueba (E2E y pruebas): tono de 2 s y silencio de 2 s, en tiempo real."""

    def __init__(self, realtime: bool = True, blocks: int | None = None) -> None:
        self.realtime = realtime
        self.remaining = blocks
        self.n = 0

    async def start(self) -> None:
        pass

    async def read_block(self) -> np.ndarray | None:
        if self.remaining is not None:
            if self.remaining <= 0:
                return None
            self.remaining -= 1
        if self.realtime:
            await asyncio.sleep(BLOCK / SAMPLE_RATE)
        t = (np.arange(BLOCK) + self.n * BLOCK) / SAMPLE_RATE
        on = (self.n // 20) % 2 == 0
        self.n += 1
        return (np.sin(2 * math.pi * 330 * t) * (0.3 if on else 0.0)).astype(np.float32)

    def failure(self) -> str | None:
        return None

    async def stop(self) -> None:
        pass


def find_helper() -> Path | None:
    candidates = [Path.home() / ".local/bin" / HELPER_NAME]
    found = shutil.which(HELPER_NAME)
    if found:
        candidates.insert(0, Path(found))
    return next((p for p in candidates if p.is_file()), None)


def source_factory(setting: str) -> Callable[[], AudioSource] | None:
    """`system_audio` en config: auto | off | fake | ruta al ayudante."""
    if setting == "off":
        return None
    if setting == "fake":
        return FakeSource
    if setting == "auto":
        if sys.platform != "darwin":
            return None
        path = find_helper()
    else:
        path = Path(setting).expanduser()
    if path is None or not path.is_file():
        return None
    return lambda: HelperSource(path)


async def check(factory: Callable[[], AudioSource], seconds: float = 6.0) -> tuple[float, str | None]:
    """Captura unos segundos y devuelve el nivel máximo (sin guardar nada)."""
    source = factory()
    await source.start()
    peak = 0.0
    try:
        for _ in range(int(seconds * 10)):
            try:
                # Mientras macOS muestra el aviso de permiso no llega audio: no esperar para siempre.
                block = await asyncio.wait_for(source.read_block(), timeout=5)
            except asyncio.TimeoutError:
                return peak, "no_data"
            if block is None:
                return peak, source.failure()
            peak = max(peak, float(np.abs(block).max(initial=0.0)))
    finally:
        await source.stop()
    return peak, None


# --- ¿Sigue la llamada? (ADR-0012) ------------------------------------------------------------------

CALL_APPS = {
    "com.microsoft.teams": "Teams",
    "com.microsoft.teams2": "Teams",
    "us.zoom.xos": "Zoom",
    "com.cisco.webexmeetingsapp": "Webex",
    "com.webex.meetingmanager": "Webex",
    "com.apple.FaceTime": "FaceTime",
    "com.tinyspeck.slackmacgap": "Slack",
    "com.hnc.Discord": "Discord",
}


def call_apps_from(bundle_ids: list[str]) -> list[str]:
    """Nombres de apps de videollamada (sin repetir) entre las que tienen el micrófono abierto."""
    names: list[str] = []
    for bid in bundle_ids:
        name = CALL_APPS.get(bid) or next((n for k, n in CALL_APPS.items() if bid.startswith(k + ".")), None)
        if name and name not in names:
            names.append(name)
    return names


async def mic_apps(path: Path, timeout: float = 3.0) -> list[str] | None:
    """IDs de apps con el micrófono abierto, vía `tracky-audiotap --mic-apps`. None si no se pudo."""
    try:
        proc = await asyncio.create_subprocess_exec(
            str(path), "--mic-apps", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        data = json.loads(out.decode() or "{}")
        apps = data.get("input")
        return [str(a) for a in apps] if isinstance(apps, list) else None
    except Exception:  # noqa: BLE001
        return None


def call_watcher(setting: str) -> Callable[[], Awaitable[list[str] | None]] | None:
    """Función que devuelve las apps de llamada activas, o None si no está disponible en este equipo."""
    if setting in ("off", "fake"):
        return None
    if setting == "auto":
        if sys.platform != "darwin":
            return None
        path = find_helper()
    else:
        path = Path(setting).expanduser()
    if path is None or not path.is_file():
        return None
    helper = path

    async def watch() -> list[str] | None:
        ids = await mic_apps(helper)
        return None if ids is None else call_apps_from(ids)

    return watch
