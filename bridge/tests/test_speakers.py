import os
import numpy as np
import pytest

from tracky_bridge.config import Config
from tracky_bridge.engines import SAMPLE_RATE
from tracky_bridge.engines.fake import FakeEngine
from tracky_bridge.security import Pairing, TokenStore
from tracky_bridge.server import create_app, encode_frame
from tracky_bridge.speakers import Diarizer, FakeEmbedder, SpeakerTracker

PORT = 47831
GOOD = {"Host": f"127.0.0.1:{PORT}", "Origin": "https://tracky-prueba.netlify.app"}


def tone(freq, seconds=2.0):
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    return (np.sin(2 * np.pi * freq * t) * 0.3).astype(np.float32)


def unit(*v):
    a = np.array(v, dtype=np.float32)
    return a / np.linalg.norm(a)


def test_tracker_agrupa_voces():
    tr = SpeakerTracker(threshold=0.5)
    assert tr.assign(unit(1, 0, 0)) == 1
    assert tr.assign(unit(0.9, 0.1, 0)) == 1
    assert tr.assign(unit(0, 1, 0)) == 2
    assert tr.assign(None) == 2  # segmento corto: hereda la última voz
    assert tr.assign(unit(1, 0.05, 0)) == 1


def test_diarizer_por_junta_y_canal():
    d = Diarizer(FakeEmbedder())
    assert d.speaker_for("m1", 1, tone(200)) == 1
    assert d.speaker_for("m1", 1, tone(400)) == 2
    assert d.speaker_for("m1", 1, tone(200)) == 1
    assert d.speaker_for("m2", 1, tone(400)) == 1  # otra junta empieza de cero
    assert d.speaker_for("m1", 1, tone(200, 0.5)) == 1  # corto: hereda


@pytest.mark.parametrize("diarize,expected", [([1], [1, 2, 1]), ([], [None, None, None])])
async def test_ws_envia_participante(aiohttp_client, tmp_path, diarize, expected):
    store = TokenStore(tmp_path / "t")
    pairing = Pairing(store)
    client = await aiohttp_client(create_app(Config(port=PORT, allowed_origins=["https://tracky-prueba.netlify.app"]), FakeEngine(), store, pairing, None, Diarizer(FakeEmbedder())))
    token = (await (await client.post("/pair", json={"code": pairing.new_code()}, headers=GOOD)).json())["token"]
    ws = await client.ws_connect("/transcribe", headers=GOOD)
    await ws.send_json({"type": "hello", "token": token, "meetingId": "m", "diarizeChannels": diarize})
    assert (await ws.receive_json())["type"] == "ready"
    for i, f in enumerate([200, 400, 200]):
        await ws.send_bytes(encode_frame(i, 1, i * 3000, (tone(f) * 32767).astype(np.int16)))
    await ws.send_json({"type": "flush"})
    got = []
    while (m := await ws.receive_json())["type"] != "drained":
        if m["type"] == "segment":
            got.append(m.get("speaker"))
    assert got == expected


# --- "Yo" por huella de voz y eco (ADR-0011) -------------------------------------------------------

from tracky_bridge.speakers import SELF, VoiceprintStore, enroll_embedding  # noqa: E402


def test_tracker_reconoce_mi_voz_y_no_en_canal_de_otros():
    tr = SpeakerTracker(me=unit(1, 0, 0))
    assert tr.assign(unit(0.95, 0.1, 0), channel=0) == SELF
    assert tr.assign(unit(0, 1, 0), channel=0) == 1
    assert tr.assign(unit(0.95, 0.1, 0), channel=1, allow_self=False) == 2  # Teams no te devuelve tu voz
    assert tr.assign(None, channel=0) == 1


def test_registro_de_huella(tmp_path):
    emb = FakeEmbedder()
    audio = np.concatenate([tone(200, 3.0) for _ in range(6)])
    vec = enroll_embedding(emb, audio)
    assert vec is not None and abs(float(np.linalg.norm(vec)) - 1) < 1e-5
    assert enroll_embedding(emb, np.zeros(SAMPLE_RATE * 20, dtype=np.float32)) is None  # silencio
    store = VoiceprintStore(tmp_path / "voiceprint.npy")
    store.save(vec)
    if os.name != "nt":  # en Windows protege la ACL del perfil; no hay permisos POSIX
        assert (tmp_path / "voiceprint.npy").stat().st_mode & 0o777 == 0o600
    assert np.allclose(store.load(), vec)
    store.clear()
    assert store.load() is None


