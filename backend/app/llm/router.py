"""Multi-provider LLM router with cyclic key rotation and failover.

* Keys (Groq, OpenAI, OpenRouter, Gemini, custom OpenAI-compatible) live in `api_keys`, encrypted.
* Strategy "round_robin" rotates the starting key on every request so load is spread across
  all keys; "priority" always tries the highest-priority healthy key first.
* A failing key (timeout, 429, 5xx, network) is put on an exponential cooldown and the request
  immediately fails over to the next key. Auth failures (401/403) get a long cooldown.
* With a single key, that key is always used (with one retry).
"""
from __future__ import annotations

import asyncio
import json
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from .. import db, security

PROVIDERS: dict[str, dict[str, Any]] = {
    "groq": {"label": "Groq", "base_url": "https://api.groq.com/openai/v1", "json_mode": True,
             "default_model": "llama-3.3-70b-versatile"},
    "openai": {"label": "OpenAI", "base_url": "https://api.openai.com/v1", "json_mode": True,
               "default_model": "gpt-4o-mini"},
    "openrouter": {"label": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "json_mode": True,
                   "default_model": "meta-llama/llama-3.3-70b-instruct"},
    "gemini": {"label": "Google Gemini", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "json_mode": True,
               "default_model": "gemini-2.0-flash"},
    "custom": {"label": "Custom (OpenAI-compatible)", "base_url": "", "json_mode": False, "default_model": ""},
}

DEFAULT_SETTINGS = {
    "strategy": "round_robin",   # round_robin | priority
    "temperature": 0.85,
    "max_tokens": 900,
    "timeout_seconds": 45,
    "json_mode": True,
    "max_attempts": 6,
}


class LLMError(RuntimeError):
    pass


class NoKeysConfigured(LLMError):
    pass


class AllKeysFailed(LLMError):
    def __init__(self, errors: list[str]):
        super().__init__("All API keys failed: " + " | ".join(errors[-6:]))
        self.errors = errors


class _CallFailed(Exception):
    def __init__(self, message: str, status: int | None = None, retry_after: float | None = None, kind: str = "retryable"):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after
        self.kind = kind  # retryable | auth | bad_request


@dataclass
class LLMResult:
    text: str
    key_id: str
    key_name: str
    provider: str
    model: str
    latency_ms: int
    usage: dict[str, Any] = field(default_factory=dict)
    attempts: int = 1


def get_settings(conn=None) -> dict[str, Any]:
    if conn is None:
        with db.db() as c:
            return get_settings(c)
    s = dict(DEFAULT_SETTINGS)
    s.update(db.get_setting(conn, "llm", {}) or {})
    return s


def save_settings(conn, values: dict[str, Any]) -> dict[str, Any]:
    s = get_settings(conn)
    for k, v in values.items():
        if k in DEFAULT_SETTINGS and v is not None:
            s[k] = v
    if s["strategy"] not in ("round_robin", "priority"):
        s["strategy"] = "round_robin"
    s["temperature"] = float(max(0.0, min(2.0, float(s["temperature"]))))
    s["max_tokens"] = int(max(64, min(8192, int(s["max_tokens"]))))
    s["timeout_seconds"] = int(max(5, min(300, int(s["timeout_seconds"]))))
    s["max_attempts"] = int(max(1, min(20, int(s["max_attempts"]))))
    db.set_setting(conn, "llm", s)
    return s


def extract_json(text: str) -> dict[str, Any]:
    """Parse a JSON object out of an LLM reply (handles code fences, prose, trailing commas)."""
    t = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", t, re.DOTALL)
    if fence:
        t = fence.group(1).strip()
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("No JSON object in model output")
    candidate = t[start:end + 1]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        repaired = re.sub(r",\s*([}\]])", r"\1", candidate)
        repaired = repaired.replace("“", '"').replace("”", '"')
        return json.loads(repaired)


