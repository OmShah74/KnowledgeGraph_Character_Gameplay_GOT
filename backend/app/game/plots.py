"""Emergent plot threads.

Plots are generated from *tensions* in a player's world rather than from the script:

  feud        two co-located characters who have come to hate each other
  war         two factions at war with comparable power
  conspiracy  an ambitious, cunning character whose goals collide with a ruler
  secret      a high-secrecy fact known to several people — it is going to come out
  courtship   strong mutual affection that is not (yet) a canon romance

Each plot has ordered stages and a tension value. Every world tick tension moves according to
the underlying state (relationship hostility, faction power, how far a secret has spread,
whether the player is involved) plus noise. Crossing a threshold advances the stage and fires
consequences; the final stage resolves the plot with outcomes that can diverge from canon —
including deaths, so the world genuinely branches.
"""
from __future__ import annotations

import random
import sqlite3
from typing import Any

from .. import db
from ..canon.timeline import label
from ..graph import store as kg
from ..memory import service as memory
from . import behavior, relationships, world_state

TEMPLATES: dict[str, list[tuple[str, str]]] = {
    "feud": [("Simmering", "Old grievances fester; barbed words and cold looks."),
             ("Provocation", "One of them makes a public insult or a petty move against the other."),
             ("Confrontation", "Steel is drawn or a decisive accusation is made before witnesses."),
             ("Reckoning", "The feud is settled — by blood, exile, or a grudging truce.")],
    "war": [("Mustering", "Banners are called; ravens fly; lords choose sides."),
            ("Skirmishes", "Raids and small battles bleed both sides."),
            ("Decisive battle", "The hosts meet. Everything turns on this day."),
            ("Aftermath", "Victors impose terms; the defeated plot their return.")],
    "conspiracy": [("Whispers", "A plan is conceived in private."),
                   ("Recruitment", "Allies are sounded out; coin and promises change hands."),
                   ("The move", "The conspirators strike."),
                   ("Exposure or triumph", "The plot is revealed — or its architect rises.")],
    "secret": [("Buried", "Only a few know the truth."),
               ("Spreading", "Rumours begin to move from mouth to ear."),
               ("Revelation", "The secret comes out, and with it, consequences.")],
    "courtship": [("Glances", "Something unspoken passes between them."),
                  ("Confidences", "They seek each other out and share secrets."),
                  ("Declaration", "Feelings are confessed — and the world reacts.")],
}


def _exists(conn: sqlite3.Connection, player_id: str, key_chars: list[str], kind: str) -> bool:
    for r in conn.execute("SELECT characters, stages FROM plot_threads WHERE player_id=? AND status='active'", (player_id,)):
        chars = set(db.row_to_dict(r)["characters"])  # type: ignore[index]
        if set(key_chars) <= chars and kind in (r["stages"] or ""):
            return True
    return False


def create_plot(conn: sqlite3.Connection, player_id: str, *, kind: str, title: str, premise: str, stakes: str,
                characters: list[str], factions: list[str] | None = None, ord_: int, origin: str = "emergent",
                tension: float = 0.3, stages: list[dict[str, str]] | None = None, player_involved: bool = False) -> dict[str, Any]:
    pid = db.new_id("plot_")
    st = stages or [{"name": n, "description": d, "kind": kind} for n, d in TEMPLATES.get(kind, TEMPLATES["feud"])]
    for s in st:
        s.setdefault("kind", kind)
    now = db.now_iso()
    conn.execute(
        """INSERT INTO plot_threads(id, player_id, title, premise, stakes, origin, characters, factions, stages, stage, tension, status,
           player_involved, log, ord_started, updated_ord, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,0,?, 'active', ?, ?, ?, ?, ?, ?)""",
        (pid, player_id, title[:140], premise[:800], stakes[:400], origin, db.dumps(characters), db.dumps(factions or []),
         db.dumps(st), round(tension, 3), int(player_involved),
         db.dumps([{"ord": ord_, "label": label(ord_), "text": f"Plot begins: {premise[:300]}"}]), ord_, ord_, now, now))
    try:
        kg.upsert_node(conn, pid, "Plot", title[:80], {"premise": premise, "kind": kind, "tension": tension, "stage": 0},
                       layer="player", player_id=player_id)
        for c in characters:
            kg.add_edge(conn, pid, "INVOLVES", c, layer="player", player_id=player_id)
        for f in factions or []:
            if conn.execute("SELECT 1 FROM kg_nodes WHERE id=?", (f,)).fetchone():
                kg.add_edge(conn, pid, "INVOLVES", f, layer="player", player_id=player_id)
    except Exception:  # noqa: BLE001
        pass
    return db.row_to_dict(conn.execute("SELECT * FROM plot_threads WHERE id=?", (pid,)).fetchone())  # type: ignore[return-value]


