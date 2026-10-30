"""LLM wiki endpoints (slugs contain '/', so they travel as query parameters)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..game import jobs
from ..wiki import service as wiki

router = APIRouter(prefix="/api/wiki", tags=["wiki"])


@router.get("/catalog")
def catalog(scope: str = "canon"):
    with db.db() as conn:
        return wiki.catalog(conn, scope)


@router.get("/pages")
def pages(scope: str = "canon", category: str | None = None, q: str | None = None):
    with db.db() as conn:
        return wiki.list_pages(conn, scope, category, q)


@router.get("/page")
def page(slug: str, scope: str = "canon", refresh: bool = False):
    with db.db() as conn:
        p = wiki.get_page(conn, slug, scope, refresh)
        if not p:
            raise HTTPException(404, f"No page '{slug}' in scope '{scope}'")
        return p


class PageIn(BaseModel):
    slug: str = Field(min_length=1, max_length=200)
    scope: str = "canon"
    content: str = Field(min_length=1, max_length=200_000)
    title: str | None = None


@router.put("/page")
def edit(body: PageIn):
    with db.db() as conn:
        return wiki.edit_page(conn, body.slug, body.scope, body.content, body.title)


@router.delete("/page")
def delete(slug: str, scope: str = "canon"):
    with db.db() as conn:
        if not wiki.delete_page(conn, slug, scope):
            raise HTTPException(404, "Page not found")
    return {"deleted": slug}


class RegenIn(BaseModel):
    slug: str
    scope: str = "canon"
    background: bool = False
    use_llm: bool = True


@router.post("/regenerate")
async def regenerate(body: RegenIn):
    if body.background:
        return {"queued": jobs.enqueue("wiki_regenerate", {"slug": body.slug, "scope": body.scope},
                                       None if body.scope == "canon" else body.scope)}
    p = await wiki.regenerate(body.slug, body.scope, body.use_llm)
    if not p:
        raise HTTPException(404, "Nothing to compile for this slug")
    return p


@router.get("/revisions")
def revisions(slug: str, scope: str = "canon"):
    with db.db() as conn:
        return wiki.revisions(conn, slug, scope)


@router.get("/lint")
def lint(scope: str = "canon"):
    with db.db() as conn:
        return wiki.lint(conn, scope)


@router.get("/log")
def log(scope: str = "canon", limit: int = 100):
    with db.db() as conn:
        return db.rows_to_dicts(conn.execute("SELECT * FROM wiki_log WHERE scope=? ORDER BY id DESC LIMIT ?", (scope, limit)).fetchall())
