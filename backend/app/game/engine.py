"""Game engine: orchestration of players, time, travel, conversations and consequences."""
from __future__ import annotations

import random
import re
import sqlite3
import zlib
from typing import Any

from .. import db, snapshots
from ..canon import world
from ..canon.timeline import MAX_ORD, from_ord, label, to_ord
from ..graph import store as kg
from ..memory import service as memory
from . import agents, behavior, jobs, knowledge, mechanics, plots, relationships, simulation, world_state
from .affect import STIMULI, check_modifier
from .reflection import REFLECT_EVERY


class GameError(ValueError):
    pass


def _guard() -> None:
    if snapshots.maintenance.is_set():
        raise GameError("The realm is being restored. Try again in a moment.")


# ------------------------------------------------------------------ players
def _player(conn: sqlite3.Connection, pid: str) -> dict[str, Any]:
    p = db.row_to_dict(conn.execute("SELECT * FROM players WHERE id=?", (pid,)).fetchone())
    if not p:
        raise GameError("Player not found")
    bg = mechanics.BACKGROUNDS.get(p["background"], {})
    p["background_name"] = bg.get("name", p["background"])
    p["label"] = label(p["ord"])
    s, e = from_ord(p["ord"])
    p["season"], p["episode"] = s, e
    return p


def suggested_locations(ord_: int) -> list[dict[str, Any]]:
    with db.db() as conn:
        counts: dict[str, list[str]] = {}
        for c in db.rows_to_dicts(conn.execute("SELECT * FROM characters WHERE tier IN ('major','supporting')").fetchall()):
            if not world_state.is_alive(c, None, ord_) or c.get("death_ord") == 0:
                continue
            loc = world_state.canon_location(c, ord_)
            if loc:
                counts.setdefault(loc, []).append(c["name"])
    out = [{"id": k, "name": world_state.LOCATIONS[k]["name"], "characters": v[:8], "count": len(v)} for k, v in counts.items()]
    return sorted(out, key=lambda x: -x["count"])


def create_player(name: str, background: str, *, allegiance: str | None = None, bio: str = "", season: int = 1,
                  episode: int = 1, location_id: str | None = None) -> dict[str, Any]:
    _guard()
    name = name.strip()
    if not name or len(name) > 60:
        raise GameError("Name must be 1-60 characters")
    bg = mechanics.BACKGROUNDS.get(background)
    if not bg:
        raise GameError(f"Unknown background '{background}'")
    ord_ = to_ord(season, episode)
    if allegiance and allegiance not in {h["id"] for h in world.HOUSES}:
        raise GameError("Unknown house")
    allegiance = allegiance or bg.get("allegiance")
    if not location_id:
        sugg = suggested_locations(ord_)
        location_id = sugg[0]["id"] if sugg else "kings_landing"
    if location_id not in world_state.LOCATIONS:
        raise GameError("Unknown location")
    pid = db.new_id("p_")
    skills = {s: 0 for s in mechanics.SKILLS} | bg["skills"]
    rep = dict(bg["reputation"])
    if allegiance:
        rep[f"house_{allegiance}"] = rep.get(f"house_{allegiance}", 0) + 20
    initial = {"ord": ord_, "location_id": location_id, "gold": bg["gold"], "health": bg["health"], "skills": skills,
               "reputation": rep, "inventory": bg["inventory"]}
    now = db.now_iso()
    with db.db() as conn:
        conn.execute(
            """INSERT INTO players(id,name,background,allegiance,bio,ord,location_id,day,gold,health,max_health,renown,skills,reputation,
               inventory,flags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?,?,0,?,?,?,?,?,?)""",
            (pid, name, background, allegiance, bio.strip()[:1000], ord_, location_id, bg["gold"], bg["health"], bg["health"],
             db.dumps(skills), db.dumps(rep), db.dumps(bg["inventory"]), db.dumps({"initial": initial}), now, now))
        world_state.init_world(conn, pid, ord_)
        _player_graph(conn, pid, name, background, allegiance, location_id, ord_)
        simulation.log_event(conn, pid, "start", "Your story begins",
                             f"{name}, {bg['name']}, arrives at {world_state.LOCATIONS[location_id]['name']} in {label(ord_)}.", ord_)
        return _player(conn, pid)


def _player_graph(conn: sqlite3.Connection, pid: str, name: str, background: str, allegiance: str | None, loc: str, ord_: int) -> None:
    try:
        kg.upsert_node(conn, f"player_{pid}", "Player", name, {"background": background, "ord": ord_}, layer="player", player_id=pid)
        if allegiance:
            kg.add_edge(conn, f"player_{pid}", "PLEDGED_TO", f"house_{allegiance}", layer="player", player_id=pid)
        kg.add_edge(conn, f"player_{pid}", "LOCATED_AT", loc, valid_from=ord_, layer="player", player_id=pid)
    except Exception:  # noqa: BLE001
        pass


