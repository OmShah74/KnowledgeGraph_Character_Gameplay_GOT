"""Timeline helpers.

Every point in the show is addressed by a global episode ordinal `ord` (1..73).
Arc dictionaries use keys like "3" (season 3 episode 1) or "8.4" (season 8 episode 4)
and map to the value that becomes valid from that point on.
"""
from __future__ import annotations

from typing import Any, Mapping

EPISODES_PER_SEASON: dict[int, int] = {1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10, 7: 7, 8: 6}
MAX_ORD = sum(EPISODES_PER_SEASON.values())  # 73


def to_ord(season: int, episode: int) -> int:
    if season not in EPISODES_PER_SEASON:
        raise ValueError(f"Unknown season {season}")
    episode = max(1, min(episode, EPISODES_PER_SEASON[season]))
    return sum(EPISODES_PER_SEASON[s] for s in range(1, season)) + episode


def from_ord(ord_: int) -> tuple[int, int]:
    ord_ = max(1, min(int(ord_), MAX_ORD))
    remaining = ord_
    for s in sorted(EPISODES_PER_SEASON):
        n = EPISODES_PER_SEASON[s]
        if remaining <= n:
            return s, remaining
        remaining -= n
    return 8, 6


def label(ord_: int) -> str:
    s, e = from_ord(ord_)
    return f"S{s}E{e}"


def point(key: str | int | float) -> int:
    """'8.4' -> ord of S8E4, '3' / 3 -> ord of S3E1."""
    text = str(key).strip()
    if "." in text:
        s, e = text.split(".", 1)
        return to_ord(int(s), int(e))
    return to_ord(int(text), 1)


def resolve_arc(arcs: Mapping[str, Any] | None, ord_: int) -> Any:
    """Return the arc value active at `ord_`, or None if the arc has not begun yet."""
    if not arcs:
        return None
    best_key, best_ord = None, -1
    for key in arcs:
        p = point(key)
        if p <= ord_ and p > best_ord:
            best_key, best_ord = key, p
    return arcs[best_key] if best_key is not None else None


def arc_segments(arcs: Mapping[str, Any] | None, end_ord: int | None = None) -> list[tuple[int, int, Any]]:
    """[(from_ord, to_ord_inclusive, value), ...] sorted by time."""
    if not arcs:
        return []
    pts = sorted(((point(k), v) for k, v in arcs.items()), key=lambda x: x[0])
    last = end_ord if end_ord is not None else MAX_ORD
    out: list[tuple[int, int, Any]] = []
    for i, (p, v) in enumerate(pts):
        nxt = pts[i + 1][0] - 1 if i + 1 < len(pts) else last
        nxt = min(nxt, last)
        if nxt >= p:
            out.append((p, nxt, v))
    return out
