"""Reflection: consolidating experience into long-term memory and changed behaviour.

After a conversation (every few messages, and when a thread is closed) each participating
character "sleeps on it": the reflection agent reads the transcript in that character's
own voice and proposes
  * a first-person reflective memory (high importance),
  * beliefs about the player and others (with confidence),
  * at most two learned behavioural rules,
  * a small, bounded personality drift,
  * an updated goal, if the conversation changed what they want.
All proposals are validated and clamped here before being applied.
"""
from __future__ import annotations

from typing import Any

from .. import db
from ..canon.priors import DIMENSIONS
from ..canon.timeline import label
from ..memory import service as memory
from . import agents, behavior, relationships, world_state

REFLECT_EVERY = 6  # messages


def _transcript(conn, thread_id: str, since_id: int) -> tuple[list[dict[str, Any]], int]:
    rows = db.rows_to_dicts(conn.execute("SELECT * FROM messages WHERE thread_id=? AND id>? ORDER BY id", (thread_id, since_id)).fetchall())
    return rows, (rows[-1]["id"] if rows else since_id)


async def reflect_thread(thread_id: str, force: bool = False) -> dict[str, Any]:
    with db.db() as conn:
        t = db.row_to_dict(conn.execute("SELECT * FROM threads WHERE id=?", (thread_id,)).fetchone())
        if not t:
            return {"skipped": "thread not found"}
        player = db.row_to_dict(conn.execute("SELECT * FROM players WHERE id=?", (t["player_id"],)).fetchone())
        msgs, last_id = _transcript(conn, thread_id, t["reflected_upto"])
        if not msgs or (len(msgs) < REFLECT_EVERY and not force):
            return {"skipped": "not enough new messages"}
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
        transcript = "\n".join(
            f"{player['name'] if m['role'] == 'player' else names.get(m['speaker_id'] or '', m['role'])}: {m['content']}"  # type: ignore[index]
            for m in msgs if m["role"] in ("player", "character", "narrator"))[-6000:]
        chars = [c for c in t["character_ids"] if c in names]
        ord_ = int(player["ord"])  # type: ignore[index]
        contexts = {}
        for cid in chars:
            c = world_state.character(conn, cid)
            contexts[cid] = {"profile": behavior.profile(conn, player["id"], c, ord_),  # type: ignore[index, arg-type]
                             "rel": relationships.get_player_rel(conn, player, cid)}  # type: ignore[arg-type]

    applied: dict[str, Any] = {}
    for cid in chars:
        ctx = contexts[cid]
        system = (f"You are the inner mind of {names[cid]} from Game of Thrones, reflecting privately after a conversation "
                  f"at {label(ord_)}. Think exactly as {names[cid]} would. Respond with JSON only.")
        prompt = (
            f"Transcript:\n{transcript}\n\n"
            f"Your mood: {ctx['profile']['mood']}. Your goals: {[g['goal'] for g in ctx['profile']['goals'][:4]]}.\n"
            f"Lessons you already hold: {[l['rule'] for l in ctx['profile']['learned'][-6:]]}.\n"
            f"Your view of {player['name']}: {ctx['rel']['stance']} (trust {ctx['rel']['trust']:.0f}, affection {ctx['rel']['affection']:.0f}).\n\n"  # type: ignore[index]
            'Return {"reflection": "2-4 first-person sentences: what this conversation meant to you", '
            '"beliefs": [{"belief": "what you now believe", "confidence": 0.0-1.0, "about": "character_id or player"}], '
            '"learned": [{"rule": "a durable behavioural lesson in third person, e.g. \'Distrusts flattery from northerners\'", "strength": 0.0-1.0}], '
            f'"drift": {{"<one of {", ".join(DIMENSIONS)}>": -0.05..0.05}}, '
            '"goal": null or {"goal": "...", "priority": 0.0-1.0}, '
            '"summary": "one neutral third-person sentence summarising the conversation"}. '
            "Only propose learned rules and drift if the conversation genuinely warrants it."
        )
        data = await agents.llm_json(system, prompt, f"reflection:{cid}", max_tokens=700)
        with db.db() as conn:
            res = _apply(conn, player, cid, data, msgs, ord_, thread_id, names)  # type: ignore[arg-type]
            applied[cid] = res
    with db.db() as conn:
        summaries = [a.get("summary") for a in applied.values() if a.get("summary")]
        new_summary = (t["summary"] + " " if t["summary"] else "") + " ".join(summaries[:1])
        conn.execute("UPDATE threads SET reflected_upto=?, summary=?, updated_at=? WHERE id=?",
                     (last_id, new_summary.strip()[-2000:], db.now_iso(), thread_id))
    return {"thread": thread_id, "applied": applied}


