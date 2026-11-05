"""Casos tomados de alucinaciones reales de Whisper en una junta (texto sintético equivalente)."""

import pytest

from tracky_bridge.filters import RecentFilter, clean_segment, collapse_repeats, strip_prompt_echo

VOCAB = ["TECgpt", "TECbot", "TECbot Académico", "MDA", "AgenTEC", "OCI", "CREA", "U21"]


def test_colapsa_bucles_de_palabras():
    assert collapse_repeats("Raba Dlloa, Raba Dlloa, Raba Dlloa, Raba Dlloa, Raba D Módulo 2") == "Raba Dlloa, Raba D Módulo 2"
    assert collapse_repeats("en el a long a long a long a long Toda la configuración") == "en el a long Toda la configuración"


def test_colapsa_listas_pegadas_por_comas():
    out = collapse_repeats("estimulado 1,1,1,1,1,1,1,1,1,1,1 Consideraciones de privacidad")
    assert "1, 1, 1" not in out and "Consideraciones de privacidad" in out


def test_no_toca_texto_normal():
    t = "Sí, sí, de acuerdo. Lo revisamos el lunes con Mario."
    assert collapse_repeats(t) == t


def test_quita_eco_del_prompt():
    assert strip_prompt_echo("Reunión de trabajo en español de la Universidad de México. Bueno, no sé si has visto", VOCAB) == "Bueno, no sé si has visto"
    assert strip_prompt_echo("Gracias. Reunión de trabajo en español, TECbot, MDA, AgenTEC,", VOCAB) == "Gracias."
    assert strip_prompt_echo("El TECbot Académico ataca la prueba 4", VOCAB) == "El TECbot Académico ataca la prueba 4"


@pytest.mark.parametrize(
    "text,nsp,lp",
    [
        ("It's not as if you can go to the school.", 0.3, -0.3),
        ("So, it's a plan.", 0.2, -0.6),
        ("you", 0.0, 0.0),
    ],
)
def test_descarta_ingles_inventado(text, nsp, lp):
    assert clean_segment(text, no_speech_prob=nsp, avg_logprob=lp, vocabulary=VOCAB) is None


def test_conserva_terminos_en_ingles_dentro_de_espanol():
    t = "Se va a medir el impacto en learning outcomes el próximo semestre."
    assert clean_segment(t, no_speech_prob=0.3, avg_logprob=-0.5, vocabulary=VOCAB) == t


def test_descarta_alta_compresion():
    assert clean_segment("a los estudiantes, " * 3, compression_ratio=3.1) is None


def test_duplicados_consecutivos_por_canal():
    f = RecentFilter()
    assert not f.is_duplicate(0, "It's not as if you can go")
    assert f.is_duplicate(0, "It's not as if you can go.")
    assert not f.is_duplicate(1, "It's not as if you can go")
