"""API keys (multi-key, multi-provider rotation) and LLM settings."""
from __future__ import annotations

import time
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db, security
from ..llm.router import PROVIDERS, get_settings, router as llm_router, save_settings

router = APIRouter(prefix="/api/llm", tags=["llm"])

Provider = Literal["groq", "openai", "openrouter", "gemini", "custom"]


class KeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    provider: Provider
    key: str = Field(min_length=4, max_length=500)
    model: str = Field(min_length=1, max_length=200)
    base_url: str | None = Field(default=None, max_length=300)
    priority: int = 0
    enabled: bool = True


class KeyPatch(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    key: str | None = Field(default=None, max_length=500)
    model: str | None = Field(default=None, max_length=200)
    base_url: str | None = Field(default=None, max_length=300)
    priority: int | None = None
    enabled: bool | None = None
    provider: Provider | None = None


class SettingsIn(BaseModel):
    strategy: Literal["round_robin", "priority"] | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    timeout_seconds: int | None = None
    json_mode: bool | None = None
    max_attempts: int | None = None


def _public(row: dict) -> dict:
    out = {k: v for k, v in row.items() if k != "key_cipher"}
    out["enabled"] = bool(out["enabled"])
    out["cooling_down"] = (out.get("cooldown_until") or 0) > time.time()
    out["cooldown_remaining"] = max(0, int((out.get("cooldown_until") or 0) - time.time()))
    return out


@router.get("/providers")
def providers():
    return [{"id": k, **v} for k, v in PROVIDERS.items()]


@router.get("/keys")
def list_keys():
    with db.db() as conn:
        return [_public(r) for r in db.rows_to_dicts(conn.execute("SELECT * FROM api_keys ORDER BY priority DESC, created_at").fetchall())]


@router.post("/keys", status_code=201)
def add_key(body: KeyIn):
    if body.provider == "custom" and not body.base_url:
        raise HTTPException(400, "Custom providers need a base URL (OpenAI-compatible, e.g. http://localhost:11434/v1)")
    kid = db.new_id("k_")
    secret = body.key.strip()
    with db.db() as conn:
        if conn.execute("SELECT 1 FROM api_keys WHERE name=?", (body.name.strip(),)).fetchone():
            raise HTTPException(409, f"A key named '{body.name}' already exists")
        conn.execute(
            """INSERT INTO api_keys(id,name,provider,model,key_cipher,key_hint,base_url,enabled,priority,created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (kid, body.name.strip(), body.provider, body.model.strip(), security.encrypt(secret), security.mask(secret),
             (body.base_url or "").strip() or None, int(body.enabled), body.priority, db.now_iso()))
        return _public(db.row_to_dict(conn.execute("SELECT * FROM api_keys WHERE id=?", (kid,)).fetchone()))  # type: ignore[arg-type]


@router.patch("/keys/{kid}")
def update_key(kid: str, body: KeyPatch):
    with db.db() as conn:
        if not conn.execute("SELECT 1 FROM api_keys WHERE id=?", (kid,)).fetchone():
            raise HTTPException(404, "Key not found")
        sets, vals = [], []
        for f in ("name", "model", "base_url", "priority", "provider"):
            v = getattr(body, f)
            if v is not None:
                sets.append(f"{f}=?")
                vals.append(v.strip() if isinstance(v, str) else v)
        if body.enabled is not None:
            sets.append("enabled=?")
            vals.append(int(body.enabled))
        if body.key:
            sets += ["key_cipher=?", "key_hint=?", "cooldown_until=0", "consecutive_failures=0", "last_error=NULL"]
            vals += [security.encrypt(body.key.strip()), security.mask(body.key)]
        if sets:
            conn.execute(f"UPDATE api_keys SET {', '.join(sets)} WHERE id=?", (*vals, kid))
        return _public(db.row_to_dict(conn.execute("SELECT * FROM api_keys WHERE id=?", (kid,)).fetchone()))  # type: ignore[arg-type]


@router.delete("/keys/{kid}")
def delete_key(kid: str):
    with db.db() as conn:
        if not conn.execute("DELETE FROM api_keys WHERE id=?", (kid,)).rowcount:
            raise HTTPException(404, "Key not found")
    return {"deleted": kid}


@router.post("/keys/{kid}/test")
async def test_key(kid: str):
    return await llm_router.test_key(kid)


@router.post("/keys/{kid}/reset-cooldown")
def reset_cooldown(kid: str):
    with db.db() as conn:
        conn.execute("UPDATE api_keys SET cooldown_until=0, consecutive_failures=0 WHERE id=?", (kid,))
    return {"ok": True}


@router.get("/settings")
def read_settings():
    return get_settings()


@router.put("/settings")
def write_settings(body: SettingsIn):
    with db.db() as conn:
        return save_settings(conn, body.model_dump(exclude_none=True))


@router.get("/calls")
def calls(limit: int = 100):
    with db.db() as conn:
        return db.rows_to_dicts(conn.execute("SELECT * FROM llm_calls ORDER BY id DESC LIMIT ?", (min(limit, 1000),)).fetchall())


@router.get("/stats")
def stats():
    with db.db() as conn:
        per_key = db.rows_to_dicts(conn.execute(
            """SELECT key_name, provider, model, COUNT(*) calls, SUM(ok) ok, AVG(latency_ms) avg_latency,
               SUM(COALESCE(prompt_tokens,0)) prompt_tokens, SUM(COALESCE(completion_tokens,0)) completion_tokens
               FROM llm_calls GROUP BY key_id ORDER BY calls DESC""").fetchall())
        per_purpose = db.rows_to_dicts(conn.execute(
            "SELECT substr(purpose, 1, instr(purpose || ':', ':') - 1) purpose, COUNT(*) calls, SUM(ok) ok FROM llm_calls GROUP BY 1 ORDER BY calls DESC").fetchall())
    return {"per_key": per_key, "per_purpose": per_purpose, "settings": get_settings()}
