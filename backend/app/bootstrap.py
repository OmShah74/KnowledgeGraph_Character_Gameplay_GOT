"""First-run bootstrap: schema -> ontology -> script ingest -> knowledge graph -> initial snapshot."""
from __future__ import annotations

import logging
from typing import Any

from . import config, db, snapshots
from .graph import builder, ontology, store
from .graph.neo4j_store import neo4j_store
from .ingest import script_loader

log = logging.getLogger("got.bootstrap")


def status() -> dict[str, Any]:
    with db.db() as conn:
        return {
            "script_ingested": db.get_meta(conn, "script_ingested") == "1",
            "graph_built": db.get_meta(conn, "graph_built") == "1",
            "script_path": db.get_meta(conn, "script_path"),
            "characters": conn.execute("SELECT COUNT(*) FROM characters").fetchone()[0],
            "lines": conn.execute("SELECT COUNT(*) FROM script_lines").fetchone()[0],
            "episodes": conn.execute("SELECT COUNT(*) FROM episodes").fetchone()[0],
            "initial_snapshot": snapshots.initial_path().exists(),
            "last_reset_at": db.get_meta(conn, "last_reset_at"),
        }


def run(force: bool = False) -> dict[str, Any]:
    db.init_db()
    out: dict[str, Any] = {}
    with db.db() as conn:
        ontology.seed(conn)
        ingested = db.get_meta(conn, "script_ingested") == "1"
        built = db.get_meta(conn, "graph_built") == "1"
    if force or not ingested:
        if config.SCRIPT_PATH.exists():
            out["ingest"] = script_loader.ingest(config.SCRIPT_PATH)
            built = False
        else:
            log.warning("Script file not found at %s — upload one from the Data page", config.SCRIPT_PATH)
            out["ingest"] = {"error": f"script not found at {config.SCRIPT_PATH}"}
            return out
    with db.db() as conn:
        if force or not built:
            out["graph"] = builder.build(conn, sync_neo4j=True)
        elif neo4j_store.available and (neo4j_store.status().get("nodes") or 0) == 0:
            out["neo4j"] = store.sync_to_neo4j(conn)
    snap = snapshots.ensure_initial_snapshot()
    if snap:
        out["initial_snapshot"] = snap
    return out
