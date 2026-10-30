"""Knowledge graph, Cypher console and ontology editing."""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db, snapshots
from ..graph import builder, inference, ontology, store
from ..graph.neo4j_store import neo4j_store

router = APIRouter(prefix="/api", tags=["graph"])


def _split(v: str | None) -> list[str] | None:
    return [x for x in (v or "").split(",") if x] or None


@router.get("/graph/stats")
def graph_stats():
    with db.db() as conn:
        return store.stats(conn)


@router.get("/graph/subgraph")
def subgraph(ord: int | None = None, classes: str | None = None, types: str | None = None, center: str | None = None,
             depth: int = 1, player_id: str | None = None, include_player: bool = False, storyline: str | None = None,
             limit: int = 3000):
    with db.db() as conn:
        return store.subgraph(conn, ord_=ord, classes=_split(classes), rel_types=_split(types), center=center, depth=depth,
                              player_id=player_id, include_player=include_player, storyline=storyline, limit_edges=min(limit, 8000))


@router.get("/graph/node/{node_id}")
def node(node_id: str, ord: int | None = None, player_id: str | None = None):
    with db.db() as conn:
        n = store.get_node(conn, node_id, ord, player_id)
        if not n:
            raise HTTPException(404, "Node not found")
        return n


@router.get("/graph/search")
def search(q: str = "", label: str | None = None, player_id: str | None = None, limit: int = 30):
    with db.db() as conn:
        return store.search_nodes(conn, q, label, min(limit, 200), player_id)


class NodeIn(BaseModel):
    id: str | None = Field(default=None, max_length=100)
    label: str
    name: str = Field(min_length=1, max_length=200)
    props: dict[str, Any] = {}
    player_id: str | None = None


class NodePatch(BaseModel):
    name: str | None = None
    props: dict[str, Any] | None = None
    label: str | None = None


class EdgeIn(BaseModel):
    source: str
    type: str
    target: str
    props: dict[str, Any] = {}
    weight: float = 1.0
    valid_from: int | None = None
    valid_to: int | None = None
    player_id: str | None = None


@router.post("/graph/nodes", status_code=201)
def create_node(body: NodeIn):
    nid = body.id or re.sub(r"[^a-z0-9_]+", "_", body.name.lower()).strip("_") + "_" + db.new_id()[:4]
    with db.db() as conn:
        if conn.execute("SELECT 1 FROM kg_nodes WHERE id=?", (nid,)).fetchone():
            raise HTTPException(409, "Node id already exists")
        try:
            return store.upsert_node(conn, nid, body.label, body.name, {**body.props, "user_created": True},
                                     layer="player" if body.player_id else "canon", player_id=body.player_id)
        except store.GraphError as exc:
            raise HTTPException(400, str(exc)) from exc


@router.patch("/graph/nodes/{node_id}")
def patch_node(node_id: str, body: NodePatch):
    with db.db() as conn:
        n = db.row_to_dict(conn.execute("SELECT * FROM kg_nodes WHERE id=?", (node_id,)).fetchone())
        if not n:
            raise HTTPException(404, "Node not found")
        props = {**n["props"], **(body.props or {})}
        try:
            return store.upsert_node(conn, node_id, body.label or n["label"], body.name or n["name"], props, n["layer"], n["player_id"])
        except store.GraphError as exc:
            raise HTTPException(400, str(exc)) from exc


@router.delete("/graph/nodes/{node_id}")
def delete_node(node_id: str):
    with db.db() as conn:
        if not store.delete_node(conn, node_id):
            raise HTTPException(404, "Node not found")
    return {"deleted": node_id}


@router.post("/graph/edges", status_code=201)
def create_edge(body: EdgeIn):
    with db.db() as conn:
        try:
            return store.add_edge(conn, body.source, body.type, body.target, props={**body.props, "user_created": True},
                                  weight=body.weight, valid_from=body.valid_from, valid_to=body.valid_to,
                                  layer="player" if body.player_id else "canon", player_id=body.player_id)
        except (store.GraphError, ontology.OntologyError) as exc:
            raise HTTPException(400, str(exc)) from exc


@router.delete("/graph/edges/{edge_id}")
def delete_edge(edge_id: str):
    with db.db() as conn:
        if not store.delete_edge(conn, edge_id):
            raise HTTPException(404, "Edge not found")
    return {"deleted": edge_id}


class CypherIn(BaseModel):
    query: str = Field(min_length=1, max_length=5000)
    params: dict[str, Any] = {}
    allow_write: bool = False
    limit: int = 500


@router.post("/graph/cypher")
def cypher(body: CypherIn):
    try:
        return neo4j_store.cypher(body.query, body.params, body.allow_write, min(body.limit, 2000))
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - surface Cypher syntax errors to the console
        raise HTTPException(400, f"{type(exc).__name__}: {exc}") from exc


