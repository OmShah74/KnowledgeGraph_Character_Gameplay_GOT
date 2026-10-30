"""Players, the living world, conversation threads, plots and rumours."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..canon.timeline import label
from ..game import behavior, engine, jobs, knowledge, mechanics, relationships, world_state

router = APIRouter(prefix="/api", tags=["game"])


@router.get("/game/backgrounds")
def backgrounds():
    return [{"id": k, **v} for k, v in mechanics.BACKGROUNDS.items()]


@router.get("/game/intents")
def intents():
    return [{"id": k, **v} for k, v in mechanics.INTENTS.items()]


@router.get("/game/start-locations")
def start_locations(season: int = 1, episode: int = 1):
    from ..canon.timeline import to_ord

    try:
        return engine.suggested_locations(to_ord(season, episode))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class PlayerIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    background: str
    allegiance: str | None = None
    bio: str = Field(default="", max_length=1000)
    season: int = Field(default=1, ge=1, le=8)
    episode: int = Field(default=1, ge=1, le=10)
    location_id: str | None = None


@router.get("/players")
def players():
    return engine.list_players()


@router.post("/players", status_code=201)
def create_player(body: PlayerIn):
    return engine.create_player(body.name, body.background, allegiance=body.allegiance, bio=body.bio, season=body.season,
                                episode=body.episode, location_id=body.location_id)


@router.get("/players/{pid}")
def player(pid: str):
    return engine.player_state(pid)


@router.delete("/players/{pid}")
def delete_player(pid: str):
    return engine.delete_player(pid)


class TravelIn(BaseModel):
    location_id: str


@router.post("/players/{pid}/travel")
def travel(pid: str, body: TravelIn):
    return engine.travel(pid, body.location_id)


class AdvanceIn(BaseModel):
    steps: int = Field(default=1, ge=1, le=5)


@router.post("/players/{pid}/advance")
async def advance(pid: str, body: AdvanceIn):
    return await engine.advance(pid, body.steps)


@router.get("/players/{pid}/roster")
def roster(pid: str):
    with db.db() as conn:
        p = engine._player(conn, pid)
        return world_state.roster(conn, pid, p["ord"])


@router.get("/players/{pid}/factions")
def factions(pid: str):
    with db.db() as conn:
        engine._player(conn, pid)
        return world_state.factions(conn, pid)


@router.get("/players/{pid}/outcomes")
def outcomes(pid: str):
    with db.db() as conn:
        p = engine._player(conn, pid)
        rows = world_state.outcomes(conn, pid, p["ord"])
        for r in rows:
            r["label"] = label(r["ord"])
        return rows


@router.get("/players/{pid}/events")
def events(pid: str, limit: int = 100, kind: str | None = None):
    with db.db() as conn:
        q = "SELECT * FROM events WHERE player_id=?"
        params: list = [pid]
        if kind:
            q += " AND kind LIKE ?"
            params.append(f"{kind}%")
        rows = db.rows_to_dicts(conn.execute(q + " ORDER BY id DESC LIMIT ?", (*params, min(limit, 500))).fetchall())
        for r in rows:
            r["label"] = label(r["ord"])
        return rows


@router.get("/players/{pid}/relationships")
def player_relationships(pid: str):
    with db.db() as conn:
        rows = db.rows_to_dicts(conn.execute(
            """SELECT r.*, c.name, c.house FROM player_relationships r JOIN characters c ON c.id=r.character_id
               WHERE r.player_id=? ORDER BY r.familiarity DESC""", (pid,)).fetchall())
        for r in rows:
            r["disposition"] = relationships.disposition(r)
        return rows


@router.get("/players/{pid}/relationship-log")
def relationship_log(pid: str, subject: str | None = None, object: str | None = None, limit: int = 100):
    with db.db() as conn:
        return relationships.history(conn, pid, subject, object, min(limit, 500))


@router.get("/players/{pid}/world-relationships")
def world_relationships(pid: str, min_interactions: int = 1, limit: int = 200):
    """Character<->character relationships that have evolved in this player's world."""
    with db.db() as conn:
        rows = db.rows_to_dicts(conn.execute(
            """SELECT r.*, ca.name a_name, cb.name b_name FROM char_relationships r JOIN characters ca ON ca.id=r.a
               JOIN characters cb ON cb.id=r.b WHERE r.player_id=? AND r.interactions >= ? ORDER BY r.updated_at DESC LIMIT ?""",
            (pid, min_interactions, limit)).fetchall())
        for r in rows:
            r["disposition"] = relationships.disposition(r)
        return rows


