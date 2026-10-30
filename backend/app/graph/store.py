"""Knowledge-graph service over SQLite, mirrored into Neo4j."""
from __future__ import annotations

import hashlib
import sqlite3
from collections import deque
from typing import Any, Iterable

import networkx as nx

from .. import db
from . import ontology
from .neo4j_store import neo4j_store

# Relations that are numerous and hidden from the default overview.
HEAVY_RELATIONS = {"APPEARS_IN", "INTERACTS_WITH", "IN_SEASON", "NEXT_EPISODE", "OCCURRED_IN", "IN_COMMUNITY", "REMEMBERS", "ABOUT"}


class GraphError(ValueError):
    pass


def edge_id(type_: str, source: str, target: str, valid_from: int | None, layer: str, player_id: str | None) -> str:
    raw = f"{type_}|{source}|{target}|{valid_from}|{layer}|{player_id}"
    return "e_" + hashlib.sha1(raw.encode()).hexdigest()[:16]


def _chain_fn(conn: sqlite3.Connection):
    parents = ontology.parent_map(conn)
    return lambda label: ontology.ancestors(label, parents)


# ------------------------------------------------------------------ writes
def upsert_node(conn: sqlite3.Connection, node_id: str, label: str, name: str, props: dict[str, Any] | None = None,
                layer: str = "canon", player_id: str | None = None, mirror: bool = True) -> dict[str, Any]:
    if not conn.execute("SELECT 1 FROM ontology_classes WHERE name=?", (label,)).fetchone():
        raise GraphError(f"Unknown class '{label}'")
    now = db.now_iso()
    conn.execute(
        """INSERT INTO kg_nodes(id,label,name,props,layer,player_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET label=excluded.label, name=excluded.name, props=excluded.props,
           layer=excluded.layer, player_id=excluded.player_id, updated_at=excluded.updated_at""",
        (node_id, label, name, db.dumps(props or {}), layer, player_id, now, now),
    )
    node = {"id": node_id, "label": label, "name": name, "props": props or {}, "layer": layer, "player_id": player_id}
    if mirror:
        neo4j_store.upsert_nodes([node], _chain_fn(conn))
    return node


def add_edge(conn: sqlite3.Connection, source: str, type_: str, target: str, *, props: dict[str, Any] | None = None,
             weight: float = 1.0, valid_from: int | None = None, valid_to: int | None = None, layer: str = "canon",
             player_id: str | None = None, validate: bool = True, mirror: bool = True,
             parents: dict[str, str | None] | None = None) -> dict[str, Any]:
    s = conn.execute("SELECT label FROM kg_nodes WHERE id=?", (source,)).fetchone()
    t = conn.execute("SELECT label FROM kg_nodes WHERE id=?", (target,)).fetchone()
    if not s or not t:
        raise GraphError(f"Edge endpoints must exist ({source} -> {target})")
    if validate:
        ontology.check_edge(conn, type_, s["label"], t["label"], parents)
    eid = edge_id(type_, source, target, valid_from, layer, player_id)
    conn.execute(
        """INSERT INTO kg_edges(id,source,target,type,props,weight,valid_from,valid_to,layer,player_id,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET props=excluded.props, weight=excluded.weight, valid_to=excluded.valid_to""",
        (eid, source, target, type_, db.dumps(props or {}), weight, valid_from, valid_to, layer, player_id, db.now_iso()),
    )
    edge = {"id": eid, "source": source, "target": target, "type": type_, "props": props or {}, "weight": weight,
            "valid_from": valid_from, "valid_to": valid_to, "layer": layer, "player_id": player_id}
    if mirror:
        neo4j_store.upsert_edges([edge])
    return edge


def delete_node(conn: sqlite3.Connection, node_id: str) -> bool:
    cur = conn.execute("DELETE FROM kg_nodes WHERE id=?", (node_id,))
    neo4j_store.delete_node(node_id)
    return cur.rowcount > 0


def delete_edge(conn: sqlite3.Connection, eid: str) -> bool:
    cur = conn.execute("DELETE FROM kg_edges WHERE id=?", (eid,))
    neo4j_store.delete_edge(eid)
    return cur.rowcount > 0


