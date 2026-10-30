"""Per-player world state: who is alive, where everyone is, faction power, canon pressure.

Canon is a *prior trajectory*. A player's world follows it unless that world has diverged:
* `character_states.alive` NULL -> follow canon; 1 -> alive regardless of canon; 0 -> dead.
* A location override holds until the canon storyline for that character moves on.
* Canon events are adjudicated per world: occurred / altered / prevented.
"""
from __future__ import annotations

import random
import sqlite3
from typing import Any

from .. import db
from ..canon import priors, world
from ..canon.timeline import MAX_ORD, from_ord, label, point, resolve_arc

STORY_LOC = {s["id"]: s["location"] for s in world.STORYLINES}
LOCATIONS = {l["id"]: l for l in world.LOCATIONS}
REGION_CONTINENT = {r["id"]: r["continent"] for r in world.REGIONS}

# Canon characters who are dead for a stretch and then return.
TEMPORARY_ABSENCE: dict[str, list[tuple[int, int, str]]] = {
    "jon_snow": [(point("5.10"), point("6.1"), "lies dead at Castle Black, murdered by his brothers")],
}

# Faction priors: power per season (index 0 = S1) on 0..100. Worlds evolve away from these.
FACTION_PRIORS: dict[str, dict[str, Any]] = {
    "house_stark": {"power": [70, 75, 60, 15, 10, 45, 70, 65], "wealth": 45, "leader": {"1": "eddard_stark", "1.10": "robb_stark", "3.10": None, "6.10": "jon_snow", "8.6": "sansa_stark"}},
    "house_lannister": {"power": [85, 85, 90, 85, 75, 65, 70, 40], "wealth": 95, "leader": {"1": "tywin_lannister", "4.10": "cersei_lannister"}},
    "house_baratheon": {"power": [80, 55, 45, 35, 30, 5, 5, 25], "wealth": 40, "leader": {"1": "robert_baratheon", "1.8": "stannis_baratheon", "5.10": None, "8.4": "gendry"}},
    "house_targaryen": {"power": [10, 20, 45, 60, 55, 75, 85, 70], "wealth": 30, "leader": {"1": "viserys_targaryen", "1.6": "daenerys_targaryen", "8.6": None}},
    "house_tyrell": {"power": [60, 75, 80, 80, 70, 40, 25, 0], "wealth": 85, "leader": {"1": "olenna_tyrell", "7.3": None}},
    "house_martell": {"power": [45, 45, 45, 50, 45, 50, 20, 15], "wealth": 55, "leader": {"1": "doran_martell", "6.1": "ellaria_sand", "7.2": None}},
    "house_greyjoy": {"power": [35, 50, 45, 40, 40, 45, 50, 45], "wealth": 30, "leader": {"1": "balon_greyjoy", "6.5": "euron_greyjoy", "8.6": "yara_greyjoy"}},
    "house_bolton": {"power": [35, 40, 55, 65, 70, 30, 0, 0], "wealth": 40, "leader": {"1": "roose_bolton", "6.2": "ramsay_bolton", "6.9": None}},
    "house_frey": {"power": [40, 40, 50, 50, 45, 35, 5, 5], "wealth": 50, "leader": {"1": "walder_frey", "6.10": None}},
    "house_arryn": {"power": [55, 55, 55, 55, 55, 60, 55, 50], "wealth": 60, "leader": {"1": "lysa_arryn", "4.7": "robin_arryn"}},
    "house_tully": {"power": [50, 55, 45, 15, 10, 10, 10, 15], "wealth": 45, "leader": {"1": "edmure_tully"}},
    "org_nights_watch": {"power": [30, 25, 20, 25, 25, 20, 20, 10], "wealth": 10, "leader": {"1": "jeor_mormont", "3.4": None, "5.2": "jon_snow", "6.3": "dolorous_edd"}},
    "org_free_folk": {"power": [40, 45, 55, 50, 25, 30, 35, 30], "wealth": 5, "leader": {"3": "mance_rayder", "5.1": "tormund_giantsbane"}},
    "org_army_of_the_dead": {"power": [20, 30, 40, 50, 70, 80, 95, 60], "wealth": 0, "leader": {"1": "night_king", "8.3": None}},
    "org_faith_militant": {"power": [0, 0, 0, 10, 50, 60, 0, 0], "wealth": 20, "leader": {"5": "high_sparrow", "6.10": None}},
    "org_iron_bank": {"power": [50, 50, 50, 55, 55, 55, 60, 60], "wealth": 100, "leader": {"4": "tycho_nestoris"}},
    "org_faceless_men": {"power": [30, 30, 30, 30, 30, 30, 30, 30], "wealth": 40, "leader": {"1": "jaqen_hghar"}},
    "org_dothraki": {"power": [70, 30, 30, 30, 35, 75, 75, 50], "wealth": 10, "leader": {"1": "khal_drogo", "1.10": None, "6.4": "daenerys_targaryen"}},
    "org_unsullied": {"power": [0, 0, 60, 65, 60, 65, 65, 50], "wealth": 0, "leader": {"3.4": "grey_worm"}},
    "org_brotherhood_without_banners": {"power": [10, 15, 20, 15, 10, 15, 15, 5], "wealth": 5, "leader": {"1": "beric_dondarrion"}},
}

