"""Long-term memory for character agents.

Memory kinds
  canon        recollections derived from the script (per character, per episode)
  canon_event  participation in a major canon event
  episodic     something that happened in play with a specific player
  semantic     a distilled fact/belief about a player or the world (from reflection)
  reflection   a higher-level summary of a whole conversation thread
  world        an off-screen event from the player's world simulation

Memories with player_id NULL are shared canon; memories with a player_id belong to that
player's world only, so every player builds their own history with each character.
Retrieval = FTS5 BM25 relevance + importance + recency, filtered by timeline (no future
knowledge) and by player.
"""
from __future__ import annotations

import math
import re
import sqlite3
from datetime import datetime, timezone
from typing import Any

from .. import db
from ..graph import store as kg

TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z']{2,}")
STOP = {
    "the", "and", "you", "your", "for", "are", "was", "with", "that", "this", "have", "has", "but", "not", "what", "who",
    "why", "how", "when", "where", "will", "would", "could", "should", "can", "about", "from", "they", "them", "their",
    "there", "here", "his", "her", "him", "she", "our", "out", "all", "any", "did", "does", "into", "just", "know", "like",
    "tell", "want", "been", "were", "its", "it's", "i'm", "you're", "me", "my", "lord", "lady", "ser",
}
VALID_KINDS = {"canon", "canon_event", "episodic", "semantic", "reflection", "world"}


def fts_query(text: str, max_terms: int = 14) -> str | None:
    terms: list[str] = []
    for tok in TOKEN_RE.findall(text or ""):
        t = tok.lower().strip("'")
        if t in STOP or len(t) < 3 or t in terms:
            continue
        terms.append(t)
        if len(terms) >= max_terms:
            break
    if not terms:
        return None
    return " OR ".join(f'"{t}"' for t in terms)