def list_players() -> list[dict[str, Any]]:
    with db.db() as conn:
        rows = db.rows_to_dicts(conn.execute("SELECT * FROM players ORDER BY updated_at DESC").fetchall())
        for r in rows:
            r["label"] = label(r["ord"])
            r["background_name"] = mechanics.BACKGROUNDS.get(r["background"], {}).get("name", r["background"])
            r["location_name"] = world_state.LOCATIONS.get(r["location_id"], {}).get("name")
            r["threads"] = conn.execute("SELECT COUNT(*) FROM threads WHERE player_id=?", (r["id"],)).fetchone()[0]
        return rows


def delete_player(pid: str) -> dict[str, Any]:
    _guard()
    with db.db() as conn:
        _player(conn, pid)
        kg.delete_player_layer(conn, pid)
        conn.execute("DELETE FROM wiki_revisions WHERE page_id IN (SELECT id FROM wiki_pages WHERE scope=?)", (pid,))
        conn.execute("DELETE FROM wiki_pages WHERE scope=?", (pid,))
        conn.execute("DELETE FROM wiki_log WHERE scope=?", (pid,))
        conn.execute("DELETE FROM jobs WHERE player_id=?", (pid,))
        conn.execute("DELETE FROM players WHERE id=?", (pid,))  # cascades to every player-scoped table
    return {"deleted": pid}


def reset_player_world(pid: str) -> dict[str, Any]:
    """Return one playthrough to its initial state (called after archiving)."""
    with db.db() as conn:
        p = _player(conn, pid)
        init = (p["flags"] or {}).get("initial") or {}
        kg.delete_player_layer(conn, pid)
        for t in ("threads", "memories", "player_relationships", "char_relationships", "relationship_log", "quests", "events",
                  "character_states", "faction_states", "plot_threads", "canon_outcomes", "facts", "fact_knowledge", "thread_links"):
            conn.execute(f"DELETE FROM {t} WHERE player_id=?", (pid,))
        conn.execute("DELETE FROM wiki_revisions WHERE page_id IN (SELECT id FROM wiki_pages WHERE scope=?)", (pid,))
        conn.execute("DELETE FROM wiki_pages WHERE scope=?", (pid,))
        conn.execute("DELETE FROM jobs WHERE player_id=?", (pid,))
        ord_ = int(init.get("ord", p["ord"]))
        conn.execute(
            """UPDATE players SET ord=?, location_id=?, day=1, gold=?, health=?, max_health=?, renown=0, skills=?, reputation=?, inventory=?,
               flags=?, updated_at=? WHERE id=?""",
            (ord_, init.get("location_id", p["location_id"]), init.get("gold", p["gold"]), init.get("health", p["max_health"]),
             init.get("health", p["max_health"]), db.dumps(init.get("skills", p["skills"])), db.dumps(init.get("reputation", {})),
             db.dumps(init.get("inventory", [])), db.dumps({"initial": init}), db.now_iso(), pid))
        world_state.init_world(conn, pid, ord_)
        _player_graph(conn, pid, p["name"], p["background"], p["allegiance"], init.get("location_id", p["location_id"]), ord_)
        simulation.log_event(conn, pid, "start", "The story begins anew", "The world has been restored to how it was.", ord_)
    return {"player_id": pid, "reset_to": label(ord_)}


def player_state(pid: str) -> dict[str, Any]:
    with db.db() as conn:
        p = _player(conn, pid)
        ord_ = p["ord"]
        present = world_state.present_characters(conn, pid, p["location_id"], ord_)
        here = []
        for c in present[:40]:
            rel = relationships.get_player_rel(conn, p, c["id"])
            st = c.get("state") or {}
            here.append({"id": c["id"], "name": c["name"], "house": c["house"], "tier": c["tier"], "titles": world_state.titles_at(conn, c, ord_)[:2],
                         "gender": c["gender"], "culture": c["culture"], "stats": c["stats"],
                         "mood": st.get("mood", "calm"), "relationship": {k: rel[k] for k in relationships.DIMS},
                         "stance": rel["stance"], "disposition": rel["disposition"], "storyline": c.get("storyline")})
        loc = world_state.LOCATIONS[p["location_id"]]
        travel = []
        for l in world.LOCATIONS:
            if l["id"] == p["location_id"]:
                continue
            cost = world_state.travel_cost(p["location_id"], l["id"])
            travel.append({"id": l["id"], "name": l["name"], "region": l["region"], "x": l["x"], "y": l["y"], **cost})
        quests = db.rows_to_dicts(conn.execute("SELECT * FROM quests WHERE player_id=? ORDER BY status='active' DESC, updated_at DESC",
                                               (pid,)).fetchall())
        events = db.rows_to_dicts(conn.execute("SELECT * FROM events WHERE player_id=? ORDER BY id DESC LIMIT 40", (pid,)).fetchall())
        threads = db.rows_to_dicts(conn.execute("SELECT * FROM threads WHERE player_id=? ORDER BY updated_at DESC LIMIT 30", (pid,)).fetchall())
        plots_ = db.rows_to_dicts(conn.execute("SELECT * FROM plot_threads WHERE player_id=? ORDER BY status='active' DESC, tension DESC LIMIT 20",
                                               (pid,)).fetchall())
        ep = conn.execute("SELECT title FROM episodes WHERE ord=?", (ord_,)).fetchone()
        return {
            "player": p, "episode_title": ep["title"] if ep else "", "max_ord": MAX_ORD,
            "location": {**loc, "region_name": next((r["name"] for r in world.REGIONS if r["id"] == loc["region"]), loc["region"])},
            "present": here, "travel": travel, "quests": quests, "events": events, "threads": threads, "plots": plots_,
            "factions": world_state.factions(conn, pid)[:14],
            "divergences": conn.execute("SELECT COUNT(*) FROM canon_outcomes WHERE player_id=? AND outcome!='occurred'", (pid,)).fetchone()[0],
            "intents": [{"id": k, **{kk: vv for kk, vv in v.items() if kk in ("label", "description", "skill")}} for k, v in mechanics.INTENTS.items()],
        }


