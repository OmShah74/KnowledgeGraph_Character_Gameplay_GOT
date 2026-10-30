"""Durable background job queue (SQLite-backed).

Slow cognition runs off the request path so conversations stay snappy:
  reflect_thread   consolidate a conversation into memories / beliefs / learned behaviour
  wiki_ingest      refresh wiki pages affected by new information
  wiki_regenerate  LLM-synthesise a wiki page

Jobs survive restarts (status 'running' jobs are re-queued on boot), retry with exponential
backoff up to MAX_ATTEMPTS, and are visible/retryable from the API.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import traceback
from typing import Any, Awaitable, Callable

from .. import db, snapshots

log = logging.getLogger("got.jobs")
MAX_ATTEMPTS = 3
Handler = Callable[[dict[str, Any]], Awaitable[Any]]
_handlers: dict[str, Handler] = {}


def handler(kind: str) -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        _handlers[kind] = fn
        return fn
    return deco


def enqueue(kind: str, payload: dict[str, Any], player_id: str | None = None, delay: float = 0.0, dedupe: bool = True) -> int | None:
    body = json.dumps(payload, sort_keys=True)
    with db.db() as conn:
        if dedupe and conn.execute("SELECT 1 FROM jobs WHERE kind=? AND payload=? AND status='queued'", (kind, body)).fetchone():
            return None
        cur = conn.execute("INSERT INTO jobs(kind, player_id, payload, status, run_after, created_at) VALUES(?,?,?,?,?,?)",
                           (kind, player_id, body, "queued", time.time() + delay, db.now_iso()))
        return int(cur.lastrowid)


def recover() -> int:
    with db.db() as conn:
        return conn.execute("UPDATE jobs SET status='queued' WHERE status='running'").rowcount


def list_jobs(limit: int = 100, status: str | None = None) -> list[dict[str, Any]]:
    with db.db() as conn:
        q = "SELECT * FROM jobs"
        params: list[Any] = []
        if status:
            q += " WHERE status=?"
            params.append(status)
        return db.rows_to_dicts(conn.execute(q + " ORDER BY id DESC LIMIT ?", (*params, limit)).fetchall())


def retry(job_id: int) -> bool:
    with db.db() as conn:
        return conn.execute("UPDATE jobs SET status='queued', attempts=0, run_after=0, error=NULL WHERE id=?", (job_id,)).rowcount > 0


def stats() -> dict[str, int]:
    with db.db() as conn:
        return {r["status"]: r["n"] for r in conn.execute("SELECT status, COUNT(*) n FROM jobs GROUP BY status")}


async def run_one() -> bool:
    if snapshots.maintenance.is_set():
        return False
    with db.db() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE status='queued' AND run_after<=? ORDER BY id LIMIT 1", (time.time(),)).fetchone()
        if not row:
            return False
        job = db.row_to_dict(row)
        claimed = conn.execute("UPDATE jobs SET status='running', attempts=attempts+1 WHERE id=? AND status='queued'", (job["id"],)).rowcount  # type: ignore[index]
        if not claimed:
            return True
    assert job is not None
    fn = _handlers.get(job["kind"])
    try:
        if not fn:
            raise RuntimeError(f"No handler for job kind {job['kind']}")
        payload = job["payload"] if isinstance(job["payload"], dict) else json.loads(job["payload"] or "{}")
        result = await fn(payload)
        with db.db() as conn:
            conn.execute("UPDATE jobs SET status='done', result=?, finished_at=? WHERE id=?",
                         (json.dumps(result, default=str)[:4000], db.now_iso(), job["id"]))
    except Exception as exc:  # noqa: BLE001 - every failure is recorded and retried
        attempts = int(job["attempts"]) + 1
        status = "queued" if attempts < MAX_ATTEMPTS else "failed"
        log.warning("job %s (%s) failed: %s", job["id"], job["kind"], exc)
        with db.db() as conn:
            conn.execute("UPDATE jobs SET status=?, error=?, run_after=? WHERE id=?",
                         (status, f"{exc}\n{traceback.format_exc()[-1500:]}", time.time() + 5 * (2 ** attempts), job["id"]))
    return True


async def worker(stop: asyncio.Event, idle_sleep: float = 1.0) -> None:
    recover()
    while not stop.is_set():
        try:
            worked = await run_one()
        except Exception as exc:  # noqa: BLE001
            log.error("job worker error: %s", exc)
            worked = False
        if not worked:
            try:
                await asyncio.wait_for(stop.wait(), timeout=idle_sleep)
            except asyncio.TimeoutError:
                pass


async def drain(max_jobs: int = 50) -> int:
    """Run queued jobs inline (used by tests and the 'run now' admin action)."""
    n = 0
    while n < max_jobs and await run_one():
        n += 1
    return n


# ------------------------------------------------------------------ handlers
@handler("reflect_thread")
async def _reflect(payload: dict[str, Any]) -> Any:
    from . import reflection

    res = await reflection.reflect_thread(payload["thread_id"], force=bool(payload.get("force")))
    if res.get("applied"):
        with db.db() as conn:
            t = conn.execute("SELECT player_id, character_ids FROM threads WHERE id=?", (payload["thread_id"],)).fetchone()
        if t:
            enqueue("wiki_ingest", {"scope": t["player_id"], "characters": json.loads(t["character_ids"]),
                                    "reason": "reflection after a conversation"}, t["player_id"])
    return res


@handler("wiki_ingest")
async def _wiki_ingest(payload: dict[str, Any]) -> Any:
    from ..wiki import service as wiki

    pairs = [tuple(p) for p in payload.get("pairs") or []]
    with db.db() as conn:
        return wiki.ingest(conn, payload["scope"], characters=payload.get("characters"), pairs=pairs,  # type: ignore[arg-type]
                           plots=payload.get("plots"), reason=payload.get("reason", ""))


@handler("wiki_regenerate")
async def _wiki_regen(payload: dict[str, Any]) -> Any:
    from ..wiki import service as wiki

    page = await wiki.regenerate(payload["slug"], payload["scope"], use_llm=True)
    return {"slug": payload["slug"], "version": page["version"] if page else None}
