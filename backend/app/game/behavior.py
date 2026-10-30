"""Learned behaviour: how characters change through play.

Three mechanisms make behaviour evolve over the course of a playthrough:

1. Pattern counters - every interaction updates counters (deceived_by:<player>, gifted_by:...,
   threatened_by:..., helped_by:..., talked_with:<char>). Crossing a threshold produces a
   *learned rule* ("demands proof before believing X") plus a small personality drift.
2. Reflection - after conversations the reflection agent may propose new learned rules and
   drifts grounded in what actually happened (validated and bounded here).
3. Time & experience - advancing the timeline decays affect, ages drives (era-specific goals
   switch on/off) and applies stress from grief, war and danger.

effective_personality = prior + drift (bounded). The prompt always uses the evolved profile.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from .. import db
from ..canon import priors

MAX_DRIFT = 0.35          # a dimension can move at most this far from its prior
MAX_LEARNED = 24          # per character per world; oldest low-strength rules are pruned

# counter key prefix -> (threshold, rule template, drift)
PATTERN_RULES: dict[str, list[tuple[int, str, dict[str, float]]]] = {
    "deceived_by": [(1, "Caught {who} in a lie once; listens to {who} more carefully now.", {"openness": -0.02}),
                    (3, "No longer believes anything {who} says without proof.", {"openness": -0.06, "cunning": 0.03})],
    "threatened_by": [(2, "Has learned that {who} resorts to threats; {reaction}.", {"temper": 0.03}),
                      (4, "Treats {who} as a dangerous enemy and keeps guards close.", {"openness": -0.05})],
    "gifted_by": [(2, "Has come to expect generosity from {who}.", {"openness": 0.02}),
                  (4, "Regards {who} as a reliable patron and speaks warmly of them.", {"compassion": 0.02})],
    "helped_by": [(2, "Remembers that {who} helped when it mattered.", {"openness": 0.03}),
                  (4, "Would take real risks for {who}.", {"loyalty": 0.04})],
    "persuaded_by": [(3, "Has grown to value {who}'s counsel.", {"openness": 0.02})],
    "insulted_by": [(2, "Bristles whenever {who} speaks; expects mockery.", {"temper": 0.04, "humor": -0.02})],
    "flirted_by": [(3, "Is either charmed or tired of {who}'s advances, and shows it.", {})],
    "betrayed_by": [(1, "Will never again trust {who}; plans to make them pay.", {"cruelty": 0.04, "openness": -0.08, "loyalty": -0.03})],
    "talked_with": [(6, "Has grown used to {who}'s company.", {"openness": 0.01})],
    "grief": [(1, "Carries fresh grief; quicker to anger, slower to laugh.", {"humor": -0.04, "temper": 0.03}),
              (3, "Hardened by loss; expects the worst of the world.", {"compassion": -0.04, "openness": -0.04})],
    "victory": [(2, "Emboldened by recent victories.", {"courage": 0.03, "pride": 0.03})],
    "defeat": [(2, "Shaken by defeats; more cautious than before.", {"courage": -0.03})],
}


def _state(conn: sqlite3.Connection, player_id: str, cid: str) -> dict[str, Any] | None:
    return db.row_to_dict(conn.execute("SELECT * FROM character_states WHERE player_id=? AND character_id=?",
                                       (player_id, cid)).fetchone())


def effective_personality(conn: sqlite3.Connection, player_id: str | None, c: dict[str, Any]) -> dict[str, float]:
    base = c.get("personality") or priors.personality(c)
    if not player_id:
        return dict(base)
    st = _state(conn, player_id, c["id"])
    drift = (st or {}).get("personality_drift") or {}
    return {k: round(max(0.0, min(1.0, base.get(k, 0.5) + float(drift.get(k, 0)))), 3) for k in priors.DIMENSIONS}


def apply_drift(conn: sqlite3.Connection, player_id: str, cid: str, drift: dict[str, float]) -> dict[str, float]:
    st = _state(conn, player_id, cid)
    if not st:
        return {}
    cur = dict(st.get("personality_drift") or {})
    for k, v in drift.items():
        if k not in priors.DIMENSIONS:
            continue
        cur[k] = round(max(-MAX_DRIFT, min(MAX_DRIFT, float(cur.get(k, 0)) + max(-0.1, min(0.1, float(v))))), 3)
    conn.execute("UPDATE character_states SET personality_drift=?, updated_at=? WHERE player_id=? AND character_id=?",
                 (db.dumps(cur), db.now_iso(), player_id, cid))
    return cur


def add_learned(conn: sqlite3.Connection, player_id: str, cid: str, rule: str, source: str, ord_: int,
                strength: float = 0.6, about: str | None = None) -> bool:
    st = _state(conn, player_id, cid)
    if not st:
        return False
    learned = list(st.get("learned") or [])
    rule = rule.strip()[:240]
    if not rule or any(l["rule"].lower() == rule.lower() for l in learned):
        return False
    learned.append({"rule": rule, "source": source, "ord": ord_, "strength": round(max(0.1, min(1.0, strength)), 2),
                    "about": about, "at": db.now_iso()})
    if len(learned) > MAX_LEARNED:
        learned.sort(key=lambda l: (l.get("strength", 0.5), l.get("ord", 0)))
        learned = learned[len(learned) - MAX_LEARNED:]
    conn.execute("UPDATE character_states SET learned=?, updated_at=? WHERE player_id=? AND character_id=?",
                 (db.dumps(learned), db.now_iso(), player_id, cid))
    return True


def record_pattern(conn: sqlite3.Connection, player_id: str, cid: str, pattern: str, who_id: str, who_name: str,
                   ord_: int) -> list[str]:
    """Increment a behaviour counter; returns any newly learned rules."""
    st = _state(conn, player_id, cid)
    if not st:
        return []
    counters = dict(st.get("counters") or {})
    key = f"{pattern}:{who_id}" if who_id else pattern
    counters[key] = int(counters.get(key, 0)) + 1
    n = counters[key]
    conn.execute("UPDATE character_states SET counters=?, updated_at=? WHERE player_id=? AND character_id=?",
                 (db.dumps(counters), db.now_iso(), player_id, cid))
    new_rules = []
    for threshold, template, drift in PATTERN_RULES.get(pattern, []):
        if n == threshold:
            c = conn.execute("SELECT personality FROM characters WHERE id=?", (cid,)).fetchone()
            import json

            pers = json.loads(c["personality"]) if c and c["personality"] else {}
            reaction = "answers threats with steel" if pers.get("courage", 0.5) >= 0.55 else "grows quietly afraid"
            rule = template.format(who=who_name or "the world", reaction=reaction)
            if add_learned(conn, player_id, cid, rule, f"pattern:{pattern}", ord_, 0.5 + 0.1 * threshold, who_id):
                apply_drift(conn, player_id, cid, drift)
                new_rules.append(rule)
    return new_rules


def update_affect(conn: sqlite3.Connection, player_id: str, cid: str, stimulus: str, intensity: float = 1.0) -> dict[str, Any]:
    from . import affect

    st = _state(conn, player_id, cid)
    c = db.row_to_dict(conn.execute("SELECT * FROM characters WHERE id=?", (cid,)).fetchone())
    if not st or not c:
        return {}
    pers = effective_personality(conn, player_id, c)
    cur = st.get("affect") or affect.baseline(pers)
    new = affect.appraise(cur, stimulus, pers, intensity)
    stress = max(0.0, min(1.0, float(st.get("stress") or 0) + (0.08 * intensity if new["p"] < -0.3 else -0.02)))
    conn.execute("UPDATE character_states SET affect=?, mood=?, stress=?, updated_at=? WHERE player_id=? AND character_id=?",
                 (db.dumps(new), new["label"], round(stress, 3), db.now_iso(), player_id, cid))
    return new


def age_world(conn: sqlite3.Connection, player_id: str, ord_: int, steps: float = 1.0) -> None:
    """Time passes: emotions settle, era-specific drives switch, stress slowly eases."""
    from . import affect

    chars = {r["id"]: db.row_to_dict(r) for r in conn.execute("SELECT * FROM characters")}
    updates = []
    for st in db.rows_to_dicts(conn.execute("SELECT * FROM character_states WHERE player_id=?", (player_id,)).fetchall()):
        c = chars.get(st["character_id"])
        if not c:
            continue
        aff = affect.decay(st.get("affect") or affect.baseline(c.get("personality") or {}), steps)
        goals = st.get("goals") or []
        custom = [g for g in goals if g.get("source") in ("reflection", "plot", "player")]
        drives = priors.active_drives(c.get("drives") or [], ord_)
        merged = custom + [d for d in drives if d["goal"] not in {g["goal"] for g in custom}]
        stress = max(0.0, float(st.get("stress") or 0) - 0.05 * steps)
        updates.append((db.dumps(aff), aff["label"], round(stress, 3), db.dumps(merged[:8]), db.now_iso(), player_id, st["character_id"]))
    conn.executemany("UPDATE character_states SET affect=?, mood=?, stress=?, goals=?, updated_at=? WHERE player_id=? AND character_id=?",
                     updates)


def add_goal(conn: sqlite3.Connection, player_id: str, cid: str, goal: str, priority: float, source: str) -> None:
    st = _state(conn, player_id, cid)
    if not st:
        return
    goals = [g for g in (st.get("goals") or []) if g["goal"].lower() != goal.lower()]
    goals.insert(0, {"goal": goal[:200], "priority": round(max(0.1, min(1.0, priority)), 2), "source": source})
    goals.sort(key=lambda g: -float(g.get("priority", 0.5)))
    conn.execute("UPDATE character_states SET goals=?, updated_at=? WHERE player_id=? AND character_id=?",
                 (db.dumps(goals[:8]), db.now_iso(), player_id, cid))


def add_belief(conn: sqlite3.Connection, player_id: str, cid: str, belief: str, confidence: float, about: str | None,
               ord_: int) -> None:
    st = _state(conn, player_id, cid)
    if not st:
        return
    beliefs = [b for b in (st.get("beliefs") or []) if b["belief"].lower() != belief.lower()]
    beliefs.insert(0, {"belief": belief[:240], "confidence": round(max(0.05, min(1.0, confidence)), 2), "about": about, "ord": ord_})
    conn.execute("UPDATE character_states SET beliefs=?, updated_at=? WHERE player_id=? AND character_id=?",
                 (db.dumps(beliefs[:16]), db.now_iso(), player_id, cid))


def profile(conn: sqlite3.Connection, player_id: str | None, c: dict[str, Any], ord_: int) -> dict[str, Any]:
    """The evolved behavioural profile used in prompts and shown in the UI."""
    st = _state(conn, player_id, c["id"]) if player_id else None
    from . import affect

    base = c.get("personality") or priors.personality(c)
    eff = effective_personality(conn, player_id, c)
    return {
        "prior": base,
        "effective": eff,
        "drift": (st or {}).get("personality_drift") or {},
        "affect": (st or {}).get("affect") or affect.baseline(eff),
        "mood": (st or {}).get("mood") or "calm",
        "stress": (st or {}).get("stress") or 0,
        "goals": (st or {}).get("goals") or priors.active_drives(c.get("drives") or [], ord_),
        "beliefs": (st or {}).get("beliefs") or [],
        "learned": (st or {}).get("learned") or [],
        "counters": (st or {}).get("counters") or {},
    }
