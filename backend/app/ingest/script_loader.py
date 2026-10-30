"""Ingest the screenplay (CSV or XLSX) into SQLite and derive character data from it.

Pipeline:
  read rows -> detect columns -> normalise speakers (aliases) -> episodes + script_lines + FTS
  -> appearances / interactions -> voice profiles -> inferred arcs for non-canon speakers
  -> canon memories (per-episode recollections + canon events)
"""
from __future__ import annotations

import csv
import math
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

from .. import db
from ..canon import characters as canon_chars
from ..canon import events as canon_events
from ..canon.timeline import EPISODES_PER_SEASON, label, point, resolve_arc, to_ord

COLUMN_SYNONYMS = {
    "season": ("season", "season_no", "season number", "s"),
    "episode": ("episode", "episode_no", "episode number", "ep", "e"),
    "title": ("episode title", "title", "episode_title", "episode name"),
    "release_date": ("release date", "air date", "airdate", "release_date", "date"),
    "speaker": ("name", "speaker", "character", "character name", "char"),
    "sentence": ("sentence", "line", "dialogue", "text", "quote", "utterance"),
}

STOPWORDS = set("""
a about above after again against all am an and any are aren't as at be because been before being below between both but by
can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't
have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is
isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out
over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then
there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll
we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you
you'd you'll you're you've your yours yourself yourselves yes oh well just know will one go get come like want us got going say
said tell think see right now never ever also may might must shall let make made take back still even way much many us thing things
""".split())

TOKEN_RE = re.compile(r"[a-zA-Z']+")


class IngestError(ValueError):
    pass


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return s or "unknown"


def _clean_text(s: Any) -> str:
    text = "" if s is None else str(s)
    return text.replace("�", "'").replace("’", "'").replace("‘", "'").strip()


def _parse_num(v: Any) -> int:
    m = re.search(r"\d+", str(v))
    if not m:
        raise IngestError(f"Cannot parse number from {v!r}")
    return int(m.group())


def read_rows(path: Path) -> list[dict[str, Any]]:
    """Read CSV or XLSX into a list of dicts keyed by original headers."""
    if not path.exists():
        raise IngestError(f"Script file not found: {path}")
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        from openpyxl import load_workbook

        wb = load_workbook(path, read_only=True, data_only=True)
        ws = wb.worksheets[0]
        it = ws.iter_rows(values_only=True)
        headers = [str(h).strip() if h is not None else "" for h in next(it)]
        rows = [dict(zip(headers, r)) for r in it if r and any(c is not None for c in r)]
        wb.close()
        return rows
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            with path.open(encoding=enc, newline="") as fh:
                return list(csv.DictReader(fh))
        except UnicodeDecodeError:
            continue
    raise IngestError("Could not decode script file")


def detect_columns(headers: Iterable[str]) -> dict[str, str]:
    lower = {h.lower().strip(): h for h in headers if h}
    mapping: dict[str, str] = {}
    for field, options in COLUMN_SYNONYMS.items():
        for opt in options:
            if opt in lower:
                mapping[field] = lower[opt]
                break
    missing = [f for f in ("season", "episode", "speaker", "sentence") if f not in mapping]
    if missing:
        raise IngestError(f"Missing required columns: {missing}. Found headers: {list(headers)}")
    return mapping


def build_alias_map() -> dict[str, str]:
    amap: dict[str, str] = {}
    for c in canon_chars.CHARACTERS:
        amap[c["id"].replace("_", " ")] = c["id"]
        amap[c["name"].lower()] = c["id"]
        for a in c["aliases"]:
            amap[a.lower().strip()] = c["id"]
    return amap


def _tokens(text: str) -> list[str]:
    return [t.lower().strip("'") for t in TOKEN_RE.findall(text) if len(t) > 2]


