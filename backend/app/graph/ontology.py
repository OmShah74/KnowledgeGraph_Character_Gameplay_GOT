"""Ontology service: seeding, inheritance checks, CRUD and validation."""
from __future__ import annotations

import re
import sqlite3
from typing import Any

from .. import db
from ..canon import ontology as builtin

IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
REL_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


class OntologyError(ValueError):
    pass


def seed(conn: sqlite3.Connection) -> None:
    for name, parent, desc, color, props in builtin.CLASSES:
        conn.execute(
            """INSERT INTO ontology_classes(name,parent,description,properties,color,builtin) VALUES(?,?,?,?,?,1)
               ON CONFLICT(name) DO NOTHING""",
            (name, parent, desc, db.dumps(props), color),
        )
    for name, dom, rng, sym, temporal, inverse, desc in builtin.RELATIONS:
        conn.execute(
            """INSERT INTO ontology_relations(name,domain,range,description,symmetric,temporal,inverse,builtin)
               VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(name) DO NOTHING""",
            (name, dom, rng, desc, int(sym), int(temporal), inverse),
        )


def classes(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = db.rows_to_dicts(conn.execute("SELECT * FROM ontology_classes ORDER BY name").fetchall())
    counts = {r["label"]: r["n"] for r in conn.execute("SELECT label, COUNT(*) n FROM kg_nodes GROUP BY label").fetchall()}
    for r in rows:
        r["instance_count"] = counts.get(r["name"], 0)
    return rows


def relations(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = db.rows_to_dicts(conn.execute("SELECT * FROM ontology_relations ORDER BY name").fetchall())
    counts = {r["type"]: r["n"] for r in conn.execute("SELECT type, COUNT(*) n FROM kg_edges GROUP BY type").fetchall()}
    for r in rows:
        r["symmetric"] = bool(r["symmetric"])
        r["temporal"] = bool(r["temporal"])
        r["builtin"] = bool(r["builtin"])
        r["edge_count"] = counts.get(r["name"], 0)
    return rows


def parent_map(conn: sqlite3.Connection) -> dict[str, str | None]:
    return {r["name"]: r["parent"] for r in conn.execute("SELECT name, parent FROM ontology_classes").fetchall()}


def ancestors(cls: str, parents: dict[str, str | None]) -> list[str]:
    """[cls, parent, grandparent, ..., Entity]"""
    out, seen = [], set()
    cur: str | None = cls
    while cur and cur not in seen:
        out.append(cur)
        seen.add(cur)
        cur = parents.get(cur)
    return out


def is_a(cls: str, target: str, parents: dict[str, str | None]) -> bool:
    return target in ancestors(cls, parents)


def check_edge(conn: sqlite3.Connection, rel: str, source_label: str, target_label: str,
               parents: dict[str, str | None] | None = None) -> None:
    r = conn.execute("SELECT domain, range FROM ontology_relations WHERE name=?", (rel,)).fetchone()
    if not r:
        raise OntologyError(f"Unknown relation type '{rel}'")
    parents = parents or parent_map(conn)
    if not is_a(source_label, r["domain"], parents):
        raise OntologyError(f"{rel} requires a source of class {r['domain']}, got {source_label}")
    if not is_a(target_label, r["range"], parents):
        raise OntologyError(f"{rel} requires a target of class {r['range']}, got {target_label}")


# ------------------------------------------------------------------ CRUD
def create_class(conn: sqlite3.Connection, name: str, parent: str, description: str = "",
                 properties: dict[str, Any] | None = None, color: str = "#94a3b8") -> dict[str, Any]:
    if not IDENT_RE.match(name):
        raise OntologyError("Class names must be identifiers (letters, digits, underscore)")
    if conn.execute("SELECT 1 FROM ontology_classes WHERE name=?", (name,)).fetchone():
        raise OntologyError(f"Class '{name}' already exists")
    if not conn.execute("SELECT 1 FROM ontology_classes WHERE name=?", (parent,)).fetchone():
        raise OntologyError(f"Parent class '{parent}' does not exist")
    conn.execute(
        "INSERT INTO ontology_classes(name,parent,description,properties,color,builtin) VALUES(?,?,?,?,?,0)",
        (name, parent, description, db.dumps(properties or {}), color),
    )
    return db.row_to_dict(conn.execute("SELECT * FROM ontology_classes WHERE name=?", (name,)).fetchone())  # type: ignore[return-value]


def update_class(conn: sqlite3.Connection, name: str, **fields: Any) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM ontology_classes WHERE name=?", (name,)).fetchone()
    if not row:
        raise OntologyError(f"Class '{name}' not found")
    if "parent" in fields and fields["parent"] is not None:
        parent = fields["parent"]
        if name == "Entity":
            raise OntologyError("The root class cannot be re-parented")
        if not conn.execute("SELECT 1 FROM ontology_classes WHERE name=?", (parent,)).fetchone():
            raise OntologyError(f"Parent class '{parent}' does not exist")
        if name in ancestors(parent, parent_map(conn)):
            raise OntologyError("Re-parenting would create a cycle")
    sets, vals = [], []
    for k in ("parent", "description", "color"):
        if fields.get(k) is not None:
            sets.append(f"{k}=?")
            vals.append(fields[k])
    if fields.get("properties") is not None:
        sets.append("properties=?")
        vals.append(db.dumps(fields["properties"]))
    if sets:
        conn.execute(f"UPDATE ontology_classes SET {', '.join(sets)} WHERE name=?", (*vals, name))
    return db.row_to_dict(conn.execute("SELECT * FROM ontology_classes WHERE name=?", (name,)).fetchone())  # type: ignore[return-value]


def delete_class(conn: sqlite3.Connection, name: str) -> None:
    row = conn.execute("SELECT builtin FROM ontology_classes WHERE name=?", (name,)).fetchone()
    if not row:
        raise OntologyError(f"Class '{name}' not found")
    if row["builtin"]:
        raise OntologyError("Built-in classes cannot be deleted")
    if conn.execute("SELECT 1 FROM ontology_classes WHERE parent=?", (name,)).fetchone():
        raise OntologyError("Class has subclasses; delete or re-parent them first")
    if conn.execute("SELECT 1 FROM kg_nodes WHERE label=?", (name,)).fetchone():
        raise OntologyError("Class has instances in the knowledge graph; delete them first")
    if conn.execute("SELECT 1 FROM ontology_relations WHERE domain=? OR range=?", (name, name)).fetchone():
        raise OntologyError("Class is used as a relation domain/range")
    conn.execute("DELETE FROM ontology_classes WHERE name=?", (name,))


def create_relation(conn: sqlite3.Connection, name: str, domain: str, range_: str, description: str = "",
                    symmetric: bool = False, temporal: bool = False, inverse: str | None = None) -> dict[str, Any]:
    name = name.upper()
    if not REL_RE.match(name):
        raise OntologyError("Relation names must be UPPER_SNAKE_CASE")
    if conn.execute("SELECT 1 FROM ontology_relations WHERE name=?", (name,)).fetchone():
        raise OntologyError(f"Relation '{name}' already exists")
    for c in (domain, range_):
        if not conn.execute("SELECT 1 FROM ontology_classes WHERE name=?", (c,)).fetchone():
            raise OntologyError(f"Class '{c}' does not exist")
    conn.execute(
        """INSERT INTO ontology_relations(name,domain,range,description,symmetric,temporal,inverse,builtin)
           VALUES(?,?,?,?,?,?,?,0)""",
        (name, domain, range_, description, int(symmetric), int(temporal), inverse),
    )
    return next(r for r in relations(conn) if r["name"] == name)


def update_relation(conn: sqlite3.Connection, name: str, **fields: Any) -> dict[str, Any]:
    if not conn.execute("SELECT 1 FROM ontology_relations WHERE name=?", (name,)).fetchone():
        raise OntologyError(f"Relation '{name}' not found")
    for c in (fields.get("domain"), fields.get("range")):
        if c and not conn.execute("SELECT 1 FROM ontology_classes WHERE name=?", (c,)).fetchone():
            raise OntologyError(f"Class '{c}' does not exist")
    sets, vals = [], []
    for k in ("domain", "range", "description", "inverse"):
        if fields.get(k) is not None:
            sets.append(f"{k}=?")
            vals.append(fields[k])
    for k in ("symmetric", "temporal"):
        if fields.get(k) is not None:
            sets.append(f"{k}=?")
            vals.append(int(bool(fields[k])))
    if sets:
        conn.execute(f"UPDATE ontology_relations SET {', '.join(sets)} WHERE name=?", (*vals, name))
    return next(r for r in relations(conn) if r["name"] == name)


def delete_relation(conn: sqlite3.Connection, name: str) -> None:
    row = conn.execute("SELECT builtin FROM ontology_relations WHERE name=?", (name,)).fetchone()
    if not row:
        raise OntologyError(f"Relation '{name}' not found")
    if row["builtin"]:
        raise OntologyError("Built-in relations cannot be deleted")
    if conn.execute("SELECT 1 FROM kg_edges WHERE type=?", (name,)).fetchone():
        raise OntologyError("Relation has edges in the graph; delete them first")
    conn.execute("DELETE FROM ontology_relations WHERE name=?", (name,))


def validate_graph(conn: sqlite3.Connection, limit: int = 200) -> dict[str, Any]:
    """Report edges/nodes that violate the current ontology (e.g. after an edit)."""
    parents = parent_map(conn)
    rels = {r["name"]: r for r in conn.execute("SELECT name, domain, range FROM ontology_relations").fetchall()}
    issues: list[dict[str, Any]] = []
    unknown_labels = conn.execute(
        "SELECT id, label FROM kg_nodes WHERE label NOT IN (SELECT name FROM ontology_classes) LIMIT ?", (limit,)
    ).fetchall()
    for r in unknown_labels:
        issues.append({"kind": "unknown_class", "node": r["id"], "label": r["label"]})
    q = """SELECT e.id, e.type, e.source, e.target, s.label sl, t.label tl FROM kg_edges e
           JOIN kg_nodes s ON s.id=e.source JOIN kg_nodes t ON t.id=e.target"""
    checked = 0
    for e in conn.execute(q):
        checked += 1
        rel = rels.get(e["type"])
        if not rel:
            issues.append({"kind": "unknown_relation", "edge": e["id"], "type": e["type"]})
        elif not is_a(e["sl"], rel["domain"], parents) or not is_a(e["tl"], rel["range"], parents):
            issues.append({"kind": "domain_range", "edge": e["id"], "type": e["type"], "source": e["source"],
                           "source_class": e["sl"], "target": e["target"], "target_class": e["tl"],
                           "expected": f"{rel['domain']} -> {rel['range']}"})
        if len(issues) >= limit:
            break
    return {"edges_checked": checked, "issues": issues, "valid": not issues}