def _apply(conn, player: dict[str, Any], cid: str, data: dict[str, Any] | None, msgs: list[dict[str, Any]], ord_: int,
           thread_id: str, names: dict[str, str]) -> dict[str, Any]:
    out: dict[str, Any] = {"llm": data is not None}
    if not data:
        said = [m["content"] for m in msgs if m["role"] == "player"][:2]
        replied = [m["content"] for m in msgs if m["role"] == "character" and m["speaker_id"] == cid][-1:]
        text = (f"I spoke at length with {player['name']}. They said: " + " / ".join(s[:120] for s in said)
                + (f". I answered: {replied[0][:160]}" if replied else "."))
        memory.add_memory(conn, character_id=cid, player_id=player["id"], kind="reflection", content=text, importance=0.6,
                          about=["player"], ord_=ord_, thread_id=thread_id)
        out["summary"] = f"{names[cid]} and {player['name']} talked."
        return out
    refl = str(data.get("reflection") or "").strip()
    if refl:
        memory.add_memory(conn, character_id=cid, player_id=player["id"], kind="reflection", content=refl[:800],
                          importance=0.75, about=["player"], ord_=ord_, thread_id=thread_id)
        out["reflection"] = refl
    beliefs = []
    for b in (data.get("beliefs") or [])[:3]:
        if isinstance(b, dict) and str(b.get("belief") or "").strip():
            about = b.get("about") if isinstance(b.get("about"), str) else None
            behavior.add_belief(conn, player["id"], cid, str(b["belief"]), agents._num(b.get("confidence"), 0, 1, 0.6), about, ord_)
            memory.add_memory(conn, character_id=cid, player_id=player["id"], kind="semantic", content=str(b["belief"])[:400],
                              importance=0.55 + 0.3 * agents._num(b.get("confidence"), 0, 1, 0.6), about=[about] if about else [],
                              counterpart_id=about if about in names else None, ord_=ord_, thread_id=thread_id)
            beliefs.append(b["belief"])
    out["beliefs"] = beliefs
    learned = []
    for l in (data.get("learned") or [])[:2]:
        if isinstance(l, dict) and str(l.get("rule") or "").strip():
            if behavior.add_learned(conn, player["id"], cid, str(l["rule"]), f"reflection:{thread_id}", ord_,
                                    agents._num(l.get("strength"), 0.1, 1, 0.5), "player"):
                learned.append(l["rule"])
    out["learned"] = learned
    drift = {k: agents._num(v, -0.05, 0.05) for k, v in (data.get("drift") or {}).items() if k in DIMENSIONS}
    if drift:
        out["drift"] = behavior.apply_drift(conn, player["id"], cid, drift)
    g = data.get("goal")
    if isinstance(g, dict) and str(g.get("goal") or "").strip():
        behavior.add_goal(conn, player["id"], cid, str(g["goal"]), agents._num(g.get("priority"), 0, 1, 0.6), "reflection")
        out["goal"] = g["goal"]
    out["summary"] = str(data.get("summary") or "")[:300]
    return out
