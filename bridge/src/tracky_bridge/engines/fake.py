from __future__ import annotations

import numpy as np

from . import SAMPLE_RATE, Segment


class FakeEngine:
    """Motor de prueba: describe el fragmento recibido (para pruebas y E2E sin Whisper)."""

    name = "fake"
    model = "fake"
    device = "cpu"

    def __init__(self) -> None:
        self.calls = 0

    def load(self) -> None:
        pass

    def transcribe(self, audio: np.ndarray, language: str, initial_prompt: str | None) -> list[Segment]:
        self.calls += 1
        duration = len(audio) / SAMPLE_RATE
        if float(np.abs(audio).max(initial=0.0)) < 1e-4:
            return []
        return [Segment(0.0, duration, f"fragmento de prueba {self.calls}")]