def travel(pid: str, location_id: str) -> dict[str, Any]:
    _guard()
    with db.db() as conn:
        p = _player(conn, pid)
        if location_id not in world_state.LOCATIONS:
            raise GameError("Unknown destination")
        if location_id == p["location_id"]:
            raise GameError("You are already there")
        cost = world_state.travel_cost(p["location_id"], location_id)
        if p["gold"] < cost["gold"]:
            raise GameError(f"Passage across the Narrow Sea costs {cost['gold']} gold")
        rng = random.Random(zlib.crc32(f"{pid}:{p['day']}:{location_id}".encode()))
        health, gold = p["health"], p["gold"] - cost["gold"]
        encounter = None
        if rng.random() < min(0.45, 0.05 * cost["days"]):
            check = rng.randint(1, 20) + int(p["skills"].get("survival", 0)) + int(p["skills"].get("combat", 0)) // 2
            if check >= 12:
                encounter = {"kind": "ambush_repelled", "text": "Brigands ambush you on the road; you drive them off.", "health": 0, "gold": 0}
                renown_gain = 2
            else:
                lost_h, lost_g = rng.randint(2, 6), min(gold, rng.randint(3, 15))
                encounter = {"kind": "ambush", "text": f"Brigands fall upon you. You lose {lost_h} health and {lost_g} gold.",
                             "health": -lost_h, "gold": -lost_g}
                health, gold = max(1, health - lost_h), gold - lost_g
                renown_gain = 0
            conn.execute("UPDATE players SET renown=renown+? WHERE id=?", (renown_gain, pid))
        conn.execute("UPDATE players SET location_id=?, day=day+?, gold=?, health=?, updated_at=? WHERE id=?",
                     (location_id, cost["days"], gold, health, db.now_iso(), pid))
        try:
            kg.add_edge(conn, f"player_{pid}", "LOCATED_AT", location_id, valid_from=p["ord"], props={"day": p["day"] + cost["days"]},
                        layer="player", player_id=pid)
        except Exception:  # noqa: BLE001
            pass
        dest = world_state.LOCATIONS[location_id]["name"]
        simulation.log_event(conn, pid, "travel", f"Journey to {dest}",
                             f"{cost['days']} days on the road." + (f" {encounter['text']}" if encounter else ""), p["ord"],
                             location_id=location_id)
        completed = _progress_quests(conn, p, "travel_to", location_id)
        return {"arrived": location_id, "name": dest, "cost": cost, "encounter": encounter, "quests_completed": completed}


async def advance(pid: str, steps: int = 1) -> dict[str, Any]:
    _guard()
    steps = max(1, min(5, int(steps)))
    with db.db() as conn:
        p = _player(conn, pid)
    reports = []
    ord_ = p["ord"]
    for _ in range(steps):
        if ord_ >= MAX_ORD:
            break
        ord_ += 1
        with db.db() as conn:
            conn.execute("UPDATE players SET ord=?, day=day+14, updated_at=? WHERE id=?", (ord_, db.now_iso(), pid))
        reports.append(await simulation.tick(pid, ord_))
    with db.db() as conn:
        p = _player(conn, pid)
        touched_chars = sorted({x for r in reports for o in r.get("offscreen", []) for x in (o["a"], o["b"])})
        pairs = [[o["a"], o["b"]] for r in reports for o in r.get("offscreen", [])]
        plot_ids = [pl["id"] for r in reports for pl in r.get("plots", []) if pl.get("id")]
    jobs.enqueue("wiki_ingest", {"scope": pid, "characters": touched_chars[:12], "pairs": pairs[:12], "plots": plot_ids,
                                 "reason": f"world advanced to {label(ord_)}"}, pid)
    return {"player": p, "reports": reports, "at_end": ord_ >= MAX_ORD}