CANON_STANCES: dict[tuple[str, str], tuple[str, str | None, str | None]] = {
    # (a, b) -> (stance, from, to)
    ("house_stark", "house_lannister"): ("war", "1.8", "7.7"),
    ("house_stark", "house_bolton"): ("war", "3.9", "6.9"),
    ("house_stark", "house_frey"): ("war", "3.9", "6.10"),
    ("house_baratheon", "house_lannister"): ("war", "2", "5.10"),
    ("house_targaryen", "house_lannister"): ("war", "6.10", "8.5"),
    ("house_targaryen", "house_tyrell"): ("alliance", "6.10", "7.3"),
    ("house_targaryen", "house_martell"): ("alliance", "6.10", "7.2"),
    ("house_targaryen", "house_greyjoy"): ("alliance", "6.9", "8.6"),
    ("house_lannister", "house_tyrell"): ("alliance", "2.9", "6.10"),
    ("house_lannister", "house_bolton"): ("alliance", "3.9", "6.2"),
    ("house_lannister", "house_frey"): ("alliance", "3.9", "6.10"),
    ("house_martell", "house_lannister"): ("hostile", "4.8", "8.5"),
    ("org_nights_watch", "org_free_folk"): ("war", "1", "5.3"),
    ("org_nights_watch", "org_army_of_the_dead"): ("war", "1", "8.3"),
    ("house_stark", "org_army_of_the_dead"): ("war", "7", "8.3"),
    ("house_targaryen", "org_army_of_the_dead"): ("war", "7.6", "8.3"),
    ("org_faith_militant", "house_lannister"): ("hostile", "5.7", "6.10"),
    ("house_stark", "house_targaryen"): ("alliance", "7.4", "8.5"),
}


# ------------------------------------------------------------------ characters
def character(conn: sqlite3.Connection, cid: str) -> dict[str, Any] | None:
    return db.row_to_dict(conn.execute("SELECT * FROM characters WHERE id=?", (cid,)).fetchone())


def state(conn: sqlite3.Connection, player_id: str, cid: str) -> dict[str, Any] | None:
    return db.row_to_dict(conn.execute("SELECT * FROM character_states WHERE player_id=? AND character_id=?",
                                       (player_id, cid)).fetchone())