@router.get("/players/{pid}/characters/{cid}/profile")
def evolved_profile(pid: str, cid: str):
    with db.db() as conn:
        p = engine._player(conn, pid)
        c = world_state.character(conn, cid)
        if not c:
            raise HTTPException(404, "Character not found")
        return {"character": {"id": cid, "name": c["name"]}, **behavior.profile(conn, pid, c, p["ord"]),
                "relationship": relationships.get_player_rel(conn, p, cid),
                "knows": knowledge.known_facts(conn, pid, cid, 30)}


@router.get("/players/{pid}/facts")
def facts(pid: str):
    with db.db() as conn:
        return knowledge.list_facts(conn, pid)


@router.get("/players/{pid}/plots")
def plots(pid: str, status: str | None = None):
    with db.db() as conn:
        q = "SELECT * FROM plot_threads WHERE player_id=?"
        params: list = [pid]
        if status:
            q += " AND status=?"
            params.append(status)
        rows = db.rows_to_dicts(conn.execute(q + " ORDER BY status='active' DESC, tension DESC", params).fetchall())
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
        for r in rows:
            r["character_names"] = [names.get(c, c) for c in r["characters"]]
            r["linked_threads"] = [x["from_thread"] for x in conn.execute(
                "SELECT from_thread FROM thread_links WHERE to_kind='plot' AND to_id=?", (r["id"],))]
        return rows


@router.get("/players/{pid}/links")
def links(pid: str):
    """The interlinking of conversation threads, plots, characters and rumours, as a graph."""
    with db.db() as conn:
        threads = db.rows_to_dicts(conn.execute("SELECT id, title, kind, character_ids FROM threads WHERE player_id=?", (pid,)).fetchall())
        plots_ = db.rows_to_dicts(conn.execute("SELECT id, title, status FROM plot_threads WHERE player_id=?", (pid,)).fetchall())
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
        nodes = [{"id": t["id"], "kind": "thread", "name": t["title"]} for t in threads]
        nodes += [{"id": p["id"], "kind": "plot", "name": p["title"], "status": p["status"]} for p in plots_]
        char_ids = set()
        links_ = []
        for t in threads:
            for c in t["character_ids"]:
                char_ids.add(c)
                links_.append({"source": t["id"], "target": c, "relation": "with"})
        for l in db.rows_to_dicts(conn.execute("SELECT * FROM thread_links WHERE player_id=?", (pid,)).fetchall()):
            if l["to_kind"] == "character":
                char_ids.add(l["to_id"])
            links_.append({"source": l["from_thread"], "target": l["to_id"], "relation": l["relation"], "note": l["note"]})
        nodes += [{"id": c, "kind": "character", "name": names.get(c, c)} for c in char_ids]
        ids = {n["id"] for n in nodes}
        return {"nodes": nodes, "links": [l for l in links_ if l["source"] in ids and l["target"] in ids]}


@router.get("/players/{pid}/threads")
def threads(pid: str):
    return engine.list_threads(pid)


class ThreadIn(BaseModel):
    character_ids: list[str] = Field(min_length=1, max_length=8)
    kind: Literal["chat", "scene", "raven"] = "chat"
    title: str | None = Field(default=None, max_length=160)


@router.post("/players/{pid}/threads", status_code=201)
async def start_thread(pid: str, body: ThreadIn):
    return await engine.start_thread(pid, body.character_ids, body.kind, body.title)


@router.get("/threads/{tid}")
def thread(tid: str):
    return engine.get_thread(tid)


@router.delete("/threads/{tid}")
def delete_thread(tid: str, delete_memories: bool = False):
    return engine.delete_thread(tid, delete_memories)


class MessageIn(BaseModel):
    content: str = Field(default="", max_length=4000)
    intent: str = "say"
    target_id: str | None = None
    gold: int = Field(default=0, ge=0, le=100000)


@router.post("/threads/{tid}/messages")
async def send(tid: str, body: MessageIn):
    return await engine.send_message(tid, body.content, body.intent, body.target_id, body.gold)


@router.post("/threads/{tid}/continue")
async def continue_scene(tid: str):
    return await engine.continue_scene(tid)


@router.post("/threads/{tid}/reflect")
async def reflect(tid: str, now: bool = False):
    jid = engine.force_reflect(tid)
    ran = await jobs.drain(5) if now else 0
    return {"queued": jid, "ran": ran}
