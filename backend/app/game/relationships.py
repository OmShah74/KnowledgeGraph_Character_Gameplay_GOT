"""Relationships: priors, criteria and evolution.

Five dimensions on every directed relationship (a's view of b):
  trust      -100..100   will they rely on / believe you
  affection  -100..100   warmth, love, hatred
  respect    -100..100   regard for competence, status, honour
  fear          0..100   how threatened they feel
  familiarity   0..100   how well they know you

Priors between characters are computed from the canon knowledge graph (family, marriage,
service, alliance, enmity, betrayal, kills...) active at the current point of the timeline,
from how much they actually talk in the script, from house/faction stances, and from
personality compatibility. Each player's world copies a prior the first time it is needed
and then evolves it independently (conversations, scenes, off-screen simulation, rumours).
"""
from __future__ import annotations

import sqlite3
from typing import Any

from .. import db
from ..canon import priors as canon_priors
from ..graph import store as kg
from . import world_state

DIMS = ("trust", "affection", "respect", "fear", "familiarity")

# relation -> (trust, affection, respect, fear, familiarity), reason
RELATION_PRIORS: dict[str, tuple[tuple[float, float, float, float, float], str]] = {
    "PARENT_OF": ((35, 45, 25, 5, 70), "family (parent/child)"),
    "SIBLING_OF": ((30, 40, 15, 0, 70), "siblings"),
    "RELATIVE_OF": ((15, 20, 10, 0, 30), "blood relatives"),
    "SPOUSE_OF": ((25, 30, 15, 5, 70), "married"),
    "BETROTHED_TO": ((5, 10, 5, 0, 25), "betrothed"),
    "LOVER_OF": ((35, 70, 20, 0, 70), "lovers"),
    "ADMIRES": ((20, 55, 30, 0, 40), "infatuation / devotion"),
    "WARD_OF": ((15, 20, 25, 10, 60), "ward and guardian"),
    "HOSTAGE_OF": ((-45, -40, -5, 45, 40), "captive and captor"),
    "SWORN_TO": ((50, 15, 45, 5, 45), "sworn oath"),
    "SERVES": ((35, 10, 35, 15, 50), "service"),
    "SPIES_ON": ((-15, 5, 0, 0, 40), "spying"),
    "ALLY_OF": ((40, 20, 25, 0, 40), "allies"),
    "ENEMY_OF": ((-60, -55, -10, 25, 30), "enemies"),
    "BETRAYED": ((-75, -45, -20, 15, 45), "betrayal"),
    "MENTOR_OF": ((40, 25, 45, 5, 55), "mentor and student"),
    "KILLED": ((-90, -90, -10, 30, 40), "killed someone they love / blood spilled"),
    "BLOOD_FEUD_WITH": ((-55, -60, -5, 20, 15), "blood feud"),
    "SAME_HOUSE_AS": ((10, 10, 5, 0, 20), "same house"),
    "COUSIN_OF": ((10, 15, 5, 0, 30), "cousins"),
    "UNCLE_OR_AUNT_OF": ((20, 25, 15, 0, 45), "uncle/aunt"),
    "GRANDPARENT_OF": ((20, 30, 20, 5, 45), "grandparent"),
}

# Directed overrides on top of symmetric family priors (canon dysfunction).
DIRECTED_ADJUST: dict[tuple[str, str], tuple[tuple[float, float, float, float, float], str]] = {
    ("tywin_lannister", "tyrion_lannister"): ((-40, -60, -30, 0, 0), "Tywin despises his dwarf son"),
    ("tyrion_lannister", "tywin_lannister"): ((-30, -40, 30, 30, 0), "Tyrion craves and resents his father's regard"),
    ("cersei_lannister", "tyrion_lannister"): ((-60, -70, -20, 0, 0), "Cersei blames Tyrion for their mother's death"),
    ("theon_greyjoy", "balon_greyjoy"): ((-10, 10, 20, 25, -40), "a son raised far from his father"),
    ("balon_greyjoy", "theon_greyjoy"): ((-30, -25, -35, 0, -40), "Balon sees a green-lands boy"),
    ("randyll_tarly", "samwell_tarly"): ((-30, -40, -50, 0, 0), "Randyll is ashamed of Sam"),
    ("samwell_tarly", "randyll_tarly"): ((-20, -10, 10, 60, 0), "Sam fears his father"),
    ("catelyn_stark", "jon_snow"): ((-20, -45, 0, 0, 0), "Catelyn resents Ned's bastard"),
    ("joffrey_baratheon", "tyrion_lannister"): ((-30, -50, -40, 0, 0), "Joffrey loathes his uncle"),
    ("ramsay_bolton", "roose_bolton"): ((-10, -10, 20, 20, 0), "Ramsay hungers for legitimacy"),
    ("stannis_baratheon", "robert_baratheon"): ((0, -25, 0, 0, 0), "Stannis's old resentments"),
}

