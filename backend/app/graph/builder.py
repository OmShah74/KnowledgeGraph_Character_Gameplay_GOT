"""Build the canon layer of the knowledge graph from canon data + ingested script."""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from typing import Any

import networkx as nx

from .. import db
from ..canon import relations as canon_rel
from ..canon import world
from ..canon.timeline import EPISODES_PER_SEASON, MAX_ORD, arc_segments, point, to_ord
from . import ontology, store


def _p(v: str | None) -> int | None:
    if v is None:
        return None
    if str(v).startswith("0"):
        return 0
    return point(v)


def build(conn: sqlite3.Connection, sync_neo4j: bool = True) -> dict[str, Any]:
    ontology.seed(conn)
    conn.execute("DELETE FROM kg_edges WHERE layer='canon'")
    conn.execute("DELETE FROM kg_nodes WHERE layer='canon'")
    parents = ontology.parent_map(conn)
    loc_of_storyline = {s["id"]: s["location"] for s in world.STORYLINES}

    def node(nid: str, label: str, name: str, **props: Any) -> None:
        store.upsert_node(conn, nid, label, name, props, mirror=False)

    edges_added = 0
    skipped: list[str] = []

    def edge(a: str, rel: str, b: str, frm: int | None = None, to: int | None = None, weight: float = 1.0, **props: Any) -> None:
        nonlocal edges_added
        try:
            store.add_edge(conn, a, rel, b, props=props, weight=weight, valid_from=frm, valid_to=to,
                           mirror=False, parents=parents)
            edges_added += 1
        except (store.GraphError, ontology.OntologyError) as exc:
            skipped.append(f"{a} -{rel}-> {b}: {exc}")

    # ---------------------------------------------------------- time
    for s, n in EPISODES_PER_SEASON.items():
        node(f"season_{s}", "Season", f"Season {s}", number=s)
    prev = None
    for r in conn.execute("SELECT * FROM episodes ORDER BY ord"):
        eid = f"ep_{r['ord']}"
        node(eid, "Episode", f"S{r['season']}E{r['episode']} · {r['title']}", season=r["season"], episode=r["episode"],
             ord=r["ord"], title=r["title"], release_date=r["release_date"], line_count=r["line_count"])
        edge(eid, "IN_SEASON", f"season_{r['season']}")
        if prev:
            edge(prev, "NEXT_EPISODE", eid)
        prev = eid

    # ---------------------------------------------------------- geography / groups / concepts
    for r in world.REGIONS:
        node(r["id"], "Region", r["name"], continent=r["continent"])
    for l in world.LOCATIONS:
        node(l["id"], "Location", l["name"], kind=l["kind"], x=l["x"], y=l["y"], description=l["description"])
        edge(l["id"], "LOCATED_IN", l["region"])
    for h in world.HOUSES:
        node(f"house_{h['id']}", "House", h["name"], words=h["words"], sigil=h["sigil"], color=h["color"], region=h["region"])
        if h["seat"]:
            edge(h["seat"], "SEAT_OF", f"house_{h['id']}")
    for o in world.ORGANIZATIONS:
        node(f"org_{o['id']}", "Organization", o["name"], kind=o["kind"], description=o["description"], color=o["color"])
        edge(f"org_{o['id']}", "HEADQUARTERED_AT", o["base"])
    for rl in world.RELIGIONS:
        node(f"religion_{rl['id']}", "Religion", rl["name"], description=rl["description"])
    for st in world.STORYLINES:
        node(f"story_{st['id']}", "Storyline", st["name"], color=st["color"])
        edge(f"story_{st['id']}", "STORYLINE_AT", st["location"])
    for t in world.TITLES:
        node(f"title_{t['id']}", "Title", t["name"])

    # ---------------------------------------------------------- characters
    chars = db.rows_to_dicts(conn.execute("SELECT * FROM characters").fetchall())
    char_ids = {c["id"] for c in chars}
    for c in chars:
        node(c["id"], "Character", c["name"], house=c["house"], tier=c["tier"], gender=c["gender"], death_ord=c["death_ord"],
             line_count=c["line_count"], canon=bool(c["canon"]), titles=c["titles"], summary=c["summary"] or "",
             first_ord=c["first_ord"], last_ord=c["last_ord"])
    from ..canon import characters as canon_chars

    for c in chars:
        cid = c["id"]
        end = c["death_ord"] if c["death_ord"] else MAX_ORD
        if c["house"]:
            edge(cid, "MEMBER_OF", f"house_{c['house']}", None, c["death_ord"] or None)
        if c["religion"]:
            edge(cid, "WORSHIPS", f"religion_{c['religion']}")
        if c["death_ord"] and c["death_ord"] > 0:
            edge(cid, "DIED_IN", f"ep_{c['death_ord']}", c["death_ord"], None, note=c["death_note"] or "")
            if c["killer_id"] and c["killer_id"] in char_ids:
                edge(c["killer_id"], "KILLED", cid, c["death_ord"], None, note=c["death_note"] or "")
        arcs = c["arcs"] or {}
        if c["death_ord"] == 0:
            continue
        segments = arc_segments(arcs, end)
        for frm, to, story in segments:
            edge(cid, "IN_STORYLINE", f"story_{story}", frm, to)
        # Location segments (merge consecutive storylines sharing a location)
        merged: list[list[Any]] = []
        for frm, to, story in segments:
            loc = loc_of_storyline.get(story)
            if not loc:
                continue
            if merged and merged[-1][2] == loc and merged[-1][1] + 1 >= frm:
                merged[-1][1] = to
            else:
                merged.append([frm, to, loc])
        for frm, to, loc in merged:
            edge(cid, "LOCATED_AT", loc, frm, to)
    for cc in canon_chars.CHARACTERS:
        for org, frm, to in cc["orgs"]:
            edge(cc["id"], "MEMBER_OF", f"org_{org}", _p(frm), _p(to))

    # ---------------------------------------------------------- canonical relations
    for a, rel, b, frm, to, props in canon_rel.RELATIONS:
        if a in char_ids and b in char_ids:
            edge(a, rel, b, _p(frm), _p(to), **props)

    # ---------------------------------------------------------- titles / artifacts / creatures
    for t in world.TITLES:
        for holder, frm, to in t["holders"]:
            if holder in char_ids:
                edge(holder, "HOLDS_TITLE", f"title_{t['id']}", _p(frm), _p(to))
    for a in world.ARTIFACTS:
        node(f"artifact_{a['id']}", "Artifact", a["name"], kind=a["kind"], description=a["description"])
        for owner, frm, to in a["owners"]:
            if owner in char_ids:
                edge(owner, "OWNS", f"artifact_{a['id']}", _p(frm), _p(to))
    for cr in world.CREATURES:
        node(f"creature_{cr['id']}", "Creature", cr["name"], kind=cr["kind"], death_ord=_p(cr["death"]))
        if cr["bonded"] in char_ids:
            edge(cr["bonded"], "BONDED_TO", f"creature_{cr['id']}", _p(cr["born"]), _p(cr["death"]))

    # ---------------------------------------------------------- canon events
    for e in db.rows_to_dicts(conn.execute("SELECT * FROM canon_events").fetchall()):
        node(e["id"], "Event", e["title"], kind=e["kind"], ord=e["ord"], description=e["description"],
             importance=e["importance"], public=bool(e["public"]))
        edge(e["id"], "OCCURRED_IN", f"ep_{e['ord']}", e["ord"], None)
        if e["location_id"]:
            edge(e["id"], "OCCURRED_AT", e["location_id"], e["ord"], None)
        for p in e["participants"]:
            if p in char_ids:
                edge(p, "PARTICIPATED_IN", e["id"], e["ord"], None)

    # ---------------------------------------------------------- scene graph (story order of the whole series)
    from ..ingest import scenes as scene_builder

    scene_builder.ensure(conn)
    prev_scene = None
    for sc in db.rows_to_dicts(conn.execute("SELECT * FROM canon_scenes ORDER BY ord, idx").fetchall()):
        node(sc["id"], "Scene", sc["title"], ord=sc["ord"], idx=sc["idx"], n_lines=sc["n_lines"], summary=sc["summary"],
             extras=sc["extras"])
        edge(sc["id"], "SCENE_IN", f"ep_{sc['ord']}", sc["ord"], None)
        if sc["location_id"]:
            edge(sc["id"], "SET_AT", sc["location_id"], sc["ord"], None)
        if sc["storyline"]:
            edge(sc["id"], "ADVANCES", f"story_{sc['storyline']}", sc["ord"], None)
        for p in sc["participants"]:
            if p in char_ids:
                edge(sc["id"], "FEATURES", p, sc["ord"], None)
        for ev in sc["events"]:
            edge(sc["id"], "DEPICTS", ev, sc["ord"], None)
        if prev_scene:
            edge(prev_scene, "NEXT_SCENE", sc["id"], sc["ord"], None)
        prev_scene = sc["id"]

    # ---------------------------------------------------------- script-derived structure
    for r in conn.execute("SELECT character_id, ord, lines FROM appearances"):
        edge(r["character_id"], "APPEARS_IN", f"ep_{r['ord']}", r["ord"], None, weight=float(r["lines"]))
    season_bounds = {s: (to_ord(s, 1), to_ord(s, n)) for s, n in EPISODES_PER_SEASON.items()}
    for r in conn.execute("SELECT a, b, season, weight FROM interactions WHERE weight >= 2"):
        frm, to = season_bounds[r["season"]]
        edge(r["a"], "INTERACTS_WITH", r["b"], frm, to, weight=float(r["weight"]), season=r["season"])

    communities = detect_communities(conn)
    for s, comms in communities.items():
        frm, to = season_bounds[s]
        for i, members in enumerate(comms):
            cid = f"community_s{s}_{i}"
            names = [m["name"] for m in members[:3]]
            node(cid, "Community", f"S{s} · {' / '.join(names)}", season=s, size=len(members))
            for m in members:
                edge(m["id"], "IN_COMMUNITY", cid, frm, to)

    from . import inference

    inferred = inference.run(conn)
    result = {"inferred": inferred, "nodes": conn.execute("SELECT COUNT(*) FROM kg_nodes").fetchone()[0],
              "edges": edges_added, "skipped": skipped[:50], "skipped_count": len(skipped)}
    if sync_neo4j:
        result["neo4j"] = store.sync_to_neo4j(conn)
    db.set_meta(conn, "graph_built", "1")
    return result