def ingest(path: Path, *, min_lines_for_auto_character: int = 8) -> dict[str, Any]:
    raw = read_rows(path)
    if not raw:
        raise IngestError("Script file is empty")
    cols = detect_columns(raw[0].keys())
    alias_map = build_alias_map()

    # ---------------------------------------------------------- normalise rows
    rows: list[dict[str, Any]] = []
    episode_meta: dict[int, dict[str, Any]] = {}
    for r in raw:
        try:
            season = _parse_num(r[cols["season"]])
            episode = _parse_num(r[cols["episode"]])
        except (IngestError, KeyError):
            continue
        if season not in EPISODES_PER_SEASON:
            continue
        sentence = _clean_text(r.get(cols["sentence"]))
        speaker = _clean_text(r.get(cols["speaker"])).lower()
        if not sentence or not speaker:
            continue
        o = to_ord(season, episode)
        rows.append({"ord": o, "season": season, "episode": episode, "speaker_raw": speaker, "sentence": sentence})
        meta = episode_meta.setdefault(o, {"season": season, "episode": episode, "title": "", "release_date": None})
        if "title" in cols and not meta["title"]:
            meta["title"] = _clean_text(r.get(cols["title"]))
        if "release_date" in cols and not meta["release_date"]:
            meta["release_date"] = _clean_text(r.get(cols["release_date"]))[:10] or None

    if not rows:
        raise IngestError("No usable rows found in the script file")

    speaker_counts = Counter(r["speaker_raw"] for r in rows)
    auto_chars: dict[str, dict[str, Any]] = {}
    speaker_to_id: dict[str, str | None] = {}
    for spk, n in speaker_counts.items():
        if spk in alias_map:
            speaker_to_id[spk] = alias_map[spk]
        elif spk in canon_chars.EXTRA_SPEAKERS:
            speaker_to_id[spk] = None
        elif n >= min_lines_for_auto_character:
            cid = _slug(spk)
            if cid in canon_chars.CHARACTER_INDEX:
                speaker_to_id[spk] = cid
            else:
                speaker_to_id[spk] = cid
                auto_chars.setdefault(cid, {"id": cid, "name": spk.title(), "aliases": [spk]})
        else:
            speaker_to_id[spk] = None

    line_no: dict[int, int] = defaultdict(int)
    for r in rows:
        line_no[r["ord"]] += 1
        r["line_no"] = line_no[r["ord"]]
        r["character_id"] = speaker_to_id.get(r["speaker_raw"])

    with db.db() as conn:
        _reset_script_tables(conn)
        _write_episodes(conn, episode_meta, line_no)
        conn.executemany(
            "INSERT INTO script_lines(ord,season,episode,line_no,speaker_raw,character_id,sentence) VALUES(?,?,?,?,?,?,?)",
            [(r["ord"], r["season"], r["episode"], r["line_no"], r["speaker_raw"], r["character_id"], r["sentence"]) for r in rows],
        )
        conn.execute("INSERT INTO script_fts(script_fts) VALUES('rebuild')")

        appearances, interactions = _derive_structure(rows)
        _write_characters(conn, auto_chars, appearances, interactions, rows)
        _write_priors(conn)
        conn.executemany(
            "INSERT INTO appearances(character_id, ord, lines) VALUES(?,?,?)",
            [(cid, o, n) for (cid, o), n in appearances.items()],
        )
        conn.executemany(
            "INSERT INTO interactions(a,b,season,weight) VALUES(?,?,?,?)",
            [(a, b, s, w) for (a, b, s), w in interactions.items()],
        )
        _write_canon_events(conn)
        from . import scenes as scene_builder

        n_scenes = scene_builder.build(conn)
        n_mem = _write_canon_memories(conn, rows, interactions)
        n_mem += _write_dyad_memories(conn, rows)
        db.set_meta(conn, "script_ingested", "1")
        db.set_meta(conn, "script_path", str(path))
        db.set_meta(conn, "script_rows", str(len(rows)))

    mapped = sum(1 for r in rows if r["character_id"])
    return {
        "rows": len(rows), "episodes": len(episode_meta), "speakers": len(speaker_counts),
        "mapped_lines": mapped, "unmapped_lines": len(rows) - mapped,
        "auto_characters": len(auto_chars), "canon_memories": n_mem, "scenes": n_scenes, "columns": cols,
    }


