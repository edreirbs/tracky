from __future__ import annotations

import numpy as np

from . import Segment


class OpenAIWhisperEngine:
    """openai-whisper (PyTorch). El más lento; útil si es lo único instalado."""

    name = "openai-whisper"

    def __init__(self, model: str, device: str = "auto") -> None:
        self.model = model
        self.device = "cpu" if device == "auto" else device
        self._model = None

    def load(self) -> None:
        import whisper

        self._model = whisper.load_model(self.model, device=self.device)

    def transcribe(self, audio: np.ndarray, language: str, initial_prompt: str | None) -> list[Segment]:
        if self._model is None:
            self.load()
        result = self._model.transcribe(  # type: ignore[union-attr]
            audio,
            language=language,
            initial_prompt=initial_prompt,
            condition_on_previous_text=False,
            fp16=False,
            temperature=(0.0, 0.2, 0.4),
        )
        return [
            Segment(
                float(s["start"]),
                float(s["end"]),
                str(s["text"]).strip(),
                float(s.get("avg_logprob", 0.0)),
                float(s.get("no_speech_prob", 0.0)),
                float(s.get("compression_ratio", 0.0)),
            )
            for s in result.get("segments", [])
        ]
