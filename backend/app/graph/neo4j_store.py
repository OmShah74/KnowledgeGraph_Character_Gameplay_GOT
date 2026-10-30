"""Neo4j mirror of the knowledge graph.

SQLite is authoritative; Neo4j receives every node/edge write (best-effort) and powers the
Cypher console and native graph algorithms (shortest paths). If Neo4j is unreachable the
app keeps working on the SQLite graph and retries the connection periodically.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from typing import Any, Iterable

from .. import config

log = logging.getLogger("got.neo4j")

SAFE_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
WRITE_CLAUSES = re.compile(
    r"\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD\s+CSV|FOREACH|CALL\s+dbms|CALL\s+db\.create|CALL\s+apoc\.(create|merge|refactor|periodic))\b",
    re.IGNORECASE,
)


def _neo_value(v: Any) -> Any:
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (list, tuple)) and all(isinstance(x, (str, int, float, bool)) for x in v):
        return list(v)
    return json.dumps(v, ensure_ascii=False)


def flatten_props(props: dict[str, Any]) -> dict[str, Any]:
    return {k: _neo_value(v) for k, v in props.items() if SAFE_IDENT.match(k)}


class Neo4jStore:
    def __init__(self) -> None:
        self._driver = None
        self._lock = threading.Lock()
        self._last_attempt = 0.0
        self._error: str | None = None
        self.retry_seconds = 30.0

    # ------------------------------------------------------------- connection
    def _connect(self) -> None:
        if not config.NEO4J_ENABLED:
            self._error = "Neo4j disabled by configuration"
            return
        from neo4j import GraphDatabase

        try:
            driver = GraphDatabase.driver(
                config.NEO4J_URI, auth=(config.NEO4J_USER, config.NEO4J_PASSWORD),
                connection_timeout=3.0, max_connection_lifetime=600,
            )
            driver.verify_connectivity()
            self._driver = driver
            self._error = None
            self._ensure_schema()
            log.info("Connected to Neo4j at %s", config.NEO4J_URI)
        except Exception as exc:  # noqa: BLE001 - any driver failure means "unavailable"
            self._driver = None
            self._error = f"{type(exc).__name__}: {exc}"
            log.warning("Neo4j unavailable: %s", self._error)

    def driver(self):
        with self._lock:
            if self._driver is None and time.time() - self._last_attempt > self.retry_seconds:
                self._last_attempt = time.time()
                self._connect()
            return self._driver

    @property
    def available(self) -> bool:
        return self.driver() is not None

    def status(self) -> dict[str, Any]:
        ok = self.available
        out: dict[str, Any] = {"enabled": config.NEO4J_ENABLED, "available": ok, "uri": config.NEO4J_URI, "error": self._error}
        if ok:
            try:
                with self._driver.session() as s:  # type: ignore[union-attr]
                    out["nodes"] = s.run("MATCH (n) RETURN count(n) AS c").single()["c"]
                    out["relationships"] = s.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
            except Exception as exc:  # noqa: BLE001
                out["error"] = str(exc)
        return out

    def force_reconnect(self) -> None:
        with self._lock:
            if self._driver is not None:
                try:
                    self._driver.close()
                except Exception:  # noqa: BLE001
                    pass
            self._driver = None
            self._last_attempt = 0.0

    def _ensure_schema(self) -> None:
        assert self._driver is not None
        with self._driver.session() as s:
            s.run("CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE")
            s.run("CREATE INDEX entity_name IF NOT EXISTS FOR (n:Entity) ON (n.name)")
            s.run("CREATE INDEX entity_player IF NOT EXISTS FOR (n:Entity) ON (n.player_id)")

    def _run(self, query: str, **params: Any) -> None:
        drv = self.driver()
        if drv is None:
            return
        try:
            with drv.session() as s:
                s.run(query, **params).consume()
        except Exception as exc:  # noqa: BLE001
            log.warning("Neo4j write failed: %s", exc)
            self._error = str(exc)

    # ------------------------------------------------------------- writes
    @staticmethod
    def _labels(chain: list[str]) -> str:
        labels = [l for l in chain if SAFE_IDENT.match(l)]
        if "Entity" not in labels:
            labels.append("Entity")
        return ":".join(f"`{l}`" for l in labels)

    def upsert_nodes(self, nodes: Iterable[dict[str, Any]], label_chain_for) -> None:
        """nodes: dicts with id,label,name,props,layer,player_id. Grouped per label chain."""
        groups: dict[str, list[dict[str, Any]]] = {}
        for n in nodes:
            labels = self._labels(label_chain_for(n["label"]))
            props = flatten_props(n.get("props") or {})
            props.update({"id": n["id"], "name": n["name"], "class": n["label"], "layer": n.get("layer", "canon"),
                          "player_id": n.get("player_id")})
            groups.setdefault(labels, []).append(props)
        for labels, rows in groups.items():
            for i in range(0, len(rows), 1000):
                self._run(f"UNWIND $rows AS row MERGE (n:Entity {{id: row.id}}) SET n = row SET n:{labels}",
                          rows=rows[i:i + 1000])

    def upsert_edges(self, edges: Iterable[dict[str, Any]]) -> None:
        groups: dict[str, list[dict[str, Any]]] = {}
        for e in edges:
            if not SAFE_IDENT.match(e["type"]):
                continue
            props = flatten_props(e.get("props") or {})
            props.update({"id": e["id"], "weight": e.get("weight", 1.0), "valid_from": e.get("valid_from"),
                          "valid_to": e.get("valid_to"), "layer": e.get("layer", "canon"), "player_id": e.get("player_id")})
            groups.setdefault(e["type"], []).append({"s": e["source"], "t": e["target"], "props": props})
        for rel, rows in groups.items():
            for i in range(0, len(rows), 1000):
                self._run(
                    f"""UNWIND $rows AS row MATCH (a:Entity {{id: row.s}}) MATCH (b:Entity {{id: row.t}})
                        MERGE (a)-[r:`{rel}` {{id: row.props.id}}]->(b) SET r = row.props""",
                    rows=rows[i:i + 1000],
                )

    def delete_node(self, node_id: str) -> None:
        self._run("MATCH (n:Entity {id: $id}) DETACH DELETE n", id=node_id)

    def delete_edge(self, edge_id: str) -> None:
        self._run("MATCH ()-[r {id: $id}]->() DELETE r", id=edge_id)

    def delete_layer(self, layer: str, player_id: str | None = None) -> None:
        if player_id:
            self._run("MATCH (n:Entity {player_id: $pid}) DETACH DELETE n", pid=player_id)
            self._run("MATCH ()-[r {player_id: $pid}]->() DELETE r", pid=player_id)
        else:
            self._run("MATCH (n:Entity {layer: $layer}) DETACH DELETE n", layer=layer)

    def wipe(self) -> None:
        self._run("MATCH (n) DETACH DELETE n")

    # ------------------------------------------------------------- reads
    def cypher(self, query: str, params: dict[str, Any] | None = None, allow_write: bool = False,
               limit: int = 500) -> dict[str, Any]:
        drv = self.driver()
        if drv is None:
            raise RuntimeError(f"Neo4j is not available ({self._error or 'not connected'})")
        if not allow_write and WRITE_CLAUSES.search(query):
            raise PermissionError("Write clauses are disabled in the console. Enable 'allow writes' to run them.")
        from neo4j.graph import Node, Path, Relationship

        nodes: dict[str, dict[str, Any]] = {}
        links: dict[str, dict[str, Any]] = {}

        def conv(v: Any) -> Any:
            if isinstance(v, Node):
                nid = v.get("id") or v.element_id
                d = {"id": nid, "labels": sorted(v.labels), "name": v.get("name", nid), "class": v.get("class"),
                     "properties": dict(v)}
                nodes[nid] = d
                return d
            if isinstance(v, Relationship):
                sid = v.start_node.get("id") if v.start_node is not None else None
                tid = v.end_node.get("id") if v.end_node is not None else None
                if v.start_node is not None:
                    conv(v.start_node)
                if v.end_node is not None:
                    conv(v.end_node)
                rid = v.get("id") or v.element_id
                d = {"id": rid, "type": v.type, "source": sid, "target": tid, "properties": dict(v)}
                links[rid] = d
                return d
            if isinstance(v, Path):
                return {"nodes": [conv(n) for n in v.nodes], "relationships": [conv(r) for r in v.relationships]}
            if isinstance(v, list):
                return [conv(x) for x in v]
            if isinstance(v, dict):
                return {k: conv(x) for k, x in v.items()}
            if isinstance(v, (str, int, float, bool)) or v is None:
                return v
            return str(v)

        t0 = time.time()
        with drv.session() as s:
            def work(tx):
                res = tx.run(query, **(params or {}))
                cols = list(res.keys())
                rows = []
                for i, rec in enumerate(res):
                    if i >= limit:
                        break
                    rows.append([conv(rec[c]) for c in cols])
                return cols, rows

            cols, rows = s.execute_write(work) if allow_write else s.execute_read(work)
        return {"columns": cols, "rows": rows, "graph": {"nodes": list(nodes.values()), "links": list(links.values())},
                "elapsed_ms": int((time.time() - t0) * 1000), "truncated": len(rows) >= limit}

    def shortest_path(self, a: str, b: str, max_len: int = 6, exclude_types: list[str] | None = None) -> list[dict[str, Any]] | None:
        drv = self.driver()
        if drv is None:
            return None
        excl = exclude_types or []
        q = (f"MATCH (a:Entity {{id:$a}}), (b:Entity {{id:$b}}), p = shortestPath((a)-[*..{int(max_len)}]-(b)) "
             "WHERE all(r IN relationships(p) WHERE NOT type(r) IN $excl) "
             "RETURN [n IN nodes(p) | n.id] AS nodes, [r IN relationships(p) | {type: type(r), id: r.id}] AS rels")
        with drv.session() as s:
            rec = s.run(q, a=a, b=b, excl=excl).single()
            if not rec:
                return []
            out = []
            for i, nid in enumerate(rec["nodes"]):
                out.append({"node": nid, "via": rec["rels"][i - 1] if i > 0 else None})
            return out


neo4j_store = Neo4jStore()
