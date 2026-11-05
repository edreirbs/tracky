"""Distinción de voces ("Participante N") y reconocimiento de "Yo" por timbre (ADR-0010, ADR-0011).

Para cada segmento de Whisper se calcula una huella de voz (embedding de 256 valores) con un modelo
ONNX local (sherpa-onnx + WeSpeaker ResNet34) y se agrupa en línea con las voces ya vistas en la misma
junta. Las huellas solo viven en memoria mientras la junta está activa: nunca se guardan ni se envían.
"""

from __future__ import annotations

import os
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import numpy as np

from .config import config_dir
from .engines import SAMPLE_RATE

MODEL_NAME = "wespeaker_en_voxceleb_resnet34_LM.onnx"
MODEL_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/{MODEL_NAME}"
MIN_EMBED_S = 1.0  # con menos audio la huella no es fiable: se hereda la voz anterior del canal
MATCH_THRESHOLD = 0.5  # similitud coseno mínima para decir "es la misma voz"
MAX_SPEAKERS = 12
MAX_MEETINGS = 8


class Embedder(Protocol):
    def embed(self, audio: np.ndarray) -> np.ndarray:
        """Huella normalizada (norma 1) de audio float32 mono a 16 kHz."""
        ...


def model_path() -> Path:
    return config_dir() / "models" / MODEL_NAME


def ensure_model(path: Path | None = None) -> Path | None:
    """Descarga el modelo (~26 MB) la primera vez. Devuelve None si no se pudo."""
    path = path or model_path()
    if path.is_file() and path.stat().st_size > 1_000_000:
        return path
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(MODEL_URL, tmp)  # noqa: S310 (URL fija https)
        tmp.replace(path)
        return path
    except Exception as exc:  # noqa: BLE001
        print(f"! No se pudo descargar el modelo de voces: {type(exc).__name__}", flush=True)
        return None


class SherpaEmbedder:
    def __init__(self, path: Path) -> None:
        import sherpa_onnx

        cfg = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(path), num_threads=2)
        if not cfg.validate():
            raise RuntimeError("configuración de sherpa-onnx inválida")
        self._ex = sherpa_onnx.SpeakerEmbeddingExtractor(cfg)

    def embed(self, audio: np.ndarray) -> np.ndarray:
        stream = self._ex.create_stream()
        stream.accept_waveform(SAMPLE_RATE, np.ascontiguousarray(audio, dtype=np.float32))
        stream.input_finished()
        vec = np.asarray(self._ex.compute(stream), dtype=np.float32)
        return vec / max(float(np.linalg.norm(vec)), 1e-9)


