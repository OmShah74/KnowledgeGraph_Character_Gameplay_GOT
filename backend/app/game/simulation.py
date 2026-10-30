"""World simulation: what happens in Westeros while the player isn't looking.

One tick per episode advanced:
  1. canon pressure   - adjudicate the episode's canon events for this world (occur / alter / prevent)
  2. canon deaths     - deaths happen unless the world diverged; kin and lovers grieve
  3. factions         - power drifts toward the era's prior, shocked by leader deaths and plots
  4. time             - emotions settle, era drives switch on/off, stress eases
  5. rumours          - facts spread one hop through the social graph
  6. off-screen life  - co-located characters meet; their relationships and dyadic memories evolve
  7. plots            - active plot threads gain tension, advance stages, resolve; new ones emerge
Every result is written to the player's event log, characters' memories and the KG.
"""
from __future__ import annotations

import random
import sqlite3
import zlib
from typing import Any

from .. import db
from ..canon.timeline import label
from ..memory import service as memory
from . import agents, behavior, knowledge, plots, relationships, world_state

OFFSCREEN_TEMPLATES = {
    "friendly": ["shared a quiet meal and spoke of home", "walked the walls together, trading confidences",
                 "laughed over wine about old times", "planned for the dangers ahead side by side"],
    "neutral": ["discussed the state of the war in guarded terms", "crossed paths and exchanged courtesies",
                "argued politely over what should be done next", "sized each other up over supper"],
    "hostile": ["exchanged cold, barbed words in the hall", "nearly came to blows over an old grievance",
                "traded veiled threats before witnesses", "pointedly ignored each other at table"],
}


