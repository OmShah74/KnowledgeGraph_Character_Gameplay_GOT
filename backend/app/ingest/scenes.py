"""Segment the screenplay into canon scenes.

The CSV has no scene markers, so scenes are recovered from two signals:

1. Location shift - each named speaker has a canon whereabouts at that episode (their storyline's
   location). When a line's speaker is somewhere else than the current scene, the scene changes.
2. Cast turnover - within one location, when none of the next few speakers took part in the last
   few lines, a new scene has begun (Jaime and Cersei's talk in the tower vs. Ned in the godswood).

Very short fragments (cross-cut flickers, mis-attributed lines) are merged into the surrounding
scene. Each scene records its location, ordered participants (named characters), extras (unnamed
speakers such as "guard"), line range, a title, a summary and the canon events it covers.
"""
from __future__ import annotations

import sqlite3
from collections import Counter, defaultdict
from typing import Any

from .. import db
from ..canon import world
from ..canon.timeline import label, resolve_arc

STORY_LOC = {s["id"]: s["location"] for s in world.STORYLINES}
LOC_NAME = {l["id"]: l["name"] for l in world.LOCATIONS}
WINDOW_BACK, WINDOW_FWD, MIN_SCENE, FLICKER = 6, 4, 4, 2


def _segment_episode(lines: list[dict[str, Any]], loc_of: dict[str, str | None]) -> list[list[dict[str, Any]]]:
    scenes: list[list[dict[str, Any]]] = []
    cur: list[dict[str, Any]] = []
    cur_loc: str | None = None
    for i, ln in enumerate(lines):
        loc = loc_of.get(ln["character_id"] or "")
        new_scene = False
        if cur:
            if loc and cur_loc and loc != cur_loc:
                new_scene = True
            elif len(cur) >= MIN_SCENE and ln["character_id"]:
                back = {x["character_id"] for x in cur[-WINDOW_BACK:] if x["character_id"]}
                fwd = {x["character_id"] for x in lines[i:i + WINDOW_FWD] if x["character_id"]}
                if back and fwd and not (back & fwd):
                    new_scene = True
        if new_scene:
            scenes.append(cur)
            cur = []
            cur_loc = None
        cur.append(ln)
        if loc and not cur_loc:
            cur_loc = loc
    if cur:
        scenes.append(cur)
    # Merge flickers (1-2 line fragments) into the previous scene, or the next if first.
    merged: list[list[dict[str, Any]]] = []
    for sc in scenes:
        if len(sc) <= FLICKER and merged:
            merged[-1].extend(sc)
        else:
            merged.append(sc)
    if len(merged) > 1 and len(merged[0]) <= FLICKER:
        merged[1] = merged[0] + merged[1]
        merged.pop(0)
    return merged


def build(conn: sqlite3.Connection) -> int:
    """(Re)build canon_scenes from script_lines. Returns the number of scenes."""
    chars = {r["id"]: db.row_to_dict(r) for r in conn.execute("SELECT * FROM characters")}
    names = {k: v["name"] for k, v in chars.items()}  # type: ignore[index]
    titles = {r["ord"]: r["title"] for r in conn.execute("SELECT ord, title FROM episodes")}
    events_by_ord: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for e in db.rows_to_dicts(conn.execute("SELECT * FROM canon_events").fetchall()):
        events_by_ord[e["ord"]].append(e)
    by_ep: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in conn.execute("SELECT ord, line_no, speaker_raw, character_id, sentence FROM script_lines ORDER BY ord, line_no"):
        by_ep[r["ord"]].append(dict(r))

    conn.execute("DELETE FROM canon_scenes")
    rows: list[list[Any]] = []
    for ord_, lines in sorted(by_ep.items()):
        loc_of: dict[str, str | None] = {}
        story_of: dict[str, str | None] = {}
        for cid in {l["character_id"] for l in lines if l["character_id"]}:
            c = chars.get(cid) or {}
            story = resolve_arc(c.get("arcs") or {}, ord_)
            story_of[cid] = story
            loc_of[cid] = STORY_LOC.get(story) if story else None
        for idx, sc in enumerate(_segment_episode(lines, loc_of)):
            speakers = Counter(l["character_id"] for l in sc if l["character_id"])
            participants = [cid for cid, _ in speakers.most_common()]
            extras = [s for s, _ in Counter(l["speaker_raw"] for l in sc if not l["character_id"]).most_common(4)]
            locs = Counter(loc_of.get(cid) for cid in speakers.elements() if loc_of.get(cid))
            loc = locs.most_common(1)[0][0] if locs else None
            stories = Counter(story_of.get(cid) for cid in speakers.elements() if story_of.get(cid))
            story = stories.most_common(1)[0][0] if stories else None
            cast = [names.get(c, c) for c in participants[:3]]
            place = LOC_NAME.get(loc or "", "somewhere in the realm")
            title = f"{' & '.join(cast) if cast else 'Voices'} — {place}"
            opening = next((l["sentence"] for l in sc if len(l["sentence"]) > 25), sc[0]["sentence"])
            summary = f"In “{titles.get(ord_, label(ord_))}”, {', '.join(cast) or 'voices'} at {place}: “{opening[:160]}”"
            rows.append([f"sc_{ord_:02d}_{idx:03d}", ord_, idx, loc, story, title[:200], summary[:600], participants,
                         extras, sc[0]["line_no"], sc[-1]["line_no"], len(sc), []])
    # Each canon event belongs to the single scene of its episode that best matches its cast & place.
    by_ord_rows: dict[int, list[list[Any]]] = defaultdict(list)
    for r in rows:
        by_ord_rows[r[1]].append(r)
    for ord_, evs in events_by_ord.items():
        cands = by_ord_rows.get(ord_, [])
        for e in evs:
            best, best_score = None, 0.0
            for r in cands:
                overlap = len(set(e["participants"]) & set(r[7]))
                score = overlap + (1.5 if r[3] == e["location_id"] else 0) + min(r[11], 60) / 200
                if overlap and score > best_score:
                    best, best_score = r, score
            if best is not None:
                best[12].append(e["id"])
                if len(best[12]) == 1:
                    best[6] = e["description"][:600]
    rows = [[*r[:7], db.dumps(r[7]), db.dumps(r[8]), *r[9:12], db.dumps(r[12])] for r in rows]
    conn.executemany(
        """INSERT INTO canon_scenes(id, ord, idx, location_id, storyline, title, summary, participants, extras, line_start, line_end,
           n_lines, events) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""", rows)
    db.set_meta(conn, "scenes_built", "1")
    return len(rows)


def ensure(conn: sqlite3.Connection) -> int:
    """Build scenes if they are missing (e.g. a database created before Story Mode existed)."""
    n = conn.execute("SELECT COUNT(*) FROM canon_scenes").fetchone()[0]
    if n == 0 and conn.execute("SELECT COUNT(*) FROM script_lines").fetchone()[0] > 0:
        return build(conn)
    return n