def delete_player_layer(conn: sqlite3.Connection, player_id: str) -> int:
    conn.execute("DELETE FROM kg_edges WHERE player_id=?", (player_id,))
    cur = conn.execute("DELETE FROM kg_nodes WHERE player_id=?", (player_id,))
    neo4j_store.delete_layer("player", player_id)
    return cur.rowcount


def sync_to_neo4j(conn: sqlite3.Connection, wipe: bool = True) -> dict[str, Any]:
    if not neo4j_store.available:
        return {"synced": False, "reason": neo4j_store.status().get("error")}
    if wipe:
        neo4j_store.wipe()
    chain = _chain_fn(conn)
    nodes = [db.row_to_dict(r) for r in conn.execute("SELECT * FROM kg_nodes").fetchall()]
    neo4j_store.upsert_nodes(nodes, chain)  # type: ignore[arg-type]
    edges = [db.row_to_dict(r) for r in conn.execute("SELECT * FROM kg_edges").fetchall()]
    neo4j_store.upsert_edges(edges)  # type: ignore[arg-type]
    return {"synced": True, "nodes": len(nodes), "edges": len(edges)}


# ------------------------------------------------------------------ reads
def _active_clause(ord_: int | None, alias: str = "e") -> tuple[str, list[Any]]:
    if ord_ is None:
        return "1=1", []
    return (f"({alias}.valid_from IS NULL OR {alias}.valid_from <= ?) AND ({alias}.valid_to IS NULL OR {alias}.valid_to >= ?)",
            [ord_, ord_])


def _layer_clause(player_id: str | None, include_player: bool, alias: str) -> tuple[str, list[Any]]:
    if include_player and player_id:
        return f"({alias}.layer='canon' OR {alias}.player_id=?)", [player_id]
    return f"{alias}.layer='canon'", []


def get_node(conn: sqlite3.Connection, node_id: str, ord_: int | None = None, player_id: str | None = None) -> dict[str, Any] | None:
    n = db.row_to_dict(conn.execute("SELECT * FROM kg_nodes WHERE id=?", (node_id,)).fetchone())
    if not n:
        return None
    act, aparams = _active_clause(ord_)
    lay, lparams = _layer_clause(player_id, True, "e")
    q = f"""SELECT e.*, s.name AS source_name, s.label AS source_label, t.name AS target_name, t.label AS target_label
            FROM kg_edges e JOIN kg_nodes s ON s.id=e.source JOIN kg_nodes t ON t.id=e.target
            WHERE (e.source=? OR e.target=?) AND {act} AND {lay} ORDER BY e.type LIMIT 800"""
    n["edges"] = db.rows_to_dicts(conn.execute(q, (node_id, node_id, *aparams, *lparams)).fetchall())
    return n


def search_nodes(conn: sqlite3.Connection, q: str = "", label: str | None = None, limit: int = 50,
                 player_id: str | None = None) -> list[dict[str, Any]]:
    sql = "SELECT id, label, name, layer, player_id FROM kg_nodes WHERE 1=1"
    params: list[Any] = []
    if q:
        sql += " AND (name LIKE ? OR id LIKE ?)"
        params += [f"%{q}%", f"%{q}%"]
    if label:
        sql += " AND label=?"
        params.append(label)
    if player_id:
        sql += " AND (layer='canon' OR player_id=?)"
        params.append(player_id)
    else:
        sql += " AND layer='canon'"
    sql += " ORDER BY length(name) LIMIT ?"
    params.append(limit)
    return db.rows_to_dicts(conn.execute(sql, params).fetchall())