STANCE_CRITERIA = [
    # (stance, predicate description) — evaluated in order; first match wins
    ("devoted", "trust ≥ 60 and affection ≥ 55"),
    ("beloved", "affection ≥ 65"),
    ("ally", "trust ≥ 35 and affection ≥ 0"),
    ("friend", "affection ≥ 35 and trust ≥ 10"),
    ("respected rival", "respect ≥ 40 and trust < 10"),
    ("terrified of", "fear ≥ 65"),
    ("nemesis", "trust ≤ -60 and affection ≤ -60"),
    ("enemy", "trust ≤ -40 or affection ≤ -45"),
    ("wary", "trust ≤ -15 or fear ≥ 40"),
    ("stranger", "familiarity < 10"),
    ("acquaintance", "otherwise"),
]


def classify(r: dict[str, float]) -> str:
    t, a, rs, f, fa = (float(r.get(k, 0)) for k in DIMS)
    if t >= 60 and a >= 55:
        return "devoted"
    if a >= 65:
        return "beloved"
    if t >= 35 and a >= 0:
        return "ally"
    if a >= 35 and t >= 10:
        return "friend"
    if rs >= 40 and t < 10:
        return "respected rival"
    if f >= 65:
        return "terrified of"
    if t <= -60 and a <= -60:
        return "nemesis"
    if t <= -40 or a <= -45:
        return "enemy"
    if t <= -15 or f >= 40:
        return "wary"
    if fa < 10:
        return "stranger"
    return "acquaintance"


def disposition(r: dict[str, float]) -> str:
    """Coarse friendly / neutral / hostile label used throughout the UI."""
    score = 0.5 * float(r.get("trust", 0)) + 0.5 * float(r.get("affection", 0))
    if score >= 20:
        return "friendly"
    if score <= -20:
        return "hostile"
    return "neutral"


def _clamp(dim: str, v: float) -> float:
    lo = 0.0 if dim in ("fear", "familiarity") else -100.0
    return round(max(lo, min(100.0, v)), 2)


# ------------------------------------------------------------------ priors
def personality_compat(pa: dict[str, float], pb: dict[str, float]) -> float:
    """-1..1: similar honour/compassion attracts, cruelty repels the compassionate."""
    if not pa or not pb:
        return 0.0
    sim = 1 - (abs(pa["honor"] - pb["honor"]) + abs(pa["compassion"] - pb["compassion"]) + abs(pa["humor"] - pb["humor"])) / 3
    clash = max(0.0, pb["cruelty"] - 0.55) * pa["compassion"] + max(0.0, pa["pride"] - 0.6) * max(0.0, pb["pride"] - 0.6)
    return round((sim - 0.5) * 1.2 - clash, 3)


