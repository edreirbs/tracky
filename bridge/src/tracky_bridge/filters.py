"""Limpieza de alucinaciones típicas de Whisper.

Patrones observados en juntas reales (ver docs/adr/0002):
* bucles: "Raba Dlloa, Raba Dlloa, …", "a long a long …", "1,1,1,1 …";
* eco del prompt de vocabulario en silencios ("Reunión de trabajo en español…", "TECbot, MDA, …");
* frases inventadas en inglés en silencios ("It's not as if you can go to the school", "you");
* la misma frase repetida en segmentos consecutivos.
"""

from __future__ import annotations

import re
import unicodedata

KNOWN_HALLUCINATIONS = (
    "gracias por ver",
    "gracias por ver el video",
    "subtitulos realizados por",
    "subtitulos por la comunidad",
    "amara.org",
    "suscribete",
    "no olvides suscribirte",
    "thanks for watching",
    "thank you for watching",
    "please subscribe",
    "musica",
)
# Segmentos que, solos, casi siempre son alucinación en silencio.
LONE_HALLUCINATIONS = {"you", "thank you", "thanks", "bye", "so", "okay", "oh", "uh", "um", "hmm"}

# Eco del prompt antiguo y de cualquier lista de términos.
PROMPT_ECHO = re.compile(
    r"reuni[oó]n de trabajo(?: en espa[nñ]ol)?(?: de (?:la universidad de )?m[eé]xico)?[^.]*\.?|t[eé]rminos:",
    re.IGNORECASE,
)

ES_STOP = set(
    "el la los las de del que y en un una es por con para no se lo como pero más mas o al ya si sí muy "
    "este esta eso esto también tambien entonces porque pues sea son está esta están hay ahí aqui aquí "
    "nos le les mi tu su qué que cómo cuando donde".split()
)
EN_STOP = set(
    "the a an is are was were it it's its not as if you can go to of and or but so this that be "
    "have has do does i we they he she what with for on in at my your".split()
)


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"[^\w\s.]", "", text).strip(" .")


def _tok(word: str) -> str:
    return re.sub(r"[^\w]", "", _norm(word))


def collapse_repeats(text: str, min_repeats: int = 3, max_n: int = 8) -> str:
    """Colapsa n-gramas que se repiten seguidos ≥ min_repeats veces ("a long a long a long" → "a long")."""
    # Separa listas pegadas por comas ("1,1,1,1") para poder detectar el bucle.
    text = re.sub(r"(?<=\w),(?=\w)", ", ", text) if re.search(r"(\w{1,6},){4,}", text) else text
    words = text.split()
    norm = [_tok(w) for w in words]
    out: list[str] = []
    i = 0
    while i < len(words):
        collapsed = False
        for n in range(1, max_n + 1):
            if i + n * min_repeats > len(words):
                break
            pat = norm[i : i + n]
            if not any(pat):
                continue
            k = 1
            while norm[i + k * n : i + (k + 1) * n] == pat:
                k += 1
            if k >= min_repeats:
                out.extend(words[i : i + n])
                i += k * n
                collapsed = True
                break
        if not collapsed:
            out.append(words[i])
            i += 1
    return " ".join(out)


def strip_prompt_echo(text: str, vocabulary: list[str] | None = None) -> str:
    """Quita el eco del prompt: frases de "Reunión de trabajo…" y listas de ≥ 3 términos del vocabulario."""
    text = PROMPT_ECHO.sub(" ", text)
    if vocabulary:
        terms = "|".join(re.escape(v) for v in sorted(vocabulary, key=len, reverse=True))
        text = re.sub(rf"(?:\b(?:{terms})\b[,.]?\s*){{3,}}", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s{2,}", " ", text).strip(" ,")


def looks_english_hallucination(text: str, no_speech_prob: float, avg_logprob: float) -> bool:
    """Frase corta 100 % en inglés dentro de una junta en español y con señales de silencio/duda."""
    words = [_tok(w) for w in text.split()]
    words = [w for w in words if w]
    if not words or len(words) > 12:
        return False
    es = sum(w in ES_STOP for w in words)
    en = sum(w in EN_STOP for w in words)
    return es == 0 and en >= max(1, len(words) // 3) and (no_speech_prob > 0.1 or avg_logprob < -0.4)


def is_repetitive(text: str, max_repeats: int = 4) -> bool:
    words = _norm(text).split()
    if len(words) < max_repeats * 2:
        return False
    for n in (1, 2, 3):
        grams = [" ".join(words[i : i + n]) for i in range(0, len(words) - n + 1)]
        for g in set(grams):
            if grams.count(g) > max(max_repeats, len(grams) // 2):
                return True
    return False


def keep_segment(text: str, no_speech_prob: float = 0.0, avg_logprob: float = 0.0, compression_ratio: float = 0.0) -> bool:
    norm = _norm(text)
    if not norm:
        return False
    if no_speech_prob > 0.6 and avg_logprob < -1.0:
        return False
    if compression_ratio > 2.4:
        return False
    if norm in LONE_HALLUCINATIONS:
        return False
    if any(norm == h or (len(norm) < 60 and h in norm) for h in KNOWN_HALLUCINATIONS):
        return False
    return not is_repetitive(text)


def clean_segment(
    text: str,
    *,
    no_speech_prob: float = 0.0,
    avg_logprob: float = 0.0,
    compression_ratio: float = 0.0,
    language: str = "es",
    vocabulary: list[str] | None = None,
) -> str | None:
    """Devuelve el texto limpio o None si el segmento debe descartarse."""
    text = strip_prompt_echo(collapse_repeats(text.strip()), vocabulary)
    if not keep_segment(text, no_speech_prob, avg_logprob, compression_ratio):
        return None
    if language == "es" and looks_english_hallucination(text, no_speech_prob, avg_logprob):
        return None
    return text


class RecentFilter:
    """Descarta un segmento igual a uno de los últimos `size` del mismo canal."""

    def __init__(self, size: int = 3) -> None:
        self.size = size
        self.recent: dict[int, list[str]] = {}

    def is_duplicate(self, channel: int, text: str) -> bool:
        key = _norm(text)
        bucket = self.recent.setdefault(channel, [])
        if key in bucket:
            return True
        bucket.append(key)
        del bucket[: -self.size]
        return False
