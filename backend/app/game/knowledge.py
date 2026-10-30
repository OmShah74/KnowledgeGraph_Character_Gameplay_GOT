"""Facts, rumours and theory of mind.

A *fact* is a proposition that exists in one player's world ("the player claims to carry a
letter from Lord Stark", "Varys knows the player is a Targaryen loyalist"). Characters come to
know facts by witnessing them, being told by the player, or hearing them from other characters.

Propagation (run on every world tick) moves facts along the social graph: a character who knows
a fact may pass it on to people at the same location (or, with ravens, anywhere) depending on

    p = (1 - secrecy) * gossip(teller) * closeness(teller -> listener) * novelty

gossip() rises with openness and cunning-for-profit, and falls with loyalty/honour when the fact
concerns someone the teller is loyal to. Confidence decays with every hop, so rumours blur.
This is what links conversation threads together: what you tell one character can resurface
in a completely different thread, through people you never spoke to.
"""
from __future__ import annotations

import random
import sqlite3
from typing import Any

from .. import db
from ..graph import store as kg
from . import behavior, relationships, world_state


def add_fact(conn: sqlite3.Connection, player_id: str, content: str, *, subjects: list[str] | None = None,
             secrecy: float = 0.3, truth: float = 1.0, source_thread: str | None = None,
             origin: str | None = None, ord_: int = 0) -> int:
    content = content.strip()[:500]
    if not content:
        raise ValueError("Empty fact")
    dup = conn.execute("SELECT id FROM facts WHERE player_id=? AND lower(content)=lower(?)", (player_id, content)).fetchone()
    if dup:
        return int(dup["id"])
    cur = conn.execute(
        """INSERT INTO facts(player_id, content, subject_ids, secrecy, truth, source_thread_id, origin_character_id, ord, created_at)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (player_id, content, db.dumps(subjects or []), max(0.0, min(1.0, secrecy)), max(0.0, min(1.0, truth)),
         source_thread, origin, ord_, db.now_iso()))
    fid = int(cur.lastrowid)
    try:
        kg.upsert_node(conn, f"fact_{fid}", "Fact", content[:80], {"content": content, "secrecy": secrecy, "truth": truth},
                       layer="player", player_id=player_id)
        for s in (subjects or [])[:5]:
            if conn.execute("SELECT 1 FROM kg_nodes WHERE id=?", (s,)).fetchone():
                kg.add_edge(conn, f"fact_{fid}", "CONCERNS", s, layer="player", player_id=player_id)
    except Exception:  # noqa: BLE001
        pass
    return fid


def learn(conn: sqlite3.Connection, fact_id: int, player_id: str, cid: str, *, confidence: float = 0.8,
          learned_from: str | None = None, channel: str = "told", ord_: int = 0) -> bool:
    cur = conn.execute(
        """INSERT OR IGNORE INTO fact_knowledge(fact_id, player_id, character_id, confidence, learned_from, channel, ord, created_at)
           VALUES(?,?,?,?,?,?,?,?)""",
        (fact_id, player_id, cid, round(max(0.05, min(1.0, confidence)), 3), learned_from, channel, ord_, db.now_iso()))
    if cur.rowcount:
        try:
            kg.add_edge(conn, cid, "KNOWS_FACT", f"fact_{fact_id}", props={"confidence": confidence, "from": learned_from,
                        "channel": channel}, valid_from=ord_, layer="player", player_id=player_id)
        except Exception:  # noqa: BLE001
            pass
    return bool(cur.rowcount)


def known_facts(conn: sqlite3.Connection, player_id: str, cid: str, limit: int = 12) -> list[dict[str, Any]]:
    return db.rows_to_dicts(conn.execute(
        """SELECT f.id, f.content, f.secrecy, f.truth, f.subject_ids, k.confidence, k.learned_from, k.channel, k.ord
           FROM fact_knowledge k JOIN facts f ON f.id=k.fact_id WHERE k.player_id=? AND k.character_id=?
           ORDER BY k.ord DESC, k.confidence DESC LIMIT ?""", (player_id, cid, limit)).fetchall())


def who_knows(conn: sqlite3.Connection, fact_id: int) -> list[dict[str, Any]]:
    return db.rows_to_dicts(conn.execute(
        """SELECT k.*, c.name FROM fact_knowledge k LEFT JOIN characters c ON c.id=k.character_id
           WHERE k.fact_id=? ORDER BY k.ord, k.created_at""", (fact_id,)).fetchall())


def list_facts(conn: sqlite3.Connection, player_id: str, limit: int = 100) -> list[dict[str, Any]]:
    facts = db.rows_to_dicts(conn.execute("SELECT * FROM facts WHERE player_id=? ORDER BY id DESC LIMIT ?",
                                          (player_id, limit)).fetchall())
    for f in facts:
        f["known_by"] = who_knows(conn, f["id"])
    return facts


def theory_of_mind(conn: sqlite3.Connection, player_id: str, cid: str, other_ids: list[str]) -> list[str]:
    """What this character believes the people in the room know (shared facts) — and doesn't."""
    mine = {f["id"]: f for f in known_facts(conn, player_id, cid, 40)}
    lines = []
    for o in other_ids:
        if o == "player":
            told = [f for f in mine.values() if f["learned_from"] == "player"]
            for f in told[:3]:
                lines.append(f"The player told me: {f['content']} (I believe it {int(f['confidence'] * 100)}%)")
            secrets_ = [f for f in mine.values() if f["learned_from"] not in ("player",) and f["secrecy"] >= 0.6]
            for f in secrets_[:2]:
                lines.append(f"I know something the player may not: {f['content']}")
            continue
        theirs = {r["fact_id"] for r in conn.execute(
            "SELECT fact_id FROM fact_knowledge WHERE player_id=? AND character_id=?", (player_id, o))}
        name = (world_state.character(conn, o) or {}).get("name", o)
        shared = [mine[i]["content"] for i in mine if i in theirs][:2]
        only_me = [mine[i]["content"] for i in mine if i not in theirs and mine[i]["secrecy"] >= 0.5][:2]
        for s in shared:
            lines.append(f"{name} also knows: {s}")
        for s in only_me:
            lines.append(f"{name} probably does NOT know: {s}")
    return lines


def _gossip(pers: dict[str, float], loyal_to_subject: bool) -> float:
    g = 0.25 + 0.35 * pers.get("openness", 0.5) + 0.25 * pers.get("cunning", 0.5) * pers.get("ambition", 0.5)
    if loyal_to_subject:
        g *= 0.4 + 0.6 * (1 - pers.get("loyalty", 0.5))
    g *= 1.0 - 0.3 * pers.get("honor", 0.5) * 0.5
    return max(0.02, min(0.95, g))


def propagate(conn: sqlite3.Connection, player_id: str, ord_: int, rng: random.Random, budget: int = 40) -> list[dict[str, Any]]:
    """Spread facts one hop through the social graph. Returns propagation records."""
    from ..memory import service as memory

    spread: list[dict[str, Any]] = []
    chars = {c["id"]: c for c in db.rows_to_dicts(conn.execute("SELECT * FROM characters").fetchall())}
    states = {r["character_id"]: db.row_to_dict(r) for r in conn.execute("SELECT * FROM character_states WHERE player_id=?", (player_id,))}
    locations: dict[str, list[str]] = {}
    for cid, c in chars.items():
        if c.get("death_ord") == 0:
            continue
        st = states.get(cid)
        if not world_state.is_alive(c, st, ord_):
            continue
        loc = world_state.location_of(c, st, ord_)
        if loc:
            locations.setdefault(loc, []).append(cid)
    loc_of = {cid: loc for loc, ids in locations.items() for cid in ids}

    knowledge = db.rows_to_dicts(conn.execute(
        """SELECT k.character_id, k.confidence, f.* FROM fact_knowledge k JOIN facts f ON f.id=k.fact_id
           WHERE k.player_id=? AND k.confidence >= 0.25 ORDER BY k.ord DESC LIMIT 400""", (player_id,)).fetchall())
    rng.shuffle(knowledge)
    for k in knowledge:
        if len(spread) >= budget:
            break
        teller = k["character_id"]
        if teller not in loc_of:
            continue
        pers = behavior.effective_personality(conn, player_id, chars[teller])
        subjects = k["subject_ids"] or []
        listeners = [c for c in locations.get(loc_of[teller], []) if c != teller]
        rng.shuffle(listeners)
        for listener in listeners[:6]:
            if conn.execute("SELECT 1 FROM fact_knowledge WHERE fact_id=? AND character_id=?", (k["id"], listener)).fetchone():
                continue
            rel = relationships.get_char_rel(conn, player_id, teller, listener, ord_, create=False)
            closeness = max(0.0, (float(rel["trust"]) + 100) / 200) * (0.5 + float(rel["familiarity"]) / 200)
            loyal = any(relationships.get_char_rel(conn, player_id, teller, s, ord_, create=False)["trust"] > 40
                        for s in subjects if s in chars and s != teller)
            p = (1 - float(k["secrecy"])) * _gossip(pers, loyal) * closeness
            if rng.random() < p:
                conf = round(float(k["confidence"]) * rng.uniform(0.72, 0.92), 3)
                if learn(conn, k["id"], player_id, listener, confidence=conf, learned_from=teller, channel="rumour", ord_=ord_):
                    t_name, l_name = chars[teller]["name"], chars[listener]["name"]
                    memory.add_memory(conn, character_id=listener, player_id=player_id, kind="episodic",
                                      content=f"{t_name} told me, quietly: {k['content']}", importance=0.35 + 0.4 * float(k["secrecy"]),
                                      about=[teller, *subjects[:3]], counterpart_id=teller, ord_=ord_)
                    spread.append({"fact_id": k["id"], "fact": k["content"], "from": teller, "from_name": t_name,
                                   "to": listener, "to_name": l_name, "confidence": conf, "location": loc_of[teller]})
                    break
    return spread
