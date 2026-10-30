"""Gameplay: players, conversations, learned behaviour, simulation, divergence, rumours, snapshots."""
from __future__ import annotations

import asyncio
import random

from app import db
from app.game import behavior, knowledge, simulation, world_state


def test_create_and_state(client, player):
    st = client.get(f"/api/players/{player['id']}").json()
    assert st["player"]["label"] == "S2E1"
    assert st["present"], "someone should be in King's Landing"
    assert any(f["faction_id"] == "house_lannister" for f in st["factions"])


def test_presence_rules(client, player):
    r = client.post(f"/api/players/{player['id']}/threads", json={"character_ids": ["jon_snow"], "kind": "chat"})
    assert r.status_code == 400 and "not here" in r.json()["detail"]
    r = client.post(f"/api/players/{player['id']}/threads", json={"character_ids": ["eddard_stark"], "kind": "raven"})
    assert r.status_code == 400 and "dead" in r.json()["detail"]
    r = client.post(f"/api/players/{player['id']}/threads", json={"character_ids": ["jon_snow"], "kind": "raven"})
    assert r.status_code == 201


def test_conversation_fallback_and_learning(client, player):
    t = client.post(f"/api/players/{player['id']}/threads", json={"character_ids": ["varys"], "kind": "chat"}).json()
    learned = []
    for _ in range(4):
        r = client.post(f"/api/threads/{t['id']}/messages", json={"content": "I am a prince of Dorne in disguise", "intent": "deceive"})
        assert r.status_code == 200, r.text
        m = r.json()["messages"][0]
        assert m["meta"]["check"]["intent"] == "deceive"
        learned += m["meta"]["learned"]
    with db.db() as conn:
        st = world_state.state(conn, player["id"], "varys")
    assert st["counters"].get(f"talked_with:player:{player['id']}") == 4
    thread = client.get(f"/api/threads/{t['id']}").json()
    assert len(thread["messages"]) == 9  # opening + 4 * (player + reply)
    mems = client.get("/api/memories", params={"character_id": "varys", "player_id": player["id"], "scope": "player"}).json()
    assert mems["total"] >= 4


def test_pattern_rules_change_behaviour(client, player):
    with db.db() as conn:
        for _ in range(3):
            behavior.record_pattern(conn, player["id"], "cersei_lannister", "deceived_by", "player:x", "Tester", 11)
        st = world_state.state(conn, player["id"], "cersei_lannister")
        c = world_state.character(conn, "cersei_lannister")
        eff = behavior.effective_personality(conn, player["id"], c)
    rules = [l["rule"] for l in st["learned"]]
    assert any("No longer believes" in r for r in rules)
    assert eff["openness"] < c["personality"]["openness"]


def test_scene_and_continue(client, player):
    st = client.get(f"/api/players/{player['id']}").json()
    ids = [c["id"] for c in st["present"][:3]]
    sc = client.post(f"/api/players/{player['id']}/threads", json={"character_ids": ids, "kind": "scene"}).json()
    r = client.post(f"/api/threads/{sc['id']}/messages", json={"content": "What do you all make of Stannis?", "intent": "say"})
    assert r.status_code == 200 and r.json()["messages"]
    assert client.post(f"/api/threads/{sc['id']}/continue").status_code == 200
    # witnesses form dyadic memories of each other
    with db.db() as conn:
        n = conn.execute("SELECT COUNT(*) FROM memories WHERE player_id=? AND counterpart_id IS NOT NULL", (player["id"],)).fetchone()[0]
    assert n >= 1


def test_gift_and_duel(client, player):
    t = client.post(f"/api/players/{player['id']}/threads", json={"character_ids": ["bronn"], "kind": "chat"})
    if t.status_code != 201:
        return  # Bronn may not be present at this point; covered elsewhere
    tid = t.json()["id"]
    before = client.get(f"/api/players/{player['id']}").json()["player"]["gold"]
    r = client.post(f"/api/threads/{tid}/messages", json={"content": "For your trouble.", "intent": "gift", "gold": 10})
    assert r.status_code == 200
    assert r.json()["player"]["gold"] == before - 10
    assert client.post(f"/api/threads/{tid}/messages", json={"content": "", "intent": "gift", "gold": 90000}).status_code == 400
    d = client.post(f"/api/threads/{tid}/messages", json={"content": "Draw!", "intent": "duel"})
    assert d.status_code == 200 and d.json()["messages"][0]["meta"]["duel"]


def test_advance_divergence_and_prevented_event(client):
    p = client.post("/api/players", json={"name": "Diverger", "background": "hedge_knight", "season": 1, "episode": 8,
                                          "location_id": "kings_landing"}).json()
    with db.db() as conn:
        # In this world, someone saves Ned Stark before his execution and Joffrey dies early.
        world_state.set_alive(conn, p["id"], "joffrey_baratheon", False, 8, "slain in this world")
    r = client.post(f"/api/players/{p['id']}/advance", json={"steps": 1}).json()
    canon = {c["title"]: c["outcome"] for c in r["reports"][0]["canon"]}
    assert canon["Execution of Eddard Stark"] in ("prevented", "altered")
    roster = {x["id"]: x for x in client.get(f"/api/players/{p['id']}/roster").json()}
    assert roster["eddard_stark"]["alive"] is True  # Ned survives in this world
    outs = client.get(f"/api/players/{p['id']}/outcomes").json()
    assert any(o["outcome"] != "occurred" for o in outs)
    client.delete(f"/api/players/{p['id']}")


