import stat
import sys

import numpy as np
import pytest

from tracky_bridge.config import Config
from tracky_bridge.engines.fake import FakeEngine
from tracky_bridge.security import Pairing, TokenStore
from tracky_bridge.server import create_app
from tracky_bridge.system_audio import BLOCK, FakeSource, HelperSource, check, source_factory

# La captura nativa del audio del sistema es solo de macOS (tracky-audiotap). Estas pruebas simulan el
# ayudante con un script ejecutable de Unix; en Windows el audio de los demás se comparte desde el navegador
# (ADR-0012) y se prueba abajo que el puente lo reporte como no disponible.
unix_helper = pytest.mark.skipif(sys.platform == "win32", reason="el ayudante simulado es un ejecutable de Unix")

PORT = 47831
GOOD = {"Host": f"127.0.0.1:{PORT}", "Origin": "https://tracky-prueba.netlify.app"}


@pytest.fixture
def store(tmp_path):
    return TokenStore(tmp_path / "token.sha256")


async def make_client(aiohttp_client, store, factory):
    pairing = Pairing(store)
    app = create_app(Config(port=PORT, allowed_origins=["https://tracky-prueba.netlify.app"]), FakeEngine(), store, pairing, factory)
    client = await aiohttp_client(app)
    res = await client.post("/pair", json={"code": pairing.new_code()}, headers=GOOD)
    return client, (await res.json())["token"]


async def test_health_indica_audio_del_sistema(aiohttp_client, store):
    client, _ = await make_client(aiohttp_client, store, lambda: FakeSource(realtime=False))
    assert (await (await client.get("/health", headers=GOOD)).json())["systemAudio"] is True
    client2, _ = await make_client(aiohttp_client, store, None)
    assert (await (await client2.get("/health", headers=GOOD)).json())["systemAudio"] is False


async def test_requiere_token(aiohttp_client, store):
    client, _ = await make_client(aiohttp_client, store, lambda: FakeSource(realtime=False))
    ws = await client.ws_connect("/system-audio", headers=GOOD)
    await ws.send_json({"type": "hello", "token": "malo"})
    assert (await ws.receive_json())["code"] == "unauthorized"


async def test_no_disponible(aiohttp_client, store):
    client, token = await make_client(aiohttp_client, store, None)
    ws = await client.ws_connect("/system-audio", headers=GOOD)
    await ws.send_json({"type": "hello", "token": token})
    assert (await ws.receive_json())["code"] == "unavailable"


async def test_envia_bloques_pcm16_y_se_detiene(aiohttp_client, store):
    client, token = await make_client(aiohttp_client, store, lambda: FakeSource(realtime=False, blocks=5))
    ws = await client.ws_connect("/system-audio", headers=GOOD)
    await ws.send_json({"type": "hello", "token": token})
    assert (await ws.receive_json())["type"] == "ready"
    blocks = [await ws.receive_bytes() for _ in range(5)]
    assert all(len(b) == BLOCK * 2 for b in blocks)
    assert np.abs(np.frombuffer(blocks[1], dtype="<i2")).max() > 5000
    end = await ws.receive_json()
    assert end["type"] == "error" and end["code"] == "capture_ended"


async def test_una_captura_a_la_vez(aiohttp_client, store):
    client, token = await make_client(aiohttp_client, store, lambda: FakeSource(realtime=True))
    ws1 = await client.ws_connect("/system-audio", headers=GOOD)
    await ws1.send_json({"type": "hello", "token": token})
    assert (await ws1.receive_json())["type"] == "ready"
    ws2 = await client.ws_connect("/system-audio", headers=GOOD)
    await ws2.send_json({"type": "hello", "token": token})
    assert (await ws2.receive_json())["code"] == "busy"
    await ws1.send_json({"type": "stop"})
    await ws1.close()


def fake_helper(tmp_path, body):
    path = tmp_path / "tracky-audiotap"
    path.write_text(f"#!{sys.executable}\nimport sys, struct\n{body}\n")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path


