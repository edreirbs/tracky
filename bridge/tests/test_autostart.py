import asyncio
import plistlib
from pathlib import Path, PurePosixPath

from tracky_bridge import autostart
from tracky_bridge.cli import _serve_until_paired
from tracky_bridge.security import TokenStore


def test_launchd_plist():
    data = plistlib.loads(autostart.render_launchd("/u/bin/tracky-bridge", Path("/u/log")))
    assert data["Label"] == "app.tracky.tracky-bridge"
    assert data["ProgramArguments"] == ["/u/bin/tracky-bridge"]
    assert data["RunAtLoad"] and data["KeepAlive"]


def test_systemd_unit():
    unit = autostart.render_systemd("/home/a/.local/bin/tracky-bridge", PurePosixPath("/home/a/.config/tracky-bridge/logs/bridge.log"))
    assert 'ExecStart="/home/a/.local/bin/tracky-bridge"' in unit
    assert "WantedBy=default.target" in unit
    assert "StandardOutput=append:/home/a/.config/tracky-bridge/logs/bridge.log" in unit


def test_windows_startup_script_runs_hidden_with_log():
    vbs = autostart.render_windows_vbs(r"C:\Users\Ana\.local\bin\tracky-bridge.exe", Path(r"C:\Users\Ana\.config\tracky-bridge\logs\bridge.log"))
    assert vbs.startswith('CreateObject("Wscript.Shell").Run "cmd /c ""C:\\Users\\Ana\\.local\\bin\\tracky-bridge.exe""')
    assert '>> ""' in vbs and vbs.rstrip().endswith(", 0, False")


def test_xdg_desktop():
    assert 'Exec="/x/tracky-bridge"' in autostart.render_xdg_desktop("/x/tracky-bridge")


async def test_serve_until_paired_stops_when_token_changes(tmp_path, unused_tcp_port):
    from aiohttp import web

    store = TokenStore(tmp_path / "token.sha256")
    app = web.Application()

    async def pair_later():
        await asyncio.sleep(1.2)
        store.save("nuevo-token")

    asyncio.get_running_loop().create_task(pair_later())
    assert await _serve_until_paired(app, unused_tcp_port, store, 5) is True


async def test_serve_until_paired_times_out(tmp_path, unused_tcp_port):
    from aiohttp import web

    store = TokenStore(tmp_path / "token.sha256")
    assert await _serve_until_paired(web.Application(), unused_tcp_port, store, 1) is False
