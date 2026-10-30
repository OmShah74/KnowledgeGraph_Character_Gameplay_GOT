"""LLM key rotation, failover, single-key retry and JSON handling with a mocked provider."""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app import db
from app.llm.router import AllKeysFailed, extract_json, router


def _reset_keys():
    with db.db() as conn:
        conn.execute("DELETE FROM api_keys")
        conn.execute("DELETE FROM llm_calls")


def _add(client, name, provider="groq", model="m", priority=0):
    r = client.post("/api/llm/keys", json={"name": name, "provider": provider, "key": f"sk-{name}-secret-value", "model": model,
                                           "priority": priority})
    assert r.status_code == 201, r.text
    return r.json()


def _install(handler):
    router._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _ok(content: str):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}], "usage": {"prompt_tokens": 5, "completion_tokens": 3}})


def test_keys_are_masked_and_encrypted(client):
    _reset_keys()
    k = _add(client, "k1")
    assert "key_cipher" not in k and k["key_hint"].startswith("sk-k") and "secret" not in k["key_hint"]
    with db.db() as conn:
        raw = conn.execute("SELECT key_cipher FROM api_keys WHERE id=?", (k["id"],)).fetchone()[0]
    assert "secret" not in raw
    listed = client.get("/api/llm/keys").json()
    assert all("key_cipher" not in x for x in listed)


def test_duplicate_name_rejected(client):
    _reset_keys()
    _add(client, "dup")
    r = client.post("/api/llm/keys", json={"name": "dup", "provider": "gemini", "key": "abcdefgh", "model": "x"})
    assert r.status_code == 409


def test_round_robin_spreads_load(client):
    _reset_keys()
    for n in ("a", "b", "c"):
        _add(client, n)
    client.put("/api/llm/settings", json={"strategy": "round_robin"})
    seen = []

    def handler(req: httpx.Request):
        seen.append(req.headers["authorization"].split("-")[1])
        return _ok("hi")

    _install(handler)
    for _ in range(6):
        asyncio.run(router.chat([{"role": "user", "content": "x"}], json_mode=False))
    assert set(seen) == {"a", "b", "c"}
    assert seen[:3] != [seen[0]] * 3


def test_failover_on_429_and_cooldown(client):
    _reset_keys()
    _add(client, "bad", priority=10)
    _add(client, "good", priority=1)
    client.put("/api/llm/settings", json={"strategy": "priority"})

    def handler(req: httpx.Request):
        if "bad" in req.headers["authorization"]:
            return httpx.Response(429, headers={"retry-after": "30"}, json={"error": "rate"})
        return _ok('{"dialogue": "Winter is coming."}')

    _install(handler)
    res = asyncio.run(router.chat([{"role": "user", "content": "x"}]))
    assert res.key_name == "good" and res.attempts == 2
    keys = {k["name"]: k for k in client.get("/api/llm/keys").json()}
    assert keys["bad"]["cooling_down"] and keys["bad"]["failure_count"] == 1
    # next call skips the cooling key entirely
    res2 = asyncio.run(router.chat([{"role": "user", "content": "x"}]))
    assert res2.attempts == 1 and res2.key_name == "good"


def test_timeout_fails_over(client):
    _reset_keys()
    _add(client, "slow", priority=5)
    _add(client, "fast", priority=1)
    client.put("/api/llm/settings", json={"strategy": "priority"})

    def handler(req: httpx.Request):
        if "slow" in req.headers["authorization"]:
            raise httpx.ReadTimeout("timeout", request=req)
        return _ok("ok")

    _install(handler)
    assert asyncio.run(router.chat([{"role": "user", "content": "x"}], json_mode=False)).key_name == "fast"


def test_single_key_retries_then_succeeds(client):
    _reset_keys()
    _add(client, "only")
    calls = {"n": 0}

    def handler(req: httpx.Request):
        calls["n"] += 1
        return httpx.Response(503) if calls["n"] == 1 else _ok("ok")

    _install(handler)
    res = asyncio.run(router.chat([{"role": "user", "content": "x"}], json_mode=False))
    assert res.key_name == "only" and calls["n"] == 2


def test_all_keys_fail_raises(client):
    _reset_keys()
    _add(client, "x1")
    _add(client, "x2")
    _install(lambda req: httpx.Response(401, json={"error": "bad key"}))
    with pytest.raises(AllKeysFailed):
        asyncio.run(router.chat([{"role": "user", "content": "x"}]))


def test_json_mode_unsupported_retries_without_response_format(client):
    _reset_keys()
    _add(client, "nojson")
    seen = []

    def handler(req: httpx.Request):
        body = json.loads(req.content)
        seen.append("response_format" in body)
        if "response_format" in body:
            return httpx.Response(400, json={"error": "response_format not supported"})
        return _ok('Sure! ```json\n{"a": 1,}\n```')

    _install(handler)
    data, res = asyncio.run(router.chat_json([{"role": "user", "content": "x"}]))
    assert data == {"a": 1} and seen == [True, False]


def test_extract_json_variants():
    assert extract_json('{"x": 2}') == {"x": 2}
    assert extract_json('text before {"x": [1,2,],} after') == {"x": [1, 2]}
    with pytest.raises(ValueError):
        extract_json("no json here")


def test_character_turn_uses_llm_decision(client, player):
    _reset_keys()
    _add(client, "agent")
    decision = {"dialogue": "A Lannister always pays his debts.", "action": "raises a cup", "thought": "Useful, perhaps.",
                "appraisal": "flattered", "relationship_delta": {"trust": 40, "affection": 3, "respect": 2, "fear": 0},
                "feelings_toward_others": [], "memory": {"content": "A clever stranger flattered me.", "importance": 0.6},
                "facts_learned": [{"content": "The stranger claims to work for the Spider", "believed": 0.6, "secrecy": 0.8, "subjects": ["varys"]}],
                "patterns": ["flirted_by"], "quest": {"title": "Find the Spider's bird", "description": "Learn who reports to Varys.",
                "objectives": [{"type": "talk_to", "target": "varys", "text": "Speak with Varys"}], "reward": {"gold": 30, "renown": 2}},
                "goal_update": {"goal": "Learn who the stranger serves", "priority": 0.7}, "ends_conversation": False}
    _install(lambda req: _ok(json.dumps(decision)))
    st = client.get(f"/api/players/{player['id']}").json()
    ids = [c["id"] for c in st["present"]]
    assert "tyrion_lannister" in ids
    t = client.post(f"/api/players/{player['id']}/threads", json={"character_ids": ["tyrion_lannister"], "kind": "chat"}).json()
    r = client.post(f"/api/threads/{t['id']}/messages", json={"content": "You are the cleverest man in the city.", "intent": "charm"})
    assert r.status_code == 200, r.text
    msg = r.json()["messages"][0]
    assert msg["content"] == "A Lannister always pays his debts."
    assert msg["meta"]["llm"]["fallback"] is False
    assert msg["meta"]["delta"]["trust"] == 15  # clamped
    assert msg["meta"]["quest"] == "Find the Spider's bird"
    prof = client.get(f"/api/players/{player['id']}/characters/tyrion_lannister/profile").json()
    assert any(g["goal"] == "Learn who the stranger serves" for g in prof["goals"])
    assert any("Spider" in f["content"] for f in prof["knows"])
    _reset_keys()
