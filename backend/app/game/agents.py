"""Character agents: the cognitive loop.

perceive   - who is here, what was said, what the dice decided, what time it is in the world
appraise   - the agent judges the stimulus through its (evolved) personality -> emotion
recall     - long-term memory (episodic, dyadic, canon), realm news, rumours it has heard
model      - theory of mind: what the others in the room know / don't know
deliberate - drives, beliefs, learned behaviour rules, relationship criteria
act        - dialogue + physical action + private thought + structured side-effects

The LLM produces a JSON "decision"; the engine validates and applies its side-effects.
When no LLM is available a script-grounded fallback answers with the character's own words.
"""
from __future__ import annotations

import random
import re
import sqlite3
from typing import Any

from .. import db
from ..canon.timeline import from_ord, label
from ..llm.router import AllKeysFailed, LLMError, NoKeysConfigured, router
from ..memory import service as memory
from . import behavior, knowledge, personas, relationships, world_state
from .affect import STIMULI

PATTERNS = ("deceived_by", "threatened_by", "gifted_by", "helped_by", "insulted_by", "flirted_by", "persuaded_by", "betrayed_by")

RESPONSE_SCHEMA = """{
  "dialogue": "what you say aloud, in your own voice (1-5 sentences; empty string if you stay silent)",
  "action": "brief third-person physical action or gesture, present tense (may be empty)",
  "thought": "your private inner monologue — what you really think, plan or fear (never spoken)",
  "appraisal": "one of: %s",
  "relationship_delta": {"trust": 0, "affection": 0, "respect": 0, "fear": 0},
  "feelings_toward_others": [{"id": "character_id present in the scene", "delta": {"trust": 0, "affection": 0, "respect": 0, "fear": 0}, "why": "short reason"}],
  "memory": {"content": "first-person note of what you will remember about this moment", "importance": 0.5},
  "facts_learned": [{"content": "a claim or revelation from this exchange, phrased as a proposition", "believed": 0.7, "secrecy": 0.3, "subjects": ["character_id"]}],
  "patterns": ["zero or more of: %s"],
  "quest": null,
  "goal_update": null,
  "ends_conversation": false
}""" % (", ".join(STIMULI), ", ".join(PATTERNS))

QUEST_HINT = """If — and only if — it is natural for you, you may set "quest" to
{"title": str, "description": str, "objectives": [{"type": "talk_to"|"travel_to"|"persuade", "target": "<character_id or location_id>", "text": str}], "reward": {"gold": int, "renown": int}}.
If your goals change because of this exchange set "goal_update" to {"goal": str, "priority": 0..1}."""


def _fmt_rel(r: dict[str, Any]) -> str:
    return (f"trust {r['trust']:+.0f}, affection {r['affection']:+.0f}, respect {r['respect']:+.0f}, "
            f"fear {r['fear']:.0f}, familiarity {r['familiarity']:.0f} → {r['stance']} ({relationships.disposition(r)})")


def build_context(conn: sqlite3.Connection, *, player: dict[str, Any], character: dict[str, Any], thread: dict[str, Any],
                  user_text: str, intent: str, check: dict[str, Any] | None, present_ids: list[str],
                  history: list[dict[str, Any]], mode: str) -> dict[str, Any]:
    ord_ = int(player["ord"])
    cid = character["id"]
    others = [p for p in present_ids if p != cid]
    loc = world_state.LOCATIONS.get(thread.get("location_id") or player["location_id"], {})
    prof = behavior.profile(conn, player["id"], character, ord_)
    rel = relationships.get_player_rel(conn, player, cid)
    others_rel = []
    for o in others:
        oc = world_state.character(conn, o)
        if not oc:
            continue
        r = relationships.get_char_rel(conn, player["id"], cid, o, ord_)
        others_rel.append({"id": o, "name": oc["name"], "rel": r})
    query = " ".join([user_text] + [h["content"] for h in history[-3:]])
    mems = memory.retrieve(conn, character_id=cid, query=query, ord_=ord_, player_id=player["id"], k=10,
                           counterparts=others or None)
    news = world_state.known_events(conn, player["id"], cid, ord_, limit=8)
    tom = knowledge.theory_of_mind(conn, player["id"], cid, ["player", *others])
    heard = [f for f in knowledge.known_facts(conn, player["id"], cid, 8) if f["learned_from"] not in ("player",)]
    plots = db.rows_to_dicts(conn.execute(
        "SELECT title, premise, stage, stages, tension FROM plot_threads WHERE player_id=? AND status='active' AND characters LIKE ?",
        (player["id"], f'%"{cid}"%')).fetchall())
    alive_status = world_state.is_alive(character, world_state.state(conn, player["id"], cid), ord_)
    return {
        "player": player, "character": character, "thread": thread, "ord": ord_, "label": label(ord_),
        "season": from_ord(ord_)[0], "location": loc, "others": others_rel, "profile": prof, "relationship": rel,
        "memories": mems, "news": news, "tom": tom, "heard": heard, "plots": plots, "history": history,
        "user_text": user_text, "intent": intent, "check": check, "mode": mode, "alive": alive_status,
        "persona": personas.full_persona(conn, character, ord_),
    }


