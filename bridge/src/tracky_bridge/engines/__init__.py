"""Motores de transcripción intercambiables. Todos reciben audio float32 mono a 16 kHz."""

from __future__ import annotations

import importlib.util
import platform
import sys
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from ..config import Config

SAMPLE_RATE = 16_000


@dataclass
class Segment:
    start: float  # segundos relativos al fragmento
    end: float
    text: str
    avg_logprob: float = 0.0
    no_speech_prob: float = 0.0
    compression_ratio: float = 0.0


class Engine(Protocol):
    name: str
    model: str
    device: str

    def load(self) -> None: ...

    def transcribe(self, audio: np.ndarray, language: str, initial_prompt: str | None) -> list[Segment]: ...


DEFAULT_MODELS = {
    "mlx-whisper": "mlx-community/whisper-large-v3-turbo",
    "faster-whisper": "large-v3-turbo",
    "openai-whisper": "turbo",
    "whisper-cpp": "(modelo cargado en whisper-server)",
}


def is_apple_silicon() -> bool:
    return sys.platform == "darwin" and platform.machine() == "arm64"


def available_engines() -> list[str]:
    found = []
    if is_apple_silicon() and importlib.util.find_spec("mlx_whisper"):
        found.append("mlx-whisper")
    if importlib.util.find_spec("faster_whisper"):
        found.append("faster-whisper")
    if importlib.util.find_spec("whisper"):
        found.append("openai-whisper")
    return found


def create_engine(cfg: Config) -> Engine:
    name = cfg.engine
    if name == "auto":
        engines = available_engines()
        if not engines:
            raise RuntimeError(
                "No se encontró ningún Whisper. En Mac con Apple Silicon: `pipx install ./bridge` instala mlx-whisper; "
                "o usa engine = \"whisper-cpp\" con whisper-server corriendo."
            )
        name = engines[0]
    model = cfg.model or DEFAULT_MODELS.get(name, "")
    if name == "mlx-whisper":
        from .mlx import MlxWhisperEngine

        return MlxWhisperEngine(model)
    if name == "faster-whisper":
        from .faster import FasterWhisperEngine

        return FasterWhisperEngine(model, cfg.device)
    if name == "openai-whisper":
        from .openai import OpenAIWhisperEngine

        return OpenAIWhisperEngine(model, cfg.device)
    if name == "whisper-cpp":
        from .whispercpp import WhisperCppEngine

        return WhisperCppEngine(cfg.whisper_cpp_url)
    if name == "fake":
        from .fake import FakeEngine

        return FakeEngine()
    raise ValueError(f"Motor desconocido: {name}")