def add_memory(conn: sqlite3.Connection, *, character_id: str, content: str, kind: str = "episodic",
               player_id: str | None = None, importance: float = 0.5, emotion: str | None = None,
               about: list[str] | None = None, ord_: int = 0, thread_id: str | None = None,
               counterpart_id: str | None = None, mirror_threshold: float = 0.7) -> int:
    if kind not in VALID_KINDS:
        kind = "episodic"
    content = content.strip()[:2000]
    if not content:
        raise ValueError("Memory content cannot be empty")
    importance = float(max(0.0, min(1.0, importance)))
    cur = conn.execute(
        """INSERT INTO memories(character_id, player_id, kind, content, importance, emotion, about, counterpart_id, ord,
           thread_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        (character_id, player_id, kind, content, importance, emotion, db.dumps(about or []), counterpart_id, ord_,
         thread_id, db.now_iso()),
    )
    mid = int(cur.lastrowid)
    # Salient player memories also become Memory nodes in the player's layer of the KG.
    if player_id and importance >= mirror_threshold:
        _mirror(conn, mid, character_id, player_id, content, kind, importance, about or [])
    return mid


def _mirror(conn: sqlite3.Connection, mid: int, character_id: str, player_id: str, content: str, kind: str,
            importance: float, about: list[str]) -> None:
    node_id = f"mem_{mid}"
    try:
        kg.upsert_node(conn, node_id, "Memory", content[:80], {"content": content, "kind": kind, "importance": importance,
                                                                  "memory_id": mid}, layer="player", player_id=player_id)
        kg.add_edge(conn, character_id, "REMEMBERS", node_id, layer="player", player_id=player_id)
        for target in about[:5]:
            if conn.execute("SELECT 1 FROM kg_nodes WHERE id=?", (target,)).fetchone():
                kg.add_edge(conn, node_id, "ABOUT", target, layer="player", player_id=player_id)
    except (kg.GraphError, ValueError):
        pass


def _recency(created_at: str | None) -> float:
    if not created_at:
        return 0.0
    try:
        dt = datetime.fromisoformat(created_at)
    except ValueError:
        return 0.0
    hours = max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 3600)
    return math.exp(-hours / 72.0)  # ~3-day half-life-ish decay for play memories


def retrieve(conn: sqlite3.Connection, *, character_id: str, query: str, ord_: int, player_id: str | None = None,
             k: int = 8, include_canon: bool = True, touch: bool = True,
             counterparts: list[str] | None = None) -> list[dict[str, Any]]:
    """Return the k most relevant memories the character could have at `ord_`.

    `counterparts` (other characters present) boosts dyadic memories about them, so an agent
    recalls its shared history with whoever it is talking to."""
    scope = "(m.player_id IS NULL OR m.player_id = ?)" if player_id else "m.player_id IS NULL"
    params: list[Any] = [character_id, ord_]
    if player_id:
        params.append(player_id)
    kinds = "" if include_canon else "AND m.kind NOT IN ('canon','canon_event')"
    results: dict[int, dict[str, Any]] = {}

    q = fts_query(query)
    if q:
        sql = f"""SELECT m.*, bm25(memories_fts) AS rank FROM memories_fts
                  JOIN memories m ON m.id = memories_fts.rowid
                  WHERE memories_fts MATCH ? AND m.character_id=? AND m.ord <= ? AND {scope} {kinds}
                  ORDER BY rank LIMIT 60"""
        try:
            rows = conn.execute(sql, [q, *params]).fetchall()
        except sqlite3.OperationalError:
            rows = []
        for r in rows:
            d = db.row_to_dict(r)
            assert d is not None
            relevance = 1.0 / (1.0 + math.exp(r["rank"]))  # bm25 is negative; lower is better
            d["score"] = 1.4 * relevance + 0.8 * d["importance"] + (0.6 * _recency(d["created_at"]) if d["player_id"] else 0)
            results[d["id"]] = d

    # Always surface the freshest memories of this player, and the most important canon ones.
    if player_id:
        for r in conn.execute(
            f"""SELECT m.* FROM memories m WHERE m.character_id=? AND m.ord <= ? AND m.player_id = ?
                ORDER BY m.id DESC LIMIT 4""", (character_id, ord_, player_id)):
            d = db.row_to_dict(r)
            assert d is not None
            d["score"] = results.get(d["id"], {}).get("score", 0) + 0.9 + 0.5 * d["importance"]
            results[d["id"]] = d
    if include_canon:
        for r in conn.execute(
            """SELECT m.* FROM memories m WHERE m.character_id=? AND m.ord <= ? AND m.player_id IS NULL
               AND m.kind='canon_event' ORDER BY m.ord DESC, m.importance DESC LIMIT 3""", (character_id, ord_)):
            d = db.row_to_dict(r)
            assert d is not None
            d["score"] = results.get(d["id"], {}).get("score", 0) + 0.5 + 0.4 * d["importance"]
            results[d["id"]] = d

    if counterparts:
        ph = ",".join("?" * len(counterparts))
        for r in conn.execute(
            f"""SELECT m.* FROM memories m WHERE m.character_id=? AND m.ord <= ? AND {scope} AND m.counterpart_id IN ({ph})
                ORDER BY (m.player_id IS NOT NULL) DESC, m.ord DESC, m.importance DESC LIMIT ?""",
            [*params, *counterparts, 3 * len(counterparts)]):
            d = db.row_to_dict(r)
            assert d is not None
            d["score"] = results.get(d["id"], {}).get("score", 0) + 0.7 + 0.5 * d["importance"] + (0.4 if d["player_id"] else 0)
            results[d["id"]] = d

    ranked = sorted(results.values(), key=lambda d: d["score"], reverse=True)[:k]
    if touch and ranked:
        ids = [d["id"] for d in ranked]
        conn.execute(
            f"UPDATE memories SET access_count=access_count+1, last_accessed_at=? WHERE id IN ({','.join('?' * len(ids))})",
            [db.now_iso(), *ids],
        )
    for d in ranked:
        d["score"] = round(d["score"], 4)
    return ranked


def list_memories(conn: sqlite3.Connection, *, character_id: str | None = None, player_id: str | None = None,
                  kind: str | None = None, q: str | None = None, ord_max: int | None = None, scope: str = "all",
                  counterpart_id: str | None = None, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    where, params = ["1=1"], []
    if character_id:
        where.append("m.character_id=?")
        params.append(character_id)
    if counterpart_id:
        where.append("m.counterpart_id=?")
        params.append(counterpart_id)
    if scope == "canon":
        where.append("m.player_id IS NULL")
    elif scope == "player":
        if not player_id:
            return {"items": [], "total": 0}
        where.append("m.player_id=?")
        params.append(player_id)
    elif player_id:
        where.append("(m.player_id IS NULL OR m.player_id=?)")
        params.append(player_id)
    else:
        where.append("m.player_id IS NULL")
    if kind:
        where.append("m.kind=?")
        params.append(kind)
    if ord_max is not None:
        where.append("m.ord<=?")
        params.append(ord_max)
    base = "FROM memories m"
    fq = fts_query(q or "") if q else None
    if fq:
        base = "FROM memories_fts JOIN memories m ON m.id=memories_fts.rowid"
        where.insert(0, "memories_fts MATCH ?")
        params.insert(0, fq)
    w = " AND ".join(where)
    try:
        total = conn.execute(f"SELECT COUNT(*) {base} WHERE {w}", params).fetchone()[0]
        rows = conn.execute(f"SELECT m.* {base} WHERE {w} ORDER BY m.ord DESC, m.id DESC LIMIT ? OFFSET ?",
                            [*params, limit, offset]).fetchall()
    except sqlite3.OperationalError:
        return {"items": [], "total": 0}
    return {"items": db.rows_to_dicts(rows), "total": total}


def delete_memory(conn: sqlite3.Connection, memory_id: int) -> bool:
    cur = conn.execute("DELETE FROM memories WHERE id=?", (memory_id,))
    kg.delete_node(conn, f"mem_{memory_id}")
    return cur.rowcount > 0


def update_memory(conn: sqlite3.Connection, memory_id: int, content: str | None = None,
                  importance: float | None = None) -> dict[str, Any] | None:
    if content is not None:
        conn.execute("UPDATE memories SET content=? WHERE id=?", (content.strip()[:2000], memory_id))
    if importance is not None:
        conn.execute("UPDATE memories SET importance=? WHERE id=?", (max(0.0, min(1.0, importance)), memory_id))
    return db.row_to_dict(conn.execute("SELECT * FROM memories WHERE id=?", (memory_id,)).fetchone())


def delete_for(conn: sqlite3.Connection, *, player_id: str, character_id: str | None = None) -> int:
    if character_id:
        ids = [r["id"] for r in conn.execute("SELECT id FROM memories WHERE player_id=? AND character_id=?", (player_id, character_id))]
    else:
        ids = [r["id"] for r in conn.execute("SELECT id FROM memories WHERE player_id=?", (player_id,))]
    for mid in ids:
        delete_memory(conn, mid)
    return len(ids)


def stats(conn: sqlite3.Connection, player_id: str | None = None) -> dict[str, Any]:
    by_kind = {r["kind"]: r["n"] for r in conn.execute(
        "SELECT kind, COUNT(*) n FROM memories WHERE player_id IS NULL OR player_id=? GROUP BY kind", (player_id,))}
    top = db.rows_to_dicts(conn.execute(
        """SELECT m.character_id, c.name, COUNT(*) n FROM memories m LEFT JOIN characters c ON c.id=m.character_id
           WHERE m.player_id=? GROUP BY m.character_id ORDER BY n DESC LIMIT 15""", (player_id,)).fetchall()) if player_id else []
    return {"by_kind": by_kind, "total": sum(by_kind.values()), "top_characters": top}


def pair_memories(conn: sqlite3.Connection, a: str, b: str, ord_: int | None = None, player_id: str | None = None,
                  limit: int = 30) -> dict[str, list[dict[str, Any]]]:
    """What a remembers about b and what b remembers about a (canon + this player's world)."""
    out: dict[str, list[dict[str, Any]]] = {}
    for x, y in ((a, b), (b, a)):
        sql = "SELECT * FROM memories WHERE character_id=? AND counterpart_id=?"
        params: list[Any] = [x, y]
        if ord_ is not None:
            sql += " AND ord<=?"
            params.append(ord_)
        if player_id:
            sql += " AND (player_id IS NULL OR player_id=?)"
            params.append(player_id)
        else:
            sql += " AND player_id IS NULL"
        sql += " ORDER BY ord DESC, id DESC LIMIT ?"
        params.append(limit)
        out[x] = db.rows_to_dicts(conn.execute(sql, params).fetchall())
    return out