def log_event(conn: sqlite3.Connection, player_id: str, kind: str, title: str, description: str, ord_: int,
              participants: list[str] | None = None, location_id: str | None = None, canon: bool = False) -> int:
    cur = conn.execute(
        """INSERT INTO events(player_id, kind, title, description, participants, location_id, ord, canon, created_at)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (player_id, kind, title[:200], description[:1500], db.dumps(participants or []), location_id, ord_, int(canon), db.now_iso()))
    return int(cur.lastrowid)


def _grief(conn: sqlite3.Connection, player_id: str, dead: str, ord_: int, names: dict[str, str]) -> list[str]:
    mourners = []
    for r in conn.execute(
            """SELECT source, target, type FROM kg_edges WHERE type IN ('PARENT_OF','SIBLING_OF','SPOUSE_OF','LOVER_OF','MENTOR_OF','SWORN_TO','SERVES')
               AND (source=? OR target=?) AND (layer='canon' OR player_id=?)""", (dead, dead, player_id)):
        other = r["target"] if r["source"] == dead else r["source"]
        c = world_state.character(conn, other)
        if not c or not world_state.is_alive(c, world_state.state(conn, player_id, other), ord_):
            continue
        behavior.update_affect(conn, player_id, other, "grief", 1.0 if r["type"] in ("PARENT_OF", "SPOUSE_OF", "LOVER_OF") else 0.6)
        behavior.record_pattern(conn, player_id, other, "grief", "", "", ord_)
        memory.add_memory(conn, character_id=other, player_id=player_id, kind="world",
                          content=f"{names.get(dead, dead)} is dead. ({label(ord_)})", importance=0.85, emotion="grief",
                          about=[dead], counterpart_id=dead, ord_=ord_)
        mourners.append(other)
    return mourners


def _pairs_for_offscreen(conn: sqlite3.Connection, player_id: str, ord_: int, rng: random.Random, n: int) -> list[tuple[str, str]]:
    roster = [r for r in world_state.roster(conn, player_id, ord_)
              if r["alive"] and r["location_id"] and r["tier"] in ("major", "supporting") and r["id"] != "night_king"]
    by_loc: dict[str, list[str]] = {}
    for r in roster:
        by_loc.setdefault(r["location_id"], []).append(r["id"])
    scored = []
    for ids in by_loc.values():
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                rel = relationships.get_char_rel(conn, player_id, a, b, ord_, create=False)
                intensity = (abs(rel["trust"]) + abs(rel["affection"])) / 200 + rel["familiarity"] / 200
                scored.append((intensity + rng.random() * 0.6, a, b))
    scored.sort(reverse=True)
    return [(a, b) for _, a, b in scored[:n]]


async def _offscreen(conn_factory, player_id: str, ord_: int, rng: random.Random, n: int = 4) -> list[dict[str, Any]]:
    with conn_factory() as conn:
        pairs = _pairs_for_offscreen(conn, player_id, ord_, rng, n)
        if not pairs:
            return []
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
        briefs = []
        for a, b in pairs:
            ca, cb = world_state.character(conn, a), world_state.character(conn, b)
            pa = behavior.profile(conn, player_id, ca, ord_)  # type: ignore[arg-type]
            pb = behavior.profile(conn, player_id, cb, ord_)  # type: ignore[arg-type]
            rab = relationships.get_char_rel(conn, player_id, a, b, ord_)
            rba = relationships.get_char_rel(conn, player_id, b, a, ord_)
            mem = memory.pair_memories(conn, a, b, ord_, player_id, limit=3)
            loc = world_state.location_of(ca, world_state.state(conn, player_id, a), ord_)  # type: ignore[arg-type]
            briefs.append({"a": a, "b": b, "a_name": names[a], "b_name": names[b], "rab": rab, "rba": rba,
                           "a_mood": pa["mood"], "b_mood": pb["mood"],
                           "a_goals": [g["goal"] for g in pa["goals"][:2]], "b_goals": [g["goal"] for g in pb["goals"][:2]],
                           "a_learned": [l["rule"] for l in pa["learned"][-2:]], "b_learned": [l["rule"] for l in pb["learned"][-2:]],
                           "history": [m["content"][:200] for m in (mem.get(a) or [])[:2]],
                           "location": world_state.LOCATIONS.get(loc or "", {}).get("name", "somewhere")})

    system = ("You are the world simulator of a living Game of Thrones RPG. Characters live their own lives off-screen. "
              "For each pair, invent a short, plausible, in-character interaction for this moment of the timeline, consistent with "
              "their relationship, moods, goals and history. Interactions may be warm, tense, scheming or tragic. Never reference "
              "events after the current episode. Respond with JSON only.")
    lines = [f"Timeline: {label(ord_)}."]
    for i, b in enumerate(briefs):
        lines.append(
            f"[{i}] {b['a_name']} ({b['a']}) & {b['b_name']} ({b['b']}) at {b['location']}. "
            f"{b['a_name']}→{b['b_name']}: {b['rab']['stance']} (trust {b['rab']['trust']:.0f}, affection {b['rab']['affection']:.0f}); "
            f"{b['b_name']}→{b['a_name']}: {b['rba']['stance']} (trust {b['rba']['trust']:.0f}, affection {b['rba']['affection']:.0f}). "
            f"Moods: {b['a_mood']} / {b['b_mood']}. Goals: {b['a_goals']} / {b['b_goals']}. Lessons: {b['a_learned']} / {b['b_learned']}. "
            f"Shared history: {b['history']}")
    lines.append('Return {"interactions": [{"index": 0, "summary": "1-2 sentences, third person", '
                 '"a_memory": "first-person memory for a", "b_memory": "first-person memory for b", '
                 '"delta_a_to_b": {"trust": 0, "affection": 0, "respect": 0, "fear": 0}, '
                 '"delta_b_to_a": {"trust": 0, "affection": 0, "respect": 0, "fear": 0}, '
                 '"secret": null or "a secret or rumour one reveals to the other"}]} with deltas in [-10, 10].')
    data = await agents.llm_json(system, "\n".join(lines), "simulation:offscreen", max_tokens=1400)

    results = []
    with conn_factory() as conn:
        items = (data or {}).get("interactions") if isinstance(data, dict) else None
        by_index = {int(x.get("index", -1)): x for x in items or [] if isinstance(x, dict) and str(x.get("index", "")).lstrip("-").isdigit()}
        for i, b in enumerate(briefs):
            x = by_index.get(i)
            if x and x.get("summary"):
                summary = str(x["summary"])[:400]
                am = str(x.get("a_memory") or summary)[:400]
                bm = str(x.get("b_memory") or summary)[:400]
                dab = {k: agents._num((x.get("delta_a_to_b") or {}).get(k), -10, 10) for k in ("trust", "affection", "respect", "fear")}
                dba = {k: agents._num((x.get("delta_b_to_a") or {}).get(k), -10, 10) for k in ("trust", "affection", "respect", "fear")}
                secret = x.get("secret")
                source = "llm"
            else:
                disp = relationships.disposition(b["rab"])
                what = rng.choice(OFFSCREEN_TEMPLATES[disp])
                summary = f"{b['a_name']} and {b['b_name']} {what} at {b['location']}."
                am = f"{b['b_name']} and I {what}."
                bm = f"{b['a_name']} and I {what}."
                sign = {"friendly": 1, "neutral": 0.2, "hostile": -1}[disp]
                dab = {"trust": 3 * sign, "affection": 3 * sign, "respect": 1, "fear": 0}
                dba = {"trust": 3 * sign, "affection": 3 * sign, "respect": 1, "fear": 0}
                secret = None
                source = "template"
            relationships.apply_char_delta(conn, player_id, b["a"], b["b"], dab, f"off-screen: {summary[:120]}", ord_)
            relationships.apply_char_delta(conn, player_id, b["b"], b["a"], dba, f"off-screen: {summary[:120]}", ord_)
            memory.add_memory(conn, character_id=b["a"], player_id=player_id, kind="world", content=am, importance=0.45,
                              about=[b["b"]], counterpart_id=b["b"], ord_=ord_)
            memory.add_memory(conn, character_id=b["b"], player_id=player_id, kind="world", content=bm, importance=0.45,
                              about=[b["a"]], counterpart_id=b["a"], ord_=ord_)
            behavior.record_pattern(conn, player_id, b["a"], "talked_with", b["b"], b["b_name"], ord_)
            behavior.record_pattern(conn, player_id, b["b"], "talked_with", b["a"], b["a_name"], ord_)
            if isinstance(secret, str) and secret.strip():
                fid = knowledge.add_fact(conn, player_id, secret.strip(), subjects=[b["a"], b["b"]], secrecy=0.7,
                                         origin=b["a"], ord_=ord_)
                knowledge.learn(conn, fid, player_id, b["a"], confidence=0.9, channel="witnessed", ord_=ord_)
                knowledge.learn(conn, fid, player_id, b["b"], confidence=0.8, learned_from=b["a"], channel="told", ord_=ord_)
            log_event(conn, player_id, "offscreen", f"{b['a_name']} & {b['b_name']}", summary, ord_, [b["a"], b["b"]])
            results.append({"a": b["a"], "b": b["b"], "summary": summary, "source": source})
    return results


async def tick(player_id: str, ord_: int, *, seed: int | None = None, offscreen_pairs: int = 4) -> dict[str, Any]:
    rng = random.Random(seed if seed is not None else zlib.crc32(f"{player_id}:{ord_}".encode()))
    report: dict[str, Any] = {"ord": ord_, "label": label(ord_)}
    with db.db() as conn:
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
        chars = {c["id"]: c for c in db.rows_to_dicts(conn.execute("SELECT * FROM characters").fetchall())}
        # 1. canon pressure
        canon = world_state.adjudicate_canon_events(conn, player_id, ord_, rng)
        for e in canon:
            log_event(conn, player_id, f"canon_{e['outcome']}", e["title"], e["narration"], ord_, e["participants"],
                      e["location_id"], canon=True)
        report["canon"] = [{"title": e["title"], "outcome": e["outcome"], "narration": e["narration"]} for e in canon]
        # 2. canon deaths in this world
        deaths = []
        for cid, c in chars.items():
            if c.get("death_ord") == ord_:
                st = world_state.state(conn, player_id, cid)
                if st and st.get("alive") is None:
                    deaths.append(cid)
                    mourners = _grief(conn, player_id, cid, ord_, names)
                    log_event(conn, player_id, "death", f"{names[cid]} dies", c.get("death_note") or "", ord_, [cid, *mourners[:6]],
                              canon=True)
        report["deaths"] = [names[d] for d in deaths]
        # 3. factions
        report["factions"] = world_state.drift_factions(conn, player_id, ord_, rng)
        # 4. time
        behavior.age_world(conn, player_id, ord_, steps=1.0)
        # 5. rumours
        spread = knowledge.propagate(conn, player_id, ord_, rng)
        for s in spread:
            log_event(conn, player_id, "rumour", f"Whispers reach {s['to_name']}",
                      f"{s['from_name']} told {s['to_name']}: {s['fact']}", ord_, [s["from"], s["to"]], s["location"])
            src = conn.execute("SELECT source_thread_id FROM facts WHERE id=?", (s["fact_id"],)).fetchone()
            if src and src["source_thread_id"]:
                conn.execute(
                    """INSERT OR IGNORE INTO thread_links(player_id, from_thread, to_kind, to_id, relation, note, created_at)
                       VALUES(?,?,?,?,?,?,?)""",
                    (player_id, src["source_thread_id"], "character", s["to"], "rumour_reached",
                     f"{s['from_name']} → {s['to_name']}: {s['fact'][:120]}", db.now_iso()))
        report["rumours"] = spread
    # 6. off-screen life (LLM if available)
    report["offscreen"] = await _offscreen(db.db, player_id, ord_, rng, offscreen_pairs)
    # 7. plots
    with db.db() as conn:
        adv = plots.advance(conn, player_id, ord_, rng)
        for a in adv:
            log_event(conn, player_id, "plot", a["plot"], a.get("text") or a["event"], ord_)
        new = plots.mine_tensions(conn, player_id, ord_, rng)
        for p in new:
            log_event(conn, player_id, "plot_new", p["title"], p["premise"], ord_, p["characters"])
        report["plots"] = adv
        report["new_plots"] = [{"id": p["id"], "title": p["title"]} for p in new]
    return report