def init_world(conn: sqlite3.Connection, player_id: str, ord_: int) -> None:
    """Copy behavioural priors into the player's world for every character."""
    from . import affect

    now = db.now_iso()
    rows = []
    for c in db.rows_to_dicts(conn.execute("SELECT * FROM characters").fetchall()):
        pers = c["personality"] or priors.personality(c)
        drives = priors.active_drives(c["drives"] or priors.default_drives(c), ord_)
        rows.append((player_id, c["id"], None, None, None, "neutral", 0.0, db.dumps(affect.baseline(pers)),
                     db.dumps(drives), "[]", c["house"], "{}", "[]", "{}", "", ord_, now))
    conn.executemany(
        """INSERT OR IGNORE INTO character_states(player_id, character_id, alive, death_note, location_id, mood, stress, affect,
           goals, beliefs, allegiance, personality_drift, learned, counters, notes, updated_ord, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", rows)
    init_factions(conn, player_id, ord_)


def is_alive(c: dict[str, Any], st: dict[str, Any] | None, ord_: int) -> bool:
    if st and st.get("alive") is not None:
        return bool(st["alive"])
    if c.get("death_ord") is not None and ord_ >= c["death_ord"]:
        return False
    for frm, to, _ in TEMPORARY_ABSENCE.get(c["id"], []):
        if frm <= ord_ <= to:
            return False
    return True


def is_alive_in_scene(c: dict[str, Any], st: dict[str, Any] | None, ord_: int) -> bool:
    """Inside the scenes of episode `ord_`, characters who die *during* that episode are still alive."""
    if st and st.get("alive") is not None:
        return bool(st["alive"])
    if c.get("death_ord") is not None and c["death_ord"] < ord_:
        return False
    return c.get("death_ord") != 0


def canon_location(c: dict[str, Any], ord_: int) -> str | None:
    story = resolve_arc(c.get("arcs") or {}, ord_)
    if not story:
        return None
    if not c.get("canon") and c.get("first_ord") and c.get("last_ord"):
        if not (c["first_ord"] <= ord_ <= c["last_ord"] + 2):
            return None
    return STORY_LOC.get(story)


def location_of(c: dict[str, Any], st: dict[str, Any] | None, ord_: int) -> str | None:
    if st and st.get("location_id"):
        arcs = c.get("arcs") or {}
        if resolve_arc(arcs, ord_) == resolve_arc(arcs, int(st.get("updated_ord") or 0)) or not arcs:
            return st["location_id"]
    return canon_location(c, ord_)


def titles_at(conn: sqlite3.Connection, c: dict[str, Any], ord_: int) -> list[str]:
    """Titles held at `ord_` (from time-scoped HOLDS_TITLE edges). Static canon titles are only
    revealed once the character's arc is complete at this point, so lists never spoil the future."""
    held = [r["name"] for r in conn.execute(
        """SELECT n.name FROM kg_edges e JOIN kg_nodes n ON n.id=e.target WHERE e.type='HOLDS_TITLE' AND e.source=? AND e.layer='canon'
           AND (e.valid_from IS NULL OR e.valid_from<=?) AND (e.valid_to IS NULL OR e.valid_to>=?)""", (c["id"], ord_, ord_))]
    complete = ord_ >= (c.get("last_ord") or 0) or (c.get("death_ord") is not None and c["death_ord"] <= ord_)
    return held if held or not complete else list(c.get("titles") or [])


def storyline_of(c: dict[str, Any], ord_: int) -> str | None:
    return resolve_arc(c.get("arcs") or {}, ord_)


def present_characters(conn: sqlite3.Connection, player_id: str, location_id: str, ord_: int) -> list[dict[str, Any]]:
    states = {r["character_id"]: db.row_to_dict(r) for r in
              conn.execute("SELECT * FROM character_states WHERE player_id=?", (player_id,))}
    out = []
    for c in db.rows_to_dicts(conn.execute("SELECT * FROM characters WHERE line_count > 0 OR canon=1").fetchall()):
        st = states.get(c["id"])
        if c.get("death_ord") == 0:
            continue
        if not is_alive(c, st, ord_):
            continue
        if location_of(c, st, ord_) == location_id:
            c["state"] = st
            c["storyline"] = storyline_of(c, ord_)
            out.append(c)
    out.sort(key=lambda c: {"major": 0, "supporting": 1, "minor": 2}.get(c["tier"], 3) * 10_000 - (c["line_count"] or 0))
    return out


def roster(conn: sqlite3.Connection, player_id: str, ord_: int) -> list[dict[str, Any]]:
    """Every character with world status (alive, location) at ord_."""
    states = {r["character_id"]: db.row_to_dict(r) for r in
              conn.execute("SELECT * FROM character_states WHERE player_id=?", (player_id,))}
    out = []
    for c in db.rows_to_dicts(conn.execute("SELECT * FROM characters").fetchall()):
        st = states.get(c["id"])
        out.append({"id": c["id"], "name": c["name"], "house": c["house"], "tier": c["tier"],
                    "alive": is_alive(c, st, ord_) and c.get("death_ord") != 0,
                    "location_id": location_of(c, st, ord_), "storyline": storyline_of(c, ord_),
                    "mood": (st or {}).get("mood"), "diverged": bool(st and (st.get("alive") is not None or st.get("location_id")))})
    return out


def set_alive(conn: sqlite3.Connection, player_id: str, cid: str, alive: bool, ord_: int, note: str = "") -> None:
    conn.execute("UPDATE character_states SET alive=?, death_note=?, updated_ord=?, updated_at=? WHERE player_id=? AND character_id=?",
                 (int(alive), note or None, ord_, db.now_iso(), player_id, cid))


def set_location(conn: sqlite3.Connection, player_id: str, cid: str, location_id: str, ord_: int) -> None:
    if location_id not in LOCATIONS:
        raise ValueError(f"Unknown location {location_id}")
    conn.execute("UPDATE character_states SET location_id=?, updated_ord=?, updated_at=? WHERE player_id=? AND character_id=?",
                 (location_id, ord_, db.now_iso(), player_id, cid))


# ------------------------------------------------------------------ factions
def _season_idx(ord_: int) -> int:
    return from_ord(ord_)[0] - 1


def init_factions(conn: sqlite3.Connection, player_id: str, ord_: int) -> None:
    now = db.now_iso()
    for fid, pr in FACTION_PRIORS.items():
        leader = resolve_arc(pr["leader"], ord_)
        p = pr["power"][_season_idx(ord_)]
        conn.execute(
            """INSERT OR IGNORE INTO faction_states(player_id, faction_id, power, wealth, influence, stability, leader_id, stances,
               updated_ord, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (player_id, fid, p, pr["wealth"], p * 0.8, 55, leader, db.dumps(canon_stances(fid, ord_)), ord_, now))


def canon_stances(fid: str, ord_: int) -> dict[str, str]:
    out: dict[str, str] = {}
    for (a, b), (stance, frm, to) in CANON_STANCES.items():
        if fid not in (a, b):
            continue
        if frm and point(frm) > ord_:
            continue
        if to and point(to) < ord_:
            continue
        out[b if fid == a else a] = stance
    return out


def factions(conn: sqlite3.Connection, player_id: str) -> list[dict[str, Any]]:
    rows = db.rows_to_dicts(conn.execute("SELECT * FROM faction_states WHERE player_id=? ORDER BY power DESC", (player_id,)).fetchall())
    names = {f"house_{h['id']}": h["name"] for h in world.HOUSES} | {f"org_{o['id']}": o["name"] for o in world.ORGANIZATIONS}
    for r in rows:
        r["name"] = names.get(r["faction_id"], r["faction_id"])
    return rows


def drift_factions(conn: sqlite3.Connection, player_id: str, ord_: int, rng: random.Random) -> list[str]:
    """Pull factions toward the canon prior for the new season, plus noise and leader-death shocks."""
    notes = []
    for f in factions(conn, player_id):
        pr = FACTION_PRIORS.get(f["faction_id"])
        if not pr:
            continue
        target = pr["power"][_season_idx(ord_)]
        leader = f["leader_id"]
        leader_ok = True
        if leader:
            c = character(conn, leader)
            if c and not is_alive(c, state(conn, player_id, leader), ord_):
                leader_ok = False
        canon_leader = resolve_arc(pr["leader"], ord_)
        new_leader = leader if leader_ok else None
        if not leader_ok:
            cl = character(conn, canon_leader) if canon_leader else None
            if cl and is_alive(cl, state(conn, player_id, canon_leader), ord_):  # type: ignore[arg-type]
                new_leader = canon_leader
        power = f["power"] + (target - f["power"]) * 0.35 + rng.uniform(-3, 3)
        stability = f["stability"] + rng.uniform(-2, 2) + (0 if leader_ok else -15)
        if not leader_ok:
            notes.append(f"{f['name']} is shaken by the loss of its leader.")
        stances = canon_stances(f["faction_id"], ord_)
        stances.update({k: v for k, v in (f["stances"] or {}).items() if k.startswith("player:")})
        conn.execute(
            """UPDATE faction_states SET power=?, stability=?, leader_id=?, stances=?, influence=?, updated_ord=?, updated_at=?
               WHERE player_id=? AND faction_id=?""",
            (round(max(0, min(100, power)), 1), round(max(0, min(100, stability)), 1), new_leader, db.dumps(stances),
             round(max(0, min(100, power * 0.8 + stability * 0.2)), 1), ord_, db.now_iso(), player_id, f["faction_id"]))
    return notes


def adjust_faction(conn: sqlite3.Connection, player_id: str, faction_id: str, **deltas: float) -> None:
    f = conn.execute("SELECT * FROM faction_states WHERE player_id=? AND faction_id=?", (player_id, faction_id)).fetchone()
    if not f:
        return
    vals = {k: max(0.0, min(100.0, float(f[k]) + float(deltas.get(k, 0)))) for k in ("power", "wealth", "influence", "stability")}
    conn.execute("UPDATE faction_states SET power=?, wealth=?, influence=?, stability=?, updated_at=? WHERE player_id=? AND faction_id=?",
                 (vals["power"], vals["wealth"], vals["influence"], vals["stability"], db.now_iso(), player_id, faction_id))


# ------------------------------------------------------------------ canon pressure
def adjudicate_canon_events(conn: sqlite3.Connection, player_id: str, ord_: int, rng: random.Random) -> list[dict[str, Any]]:
    """Decide what happens to each canon event of episode `ord_` in this player's world."""
    results = []
    chars = {c["id"]: c for c in db.rows_to_dicts(conn.execute("SELECT * FROM characters").fetchall())}
    for e in db.rows_to_dicts(conn.execute("SELECT * FROM canon_events WHERE ord=?", (ord_,)).fetchall()):
        if conn.execute("SELECT 1 FROM canon_outcomes WHERE player_id=? AND event_id=?", (player_id, e["id"])).fetchone():
            continue
        missing, saved = [], []
        for pid in e["participants"]:
            c = chars.get(pid)
            if not c:
                continue
            st = state(conn, player_id, pid)
            if st and st.get("alive") == 0:
                missing.append(c["name"])
            elif st and st.get("alive") == 1 and c.get("death_ord") == ord_:
                saved.append(c["name"])
        flags = db.row_to_dict(conn.execute("SELECT flags FROM players WHERE id=?", (player_id,)).fetchone()) or {}
        prevented_flag = (flags.get("flags") or {}).get(f"prevent:{e['id']}")
        core = e["participants"][:2]
        core_missing = any(chars.get(p) and (state(conn, player_id, p) or {}).get("alive") == 0 for p in core)
        if prevented_flag or core_missing:
            outcome = "prevented"
            narration = (f"In this world, '{e['title']}' never comes to pass"
                         + (f" — {', '.join(missing)} did not live to see it." if missing else " — the player's actions turned the tide."))
        elif missing or saved:
            outcome = "altered"
            parts = []
            if missing:
                parts.append(f"without {', '.join(missing)}")
            if saved:
                parts.append(f"and {', '.join(saved)} survives against all expectation")
            narration = f"'{e['title']}' unfolds differently: {e['description']} — " + " ".join(parts) + "."
        else:
            outcome = "occurred"
            narration = e["description"]
        conn.execute("INSERT INTO canon_outcomes(player_id, event_id, outcome, narration, ord) VALUES(?,?,?,?,?)",
                     (player_id, e["id"], outcome, narration, ord_))
        if outcome != "occurred":
            # Characters whose canon death belongs to a prevented event survive in this world.
            if outcome == "prevented":
                for pid in e["participants"]:
                    c = chars.get(pid)
                    if c and c.get("death_ord") == ord_:
                        st = state(conn, player_id, pid)
                        if st and st.get("alive") is None:
                            set_alive(conn, player_id, pid, True, ord_, f"Survived: '{e['title']}' was prevented")
        results.append({**e, "outcome": outcome, "narration": narration, "when": label(ord_)})
    return results


def outcomes(conn: sqlite3.Connection, player_id: str, upto: int | None = None) -> list[dict[str, Any]]:
    q = """SELECT o.*, e.title, e.kind, e.importance, e.public, e.participants, e.location_id FROM canon_outcomes o
           JOIN canon_events e ON e.id=o.event_id WHERE o.player_id=?"""
    params: list[Any] = [player_id]
    if upto is not None:
        q += " AND o.ord<=?"
        params.append(upto)
    return db.rows_to_dicts(conn.execute(q + " ORDER BY o.ord DESC, e.importance DESC", params).fetchall())


def known_events(conn: sqlite3.Connection, player_id: str | None, cid: str, ord_: int, limit: int = 10) -> list[dict[str, Any]]:
    """Public events (realm news) plus private events the character witnessed, as adjudicated in this world."""
    rows = db.rows_to_dicts(conn.execute(
        "SELECT * FROM canon_events WHERE ord <= ? ORDER BY ord DESC, importance DESC", (ord_,)).fetchall())
    out_map = {}
    if player_id:
        out_map = {o["event_id"]: o for o in db.rows_to_dicts(conn.execute(
            "SELECT * FROM canon_outcomes WHERE player_id=?", (player_id,)).fetchall())}
    res = []
    for e in rows:
        witnessed = cid in e["participants"]
        if not (e["public"] or witnessed):
            continue
        if e["importance"] < 0.75 and not witnessed:
            continue
        o = out_map.get(e["id"])
        if o and o["outcome"] == "prevented":
            continue
        res.append({"label": label(e["ord"]), "title": e["title"],
                    "text": o["narration"] if o else e["description"], "witnessed": witnessed,
                    "outcome": o["outcome"] if o else "occurred"})
        if len(res) >= limit:
            break
    return res


def travel_cost(a: str, b: str) -> dict[str, Any]:
    la, lb = LOCATIONS[a], LOCATIONS[b]
    dist = ((la["x"] - lb["x"]) ** 2 + (la["y"] - lb["y"]) ** 2) ** 0.5
    days = max(1, round(dist / 4))
    gold = 0
    crossing = REGION_CONTINENT[la["region"]] != REGION_CONTINENT[lb["region"]]
    if crossing:
        days += 8
        gold = 25
    return {"days": days, "gold": gold, "sea_crossing": crossing, "distance": round(dist, 1)}


__all__ = ["MAX_ORD"]