def canon_prior(conn: sqlite3.Connection, a: str, b: str, ord_: int) -> dict[str, Any]:
    vals = {k: 0.0 for k in DIMS}
    reasons: list[str] = []
    edges = conn.execute(
        """SELECT type, source, target, weight, props FROM kg_edges WHERE layer='canon'
           AND ((source=? AND target=?) OR (source=? AND target=?))
           AND (valid_from IS NULL OR valid_from<=?) AND (valid_to IS NULL OR valid_to>=?)""",
        (a, b, b, a, ord_, ord_)).fetchall()
    for e in edges:
        rel = e["type"]
        if rel == "INTERACTS_WITH":
            continue
        if rel == "KILLED":
            # only the victim's side (or kin) hates; the killer may feel little
            if e["source"] == a:
                continue
        pr = RELATION_PRIORS.get(rel)
        if not pr:
            continue
        dv, why = pr
        if rel in ("SERVES", "SWORN_TO") and e["source"] == b:
            dv = (dv[0] * 0.8, dv[1], dv[2] * 0.6, 0, dv[4])  # the liege's view of the servant
        if rel == "HOSTAGE_OF" and e["source"] == b:
            dv = (-20, -10, 0, 5, dv[4])  # captor's view
        if rel == "BETRAYED" and e["source"] == a:
            dv = (-20, -10, -10, 20, dv[4])  # the betrayer's view of the betrayed
        for k, v in zip(DIMS, dv):
            vals[k] += v
        reasons.append(why)
    adj = DIRECTED_ADJUST.get((a, b))
    if adj:
        for k, v in zip(DIMS, adj[0]):
            vals[k] += v
        reasons.append(adj[1])
    # Actual conversation volume up to now builds familiarity.
    x, y = sorted((a, b))
    from ..canon.timeline import from_ord

    season = from_ord(ord_)[0]
    w = conn.execute("SELECT COALESCE(SUM(weight),0) FROM interactions WHERE a=? AND b=? AND season<=?", (x, y, season)).fetchone()[0]
    if w:
        vals["familiarity"] += min(60.0, 8.0 * (w ** 0.5))
        reasons.append(f"spoke together ~{w} times in the script so far")
    ca, cb = world_state.character(conn, a), world_state.character(conn, b)
    if ca and cb:
        compat = personality_compat(ca.get("personality") or {}, cb.get("personality") or {})
        vals["affection"] += compat * 15
        vals["trust"] += compat * 8
        if abs(compat) > 0.2:
            reasons.append("temperaments " + ("align" if compat > 0 else "clash"))
        if ca.get("house") and ca.get("house") == cb.get("house") and not any(e["type"] in ("PARENT_OF", "SIBLING_OF") for e in edges):
            vals["trust"] += 8
            vals["familiarity"] += 10
            reasons.append("same house")
        st = world_state.canon_stances(f"house_{ca.get('house')}", ord_).get(f"house_{cb.get('house')}") if ca.get("house") and cb.get("house") else None
        if st == "war":
            vals["trust"] -= 25
            vals["affection"] -= 15
            vals["fear"] += 10
            reasons.append("their houses are at war")
        elif st == "alliance":
            vals["trust"] += 12
            reasons.append("their houses are allied")
        bs = cb.get("stats") or {}
        vals["respect"] += (bs.get("martial", 5) + bs.get("prowess", 5) + bs.get("diplomacy", 5)) / 3 - 7
        vals["fear"] += max(0.0, ((cb.get("personality") or {}).get("cruelty", 0.5) - 0.55)) * 60 * min(1.0, vals["familiarity"] / 30 + 0.2)
    out = {k: _clamp(k, v) for k, v in vals.items()}
    out["stance"] = classify(out)
    out["disposition"] = disposition(out)
    out["reasons"] = reasons
    return out


# ------------------------------------------------------------------ character <-> character (per world)
def get_char_rel(conn: sqlite3.Connection, player_id: str, a: str, b: str, ord_: int, create: bool = True) -> dict[str, Any]:
    row = db.row_to_dict(conn.execute("SELECT * FROM char_relationships WHERE player_id=? AND a=? AND b=?",
                                      (player_id, a, b)).fetchone())
    if row:
        row["disposition"] = disposition(row)
        return row
    prior = canon_prior(conn, a, b, ord_)
    rec = {k: prior[k] for k in DIMS} | {"stance": prior["stance"]}
    if create:
        conn.execute(
            """INSERT OR IGNORE INTO char_relationships(player_id,a,b,trust,affection,respect,fear,familiarity,stance,interactions,notes,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,0,?,?)""",
            (player_id, a, b, rec["trust"], rec["affection"], rec["respect"], rec["fear"], rec["familiarity"],
             rec["stance"], "; ".join(prior["reasons"])[:500], db.now_iso()))
    return {"player_id": player_id, "a": a, "b": b, **rec, "interactions": 0, "notes": "; ".join(prior["reasons"]),
            "disposition": disposition(rec)}


