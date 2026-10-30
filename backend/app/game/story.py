"""Story Mode: play the series scene by scene, like an RPG.

Every episode is a chapter made of canon scenes (see ingest/scenes.py). The player follows the
story: entering a scene moves them to where it happens ("follow the story"), the characters perform
their canon lines (beats), and at any beat the player can speak up. Agents then answer in character,
grounded in the scene so far and in what they were about to say in canon. Everything that happens
is recorded in a scene-linked conversation thread, which also appears in the normal conversation list.

In a diverged world the scene adapts: lines of characters who are dead in this world are dropped,
and a scene whose whole cast is gone is marked as "lost" (it can no longer happen).
"""
from __future__ import annotations

import asyncio
import sqlite3
from typing import Any

from .. import db
from ..canon import world
from ..canon.timeline import MAX_ORD, label
from ..graph import store as kg
from ..ingest import scenes as scene_builder
from . import agents, plots, simulation, world_state

LOC = {l["id"]: l for l in world.LOCATIONS}
SET_FOR_LOCATION: dict[str, str] = {
    "kings_landing": "throne_room", "dragonstone": "war_room", "winterfell": "courtyard_snow", "castle_black": "wall_yard",
    "eastwatch": "wall_yard", "beyond_wall": "snow_forest", "hardhome": "snow_forest", "three_eyed_raven_cave": "weirwood_cave",
    "last_hearth": "great_hall", "the_dreadfort": "dungeon", "pyke": "sea_keep", "the_twins": "great_hall", "riverrun": "great_hall",
    "harrenhal": "ruined_hall", "crossroads_inn": "tavern", "the_eyrie": "sky_hall", "casterly_rock": "great_hall",
    "storms_end": "great_hall", "highgarden": "garden", "horn_hill": "great_hall", "oldtown": "library", "sunspear": "garden",
    "water_gardens": "garden", "braavos": "essos_plaza", "pentos": "essos_plaza", "volantis": "essos_plaza",
    "vaes_dothrak": "dothraki_camp", "dothraki_sea_plains": "dothraki_camp", "qarth": "essos_plaza", "astapor": "essos_plaza",
    "yunkai": "essos_plaza", "meereen": "pyramid_hall", "valyria": "ruins",
}


class StoryError(ValueError):
    pass


# ------------------------------------------------------------------ queries
def _scene(conn: sqlite3.Connection, sid: str) -> dict[str, Any]:
    sc = db.row_to_dict(conn.execute("SELECT * FROM canon_scenes WHERE id=?", (sid,)).fetchone())
    if not sc:
        raise StoryError("Scene not found")
    return sc


def _progress(conn: sqlite3.Connection, pid: str) -> dict[str, dict[str, Any]]:
    return {r["scene_id"]: db.row_to_dict(r) for r in conn.execute("SELECT * FROM story_progress WHERE player_id=?", (pid,))}  # type: ignore[misc]


def _alive_cast(conn: sqlite3.Connection, pid: str, sc: dict[str, Any], ord_: int) -> tuple[list[str], list[str]]:
    alive, lost = [], []
    for cid in sc["participants"]:
        c = world_state.character(conn, cid)
        if not c:
            continue
        # A canon death *during* this very episode still lets them appear in its scenes.
        st = world_state.state(conn, pid, cid)
        if st and st.get("alive") == 0:
            lost.append(cid)
        elif st and st.get("alive") == 1:
            alive.append(cid)
        elif c.get("death_ord") is not None and c["death_ord"] < ord_:
            lost.append(cid)
        else:
            alive.append(cid)
    return alive, lost


def scene_card(conn: sqlite3.Connection, pid: str, sc: dict[str, Any], prog: dict[str, Any] | None, player_loc: str,
               names: dict[str, str]) -> dict[str, Any]:
    alive, lost = _alive_cast(conn, pid, sc, sc["ord"])
    status = (prog or {}).get("status", "unseen")
    if not alive and sc["participants"]:
        status = "lost" if status == "unseen" else status
    return {
        "id": sc["id"], "ord": sc["ord"], "idx": sc["idx"], "title": sc["title"], "summary": sc["summary"],
        "location_id": sc["location_id"], "location_name": LOC.get(sc["location_id"] or "", {}).get("name", "Somewhere"),
        "set": SET_FOR_LOCATION.get(sc["location_id"] or "", "great_hall"),
        "participants": [{"id": c, "name": names.get(c, c), "alive": c in alive} for c in sc["participants"]],
        "extras": sc["extras"], "n_lines": sc["n_lines"], "events": sc["events"], "status": status,
        "beat_index": (prog or {}).get("beat_index", 0), "thread_id": (prog or {}).get("thread_id"),
        "here": sc["location_id"] == player_loc, "diverged": bool(lost),
    }


