"""Symmetric encryption for API keys at rest (Fernet)."""
from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken

from . import config

_fernet: Fernet | None = None


def _load_key() -> bytes:
    env_key = os.getenv("GOT_SECRET_KEY")
    if env_key:
        return env_key.encode()
    config.ensure_dirs()
    if config.SECRET_KEY_FILE.exists():
        return config.SECRET_KEY_FILE.read_bytes().strip()
    key = Fernet.generate_key()
    config.SECRET_KEY_FILE.write_bytes(key)
    return key


def fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_load_key())
    return _fernet


def encrypt(plain: str) -> str:
    return fernet().encrypt(plain.encode()).decode()


def decrypt(cipher: str) -> str:
    try:
        return fernet().decrypt(cipher.encode()).decode()
    except InvalidToken as exc:  # key rotated / storage copied without secret
        raise ValueError("Stored API key cannot be decrypted with the current secret key") from exc


def mask(secret: str) -> str:
    s = secret.strip()
    if len(s) <= 8:
        return "•" * len(s)
    return f"{s[:4]}…{s[-4:]}"
