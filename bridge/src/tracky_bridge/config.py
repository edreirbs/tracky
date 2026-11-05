from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover
    import tomli as tomllib

DEFAULT_PORT = 47831
DEV_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")


def config_dir() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "tracky-bridge"


@dataclass
class Config:
    engine: str = "auto"  # auto | mlx-whisper | faster-whisper | openai-whisper | whisper-cpp
    model: str = ""  # vacío = predeterminado del motor
    device: str = "auto"
    language: str = "es"
    port: int = DEFAULT_PORT
    # Lo escribe la configuración inicial (`tracky-bridge set-origin https://<tu-sitio>.netlify.app`).
    allowed_origins: list[str] = field(default_factory=list)
    whisper_cpp_url: str = "http://127.0.0.1:8080"
    speakers: str = "auto"  # auto | off | fake: distinguir voces "Participante N" (ADR-0010)
    system_audio: str = "auto"  # auto | off | fake | ruta a tracky-audiotap (ADR-0009)
    dev: bool = False

    def origins(self) -> set[str]:
        origins = set(self.allowed_origins)
        if self.dev:
            origins.update(DEV_ORIGINS)
        return origins


def load_config(path: Path | None = None, **overrides: object) -> Config:
    path = path or config_dir() / "config.toml"
    data: dict[str, object] = {}
    if path.exists():
        with path.open("rb") as f:
            data = tomllib.load(f)
    allowed = {k: v for k, v in data.items() if k in Config.__dataclass_fields__}
    allowed.update({k: v for k, v in overrides.items() if v is not None})
    return Config(**allowed)  # type: ignore[arg-type]


def save_origin(origin: str, path: Path | None = None) -> Path:
    """Guarda el origen de la PWA en config.toml (conserva las demás claves)."""
    from urllib.parse import urlsplit

    parts = urlsplit(origin.strip())
    if parts.scheme not in ("https", "http") or not parts.netloc or parts.path not in ("", "/"):
        raise ValueError("El origen debe verse como https://tu-sitio.netlify.app")
    if parts.scheme == "http" and parts.hostname not in ("localhost", "127.0.0.1"):
        raise ValueError("Solo se permite http:// para localhost")
    clean = f"{parts.scheme}://{parts.netloc}"
    path = path or config_dir() / "config.toml"
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text().splitlines() if path.exists() else []
    lines = [ln for ln in lines if not ln.strip().startswith("allowed_origins")]
    lines.insert(0, f'allowed_origins = ["{clean}"]')
    path.write_text("\n".join(lines) + "\n")
    return path
