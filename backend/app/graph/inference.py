"""Rule-based inference over the canon knowledge graph.

Rules (each derived edge carries props.inferred=True, the rule name and the supporting path):
  R1 GRANDPARENT_OF   PARENT_OF(x,p) ∧ PARENT_OF(p,c)
  R2 UNCLE_OR_AUNT_OF SIBLING_OF(x,p) ∧ PARENT_OF(p,c)          (not for "raised as" siblings)
  R3 COUSIN_OF        PARENT_OF(p1,a) ∧ PARENT_OF(p2,b) ∧ SIBLING_OF(p1,p2)
  R4 BLOOD_FEUD_WITH  KILLED(k,v) ∧ kin(r,v)  → r feuds with k from the killing onward
  R5 SAME_HOUSE_AS    MEMBER_OF(a,h) ∧ MEMBER_OF(b,h), for major/supporting characters
Secrecy and validity propagate: a derived edge is secret if any premise is, and becomes valid
from the latest valid_from among its premises (so inferred truths respect the timeline).
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from typing import Any

from . import ontology, store


def _edges(conn: sqlite3.Connection, type_: str) -> list[dict[str, Any]]:
    out = []
    for r in conn.execute("SELECT source, target, valid_from, valid_to, props FROM kg_edges WHERE layer='canon' AND type=? "
                          "AND props NOT LIKE '%\"inferred\": true%'", (type_,)):
        out.append({"s": r["source"], "t": r["target"], "from": r["valid_from"], "to": r["valid_to"], "props": json.loads(r["props"])})
    return out


def _vmax(*vals: int | None) -> int | None:
    xs = [v for v in vals if v is not None]
    return max(xs) if xs else None


def run(conn: sqlite3.Connection) -> dict[str, int]:
    conn.execute("DELETE FROM kg_edges WHERE layer='canon' AND props LIKE '%\"inferred\": true%'")
    parents = ontology.parent_map(conn)
    counts: dict[str, int] = defaultdict(int)

    def add(a: str, rel: str, b: str, frm: int | None, rule: str, via: list[str], secret: bool, to: int | None = None) -> None:
        if a == b:
            return
        props = {"inferred": True, "rule": rule, "via": via}
        if secret:
            props["secret"] = True
        try:
            store.add_edge(conn, a, rel, b, props=props, valid_from=frm, valid_to=to, mirror=False, parents=parents)
            counts[rel] += 1
        except (store.GraphError, ontology.OntologyError):
            pass

    parent = _edges(conn, "PARENT_OF")
    sibling = [e for e in _edges(conn, "SIBLING_OF") if not e["props"].get("raised_as")]
    children: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in parent:
        if e["props"].get("putative"):
            continue
        children[e["s"]].append(e)
    sib_of: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in sibling:
        sib_of[e["s"]].append({"other": e["t"], **e})
        sib_of[e["t"]].append({"other": e["s"], **e})

    # R1 grandparents
    for x, kids in list(children.items()):
        for k in kids:
            for g in children.get(k["t"], []):
                add(x, "GRANDPARENT_OF", g["t"], _vmax(k["from"], g["from"]), "R1", [x, k["t"], g["t"]],
                    bool(k["props"].get("secret") or g["props"].get("secret")))
    # R2 uncles / aunts
    for p, kids in list(children.items()):
        for s in sib_of.get(p, []):
            for k in kids:
                add(s["other"], "UNCLE_OR_AUNT_OF", k["t"], _vmax(s["from"], k["from"]), "R2", [s["other"], p, k["t"]],
                    bool(k["props"].get("secret")))
    # R3 cousins
    seen: set[tuple[str, str]] = set()
    for p1, sibs in sib_of.items():
        for s in sibs:
            p2 = s["other"]
            for a in children.get(p1, []):
                for b in children.get(p2, []):
                    key = tuple(sorted((a["t"], b["t"])))
                    if key in seen or a["t"] == b["t"]:
                        continue
                    seen.add(key)  # type: ignore[arg-type]
                    add(key[0], "COUSIN_OF", key[1], _vmax(a["from"], b["from"]), "R3", [a["t"], p1, p2, b["t"]],
                        bool(a["props"].get("secret") or b["props"].get("secret")))
    # R4 blood feuds
    kin: dict[str, set[str]] = defaultdict(set)
    for e in parent:
        kin[e["s"]].add(e["t"])
        kin[e["t"]].add(e["s"])
    for e in sibling + _edges(conn, "SPOUSE_OF") + _edges(conn, "LOVER_OF"):
        kin[e["s"]].add(e["t"])
        kin[e["t"]].add(e["s"])
    for k in _edges(conn, "KILLED"):
        for r in kin.get(k["t"], set()):
            if r == k["s"] or r in kin.get(k["s"], set()):
                continue  # kin-slaying inside a family is not modelled as a feud
            add(r, "BLOOD_FEUD_WITH", k["s"], k["from"], "R4", [r, k["t"], k["s"]], False)
    # R5 same house (central characters only)
    members: dict[str, list[str]] = defaultdict(list)
    for r in conn.execute("""SELECT e.source, e.target FROM kg_edges e JOIN kg_nodes n ON n.id=e.source
                             WHERE e.type='MEMBER_OF' AND e.target LIKE 'house_%' AND e.layer='canon'
                             AND json_extract(n.props, '$.tier') IN ('major','supporting')"""):
        members[r["target"]].append(r["source"])
    for h, ms in members.items():
        ms = sorted(set(ms))
        for i, a in enumerate(ms):
            for b in ms[i + 1:]:
                add(a, "SAME_HOUSE_AS", b, None, "R5", [a, h, b], False)
    return dict(counts)
