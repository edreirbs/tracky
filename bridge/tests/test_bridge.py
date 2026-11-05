import os
import numpy as np
import pytest

from tracky_bridge.config import Config
from tracky_bridge.engines.fake import FakeEngine
from tracky_bridge.filters import keep_segment
from tracky_bridge.security import Pairing, TokenStore, host_allowed
from tracky_bridge.server import create_app, decode_frame, encode_frame

PORT = 47831
ORIGIN = "https://tracky-prueba.netlify.app"
GOOD = {"Host": f"127.0.0.1:{PORT}", "Origin": ORIGIN}


@pytest.fixture
def store(tmp_path):
    return TokenStore(tmp_path / "token.sha256")


@pytest.fixture
def pairing(store):
    return Pairing(store)


@pytest.fixture
async def client(aiohttp_client, store, pairing):
    app = create_app(Config(port=PORT, allowed_origins=["https://tracky-prueba.netlify.app"]), FakeEngine(), store, pairing)
    return await aiohttp_client(app)


async def paired_token(client, pairing):
    code = pairing.new_code()
    res = await client.post("/pair", json={"code": code}, headers=GOOD)
    assert res.status == 200
    return (await res.json())["token"]


def tone(seconds=1.0):
    t = np.arange(int(16000 * seconds)) / 16000
    return (np.sin(2 * np.pi * 440 * t) * 8000).astype(np.int16)


# --- seguridad -----------------------------------------------------------------------------------


def test_host_allowed():
    assert host_allowed("127.0.0.1:47831", 47831)
    assert host_allowed("localhost:47831", 47831)
    assert not host_allowed("evil.example:47831", 47831)
    assert not host_allowed(None, 47831)


async def test_rechaza_host_ajeno_dns_rebinding(client):
    res = await client.get("/health", headers={"Host": "attacker.example:47831", "Origin": ORIGIN})
    assert res.status == 421


async def test_rechaza_origen_ajeno(client):
    res = await client.get("/health", headers={"Host": f"127.0.0.1:{PORT}", "Origin": "https://evil.example"})
    assert res.status == 403


async def test_health_con_origen_permitido_y_cors(client):
    res = await client.get("/health", headers=GOOD)
    assert res.status == 200
    assert res.headers["Access-Control-Allow-Origin"] == ORIGIN
    body = await res.json()
    assert body["engine"] == "fake" and body["paired"] is False


async def test_preflight_red_privada(client):
    res = await client.options(
        "/pair",
        headers={**GOOD, "Access-Control-Request-Method": "POST", "Access-Control-Request-Private-Network": "true"},
    )
    assert res.status == 204
    assert res.headers["Access-Control-Allow-Private-Network"] == "true"


async def test_sin_origen_solo_health(client):
    assert (await client.get("/health", headers={"Host": f"127.0.0.1:{PORT}"})).status == 200
    assert (await client.post("/pair", json={"code": "1"}, headers={"Host": f"127.0.0.1:{PORT}"})).status == 403


async def test_emparejamiento_codigo_incorrecto_y_limite(client, pairing, store):
    pairing.new_code()
    for _ in range(5):
        res = await client.post("/pair", json={"code": "000000x"}, headers=GOOD)
        assert res.status == 401
    assert pairing.code is None  # se agotaron los intentos
    assert not store.is_paired()


def test_codigo_vence(store):
    t = [0.0]
    p = Pairing(store, now=lambda: t[0])
    code = p.new_code()
    t[0] = 121
    assert p.try_pair(code) is None


def test_token_se_guarda_como_hash(store, pairing):
    token = pairing.try_pair(pairing.new_code())
    assert token and store.verify(token)
    assert token not in store.path.read_text()
    if os.name != "nt":  # en Windows protege la ACL del perfil; no hay permisos POSIX
        assert oct(store.path.stat().st_mode & 0o777) == "0o600"


# --- transcripción -------------------------------------------------------------------------------


def test_frame_roundtrip():
    pcm = tone(0.5)
    seq, ch, start, audio, echo = decode_frame(encode_frame(7, 1, 123456, pcm))
    assert (seq, ch, start, echo) == (7, 1, 123456, 0.0)
    assert len(audio) == len(pcm)
    assert abs(decode_frame(encode_frame(1, 0, 0, pcm, echo=0.8))[4] - 0.8) < 0.01


def test_frame_invalido():
    with pytest.raises(ValueError):
        decode_frame(encode_frame(1, 2, 0, tone(0.1)))


async def test_ws_sin_token_se_cierra(client):
    ws = await client.ws_connect("/transcribe", headers=GOOD)
    await ws.send_json({"type": "hello", "token": "malo"})
    msg = await ws.receive_json()
    assert msg["code"] == "unauthorized"


async def test_ws_flujo_completo(client, pairing):
    token = await paired_token(client, pairing)
    ws = await client.ws_connect("/transcribe", headers=GOOD)
    await ws.send_json({"type": "hello", "token": token, "meetingId": "m1", "vocabulary": ["TECgpt"]})
    assert (await ws.receive_json())["type"] == "ready"

    await ws.send_bytes(encode_frame(1, 0, 0, tone(1)))
    await ws.send_bytes(encode_frame(2, 1, 1000, tone(1)))
    await ws.send_bytes(encode_frame(1, 0, 0, tone(1)))  # duplicado (reenvío tras reconexión)
    await ws.send_json({"type": "flush"})

    msgs = []
    while True:
        m = await ws.receive_json()
        msgs.append(m)
        if m["type"] == "drained":
            break
    segments = [m for m in msgs if m["type"] == "segment"]
    assert [(s["seq"], s["channel"], s["startMs"]) for s in segments] == [(1, 0, 0), (2, 1, 1000)]
    assert any(m.get("duplicate") for m in msgs if m["type"] == "chunk_done")
    await ws.close()


# --- filtros -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,keep",
    [
        ("Revisemos el avance del TECbot Académico.", True),
        ("Gracias por ver el video.", False),
        ("Subtítulos realizados por la comunidad de Amara.org", False),
        ("sí sí sí sí sí sí sí sí sí sí", False),
        ("", False),
    ],
)
def test_filtro_alucinaciones(text, keep):
    assert keep_segment(text) is keep


def test_filtro_silencio():
    assert not keep_segment("hola", no_speech_prob=0.9, avg_logprob=-1.5)


def test_save_origin_writes_config(tmp_path):
    from tracky_bridge.config import load_config, save_origin

    path = tmp_path / "config.toml"
    path.write_text('engine = "mlx-whisper"\nallowed_origins = ["https://vieja.netlify.app"]\n')
    save_origin("https://mi-tracky.netlify.app/", path)
    cfg = load_config(path)
    assert cfg.allowed_origins == ["https://mi-tracky.netlify.app"]
    assert cfg.engine == "mlx-whisper"


def test_save_origin_rejects_paths_and_plain_http(tmp_path):
    import pytest

    from tracky_bridge.config import save_origin

    with pytest.raises(ValueError):
        save_origin("https://mi-tracky.netlify.app/app", tmp_path / "c.toml")
    with pytest.raises(ValueError):
        save_origin("http://mi-tracky.netlify.app", tmp_path / "c.toml")


def test_no_default_origin():
    assert Config().origins() == set()