def mine_tensions(conn: sqlite3.Connection, player_id: str, ord_: int, rng: random.Random, max_new: int = 2) -> list[dict[str, Any]]:
    """Discover new plots from the current state of the world (heuristic generator)."""
    created: list[dict[str, Any]] = []
    active = conn.execute("SELECT COUNT(*) FROM plot_threads WHERE player_id=? AND status='active'", (player_id,)).fetchone()[0]
    if active >= 8:
        return created
    names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
    roster = [r for r in world_state.roster(conn, player_id, ord_) if r["alive"] and r["location_id"] and r["tier"] != "minor"]
    by_loc: dict[str, list[str]] = {}
    for r in roster:
        by_loc.setdefault(r["location_id"], []).append(r["id"])

    candidates: list[tuple[float, dict[str, Any]]] = []
    # Feuds & courtships among co-located characters
    for loc, ids in by_loc.items():
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                rab = relationships.get_char_rel(conn, player_id, a, b, ord_, create=False)
                rba = relationships.get_char_rel(conn, player_id, b, a, ord_, create=False)
                hostility = -(rab["trust"] + rab["affection"] + rba["trust"] + rba["affection"]) / 400
                warmth = (rab["affection"] + rba["affection"]) / 200
                if hostility > 0.35:
                    candidates.append((hostility + rng.random() * 0.2, {
                        "kind": "feud", "characters": [a, b],
                        "title": f"Bad blood: {names[a]} and {names[b]}",
                        "premise": f"At {world_state.LOCATIONS[loc]['name']}, {names[a]} and {names[b]} can barely stand each other. "
                                   f"Their grievances ({rab['stance']} / {rba['stance']}) are close to boiling over.",
                        "stakes": "Lives, honour, and the loyalty of everyone caught between them.", "tension": min(0.6, hostility)}))
                elif warmth > 0.45 and not conn.execute(
                        "SELECT 1 FROM kg_edges WHERE type IN ('LOVER_OF','SPOUSE_OF','PARENT_OF','SIBLING_OF') AND ((source=? AND target=?) OR (source=? AND target=?))",
                        (a, b, b, a)).fetchone():
                    candidates.append((warmth * 0.7 + rng.random() * 0.2, {
                        "kind": "courtship", "characters": [a, b],
                        "title": f"An unlikely bond: {names[a]} and {names[b]}",
                        "premise": f"{names[a]} and {names[b]} have grown close at {world_state.LOCATIONS[loc]['name']} — closer than is wise.",
                        "stakes": "Hearts, alliances and reputations.", "tension": 0.25}))
    # Wars between factions of comparable power
    facs = {f["faction_id"]: f for f in world_state.factions(conn, player_id)}
    for fid, f in facs.items():
        for other, stance in (f["stances"] or {}).items():
            if stance == "war" and other in facs and fid < other:
                g = facs[other]
                balance = 1 - abs(f["power"] - g["power"]) / 100
                if f["power"] > 15 and g["power"] > 15:
                    leaders = [x for x in (f["leader_id"], g["leader_id"]) if x]
                    candidates.append((balance * 0.8 + rng.random() * 0.2, {
                        "kind": "war", "characters": leaders, "factions": [fid, other],
                        "title": f"War: {f['name']} against {g['name']}",
                        "premise": f"{f['name']} (power {f['power']:.0f}) and {g['name']} (power {g['power']:.0f}) are locked in war.",
                        "stakes": "Castles, crowns and the lives of thousands of smallfolk.", "tension": 0.35}))
    # Conspiracies from ambitious, cunning characters
    for r in roster:
        c = world_state.character(conn, r["id"])
        if not c:
            continue
        p = behavior.effective_personality(conn, player_id, c)
        if p["ambition"] > 0.72 and p["cunning"] > 0.68:
            target = next((x["id"] for x in relationships.character_network(conn, player_id, r["id"], ord_, 8)
                           if x["disposition"] == "hostile" or x["stance"] in ("respected rival", "wary")), None)
            if target and target in names:
                candidates.append((p["ambition"] * p["cunning"] + rng.random() * 0.2, {
                    "kind": "conspiracy", "characters": [r["id"], target],
                    "title": f"{names[r['id']]}'s scheme",
                    "premise": f"{names[r['id']]} is quietly working to undermine {names[target]}.",
                    "stakes": "Power — and the schemer's own neck.", "tension": 0.2}))
    # Secrets that are spreading
    for f in db.rows_to_dicts(conn.execute(
            """SELECT f.*, COUNT(k.character_id) n FROM facts f JOIN fact_knowledge k ON k.fact_id=f.id
               WHERE f.player_id=? AND f.secrecy >= 0.6 GROUP BY f.id HAVING n >= 2""", (player_id,)).fetchall()):
        knowers = [r["character_id"] for r in conn.execute("SELECT character_id FROM fact_knowledge WHERE fact_id=?", (f["id"],))]
        candidates.append((0.5 + f["n"] * 0.1, {
            "kind": "secret", "characters": knowers[:5],
            "title": f"A secret in danger: {f['content'][:60]}",
            "premise": f"\"{f['content']}\" — {f['n']} people already know.", "stakes": "Reputations, alliances, perhaps lives.",
            "tension": min(0.6, 0.2 + f["n"] * 0.08), "player_involved": True}))

    candidates.sort(key=lambda x: -x[0])
    for _, cand in candidates:
        if len(created) >= max_new:
            break
        if _exists(conn, player_id, cand["characters"][:2], cand["kind"]):
            continue
        created.append(create_plot(conn, player_id, kind=cand["kind"], title=cand["title"], premise=cand["premise"],
                                   stakes=cand["stakes"], characters=cand["characters"], factions=cand.get("factions"),
                                   ord_=ord_, tension=cand["tension"], player_involved=cand.get("player_involved", False)))
    return created