def detect_communities(conn: sqlite3.Connection, min_weight: int = 3) -> dict[int, list[list[dict[str, Any]]]]:
    """Louvain communities on the per-season conversation graph."""
    names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters")}
    lines = {r["id"]: r["line_count"] for r in conn.execute("SELECT id, line_count FROM characters")}
    graphs: dict[int, nx.Graph] = defaultdict(nx.Graph)
    for r in conn.execute("SELECT a, b, season, weight FROM interactions WHERE weight >= ?", (min_weight,)):
        graphs[r["season"]].add_edge(r["a"], r["b"], weight=r["weight"])
    out: dict[int, list[list[dict[str, Any]]]] = {}
    for s, g in sorted(graphs.items()):
        comms = nx.community.louvain_communities(g, weight="weight", seed=42, resolution=1.0)
        ranked = []
        for c in comms:
            if len(c) < 2:
                continue
            members = sorted(({"id": m, "name": names.get(m, m)} for m in c), key=lambda m: -(lines.get(m["id"]) or 0))
            ranked.append(members)
        ranked.sort(key=lambda ms: -len(ms))
        out[s] = ranked
    return out


def communities_json(conn: sqlite3.Connection) -> dict[str, Any]:
    out = {}
    for r in conn.execute("SELECT id, name, props FROM kg_nodes WHERE label='Community' ORDER BY id"):
        props = json.loads(r["props"])
        members = [m["source"] for m in conn.execute("SELECT source FROM kg_edges WHERE type='IN_COMMUNITY' AND target=?", (r["id"],))]
        out.setdefault(str(props.get("season")), []).append({"id": r["id"], "name": r["name"], "members": members})
    return out
