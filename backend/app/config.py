"""Runtime configuration. Everything is overridable through environment variables."""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent

STORAGE_DIR = Path(os.getenv("GOT_STORAGE_DIR", str(BACKEND_DIR / "storage")))
DB_PATH = Path(os.getenv("GOT_DB_PATH", str(STORAGE_DIR / "got.db")))
SECRET_KEY_FILE = STORAGE_DIR / "secret.key"
UPLOAD_DIR = STORAGE_DIR / "uploads"

SCRIPT_PATH = Path(
    os.getenv("GOT_SCRIPT_PATH", str(PROJECT_DIR / "data" / "Game_of_Thrones_Script.csv"))
)
PERSONA_DIR = Path(__file__).resolve().parent / "canon" / "personas"

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "westeros-graph")
NEO4J_ENABLED = os.getenv("NEO4J_ENABLED", "true").lower() not in ("0", "false", "no")

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]

# Set GOT_SKIP_BOOTSTRAP=1 in tests to control seeding manually.
SKIP_BOOTSTRAP = os.getenv("GOT_SKIP_BOOTSTRAP", "0") == "1"


def ensure_dirs() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