def apply_char_delta(conn: sqlite3.Connection, player_id: str, a: str, b: str, delta: dict[str, float], reason: str,
                     ord_: int) -> dict[str, Any]:
    cur = get_char_rel(conn, player_id, a, b, ord_)
    new = {k: _clamp(k, float(cur[k]) + float(delta.get(k, 0))) for k in DIMS}
    new["familiarity"] = _clamp("familiarity", new["familiarity"] + 1.5)
    stance = classify(new)
    conn.execute(
        """UPDATE char_relationships SET trust=?,affection=?,respect=?,fear=?,familiarity=?,stance=?,interactions=interactions+1,
           updated_at=? WHERE player_id=? AND a=? AND b=?""",
        (new["trust"], new["affection"], new["respect"], new["fear"], new["familiarity"], stance, db.now_iso(), player_id, a, b))
    conn.execute("INSERT INTO relationship_log(player_id,subject,object,delta,reason,ord,created_at) VALUES(?,?,?,?,?,?,?)",
                 (player_id, a, b, db.dumps({k: delta.get(k, 0) for k in DIMS}), reason[:300], ord_, db.now_iso()))
    try:
        kg.add_edge(conn, a, "REGARDS", b, props={**new, "stance": stance}, weight=max(0.1, (new["trust"] + new["affection"]) / 100 + 1),
                    layer="player", player_id=player_id)
    except Exception:  # noqa: BLE001 - graph mirroring is best-effort
        pass
    return {**new, "stance": stance, "disposition": disposition(new), "previous_stance": cur.get("stance")}


def character_network(conn: sqlite3.Connection, player_id: str | None, cid: str, ord_: int, limit: int = 15) -> list[dict[str, Any]]:
    """The character's view of the people who matter to them (world state if any, else priors)."""
    partners: dict[str, float] = {}
    for r in conn.execute(
        """SELECT CASE WHEN source=? THEN target ELSE source END AS other, type, weight FROM kg_edges
           WHERE layer='canon' AND (source=? OR target=?) AND (valid_from IS NULL OR valid_from<=?) AND (valid_to IS NULL OR valid_to>=?)""",
            (cid, cid, cid, ord_, ord_)):
        other = r["other"]
        if not conn.execute("SELECT 1 FROM characters WHERE id=?", (other,)).fetchone():
            continue
        w = 6.0 if r["type"] in RELATION_PRIORS else min(5.0, float(r["weight"] or 1) / 4)
        partners[other] = partners.get(other, 0) + w
    if player_id:
        for r in conn.execute("SELECT b, interactions FROM char_relationships WHERE player_id=? AND a=?", (player_id, cid)):
            partners[r["b"]] = partners.get(r["b"], 0) + 3 + r["interactions"]
    out = []
    for other, _w in sorted(partners.items(), key=lambda x: -x[1])[:limit]:
        rel = get_char_rel(conn, player_id, cid, other, ord_, create=False) if player_id else canon_prior(conn, cid, other, ord_)
        name = conn.execute("SELECT name FROM characters WHERE id=?", (other,)).fetchone()
        out.append({"id": other, "name": name["name"] if name else other, **{k: rel[k] for k in DIMS},
                    "stance": rel["stance"], "disposition": disposition(rel),
                    "reasons": rel.get("reasons") or ([rel["notes"]] if rel.get("notes") else [])})
    return out


