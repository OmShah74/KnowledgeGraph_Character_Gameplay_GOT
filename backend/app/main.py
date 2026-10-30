"""FastAPI application: the agentic Westeros backend."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import bootstrap, config, db, snapshots
from .api import admin, game, graph, llm, wiki, world
from .game import jobs
from .game.engine import GameError
from .llm.router import router as llm_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("got")


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    db.init_db()
    if not config.SKIP_BOOTSTRAP:
        res = await asyncio.to_thread(bootstrap.run)
        log.info("bootstrap: %s", {k: (v if k != "graph" else {kk: vv for kk, vv in v.items() if kk != "skipped"}) for k, v in res.items()})
    stop = asyncio.Event()
    worker = asyncio.create_task(jobs.worker(stop))
    try:
        yield
    finally:
        stop.set()
        await asyncio.wait([worker], timeout=5)
        await llm_router.aclose()


app = FastAPI(title="Westeros Agentic RPG", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def maintenance_gate(request: Request, call_next):
    if snapshots.maintenance.is_set() and request.method != "GET" and not request.url.path.startswith("/api/admin"):
        return JSONResponse({"detail": "The realm is being restored. Try again in a moment."}, status_code=503)
    return await call_next(request)


@app.exception_handler(GameError)
async def game_error(_: Request, exc: GameError):
    status = 404 if "not found" in str(exc).lower() else 400
    return JSONResponse({"detail": str(exc)}, status_code=status)


@app.exception_handler(PermissionError)
async def perm_error(_: Request, exc: PermissionError):
    return JSONResponse({"detail": str(exc)}, status_code=403)


for r in (world.router, llm.router, graph.router, game.router, wiki.router, admin.router):
    app.include_router(r)


@app.get("/")
def root():
    return {"name": "Westeros Agentic RPG backend", "docs": "/docs"}
