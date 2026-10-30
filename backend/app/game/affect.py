"""Emotion model: PAD (pleasure, arousal, dominance) with appraisal and decay.

Each character in each world carries an affect state. Stimuli (an insult, a gift, a detected
lie, news of a death) are appraised through the character's personality into PAD deltas.
Affect decays back toward a personality-defined baseline over time. The resulting emotion
label colours dialogue and biases decisions (an angry character is harder to persuade).
"""
from __future__ import annotations

from typing import Any

# stimulus -> base PAD delta (before personality modulation)
STIMULI: dict[str, tuple[float, float, float]] = {
    "insulted": (-0.30, 0.30, 0.10),
    "threatened": (-0.35, 0.40, -0.10),
    "flattered": (0.20, 0.10, 0.10),
    "gifted": (0.30, 0.10, 0.05),
    "helped": (0.30, 0.05, 0.05),
    "deceived_detected": (-0.25, 0.25, 0.15),
    "deceived_undetected": (0.05, 0.0, 0.0),
    "persuaded": (0.05, 0.05, -0.10),
    "resisted_persuasion": (-0.05, 0.10, 0.15),
    "attacked": (-0.50, 0.60, 0.0),
    "won_fight": (0.20, 0.30, 0.35),
    "lost_fight": (-0.40, 0.30, -0.40),
    "grief": (-0.60, -0.10, -0.30),
    "good_news": (0.30, 0.15, 0.10),
    "bad_news": (-0.25, 0.20, -0.10),
    "betrayed": (-0.55, 0.45, -0.15),
    "romance": (0.35, 0.30, 0.0),
    "respected": (0.20, 0.05, 0.20),
    "humiliated": (-0.40, 0.35, -0.40),
    "neutral": (0.0, -0.02, 0.0),
}


def clamp(v: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def baseline(p: dict[str, float]) -> dict[str, Any]:
    pl = 0.1 + (p.get("humor", .5) - .5) * 0.4 + (p.get("compassion", .5) - .5) * 0.2 - (p.get("temper", .5) - .5) * 0.2
    ar = (p.get("temper", .5) - .5) * 0.5 + (p.get("courage", .5) - .5) * 0.2
    do = (p.get("pride", .5) - .5) * 0.5 + (p.get("ambition", .5) - .5) * 0.3 + (p.get("courage", .5) - .5) * 0.3
    b = {"p": round(clamp(pl), 3), "a": round(clamp(ar), 3), "d": round(clamp(do), 3)}
    return {**b, "base": dict(b), "label": label(b["p"], b["a"], b["d"])}


def label(p: float, a: float, d: float) -> str:
    if abs(p) < 0.12 and abs(a) < 0.12:
        return "calm"
    if p >= 0:
        if a >= 0:
            return "elated" if d >= 0 else "excited"
        return "content" if d >= 0 else "relaxed"
    if a >= 0:
        if d >= 0:
            return "furious" if p < -0.45 else "angry"
        return "terrified" if p < -0.45 else "anxious"
    return "contemptuous" if d >= 0 else ("grieving" if p < -0.45 else "melancholy")


def appraise(affect: dict[str, Any], stimulus: str, personality: dict[str, float], intensity: float = 1.0) -> dict[str, Any]:
    dp, da, dd = STIMULI.get(stimulus, STIMULI["neutral"])
    temper = personality.get("temper", 0.5)
    courage = personality.get("courage", 0.5)
    pride = personality.get("pride", 0.5)
    # Personality modulation: hot tempers flare, the proud take insults harder, the brave don't cower.
    if stimulus in ("insulted", "humiliated", "deceived_detected", "betrayed"):
        da *= 0.6 + temper
        dp *= 0.6 + pride * 0.8
    if stimulus in ("threatened", "attacked"):
        dd += (courage - 0.5) * 0.6
    k = max(0.0, min(2.0, intensity))
    p = clamp(float(affect.get("p", 0)) + dp * k)
    a = clamp(float(affect.get("a", 0)) + da * k)
    d = clamp(float(affect.get("d", 0)) + dd * k)
    return {**affect, "p": round(p, 3), "a": round(a, 3), "d": round(d, 3), "label": label(p, a, d), "last": stimulus}


def decay(affect: dict[str, Any], steps: float = 1.0, rate: float = 0.35) -> dict[str, Any]:
    base = affect.get("base") or {"p": 0.0, "a": 0.0, "d": 0.0}
    f = (1 - rate) ** max(0.0, steps)
    p = base["p"] + (float(affect.get("p", 0)) - base["p"]) * f
    a = base["a"] + (float(affect.get("a", 0)) - base["a"]) * f
    d = base["d"] + (float(affect.get("d", 0)) - base["d"]) * f
    return {**affect, "p": round(p, 3), "a": round(a, 3), "d": round(d, 3), "label": label(p, a, d)}


def check_modifier(affect: dict[str, Any], intent: str) -> int:
    """How the character's current emotion shifts the difficulty of the player's social check."""
    lab = affect.get("label", "calm")
    if intent in ("persuade", "charm"):
        return {"furious": 4, "angry": 3, "contemptuous": 3, "anxious": 1, "elated": -2, "content": -1, "excited": -1}.get(lab, 0)
    if intent == "intimidate":
        return {"terrified": -4, "anxious": -2, "furious": 3, "contemptuous": 2, "elated": 1}.get(lab, 0)
    if intent == "deceive":
        return {"excited": -2, "elated": -2, "anxious": 2, "contemptuous": 1}.get(lab, 0)
    return 0
