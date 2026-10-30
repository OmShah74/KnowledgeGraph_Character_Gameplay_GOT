"""Story Mode endpoints: chapters, scenes, beats, dialogue options, chapter progression."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..game import engine, story

router = APIRouter(prefix="/api/story", tags=["story"])


def _wrap(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except story.StoryError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/{pid}")
def chapter(pid: str):
    return _wrap(story.chapter, pid)


@router.get("/{pid}/scenes/{sid}")
def scene(pid: str, sid: str):
    return _wrap(story.scene_detail, pid, sid)


class EnterIn(BaseModel):
    follow: bool = True


@router.post("/{pid}/scenes/{sid}/enter")
def enter(pid: str, sid: str, body: EnterIn):
    engine._guard()
    return _wrap(story.enter, pid, sid, body.follow)


class BeatIn(BaseModel):
    index: int = Field(ge=0)


@router.post("/{pid}/scenes/{sid}/beat")
def beat(pid: str, sid: str, body: BeatIn):
    return _wrap(story.play_beat, pid, sid, body.index)


class CompleteIn(BaseModel):
    skipped: bool = False


@router.post("/{pid}/scenes/{sid}/complete")
def complete(pid: str, sid: str, body: CompleteIn):
    return _wrap(story.complete, pid, sid, body.skipped)


@router.get("/{pid}/scenes/{sid}/options")
async def options(pid: str, sid: str, target_id: str | None = None):
    try:
        return await story.options(pid, sid, target_id)
    except story.StoryError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/{pid}/next-chapter")
async def next_chapter(pid: str):
    res = await engine.advance(pid, 1)
    return {"reports": res["reports"], "at_end": res["at_end"], "chapter": story.chapter(pid)}