@unix_helper
async def test_helper_lee_tuberia(tmp_path):
    path = fake_helper(tmp_path, f"sys.stdout.buffer.write(struct.pack('<{BLOCK * 2}f', *([0.5] * {BLOCK * 2}))); sys.stdout.flush()")
    peak, failure = await check(lambda: HelperSource(path), seconds=0.2)
    assert failure is None and abs(peak - 0.5) < 1e-6


@unix_helper
async def test_helper_reporta_error(tmp_path):
    path = fake_helper(tmp_path, "sys.stderr.write('error: tap_create -1\\n'); sys.exit(1)")
    peak, failure = await check(lambda: HelperSource(path), seconds=0.5)
    assert failure == "tap_create" and peak == 0.0


@unix_helper
async def test_helper_se_detiene_al_cerrar_stdin(tmp_path):
    path = fake_helper(tmp_path, "sys.stdin.read()")
    source = HelperSource(path)
    await source.start()
    await source.stop()
    assert source.proc is not None and source.proc.returncode == 0


def test_factory(tmp_path):
    assert source_factory("off") is None
    assert source_factory("fake") is FakeSource
    assert source_factory(str(tmp_path / "no-existe")) is None
    helper = fake_helper(tmp_path, "")
    assert isinstance(source_factory(str(helper))(), HelperSource)  # type: ignore[misc]


@unix_helper
async def test_check_no_se_cuelga_sin_audio(tmp_path, monkeypatch):
    import tracky_bridge.system_audio as sa

    path = fake_helper(tmp_path, "import time; time.sleep(30)")
    real_wait_for = sa.asyncio.wait_for
    monkeypatch.setattr(sa.asyncio, "wait_for", lambda aw, timeout: real_wait_for(aw, min(timeout, 0.3)))
    peak, failure = await check(lambda: HelperSource(path), seconds=1)
    assert failure == "no_data" and peak == 0.0


def test_apps_de_llamada():
    from tracky_bridge.system_audio import call_apps_from

    ids = ["com.google.Chrome", "com.microsoft.teams2", "us.zoom.xos", "com.microsoft.teams2.helper"]
    assert call_apps_from(ids) == ["Teams", "Zoom"]
    assert call_apps_from(["com.google.Chrome"]) == []


@unix_helper
async def test_endpoint_calls(aiohttp_client, store, tmp_path):
    from tracky_bridge.system_audio import call_watcher

    helper = fake_helper(tmp_path, "import json; print(json.dumps({'input': ['com.microsoft.teams2', 'com.google.Chrome']}))")
    pairing = Pairing(store)
    app = create_app(Config(port=PORT, allowed_origins=["https://tracky-prueba.netlify.app"]), FakeEngine(), store, pairing, None, None, call_watcher(str(helper)))
    client = await aiohttp_client(app)
    token = (await (await client.post("/pair", json={"code": pairing.new_code()}, headers=GOOD)).json())["token"]
    assert (await client.get("/calls", headers=GOOD)).status == 401
    body = await (await client.get("/calls", headers={**GOOD, "Authorization": f"Bearer {token}"})).json()
    assert body == {"supported": True, "apps": ["Teams"]}

    app2 = create_app(Config(port=PORT, allowed_origins=["https://tracky-prueba.netlify.app"]), FakeEngine(), store, pairing, None, None, None)
    client2 = await aiohttp_client(app2)
    body2 = await (await client2.get("/calls", headers={**GOOD, "Authorization": f"Bearer {token}"})).json()
    assert body2 == {"supported": False, "apps": []}


def test_fuera_de_macos_no_hay_captura_nativa(monkeypatch):
    from tracky_bridge import system_audio

    monkeypatch.setattr(system_audio.sys, "platform", "win32")
    assert source_factory("auto") is None
    assert system_audio.call_watcher("auto") is None
