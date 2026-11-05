from __future__ import annotations

import io
import json
import secrets
import urllib.request
import wave

import numpy as np

from . import SAMPLE_RATE, Segment


class WhisperCppEngine:
    """Usa un `whisper-server` de whisper.cpp ya corriendo en 127.0.0.1 (Metal en Mac)."""

    name = "whisper-cpp"
    device = "metal/cpu"

    def __init__(self, url: str) -> None:
        if not url.startswith(("http://127.0.0.1", "http://localhost")):
            raise ValueError("whisper_cpp_url debe ser local")
        self.url = url.rstrip("/")
        self.model = "(whisper-server)"

    def load(self) -> None:
        self.transcribe(np.zeros(SAMPLE_RATE // 2, dtype=np.float32), "es", None)

    def transcribe(self, audio: np.ndarray, language: str, initial_prompt: str | None) -> list[Segment]:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
        boundary = secrets.token_hex(12)
        fields = {"language": language, "response_format": "verbose_json", "temperature": "0"}
        if initial_prompt:
            fields["prompt"] = initial_prompt
        body = io.BytesIO()
        for k, v in fields.items():
            body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        body.write(
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\n'
            "Content-Type: audio/wav\r\n\r\n".encode()
        )
        body.write(buf.getvalue())
        body.write(f"\r\n--{boundary}--\r\n".encode())
        req = urllib.request.Request(
            f"{self.url}/inference",
            data=body.getvalue(),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        with urllib.request.urlopen(req, timeout=120) as res:  # noqa: S310 (URL local validada)
            data = json.loads(res.read())
        segs = data.get("segments")
        if isinstance(segs, list) and segs:
            return [
                Segment(float(s.get("start", 0)), float(s.get("end", 0)), str(s.get("text", "")).strip())
                for s in segs
            ]
        duration = len(audio) / SAMPLE_RATE
        return [Segment(0.0, duration, str(data.get("text", "")).strip())]
