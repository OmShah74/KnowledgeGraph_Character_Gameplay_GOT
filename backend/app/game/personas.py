"""Persona documents.

Every character has a *permanent behaviour markdown*:
  * hand-authored files in app/canon/personas/<id>.md for central characters (identity, voice,
    values, fears, behavioural rules, arc notes and secrets gated by season), and
  * a generated profile for everyone, built from canon data, the script (voice, catchphrases,
    signature lines) and the behavioural priors.

Timeline gating: bullet lines beginning with "- S<n>:" or containing "(from S<n>)" are only
shown when the player's world has reached season n, so agents never leak the future.
"""
from __future__ import annotations

import re
import sqlite3
from functools import lru_cache
from typing import Any

from .. import config
from ..canon.timeline import EPISODES_PER_SEASON, from_ord, label

SEASON_LINE = re.compile(r"^\s*[-*]\s*\**S(\d)\b")
FROM_SEASON = re.compile(r"\(from S(\d)\)")


@lru_cache(maxsize=256)
def load_md(cid: str) -> str | None:
    p = config.PERSONA_DIR / f"{cid}.md"
    if p.exists():
        return p.read_text(encoding="utf-8")
    return None


def gate(md: str, ord_: int) -> str:
    """Hide anything the character cannot know yet at timeline point `ord_`.

    * "- S<n>: ..." arc summaries cover a whole season: shown for past seasons, and for the
      current season only once its finale has aired (episode-level detail for the current
      season comes from episode-gated canon-event memories instead).
    * "(from S<n>)" lines describe traits that emerge during season n: shown for past seasons
      and from mid-season (episode 6+) of season n.
    """
    season, episode = from_ord(ord_)
    finale = EPISODES_PER_SEASON[season]
    out = []
    for line in md.splitlines():
        m = SEASON_LINE.match(line)
        if m:
            n = int(m.group(1))
            if n > season or (n == season and episode < finale):
                continue
        m2 = FROM_SEASON.search(line)
        if m2:
            n = int(m2.group(1))
            if n > season or (n == season and episode < 6):
                continue
        out.append(line)
    return "\n".join(out)


def generated(conn: sqlite3.Connection, c: dict[str, Any], ord_: int | None = None) -> str:
    voice = c.get("voice") or {}
    pers = c.get("personality") or {}
    lines = [f"# {c['name']} — generated profile", ""]
    facts = []
    if c.get("house"):
        facts.append(f"House {c['house'].title()}")
    if c.get("titles"):
        facts.append(", ".join(c["titles"]))
    if c.get("culture"):
        facts.append(c["culture"])
    lines.append("**Identity:** " + (" · ".join(facts) or "unknown origins"))
    if c.get("summary"):
        lines += ["", c["summary"]]
    if c.get("traits"):
        lines += ["", "**Traits:** " + ", ".join(c["traits"])]
    if pers:
        top = sorted(pers.items(), key=lambda kv: -abs(kv[1] - 0.5))[:6]
        lines += ["", "**Temperament (prior):** " + ", ".join(f"{k} {'high' if v > 0.5 else 'low'} ({v:.2f})" for k, v in top)]
    drives = c.get("drives") or []
    if drives:
        lines += ["", "**Drives (prior):**"] + [f"- {d['goal']} (priority {d.get('priority', 0.5)})" for d in drives[:6]]
    if voice:
        lines += ["", f"**Voice:** ~{voice.get('avg_words', 0)} words per line, {voice.get('line_count', 0)} lines in the script."]
        if voice.get("catchphrases"):
            lines.append("**Recurring phrases:** " + ", ".join(f"“{p}”" for p in voice["catchphrases"][:8]))
        sig = [s for s in voice.get("signature_lines", []) if ord_ is None or s["ord"] <= ord_]
        if sig:
            lines += ["", "**Signature lines (from the script):**"] + [f"- [{s['label']}] “{s['text']}”" for s in sig[:10]]
        if voice.get("top_partners"):
            lines += ["", "**Most frequent conversation partners:** " + ", ".join(p["name"] for p in voice["top_partners"][:8])]
    if c.get("death_ord") and (ord_ is None or c["death_ord"] <= ord_):
        lines += ["", f"**Canon fate:** dies in {label(c['death_ord'])}. {c.get('death_note') or ''}"]
    return "\n".join(lines)


def full_persona(conn: sqlite3.Connection, c: dict[str, Any], ord_: int, max_chars: int = 7000) -> str:
    hand = load_md(c["id"])
    parts = []
    if hand:
        parts.append(gate(hand, ord_))
    gen = generated(conn, c, ord_)
    if hand:
        # Keep only the script-derived voice parts of the generated profile alongside hand-written persona
        keep = [l for l in gen.splitlines() if l.startswith(("**Voice", "**Recurring", "**Signature", "- [", "**Most"))]
        parts.append("\n".join(keep))
    else:
        parts.append(gen)
    text = "\n\n".join(p for p in parts if p.strip())
    return text[:max_chars]


def persona_document(conn: sqlite3.Connection, c: dict[str, Any], ord_: int | None = None) -> dict[str, Any]:
    hand = load_md(c["id"])
    return {"hand_written": gate(hand, ord_ or 73) if hand else None, "generated": generated(conn, c, ord_),
            "has_hand_written": hand is not None}


def list_hand_written() -> list[str]:
    if not config.PERSONA_DIR.exists():
        return []
    return sorted(p.stem for p in config.PERSONA_DIR.glob("*.md"))

