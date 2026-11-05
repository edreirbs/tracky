"""Servidor HTTP/WebSocket del puente (contracts/local-whisper-bridge.md)."""

from __future__ import annotations

import asyncio
import json
import struct
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import numpy as np
from aiohttp import WSMsgType, web

from . import __version__
from .config import Config
from .engines import SAMPLE_RATE, Engine, Segment
from .filters import RecentFilter, clean_segment
from .speakers import SELF, Diarizer, enroll_embedding
from .security import Pairing, TokenStore, host_allowed, origin_allowed
from .system_audio import AudioSource

HEADER = struct.Struct("<IBB2xQ")  # seq u32 | canal u8 | eco u8 (0–255) | 2 reservados | startMs u64
ECHO_DROP = 0.55  # con huella: descartar del micrófono lo que no es la persona usuaria y es eco de las bocinas
ECHO_DROP_NO_VOICEPRINT = 0.75  # sin huella: solo eco muy claro
MAX_ENROLL_S = 90
MAX_CHUNK_S = 30
LAG_WARN_S = 15.0

CFG = web.AppKey("cfg", Config)
ENGINE = web.AppKey("engine", object)
STORE = web.AppKey("store", TokenStore)
PAIRING = web.AppKey("pairing", Pairing)
LOCK = web.AppKey("lock", asyncio.Lock)
SYSTEM_AUDIO = web.AppKey("system_audio", object)  # Callable[[], AudioSource] | None
SYSTEM_AUDIO_LOCK = web.AppKey("system_audio_lock", asyncio.Lock)
DIARIZER = web.AppKey("diarizer", object)  # Diarizer | None
CALLS = web.AppKey("calls", object)  # Callable[[], Awaitable[list[str] | None]] | None


def decode_frame(data: bytes) -> tuple[int, int, int, np.ndarray, float]:
    """Devuelve (seq, canal, startMs, pcm, eco). `eco` (0–1) es cuánto se parece el fragmento del
    micrófono al audio de las bocinas en ese momento (lo calcula la página; 0 = desconocido)."""
    if len(data) < HEADER.size + 2:
        raise ValueError("frame demasiado corto")
    seq, channel, echo, start_ms = HEADER.unpack_from(data)
    if channel not in (0, 1):
        raise ValueError("canal inválido")
    pcm = np.frombuffer(data, dtype="<i2", offset=HEADER.size).astype(np.float32) / 32768.0
    if len(pcm) > MAX_CHUNK_S * SAMPLE_RATE:
        raise ValueError("fragmento demasiado largo")
    return seq, channel, start_ms, pcm, echo / 255.0


def encode_frame(seq: int, channel: int, start_ms: int, pcm_int16: np.ndarray, echo: float = 0.0) -> bytes:
    return HEADER.pack(seq, channel, round(max(0.0, min(1.0, echo)) * 255), start_ms) + pcm_int16.astype("<i2").tobytes()


def _cors_headers(origin: str) -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin",
    }


@web.middleware
async def security_middleware(request: web.Request, handler):
    cfg = request.app[CFG]
    if not host_allowed(request.headers.get("Host"), cfg.port):
        return web.json_response({"error": "host_not_allowed"}, status=421)
    origin = request.headers.get("Origin")
    if origin is None:
        # Sin Origin solo puede ser un cliente local no-navegador (curl): solo /health.
        if request.path != "/health":
            return web.json_response({"error": "origin_required"}, status=403)
        return await handler(request)
    if not origin_allowed(origin, cfg.origins()):
        return web.json_response({"error": "origin_not_allowed"}, status=403)
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=_cors_headers(origin))
    response = await handler(request)
    if not isinstance(response, web.WebSocketResponse):
        response.headers.update(_cors_headers(origin))
    return response


async def health(request: web.Request) -> web.Response:
    cfg = request.app[CFG]
    engine: Engine = request.app[ENGINE]  # type: ignore[assignment]
    return web.json_response(
        {
            "status": "ok",
            "bridgeVersion": __version__,
            "engine": engine.name,
            "model": engine.model,
            "device": engine.device,
            "language": cfg.language,
            "paired": request.app[STORE].is_paired(),
            "systemAudio": request.app[SYSTEM_AUDIO] is not None,
            "speakers": request.app[DIARIZER] is not None,
            "voiceprint": bool(request.app[DIARIZER] and request.app[DIARIZER].me is not None),  # type: ignore[union-attr]
        }
    )