def chapter(pid: str) -> dict[str, Any]:
    from .engine import _player

    with db.db() as conn:
        scene_builder.ensure(conn)
        p = _player(conn, pid)
        ord_ = p["ord"]
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
        ep = db.row_to_dict(conn.execute("SELECT * FROM episodes WHERE ord=?", (ord_,)).fetchone()) or {}
        prog = _progress(conn, pid)
        scenes = [scene_card(conn, pid, sc, prog.get(sc["id"]), p["location_id"], names)
                  for sc in db.rows_to_dicts(conn.execute("SELECT * FROM canon_scenes WHERE ord=? ORDER BY idx", (ord_,)).fetchall())]
        events = [{"title": e["title"], "description": e["description"], "id": e["id"]} for e in db.rows_to_dicts(
            conn.execute("SELECT * FROM canon_events WHERE ord=? ORDER BY importance DESC", (ord_,)).fetchall())]
        done = sum(1 for s in scenes if s["status"] in ("completed", "skipped", "lost"))
        current = next((s for s in scenes if s["status"] == "in_progress"), None) or \
            next((s for s in scenes if s["status"] == "unseen"), None)
        seasons_total = conn.execute("SELECT COUNT(*) FROM canon_scenes").fetchone()[0]
        seen_total = conn.execute("SELECT COUNT(*) FROM story_progress WHERE player_id=? AND status IN ('completed','skipped')", (pid,)).fetchone()[0]
        return {
            "player": p, "chapter": {"ord": ord_, "label": label(ord_), "title": ep.get("title", ""), "release_date": ep.get("release_date"),
                                     "events": events, "season": p["season"], "episode": p["episode"]},
            "scenes": scenes, "done": done, "total": len(scenes), "current_scene_id": current["id"] if current else None,
            "chapter_complete": current is None, "is_last_chapter": ord_ >= MAX_ORD,
            "series_progress": {"seen": seen_total, "total": seasons_total},
        }


def _beats(conn: sqlite3.Connection, pid: str, sc: dict[str, Any]) -> list[dict[str, Any]]:
    names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
    alive, lost = _alive_cast(conn, pid, sc, sc["ord"])
    out = []
    for r in conn.execute("SELECT line_no, speaker_raw, character_id, sentence FROM script_lines WHERE ord=? AND line_no BETWEEN ? AND ? ORDER BY line_no",
                          (sc["ord"], sc["line_start"], sc["line_end"])):
        if r["character_id"] in lost:
            continue
        out.append({"i": len(out), "line_no": r["line_no"], "speaker_id": r["character_id"],
                    "speaker_name": names.get(r["character_id"] or "", r["speaker_raw"].title()), "text": r["sentence"],
                    "extra": r["character_id"] is None})
    return out


def scene_detail(pid: str, sid: str) -> dict[str, Any]:
    from .engine import _player

    with db.db() as conn:
        p = _player(conn, pid)
        sc = _scene(conn, sid)
        if sc["ord"] > p["ord"]:
            raise StoryError("That scene lies in the future.")
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
        card = scene_card(conn, pid, sc, _progress(conn, pid).get(sid), p["location_id"], names)
        chars = []
        for c in card["participants"]:
            ch = world_state.character(conn, c["id"])
            if ch:
                st = world_state.state(conn, pid, c["id"]) or {}
                chars.append({"id": ch["id"], "name": ch["name"], "house": ch["house"], "gender": ch["gender"], "culture": ch["culture"],
                              "tier": ch["tier"], "stats": ch["stats"], "titles": world_state.titles_at(conn, ch, sc["ord"])[:1],
                              "alive": c["alive"], "mood": st.get("mood", "calm")})
        return {**card, "beats": _beats(conn, pid, sc), "characters": chars,
                "location": {k: v for k, v in LOC.get(sc["location_id"] or "", {}).items()}}


