"""Canon world, characters, memories, script search and data ingestion."""
from __future__ import annotations

import shutil
from typing import Any, Literal

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import bootstrap, config, db, snapshots
from ..canon import world
from ..canon.timeline import MAX_ORD, label
from ..game import behavior, personas, relationships, world_state
from ..graph import builder
from ..graph.neo4j_store import neo4j_store
from ..ingest import script_loader
from ..memory import service as memory

router = APIRouter(prefix="/api", tags=["world"])


@router.get("/health")
def health():
    return {"ok": True, "maintenance": snapshots.maintenance.is_set()}


@router.get("/meta")
def meta():
    with db.db() as conn:
        keys = conn.execute("SELECT COUNT(*) FROM api_keys WHERE enabled=1").fetchone()[0]
        players = conn.execute("SELECT COUNT(*) FROM players").fetchone()[0]
    return {**bootstrap.status(), "enabled_keys": keys, "players": players, "neo4j": neo4j_store.status(), "max_ord": MAX_ORD}


@router.get("/episodes")
def episodes():
    with db.db() as conn:
        rows = db.rows_to_dicts(conn.execute("SELECT * FROM episodes ORDER BY ord").fetchall())
        ev = {}
        for e in conn.execute("SELECT ord, title FROM canon_events ORDER BY importance DESC"):
            ev.setdefault(e["ord"], []).append(e["title"])
        for r in rows:
            r["label"] = label(r["ord"])
            r["events"] = ev.get(r["ord"], [])[:4]
        return rows


@router.get("/world")
def world_static():
    return {"regions": world.REGIONS, "locations": world.LOCATIONS, "houses": world.HOUSES, "organizations": world.ORGANIZATIONS,
            "religions": world.RELIGIONS, "storylines": world.STORYLINES, "creatures": world.CREATURES,
            "artifacts": [{k: v for k, v in a.items() if k != "owners"} for a in world.ARTIFACTS], "titles": [
                {"id": t["id"], "name": t["name"]} for t in world.TITLES]}


@router.get("/characters")
def characters(q: str = "", tier: str | None = None, house: str | None = None, ord: int | None = None,
               player_id: str | None = None, alive: bool | None = None, limit: int = 300, offset: int = 0):
    with db.db() as conn:
        sql = "SELECT * FROM characters WHERE 1=1"
        params: list[Any] = []
        if q:
            sql += " AND (name LIKE ? OR aliases LIKE ?)"
            params += [f"%{q}%", f"%{q.lower()}%"]
        if tier:
            sql += " AND tier=?"
            params.append(tier)
        if house:
            sql += " AND house=?"
            params.append(house)
        sql += " ORDER BY CASE tier WHEN 'major' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END, line_count DESC"
        rows = db.rows_to_dicts(conn.execute(sql, params).fetchall())
        o = ord or MAX_ORD
        out = []
        for c in rows:
            st = world_state.state(conn, player_id, c["id"]) if player_id else None
            is_alive = world_state.is_alive(c, st, o) and c.get("death_ord") != 0
            if alive is not None and is_alive != alive:
                continue
            loc = world_state.location_of(c, st, o)
            out.append({"id": c["id"], "name": c["name"], "house": c["house"], "tier": c["tier"], "titles": world_state.titles_at(conn, c, o),
                        "summary": c["summary"], "line_count": c["line_count"], "canon": bool(c["canon"]),
                        "death_ord": c["death_ord"], "alive": is_alive, "location_id": loc,
                        "location_name": world_state.LOCATIONS.get(loc or "", {}).get("name"),
                        "storyline": world_state.storyline_of(c, o), "has_persona": personas.load_md(c["id"]) is not None,
                        "mood": (st or {}).get("mood")})
        return {"total": len(out), "items": out[offset: offset + limit]}


@router.get("/characters/{cid}")
def character(cid: str, ord: int | None = None, player_id: str | None = None):
    with db.db() as conn:
        c = world_state.character(conn, cid)
        if not c:
            raise HTTPException(404, "Character not found")
        o = ord or MAX_ORD
        if player_id:
            p = conn.execute("SELECT ord FROM players WHERE id=?", (player_id,)).fetchone()
            if p and ord is None:
                o = p["ord"]
        st = world_state.state(conn, player_id, cid) if player_id else None
        c["persona"] = personas.persona_document(conn, c, o)
        c["profile"] = behavior.profile(conn, player_id, c, o)
        c["network"] = relationships.character_network(conn, player_id, cid, o, 20)
        c["alive"] = world_state.is_alive(c, st, o) and c.get("death_ord") != 0
        c["location_id"] = world_state.location_of(c, st, o)
        c["location_name"] = world_state.LOCATIONS.get(c["location_id"] or "", {}).get("name")
        c["storyline"] = world_state.storyline_of(c, o)
        c["ord"] = o
        c["label"] = label(o)
        c["titles_now"] = world_state.titles_at(conn, c, o)
        c["arc_complete"] = o >= (c.get("last_ord") or 0) or (c.get("death_ord") is not None and c["death_ord"] <= o)
        c["events"] = world_state.known_events(conn, player_id, cid, o, 20)
        c["memory_stats"] = {r["kind"]: r["n"] for r in conn.execute(
            "SELECT kind, COUNT(*) n FROM memories WHERE character_id=? AND (player_id IS NULL OR player_id=?) GROUP BY kind", (cid, player_id))}
        if player_id:
            p = db.row_to_dict(conn.execute("SELECT * FROM players WHERE id=?", (player_id,)).fetchone())
            if p:
                c["player_relationship"] = relationships.get_player_rel(conn, p, cid)
            c["state"] = st
        return c


