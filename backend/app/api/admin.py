"""Snapshots, archives, guarded resets and the job queue."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import snapshots
from ..game import jobs

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/snapshots")
def list_snapshots():
    return {**snapshots.list_snapshots(), "confirm_phrase": snapshots.CONFIRM_PHRASE}


class ArchiveIn(BaseModel):
    note: str = Field(default="manual", max_length=40)


@router.post("/snapshots/archive")
def archive(body: ArchiveIn):
    return snapshots.archive_current(f"manual-{body.note}")


class PrepareIn(BaseModel):
    action: Literal["reset_all", "restore_archive", "reset_player"]
    target: str | None = None


@router.post("/reset/prepare")
def prepare(body: PrepareIn):
    try:
        return snapshots.prepare(body.action, body.target)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class ConfirmIn(BaseModel):
    token: str
    phrase: str
    keep_api_keys: bool = True


def _confirm(fn, *args):
    try:
        return fn(*args)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/reset/confirm")
def confirm_reset(body: ConfirmIn):
    return _confirm(snapshots.confirm_reset_all, body.token, body.phrase, body.keep_api_keys)


@router.post("/restore/confirm")
def confirm_restore(body: ConfirmIn):
    return _confirm(snapshots.confirm_restore_archive, body.token, body.phrase, body.keep_api_keys)


@router.post("/players/reset/confirm")
def confirm_player_reset(body: ConfirmIn):
    return _confirm(snapshots.confirm_reset_player, body.token, body.phrase)


@router.get("/jobs")
def list_jobs(status: str | None = None, limit: int = 100):
    return {"items": jobs.list_jobs(min(limit, 500), status), "stats": jobs.stats()}


@router.post("/jobs/{job_id}/retry")
def retry(job_id: int):
    if not jobs.retry(job_id):
        raise HTTPException(404, "Job not found")
    return {"ok": True}


@router.post("/jobs/drain")
async def drain(max_jobs: int = 20):
    return {"ran": await jobs.drain(min(max_jobs, 200))}
