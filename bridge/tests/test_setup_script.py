import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("tracky_setup", Path(__file__).parents[2] / "scripts/setup.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def test_mac_apple_silicon_uses_mlx_by_ram():
    assert setup.choose_model("darwin", "arm64", 16, False) == ("mlx-whisper", "mlx-community/whisper-large-v3-turbo", "")
    assert setup.choose_model("darwin", "arm64", 8, False)[1] == "mlx-community/whisper-small-mlx"


def test_windows_and_linux_use_faster_whisper():
    assert setup.choose_model("win32", "amd64", 16, False) == ("faster-whisper", "small", "faster")
    assert setup.choose_model("linux", "x86_64", 32, True) == ("faster-whisper", "large-v3-turbo", "faster")
    assert setup.choose_model("darwin", "x86_64", 16, False)[0] == "faster-whisper"


def test_ram_detection_returns_a_number():
    assert setup.ram_gb() > 0
