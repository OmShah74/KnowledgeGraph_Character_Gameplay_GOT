"""Snapshots, archives and the guarded "Restart Westeros" flow.

Guarantees
* `initial.db` is captured once, right after the first successful bootstrap, and never modified.
* Every destructive operation (reset, restore) first archives the *current* database to
  storage/archives/. Archives are never deleted automatically, so no data is ever lost.
* Reset/restore require a two-step confirmation: a short-lived token from `prepare_reset`
  plus the exact confirmation phrase.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config, db

CONFIRM_PHRASE = "RESTART WESTEROS"
TOKEN_TTL = 180  # seconds
PRESERVED_TABLES = ("api_keys", "settings")

_lock = threading.RLock()
_tokens: dict[str, dict[str, Any]] = {}
maintenance = threading.Event()  # set while a reset/restore is running


def snapshot_dir() -> Path:
    p = config.STORAGE_DIR / "snapshots"
    p.mkdir(parents=True, exist_ok=True)
    return p


def archive_dir() -> Path:
    p = config.STORAGE_DIR / "archives"
    p.mkdir(parents=True, exist_ok=True)
    return p


def initial_path() -> Path:
    return snapshot_dir() / "initial.db"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _copy_live_to(dest: Path) -> None:
    """Consistent online copy of the live DB using SQLite's backup API."""
    src = db.connect()
    try:
        dst = sqlite3.connect(str(dest))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def _write_manifest(path: Path, kind: str, note: str = "") -> dict[str, Any]:
    meta = {"file": path.name, "kind": kind, "note": note, "bytes": path.stat().st_size, "sha256": _sha256(path),
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    path.with_suffix(".json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def ensure_initial_snapshot() -> dict[str, Any] | None:
    """Capture the pristine world exactly once."""
    p = initial_path()
    if p.exists():
        return None
    with _lock:
        tmp = p.with_suffix(".tmp")
        _copy_live_to(tmp)
        # The initial snapshot must not carry secrets or player data.
        conn = sqlite3.connect(str(tmp))
        try:
            for t in ("api_keys", "llm_calls", "jobs"):
                conn.execute(f"DELETE FROM {t}")
            conn.commit()
            conn.execute("VACUUM")
        finally:
            conn.close()
        tmp.replace(p)
        return _write_manifest(p, "initial", "Pristine world captured after first bootstrap")


def archive_current(reason: str) -> dict[str, Any]:
    with _lock:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in reason)[:40]
        dest = archive_dir() / f"{safe}-{ts}.db"
        _copy_live_to(dest)
        return _write_manifest(dest, "archive", reason)


def list_snapshots() -> dict[str, Any]:
    def read(folder: Path) -> list[dict[str, Any]]:
        out = []
        for f in sorted(folder.glob("*.db"), reverse=True):
            mf = f.with_suffix(".json")
            meta = json.loads(mf.read_text(encoding="utf-8")) if mf.exists() else {"file": f.name, "bytes": f.stat().st_size}
            out.append(meta)
        return out

    return {"initial": read(snapshot_dir()), "archives": read(archive_dir())}


def _counts(conn: sqlite3.Connection) -> dict[str, int]:
    out = {}
    for t in ("players", "threads", "messages", "memories", "facts", "plot_threads", "wiki_pages", "kg_nodes", "kg_edges"):
        out[t] = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    out["player_memories"] = conn.execute("SELECT COUNT(*) FROM memories WHERE player_id IS NOT NULL").fetchone()[0]
    return out


# ------------------------------------------------------------------ guarded flows
def prepare(action: str, target: str | None = None) -> dict[str, Any]:
    if action not in ("reset_all", "restore_archive", "reset_player"):
        raise ValueError("Unknown action")
    if action == "reset_all" and not initial_path().exists():
        raise ValueError("No initial snapshot exists yet")
    if action == "restore_archive":
        if not target or not (archive_dir() / target).exists() or "/" in target or "\\" in target:
            raise ValueError("Archive not found")
    _purge_tokens()
    token = secrets.token_urlsafe(16)
    with db.db() as conn:
        summary = _counts(conn)
        if action == "reset_player":
            if not conn.execute("SELECT 1 FROM players WHERE id=?", (target,)).fetchone():
                raise ValueError("Player not found")
            summary = {
                "threads": conn.execute("SELECT COUNT(*) FROM threads WHERE player_id=?", (target,)).fetchone()[0],
                "memories": conn.execute("SELECT COUNT(*) FROM memories WHERE player_id=?", (target,)).fetchone()[0],
                "facts": conn.execute("SELECT COUNT(*) FROM facts WHERE player_id=?", (target,)).fetchone()[0],
            }
    _tokens[token] = {"action": action, "target": target, "expires": time.time() + TOKEN_TTL}
    return {"token": token, "expires_in": TOKEN_TTL, "confirm_phrase": CONFIRM_PHRASE, "action": action,
            "target": target, "will_be_archived_first": True, "current": summary}


def _purge_tokens() -> None:
    now = time.time()
    for k in [k for k, v in _tokens.items() if v["expires"] < now]:
        _tokens.pop(k, None)


def _consume(token: str, phrase: str, action: str) -> dict[str, Any]:
    _purge_tokens()
    t = _tokens.pop(token, None)
    if not t or t["action"] != action:
        raise PermissionError("Confirmation token is invalid or expired. Start again.")
    if phrase.strip() != CONFIRM_PHRASE:
        raise PermissionError(f"Type the phrase exactly: {CONFIRM_PHRASE}")
    return t


def _restore_from(path: Path, preserve: bool) -> None:
    saved: dict[str, list[tuple]] = {}
    if preserve:
        with db.db() as conn:
            for t in PRESERVED_TABLES:
                saved[t] = [tuple(r) for r in conn.execute(f"SELECT * FROM {t}").fetchall()]
    src = sqlite3.connect(str(path))
    try:
        dst = db.connect()
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    db.init_db()  # migrate schema forward if the snapshot predates new tables
    if preserve:
        with db.db() as conn:
            for t, rows in saved.items():
                if not rows:
                    continue
                conn.execute(f"DELETE FROM {t}")
                conn.executemany(f"INSERT INTO {t} VALUES ({','.join('?' * len(rows[0]))})", rows)


def _after_restore() -> dict[str, Any]:
    from .graph import store

    with db.db() as conn:
        return store.sync_to_neo4j(conn, wipe=True)


def confirm_reset_all(token: str, phrase: str, keep_api_keys: bool = True) -> dict[str, Any]:
    _consume(token, phrase, "reset_all")
    with _lock:
        maintenance.set()
        try:
            archived = archive_current("pre-reset")
            _restore_from(initial_path(), preserve=keep_api_keys)
            neo = _after_restore()
            with db.db() as conn:
                db.set_meta(conn, "last_reset_at", datetime.now(timezone.utc).isoformat(timespec="seconds"))
                counts = _counts(conn)
        finally:
            maintenance.clear()
    return {"ok": True, "archived": archived, "now": counts, "neo4j": neo, "kept_api_keys": keep_api_keys}


def confirm_restore_archive(token: str, phrase: str, keep_api_keys: bool = True) -> dict[str, Any]:
    t = _consume(token, phrase, "restore_archive")
    path = archive_dir() / t["target"]
    if not path.exists():
        raise ValueError("Archive disappeared")
    with _lock:
        maintenance.set()
        try:
            archived = archive_current("pre-restore")
            _restore_from(path, preserve=keep_api_keys)
            neo = _after_restore()
            with db.db() as conn:
                counts = _counts(conn)
        finally:
            maintenance.clear()
    return {"ok": True, "restored": t["target"], "archived": archived, "now": counts, "neo4j": neo}


def confirm_reset_player(token: str, phrase: str) -> dict[str, Any]:
    t = _consume(token, phrase, "reset_player")
    from .game import engine

    with _lock:
        archived = archive_current(f"pre-player-reset-{t['target']}")
        result = engine.reset_player_world(t["target"])
    return {"ok": True, "archived": archived, **result}