def _system_prompt(ctx: dict[str, Any]) -> str:
    c, p, prof = ctx["character"], ctx["player"], ctx["profile"]
    eff = prof["effective"]
    salient = sorted(eff.items(), key=lambda kv: -abs(kv[1] - 0.5))[:6]
    drift = {k: v for k, v in (prof["drift"] or {}).items() if abs(v) >= 0.02}
    lines = [
        f"You are {c['name']} of the world of Game of Thrones, a living character agent in a role-playing game.",
        f"It is the time of {ctx['label']} (season {ctx['season']}). Everything after this point has NOT happened: "
        "never mention future events, people you have not met, or your own fate.",
        f"You are at {ctx['location'].get('name', 'an unknown place')}: {ctx['location'].get('description', '')}",
        "",
        "## Who you are (permanent behaviour document)",
        ctx["persona"],
        "",
        "## Your current inner state (this evolves over time)",
        f"- Emotion: {prof['affect'].get('label', 'calm')} (pleasure {prof['affect'].get('p', 0):+.2f}, arousal {prof['affect'].get('a', 0):+.2f}, "
        f"dominance {prof['affect'].get('d', 0):+.2f}); stress {float(prof['stress']):.2f}",
        "- Temperament now: " + ", ".join(f"{k} {v:.2f}" for k, v in salient)
        + (f" (changed by experience: {', '.join(f'{k} {v:+.2f}' for k, v in drift.items())})" if drift else ""),
        "- Goals: " + ("; ".join(f"{g['goal']} [{g.get('priority', 0.5)}]" for g in prof["goals"][:5]) or "survive"),
    ]
    if prof["learned"]:
        lines.append("- Lessons you have learned in THIS world (they override your old habits):")
        lines += [f"  • {l['rule']}" for l in prof["learned"][-8:]]
    if prof["beliefs"]:
        lines.append("- Beliefs: " + "; ".join(f"{b['belief']} ({int(b['confidence'] * 100)}%)" for b in prof["beliefs"][:6]))
    lines += ["", "## The stranger before you (the player)",
              f"{p['name']}, {p['background_name']}" + (f", sworn to House {p['allegiance'].title()}" if p.get("allegiance") else "")
              + (f". {p['bio']}" if p.get("bio") else ""),
              f"Your relationship: {_fmt_rel(ctx['relationship'])}.",
              "Relationship criteria: devoted (trust≥60 & affection≥55), ally (trust≥35), friend (affection≥35), "
              "wary (trust≤-15 or fear≥40), enemy (trust≤-40 or affection≤-45). Let it shape how open, warm or guarded you are."]
    if ctx["others"]:
        lines += ["", "## Others present"]
        for o in ctx["others"]:
            lines.append(f"- {o['name']} (id {o['id']}): you feel {_fmt_rel(o['rel'])}")
    if ctx["memories"]:
        lines += ["", "## What you remember (most relevant first)"]
        lines += [f"- [{label(m['ord']) if m['ord'] else 'now'} · {m['kind']}{' · with the player' if m.get('player_id') else ''}] {m['content'][:400]}"
                  for m in ctx["memories"]]
    if ctx["news"]:
        lines += ["", "## News of the realm you know"]
        lines += [f"- {n['label']} {n['title']}: {n['text'][:220]}{' (you were there)' if n['witnessed'] else ''}" for n in ctx["news"]]
    if ctx["heard"] or ctx["tom"]:
        lines += ["", "## Rumours and theory of mind"]
        lines += [f"- Heard from {f['learned_from']}: {f['content']} (confidence {f['confidence']:.2f})" for f in ctx["heard"][:4]]
        lines += [f"- {t}" for t in ctx["tom"][:6]]
    if ctx["plots"]:
        lines += ["", "## Plots you are entangled in"]
        for pl in ctx["plots"]:
            stages = pl["stages"] or []
            stage = stages[pl["stage"]]["name"] if pl["stage"] < len(stages) else "resolution"
            lines.append(f"- {pl['title']}: {pl['premise']} (current stage: {stage}; tension {pl['tension']:.2f})")
    lines += ["", "## How to act",
              "- Stay completely in character: diction, rhythm, humour, cruelty or kindness exactly as this person would.",
              "- Use your memories and relationships naturally; refer to shared history. Do not recite them.",
              "- You have your own agenda. Pursue your goals, keep secrets you would keep, lie if you would lie.",
              "- React honestly to the dice outcome of the player's attempt (if any).",
              "- relationship_delta values are small integers in [-15, 15] reflecting how THIS exchange changed your view.",
              "- If you are a character who does not speak (e.g. the Night King), leave dialogue empty and act.",
              QUEST_HINT,
              "", "Respond with ONLY a JSON object of this shape:", RESPONSE_SCHEMA]
    return "\n".join(lines)


