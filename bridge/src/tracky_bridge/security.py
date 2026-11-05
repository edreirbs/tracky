"""Controles del puente: Host, Origin, emparejamiento y token (ADR-0007)."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from pathlib import Path

PAIR_CODE_TTL_S = 120
PAIR_MAX_ATTEMPTS = 5


def host_allowed(host: str | None, port: int) -> bool:
    """Protección contra DNS rebinding: solo 127.0.0.1:<puerto> o localhost:<puerto>."""
    return host in {f"127.0.0.1:{port}", f"localhost:{port}"}


def origin_allowed(origin: str | None, allowed: set[str]) -> bool:
    return origin is not None and origin in allowed


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class TokenStore:
    """Guarda solo el hash SHA-256 del token, en un archivo con permisos 0600."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def is_paired(self) -> bool:
        return self.path.exists() and self.path.read_text().strip() != ""

    def save(self, token: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(_hash(token))
        os.chmod(self.path, 0o600)

    def verify(self, token: str | None) -> bool:
        if not token or not self.is_paired():
            return False
        return hmac.compare_digest(self.path.read_text().strip(), _hash(token))

    def clear(self) -> None:
        if self.path.exists():
            self.path.unlink()


class Pairing:
    """Código de 6 dígitos de un solo uso, con vencimiento e intentos limitados."""

    def __init__(self, store: TokenStore, now=time.monotonic) -> None:
        self.store = store
        self._now = now
        self.code: str | None = None
        self._expires = 0.0
        self._attempts = 0

    def new_code(self) -> str:
        self.code = f"{secrets.randbelow(1_000_000):06d}"
        self._expires = self._now() + PAIR_CODE_TTL_S
        self._attempts = 0
        return self.code

    def try_pair(self, code: str) -> str | None:
        if self.code is None or self._now() > self._expires or self._attempts >= PAIR_MAX_ATTEMPTS:
            self.code = None
            return None
        self._attempts += 1
        if not hmac.compare_digest(self.code, code):
            if self._attempts >= PAIR_MAX_ATTEMPTS:
                self.code = None
            return None
        self.code = None
        token = secrets.token_urlsafe(32)  # 256 bits
        self.store.save(token)
        return token
