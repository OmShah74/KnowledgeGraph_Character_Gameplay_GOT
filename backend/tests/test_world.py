"""Canon ingestion, knowledge graph, ontology, priors, memory and wiki."""
from __future__ import annotations

from app import db
from app.canon import world
from app.canon.characters import CHARACTERS
from app.canon.timeline import MAX_ORD, from_ord, point, resolve_arc, to_ord


def test_timeline_roundtrip():
    assert MAX_ORD == 73
    for o in range(1, MAX_ORD + 1):
        s, e = from_ord(o)
        assert to_ord(s, e) == o
    assert point("8.4") == to_ord(8, 4)
    assert resolve_arc({"1": "a", "3.5": "b"}, to_ord(3, 4)) == "a"
    assert resolve_arc({"2": "a"}, 1) is None


def test_canon_references_are_valid():
    stories = {s["id"] for s in world.STORYLINES}
    ids = {c["id"] for c in CHARACTERS}
    assert len(ids) == len(CHARACTERS), "duplicate character ids"
    for c in CHARACTERS:
        for v in c["arcs"].values():
            assert v in stories, f"{c['id']} uses unknown storyline {v}"
        if c["killer"]:
            assert c["killer"] in ids, f"{c['id']} killer {c['killer']}"
    for s in world.STORYLINES:
        assert s["location"] in {l["id"] for l in world.LOCATIONS}


def test_ingestion(client):
    m = client.get("/api/meta").json()
    assert m["lines"] == 23911 and m["episodes"] == 73 and m["characters"] >= 180
    d = client.get("/api/data/status").json()
    assert d["top_speakers"][0]["id"] == "tyrion_lannister"
    lines = client.get("/api/characters/arya_stark/lines", params={"q": "needle"}).json()
    assert lines["total"] > 0


def test_ontology_valid_and_editable(client):
    assert client.get("/api/ontology/validate").json()["valid"]
    r = client.post("/api/ontology/classes", json={"name": "Prophecy", "parent": "Concept", "description": "A foretelling"})
    assert r.status_code == 201
    r = client.post("/api/ontology/relations", json={"name": "FORETOLD_BY", "domain": "Prophecy", "range": "Character"})
    assert r.status_code == 201
    n = client.post("/api/graph/nodes", json={"id": "prophecy_pwtwp", "label": "Prophecy", "name": "The Prince That Was Promised"})
    assert n.status_code == 201
    e = client.post("/api/graph/edges", json={"source": "prophecy_pwtwp", "type": "FORETOLD_BY", "target": "melisandre"})
    assert e.status_code == 201
    bad = client.post("/api/graph/edges", json={"source": "melisandre", "type": "FORETOLD_BY", "target": "prophecy_pwtwp"})
    assert bad.status_code == 400  # domain/range violation
    assert client.delete("/api/ontology/classes/Prophecy").status_code == 400  # has instances
    assert client.delete(f"/api/graph/edges/{e.json()['id']}").status_code == 200
    assert client.delete("/api/graph/nodes/prophecy_pwtwp").status_code == 200
    assert client.delete("/api/ontology/relations/FORETOLD_BY").status_code == 200
    assert client.delete("/api/ontology/classes/Prophecy").status_code == 200
    assert client.delete("/api/ontology/classes/Character").status_code == 400  # builtin


def test_storylines_separate_daenerys_and_cersei_early(client):
    s1 = client.get("/api/graph/subgraph", params={"ord": 5, "types": "IN_STORYLINE"}).json()
    targets = {l["source"]: l["target"] for l in s1["links"]}
    assert targets["daenerys_targaryen"] != targets["cersei_lannister"]
    comms = client.get("/api/graph/communities").json()["1"]
    for c in comms:
        assert not ({"daenerys_targaryen", "cersei_lannister"} <= set(c["members"]))


def test_temporal_graph_hides_future(client):
    early = client.get("/api/graph/node/jon_snow", params={"ord": 3}).json()
    assert not any(e["type"] == "LOVER_OF" and "daenerys_targaryen" in (e["source"], e["target"]) for e in early["edges"])
    late = client.get("/api/graph/node/jon_snow", params={"ord": 70}).json()
    assert any(e["type"] == "LOVER_OF" and "daenerys_targaryen" in (e["source"], e["target"]) for e in late["edges"])