# ------------------------------------------------------------------ actions
def enter(pid: str, sid: str, follow: bool = True) -> dict[str, Any]:
    """Join a scene: follow the story to its location and open (or resume) its conversation thread."""
    from .engine import _player

    with db.db() as conn:
        p = _player(conn, pid)
        sc = _scene(conn, sid)
        if sc["ord"] != p["ord"]:
            raise StoryError("Only scenes of the current chapter can be played.")
        prog = _progress(conn, pid).get(sid)
        if follow and sc["location_id"] and sc["location_id"] != p["location_id"]:
            conn.execute("UPDATE players SET location_id=?, day=day+1, updated_at=? WHERE id=?", (sc["location_id"], db.now_iso(), pid))
            simulation.log_event(conn, pid, "travel", f"You follow the story to {LOC[sc['location_id']]['name']}",
                                 sc["title"], p["ord"], location_id=sc["location_id"])
            try:
                kg.add_edge(conn, f"player_{pid}", "LOCATED_AT", sc["location_id"], valid_from=p["ord"], props={"story": sid},
                            layer="player", player_id=pid)
            except Exception:  # noqa: BLE001
                pass
        tid = (prog or {}).get("thread_id")
        if not tid or not conn.execute("SELECT 1 FROM threads WHERE id=?", (tid,)).fetchone():
            alive, _ = _alive_cast(conn, pid, sc, sc["ord"])
            tid = db.new_id("t_")
            now = db.now_iso()
            conn.execute(
                """INSERT INTO threads(id, player_id, kind, title, character_ids, location_id, ord, scene_id, created_at, updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (tid, pid, "scene", sc["title"][:160], db.dumps(alive), sc["location_id"] or p["location_id"], p["ord"], sid, now, now))
            conn.execute("INSERT INTO messages(thread_id, role, speaker_id, content, meta, created_at) VALUES(?,?,?,?,?,?)",
                         (tid, "narrator", None, sc["summary"], db.dumps({"scene": sid, "kind": "scene_open"}), now))
            try:
                kg.upsert_node(conn, tid, "Conversation", sc["title"][:80], {"kind": "scene", "scene": sid, "ord": p["ord"]},
                               layer="player", player_id=pid)
                kg.add_edge(conn, tid, "LINKED_TO", sid, props={"relation": "plays"}, layer="player", player_id=pid)
            except Exception:  # noqa: BLE001
                pass
            plots.link_thread(conn, pid, tid, alive)
        conn.execute(
            """INSERT INTO story_progress(player_id, scene_id, status, beat_index, thread_id, updated_at) VALUES(?,?,?,?,?,?)
               ON CONFLICT(player_id, scene_id) DO UPDATE SET status=CASE WHEN status='completed' THEN status ELSE 'in_progress' END,
               thread_id=excluded.thread_id, updated_at=excluded.updated_at""",
            (pid, sid, "in_progress", (prog or {}).get("beat_index", 0), tid, db.now_iso()))
    return {**scene_detail(pid, sid), "thread_id": tid}


def play_beat(pid: str, sid: str, index: int) -> dict[str, Any]:
    """Record that canon beat `index` was performed (it becomes part of the scene's transcript)."""
    with db.db() as conn:
        sc = _scene(conn, sid)
        prog = _progress(conn, pid).get(sid)
        if not prog or not prog.get("thread_id"):
            raise StoryError("Enter the scene first.")
        beats = _beats(conn, pid, sc)
        if not 0 <= index < len(beats):
            raise StoryError("No such beat.")
        if index >= prog["beat_index"]:
            b = beats[index]
            conn.execute("INSERT INTO messages(thread_id, role, speaker_id, content, meta, created_at) VALUES(?,?,?,?,?,?)",
                         (prog["thread_id"], "character" if b["speaker_id"] else "narrator", b["speaker_id"],
                          b["text"] if b["speaker_id"] else f"{b['speaker_name']}: {b['text']}",
                          db.dumps({"canon": True, "scene": sid, "beat": index}), db.now_iso()))
            conn.execute("UPDATE story_progress SET beat_index=?, updated_at=? WHERE player_id=? AND scene_id=?",
                         (index + 1, db.now_iso(), pid, sid))
            conn.execute("UPDATE threads SET message_count=message_count+1, updated_at=? WHERE id=?", (db.now_iso(), prog["thread_id"]))
        return {"beat_index": max(prog["beat_index"], index + 1), "total": len(beats)}


def complete(pid: str, sid: str, skipped: bool = False) -> dict[str, Any]:
    from .engine import _player

    with db.db() as conn:
        p = _player(conn, pid)
        sc = _scene(conn, sid)
        conn.execute(
            """INSERT INTO story_progress(player_id, scene_id, status, beat_index, updated_at) VALUES(?,?,?,?,?)
               ON CONFLICT(player_id, scene_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at""",
            (pid, sid, "skipped" if skipped else "completed", 0, db.now_iso()))
        if not skipped:
            simulation.log_event(conn, pid, "scene", f"Scene witnessed: {sc['title']}", sc["summary"][:300], p["ord"],
                                 sc["participants"][:6], sc["location_id"])
            # Witnessing a scene makes its cast familiar with you.
            from . import relationships

            for cid in _alive_cast(conn, pid, sc, sc["ord"])[0][:6]:
                relationships.apply_player_delta(conn, p, cid, {"familiarity": 4}, f"shared the scene '{sc['title'][:60]}'", p["ord"])
    ch = chapter(pid)
    return {"chapter": ch, "next_scene_id": ch["current_scene_id"]}


OPTIONS_TIMEOUT = 12.0


async def options(pid: str, sid: str, target_id: str | None = None) -> list[dict[str, Any]]:
    """Suggested replies for the player (like an RPG dialogue wheel), grounded in the scene so far."""
    from .engine import _player

    with db.db() as conn:
        p = _player(conn, pid)
        sc = _scene(conn, sid)
        prog = _progress(conn, pid).get(sid) or {}
        beats = _beats(conn, pid, sc)
        upto = max(1, prog.get("beat_index", 0))
        recent = beats[max(0, upto - 8):upto]
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
        alive, _ = _alive_cast(conn, pid, sc, sc["ord"])
        focus = target_id if target_id in alive else (recent[-1]["speaker_id"] if recent and recent[-1]["speaker_id"] in alive else (alive[0] if alive else None))
    fname = names.get(focus or "", "them")
    system = ("You write dialogue options for the player in a Game of Thrones role-playing game. Options must fit the exact moment, "
              "be in-world (no modern idioms), short (max 18 words), and offer meaningfully different approaches. Respond with JSON only.")
    transcript = "\n".join(f"{b['speaker_name']}: {b['text']}" for b in recent)
    prompt = (f"Scene: {sc['title']} ({label(sc['ord'])}). Player: {p['name']}, {p['background_name']}"
              f"{', sworn to House ' + p['allegiance'].title() if p.get('allegiance') else ''}.\nWhat was just said:\n{transcript}\n\n"
              f"Write 4 things the player could say to {fname}. "
              'Return {"options": [{"text": "...", "intent": "say|persuade|charm|deceive|insight|intimidate|lore|help"}]}.')
    try:  # a dialogue wheel must never stall the scene: fall back to grounded templates
        data = await asyncio.wait_for(agents.llm_json(system, prompt, "story:options", max_tokens=500), timeout=OPTIONS_TIMEOUT)
    except asyncio.TimeoutError:
        data = None
    out: list[dict[str, Any]] = []
    if isinstance(data, dict):
        for o in (data.get("options") or [])[:4]:
            if isinstance(o, dict) and str(o.get("text") or "").strip():
                intent = o.get("intent") if o.get("intent") in ("say", "persuade", "charm", "deceive", "insight", "intimidate", "lore", "help") else "say"
                out.append({"text": str(o["text"]).strip()[:200], "intent": intent, "target_id": focus})
    if not out:
        last = recent[-1]["text"] if recent else ""
        out = [
            {"text": f"Forgive me, {fname.split()[0]} — what do you mean by that?", "intent": "say", "target_id": focus},
            {"text": f"I am {p['name']}. My sword is yours, if you will have it.", "intent": "help", "target_id": focus},
            {"text": "You do not believe that. I can see it in your eyes.", "intent": "insight", "target_id": focus},
            {"text": "Listen to me — there is a better way than this.", "intent": "persuade", "target_id": focus},
        ]
        if "?" in last:
            out[0] = {"text": "Let me answer that, if I may.", "intent": "say", "target_id": focus}
    return out


def scene_context(conn: sqlite3.Connection, thread: dict[str, Any], character_id: str, pid: str) -> dict[str, Any] | None:
    """What a character needs to know to act inside a story scene: the moment, the lines so far, and
    what they themselves were about to say in canon (an anchor for staying in character)."""
    sid = thread.get("scene_id")
    if not sid:
        return None
    sc = db.row_to_dict(conn.execute("SELECT * FROM canon_scenes WHERE id=?", (sid,)).fetchone())
    if not sc:
        return None
    prog = _progress(conn, pid).get(sid) or {}
    beats = _beats(conn, pid, sc)
    upto = prog.get("beat_index", 0)
    played = beats[max(0, upto - 12):upto]
    upcoming_own = [b["text"] for b in beats[upto:] if b["speaker_id"] == character_id][:2]
    own_here = [b["text"] for b in beats if b["speaker_id"] == character_id][:4]
    events = [db.row_to_dict(conn.execute("SELECT title, description FROM canon_events WHERE id=?", (e,)).fetchone()) for e in sc["events"]]
    return {"title": sc["title"], "summary": sc["summary"], "played": played, "upcoming_own": upcoming_own, "own_here": own_here,
            "events": [e for e in events if e], "progress": f"{upto}/{len(beats)}"}
