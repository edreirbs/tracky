from __future__ import annotations

import numpy as np

from . import SAMPLE_RATE, Segment


class MlxWhisperEngine:
    """Whisper en la GPU de Apple Silicon (MLX). Reutiliza el modelo en caché de Hugging Face."""

    name = "mlx-whisper"
    device = "metal"

    def __init__(self, model: str) -> None:
        self.model = model

    def load(self) -> None:
        # mlx_whisper carga y conserva el modelo en memoria en la primera llamada: "calentamos" con 1 s de silencio.
        self.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), "es", None)

    def transcribe(self, audio: np.ndarray, language: str, initial_prompt: str | None) -> list[Segment]:
        import mlx_whisper

        kwargs = dict(
            path_or_hf_repo=self.model,
            language=language,
            initial_prompt=initial_prompt,
            condition_on_previous_text=False,
            verbose=None,
            # Temperaturas altas producen texto inventado; limitamos el respaldo.
            temperature=(0.0, 0.2, 0.4),
            compression_ratio_threshold=2.4,
            logprob_threshold=-1.0,
            no_speech_threshold=0.6,
        )
        try:
            # Salta silencios largos donde Whisper suele alucinar (requiere marcas por palabra).
            result = mlx_whisper.transcribe(audio, word_timestamps=True, hallucination_silence_threshold=2.0, **kwargs)
        except TypeError:  # versión de mlx-whisper sin esa opción
            result = mlx_whisper.transcribe(audio, **kwargs)
        return [
            Segment(
                start=float(s["start"]),
                end=float(s["end"]),
                text=str(s["text"]).strip(),
                avg_logprob=float(s.get("avg_logprob", 0.0)),
                no_speech_prob=float(s.get("no_speech_prob", 0.0)),
                compression_ratio=float(s.get("compression_ratio", 0.0)),
            )
            for s in result.get("segments", [])
        ]