# ------------------------------------------------------------------ player <-> character
def player_prior(conn: sqlite3.Connection, player: dict[str, Any], c: dict[str, Any]) -> dict[str, float]:
    pers = c.get("personality") or canon_priors.personality(c)
    base_trust = canon_priors.stranger_trust(c, pers) * 40
    rep = (player.get("reputation") or {})
    house_rep = float(rep.get(f"house_{c.get('house')}", 0)) if c.get("house") else 0.0
    trust = base_trust + house_rep * 0.4
    affection = house_rep * 0.2 + (pers["compassion"] - 0.5) * 10
    respect = float(player.get("renown", 0)) * 0.5 + (10 if player.get("allegiance") == c.get("house") else 0)
    if player.get("allegiance") and c.get("house"):
        st = world_state.canon_stances(f"house_{c['house']}", int(player.get("ord", 1))).get(f"house_{player['allegiance']}")
        if player["allegiance"] == c["house"]:
            trust += 20
            affection += 10
        elif st == "war":
            trust -= 30
            affection -= 15
        elif st == "alliance":
            trust += 10
    return {"trust": _clamp("trust", trust), "affection": _clamp("affection", affection), "respect": _clamp("respect", respect),
            "fear": 0.0, "familiarity": 0.0}


def get_player_rel(conn: sqlite3.Connection, player: dict[str, Any], cid: str) -> dict[str, Any]:
    row = db.row_to_dict(conn.execute("SELECT * FROM player_relationships WHERE player_id=? AND character_id=?",
                                      (player["id"], cid)).fetchone())
    if row:
        row["disposition"] = disposition(row)
        return row
    c = world_state.character(conn, cid)
    if not c:
        raise ValueError(f"Unknown character {cid}")
    pr = player_prior(conn, player, c)
    stance = classify(pr)
    conn.execute(
        """INSERT OR IGNORE INTO player_relationships(player_id,character_id,trust,affection,respect,fear,familiarity,stance,notes,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (player["id"], cid, pr["trust"], pr["affection"], pr["respect"], pr["fear"], pr["familiarity"], stance, "", db.now_iso()))
    return {"player_id": player["id"], "character_id": cid, **pr, "stance": stance, "notes": "", "disposition": disposition(pr)}


def apply_player_delta(conn: sqlite3.Connection, player: dict[str, Any], cid: str, delta: dict[str, float], reason: str,
                       ord_: int, max_step: float = 15.0) -> dict[str, Any]:
    cur = get_player_rel(conn, player, cid)
    bounded = {k: max(-max_step, min(max_step, float(delta.get(k, 0) or 0))) for k in DIMS}
    new = {k: _clamp(k, float(cur[k]) + bounded[k]) for k in DIMS}
    new["familiarity"] = _clamp("familiarity", new["familiarity"] + 2)
    stance = classify(new)
    conn.execute(
        """UPDATE player_relationships SET trust=?,affection=?,respect=?,fear=?,familiarity=?,stance=?,updated_at=?
           WHERE player_id=? AND character_id=?""",
        (new["trust"], new["affection"], new["respect"], new["fear"], new["familiarity"], stance, db.now_iso(), player["id"], cid))
    conn.execute("INSERT INTO relationship_log(player_id,subject,object,delta,reason,ord,created_at) VALUES(?,?,?,?,?,?,?)",
                 (player["id"], cid, f"player:{player['id']}", db.dumps(bounded), reason[:300], ord_, db.now_iso()))
    try:
        kg.add_edge(conn, cid, "KNOWS", f"player_{player['id']}", props={**new, "stance": stance},
                    layer="player", player_id=player["id"])
    except Exception:  # noqa: BLE001
        pass
    return {**new, "stance": stance, "disposition": disposition(new), "previous_stance": cur.get("stance"), "delta": bounded}


def history(conn: sqlite3.Connection, player_id: str, subject: str | None = None, obj: str | None = None,
            limit: int = 100) -> list[dict[str, Any]]:
    q = "SELECT * FROM relationship_log WHERE player_id=?"
    params: list[Any] = [player_id]
    if subject:
        q += " AND subject=?"
        params.append(subject)
    if obj:
        q += " AND object=?"
        params.append(obj)
    return db.rows_to_dicts(conn.execute(q + " ORDER BY id DESC LIMIT ?", (*params, limit)).fetchall())