def _turn_prompt(ctx: dict[str, Any]) -> str:
    check = ctx["check"]
    parts = []
    if ctx["mode"] == "raven":
        parts.append("A raven has brought you a letter from the player. Reply as a letter.")
    if ctx["intent"] == "continue":
        parts.append("The conversation continues around you. Speak or act if you have something to add; respond to what others just said.")
    else:
        parts.append(f"The player ({ctx['player']['name']}) says/does: \"{ctx['user_text']}\"")
        if ctx["intent"] not in ("say", "continue"):
            parts.append(f"Intent: {ctx['intent']}.")
    if check:
        meaning = {
            "critical_success": "succeeds spectacularly — you are genuinely moved/convinced/fooled/cowed.",
            "success": "succeeds — it works on you, within reason for who you are.",
            "partial": "partly works — you are swayed a little but not fully; you may ask for more.",
            "failure": "fails — you are not convinced/fooled/cowed, and you notice the attempt.",
            "critical_failure": "fails badly — it backfires and offends, alarms or exposes them.",
        }[check["outcome"]]
        parts.append(f"Dice: {check['label']} rolled {check['roll']}+{check['modifier']}={check['total']} vs DC {check['dc']}: the attempt {meaning}")
    return "\n".join(parts)


def _history_messages(ctx: dict[str, Any]) -> list[dict[str, str]]:
    cid = ctx["character"]["id"]
    out = []
    for h in ctx["history"][-14:]:
        if h["role"] == "player":
            out.append({"role": "user", "content": f"[{ctx['player']['name']}] {h['content']}"})
        elif h["role"] == "character" and h.get("speaker_id") == cid:
            out.append({"role": "assistant", "content": h["content"]})
        else:
            who = h.get("speaker_name") or h.get("role")
            out.append({"role": "user", "content": f"[{who}] {h['content']}"})
    return out


async def character_turn(ctx: dict[str, Any]) -> dict[str, Any]:
    msgs = [{"role": "system", "content": _system_prompt(ctx)}] + _history_messages(ctx) + \
           [{"role": "user", "content": _turn_prompt(ctx)}]
    try:
        data, res = await router.chat_json(msgs, purpose=f"character:{ctx['character']['id']}")
        out = normalize_decision(data, ctx)
        out["meta"] = {"provider": res.provider, "model": res.model, "key": res.key_name, "latency_ms": res.latency_ms,
                       "attempts": res.attempts, "fallback": False}
        return out
    except (NoKeysConfigured, AllKeysFailed, LLMError, ValueError) as exc:
        with db.db() as conn:
            out = fallback_decision(conn, ctx)
        out["meta"] = {"fallback": True, "reason": str(exc)[:300]}
        return out