def _reset_script_tables(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM script_lines")
    conn.execute("INSERT INTO script_fts(script_fts) VALUES('delete-all')")
    conn.execute("DELETE FROM episodes")
    conn.execute("DELETE FROM appearances")
    conn.execute("DELETE FROM interactions")
    conn.execute("DELETE FROM canon_events")
    conn.execute("DELETE FROM memories WHERE player_id IS NULL AND kind IN ('canon','canon_event')")
    conn.execute("DELETE FROM characters")


def _write_episodes(conn: sqlite3.Connection, meta: dict[int, dict[str, Any]], counts: dict[int, int]) -> None:
    for o in sorted(meta):
        m = meta[o]
        conn.execute(
            "INSERT INTO episodes(ord,season,episode,title,release_date,line_count) VALUES(?,?,?,?,?,?)",
            (o, m["season"], m["episode"], m["title"] or label(o), m["release_date"], counts.get(o, 0)),
        )


def _derive_structure(rows: list[dict[str, Any]]):
    appearances: Counter = Counter()
    interactions: Counter = Counter()
    by_ep: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_ep[r["ord"]].append(r)
        if r["character_id"]:
            appearances[(r["character_id"], r["ord"])] += 1
    for o, lines in by_ep.items():
        lines.sort(key=lambda x: x["line_no"])
        for i, r in enumerate(lines):
            a = r["character_id"]
            if not a:
                continue
            for j in (1, 2):
                if i + j >= len(lines):
                    break
                b = lines[i + j]["character_id"]
                if b and b != a:
                    x, y = sorted((a, b))
                    interactions[(x, y, r["season"])] += 1
    return appearances, interactions


def _voice_profile(cid: str, lines: list[dict[str, Any]], doc_freq: Counter, n_docs: int,
                   partners: Counter, names: dict[str, str]) -> dict[str, Any]:
    per_season = Counter(l["season"] for l in lines)
    words = [len(l["sentence"].split()) for l in lines]
    tok_counter: Counter = Counter()
    for l in lines:
        tok_counter.update(t for t in _tokens(l["sentence"]) if t not in STOPWORDS)

    def distinct_score(sentence: str) -> float:
        toks = [t for t in _tokens(sentence) if t not in STOPWORDS]
        if not toks:
            return 0.0
        return sum(math.log((n_docs + 1) / (doc_freq.get(t, 0) + 1)) for t in set(toks)) / (len(toks) ** 0.5)

    candidates = [l for l in lines if 7 <= len(l["sentence"].split()) <= 40]
    candidates.sort(key=lambda l: distinct_score(l["sentence"]), reverse=True)
    picked: list[dict[str, Any]] = []
    seasons_used: Counter = Counter()
    for l in candidates:
        if seasons_used[l["season"]] >= 3:
            continue
        picked.append(l)
        seasons_used[l["season"]] += 1
        if len(picked) >= 14:
            break
    picked.sort(key=lambda l: (l["ord"], l["line_no"]))

    ngrams: Counter = Counter()
    for l in lines:
        toks = [t.lower() for t in TOKEN_RE.findall(l["sentence"])]
        for n in (2, 3):
            for k in range(len(toks) - n + 1):
                gram = toks[k:k + n]
                if all(g in STOPWORDS for g in gram):
                    continue
                ngrams[" ".join(gram)] += 1
    catch = [g for g, c in ngrams.most_common(40) if c >= 3][:10]

    return {
        "line_count": len(lines),
        "lines_per_season": {str(k): v for k, v in sorted(per_season.items())},
        "avg_words": round(sum(words) / len(words), 1) if words else 0,
        "top_words": [w for w, _ in tok_counter.most_common(25)],
        "catchphrases": catch,
        "signature_lines": [{"ord": l["ord"], "label": label(l["ord"]), "text": l["sentence"]} for l in picked],
        "top_partners": [{"id": p, "name": names.get(p, p), "weight": w} for p, w in partners.most_common(12)],
    }


def _write_characters(conn: sqlite3.Connection, auto_chars: dict[str, dict[str, Any]], appearances: Counter,
                      interactions: Counter, rows: list[dict[str, Any]]) -> None:
    lines_by_char: dict[str, list[dict[str, Any]]] = defaultdict(list)
    doc_freq: Counter = Counter()
    for r in rows:
        if r["character_id"]:
            lines_by_char[r["character_id"]].append(r)
        doc_freq.update(set(_tokens(r["sentence"])))
    n_docs = len(rows)
    partners: dict[str, Counter] = defaultdict(Counter)
    season_partners: dict[tuple[str, int], Counter] = defaultdict(Counter)
    for (a, b, s), w in interactions.items():
        partners[a][b] += w
        partners[b][a] += w
        season_partners[(a, s)][b] += w
        season_partners[(b, s)][a] += w

    names = {c["id"]: c["name"] for c in canon_chars.CHARACTERS}
    names.update({k: v["name"] for k, v in auto_chars.items()})

    first_last: dict[str, tuple[int, int]] = {}
    for (cid, o) in appearances:
        f, l = first_last.get(cid, (o, o))
        first_last[cid] = (min(f, o), max(l, o))

    # Canon characters
    for c in canon_chars.CHARACTERS:
        cid = c["id"]
        lines = lines_by_char.get(cid, [])
        voice = _voice_profile(cid, lines, doc_freq, n_docs, partners[cid], names) if lines else {}
        death_ord = 0 if (c["death"] or "").startswith("0") else (point(c["death"]) if c["death"] else None)
        fl = first_last.get(cid, (None, None))
        conn.execute(
            """INSERT INTO characters(id,name,aliases,house,gender,culture,religion,titles,tier,summary,traits,stats,arcs,
                 death_ord,death_note,killer_id,first_ord,last_ord,line_count,voice,canon)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",
            (cid, c["name"], db.dumps(c["aliases"]), c["house"], c["gender"], c["culture"], c["religion"],
             db.dumps(c["titles"]), c["tier"], c["summary"], db.dumps(c["traits"]), db.dumps(c["stats"]),
             db.dumps(c["arcs"]), death_ord, c["death_note"], c["killer"], fl[0], fl[1], len(lines), db.dumps(voice)),
        )

    # Auto characters (speakers in the script that are not in the canon roster)
    canon_arcs = {c["id"]: c["arcs"] for c in canon_chars.CHARACTERS}
    for cid, info in auto_chars.items():
        lines = lines_by_char.get(cid, [])
        if not lines:
            continue
        voice = _voice_profile(cid, lines, doc_freq, n_docs, partners[cid], names)
        arcs: dict[str, str] = {}
        first_by_season: dict[int, int] = {}
        for l in lines:
            first_by_season[l["season"]] = min(first_by_season.get(l["season"], 10_000), l["ord"])
        for s, first_o in sorted(first_by_season.items()):
            for partner, _w in season_partners[(cid, s)].most_common(5):
                arc = resolve_arc(canon_arcs.get(partner), first_o)
                if arc:
                    from ..canon.timeline import from_ord
                    ss, ee = from_ord(first_o)
                    arcs[f"{ss}.{ee}"] = arc
                    break
        fl = first_last[cid]
        tier = "minor"
        summary = (f"A figure who appears in the script from {label(fl[0])} to {label(fl[1])}, "
                   f"speaking {len(lines)} lines, most often with "
                   + ", ".join(p["name"] for p in voice["top_partners"][:3]) + ".") if voice["top_partners"] else ""
        conn.execute(
            """INSERT INTO characters(id,name,aliases,house,gender,culture,religion,titles,tier,summary,traits,stats,arcs,
                 death_ord,death_note,killer_id,first_ord,last_ord,line_count,voice,canon)
               VALUES(?,?,?,NULL,'unknown','','', '[]',?,?, '[]', ?, ?, NULL, '', NULL, ?, ?, ?, ?, 0)""",
            (cid, info["name"], db.dumps(info["aliases"]), tier, summary,
             db.dumps({"martial": 5, "diplomacy": 5, "intrigue": 5, "learning": 5, "prowess": 5}),
             db.dumps(arcs), fl[0], fl[1], len(lines), db.dumps(voice)),
        )


def _write_canon_events(conn: sqlite3.Connection) -> None:
    for e in canon_events.as_dicts():
        conn.execute(
            "INSERT INTO canon_events(id,ord,kind,title,description,location_id,participants,importance,public) VALUES(?,?,?,?,?,?,?,?,?)",
            (e["id"], e["ord"], e["kind"], e["title"], e["description"], e["location_id"],
             db.dumps(e["participants"]), e["importance"], 1 if e["public"] else 0),
        )


def _write_canon_memories(conn: sqlite3.Connection, rows: list[dict[str, Any]], interactions: Counter) -> int:
    """Seed each character's long-term memory with canon recollections."""
    names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters").fetchall()}
    titles = {r["ord"]: r["title"] for r in conn.execute("SELECT ord, title FROM episodes").fetchall()}
    by_char_ep: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    by_ep: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_ep[r["ord"]].append(r)
        if r["character_id"]:
            by_char_ep[(r["character_id"], r["ord"])].append(r)

    now = db.now_iso()
    batch: list[tuple] = []
    for (cid, o), lines in by_char_ep.items():
        if len(lines) < 3:
            continue
        lines.sort(key=lambda x: x["line_no"])
        ep_lines = sorted(by_ep[o], key=lambda x: x["line_no"])
        idx = {id(l): i for i, l in enumerate(ep_lines)}
        partners: Counter = Counter()
        for l in lines:
            i = idx[id(l)]
            for j in (i - 2, i - 1, i + 1, i + 2):
                if 0 <= j < len(ep_lines):
                    p = ep_lines[j]["character_id"]
                    if p and p != cid:
                        partners[p] += 1
        best = sorted(lines, key=lambda l: len(l["sentence"]), reverse=True)[:3]
        best.sort(key=lambda l: l["line_no"])
        who = ", ".join(names.get(p, p) for p, _ in partners.most_common(4)) or "no one of note"
        quotes = " … ".join(f'"{b["sentence"]}"' for b in best)
        content = f"{label(o)} '{titles.get(o, '')}': I spoke with {who}. I said: {quotes}"
        importance = round(min(0.9, 0.25 + len(lines) / 60), 3)
        about = [p for p, _ in partners.most_common(4)]
        batch.append((cid, None, "canon", content, importance, None, db.dumps(about), o, None, now))

    for e in canon_events.as_dicts():
        for cid in e["participants"]:
            if cid not in names:
                continue
            content = f"{label(e['ord'])} — {e['title']}: {e['description']} (I was there.)"
            others = [p for p in e["participants"] if p != cid][:6]
            batch.append((cid, None, "canon_event", content, e["importance"], None, db.dumps(others), e["ord"], None, now))

    conn.executemany(
        """INSERT INTO memories(character_id, player_id, kind, content, importance, emotion, about, ord, thread_id, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)""",
        batch,
    )
    return len(batch)


def _write_priors(conn: sqlite3.Connection) -> None:
    from ..canon import priors

    for r in conn.execute("SELECT * FROM characters").fetchall():
        c = db.row_to_dict(r)
        assert c is not None
        pers = priors.personality(c)
        conn.execute("UPDATE characters SET personality=?, drives=? WHERE id=?",
                     (db.dumps(pers), db.dumps(priors.default_drives(c)), c["id"]))


def _write_dyad_memories(conn: sqlite3.Connection, rows: list[dict[str, Any]], min_exchanges: int = 4) -> int:
    """For each pair of characters who actually talk in a season, both remember that relationship,
    grounded in a real exchange from the script. These are dyadic (counterpart_id) canon priors."""
    names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM characters").fetchall()}
    by_ep: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_ep[r["ord"]].append(r)
    exchanges: dict[tuple[str, str, int], list[tuple[dict[str, Any], dict[str, Any]]]] = defaultdict(list)
    for o, lines in by_ep.items():
        lines.sort(key=lambda x: x["line_no"])
        for i in range(len(lines) - 1):
            a, b = lines[i], lines[i + 1]
            if a["character_id"] and b["character_id"] and a["character_id"] != b["character_id"]:
                key = (*sorted((a["character_id"], b["character_id"])), a["season"])
                exchanges[key].append((a, b))  # type: ignore[index]
    now = db.now_iso()
    batch: list[tuple] = []
    for (x, y, season), pairs in exchanges.items():
        if len(pairs) < min_exchanges:
            continue
        # The most substantial exchange stands for the season's relationship.
        best = max(pairs, key=lambda p: min(len(p[0]["sentence"]), 220) + min(len(p[1]["sentence"]), 220))
        eps = sorted({p[0]["ord"] for p in pairs})
        last_ord = eps[-1]
        span = f"{label(eps[0])}" + (f"–{label(eps[-1])}" if len(eps) > 1 else "")
        exchange_txt = f'{names.get(best[0]["character_id"])}: "{best[0]["sentence"]}" / {names.get(best[1]["character_id"])}: "{best[1]["sentence"]}"'
        importance = round(min(0.85, 0.3 + len(pairs) / 80), 3)
        for me, other in ((x, y), (y, x)):
            content = (f"Season {season} ({span}): {names.get(other, other)} and I spoke {len(pairs)} times across "
                       f"{len(eps)} episode(s). One exchange I remember — {exchange_txt}")
            batch.append((me, None, "canon", content, importance, None, db.dumps([other]), other, last_ord, None, now))
    conn.executemany(
        """INSERT INTO memories(character_id, player_id, kind, content, importance, emotion, about, counterpart_id, ord,
           thread_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        batch,
    )
    return len(batch)
