from __future__ import annotations

import numpy as np

from . import Segment


class FasterWhisperEngine:
    """faster-whisper (CTranslate2). En Mac corre en CPU; ideal con GPU NVIDIA."""

    name = "faster-whisper"

    def __init__(self, model: str, device: str = "auto") -> None:
        self.model = model
        self.device = device
        self._model = None

    def load(self) -> None:
        from faster_whisper import WhisperModel

        self._model = WhisperModel(self.model, device=self.device, compute_type="default")

    def transcribe(self, audio: np.ndarray, language: str, initial_prompt: str | None) -> list[Segment]:
        if self._model is None:
            self.load()
        segments, _info = self._model.transcribe(  # type: ignore[union-attr]
            audio,
            language=language,
            initial_prompt=initial_prompt,
            condition_on_previous_text=False,
            vad_filter=True,  # VAD de Silero integrado: descarta ruido antes de transcribir
            temperature=[0.0, 0.2, 0.4],
        )
        return [
            Segment(s.start, s.end, s.text.strip(), s.avg_logprob, s.no_speech_prob, s.compression_ratio)
            for s in segments
        ]