def _pressure(conn: sqlite3.Connection, player_id: str, plot: dict[str, Any], ord_: int) -> float:
    kind = (plot["stages"] or [{}])[0].get("kind", "feud")
    chars = plot["characters"] or []
    if kind in ("feud", "conspiracy") and len(chars) >= 2:
        r = relationships.get_char_rel(conn, player_id, chars[0], chars[1], ord_, create=False)
        return max(0.0, -(r["trust"] + r["affection"]) / 200) * 0.25 + 0.04
    if kind == "courtship" and len(chars) >= 2:
        r = relationships.get_char_rel(conn, player_id, chars[0], chars[1], ord_, create=False)
        return max(0.0, r["affection"] / 100) * 0.2 + 0.03
    if kind == "war":
        return 0.12
    if kind == "secret":
        return 0.06 * len(chars)
    return 0.05


def advance(conn: sqlite3.Connection, player_id: str, ord_: int, rng: random.Random) -> list[dict[str, Any]]:
    """Advance all active plots one tick. Returns stage transitions/resolutions."""
    names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
    out = []
    for plot in db.rows_to_dicts(conn.execute("SELECT * FROM plot_threads WHERE player_id=? AND status='active'", (player_id,)).fetchall()):
        # Plots whose principals are dead collapse.
        alive = []
        for cid in plot["characters"]:
            c = world_state.character(conn, cid)
            if c and world_state.is_alive(c, world_state.state(conn, player_id, cid), ord_):
                alive.append(cid)
        if len(alive) < min(2, len(plot["characters"])) and plot["characters"]:
            _log(conn, plot, ord_, "The plot dies with its principals.", status="failed")
            out.append({"plot": plot["title"], "event": "collapsed"})
            continue
        stages = plot["stages"] or []
        tension = float(plot["tension"]) + _pressure(conn, player_id, plot, ord_) + rng.uniform(-0.04, 0.08) \
            + (0.05 if plot["player_involved"] else 0)
        tension = max(0.0, min(1.0, tension))
        stage = int(plot["stage"])
        threshold = 0.35 + 0.18 * stage
        if tension >= threshold and stage < len(stages) - 1:
            stage += 1
            text = _stage_effects(conn, player_id, plot, stage, ord_, rng, names)
            conn.execute("UPDATE plot_threads SET stage=?, tension=?, updated_ord=?, updated_at=? WHERE id=?",
                         (stage, round(tension * 0.7, 3), ord_, db.now_iso(), plot["id"]))
            _log(conn, plot, ord_, f"{stages[stage]['name']}: {text}")
            out.append({"plot": plot["title"], "event": "stage", "stage": stages[stage]["name"], "text": text, "id": plot["id"]})
        elif tension >= 0.95 and stage == len(stages) - 1:
            text = _resolve(conn, player_id, plot, ord_, rng, names)
            _log(conn, plot, ord_, f"Resolution: {text}", status="resolved")
            out.append({"plot": plot["title"], "event": "resolved", "text": text, "id": plot["id"]})
        else:
            conn.execute("UPDATE plot_threads SET tension=?, updated_ord=?, updated_at=? WHERE id=?",
                         (round(tension, 3), ord_, db.now_iso(), plot["id"]))
    return out