async def pair(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        code = str(body["code"])
    except Exception:
        return web.json_response({"error": "bad_request"}, status=400)
    token = request.app[PAIRING].try_pair(code)
    if token is None:
        return web.json_response({"error": "invalid_or_expired_code"}, status=401)
    print("✓ Emparejado con la app.", flush=True)
    return web.json_response({"token": token})


def _auth_ok(request: web.Request, token: str | None) -> bool:
    return request.app[STORE].verify(token)


@dataclass
class Session:
    meeting_id: str = ""
    language: str = "es"
    prompt: str | None = None
    vocabulary: list[str] = field(default_factory=list)
    seen: set[int] = field(default_factory=set)
    recent: RecentFilter = field(default_factory=RecentFilter)
    queued_s: float = 0.0
    diarize: set[int] = field(default_factory=set)
    mode: str = "online"


async def transcribe_ws(request: web.Request) -> web.StreamResponse:
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=(MAX_CHUNK_S * SAMPLE_RATE * 2) + 1024)
    await ws.prepare(request)
    cfg = request.app[CFG]
    engine: Engine = request.app[ENGINE]  # type: ignore[assignment]
    lock = request.app[LOCK]
    loop = asyncio.get_running_loop()
    session = Session(language=cfg.language)
    queue: asyncio.Queue[tuple[int, int, int, np.ndarray, float] | None] = asyncio.Queue()

    # 1) El primer mensaje debe ser "hello" con el token (no va en la URL).
    try:
        first = await ws.receive(timeout=10)
        hello = json.loads(first.data) if first.type == WSMsgType.TEXT else {}
    except Exception:
        hello = {}
    if hello.get("type") != "hello" or not _auth_ok(request, hello.get("token")):
        await ws.send_json({"type": "error", "code": "unauthorized", "retryable": False})
        await ws.close(code=4401)
        return ws
    session.meeting_id = str(hello.get("meetingId", ""))[:64]
    session.language = str(hello.get("language", cfg.language))[:8]
    vocab = [str(v)[:60] for v in hello.get("vocabulary", [])][:40]
    # Prompt corto: solo unos términos clave. Un prompt largo hace que Whisper lo "transcriba"
    # en los silencios (eco). Además, el filtro quita cualquier eco que se cuele.
    session.vocabulary = vocab
    session.prompt = (", ".join(vocab[:6]) + ".") if vocab else None
    # Canales donde distinguir voces: en línea el de "Otros" (1); en persona el micrófono (0).
    session.diarize = {c for c in hello.get("diarizeChannels", []) if c in (0, 1)}
    session.mode = "in_person" if hello.get("mode") == "in_person" else "online"
    diarizer: Diarizer | None = request.app[DIARIZER]  # type: ignore[assignment]
    await ws.send_json({"type": "ready"})

    async def worker() -> None:
        while True:
            item = await queue.get()
            if item is None:
                await ws.send_json({"type": "drained"})
                queue.task_done()
                continue
            seq, channel, start_ms, pcm, echo = item
            try:
                async with lock:  # un solo modelo en memoria: un fragmento a la vez
                    segments = await loop.run_in_executor(None, engine.transcribe, pcm, session.language, session.prompt)
                # 1) Limpieza de alucinaciones; 2) voces solo de lo que se conserva.
                kept: list[tuple[Segment, str]] = []
                for s in segments:
                    text = clean_segment(
                        s.text,
                        no_speech_prob=s.no_speech_prob,
                        avg_logprob=s.avg_logprob,
                        compression_ratio=s.compression_ratio,
                        language=session.language,
                        vocabulary=session.vocabulary,
                    )
                    if text is not None and not session.recent.is_duplicate(channel, text):
                        kept.append((s, text))
                online_mic = session.mode == "online" and channel == 0
                has_me = bool(diarizer and diarizer.me is not None)
                speakers: list[int | None] = [None] * len(kept)
                # En línea, el micrófono solo se separa por voces si hay huella de "Yo" (si no, todo es "Yo").
                if diarizer and channel in session.diarize and kept and (has_me or not online_mic):
                    allow_self = not (session.mode == "online" and channel == 1)  # Teams no te devuelve tu voz

                    def label_all(items=kept, audio=pcm, ch=channel, me_ok=allow_self) -> list[int | None]:
                        return [
                            diarizer.speaker_for(
                                session.meeting_id,
                                ch,
                                audio[int(seg.start * SAMPLE_RATE) : int(seg.end * SAMPLE_RATE)],
                                me_ok,
                            )
                            for seg, _ in items
                        ]

                    async with lock:
                        speakers = await loop.run_in_executor(None, label_all)
                pairs = list(zip(kept, speakers))
                if online_mic:
                    # Eco de las bocinas en el micrófono: fuera, salvo que sea la voz de la persona usuaria (ADR-0011).
                    if has_me:
                        pairs = [p for p in pairs if not (echo >= ECHO_DROP and p[1] != SELF)]
                    elif echo >= ECHO_DROP_NO_VOICEPRINT:
                        pairs = []
                kept = [p[0] for p in pairs]
                for (s, text), speaker in pairs:
                    await ws.send_json(
                        {
                            "type": "segment",
                            "seq": seq,
                            "channel": channel,
                            "startMs": start_ms + int(s.start * 1000),
                            "endMs": start_ms + int(min(s.end, len(pcm) / SAMPLE_RATE) * 1000),
                            "text": text,
                            "avgLogprob": round(s.avg_logprob, 3),
                            "noSpeechProb": round(s.no_speech_prob, 3),
                            **({"speaker": speaker} if speaker is not None else {}),
                        }
                    )
                await ws.send_json({"type": "chunk_done", "seq": seq})
                # Bitácora sin contenido: solo tamaños y conteos.
                print(f"· fragmento {seq} canal {channel}: {len(pcm) / SAMPLE_RATE:.1f}s → {len(kept)}/{len(segments)} segmentos", flush=True)
            except ConnectionResetError:
                return
            except Exception as exc:  # noqa: BLE001
                await ws.send_json({"type": "error", "code": "transcription_failed", "seq": seq, "retryable": True})
                print(f"! Error transcribiendo fragmento {seq}: {type(exc).__name__}", flush=True)
            finally:
                session.queued_s = max(0.0, session.queued_s - len(pcm) / SAMPLE_RATE)
                queue.task_done()

    task = asyncio.create_task(worker())
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                try:
                    seq, channel, start_ms, pcm, echo = decode_frame(msg.data)
                except ValueError as exc:
                    await ws.send_json({"type": "error", "code": "bad_frame", "detail": str(exc), "retryable": False})
                    continue
                if seq in session.seen:
                    await ws.send_json({"type": "chunk_done", "seq": seq, "duplicate": True})
                    continue
                session.seen.add(seq)
                session.queued_s += len(pcm) / SAMPLE_RATE
                if session.queued_s > LAG_WARN_S:
                    await ws.send_json({"type": "lag", "queuedSec": round(session.queued_s, 1)})
                await queue.put((seq, channel, start_ms, pcm, echo))
            elif msg.type == WSMsgType.TEXT:
                data = json.loads(msg.data)
                if data.get("type") == "flush":
                    await queue.put(None)
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        task.cancel()
    return ws


