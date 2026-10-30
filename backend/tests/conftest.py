"""Test configuration: isolated storage (outside the repo), Neo4j off, one shared bootstrapped app."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="got_tests_"))
os.environ["GOT_STORAGE_DIR"] = str(_TMP)
os.environ["NEO4J_ENABLED"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def player(client):
    r = client.post("/api/players", json={"name": "Tester", "background": "little_bird", "season": 2, "episode": 1,
                                          "location_id": "kings_landing"})
    assert r.status_code == 201, r.text
    p = r.json()
    yield p
    client.delete(f"/api/players/{p['id']}")