@router.get("/graph/cypher/examples")
def cypher_examples():
    return [
        {"title": "Stark family tree", "query": "MATCH p=(a:Character)-[:PARENT_OF|SIBLING_OF]-(b:Character) WHERE a.house='stark' RETURN p LIMIT 80"},
        {"title": "Who killed whom", "query": "MATCH (k:Character)-[r:KILLED]->(v:Character) RETURN k.name AS killer, v.name AS victim, r.valid_from AS ord ORDER BY ord"},
        {"title": "Daenerys's storyline vs Cersei's (season 1)", "query": "MATCH (c:Character)-[r:IN_STORYLINE]->(s:Storyline) WHERE c.id IN ['daenerys_targaryen','cersei_lannister'] AND r.valid_from <= 10 RETURN c.name, s.name, r.valid_from, r.valid_to"},
        {"title": "Most talkative pairs (season 3)", "query": "MATCH (a:Character)-[r:INTERACTS_WITH]-(b:Character) WHERE r.season = 3 AND a.id < b.id RETURN a.name, b.name, r.weight ORDER BY r.weight DESC LIMIT 20"},
        {"title": "Inferred blood feuds", "query": "MATCH p=(a:Character)-[r:BLOOD_FEUD_WITH]-(b:Character) RETURN p LIMIT 60"},
        {"title": "Shortest path Jon → Cersei", "query": "MATCH p=shortestPath((a:Entity {id:'jon_snow'})-[*..5]-(b:Entity {id:'cersei_lannister'})) RETURN p"},
        {"title": "Conversation communities of season 1", "query": "MATCH (c:Character)-[:IN_COMMUNITY]->(m:Community {season: 1}) RETURN m.name, collect(c.name) AS members"},
        {"title": "A player's world: memories & facts", "query": "MATCH p=(c:Character)-[:REMEMBERS|KNOWS_FACT]->(x) WHERE x.layer='player' RETURN p LIMIT 100"},
        {"title": "Ontology class counts", "query": "MATCH (n:Entity) RETURN n.class AS class, count(*) AS n ORDER BY n DESC"},
    ]


@router.get("/graph/path")
def path(a: str, b: str, ord: int | None = None):
    with db.db() as conn:
        return store.shortest_path(conn, a, b, ord)


@router.get("/graph/centrality")
def centrality(ord: int | None = None, top: int = 25):
    with db.db() as conn:
        return store.centrality(conn, ord, top)


@router.get("/graph/communities")
def communities():
    with db.db() as conn:
        return builder.communities_json(conn)


@router.post("/graph/rebuild")
def rebuild():
    archived = snapshots.archive_current("pre-graph-rebuild")
    with db.db() as conn:
        res = builder.build(conn)
    return {"archived": archived, **{k: v for k, v in res.items() if k != "skipped"}, "skipped": res["skipped"][:20]}


@router.post("/graph/infer")
def infer():
    with db.db() as conn:
        res = inference.run(conn)
        store.sync_to_neo4j(conn)
    return res


@router.post("/graph/sync-neo4j")
def sync():
    neo4j_store.force_reconnect()
    with db.db() as conn:
        return store.sync_to_neo4j(conn)


# ------------------------------------------------------------------ ontology
class ClassIn(BaseModel):
    name: str
    parent: str
    description: str = ""
    properties: dict[str, Any] = {}
    color: str = "#94a3b8"


class ClassPatch(BaseModel):
    parent: str | None = None
    description: str | None = None
    properties: dict[str, Any] | None = None
    color: str | None = None


class RelationIn(BaseModel):
    name: str
    domain: str
    range: str
    description: str = ""
    symmetric: bool = False
    temporal: bool = False
    inverse: str | None = None


class RelationPatch(BaseModel):
    domain: str | None = None
    range: str | None = None
    description: str | None = None
    symmetric: bool | None = None
    temporal: bool | None = None
    inverse: str | None = None


def _ont(fn, *a, **kw):
    with db.db() as conn:
        try:
            return fn(conn, *a, **kw)
        except ontology.OntologyError as exc:
            raise HTTPException(400, str(exc)) from exc


@router.get("/ontology")
def get_ontology():
    with db.db() as conn:
        return {"classes": ontology.classes(conn), "relations": ontology.relations(conn)}


@router.post("/ontology/classes", status_code=201)
def create_class(body: ClassIn):
    return _ont(ontology.create_class, body.name, body.parent, body.description, body.properties, body.color)


@router.patch("/ontology/classes/{name}")
def patch_class(name: str, body: ClassPatch):
    return _ont(ontology.update_class, name, **body.model_dump(exclude_none=True))


@router.delete("/ontology/classes/{name}")
def delete_class(name: str):
    _ont(ontology.delete_class, name)
    return {"deleted": name}


@router.post("/ontology/relations", status_code=201)
def create_relation(body: RelationIn):
    return _ont(ontology.create_relation, body.name, body.domain, body.range, body.description, body.symmetric, body.temporal, body.inverse)


@router.patch("/ontology/relations/{name}")
def patch_relation(name: str, body: RelationPatch):
    return _ont(ontology.update_relation, name, **body.model_dump(exclude_none=True))


@router.delete("/ontology/relations/{name}")
def delete_relation(name: str):
    _ont(ontology.delete_relation, name)
    return {"deleted": name}


@router.get("/ontology/validate")
def validate():
    with db.db() as conn:
        return ontology.validate_graph(conn)