def _log(conn: sqlite3.Connection, plot: dict[str, Any], ord_: int, text: str, status: str | None = None) -> None:
    row = conn.execute("SELECT log FROM plot_threads WHERE id=?", (plot["id"],)).fetchone()
    log = db.row_to_dict(row)["log"] if row else []  # type: ignore[index]
    log.append({"ord": ord_, "label": label(ord_), "text": text[:600]})
    if status:
        conn.execute("UPDATE plot_threads SET log=?, status=?, updated_ord=?, updated_at=? WHERE id=?",
                     (db.dumps(log[-40:]), status, ord_, db.now_iso(), plot["id"]))
    else:
        conn.execute("UPDATE plot_threads SET log=?, updated_at=? WHERE id=?", (db.dumps(log[-40:]), db.now_iso(), plot["id"]))


def _remember_all(conn: sqlite3.Connection, player_id: str, chars: list[str], text: str, ord_: int, importance: float) -> None:
    for cid in chars:
        others = [c for c in chars if c != cid]
        memory.add_memory(conn, character_id=cid, player_id=player_id, kind="world", content=text, importance=importance,
                          about=others, counterpart_id=others[0] if others else None, ord_=ord_)


def _stage_effects(conn: sqlite3.Connection, player_id: str, plot: dict[str, Any], stage: int, ord_: int,
                   rng: random.Random, names: dict[str, str]) -> str:
    stages = plot["stages"]
    kind = stages[0].get("kind", "feud")
    chars = plot["characters"]
    a, b = (chars + [None, None])[:2]
    na, nb = names.get(a or "", a), names.get(b or "", b)
    text = stages[stage]["description"]
    if kind == "feud" and a and b:
        relationships.apply_char_delta(conn, player_id, a, b, {"trust": -6, "affection": -8}, f"plot: {plot['title']}", ord_)
        relationships.apply_char_delta(conn, player_id, b, a, {"trust": -6, "affection": -8}, f"plot: {plot['title']}", ord_)
        behavior.update_affect(conn, player_id, a, "insulted")
        behavior.update_affect(conn, player_id, b, "insulted")
        text = f"{na} and {nb}: {text}"
    elif kind == "courtship" and a and b:
        relationships.apply_char_delta(conn, player_id, a, b, {"affection": 8, "trust": 4}, f"plot: {plot['title']}", ord_)
        relationships.apply_char_delta(conn, player_id, b, a, {"affection": 8, "trust": 4}, f"plot: {plot['title']}", ord_)
        behavior.update_affect(conn, player_id, a, "romance", 0.6)
        behavior.update_affect(conn, player_id, b, "romance", 0.6)
        text = f"{na} and {nb}: {text}"
    elif kind == "war":
        for f in plot["factions"] or []:
            world_state.adjust_faction(conn, player_id, f, power=-rng.uniform(2, 7), stability=-rng.uniform(1, 5))
    elif kind == "conspiracy" and a and b:
        relationships.apply_char_delta(conn, player_id, a, b, {"trust": -4}, f"plot: {plot['title']}", ord_)
        behavior.add_goal(conn, player_id, a, f"See {nb} brought low", 0.75, "plot")
        text = f"{na}: {text}"
    elif kind == "secret":
        text = f"{text} ({len(chars)} people involved)"
    _remember_all(conn, player_id, [c for c in chars if c], f"{plot['title']} — {text}", ord_, 0.6)
    return text