class LLMRouter:
    def __init__(self) -> None:
        self._cursor = 0
        self._lock = threading.Lock()
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(limits=httpx.Limits(max_connections=50, max_keepalive_connections=20))
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------- key selection
    def ordered_keys(self, providers: list[str] | None = None) -> list[dict[str, Any]]:
        with db.db() as conn:
            settings = get_settings(conn)
            rows = db.rows_to_dicts(conn.execute("SELECT * FROM api_keys WHERE enabled=1 ORDER BY priority DESC, created_at").fetchall())
        if providers:
            rows = [r for r in rows if r["provider"] in providers]
        if not rows:
            return []
        if settings["strategy"] == "round_robin" and len(rows) > 1:
            with self._lock:
                start = self._cursor % len(rows)
                self._cursor += 1
            rows = rows[start:] + rows[:start]
        now = time.time()
        healthy = [r for r in rows if (r["cooldown_until"] or 0) <= now]
        cooling = sorted((r for r in rows if (r["cooldown_until"] or 0) > now), key=lambda r: r["cooldown_until"])
        return healthy + cooling

    # ------------------------------------------------------------- bookkeeping
    @staticmethod
    def _record(key: dict[str, Any], ok: bool, purpose: str, latency_ms: int, status: int | None = None,
                error: str | None = None, usage: dict[str, Any] | None = None, cooldown: float = 0.0) -> None:
        usage = usage or {}
        with db.db() as conn:
            if ok:
                conn.execute(
                    """UPDATE api_keys SET success_count=success_count+1, consecutive_failures=0, cooldown_until=0,
                       last_used_at=?, last_error=NULL WHERE id=?""", (db.now_iso(), key["id"]))
            else:
                conn.execute(
                    """UPDATE api_keys SET failure_count=failure_count+1, consecutive_failures=consecutive_failures+1,
                       cooldown_until=?, last_used_at=?, last_error=? WHERE id=?""",
                    (time.time() + cooldown, db.now_iso(), (error or "")[:500], key["id"]))
            conn.execute(
                """INSERT INTO llm_calls(key_id,key_name,provider,model,purpose,ok,status_code,latency_ms,error,prompt_tokens,
                   completion_tokens,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (key["id"], key["name"], key["provider"], key["model"], purpose, int(ok), status, latency_ms,
                 (error or "")[:500] or None, usage.get("prompt_tokens"), usage.get("completion_tokens"), db.now_iso()))
            conn.execute("DELETE FROM llm_calls WHERE id <= (SELECT MAX(id) FROM llm_calls) - 5000")

    @staticmethod
    def _cooldown_for(exc: _CallFailed, consecutive: int) -> float:
        n = max(1, consecutive + 1)
        if exc.kind == "auth":
            return 900.0
        if exc.status == 429:
            base = exc.retry_after if exc.retry_after else 20.0 * (2 ** (n - 1))
            return float(min(300.0, max(5.0, base)))
        if exc.kind == "bad_request":
            return 0.0
        return float(min(120.0, 8.0 * (2 ** (n - 1))))

    # ------------------------------------------------------------- calling
    async def _call(self, key: dict[str, Any], messages: list[dict[str, str]], *, temperature: float, max_tokens: int,
                    json_mode: bool, timeout: float) -> tuple[str, dict[str, Any]]:
        provider = PROVIDERS.get(key["provider"], PROVIDERS["custom"])
        base = (key.get("base_url") or provider["base_url"]).rstrip("/")
        if not base:
            raise _CallFailed("No base URL configured for this key", kind="bad_request")
        try:
            secret = security.decrypt(key["key_cipher"])
        except ValueError as exc:
            raise _CallFailed(str(exc), kind="auth") from exc
        headers = {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}
        if key["provider"] == "openrouter":
            headers["HTTP-Referer"] = "http://localhost:3000"
            headers["X-Title"] = "Westeros Agentic RPG"
        body: dict[str, Any] = {"model": key["model"], "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
        if json_mode and provider["json_mode"]:
            body["response_format"] = {"type": "json_object"}
        try:
            resp = await self._http().post(f"{base}/chat/completions", headers=headers, json=body, timeout=timeout)
        except httpx.TimeoutException as exc:
            raise _CallFailed(f"timeout after {timeout}s") from exc
        except httpx.HTTPError as exc:
            raise _CallFailed(f"network error: {type(exc).__name__}: {exc}") from exc
        if resp.status_code >= 400:
            detail = resp.text[:300]
            if resp.status_code in (401, 403):
                raise _CallFailed(f"HTTP {resp.status_code}: {detail}", resp.status_code, kind="auth")
            if resp.status_code == 429:
                ra = resp.headers.get("retry-after")
                try:
                    retry_after = float(ra) if ra else None
                except ValueError:
                    retry_after = None
                raise _CallFailed(f"HTTP 429 rate limited: {detail}", 429, retry_after)
            if resp.status_code in (400, 404, 422):
                raise _CallFailed(f"HTTP {resp.status_code}: {detail}", resp.status_code, kind="bad_request")
            raise _CallFailed(f"HTTP {resp.status_code}: {detail}", resp.status_code)
        try:
            data = resp.json()
            text = data["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise _CallFailed(f"malformed response: {resp.text[:200]}") from exc
        if not text.strip():
            raise _CallFailed("empty completion")
        return text, data.get("usage") or {}

    async def chat(self, messages: list[dict[str, str]], *, purpose: str = "chat", temperature: float | None = None,
                   max_tokens: int | None = None, json_mode: bool | None = None, providers: list[str] | None = None) -> LLMResult:
        settings = get_settings()
        keys = self.ordered_keys(providers)
        if not keys:
            raise NoKeysConfigured("No enabled API keys. Add one in Settings → API Keys.")
        temperature = settings["temperature"] if temperature is None else temperature
        max_tokens = settings["max_tokens"] if max_tokens is None else max_tokens
        json_mode = settings["json_mode"] if json_mode is None else json_mode
        timeout = float(settings["timeout_seconds"])

        # Single key: always that key, with one retry. Multiple keys: cycle through them.
        plan = keys * 2 if len(keys) == 1 else keys
        plan = plan[: max(len(keys), min(settings["max_attempts"], len(plan)))]
        errors: list[str] = []
        for attempt, key in enumerate(plan, start=1):
            use_json = json_mode
            for json_retry in (0, 1):
                t0 = time.perf_counter()
                try:
                    text, usage = await self._call(key, messages, temperature=temperature, max_tokens=max_tokens,
                                                   json_mode=use_json, timeout=timeout)
                    ms = int((time.perf_counter() - t0) * 1000)
                    self._record(key, True, purpose, ms, 200, usage=usage)
                    return LLMResult(text, key["id"], key["name"], key["provider"], key["model"], ms, usage, attempt)
                except _CallFailed as exc:
                    ms = int((time.perf_counter() - t0) * 1000)
                    if exc.kind == "bad_request" and use_json and json_retry == 0:
                        use_json = False  # model may not support response_format; retry same key without it
                        continue
                    cooldown = self._cooldown_for(exc, key.get("consecutive_failures") or 0)
                    self._record(key, False, purpose, ms, exc.status, str(exc), cooldown=cooldown)
                    key["consecutive_failures"] = (key.get("consecutive_failures") or 0) + 1
                    errors.append(f"{key['name']} ({key['provider']}): {exc}")
                    break
            if len(keys) == 1 and attempt < len(plan):
                await asyncio.sleep(1.5)
        raise AllKeysFailed(errors)

    async def chat_json(self, messages: list[dict[str, str]], *, purpose: str = "chat", **kw: Any) -> tuple[dict[str, Any], LLMResult]:
        res = await self.chat(messages, purpose=purpose, json_mode=True, **kw)
        try:
            return extract_json(res.text), res
        except (ValueError, json.JSONDecodeError):
            repair = messages + [
                {"role": "assistant", "content": res.text[:4000]},
                {"role": "user", "content": "That was not valid JSON. Reply again with ONLY the JSON object, no prose."},
            ]
            res2 = await self.chat(repair, purpose=purpose + ":repair", json_mode=True, **kw)
            return extract_json(res2.text), res2

    async def test_key(self, key_id: str) -> dict[str, Any]:
        with db.db() as conn:
            key = db.row_to_dict(conn.execute("SELECT * FROM api_keys WHERE id=?", (key_id,)).fetchone())
        if not key:
            raise LLMError("Key not found")
        settings = get_settings()
        t0 = time.perf_counter()
        try:
            text, usage = await self._call(key, [{"role": "user", "content": "Reply with exactly: Winter is coming."}],
                                           temperature=0.0, max_tokens=20, json_mode=False, timeout=float(settings["timeout_seconds"]))
            ms = int((time.perf_counter() - t0) * 1000)
            self._record(key, True, "test", ms, 200, usage=usage)
            return {"ok": True, "latency_ms": ms, "reply": text.strip()[:200]}
        except _CallFailed as exc:
            ms = int((time.perf_counter() - t0) * 1000)
            self._record(key, False, "test", ms, exc.status, str(exc), cooldown=0.0)
            return {"ok": False, "latency_ms": ms, "error": str(exc), "status": exc.status}


router = LLMRouter()