@router.get("/characters/{cid}/lines")
def character_lines(cid: str, q: str = "", season: int | None = None, limit: int = 100, offset: int = 0):
    with db.db() as conn:
        if q:
            fq = memory.fts_query(q)
            if not fq:
                return {"items": [], "total": 0}
            sql = """SELECT s.* FROM script_fts JOIN script_lines s ON s.id=script_fts.rowid WHERE script_fts MATCH ? AND s.character_id=?"""
            params: list[Any] = [fq, cid]
        else:
            sql = "SELECT s.* FROM script_lines s WHERE s.character_id=?"
            params = [cid]
        if season:
            sql += " AND s.season=?"
            params.append(season)
        total = conn.execute(f"SELECT COUNT(*) FROM ({sql})", params).fetchone()[0]
        rows = db.rows_to_dicts(conn.execute(sql + " ORDER BY s.ord, s.line_no LIMIT ? OFFSET ?", (*params, limit, offset)).fetchall())
        for r in rows:
            r["label"] = label(r["ord"])
        return {"items": rows, "total": total}


@router.get("/characters/{cid}/relationships")
def character_relationships(cid: str, player_id: str | None = None, ord: int | None = None, limit: int = 30):
    with db.db() as conn:
        o = ord or MAX_ORD
        if player_id and ord is None:
            p = conn.execute("SELECT ord FROM players WHERE id=?", (player_id,)).fetchone()
            o = p["ord"] if p else o
        return relationships.character_network(conn, player_id, cid, o, limit)


@router.get("/relationships/pair")
def pair(a: str, b: str, player_id: str | None = None, ord: int | None = None):
    with db.db() as conn:
        o = ord or MAX_ORD
        if player_id and ord is None:
            p = conn.execute("SELECT ord FROM players WHERE id=?", (player_id,)).fetchone()
            o = p["ord"] if p else o
        views = {}
        for x, y in ((a, b), (b, a)):
            prior = relationships.canon_prior(conn, x, y, o)
            cur = relationships.get_char_rel(conn, player_id, x, y, o, create=False) if player_id else prior
            views[x] = {"prior": prior, "current": cur}
        log = []
        if player_id:
            log = db.rows_to_dicts(conn.execute(
                """SELECT * FROM relationship_log WHERE player_id=? AND ((subject=? AND object=?) OR (subject=? AND object=?))
                   ORDER BY id DESC LIMIT 50""", (player_id, a, b, b, a)).fetchall())
        return {"a": a, "b": b, "ord": o, "views": views, "memories": memory.pair_memories(conn, a, b, o, player_id, 30), "log": log,
                "criteria": relationships.STANCE_CRITERIA}


class MemoryIn(BaseModel):
    character_id: str
    player_id: str | None = None
    content: str = Field(min_length=1, max_length=2000)
    kind: Literal["episodic", "semantic", "reflection", "world", "canon"] = "semantic"
    importance: float = 0.5
    counterpart_id: str | None = None
    ord: int = 0


class MemoryPatch(BaseModel):
    content: str | None = Field(default=None, max_length=2000)
    importance: float | None = None


@router.get("/memories")
def memories(character_id: str | None = None, player_id: str | None = None, kind: str | None = None, q: str | None = None,
             scope: Literal["all", "canon", "player"] = "all", counterpart_id: str | None = None, ord_max: int | None = None,
             limit: int = 50, offset: int = 0):
    with db.db() as conn:
        res = memory.list_memories(conn, character_id=character_id, player_id=player_id, kind=kind, q=q, scope=scope,
                                   counterpart_id=counterpart_id, ord_max=ord_max, limit=min(limit, 500), offset=offset)
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
        for m in res["items"]:
            m["label"] = label(m["ord"]) if m["ord"] else None
            m["character_name"] = names.get(m["character_id"])
            m["counterpart_name"] = names.get(m.get("counterpart_id") or "")
        return res


@router.get("/memories/recall")
def recall(character_id: str, q: str, ord: int = MAX_ORD, player_id: str | None = None, k: int = 10):
    """Preview exactly what the agent would recall for a given prompt (with scores)."""
    with db.db() as conn:
        items = memory.retrieve(conn, character_id=character_id, query=q, ord_=ord, player_id=player_id, k=k, touch=False)
        for m in items:
            m["label"] = label(m["ord"]) if m["ord"] else None
        return items


@router.get("/memories/stats")
def memory_stats(player_id: str | None = None):
    with db.db() as conn:
        return memory.stats(conn, player_id)


