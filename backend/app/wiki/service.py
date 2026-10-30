"""The LLM wiki.

Following the "LLM-maintained wiki" pattern, knowledge is compiled into interlinked markdown
pages that are *maintained* (not regenerated from scratch) as new information arrives:

  scope 'canon'        pages compiled from canon data, the script and the knowledge graph
  scope <player_id>    a player's world: how characters, relationships and plots have evolved

Page namespaces (slug prefixes)
  character/<id>  house/<id>  location/<id>  storyline/<id>  event/<id>  plot/<id>
  relationship/<a>--<b>   ontology/<Class>   memory/<character_id>   chronicle   index   log

Operations
  get        lazily compiles a page from templates if it does not exist yet
  regenerate rebuilds sources and (if an LLM key exists) has the LLM synthesise a page that
             merges new sources into the existing text, keeping a revision
  ingest     applies new memories/plots/relationships to the affected pages (append-only
             "In this world" sections) and writes the wiki log
  lint       finds broken links, orphans, stale and contradictory pages
Links use [[slug|Label]] and are rendered as in-app links by the frontend.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any

from .. import db
from ..canon import world
from ..canon.timeline import MAX_ORD, label
from ..game import behavior, personas, relationships, world_state
from ..graph import store as kg
from ..memory import service as memory

LINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
CATEGORIES = ("character", "house", "location", "storyline", "event", "plot", "relationship", "ontology", "memory",
              "chronicle", "index", "log", "organization")


def link(slug: str, text: str) -> str:
    return f"[[{slug}|{text}]]"


def _clink(conn: sqlite3.Connection, cid: str) -> str:
    r = conn.execute("SELECT name FROM characters WHERE id=?", (cid,)).fetchone()
    return link(f"character/{cid}", r["name"]) if r else cid


def entity_link(label_: str, node_id: str, name: str) -> str:
    """Wiki link for a KG node, or plain text if it has no wiki page."""
    if label_ == "Character":
        return link(f"character/{node_id}", name)
    if label_ == "House":
        return link(f"house/{node_id.removeprefix('house_')}", name)
    if label_ == "Organization":
        return link(f"organization/{node_id.removeprefix('org_')}", name)
    if label_ == "Location":
        return link(f"location/{node_id}", name)
    if label_ == "Storyline":
        return link(f"storyline/{node_id.removeprefix('story_')}", name)
    if label_ == "Event" and node_id.startswith("evt_"):
        return link(f"event/{node_id}", name)
    if label_ == "Plot":
        return link(f"plot/{node_id}", name)
    return name


def pair_slug(a: str, b: str) -> str:
    x, y = sorted((a, b))
    return f"relationship/{x}--{y}"


# ------------------------------------------------------------------ storage
def _get(conn: sqlite3.Connection, slug: str, scope: str) -> dict[str, Any] | None:
    return db.row_to_dict(conn.execute("SELECT * FROM wiki_pages WHERE slug=? AND scope=?", (slug, scope)).fetchone())


def _save(conn: sqlite3.Connection, slug: str, scope: str, title: str, content: str, author: str,
          entity_type: str | None = None, entity_id: str | None = None) -> dict[str, Any]:
    cur = _get(conn, slug, scope)
    category = slug.split("/", 1)[0]
    now = db.now_iso()
    if cur:
        if cur["content"] == content:
            return cur
        version = cur["version"] + 1
        conn.execute("UPDATE wiki_pages SET title=?, content=?, version=?, generated_by=?, updated_at=? WHERE id=?",
                     (title, content, version, author, now, cur["id"]))
        page_id = cur["id"]
    else:
        version = 1
        c = conn.execute(
            """INSERT INTO wiki_pages(slug, scope, title, entity_type, entity_id, content, version, generated_by, category, updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?)""", (slug, scope, title, entity_type, entity_id, content, version, author, category, now))
        page_id = c.lastrowid
    conn.execute("INSERT INTO wiki_revisions(page_id, version, content, author, created_at) VALUES(?,?,?,?,?)",
                 (page_id, version, content, author, now))
    return _get(conn, slug, scope)  # type: ignore[return-value]


def log(conn: sqlite3.Connection, scope: str, action: str, slug: str | None, summary: str) -> None:
    conn.execute("INSERT INTO wiki_log(scope, action, slug, summary, created_at) VALUES(?,?,?,?,?)",
                 (scope, action, slug, summary[:500], db.now_iso()))


# ------------------------------------------------------------------ template compilers
def compile_character(conn: sqlite3.Connection, cid: str, scope: str) -> tuple[str, str] | None:
    c = world_state.character(conn, cid)
    if not c:
        return None
    player_id = None if scope == "canon" else scope
    ord_ = MAX_ORD
    if player_id:
        p = conn.execute("SELECT ord FROM players WHERE id=?", (player_id,)).fetchone()
        ord_ = p["ord"] if p else MAX_ORD
    lines = [f"# {c['name']}", ""]
    info = [("House", link(f"house/{c['house']}", f"House {c['house'].title()}") if c.get("house") else "—"),
            ("Titles", ", ".join(c["titles"]) or "—"), ("Culture", c.get("culture") or "—"),
            ("Faith", (c.get("religion") or "—").replace("_", " ")), ("Tier", c["tier"]),
            ("Lines in script", str(c["line_count"])),
            ("Appears", f"{label(c['first_ord'])} – {label(c['last_ord'])}" if c.get("first_ord") else "—")]
    if c.get("death_ord"):
        info.append(("Canon fate", f"dies {label(c['death_ord'])}" + (f" — {c['death_note']}" if c.get("death_note") else "")))
    lines += ["| | |", "|---|---|"] + [f"| **{k}** | {v} |" for k, v in info] + [""]
    if c.get("summary"):
        lines += ["## Overview", c["summary"], ""]
    if c.get("traits"):
        lines += ["## Traits", ", ".join(c["traits"]), ""]
    arcs = c.get("arcs") or {}
    if arcs:
        from ..canon.timeline import arc_segments

        lines.append("## Storylines")
        for frm, to, st in arc_segments(arcs, c.get("death_ord") or MAX_ORD):
            if frm > ord_:
                break
            name = next((s["name"] for s in world.STORYLINES if s["id"] == st), st)
            lines.append(f"- {label(frm)} – {label(min(to, ord_))}: {link(f'storyline/{st}', name)}")
        lines.append("")
    node = kg.get_node(conn, cid, ord_=ord_ if player_id else None, player_id=player_id)
    if node:
        rels: dict[str, list[str]] = {}
        for e in node["edges"]:
            if e["type"] in kg.HEAVY_RELATIONS or e["type"] in ("LOCATED_AT", "IN_STORYLINE", "PARTICIPATED_IN", "REMEMBERS"):
                continue
            other_id = e["target"] if e["source"] == cid else e["source"]
            other_name = e["target_name"] if e["source"] == cid else e["source_name"]
            other_label = e["target_label"] if e["source"] == cid else e["source_label"]
            txt = entity_link(other_label, other_id, other_name)
            arrow = "→" if e["source"] == cid else "←"
            span = ""
            if e["valid_from"] or e["valid_to"]:
                span = f" ({label(e['valid_from']) if e['valid_from'] else '…'}–{label(e['valid_to']) if e['valid_to'] else '…'})"
            rels.setdefault(e["type"], []).append(f"{arrow} {txt}{span}")
        if rels:
            lines.append("## Knowledge-graph relations")
            for t in sorted(rels):
                lines.append(f"- **{t}**: " + "; ".join(rels[t][:12]))
            lines.append("")
    net = relationships.character_network(conn, player_id, cid, ord_, 10)
    if net:
        lines += ["## Relationships (priors" + (" evolved in this world" if player_id else "") + ")",
                  "| With | Stance | Disposition | Trust | Affection | Respect | Fear | Why |", "|---|---|---|---|---|---|---|---|"]
        for r in net:
            lines.append(f"| {_clink(conn, r['id'])} | {r['stance']} | {r['disposition']} | {r['trust']:.0f} | {r['affection']:.0f} | "
                         f"{r['respect']:.0f} | {r['fear']:.0f} | {'; '.join(r['reasons'])[:120]} |")
        lines.append("")
    if player_id:
        prof = behavior.profile(conn, player_id, c, ord_)
        lines += ["## In this world", f"- **Mood:** {prof['mood']} · stress {float(prof['stress']):.2f}",
                  "- **Goals:** " + "; ".join(g["goal"] for g in prof["goals"][:5])]
        if prof["learned"]:
            lines.append("- **Learned behaviour:**")
            lines += [f"  - {l['rule']} _({l['source']}, {label(l['ord']) if l.get('ord') else ''})_" for l in prof["learned"][-10:]]
        drift = {k: v for k, v in prof["drift"].items() if abs(v) >= 0.01}
        if drift:
            lines.append("- **Personality drift:** " + ", ".join(f"{k} {v:+.2f}" for k, v in drift.items()))
        lines += ["", f"See also: {link(f'memory/{cid}', 'Memory digest')}", ""]
    voice = c.get("voice") or {}
    sig = [s for s in voice.get("signature_lines", []) if s["ord"] <= ord_]
    if sig:
        lines += ["## Quotes"] + [f"> “{s['text']}” — {s['label']}" for s in sig[:6]] + [""]
    return c["name"], "\n".join(lines)


def compile_relationship(conn: sqlite3.Connection, a: str, b: str, scope: str) -> tuple[str, str] | None:
    ca, cb = world_state.character(conn, a), world_state.character(conn, b)
    if not ca or not cb:
        return None
    player_id = None if scope == "canon" else scope
    ord_ = MAX_ORD
    if player_id:
        p = conn.execute("SELECT ord FROM players WHERE id=?", (player_id,)).fetchone()
        ord_ = p["ord"] if p else MAX_ORD
    title = f"{ca['name']} & {cb['name']}"
    lines = [f"# {title}", "", f"Relationship between {_clink(conn, a)} and {_clink(conn, b)}.", ""]
    for x, y in ((a, b), (b, a)):
        r = relationships.get_char_rel(conn, player_id, x, y, ord_, create=False) if player_id else relationships.canon_prior(conn, x, y, ord_)
        nx_, ny = world_state.character(conn, x)["name"], world_state.character(conn, y)["name"]  # type: ignore[index]
        lines += [f"## {nx_} → {ny}", f"- **Stance:** {r['stance']} ({relationships.disposition(r)})",
                  f"- trust {r['trust']:.0f} · affection {r['affection']:.0f} · respect {r['respect']:.0f} · fear {r['fear']:.0f} · familiarity {r['familiarity']:.0f}"]
        why = r.get("reasons") or ([r.get("notes")] if r.get("notes") else [])
        if why:
            lines.append("- **Basis:** " + "; ".join(w for w in why if w)[:400])
        lines.append("")
    mem = memory.pair_memories(conn, a, b, ord_, player_id, limit=8)
    for x in (a, b):
        items = mem.get(x) or []
        if items:
            lines.append(f"## What {world_state.character(conn, x)['name']} remembers")  # type: ignore[index]
            for m in items:
                tag = "this world" if m.get("player_id") else "canon"
                lines.append(f"- _{label(m['ord']) if m['ord'] else ''} · {tag}_ — {m['content'][:300]}")
            lines.append("")
    if player_id:
        hist = conn.execute(
            """SELECT * FROM relationship_log WHERE player_id=? AND ((subject=? AND object=?) OR (subject=? AND object=?))
               ORDER BY id DESC LIMIT 12""", (player_id, a, b, b, a)).fetchall()
        if hist:
            lines.append("## How it changed")
            for h in hist:
                lines.append(f"- {label(h['ord'])}: {h['reason']}")
    return title, "\n".join(lines)


def compile_memory_digest(conn: sqlite3.Connection, cid: str, scope: str) -> tuple[str, str] | None:
    c = world_state.character(conn, cid)
    if not c:
        return None
    player_id = None if scope == "canon" else scope
    res = memory.list_memories(conn, character_id=cid, player_id=player_id, scope="player" if player_id else "canon", limit=60)
    lines = [f"# Memory digest — {c['name']}", "", f"Back to {_clink(conn, cid)}.", "",
             f"{res['total']} memories in this scope.", ""]
    by_kind: dict[str, list[dict[str, Any]]] = {}
    for m in res["items"]:
        by_kind.setdefault(m["kind"], []).append(m)
    for kind, items in by_kind.items():
        lines.append(f"## {kind.replace('_', ' ').title()}")
        for m in items[:20]:
            cp = f" · with {_clink(conn, m['counterpart_id'])}" if m.get("counterpart_id") else ""
            lines.append(f"- **{label(m['ord']) if m['ord'] else '—'}** (importance {m['importance']:.2f}{cp}) {m['content'][:280]}")
        lines.append("")
    return f"Memories of {c['name']}", "\n".join(lines)


def compile_house(conn: sqlite3.Connection, hid: str) -> tuple[str, str] | None:
    h = next((x for x in world.HOUSES if x["id"] == hid), None)
    if not h:
        return None
    members = db.rows_to_dicts(conn.execute("SELECT id, name, tier, death_ord FROM characters WHERE house=? ORDER BY line_count DESC", (hid,)).fetchall())
    lines = [f"# {h['name']}", "", f"> *{h['words']}*", "", f"- **Sigil:** {h['sigil']}",
             f"- **Seat:** {link('location/' + h['seat'], world_state.LOCATIONS[h['seat']]['name']) if h['seat'] else '—'}",
             f"- **Region:** {h['region'].replace('_', ' ').title()}", "", "## Members"]
    for m in members:
        lines.append(f"- {link('character/' + m['id'], m['name'])} ({m['tier']}){' † ' + label(m['death_ord']) if m['death_ord'] else ''}")
    return h["name"], "\n".join(lines)


def compile_location(conn: sqlite3.Connection, lid: str) -> tuple[str, str] | None:
    l = world_state.LOCATIONS.get(lid)
    if not l:
        return None
    lines = [f"# {l['name']}", "", l["description"], "", f"- **Region:** {l['region'].replace('_', ' ').title()}", f"- **Kind:** {l['kind']}", ""]
    stories = [s for s in world.STORYLINES if s["location"] == lid]
    if stories:
        lines += ["## Storylines set here"] + [f"- {link('storyline/' + s['id'], s['name'])}" for s in stories]
    evs = db.rows_to_dicts(conn.execute("SELECT * FROM canon_events WHERE location_id=? ORDER BY ord", (lid,)).fetchall())
    if evs:
        lines += ["", "## Events"] + [f"- {label(e['ord'])}: {link('event/' + e['id'], e['title'])}" for e in evs]
    return l["name"], "\n".join(lines)


def compile_storyline(conn: sqlite3.Connection, sid: str) -> tuple[str, str] | None:
    s = next((x for x in world.STORYLINES if x["id"] == sid), None)
    if not s:
        return None
    members = conn.execute(
        """SELECT e.source, e.valid_from, e.valid_to, n.name FROM kg_edges e JOIN kg_nodes n ON n.id=e.source
           WHERE e.type='IN_STORYLINE' AND e.target=? AND e.layer='canon' ORDER BY e.valid_from""", (f"story_{sid}",)).fetchall()
    lines = [f"# {s['name']}", "", f"Set at {link('location/' + s['location'], world_state.LOCATIONS[s['location']]['name'])}.", "", "## Characters"]
    for m in members:
        lines.append(f"- {link('character/' + m['source'], m['name'])}: {label(m['valid_from'])} – {label(m['valid_to'])}")
    return s["name"], "\n".join(lines)


def compile_event(conn: sqlite3.Connection, eid: str, scope: str) -> tuple[str, str] | None:
    e = db.row_to_dict(conn.execute("SELECT * FROM canon_events WHERE id=?", (eid,)).fetchone())
    if not e:
        return None
    lines = [f"# {e['title']}", "", f"**{label(e['ord'])}** · {e['kind']} · importance {e['importance']}", "", e["description"], "",
             f"Location: {link('location/' + e['location_id'], world_state.LOCATIONS.get(e['location_id'], {}).get('name', e['location_id']))}"
             if e.get("location_id") else "", "", "## Participants"]
    lines += [f"- {_clink(conn, p)}" for p in e["participants"]]
    if scope != "canon":
        o = conn.execute("SELECT * FROM canon_outcomes WHERE player_id=? AND event_id=?", (scope, eid)).fetchone()
        if o:
            lines += ["", "## In this world", f"**{o['outcome'].upper()}** — {o['narration']}"]
    return e["title"], "\n".join(lines)


def compile_plot(conn: sqlite3.Connection, pid: str) -> tuple[str, str] | None:
    p = db.row_to_dict(conn.execute("SELECT * FROM plot_threads WHERE id=?", (pid,)).fetchone())
    if not p:
        return None
    stages = p["stages"]
    lines = [f"# {p['title']}", "", p["premise"], "", f"**Stakes:** {p['stakes']}", f"**Status:** {p['status']} · tension {p['tension']:.2f}", "",
             "## Stages"]
    for i, s in enumerate(stages):
        mark = "▶" if i == p["stage"] and p["status"] == "active" else ("✓" if i < p["stage"] or p["status"] != "active" else "·")
        lines.append(f"- {mark} **{s['name']}** — {s['description']}")
    lines += ["", "## Involved"] + [f"- {_clink(conn, c)}" for c in p["characters"]]
    lines += ["", "## Chronicle"] + [f"- {l['label']}: {l['text']}" for l in p["log"]]
    links = conn.execute("SELECT from_thread FROM thread_links WHERE to_kind='plot' AND to_id=?", (pid,)).fetchall()
    if links:
        lines += ["", f"Linked conversations: {len(links)}"]
    return p["title"], "\n".join(lines)


def compile_ontology(conn: sqlite3.Connection, cls: str) -> tuple[str, str] | None:
    c = db.row_to_dict(conn.execute("SELECT * FROM ontology_classes WHERE name=?", (cls,)).fetchone())
    if not c:
        return None
    subs = [r["name"] for r in conn.execute("SELECT name FROM ontology_classes WHERE parent=?", (cls,))]
    out_rels = db.rows_to_dicts(conn.execute("SELECT * FROM ontology_relations WHERE domain=?", (cls,)).fetchall())
    in_rels = db.rows_to_dicts(conn.execute("SELECT * FROM ontology_relations WHERE range=?", (cls,)).fetchall())
    count = conn.execute("SELECT COUNT(*) FROM kg_nodes WHERE label=?", (cls,)).fetchone()[0]
    sample = conn.execute("SELECT id, name FROM kg_nodes WHERE label=? AND layer='canon' LIMIT 12", (cls,)).fetchall()
    lines = [f"# Ontology class: {cls}", "", c["description"], "",
             f"- **Parent:** {link('ontology/' + c['parent'], c['parent']) if c['parent'] else '— (root)'}",
             f"- **Subclasses:** {', '.join(link('ontology/' + s, s) for s in subs) or '—'}",
             f"- **Instances:** {count}", "", "## Properties"]
    lines += [f"- `{k}`: {v}" for k, v in (c["properties"] or {}).items()] or ["- (none declared)"]
    lines += ["", "## Relations (outgoing)"] + [f"- **{r['name']}** → {link('ontology/' + r['range'], r['range'])}: {r['description']}" for r in out_rels]
    lines += ["", "## Relations (incoming)"] + [f"- {link('ontology/' + r['domain'], r['domain'])} → **{r['name']}**: {r['description']}" for r in in_rels]
    if sample:
        lines += ["", "## Example instances"] + [f"- {s['name']} (`{s['id']}`)" for s in sample]
    return f"{cls} (ontology)", "\n".join(lines)


def compile_chronicle(conn: sqlite3.Connection, player_id: str) -> tuple[str, str] | None:
    p = db.row_to_dict(conn.execute("SELECT * FROM players WHERE id=?", (player_id,)).fetchone())
    if not p:
        return None
    evs = db.rows_to_dicts(conn.execute("SELECT * FROM events WHERE player_id=? ORDER BY id DESC LIMIT 80", (player_id,)).fetchall())
    lines = [f"# The Chronicle of {p['name']}", "", f"Now: **{label(p['ord'])}** at {world_state.LOCATIONS.get(p['location_id'], {}).get('name')}", ""]
    divergent = conn.execute("SELECT COUNT(*) FROM canon_outcomes WHERE player_id=? AND outcome!='occurred'", (player_id,)).fetchone()[0]
    lines.append(f"Divergences from canon so far: **{divergent}**")
    lines += ["", "## Recent events"]
    for e in evs:
        lines.append(f"- {label(e['ord'])} · *{e['kind']}* — **{e['title']}**: {e['description'][:240]}")
    plots_ = conn.execute("SELECT id, title, status FROM plot_threads WHERE player_id=? ORDER BY updated_at DESC", (player_id,)).fetchall()
    if plots_:
        lines += ["", "## Plot threads"] + [f"- {link('plot/' + r['id'], r['title'])} ({r['status']})" for r in plots_]
    return f"Chronicle of {p['name']}", "\n".join(lines)


def compile_index(conn: sqlite3.Connection, scope: str) -> tuple[str, str]:
    lines = ["# Index of the Realm", "", "The living encyclopedia of this world, maintained by agents.", ""]
    majors = conn.execute("SELECT id, name FROM characters WHERE tier='major' ORDER BY name").fetchall()
    lines += ["## Major characters", ", ".join(link(f"character/{r['id']}", r["name"]) for r in majors), ""]
    lines += ["## Houses", ", ".join(link(f"house/{h['id']}", h["name"]) for h in world.HOUSES), ""]
    lines += ["## Places", ", ".join(link(f"location/{l['id']}", l["name"]) for l in world.LOCATIONS), ""]
    lines += ["## Storylines", ", ".join(link(f"storyline/{s['id']}", s["name"]) for s in world.STORYLINES), ""]
    lines += ["## Ontology", ", ".join(link(f"ontology/{r['name']}", r["name"]) for r in conn.execute("SELECT name FROM ontology_classes ORDER BY name")), ""]
    if scope != "canon":
        lines += ["## This world", link("chronicle", "The Chronicle"), ""]
        for r in conn.execute("SELECT id, title FROM plot_threads WHERE player_id=? ORDER BY updated_at DESC LIMIT 20", (scope,)):
            lines.append(f"- {link('plot/' + r['id'], r['title'])}")
    pages = conn.execute("SELECT slug, title FROM wiki_pages WHERE scope=? ORDER BY updated_at DESC LIMIT 30", (scope,)).fetchall()
    if pages:
        lines += ["", "## Recently updated"] + [f"- {link(p['slug'], p['title'])}" for p in pages]
    return "Index", "\n".join(lines)


def compile_log(conn: sqlite3.Connection, scope: str) -> tuple[str, str]:
    rows = conn.execute("SELECT * FROM wiki_log WHERE scope=? ORDER BY id DESC LIMIT 100", (scope,)).fetchall()
    lines = ["# Wiki log", "", "Append-only record of what the wiki agents ingested and changed.", ""]
    lines += [f"- `{r['created_at']}` **{r['action']}** {link(r['slug'], r['slug']) if r['slug'] else ''} — {r['summary']}" for r in rows]
    return "Log", "\n".join(lines)


def compile_page(conn: sqlite3.Connection, slug: str, scope: str) -> tuple[str, str] | None:
    if slug == "index":
        return compile_index(conn, scope)
    if slug == "log":
        return compile_log(conn, scope)
    if slug == "chronicle":
        return compile_chronicle(conn, scope) if scope != "canon" else None
    if "/" not in slug:
        return None
    kind, key = slug.split("/", 1)
    if kind == "character":
        return compile_character(conn, key, scope)
    if kind == "relationship" and "--" in key:
        a, b = key.split("--", 1)
        return compile_relationship(conn, a, b, scope)
    if kind == "memory":
        return compile_memory_digest(conn, key, scope)
    if kind == "house":
        return compile_house(conn, key)
    if kind == "location":
        return compile_location(conn, key)
    if kind == "storyline":
        return compile_storyline(conn, key)
    if kind == "event":
        return compile_event(conn, key, scope)
    if kind == "plot":
        return compile_plot(conn, key)
    if kind == "ontology":
        return compile_ontology(conn, key)
    if kind == "organization":
        o = next((x for x in world.ORGANIZATIONS if x["id"] == key), None)
        if not o:
            return None
        members = conn.execute("SELECT e.source, n.name FROM kg_edges e JOIN kg_nodes n ON n.id=e.source WHERE e.type='MEMBER_OF' AND e.target=?",
                               (f"org_{key}",)).fetchall()
        return o["name"], "\n".join([f"# {o['name']}", "", o["description"], "", "## Members"] +
                                    [f"- {link('character/' + m['source'], m['name'])}" for m in members])
    return None


# ------------------------------------------------------------------ public API
def get_page(conn: sqlite3.Connection, slug: str, scope: str = "canon", refresh: bool = False) -> dict[str, Any] | None:
    page = _get(conn, slug, scope)
    dynamic = slug in ("index", "log", "chronicle") or slug.startswith(("memory/", "relationship/"))
    if page and not refresh and not (dynamic and page["generated_by"] == "template"):
        return _decorate(conn, page)
    compiled = compile_page(conn, slug, scope)
    if not compiled:
        return _decorate(conn, page) if page else None
    title, content = compiled
    if page and page["generated_by"] in ("user", "llm") and not refresh:
        return _decorate(conn, page)
    page = _save(conn, slug, scope, title, content, "template", slug.split("/", 1)[0], slug.split("/", 1)[-1])
    return _decorate(conn, page)


def _decorate(conn: sqlite3.Connection, page: dict[str, Any]) -> dict[str, Any]:
    links = sorted({m.group(1) for m in LINK_RE.finditer(page["content"])})
    backlinks = [r["slug"] for r in conn.execute(
        "SELECT slug FROM wiki_pages WHERE scope=? AND content LIKE ? AND slug != ? LIMIT 50",
        (page["scope"], f"%[[{page['slug']}|%", page["slug"]))]
    return {**page, "links": links, "backlinks": backlinks}


def edit_page(conn: sqlite3.Connection, slug: str, scope: str, content: str, title: str | None = None) -> dict[str, Any]:
    cur = _get(conn, slug, scope)
    t = title or (cur["title"] if cur else slug.split("/")[-1].replace("_", " ").title())
    page = _save(conn, slug, scope, t, content, "user")
    log(conn, scope, "edit", slug, "Edited by a human")
    return _decorate(conn, page)


def delete_page(conn: sqlite3.Connection, slug: str, scope: str) -> bool:
    cur = conn.execute("DELETE FROM wiki_pages WHERE slug=? AND scope=?", (slug, scope))
    if cur.rowcount:
        log(conn, scope, "delete", slug, "Page deleted (will be recompiled on next visit)")
    return cur.rowcount > 0


def revisions(conn: sqlite3.Connection, slug: str, scope: str) -> list[dict[str, Any]]:
    p = _get(conn, slug, scope)
    if not p:
        return []
    return db.rows_to_dicts(conn.execute("SELECT id, version, author, created_at, content FROM wiki_revisions WHERE page_id=? ORDER BY version DESC",
                                         (p["id"],)).fetchall())


def list_pages(conn: sqlite3.Connection, scope: str, category: str | None = None, q: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    sql = "SELECT id, slug, title, category, version, generated_by, updated_at FROM wiki_pages WHERE scope=?"
    params: list[Any] = [scope]
    if category:
        sql += " AND category=?"
        params.append(category)
    if q:
        sql += " AND (title LIKE ? OR content LIKE ?)"
        params += [f"%{q}%", f"%{q}%"]
    return db.rows_to_dicts(conn.execute(sql + " ORDER BY updated_at DESC LIMIT ?", (*params, limit)).fetchall())


def catalog(conn: sqlite3.Connection, scope: str) -> dict[str, list[dict[str, str]]]:
    """Every page that *can* exist (compiled lazily), grouped by category."""
    cat: dict[str, list[dict[str, str]]] = {
        "character": [{"slug": f"character/{r['id']}", "title": r["name"]} for r in
                      conn.execute("SELECT id, name FROM characters ORDER BY (tier='major') DESC, (tier='supporting') DESC, line_count DESC")],
        "house": [{"slug": f"house/{h['id']}", "title": h["name"]} for h in world.HOUSES],
        "organization": [{"slug": f"organization/{o['id']}", "title": o["name"]} for o in world.ORGANIZATIONS],
        "location": [{"slug": f"location/{l['id']}", "title": l["name"]} for l in world.LOCATIONS],
        "storyline": [{"slug": f"storyline/{s['id']}", "title": s["name"]} for s in world.STORYLINES],
        "event": [{"slug": f"event/{r['id']}", "title": f"{label(r['ord'])} {r['title']}"} for r in conn.execute("SELECT id, ord, title FROM canon_events ORDER BY ord")],
        "ontology": [{"slug": f"ontology/{r['name']}", "title": r["name"]} for r in conn.execute("SELECT name FROM ontology_classes ORDER BY name")],
    }
    if scope != "canon":
        cat["plot"] = [{"slug": f"plot/{r['id']}", "title": r["title"]} for r in conn.execute(
            "SELECT id, title FROM plot_threads WHERE player_id=? ORDER BY updated_at DESC", (scope,))]
        cat["relationship"] = [{"slug": pair_slug(r["a"], r["b"]), "title": f"{r['na']} & {r['nb']}"} for r in conn.execute(
            """SELECT r.a, r.b, ca.name na, cb.name nb FROM char_relationships r JOIN characters ca ON ca.id=r.a JOIN characters cb ON cb.id=r.b
               WHERE r.player_id=? AND r.interactions > 0 AND r.a < r.b ORDER BY r.interactions DESC LIMIT 60""", (scope,))]
        cat["chronicle"] = [{"slug": "chronicle", "title": "The Chronicle"}]
    cat["meta"] = [{"slug": "index", "title": "Index"}, {"slug": "log", "title": "Log"}]
    return cat


async def regenerate(slug: str, scope: str, use_llm: bool = True) -> dict[str, Any] | None:
    """Recompile sources and let the LLM synthesise an updated page (keeps revision history)."""
    from ..game.agents import narrate

    with db.db() as conn:
        compiled = compile_page(conn, slug, scope)
        if not compiled:
            return None
        title, source = compiled
        existing = _get(conn, slug, scope)
    if not use_llm:
        with db.db() as conn:
            page = _save(conn, slug, scope, title, source, "template")
            log(conn, scope, "recompile", slug, "Recompiled from sources")
            return _decorate(conn, page)
    system = ("You maintain an encyclopedic wiki about a living Game of Thrones world. Rewrite the page in polished markdown. "
              "Keep every [[slug|Label]] link exactly as written and add more where entities are mentioned. Preserve all facts, "
              "tables of numbers and timeline labels; integrate the 'In this world' material as narrative. Never invent events.")
    prompt = f"Title: {title}\n\nSOURCE DATA (authoritative):\n{source}\n\n" + (
        f"PREVIOUS VERSION (keep human edits that do not contradict the sources):\n{existing['content'][:5000]}" if existing else "")
    text, fallback = await narrate(system, prompt[:14000], "wiki:regenerate", source)
    with db.db() as conn:
        page = _save(conn, slug, scope, title, text if not fallback else source, "llm" if not fallback else "template")
        log(conn, scope, "synthesise" if not fallback else "recompile", slug,
            "LLM synthesised page from sources" if not fallback else "No LLM available; recompiled from sources")
        return _decorate(conn, page)


def ingest(conn: sqlite3.Connection, scope: str, *, characters: list[str] | None = None, pairs: list[tuple[str, str]] | None = None,
           plots: list[str] | None = None, reason: str = "") -> list[str]:
    """Refresh affected pages after new information arrives (memories, relationships, plots)."""
    touched = []
    for cid in characters or []:
        for slug in (f"character/{cid}", f"memory/{cid}"):
            if get_page(conn, slug, scope, refresh=True):
                touched.append(slug)
    for a, b in pairs or []:
        slug = pair_slug(a, b)
        if get_page(conn, slug, scope, refresh=True):
            touched.append(slug)
    for pid in plots or []:
        slug = f"plot/{pid}"
        if get_page(conn, slug, scope, refresh=True):
            touched.append(slug)
    if scope != "canon":
        get_page(conn, "chronicle", scope, refresh=True)
    if touched:
        log(conn, scope, "ingest", touched[0], f"{reason or 'New information'} → updated {len(touched)} page(s): {', '.join(touched[:6])}")
    return touched


def lint(conn: sqlite3.Connection, scope: str) -> dict[str, Any]:
    pages = db.rows_to_dicts(conn.execute("SELECT slug, title, content, updated_at FROM wiki_pages WHERE scope=?", (scope,)).fetchall())
    known = {p["slug"] for p in pages}
    catalog_slugs = {i["slug"] for items in catalog(conn, scope).values() for i in items}
    broken, linked_to = [], set()
    for p in pages:
        for m in LINK_RE.finditer(p["content"]):
            target = m.group(1)
            linked_to.add(target)
            if target not in known and target not in catalog_slugs and not target.startswith(("relationship/", "memory/")):
                broken.append({"page": p["slug"], "link": target})
    orphans = [p["slug"] for p in pages if p["slug"] not in linked_to and p["slug"] not in ("index", "log")]
    contradictions = []
    if scope != "canon":
        ord_ = conn.execute("SELECT ord FROM players WHERE id=?", (scope,)).fetchone()
        o = ord_["ord"] if ord_ else MAX_ORD
        for p in pages:
            if p["slug"].startswith("character/"):
                cid = p["slug"].split("/", 1)[1]
                c = world_state.character(conn, cid)
                if c and not world_state.is_alive(c, world_state.state(conn, scope, cid), o) and "dead" not in p["content"].lower() \
                        and "dies" not in p["content"].lower() and "slain" not in p["content"].lower():
                    contradictions.append({"page": p["slug"], "issue": f"{c['name']} is dead in this world but the page does not say so"})
    stale = []
    for p in pages:
        if p["slug"].startswith("character/") and scope != "canon":
            cid = p["slug"].split("/", 1)[1]
            newest = conn.execute("SELECT MAX(created_at) FROM memories WHERE character_id=? AND player_id=?", (cid, scope)).fetchone()[0]
            if newest and newest > p["updated_at"]:
                stale.append(p["slug"])
    report = {"pages": len(pages), "broken_links": broken[:100], "orphans": orphans[:100], "contradictions": contradictions,
              "stale": stale[:100]}
    log(conn, scope, "lint", None, f"{len(broken)} broken links, {len(orphans)} orphans, {len(contradictions)} contradictions, {len(stale)} stale")
    return report