def _num(v: Any, lo: float, hi: float, default: float = 0.0) -> float:
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def normalize_decision(data: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    present = {o["id"] for o in ctx["others"]}
    delta = data.get("relationship_delta") or {}
    out: dict[str, Any] = {
        "dialogue": str(data.get("dialogue") or "").strip()[:2000],
        "action": str(data.get("action") or "").strip()[:500],
        "thought": str(data.get("thought") or "").strip()[:800],
        "appraisal": data.get("appraisal") if data.get("appraisal") in STIMULI else "neutral",
        "relationship_delta": {k: _num(delta.get(k), -15, 15) for k in ("trust", "affection", "respect", "fear")},
        "feelings_toward_others": [],
        "memory": None, "facts_learned": [], "patterns": [], "quest": None, "goal_update": None,
        "ends_conversation": bool(data.get("ends_conversation")),
    }
    for f in data.get("feelings_toward_others") or []:
        if isinstance(f, dict) and f.get("id") in present:
            d = f.get("delta") or {}
            out["feelings_toward_others"].append({"id": f["id"], "why": str(f.get("why") or "")[:200],
                                                  "delta": {k: _num(d.get(k), -12, 12) for k in ("trust", "affection", "respect", "fear")}})
    m = data.get("memory")
    if isinstance(m, dict) and str(m.get("content") or "").strip():
        out["memory"] = {"content": str(m["content"]).strip()[:600], "importance": _num(m.get("importance"), 0, 1, 0.5)}
    for f in (data.get("facts_learned") or [])[:4]:
        if isinstance(f, dict) and str(f.get("content") or "").strip():
            subj = [s for s in (f.get("subjects") or []) if isinstance(s, str)][:5]
            out["facts_learned"].append({"content": str(f["content"]).strip()[:400], "believed": _num(f.get("believed"), 0, 1, 0.6),
                                         "secrecy": _num(f.get("secrecy"), 0, 1, 0.3), "subjects": subj})
    out["patterns"] = [p for p in (data.get("patterns") or []) if p in PATTERNS][:3]
    q = data.get("quest")
    if isinstance(q, dict) and q.get("title") and q.get("description"):
        objs = []
        for o in (q.get("objectives") or [])[:4]:
            if isinstance(o, dict) and o.get("type") in ("talk_to", "travel_to", "persuade") and o.get("target"):
                objs.append({"type": o["type"], "target": str(o["target"]), "text": str(o.get("text") or "")[:200], "done": False})
        rw = q.get("reward") or {}
        out["quest"] = {"title": str(q["title"])[:120], "description": str(q["description"])[:600], "objectives": objs,
                        "reward": {"gold": int(_num(rw.get("gold"), 0, 500)), "renown": int(_num(rw.get("renown"), 0, 50))}}
    g = data.get("goal_update")
    if isinstance(g, dict) and str(g.get("goal") or "").strip():
        out["goal_update"] = {"goal": str(g["goal"]).strip()[:200], "priority": _num(g.get("priority"), 0, 1, 0.6)}
    if not out["dialogue"] and not out["action"]:
        out["action"] = f"{ctx['character']['name']} regards you in silence."
    return out


# ------------------------------------------------------------------ fallback (no LLM)
WORD_RE = re.compile(r"[a-zA-Z]{4,}")


def fallback_decision(conn: sqlite3.Connection, ctx: dict[str, Any]) -> dict[str, Any]:
    """Answer with the character's own canon words, chosen by relevance (FTS) up to the current episode."""
    c = ctx["character"]
    ord_ = ctx["ord"]
    words = [w.lower() for w in WORD_RE.findall(ctx["user_text"] or "")][:10]
    line = None
    if words:
        q = " OR ".join(f'"{w}"' for w in words)
        try:
            r = conn.execute(
                """SELECT s.sentence FROM script_fts JOIN script_lines s ON s.id=script_fts.rowid
                   WHERE script_fts MATCH ? AND s.character_id=? AND s.ord<=? ORDER BY bm25(script_fts) LIMIT 5""",
                (q, c["id"], ord_)).fetchall()
            if r:
                line = random.choice(r)["sentence"]
        except sqlite3.OperationalError:
            line = None
    if not line:
        sig = [s["text"] for s in (c.get("voice") or {}).get("signature_lines", []) if s["ord"] <= ord_]
        if sig:
            line = random.choice(sig)
        else:
            r = conn.execute("SELECT sentence FROM script_lines WHERE character_id=? AND ord<=? ORDER BY RANDOM() LIMIT 1",
                             (c["id"], ord_)).fetchone()
            line = r["sentence"] if r else ""
    check = ctx["check"]
    from .mechanics import outcome_factor

    f = outcome_factor(check)
    intent = ctx["intent"]
    delta = {"trust": 2 * f, "affection": 1 * f, "respect": 1 * f, "fear": 0.0}
    appraisal = "neutral"
    patterns: list[str] = []
    if intent == "intimidate":
        delta = {"trust": -3, "affection": -3, "respect": 2 * f, "fear": 6 * max(0, f)}
        appraisal = "threatened"
        patterns = ["threatened_by"]
    elif intent == "deceive" and check and check["outcome"] in ("failure", "critical_failure"):
        delta = {"trust": -8, "affection": -2, "respect": -2, "fear": 0}
        appraisal = "deceived_detected"
        patterns = ["deceived_by"]
    elif intent in ("charm", "persuade") and check and check["outcome"] in ("success", "critical_success"):
        appraisal = "flattered" if intent == "charm" else "persuaded"
        patterns = ["persuaded_by"] if intent == "persuade" else []
    elif intent == "help":
        delta = {"trust": 4, "affection": 3, "respect": 2, "fear": 0}
        appraisal = "helped"
        patterns = ["helped_by"]
    return {
        "dialogue": line, "action": "" if line else f"{c['name']} says nothing.",
        "thought": "", "appraisal": appraisal, "relationship_delta": delta, "feelings_toward_others": [],
        "memory": {"content": f"{ctx['player']['name']} spoke with me at {ctx['location'].get('name', 'this place')}: \"{(ctx['user_text'] or '')[:200]}\"",
                   "importance": 0.35},
        "facts_learned": [], "patterns": patterns, "quest": None, "goal_update": None, "ends_conversation": False,
    }


# ------------------------------------------------------------------ director helpers
def choose_responders(conn: sqlite3.Connection, present: list[dict[str, Any]], user_text: str, target_id: str | None,
                      last_speakers: list[str], max_n: int = 2, rng: random.Random | None = None) -> list[str]:
    """Who answers in a group scene: whoever is addressed, then whoever cares most."""
    rng = rng or random.Random()
    if not present:
        return []
    ids = [c["id"] for c in present]
    text = (user_text or "").lower()
    chosen: list[str] = []
    if target_id and target_id in ids:
        chosen.append(target_id)
    for c in present:
        first = c["name"].split()[0].lower()
        if c["id"] not in chosen and (c["name"].lower() in text or (len(first) > 3 and re.search(rf"\b{re.escape(first)}\b", text))):
            chosen.append(c["id"])
    if not chosen:
        scored = []
        for c in present:
            s = rng.random() * 0.5 + (0.3 if c["id"] not in last_speakers[-1:] else -0.4)
            s += {"major": 0.4, "supporting": 0.2}.get(c["tier"], 0)
            scored.append((s, c["id"]))
        scored.sort(reverse=True)
        chosen = [scored[0][1]]
        if len(present) >= 3 and rng.random() < 0.45:
            chosen.append(scored[1][1])
    return chosen[:max_n]


async def narrate(system: str, prompt: str, purpose: str, fallback: str) -> tuple[str, bool]:
    try:
        res = await router.chat([{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                                purpose=purpose, json_mode=False, max_tokens=350)
        return res.text.strip(), False
    except (NoKeysConfigured, AllKeysFailed, LLMError):
        return fallback, True


async def llm_json(system: str, prompt: str, purpose: str, max_tokens: int = 900) -> dict[str, Any] | None:
    try:
        data, _ = await router.chat_json([{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                                         purpose=purpose, max_tokens=max_tokens)
        return data
    except (NoKeysConfigured, AllKeysFailed, LLMError, ValueError):
        return None