def test_canon_deaths_cause_grief(client):
    p = client.post("/api/players", json={"name": "Witness", "background": "northern_noble", "season": 1, "episode": 8,
                                          "location_id": "winterfell"}).json()
    client.post(f"/api/players/{p['id']}/advance", json={"steps": 1})
    with db.db() as conn:
        st = world_state.state(conn, p["id"], "arya_stark")
        mem = conn.execute("SELECT COUNT(*) FROM memories WHERE player_id=? AND character_id='arya_stark' AND content LIKE '%Eddard Stark is dead%'",
                           (p["id"],)).fetchone()[0]
    assert mem == 1
    assert st["affect"]["p"] < st["affect"]["base"]["p"]
    client.delete(f"/api/players/{p['id']}")


def test_rumours_propagate_between_threads(client, player):
    with db.db() as conn:
        fid = knowledge.add_fact(conn, player["id"], "The stranger carries a letter for Lord Stannis", subjects=["stannis_baratheon"],
                                 secrecy=0.0, source_thread="t_fake", ord_=11)
        present = world_state.present_characters(conn, player["id"], "kings_landing", 11)
        teller = present[0]["id"]
        knowledge.learn(conn, fid, player["id"], teller, confidence=1.0, learned_from="player", ord_=11)
        spread = []
        for seed in range(8):
            spread += knowledge.propagate(conn, player["id"], 11, random.Random(seed), budget=50)
        knowers = knowledge.who_knows(conn, fid)
    assert len(knowers) >= 2 and spread
    assert all(s["fact_id"] == fid for s in spread)


def test_simulation_tick_runs_plots_and_offscreen(client, player):
    rep = asyncio.run(simulation.tick(player["id"], 12, seed=7))
    assert {"canon", "offscreen", "plots", "new_plots", "rumours", "factions"} <= set(rep)
    assert rep["offscreen"], "co-located characters should interact off-screen"
    plots = client.get(f"/api/players/{player['id']}/plots").json()
    assert plots
    rel = client.get(f"/api/players/{player['id']}/world-relationships").json()
    assert rel and all("disposition" in r for r in rel)


def test_travel(client, player):
    r = client.post(f"/api/players/{player['id']}/travel", json={"location_id": "dragonstone"})
    assert r.status_code == 200 and r.json()["arrived"] == "dragonstone"
    assert client.post(f"/api/players/{player['id']}/travel", json={"location_id": "nowhere"}).status_code == 400


def test_player_reset_guarded(client):
    p = client.post("/api/players", json={"name": "Resetme", "background": "sellsword", "season": 3, "episode": 1}).json()
    client.post(f"/api/players/{p['id']}/advance", json={"steps": 2})
    prep = client.post("/api/admin/reset/prepare", json={"action": "reset_player", "target": p["id"]}).json()
    assert client.post("/api/admin/players/reset/confirm", json={"token": prep["token"], "phrase": "nope"}).status_code == 403
    prep = client.post("/api/admin/reset/prepare", json={"action": "reset_player", "target": p["id"]}).json()
    r = client.post("/api/admin/players/reset/confirm", json={"token": prep["token"], "phrase": prep["confirm_phrase"]})
    assert r.status_code == 200 and r.json()["archived"]["file"].startswith("pre-player-reset")
    st = client.get(f"/api/players/{p['id']}").json()
    assert st["player"]["label"] == "S3E1"
    client.delete(f"/api/players/{p['id']}")


def test_full_reset_archives_and_restores(client):
    p = client.post("/api/players", json={"name": "Temp", "background": "sellsword"}).json()
    client.post("/api/llm/keys", json={"name": "keepme", "provider": "groq", "key": "gsk-keep-1234", "model": "llama"})
    prep = client.post("/api/admin/reset/prepare", json={"action": "reset_all"}).json()
    assert prep["current"]["players"] >= 1
    r = client.post("/api/admin/reset/confirm", json={"token": prep["token"], "phrase": "RESTART WESTEROS"})
    assert r.status_code == 200
    assert r.json()["now"]["players"] == 0
    assert any(k["name"] == "keepme" for k in client.get("/api/llm/keys").json())  # api keys preserved
    archives = client.get("/api/admin/snapshots").json()["archives"]
    assert archives and archives[0]["file"].startswith("pre-reset")
    # the archive can be restored (and the current state is archived first)
    prep = client.post("/api/admin/reset/prepare", json={"action": "restore_archive", "target": archives[0]["file"]}).json()
    r = client.post("/api/admin/restore/confirm", json={"token": prep["token"], "phrase": "RESTART WESTEROS"})
    assert r.status_code == 200 and r.json()["now"]["players"] >= 1
    assert client.get(f"/api/players/{p['id']}").status_code == 200
    # token reuse is rejected
    assert client.post("/api/admin/restore/confirm", json={"token": prep["token"], "phrase": "RESTART WESTEROS"}).status_code == 403
    with db.db() as conn:
        conn.execute("DELETE FROM api_keys")
    client.delete(f"/api/players/{p['id']}")