# ------------------------------------------------------------------ threads
def _thread(conn: sqlite3.Connection, tid: str) -> dict[str, Any]:
    t = db.row_to_dict(conn.execute("SELECT * FROM threads WHERE id=?", (tid,)).fetchone())
    if not t:
        raise GameError("Thread not found")
    return t


def _names(conn: sqlite3.Connection) -> dict[str, str]:
    return {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}


def _messages(conn: sqlite3.Connection, tid: str, limit: int = 200) -> list[dict[str, Any]]:
    names = _names(conn)
    rows = db.rows_to_dicts(conn.execute("SELECT * FROM (SELECT * FROM messages WHERE thread_id=? ORDER BY id DESC LIMIT ?) ORDER BY id",
                                         (tid, limit)).fetchall())
    for r in rows:
        r["speaker_name"] = names.get(r["speaker_id"] or "", None)
    return rows


async def start_thread(pid: str, character_ids: list[str], kind: str = "chat", title: str | None = None) -> dict[str, Any]:
    _guard()
    if kind not in ("chat", "scene", "raven"):
        raise GameError("kind must be chat, scene or raven")
    character_ids = list(dict.fromkeys(character_ids))
    if not character_ids:
        raise GameError("Choose at least one character")
    if kind in ("chat", "raven") and len(character_ids) != 1:
        raise GameError("A chat or raven is with exactly one character")
    with db.db() as conn:
        p = _player(conn, pid)
        names = _names(conn)
        present = {c["id"] for c in world_state.present_characters(conn, pid, p["location_id"], p["ord"])}
        for cid in character_ids:
            c = world_state.character(conn, cid)
            if not c:
                raise GameError(f"Unknown character {cid}")
            if not world_state.is_alive(c, world_state.state(conn, pid, cid), p["ord"]) or c.get("death_ord") == 0:
                raise GameError(f"{c['name']} is dead in this world.")
            if cid == "night_king" and kind == "raven":
                raise GameError("No raven flies to the Night King.")
            if kind != "raven" and cid not in present:
                raise GameError(f"{c['name']} is not here. Travel to them or send a raven.")
        tid = db.new_id("t_")
        now = db.now_iso()
        t_title = title or (("Letter to " if kind == "raven" else "") + ", ".join(names[c] for c in character_ids))
        conn.execute(
            """INSERT INTO threads(id, player_id, kind, title, character_ids, location_id, ord, created_at, updated_at)
               VALUES(?,?,?,?,?,?,?,?,?)""",
            (tid, pid, kind, t_title[:160], db.dumps(character_ids), p["location_id"], p["ord"], now, now))
        try:
            kg.upsert_node(conn, tid, "Conversation", t_title[:80], {"kind": kind, "ord": p["ord"]}, layer="player", player_id=pid)
        except Exception:  # noqa: BLE001
            pass
        plots.link_thread(conn, pid, tid, character_ids)
        # Link to earlier conversations with the same people (continuity across threads).
        for r in conn.execute("SELECT id, character_ids FROM threads WHERE player_id=? AND id!=? ORDER BY updated_at DESC LIMIT 30", (pid, tid)):
            prev = set(db.row_to_dict(r)["character_ids"])  # type: ignore[index]
            if prev & set(character_ids):
                conn.execute("""INSERT OR IGNORE INTO thread_links(player_id, from_thread, to_kind, to_id, relation, note, created_at)
                                VALUES(?,?,?,?,?,?,?)""", (pid, tid, "thread", r["id"], "continues", "shared participants", now))
                try:
                    kg.add_edge(conn, tid, "LINKED_TO", r["id"], props={"relation": "continues"}, layer="player", player_id=pid)
                except Exception:  # noqa: BLE001
                    pass
        loc_name = world_state.LOCATIONS[p["location_id"]]["name"]
        whom = ", ".join(names[c] for c in character_ids)
    if kind == "scene":
        opening, _fb = await agents.narrate(
            "You are the narrator of a Game of Thrones role-playing game. Write a vivid 2-3 sentence scene opening in present tense. "
            "No dialogue. Never mention events after the given episode.",
            f"{label(p['ord'])}, {loc_name}. Present: {whom}. The player, {p['name']} ({p['background_name']}), joins them.",
            "narrator:scene", f"{loc_name}, {label(p['ord'])}. {whom} are gathered as {p['name']} approaches.")
    elif kind == "raven":
        opening = f"You seal a letter for {whom} and give it to the maester's raven."
    else:
        opening = f"You approach {whom} at {loc_name}."
    with db.db() as conn:
        conn.execute("INSERT INTO messages(thread_id, role, speaker_id, content, meta, created_at) VALUES(?,?,?,?,?,?)",
                     (tid, "narrator", None, opening, "{}", db.now_iso()))
        if kind != "raven":
            _progress_quests(conn, p, "talk_to", *character_ids)
        return get_thread(tid, conn=conn)