async def _options(_request: web.Request) -> web.Response:
    return web.Response(status=204)  # el middleware ya respondió el preflight permitido


def _bearer(request: web.Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    return auth[7:] if auth.startswith("Bearer ") else None


async def voice_enroll(request: web.Request) -> web.Response:
    """Registra la huella de voz de la persona usuaria a partir de PCM16 LE 16 kHz mono (20–90 s leyendo un texto).

    El audio solo se usa en memoria para calcular la huella (256 números) y se descarta.
    """
    if not _auth_ok(request, _bearer(request)):
        return web.json_response({"error": "unauthorized"}, status=401)
    diarizer: Diarizer | None = request.app[DIARIZER]  # type: ignore[assignment]
    if diarizer is None:
        return web.json_response({"error": "speakers_unavailable"}, status=503)
    body = await request.read()
    pcm = np.frombuffer(body[: len(body) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
    if not 15 * SAMPLE_RATE <= len(pcm) <= MAX_ENROLL_S * SAMPLE_RATE:
        return web.json_response({"error": "bad_length"}, status=400)
    async with request.app[LOCK]:
        vec = await asyncio.get_running_loop().run_in_executor(None, enroll_embedding, diarizer.embedder, pcm)
    if vec is None:
        return web.json_response({"error": "not_enough_voice"}, status=422)
    diarizer.set_voiceprint(vec)
    print("✓ Huella de voz registrada.", flush=True)
    return web.json_response({"ok": True})


async def calls(request: web.Request) -> web.Response:
    """Apps de videollamada con el micrófono abierto (Teams, Zoom…): la página detecta el fin de la junta."""
    if not _auth_ok(request, _bearer(request)):
        return web.json_response({"error": "unauthorized"}, status=401)
    watcher = request.app[CALLS]
    apps = await watcher() if watcher else None  # type: ignore[operator]
    return web.json_response({"supported": apps is not None, "apps": apps or []})


async def voice_delete(request: web.Request) -> web.Response:
    if not _auth_ok(request, _bearer(request)):
        return web.json_response({"error": "unauthorized"}, status=401)
    diarizer: Diarizer | None = request.app[DIARIZER]  # type: ignore[assignment]
    if diarizer:
        diarizer.set_voiceprint(None)
    print("✓ Huella de voz borrada.", flush=True)
    return web.json_response({"ok": True})


async def system_audio_ws(request: web.Request) -> web.StreamResponse:
    """Envía a la página el audio del sistema (PCM16 16 kHz mono, bloques de 100 ms).

    El audio solo viaja por 127.0.0.1 hacia la página, que lo trata como el canal "Otros" y lo
    devuelve en fragmentos por /transcribe. Nunca se escribe a disco.
    """
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=64 * 1024)
    await ws.prepare(request)
    try:
        first = await ws.receive(timeout=10)
        hello = json.loads(first.data) if first.type == WSMsgType.TEXT else {}
    except Exception:
        hello = {}
    if hello.get("type") != "hello" or not _auth_ok(request, hello.get("token")):
        await ws.send_json({"type": "error", "code": "unauthorized", "retryable": False})
        await ws.close(code=4401)
        return ws
    factory = request.app[SYSTEM_AUDIO]
    lock = request.app[SYSTEM_AUDIO_LOCK]
    if factory is None:
        await ws.send_json({"type": "error", "code": "unavailable", "retryable": False})
        await ws.close()
        return ws
    if lock.locked():
        await ws.send_json({"type": "error", "code": "busy", "retryable": False})
        await ws.close()
        return ws

    async with lock:
        source: AudioSource = factory()  # type: ignore[operator]
        try:
            await source.start()
        except Exception as exc:  # noqa: BLE001
            print(f"! No se pudo iniciar la captura del audio del sistema: {type(exc).__name__}", flush=True)
            await ws.send_json({"type": "error", "code": "capture_failed", "retryable": False})
            await ws.close()
            return ws
        await ws.send_json({"type": "ready", "sampleRate": SAMPLE_RATE})
        print("· audio del sistema: captura iniciada", flush=True)
        sent = 0

        async def pump() -> None:
            nonlocal sent
            while True:
                block = await source.read_block()
                if block is None:
                    code = source.failure() or "capture_ended"
                    print(f"! audio del sistema: la captura terminó ({code})", flush=True)
                    await ws.send_json({"type": "error", "code": code, "retryable": False})
                    await ws.close()
                    return
                pcm = (np.clip(block, -1.0, 1.0) * 32767).astype("<i2")
                await ws.send_bytes(pcm.tobytes())
                sent += len(pcm)

        task = asyncio.create_task(pump())
        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT and json.loads(msg.data).get("type") == "stop":
                    break
                if msg.type == WSMsgType.ERROR:
                    break
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await source.stop()
            if not ws.closed:
                await ws.close()
            print(f"· audio del sistema: captura detenida ({sent / SAMPLE_RATE:.0f}s)", flush=True)
    return ws


def create_app(
    cfg: Config,
    engine: Engine,
    store: TokenStore,
    pairing: Pairing,
    system_audio: Callable[[], AudioSource] | None = None,
    diarizer: Diarizer | None = None,
    call_watcher: Callable[[], Awaitable[list[str] | None]] | None = None,
) -> web.Application:
    # Cuerpo máximo: el registro de voz (≤ 90 s de PCM16 a 16 kHz ≈ 2.9 MB); el resto son JSON pequeños.
    app = web.Application(middlewares=[security_middleware], client_max_size=(MAX_ENROLL_S * SAMPLE_RATE * 2) + 4096)
    app[CFG] = cfg
    app[ENGINE] = engine
    app[STORE] = store
    app[PAIRING] = pairing
    app[LOCK] = asyncio.Lock()
    app[SYSTEM_AUDIO] = system_audio
    app[DIARIZER] = diarizer
    app[CALLS] = call_watcher
    app[SYSTEM_AUDIO_LOCK] = asyncio.Lock()
    app.router.add_get("/health", health)
    app.router.add_post("/pair", pair)
    app.router.add_route("OPTIONS", "/{tail:.*}", _options)
    app.router.add_get("/transcribe", transcribe_ws)
    app.router.add_get("/system-audio", system_audio_ws)
    app.router.add_post("/voice", voice_enroll)
    app.router.add_delete("/voice", voice_delete)
    app.router.add_get("/calls", calls)
    return app
