"""Story Mode: canon scenes, chapter flow, beats, interventions and chapter progression."""
from __future__ import annotations

from app import db


def test_scenes_cover_every_episode_in_order(client):
    with db.db() as conn:
        n = conn.execute("SELECT COUNT(*) FROM canon_scenes").fetchone()[0]
        eps = conn.execute("SELECT COUNT(DISTINCT ord) FROM canon_scenes").fetchone()[0]
        lines = conn.execute("SELECT SUM(n_lines) FROM canon_scenes").fetchone()[0]
        total = conn.execute("SELECT COUNT(*) FROM script_lines").fetchone()[0]
        # every event is depicted by at most one scene
        evs = [e for r in conn.execute("SELECT events FROM canon_scenes") for e in db.row_to_dict(r)["events"]]  # type: ignore[index]
    assert n > 1000 and eps == 73
    assert lines == total, "scenes must partition the script without losing lines"
    assert len(evs) == len(set(evs))


def test_scene_graph_in_kg(client):
    stats = client.get("/api/graph/stats").json()["by_type"]
    for rel in ("SCENE_IN", "SET_AT", "FEATURES", "NEXT_SCENE", "DEPICTS"):
        assert stats.get(rel, 0) > 0, rel


def test_full_chapter_flow(client):
    p = client.post("/api/players", json={"name": "Story Tester", "background": "northern_noble", "season": 1, "episode": 1,
                                          "location_id": "winterfell"}).json()
    pid = p["id"]
    ch = client.get(f"/api/story/{pid}").json()
    assert ch["chapter"]["label"] == "S1E1" and ch["chapter"]["title"] == "Winter is Coming"
    assert ch["total"] >= 10 and ch["current_scene_id"] == ch["scenes"][0]["id"]
    first = ch["scenes"][0]
    assert first["location_id"] == "beyond_wall"  # the cold open with the rangers

    # enter: follow the story beyond the Wall, open a scene thread
    sc = client.post(f"/api/story/{pid}/scenes/{first['id']}/enter", json={"follow": True}).json()
    assert sc["thread_id"] and sc["beats"] and sc["beats"][0]["speaker_name"] == "Waymar Royce"
    state = client.get(f"/api/players/{pid}").json()
    assert state["player"]["location_id"] == "beyond_wall"

    # perform three beats → they land in the thread transcript
    for i in range(3):
        r = client.post(f"/api/story/{pid}/scenes/{first['id']}/beat", json={"index": i}).json()
    assert r["beat_index"] == 3
    thread = client.get(f"/api/threads/{sc['thread_id']}").json()
    assert thread["scene_id"] == first["id"]
    assert sum(1 for m in thread["messages"] if m["meta"].get("canon")) == 3

    # intervene: the interrupted character answers (fallback = their next canon line in this scene)
    res = client.post(f"/api/threads/{sc['thread_id']}/messages", json={"content": "Royce, we must turn back. Now.", "intent": "persuade",
                                                                          "target_id": "waymar_royce"})
    assert res.status_code == 200, res.text
    reply = res.json()["messages"][0]
    assert reply["speaker_id"] == "waymar_royce" and reply["content"]

    # dialogue options always available (template fallback without keys)
    opts = client.get(f"/api/story/{pid}/scenes/{first['id']}/options").json()
    assert len(opts) >= 3 and all(o["text"] for o in opts)

    # complete every scene of the chapter, then move to the next chapter
    for s in ch["scenes"]:
        client.post(f"/api/story/{pid}/scenes/{s['id']}/complete", json={"skipped": s["id"] != first["id"]})
    ch2 = client.get(f"/api/story/{pid}").json()
    assert ch2["chapter_complete"] and ch2["current_scene_id"] is None
    nxt = client.post(f"/api/story/{pid}/next-chapter").json()
    assert nxt["chapter"]["chapter"]["label"] == "S1E2"
    assert nxt["reports"][0]["label"] == "S1E2"

    # scene threads appear in the player's conversation list
    threads = client.get(f"/api/players/{pid}/threads").json()
    assert any(t["id"] == sc["thread_id"] for t in threads)

    # future scenes are not playable
    future = client.get(f"/api/story/{pid}/scenes/sc_10_000")
    assert future.status_code == 400
    client.delete(f"/api/players/{pid}")


def test_dead_characters_vanish_from_scenes(client):
    p = client.post("/api/players", json={"name": "Diverger 2", "background": "sellsword", "season": 1, "episode": 1}).json()
    pid = p["id"]
    from app.game import world_state

    with db.db() as conn:
        world_state.set_alive(conn, pid, "eddard_stark", False, 1, "slain in this world")
    ch = client.get(f"/api/story/{pid}").json()
    ned_scene = next(s for s in ch["scenes"] if any(c["id"] == "eddard_stark" for c in s["participants"]))
    detail = client.get(f"/api/story/{pid}/scenes/{ned_scene['id']}").json()
    assert detail["diverged"] and all(b["speaker_id"] != "eddard_stark" for b in detail["beats"])
    client.delete(f"/api/players/{pid}")