def get_thread(tid: str, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    if conn is None:
        with db.db() as c:
            return get_thread(tid, c)
    t = _thread(conn, tid)
    names = _names(conn)
    t["characters"] = [{"id": c, "name": names.get(c, c)} for c in t["character_ids"]]
    t["messages"] = _messages(conn, tid)
    t["links"] = db.rows_to_dicts(conn.execute("SELECT * FROM thread_links WHERE from_thread=? OR (to_kind='thread' AND to_id=?)",
                                               (tid, tid)).fetchall())
    p = _player(conn, t["player_id"])
    t["relationships"] = {}
    for c in t["character_ids"]:
        rel = relationships.get_player_rel(conn, p, c)
        st = world_state.state(conn, p["id"], c) or {}
        t["relationships"][c] = {**{k: rel[k] for k in relationships.DIMS}, "stance": rel["stance"], "disposition": rel["disposition"],
                                 "mood": st.get("mood", "calm"), "affect": st.get("affect") or {}}
    return t


def list_threads(pid: str) -> list[dict[str, Any]]:
    with db.db() as conn:
        rows = db.rows_to_dicts(conn.execute("SELECT * FROM threads WHERE player_id=? ORDER BY updated_at DESC", (pid,)).fetchall())
        names = _names(conn)
        for r in rows:
            r["characters"] = [{"id": c, "name": names.get(c, c)} for c in r["character_ids"]]
            last = conn.execute("SELECT content, role FROM messages WHERE thread_id=? ORDER BY id DESC LIMIT 1", (r["id"],)).fetchone()
            r["last_message"] = last["content"][:160] if last else ""
            r["link_count"] = conn.execute("SELECT COUNT(*) FROM thread_links WHERE from_thread=?", (r["id"],)).fetchone()[0]
        return rows


def delete_thread(tid: str, delete_memories: bool = False) -> dict[str, Any]:
    _guard()
    with db.db() as conn:
        t = _thread(conn, tid)
        n = 0
        if delete_memories:
            for r in conn.execute("SELECT id FROM memories WHERE thread_id=?", (tid,)).fetchall():
                memory.delete_memory(conn, r["id"])
                n += 1
        conn.execute("DELETE FROM thread_links WHERE from_thread=? OR (to_kind='thread' AND to_id=?)", (tid, tid))
        kg.delete_node(conn, tid)
        conn.execute("DELETE FROM threads WHERE id=?", (tid,))
        return {"deleted": tid, "player_id": t["player_id"], "memories_deleted": n}


def _progress_quests(conn: sqlite3.Connection, p: dict[str, Any], kind: str, *targets: str) -> list[str]:
    completed = []
    for q in db.rows_to_dicts(conn.execute("SELECT * FROM quests WHERE player_id=? AND status='active'", (p["id"],)).fetchall()):
        changed = False
        for o in q["objectives"]:
            if not o.get("done") and o["type"] == kind and o["target"] in targets:
                o["done"] = True
                changed = True
        if not changed:
            continue
        done = all(o.get("done") for o in q["objectives"]) if q["objectives"] else False
        conn.execute("UPDATE quests SET objectives=?, status=?, updated_at=? WHERE id=?",
                     (db.dumps(q["objectives"]), "completed" if done else "active", db.now_iso(), q["id"]))
        if done:
            rw = q["reward"] or {}
            conn.execute("UPDATE players SET gold=gold+?, renown=renown+? WHERE id=?", (int(rw.get("gold", 0)), int(rw.get("renown", 0)), p["id"]))
            if q["giver_id"]:
                relationships.apply_player_delta(conn, p, q["giver_id"], {"trust": 12, "respect": 10, "affection": 6},
                                                 f"completed quest '{q['title']}'", p["ord"])
                behavior.record_pattern(conn, p["id"], q["giver_id"], "helped_by", f"player:{p['id']}", p["name"], p["ord"])
                memory.add_memory(conn, character_id=q["giver_id"], player_id=p["id"], kind="episodic",
                                  content=f"{p['name']} did what I asked: {q['title']}.", importance=0.75, about=["player"], ord_=p["ord"])
            simulation.log_event(conn, p["id"], "quest", f"Quest completed: {q['title']}", f"Reward: {rw}", p["ord"])
            completed.append(q["title"])
    return completed


STIMULUS_FOR_INTENT = {"intimidate": "threatened", "charm": "flattered", "gift": "gifted", "help": "helped", "duel": "attacked"}


async def send_message(tid: str, content: str, intent: str = "say", target_id: str | None = None, gold: int = 0) -> dict[str, Any]:
    _guard()
    content = (content or "").strip()
    if intent not in mechanics.INTENTS:
        raise GameError("Unknown intent")
    if not content and intent not in ("gift", "help", "duel"):
        raise GameError("Say something")
    rng = random.Random()
    with db.db() as conn:
        t = _thread(conn, tid)
        p = _player(conn, t["player_id"])
        if t["kind"] != "raven" and t["location_id"] != p["location_id"]:
            raise GameError("You have left this place. Start a new conversation or send a raven.")
        present_chars = []
        for cid in t["character_ids"]:
            c = world_state.character(conn, cid)
            if c and _alive_for_thread(t, c, world_state.state(conn, p["id"], cid), p["ord"]):
                present_chars.append(c)
        if not present_chars:
            raise GameError("No one here can answer you any more.")
        extra = ""
        if intent == "gift":
            gold = int(gold or 0)
            if gold <= 0 or gold > p["gold"]:
                raise GameError("Offer a gold amount you actually have")
            conn.execute("UPDATE players SET gold=gold-? WHERE id=?", (gold, p["id"]))
            p["gold"] -= gold
            extra = f" [offers {gold} gold]"
        shown = (content or {"gift": "(offers a gift)", "help": "(offers to help)", "duel": "(draws steel)"}[intent]) + extra
        conn.execute("INSERT INTO messages(thread_id, role, speaker_id, content, meta, created_at) VALUES(?,?,?,?,?,?)",
                     (tid, "player", None, shown, db.dumps({"intent": intent, "target": target_id, "gold": gold}), db.now_iso()))
        history = _messages(conn, tid, 30)
        last_speakers = [m["speaker_id"] for m in history if m["role"] == "character"]
        if t["kind"] == "scene":
            responders = agents.choose_responders(conn, present_chars, content, target_id, last_speakers, rng=rng)
        else:
            responders = [present_chars[0]["id"]]
        _link_mentions(conn, p, tid, content, t["character_ids"])
    return await _run_responders(tid, p, responders, [c["id"] for c in present_chars], content, intent, gold, history, t, rng)


async def continue_scene(tid: str) -> dict[str, Any]:
    _guard()
    rng = random.Random()
    with db.db() as conn:
        t = _thread(conn, tid)
        p = _player(conn, t["player_id"])
        present_chars = [c for c in (world_state.character(conn, cid) for cid in t["character_ids"])
                         if c and _alive_for_thread(t, c, world_state.state(conn, p["id"], c["id"]), p["ord"])]
        if len(present_chars) < 1:
            raise GameError("No one is left in this scene.")
        history = _messages(conn, tid, 30)
        last_speakers = [m["speaker_id"] for m in history if m["role"] == "character"]
        last_text = next((m["content"] for m in reversed(history) if m["role"] in ("character", "player")), "")
        responders = agents.choose_responders(conn, present_chars, last_text, None, last_speakers, max_n=1, rng=rng)
    return await _run_responders(tid, p, responders, [c["id"] for c in present_chars], "", "continue", 0, history, t, rng)


def _alive_for_thread(t: dict[str, Any], c: dict[str, Any], st: dict[str, Any] | None, ord_: int) -> bool:
    if t.get("scene_id") and int(t.get("ord") or 0) == ord_:
        return world_state.is_alive_in_scene(c, st, ord_)
    return world_state.is_alive(c, st, ord_)


def _link_mentions(conn: sqlite3.Connection, p: dict[str, Any], tid: str, content: str, in_thread: list[str]) -> None:
    text = content.lower()
    if not text:
        return
    for r in conn.execute("SELECT id, name FROM characters WHERE tier IN ('major','supporting')"):
        if r["id"] in in_thread:
            continue
        name = r["name"].lower()
        first = name.split()[0]
        if name in text or (len(first) > 4 and re.search(rf"\b{re.escape(first)}\b", text)):
            conn.execute("""INSERT OR IGNORE INTO thread_links(player_id, from_thread, to_kind, to_id, relation, note, created_at)
                            VALUES(?,?,?,?,?,?,?)""", (p["id"], tid, "character", r["id"], "mentions", content[:120], db.now_iso()))


async def _run_responders(tid: str, p: dict[str, Any], responders: list[str], present_ids: list[str], content: str, intent: str,
                          gold: int, history: list[dict[str, Any]], t: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    new_messages: list[dict[str, Any]] = []
    outcomes: list[dict[str, Any]] = []
    for cid in responders:
        with db.db() as conn:
            c = world_state.character(conn, cid)
            assert c is not None
            rel = relationships.get_player_rel(conn, p, cid)
            st = world_state.state(conn, p["id"], cid) or {}
            check = None
            duel_result = None
            if intent not in ("say", "continue", "gift", "help"):
                check = mechanics.roll_check(intent, p["skills"], c["stats"], trust=float(rel["trust"]),
                                             affect_mod=check_modifier(st.get("affect") or {}, intent), rng=rng)
            if intent == "duel":
                duel_result = mechanics.duel(int(p["skills"].get("combat", 0)), int(c["stats"].get("prowess", 5)), rng)
                if duel_result["winner"] == "character":
                    new_h = max(0, p["health"] - duel_result["damage"])
                    conn.execute("UPDATE players SET health=? WHERE id=?", (max(1, new_h), p["id"]))
                    p["health"] = max(1, new_h)
                else:
                    conn.execute("UPDATE players SET renown=renown+3 WHERE id=?", (p["id"],))
            ctx = agents.build_context(conn, player=p, character=c, thread=t, user_text=content, intent=intent, check=check,
                                       present_ids=present_ids, history=history, mode=t["kind"])
            if duel_result:
                ctx["user_text"] += (f" [Steel is drawn. Duel result: the {'player' if duel_result['winner'] == 'player' else 'you'} "
                                     f"prevails ({duel_result['player_total']} vs {duel_result['character_total']}).]")
        decision = await agents.character_turn(ctx)
        with db.db() as conn:
            msg, effect = _apply_decision(conn, p, c, t, decision, check, duel_result, intent, gold, present_ids)
            new_messages.append(msg)
            outcomes.append(effect)
            history = history + [msg]
    with db.db() as conn:
        conn.execute("UPDATE threads SET message_count=message_count+?, updated_at=? WHERE id=?",
                     (1 + len(new_messages), db.now_iso(), tid))
        t2 = _thread(conn, tid)
        unreflected = conn.execute("SELECT COUNT(*) FROM messages WHERE thread_id=? AND id>?", (tid, t2["reflected_upto"])).fetchone()[0]
        p2 = _player(conn, p["id"])
    if unreflected >= REFLECT_EVERY:
        jobs.enqueue("reflect_thread", {"thread_id": tid}, p["id"])
    return {"messages": new_messages, "outcomes": outcomes, "player": p2}


def _apply_decision(conn: sqlite3.Connection, p: dict[str, Any], c: dict[str, Any], t: dict[str, Any], d: dict[str, Any],
                    check: dict[str, Any] | None, duel_result: dict[str, Any] | None, intent: str, gold: int,
                    present_ids: list[str]) -> tuple[dict[str, Any], dict[str, Any]]:
    ord_ = p["ord"]
    cid = c["id"]
    who = f"player:{p['id']}"
    effect: dict[str, Any] = {"character_id": cid, "name": c["name"], "learned": []}
    # Relationship with the player (gift size and duel outcomes add to the agent's own judgement)
    delta = dict(d["relationship_delta"])
    if intent == "gift" and gold:
        greed = 1.0 - (c.get("personality") or {}).get("honor", 0.5) * 0.5
        bonus = min(12.0, (gold ** 0.5) * 1.5 * greed)
        delta["affection"] = delta.get("affection", 0) + bonus * 0.6
        delta["trust"] = delta.get("trust", 0) + bonus * 0.4
    if duel_result:
        if duel_result["winner"] == "player":
            delta["fear"] = delta.get("fear", 0) + 10
            delta["respect"] = delta.get("respect", 0) + 6
        delta["trust"] = delta.get("trust", 0) - 8
    rel = relationships.apply_player_delta(conn, p, cid, delta, f"{intent}: {(d['dialogue'] or d['action'])[:120]}", ord_)
    effect["relationship"] = rel
    # Emotion
    stim = STIMULUS_FOR_INTENT.get(intent) or d["appraisal"]
    if intent == "deceive" and check:
        stim = "deceived_detected" if check["outcome"] in ("failure", "critical_failure") else "deceived_undetected"
    if duel_result:
        stim = "won_fight" if duel_result["winner"] == "character" else "lost_fight"
    aff = behavior.update_affect(conn, p["id"], cid, stim if stim in STIMULI else "neutral")
    effect["emotion"] = aff.get("label")
    # Feelings toward others in the scene
    for f in d["feelings_toward_others"]:
        relationships.apply_char_delta(conn, p["id"], cid, f["id"], f["delta"], f"in conversation with {p['name']}: {f['why']}", ord_)
    # Learned behaviour from patterns (agent-reported + mechanically detected)
    patterns = set(d["patterns"])
    if intent == "deceive" and check and check["outcome"] in ("failure", "critical_failure"):
        patterns.add("deceived_by")
    if intent == "intimidate":
        patterns.add("threatened_by")
    if intent == "gift":
        patterns.add("gifted_by")
    if intent == "help":
        patterns.add("helped_by")
    if intent == "persuade" and check and check["outcome"] in ("success", "critical_success"):
        patterns.add("persuaded_by")
    patterns.add("talked_with")
    for pat in patterns:
        effect["learned"] += behavior.record_pattern(conn, p["id"], cid, pat, who, p["name"], ord_)
    # Memory: the speaker remembers; witnesses remember they saw it
    mem_content = (d["memory"] or {}).get("content") or         f"{p['name']} spoke with me at {world_state.LOCATIONS[p['location_id']]['name']}: \"{content_of(d, t)}\""
    memory.add_memory(conn, character_id=cid, player_id=p["id"], kind="episodic", content=mem_content,
                      importance=(d["memory"] or {}).get("importance", 0.4), emotion=aff.get("label"), about=["player"],
                      ord_=ord_, thread_id=t["id"])
    for other in present_ids:
        if other != cid:
            memory.add_memory(conn, character_id=other, player_id=p["id"], kind="episodic",
                              content=f"I watched {c['name']} and {p['name']}: {(d['dialogue'] or d['action'])[:220]}",
                              importance=0.3, about=["player", cid], counterpart_id=cid, ord_=ord_, thread_id=t["id"])
    # Facts / rumours: what was revealed becomes knowledge with provenance
    for f in d["facts_learned"]:
        fid = knowledge.add_fact(conn, p["id"], f["content"], subjects=[s for s in f["subjects"] if s], secrecy=f["secrecy"],
                                 source_thread=t["id"], origin="player", ord_=ord_)
        knowledge.learn(conn, fid, p["id"], cid, confidence=f["believed"], learned_from="player", channel="told", ord_=ord_)
        for other in present_ids:
            if other != cid:
                knowledge.learn(conn, fid, p["id"], other, confidence=f["believed"] * 0.8, learned_from="player", channel="witnessed", ord_=ord_)
    # Goals and quests
    if d["goal_update"]:
        behavior.add_goal(conn, p["id"], cid, d["goal_update"]["goal"], d["goal_update"]["priority"], "player")
    if d["quest"] and len(d["quest"]["objectives"]) > 0:
        valid_ids = {r["id"] for r in conn.execute("SELECT id FROM characters")} | set(world_state.LOCATIONS)
        objs = [o for o in d["quest"]["objectives"] if o["target"] in valid_ids]
        if objs:
            qid = db.new_id("q_")
            conn.execute(
                """INSERT INTO quests(id, player_id, title, description, giver_id, status, objectives, reward, ord, created_at, updated_at)
                   VALUES(?,?,?,?,?,'active',?,?,?,?,?)""",
                (qid, p["id"], d["quest"]["title"], d["quest"]["description"], cid, db.dumps(objs), db.dumps(d["quest"]["reward"]),
                 ord_, db.now_iso(), db.now_iso()))
            try:
                kg.upsert_node(conn, qid, "Quest", d["quest"]["title"], {"status": "active"}, layer="player", player_id=p["id"])
                kg.add_edge(conn, cid, "GAVE_QUEST", qid, layer="player", player_id=p["id"])
                kg.add_edge(conn, f"player_{p['id']}", "HAS_QUEST", qid, layer="player", player_id=p["id"])
            except Exception:  # noqa: BLE001
                pass
            simulation.log_event(conn, p["id"], "quest_new", f"New quest: {d['quest']['title']}", d["quest"]["description"], ord_, [cid])
            effect["quest"] = d["quest"]["title"]
    if intent == "persuade" and check and check["outcome"] in ("success", "critical_success"):
        effect["quests_completed"] = _progress_quests(conn, p, "persuade", cid)
    else:
        effect["quests_completed"] = _progress_quests(conn, p, "talk_to", cid)
    reveal = bool(check and check["intent"] == "insight" and check["outcome"] in ("success", "critical_success"))
    meta = {"action": d["action"], "thought": d["thought"], "thought_revealed": reveal, "emotion": aff.get("label"),
            "check": check, "duel": duel_result, "delta": rel.get("delta"), "stance": rel["stance"],
            "previous_stance": rel.get("previous_stance"), "learned": effect["learned"], "quest": effect.get("quest"),
            "llm": d.get("meta", {})}
    text = d["dialogue"] or (f"*{d['action']}*" if d["action"] else "…")
    cur = conn.execute("INSERT INTO messages(thread_id, role, speaker_id, content, meta, created_at) VALUES(?,?,?,?,?,?)",
                       (t["id"], "character", cid, text, db.dumps(meta), db.now_iso()))
    msg = {"id": cur.lastrowid, "thread_id": t["id"], "role": "character", "speaker_id": cid, "speaker_name": c["name"],
           "content": text, "meta": meta, "created_at": db.now_iso()}
    return msg, effect


def content_of(d: dict[str, Any], t: dict[str, Any]) -> str:
    return (d.get("dialogue") or d.get("action") or "")[:200]


def force_reflect(tid: str) -> int | None:
    with db.db() as conn:
        t = _thread(conn, tid)
    return jobs.enqueue("reflect_thread", {"thread_id": tid, "force": True}, t["player_id"])