class FakeEmbedder:
    """Para pruebas y E2E: la "voz" es la frecuencia dominante del audio (bandas de 50 Hz)."""

    def embed(self, audio: np.ndarray) -> np.ndarray:
        spectrum = np.abs(np.fft.rfft(audio))
        peak_hz = float(np.argmax(spectrum)) * SAMPLE_RATE / len(audio)
        vec = np.zeros(64, dtype=np.float32)
        vec[min(63, int(peak_hz // 50))] = 1.0
        return vec


SELF = 0  # identificador de "Yo" (la persona usuaria) cuando hay huella de voz registrada
SELF_THRESHOLD = 0.45  # similitud mínima con la huella para decir "es la persona usuaria"
ENROLL_WINDOW_S = 3.0
ENROLL_MIN_WINDOWS = 5


@dataclass
class _Voice:
    centroid: np.ndarray
    count: int = 1


@dataclass
class SpeakerTracker:
    """Agrupación en línea de las voces de una junta (compartida entre canales).

    Si hay huella de voz de la persona usuaria, cualquier segmento que se le parezca es `SELF` (0); las demás voces
    se numeran 1, 2, … La huella no se modifica durante la junta.
    """

    threshold: float = MATCH_THRESHOLD
    me: np.ndarray | None = None
    voices: list[_Voice] = field(default_factory=list)
    last: dict[int, int] = field(default_factory=dict)  # última voz por canal

    def assign(self, embedding: np.ndarray | None, channel: int = 0, allow_self: bool = True) -> int | None:
        if embedding is None:
            prev = self.last.get(channel)
            return None if (prev == SELF and not allow_self) else prev
        if allow_self and self.me is not None and float(self.me @ embedding) >= SELF_THRESHOLD:
            self.last[channel] = SELF
            return SELF
        if self.voices:
            sims = [float(v.centroid @ embedding) for v in self.voices]
            best = int(np.argmax(sims))
            if sims[best] >= self.threshold or len(self.voices) >= MAX_SPEAKERS:
                voice = self.voices[best]
                voice.count += 1
                c = voice.centroid + (embedding - voice.centroid) / voice.count
                voice.centroid = c / max(float(np.linalg.norm(c)), 1e-9)
                self.last[channel] = best + 1
                return best + 1
        self.voices.append(_Voice(embedding.copy()))
        self.last[channel] = len(self.voices)
        return len(self.voices)


class VoiceprintStore:
    """Huella de voz de la persona usuaria (256 números, no audio) en un archivo 0600 dentro de la configuración."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> np.ndarray | None:
        try:
            vec = np.load(self.path, allow_pickle=False)
        except (OSError, ValueError):
            return None
        return vec.astype(np.float32) if vec.ndim == 1 and vec.size > 0 else None

    def save(self, vec: np.ndarray) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            np.save(f, vec.astype(np.float32), allow_pickle=False)
        os.chmod(self.path, 0o600)

    def clear(self) -> None:
        self.path.unlink(missing_ok=True)


def enroll_embedding(embedder: Embedder, audio: np.ndarray) -> np.ndarray | None:
    """Promedia huellas de ventanas de 3 s con voz. None si no hay suficiente voz clara."""
    win = int(ENROLL_WINDOW_S * SAMPLE_RATE)
    vecs = []
    for start in range(0, max(0, len(audio) - win + 1), win // 2):
        chunk = audio[start : start + win]
        if float(np.sqrt(np.mean(chunk**2))) < 0.01:  # silencio o casi
            continue
        vecs.append(embedder.embed(chunk))
    if len(vecs) < ENROLL_MIN_WINDOWS:
        return None
    mean = np.mean(vecs, axis=0)
    return (mean / max(float(np.linalg.norm(mean)), 1e-9)).astype(np.float32)


class Diarizer:
    """Asigna voces a segmentos; un rastreador por junta, solo en memoria."""

    def __init__(self, embedder: Embedder, voiceprints: VoiceprintStore | None = None) -> None:
        self.embedder = embedder
        self.voiceprints = voiceprints
        self.me: np.ndarray | None = voiceprints.load() if voiceprints else None
        self._trackers: OrderedDict[str, SpeakerTracker] = OrderedDict()

    def set_voiceprint(self, vec: np.ndarray | None) -> None:
        self.me = vec
        if self.voiceprints:
            if vec is None:
                self.voiceprints.clear()
            else:
                self.voiceprints.save(vec)

    def tracker(self, meeting_id: str) -> SpeakerTracker:
        if meeting_id not in self._trackers:
            self._trackers[meeting_id] = SpeakerTracker(me=self.me)
            while len(self._trackers) > MAX_MEETINGS:
                self._trackers.popitem(last=False)  # olvida juntas viejas
        self._trackers.move_to_end(meeting_id)
        return self._trackers[meeting_id]

    def speaker_for(self, meeting_id: str, channel: int, audio: np.ndarray, allow_self: bool = True) -> int | None:
        embedding = self.embedder.embed(audio) if len(audio) >= MIN_EMBED_S * SAMPLE_RATE else None
        return self.tracker(meeting_id).assign(embedding, channel, allow_self)


def create_diarizer(setting: str) -> Diarizer | None:
    """`speakers` en config: auto | off | fake."""
    if setting == "off":
        return None
    store = VoiceprintStore(config_dir() / "voiceprint.npy")
    if setting == "fake":
        return Diarizer(FakeEmbedder(), store)
    try:
        import sherpa_onnx  # noqa: F401
    except ImportError:
        print("· Distinción de voces desactivada (falta sherpa-onnx).", flush=True)
        return None
    path = ensure_model()
    if path is None:
        return None
    try:
        return Diarizer(SherpaEmbedder(path), store)
    except Exception as exc:  # noqa: BLE001
        print(f"! No se pudo cargar el modelo de voces: {type(exc).__name__}", flush=True)
        return None