def subgraph(conn: sqlite3.Connection, *, ord_: int | None = None, classes: list[str] | None = None,
             rel_types: list[str] | None = None, center: str | None = None, depth: int = 1,
             player_id: str | None = None, include_player: bool = False, storyline: str | None = None,
             limit_edges: int = 4000) -> dict[str, Any]:
    act, aparams = _active_clause(ord_)
    lay, lparams = _layer_clause(player_id, include_player, "e")
    where = [act, lay]
    params: list[Any] = [*aparams, *lparams]
    if rel_types:
        where.append(f"e.type IN ({','.join('?' * len(rel_types))})")
        params += rel_types
    elif not center:
        where.append(f"e.type NOT IN ({','.join('?' * len(HEAVY_RELATIONS))})")
        params += sorted(HEAVY_RELATIONS)

    sql = f"""SELECT e.id, e.source, e.target, e.type, e.weight, e.valid_from, e.valid_to, e.layer, e.props,
                     s.label sl, t.label tl
              FROM kg_edges e JOIN kg_nodes s ON s.id=e.source JOIN kg_nodes t ON t.id=e.target
              WHERE {' AND '.join(where)}"""
    if classes:
        ph = ",".join("?" * len(classes))
        sql += f" AND s.label IN ({ph}) AND t.label IN ({ph})"
        params += classes + classes

    if storyline:
        members = [r["source"] for r in conn.execute(
            f"SELECT e.source FROM kg_edges e WHERE e.type='IN_STORYLINE' AND e.target=? AND {act}",
            (storyline, *aparams)).fetchall()]
        if not members:
            return {"nodes": [], "links": []}
        center_set = set(members) | {storyline}
        ph = ",".join("?" * len(center_set))
        sql += f" AND (e.source IN ({ph}) AND e.target IN ({ph}))"
        params += list(center_set) + list(center_set)

    if center:
        frontier, seen, edges = {center}, {center}, {}
        for _ in range(max(1, min(depth, 3))):
            if not frontier:
                break
            ph = ",".join("?" * len(frontier))
            rows = conn.execute(sql + f" AND (e.source IN ({ph}) OR e.target IN ({ph})) LIMIT ?",
                                (*params, *frontier, *frontier, limit_edges)).fetchall()
            nxt = set()
            for r in rows:
                edges[r["id"]] = r
                for nid in (r["source"], r["target"]):
                    if nid not in seen:
                        seen.add(nid)
                        nxt.add(nid)
            frontier = nxt
            if len(edges) >= limit_edges:
                break
        edge_rows = list(edges.values())
    else:
        edge_rows = conn.execute(sql + " LIMIT ?", (*params, limit_edges)).fetchall()

    node_ids = {r["source"] for r in edge_rows} | {r["target"] for r in edge_rows}
    if center:
        node_ids.add(center)
    nodes = []
    ids = list(node_ids)
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        for r in conn.execute(f"SELECT id,label,name,props,layer,player_id FROM kg_nodes WHERE id IN ({','.join('?' * len(chunk))})", chunk):
            nodes.append(db.row_to_dict(r))
    if classes and not center:
        nodes = [n for n in nodes if n["label"] in classes]
    links = [{"id": r["id"], "source": r["source"], "target": r["target"], "type": r["type"], "weight": r["weight"],
              "valid_from": r["valid_from"], "valid_to": r["valid_to"], "layer": r["layer"],
              "props": db.row_to_dict(r).get("props", {})} for r in edge_rows]  # type: ignore[union-attr]
    return {"nodes": nodes, "links": links}


def to_networkx(conn: sqlite3.Connection, ord_: int | None = None, exclude: Iterable[str] = HEAVY_RELATIONS,
                player_id: str | None = None) -> nx.MultiDiGraph:
    g = nx.MultiDiGraph()
    act, aparams = _active_clause(ord_)
    lay, lparams = _layer_clause(player_id, bool(player_id), "e")
    excl = sorted(set(exclude))
    q = f"SELECT source, target, type, id FROM kg_edges e WHERE {act} AND {lay}"
    params = [*aparams, *lparams]
    if excl:
        q += f" AND type NOT IN ({','.join('?' * len(excl))})"
        params += excl
    for r in conn.execute(q, params):
        g.add_edge(r["source"], r["target"], key=r["id"], type=r["type"])
    return g


def shortest_path(conn: sqlite3.Connection, a: str, b: str, ord_: int | None = None,
                  exclude: list[str] | None = None) -> dict[str, Any]:
    excl = list(HEAVY_RELATIONS | set(exclude or []))
    if ord_ is None:
        try:
            path = neo4j_store.shortest_path(a, b, exclude_types=excl)
            if path is not None:
                return {"engine": "neo4j", "path": _decorate_path(conn, path)}
        except Exception:  # noqa: BLE001 - fall back to networkx
            pass
    g = to_networkx(conn, ord_, excl).to_undirected(as_view=False)
    if a not in g or b not in g:
        return {"engine": "networkx", "path": []}
    try:
        nodes = nx.shortest_path(g, a, b)
    except nx.NetworkXNoPath:
        return {"engine": "networkx", "path": []}
    path = []
    for i, nid in enumerate(nodes):
        via = None
        if i > 0:
            data = g.get_edge_data(nodes[i - 1], nid) or {}
            first = next(iter(data.values()), {})
            via = {"type": first.get("type")}
        path.append({"node": nid, "via": via})
    return {"engine": "networkx", "path": _decorate_path(conn, path)}