def _resolve(conn: sqlite3.Connection, player_id: str, plot: dict[str, Any], ord_: int, rng: random.Random,
             names: dict[str, str]) -> str:
    kind = (plot["stages"] or [{}])[0].get("kind", "feud")
    chars = plot["characters"]
    if kind in ("feud", "conspiracy") and len(chars) >= 2:
        a, b = chars[0], chars[1]
        ca, cb = world_state.character(conn, a), world_state.character(conn, b)
        sa = (ca or {}).get("stats") or {}
        sb = (cb or {}).get("stats") or {}
        key = "intrigue" if kind == "conspiracy" else "prowess"
        roll_a = sa.get(key, 5) + rng.randint(1, 20)
        roll_b = sb.get(key, 5) + rng.randint(1, 20)
        winner, loser = (a, b) if roll_a >= roll_b else (b, a)
        cl = world_state.character(conn, loser) or {}
        lethal_chance = {"major": 0.06, "supporting": 0.2}.get(cl.get("tier", "minor"), 0.35)
        if rng.random() < lethal_chance:
            world_state.set_alive(conn, player_id, loser, False, ord_, f"Killed in '{plot['title']}' by {names.get(winner)}")
            for cid in (winner, loser):
                behavior.record_pattern(conn, player_id, cid, "victory" if cid == winner else "grief", "", "", ord_)
            text = f"{names.get(winner)} prevails; {names.get(loser)} is slain. The world turns from its old course."
            try:
                kg.add_edge(conn, winner, "KILLED", loser, props={"plot": plot["id"]}, valid_from=ord_, layer="player",
                            player_id=player_id)
            except Exception:  # noqa: BLE001
                pass
        else:
            relationships.apply_char_delta(conn, player_id, loser, winner, {"fear": 12, "respect": 6, "trust": -5}, "lost the feud", ord_)
            text = f"{names.get(winner)} gets the upper hand; {names.get(loser)} is humbled but alive."
        behavior.update_affect(conn, player_id, winner, "won_fight")
        behavior.update_affect(conn, player_id, loser, "humiliated")
    elif kind == "courtship" and len(chars) >= 2:
        a, b = chars[0], chars[1]
        try:
            kg.add_edge(conn, a, "LOVER_OF", b, props={"plot": plot["id"], "emergent": True}, valid_from=ord_,
                        layer="player", player_id=player_id)
        except Exception:  # noqa: BLE001
            pass
        text = f"{names.get(a)} and {names.get(b)} become lovers — whatever the world may say."
    elif kind == "war":
        facs = world_state.factions(conn, player_id)
        fs = [f for f in facs if f["faction_id"] in (plot["factions"] or [])]
        if len(fs) == 2:
            w, l = sorted(fs, key=lambda f: -(f["power"] + rng.uniform(-15, 15)))
            world_state.adjust_faction(conn, player_id, w["faction_id"], power=8, influence=6)
            world_state.adjust_faction(conn, player_id, l["faction_id"], power=-15, stability=-12)
            text = f"{w['name']} wins a decisive victory over {l['name']}."
        else:
            text = "The war burns itself out without a clear victor."
    elif kind == "secret":
        text = "The secret is out. Everyone involved must now live with what is known."
        for cid in chars:
            behavior.update_affect(conn, player_id, cid, "bad_news", 0.6)
    else:
        text = "The matter is settled."
    _remember_all(conn, player_id, chars, f"{plot['title']} ended: {text}", ord_, 0.75)
    return text


def link_thread(conn: sqlite3.Connection, player_id: str, thread_id: str, character_ids: list[str]) -> list[str]:
    """Link a conversation thread to every active plot that involves its characters."""
    linked = []
    for p in db.rows_to_dicts(conn.execute("SELECT id, title, characters FROM plot_threads WHERE player_id=? AND status='active'",
                                           (player_id,)).fetchall()):
        if set(character_ids) & set(p["characters"]):
            cur = conn.execute(
                """INSERT OR IGNORE INTO thread_links(player_id, from_thread, to_kind, to_id, relation, note, created_at)
                   VALUES(?,?,?,?,?,?,?)""", (player_id, thread_id, "plot", p["id"], "involves", p["title"], db.now_iso()))
            if cur.rowcount:
                linked.append(p["id"])
                conn.execute("UPDATE plot_threads SET player_involved=1 WHERE id=?", (p["id"],))
    return linked