@router.post("/memories", status_code=201)
def add_memory(body: MemoryIn):
    with db.db() as conn:
        if not conn.execute("SELECT 1 FROM characters WHERE id=?", (body.character_id,)).fetchone():
            raise HTTPException(404, "Character not found")
        mid = memory.add_memory(conn, character_id=body.character_id, player_id=body.player_id, kind=body.kind, content=body.content,
                                importance=body.importance, counterpart_id=body.counterpart_id, ord_=body.ord,
                                about=[body.counterpart_id] if body.counterpart_id else [])
        return db.row_to_dict(conn.execute("SELECT * FROM memories WHERE id=?", (mid,)).fetchone())


@router.patch("/memories/{mid}")
def patch_memory(mid: int, body: MemoryPatch):
    with db.db() as conn:
        m = memory.update_memory(conn, mid, body.content, body.importance)
        if not m:
            raise HTTPException(404, "Memory not found")
        return m


@router.delete("/memories/{mid}")
def delete_memory(mid: int):
    with db.db() as conn:
        if not memory.delete_memory(conn, mid):
            raise HTTPException(404, "Memory not found")
    return {"deleted": mid}


@router.delete("/memories")
def delete_memories(player_id: str, character_id: str | None = None):
    with db.db() as conn:
        return {"deleted": memory.delete_for(conn, player_id=player_id, character_id=character_id)}


@router.get("/script/search")
def script_search(q: str, character_id: str | None = None, season: int | None = None, limit: int = 50):
    fq = memory.fts_query(q)
    if not fq:
        return []
    with db.db() as conn:
        sql = """SELECT s.*, c.name AS character_name FROM script_fts JOIN script_lines s ON s.id=script_fts.rowid
                 LEFT JOIN characters c ON c.id=s.character_id WHERE script_fts MATCH ?"""
        params: list[Any] = [fq]
        if character_id:
            sql += " AND s.character_id=?"
            params.append(character_id)
        if season:
            sql += " AND s.season=?"
            params.append(season)
        rows = db.rows_to_dicts(conn.execute(sql + " ORDER BY bm25(script_fts) LIMIT ?", (*params, min(limit, 200))).fetchall())
        for r in rows:
            r["label"] = label(r["ord"])
        return rows


@router.get("/script/episode/{ord}")
def episode_script(ord: int, limit: int = 2000):
    with db.db() as conn:
        rows = db.rows_to_dicts(conn.execute(
            """SELECT s.*, c.name AS character_name FROM script_lines s LEFT JOIN characters c ON c.id=s.character_id
               WHERE s.ord=? ORDER BY s.line_no LIMIT ?""", (ord, limit)).fetchall())
        return rows


@router.get("/data/status")
def data_status():
    with db.db() as conn:
        top = db.rows_to_dicts(conn.execute("SELECT id, name, line_count FROM characters ORDER BY line_count DESC LIMIT 25").fetchall())
        unmapped = db.rows_to_dicts(conn.execute(
            "SELECT speaker_raw, COUNT(*) n FROM script_lines WHERE character_id IS NULL GROUP BY speaker_raw ORDER BY n DESC LIMIT 40").fetchall())
        per_season = db.rows_to_dicts(conn.execute("SELECT season, COUNT(*) n FROM script_lines GROUP BY season ORDER BY season").fetchall())
    return {**bootstrap.status(), "top_speakers": top, "unmapped_speakers": unmapped, "lines_per_season": per_season,
            "hand_written_personas": personas.list_hand_written()}


class ReingestIn(BaseModel):
    confirm: bool = False


@router.post("/data/reingest")
def reingest(body: ReingestIn):
    if not body.confirm:
        raise HTTPException(400, "Set confirm=true. The current database is archived first.")
    archived = snapshots.archive_current("pre-reingest")
    res = script_loader.ingest(config.SCRIPT_PATH)
    with db.db() as conn:
        graph = builder.build(conn)
    return {"archived": archived, "ingest": res, "graph": {k: v for k, v in graph.items() if k != "skipped"}}


@router.post("/data/upload")
async def upload(file: UploadFile = File(...)):
    name = (file.filename or "script.csv").lower()
    if not name.endswith((".csv", ".xlsx", ".xlsm")):
        raise HTTPException(400, "Upload a .csv or .xlsx screenplay file")
    config.ensure_dirs()
    dest = config.UPLOAD_DIR / f"{db.new_id('upload_')}{'.xlsx' if name.endswith(('.xlsx', '.xlsm')) else '.csv'}"
    with dest.open("wb") as fh:
        shutil.copyfileobj(file.file, fh)
    try:
        rows = script_loader.read_rows(dest)
        cols = script_loader.detect_columns(rows[0].keys() if rows else [])
    except script_loader.IngestError as exc:
        raise HTTPException(400, str(exc)) from exc
    archived = snapshots.archive_current("pre-upload")
    res = script_loader.ingest(dest)
    with db.db() as conn:
        graph = builder.build(conn)
    return {"archived": archived, "columns": cols, "ingest": res, "graph": {k: v for k, v in graph.items() if k != "skipped"}}