def test_inference_rules(client):
    stats = client.get("/api/graph/stats").json()["by_type"]
    for rel in ("GRANDPARENT_OF", "UNCLE_OR_AUNT_OF", "COUSIN_OF", "BLOOD_FEUD_WITH", "SAME_HOUSE_AS"):
        assert stats.get(rel, 0) > 0, rel
    node = client.get("/api/graph/node/tywin_lannister").json()
    assert any(e["type"] == "GRANDPARENT_OF" and e["target"] == "joffrey_baratheon" for e in node["edges"])


def test_relationship_priors_and_criteria(client):
    p = client.get("/api/relationships/pair", params={"a": "tyrion_lannister", "b": "cersei_lannister", "ord": 20}).json()
    cersei_view = p["views"]["cersei_lannister"]["prior"]
    assert cersei_view["disposition"] in ("hostile", "neutral") and cersei_view["trust"] < 0
    friends = client.get("/api/relationships/pair", params={"a": "jon_snow", "b": "samwell_tarly", "ord": 20}).json()
    assert friends["views"]["jon_snow"]["prior"]["disposition"] == "friendly"
    assert len(friends["memories"]["jon_snow"]) > 0  # dyadic canon memories


def test_memory_recall_is_timeline_gated(client):
    items = client.get("/api/memories/recall", params={"character_id": "tyrion_lannister", "q": "dragons queen Meereen", "ord": 15}).json()
    assert items and all(m["ord"] <= 15 for m in items)


def test_wiki_pages_compile(client):
    cat = client.get("/api/wiki/catalog").json()
    assert len(cat["character"]) >= 180 and cat["ontology"]
    for slug in ("character/jon_snow", "house/stark", "location/winterfell", "storyline/meereen", "event/evt_000",
                 "ontology/Character", "relationship/arya_stark--sansa_stark", "memory/arya_stark", "index", "log"):
        r = client.get("/api/wiki/page", params={"slug": slug})
        assert r.status_code == 200, slug
        assert r.json()["content"].startswith("#")
    edit = client.put("/api/wiki/page", json={"slug": "house/stark", "content": "# House Stark\n\nEdited.", "scope": "canon"})
    assert edit.json()["version"] >= 2
    assert len(client.get("/api/wiki/revisions", params={"slug": "house/stark"}).json()) >= 2
    regen = client.post("/api/wiki/regenerate", json={"slug": "house/stark", "use_llm": False})
    assert "Members" in regen.json()["content"]


def test_characters_listing(client):
    r = client.get("/api/characters", params={"ord": 30, "alive": True}).json()
    ids = {c["id"] for c in r["items"]}
    assert "robb_stark" not in ids and "tyrion_lannister" in ids
    c = client.get("/api/characters/daenerys_targaryen", params={"ord": 25}).json()
    assert c["location_id"] == "yunkai" and c["persona"]["generated"]
    with db.db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM memories WHERE counterpart_id IS NOT NULL").fetchone()[0] > 500


def test_persona_gating_hides_future():
    from app.game.personas import gate, load_md

    md = load_md("arya_stark")
    early = gate(md, 3)       # S1E3
    assert "S1:" not in early and "Red Wedding" not in early and "Faceless" not in early
    after_s1 = gate(md, 11)   # S2E1
    assert "S1:" in after_s1 and "S2:" not in after_s1
    late = gate(md, 73)
    assert "S8:" in late and "Red Wedding" in late


def test_titles_never_spoil_the_future(client):
    early = client.get("/api/characters/daenerys_targaryen", params={"ord": 4}).json()
    assert "Mother of Dragons" not in " ".join(early["titles_now"]) and not early["arc_complete"]
    late = client.get("/api/characters/daenerys_targaryen", params={"ord": 73}).json()
    assert "Mother of Dragons" in late["titles"] and late["arc_complete"]
    ned = client.get("/api/characters/eddard_stark", params={"ord": 5}).json()
    assert "Hand of the King" in ned["titles_now"]  # held S1E2–S1E9
    listing = client.get("/api/characters", params={"ord": 4, "q": "Daenerys"}).json()["items"][0]
    assert "Breaker of Chains" not in listing["titles"]
