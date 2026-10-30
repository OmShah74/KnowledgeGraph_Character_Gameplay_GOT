"""SQLite storage: schema, connections and small helpers.

SQLite is the system of record for everything (canon, script, game state, memory,
wiki, keys). Neo4j mirrors the knowledge graph for Cypher queries.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from . import config

SCHEMA = r"""
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- ---------------------------------------------------------------- LLM keys
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    key_cipher TEXT NOT NULL,
    key_hint TEXT NOT NULL,
    base_url TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    last_error TEXT,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    cooldown_until REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS llm_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id TEXT, key_name TEXT, provider TEXT, model TEXT, purpose TEXT,
    ok INTEGER, status_code INTEGER, latency_ms INTEGER, error TEXT,
    prompt_tokens INTEGER, completion_tokens INTEGER, created_at TEXT
);

-- ---------------------------------------------------------------- canon
CREATE TABLE IF NOT EXISTS episodes (
    ord INTEGER PRIMARY KEY,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    title TEXT NOT NULL,
    release_date TEXT,
    line_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(season, episode)
);
CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    house TEXT,
    gender TEXT,
    culture TEXT,
    religion TEXT,
    titles TEXT NOT NULL DEFAULT '[]',
    tier TEXT NOT NULL DEFAULT 'minor',
    summary TEXT,
    traits TEXT NOT NULL DEFAULT '[]',
    stats TEXT NOT NULL DEFAULT '{}',
    arcs TEXT NOT NULL DEFAULT '{}',
    death_ord INTEGER,
    death_note TEXT,
    killer_id TEXT,
    first_ord INTEGER,
    last_ord INTEGER,
    line_count INTEGER NOT NULL DEFAULT 0,
    voice TEXT NOT NULL DEFAULT '{}',
    personality TEXT NOT NULL DEFAULT '{}',
    drives TEXT NOT NULL DEFAULT '[]',
    canon INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS script_lines (
    id INTEGER PRIMARY KEY,
    ord INTEGER NOT NULL,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    line_no INTEGER NOT NULL,
    speaker_raw TEXT NOT NULL,
    character_id TEXT,
    sentence TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lines_char ON script_lines(character_id, ord);
CREATE INDEX IF NOT EXISTS ix_lines_ord ON script_lines(ord, line_no);
CREATE VIRTUAL TABLE IF NOT EXISTS script_fts USING fts5(
    sentence, content='script_lines', content_rowid='id', tokenize='porter unicode61'
);
CREATE TABLE IF NOT EXISTS interactions (
    a TEXT NOT NULL, b TEXT NOT NULL, season INTEGER NOT NULL, weight INTEGER NOT NULL,
    PRIMARY KEY (a, b, season)
);
CREATE TABLE IF NOT EXISTS appearances (
    character_id TEXT NOT NULL, ord INTEGER NOT NULL, lines INTEGER NOT NULL,
    PRIMARY KEY (character_id, ord)
);
CREATE TABLE IF NOT EXISTS canon_events (
    id TEXT PRIMARY KEY,
    ord INTEGER NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    location_id TEXT,
    participants TEXT NOT NULL DEFAULT '[]',
    importance REAL NOT NULL DEFAULT 0.7,
    public INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_canon_events_ord ON canon_events(ord);

-- ---------------------------------------------------------------- ontology + graph
CREATE TABLE IF NOT EXISTS ontology_classes (
    name TEXT PRIMARY KEY,
    parent TEXT,
    description TEXT NOT NULL DEFAULT '',
    properties TEXT NOT NULL DEFAULT '{}',
    color TEXT NOT NULL DEFAULT '#94a3b8',
    builtin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ontology_relations (
    name TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    range TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    symmetric INTEGER NOT NULL DEFAULT 0,
    temporal INTEGER NOT NULL DEFAULT 0,
    inverse TEXT,
    builtin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kg_nodes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    name TEXT NOT NULL,
    props TEXT NOT NULL DEFAULT '{}',
    layer TEXT NOT NULL DEFAULT 'canon',
    player_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_nodes_label ON kg_nodes(label);
CREATE INDEX IF NOT EXISTS ix_nodes_player ON kg_nodes(player_id);
CREATE TABLE IF NOT EXISTS kg_edges (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    target TEXT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    props TEXT NOT NULL DEFAULT '{}',
    weight REAL NOT NULL DEFAULT 1,
    valid_from INTEGER,
    valid_to INTEGER,
    layer TEXT NOT NULL DEFAULT 'canon',
    player_id TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_edges_source ON kg_edges(source);
CREATE INDEX IF NOT EXISTS ix_edges_target ON kg_edges(target);
CREATE INDEX IF NOT EXISTS ix_edges_type ON kg_edges(type);
CREATE INDEX IF NOT EXISTS ix_edges_player ON kg_edges(player_id);

-- ---------------------------------------------------------------- players / game
CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    background TEXT NOT NULL,
    allegiance TEXT,
    bio TEXT NOT NULL DEFAULT '',
    ord INTEGER NOT NULL,
    location_id TEXT NOT NULL,
    day INTEGER NOT NULL DEFAULT 1,
    gold INTEGER NOT NULL DEFAULT 50,
    health INTEGER NOT NULL DEFAULT 20,
    max_health INTEGER NOT NULL DEFAULT 20,
    renown INTEGER NOT NULL DEFAULT 0,
    skills TEXT NOT NULL DEFAULT '{}',
    reputation TEXT NOT NULL DEFAULT '{}',
    inventory TEXT NOT NULL DEFAULT '[]',
    flags TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'chat',
    title TEXT NOT NULL,
    character_ids TEXT NOT NULL DEFAULT '[]',
    location_id TEXT,
    ord INTEGER NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    message_count INTEGER NOT NULL DEFAULT 0,
    reflected_upto INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_threads_player ON threads(player_id, updated_at);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    speaker_id TEXT,
    content TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_messages_thread ON messages(thread_id, id);

CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id TEXT NOT NULL,
    player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    importance REAL NOT NULL DEFAULT 0.5,
    emotion TEXT,
    about TEXT NOT NULL DEFAULT '[]',
    counterpart_id TEXT,
    ord INTEGER NOT NULL DEFAULT 0,
    thread_id TEXT,
    created_at TEXT NOT NULL,
    last_accessed_at TEXT,
    access_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_mem_owner ON memories(character_id, player_id, ord);
CREATE INDEX IF NOT EXISTS ix_mem_pair ON memories(character_id, counterpart_id, ord);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content, content='memories', content_rowid='id', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF content ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
    INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TABLE IF NOT EXISTS player_relationships (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL,
    trust REAL NOT NULL DEFAULT 0,
    affection REAL NOT NULL DEFAULT 0,
    respect REAL NOT NULL DEFAULT 0,
    fear REAL NOT NULL DEFAULT 0,
    familiarity REAL NOT NULL DEFAULT 0,
    stance TEXT NOT NULL DEFAULT 'stranger',
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (player_id, character_id)
);
CREATE TABLE IF NOT EXISTS char_relationships (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    a TEXT NOT NULL,
    b TEXT NOT NULL,
    trust REAL NOT NULL DEFAULT 0,
    affection REAL NOT NULL DEFAULT 0,
    respect REAL NOT NULL DEFAULT 0,
    fear REAL NOT NULL DEFAULT 0,
    familiarity REAL NOT NULL DEFAULT 0,
    stance TEXT NOT NULL DEFAULT 'neutral',
    interactions INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (player_id, a, b)
);
CREATE TABLE IF NOT EXISTS relationship_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    object TEXT NOT NULL,
    delta TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    ord INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quests (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    giver_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    objectives TEXT NOT NULL DEFAULT '[]',
    reward TEXT NOT NULL DEFAULT '{}',
    ord INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    participants TEXT NOT NULL DEFAULT '[]',
    location_id TEXT,
    ord INTEGER NOT NULL,
    canon INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_player ON events(player_id, id);

-- ---------------------------------------------------------------- per-world divergence
-- Canon is only the prior. Each player's world keeps its own state for every character
-- (alive, whereabouts, mood, drives, beliefs) which evolves through play and simulation.
CREATE TABLE IF NOT EXISTS character_states (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL,
    alive INTEGER,
    death_note TEXT,
    location_id TEXT,
    mood TEXT NOT NULL DEFAULT 'neutral',
    stress REAL NOT NULL DEFAULT 0,
    affect TEXT NOT NULL DEFAULT '{}',
    goals TEXT NOT NULL DEFAULT '[]',
    beliefs TEXT NOT NULL DEFAULT '[]',
    allegiance TEXT,
    personality_drift TEXT NOT NULL DEFAULT '{}',
    learned TEXT NOT NULL DEFAULT '[]',
    counters TEXT NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    updated_ord INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (player_id, character_id)
);
CREATE TABLE IF NOT EXISTS faction_states (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    faction_id TEXT NOT NULL,
    power REAL NOT NULL DEFAULT 50,
    wealth REAL NOT NULL DEFAULT 50,
    influence REAL NOT NULL DEFAULT 50,
    stability REAL NOT NULL DEFAULT 50,
    leader_id TEXT,
    stances TEXT NOT NULL DEFAULT '{}',
    updated_ord INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (player_id, faction_id)
);
CREATE TABLE IF NOT EXISTS plot_threads (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    premise TEXT NOT NULL,
    stakes TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL DEFAULT 'emergent',
    characters TEXT NOT NULL DEFAULT '[]',
    factions TEXT NOT NULL DEFAULT '[]',
    stages TEXT NOT NULL DEFAULT '[]',
    stage INTEGER NOT NULL DEFAULT 0,
    tension REAL NOT NULL DEFAULT 0.3,
    status TEXT NOT NULL DEFAULT 'active',
    player_involved INTEGER NOT NULL DEFAULT 0,
    log TEXT NOT NULL DEFAULT '[]',
    ord_started INTEGER NOT NULL,
    updated_ord INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_plots_player ON plot_threads(player_id, status);
CREATE TABLE IF NOT EXISTS canon_outcomes (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    narration TEXT NOT NULL DEFAULT '',
    ord INTEGER NOT NULL,
    PRIMARY KEY (player_id, event_id)
);

-- ---------------------------------------------------------------- knowledge, rumours, thread links, jobs
-- Facts are propositions that exist in a player's world (secrets, rumours, revelations).
-- fact_knowledge records which character knows which fact, how sure they are and from whom
-- they heard it: a theory-of-mind substrate for information spreading between threads.
CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    subject_ids TEXT NOT NULL DEFAULT '[]',
    secrecy REAL NOT NULL DEFAULT 0.3,
    truth REAL NOT NULL DEFAULT 1.0,
    source_thread_id TEXT,
    origin_character_id TEXT,
    ord INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_facts_player ON facts(player_id);
CREATE TABLE IF NOT EXISTS fact_knowledge (
    fact_id INTEGER NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.8,
    learned_from TEXT,
    channel TEXT NOT NULL DEFAULT 'witnessed',
    ord INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (fact_id, character_id)
);
CREATE INDEX IF NOT EXISTS ix_fk_char ON fact_knowledge(player_id, character_id);
CREATE TABLE IF NOT EXISTS thread_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    from_thread TEXT NOT NULL,
    to_kind TEXT NOT NULL,
    to_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (from_thread, to_kind, to_id, relation)
);
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    player_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    result TEXT,
    run_after REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    finished_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_jobs_status ON jobs(status, run_after);

-- ---------------------------------------------------------------- wiki
CREATE TABLE IF NOT EXISTS wiki_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'canon',
    title TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    content TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    generated_by TEXT NOT NULL DEFAULT 'template',
    category TEXT NOT NULL DEFAULT 'entity',
    updated_at TEXT NOT NULL,
    UNIQUE (slug, scope)
);
CREATE TABLE IF NOT EXISTS wiki_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    action TEXT NOT NULL,
    slug TEXT,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wiki_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    author TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""

_init_lock = threading.Lock()
_initialized = False


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:12]}"


def connect() -> sqlite3.Connection:
    config.ensure_dirs()
    conn = sqlite3.connect(str(config.DB_PATH), timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def init_db() -> None:
    global _initialized
    with _init_lock:
        conn = connect()
        try:
            conn.executescript(SCHEMA)
            conn.commit()
        finally:
            conn.close()
        _initialized = True


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    if not _initialized:
        init_db()
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


JSON_FIELDS = {
    "aliases", "titles", "traits", "stats", "arcs", "voice", "props", "skills",
    "reputation", "inventory", "flags", "character_ids", "meta", "about",
    "participants", "objectives", "reward", "delta", "properties", "goals", "beliefs", "stances",
    "characters", "factions", "stages", "log", "personality", "drives", "personality_drift", "learned", "counters",
    "affect", "subject_ids", "result",
}


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    out: dict[str, Any] = {}
    for k in row.keys():
        v = row[k]
        if k in JSON_FIELDS and isinstance(v, str):
            try:
                v = json.loads(v)
            except json.JSONDecodeError:
                pass
        out[k] = v
    return out


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [row_to_dict(r) for r in rows]  # type: ignore[misc]


def dumps(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False)


def get_meta(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    r = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def get_setting(conn: sqlite3.Connection, key: str, default: Any = None) -> Any:
    r = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    if not r:
        return default
    try:
        return json.loads(r["value"])
    except json.JSONDecodeError:
        return r["value"]


def set_setting(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, json.dumps(value)),
    )