def _decorate_path(conn: sqlite3.Connection, path: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for step in path:
        r = conn.execute("SELECT name, label FROM kg_nodes WHERE id=?", (step["node"],)).fetchone()
        step["name"] = r["name"] if r else step["node"]
        step["label"] = r["label"] if r else None
    return path


def _pagerank(g: nx.Graph, damping: float = 0.85, iters: int = 60, tol: float = 1e-8) -> dict[str, float]:
    """Weighted PageRank by power iteration (pure Python, no numpy/scipy needed)."""
    nodes = list(g.nodes())
    n = len(nodes)
    rank = {v: 1.0 / n for v in nodes}
    out_w = {v: sum(d.get("weight", 1.0) for _, _, d in g.edges(v, data=True)) for v in nodes}
    for _ in range(iters):
        dangling = sum(rank[v] for v in nodes if out_w[v] == 0)
        new = {v: (1 - damping) / n + damping * dangling / n for v in nodes}
        for v in nodes:
            if out_w[v] == 0:
                continue
            share = damping * rank[v] / out_w[v]
            for _, u, d in g.edges(v, data=True):
                new[u] += share * d.get("weight", 1.0)
        delta = sum(abs(new[v] - rank[v]) for v in nodes)
        rank = new
        if delta < tol:
            break
    return rank


def centrality(conn: sqlite3.Connection, ord_: int | None = None, top: int = 25) -> list[dict[str, Any]]:
    """PageRank over character-to-character relations active at `ord_`."""
    g = nx.DiGraph()
    act, aparams = _active_clause(ord_)
    q = f"""SELECT e.source, e.target, e.weight FROM kg_edges e JOIN kg_nodes s ON s.id=e.source JOIN kg_nodes t ON t.id=e.target
            WHERE s.label='Character' AND t.label='Character' AND e.layer='canon' AND {act}"""
    for r in conn.execute(q, aparams):
        w = float(r["weight"] or 1)
        if g.has_edge(r["source"], r["target"]):
            g[r["source"]][r["target"]]["weight"] += w
        else:
            g.add_edge(r["source"], r["target"], weight=w)
    if g.number_of_nodes() == 0:
        return []
    pr = _pagerank(g.to_undirected())
    names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM kg_nodes WHERE label='Character'")}
    ranked = sorted(pr.items(), key=lambda x: x[1], reverse=True)[:top]
    return [{"id": k, "name": names.get(k, k), "score": round(v, 5), "degree": g.degree(k)} for k, v in ranked]


def stats(conn: sqlite3.Connection) -> dict[str, Any]:
    by_label = {r["label"]: r["n"] for r in conn.execute("SELECT label, COUNT(*) n FROM kg_nodes GROUP BY label ORDER BY n DESC")}
    by_type = {r["type"]: r["n"] for r in conn.execute("SELECT type, COUNT(*) n FROM kg_edges GROUP BY type ORDER BY n DESC")}
    layers = {r["layer"]: r["n"] for r in conn.execute("SELECT layer, COUNT(*) n FROM kg_nodes GROUP BY layer")}
    return {"nodes": sum(by_label.values()), "edges": sum(by_type.values()), "by_label": by_label, "by_type": by_type,
            "layers": layers, "neo4j": neo4j_store.status()}


def bfs_neighbors(conn: sqlite3.Connection, node_id: str, depth: int = 1) -> set[str]:
    seen, q = {node_id}, deque([(node_id, 0)])
    while q:
        cur, d = q.popleft()
        if d >= depth:
            continue
        for r in conn.execute("SELECT source, target FROM kg_edges WHERE source=? OR target=?", (cur, cur)):
            for nid in (r["source"], r["target"]):
                if nid not in seen:
                    seen.add(nid)
                    q.append((nid, d + 1))
    return seen