async def _client(aiohttp_client, tmp_path, me=None):
    store = TokenStore(tmp_path / "t")
    pairing = Pairing(store)
    d = Diarizer(FakeEmbedder(), VoiceprintStore(tmp_path / "vp.npy"))
    if me is not None:
        d.set_voiceprint(me)
    client = await aiohttp_client(create_app(Config(port=PORT, allowed_origins=["https://tracky-prueba.netlify.app"]), FakeEngine(), store, pairing, None, d))
    token = (await (await client.post("/pair", json={"code": pairing.new_code()}, headers=GOOD)).json())["token"]
    return client, token, d


async def test_endpoint_registro_de_voz(aiohttp_client, tmp_path):
    client, token, d = await _client(aiohttp_client, tmp_path)
    pcm = (np.concatenate([tone(200, 3.0) for _ in range(7)]) * 32767).astype("<i2").tobytes()
    assert (await client.post("/voice", data=pcm, headers=GOOD)).status == 401
    auth = {**GOOD, "Authorization": f"Bearer {token}"}
    assert (await client.post("/voice", data=pcm[: SAMPLE_RATE * 2], headers=auth)).status == 400
    assert (await client.post("/voice", data=pcm, headers=auth)).status == 200
    assert (await (await client.get("/health", headers=GOOD)).json())["voiceprint"] is True
    assert (await client.delete("/voice", headers=auth)).status == 200
    assert d.me is None


async def _run(client, token, mode, frames):
    ws = await client.ws_connect("/transcribe", headers=GOOD)
    await ws.send_json({"type": "hello", "token": token, "meetingId": "m", "mode": mode, "diarizeChannels": [0, 1]})
    assert (await ws.receive_json())["type"] == "ready"
    for f in frames:
        await ws.send_bytes(f)
    await ws.send_json({"type": "flush"})
    got = []
    while (m := await ws.receive_json())["type"] != "drained":
        if m["type"] == "segment":
            got.append((m["channel"], m.get("speaker")))
    await ws.close()
    return got


def pcm16(freq):
    return (tone(freq) * 32767).astype(np.int16)


async def test_en_linea_con_huella_yo_otros_y_eco(aiohttp_client, tmp_path):
    client, token, d = await _client(aiohttp_client, tmp_path, me=FakeEmbedder().embed(tone(200)))
    got = await _run(
        client,
        token,
        "online",
        [
            encode_frame(0, 0, 0, pcm16(200)),  # mi voz → Yo (0)
            encode_frame(1, 1, 3000, pcm16(400)),  # Ana por las bocinas → 1
            encode_frame(2, 0, 6000, pcm16(400), echo=0.9),  # eco de Ana en mi micrófono → fuera
            encode_frame(3, 0, 9000, pcm16(200), echo=0.9),  # yo hablando encima → se queda
            encode_frame(4, 0, 12000, pcm16(600), echo=0.1),  # alguien en mi sala → otra voz
        ],
    )
    assert got == [(0, SELF), (1, 1), (0, SELF), (0, 2)]


async def test_en_linea_sin_huella_microfono_es_yo_y_eco_claro_fuera(aiohttp_client, tmp_path):
    client, token, _ = await _client(aiohttp_client, tmp_path)
    got = await _run(
        client,
        token,
        "online",
        [encode_frame(0, 0, 0, pcm16(200), echo=0.3), encode_frame(1, 0, 3000, pcm16(400), echo=0.9)],
    )
    assert got == [(0, None)]


async def test_en_persona_con_huella(aiohttp_client, tmp_path):
    client, token, _ = await _client(aiohttp_client, tmp_path, me=FakeEmbedder().embed(tone(200)))
    got = await _run(client, token, "in_person", [encode_frame(0, 0, 0, pcm16(400)), encode_frame(1, 0, 3000, pcm16(200))])
    assert got == [(0, 1), (0, SELF)]
