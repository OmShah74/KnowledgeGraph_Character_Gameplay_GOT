"""RPG mechanics: backgrounds, skills, intents and d20 checks."""
from __future__ import annotations

import random
from typing import Any

SKILLS = ("persuasion", "deception", "intimidation", "insight", "combat", "lore", "stealth", "survival")

BACKGROUNDS: dict[str, dict[str, Any]] = {
    "hedge_knight": {"name": "Hedge Knight", "description": "A landless knight with a battered shield and a code.",
                     "skills": {"combat": 4, "intimidation": 2, "survival": 2, "persuasion": 1, "insight": 1},
                     "gold": 30, "health": 26, "inventory": ["longsword", "battered shield", "horse"], "reputation": {}},
    "maester_acolyte": {"name": "Acolyte of the Citadel", "description": "A scholar with half a chain and a hunger for knowledge.",
                        "skills": {"lore": 5, "insight": 3, "persuasion": 2, "stealth": 1},
                        "gold": 40, "health": 16, "inventory": ["chain links", "herbs", "ink and quill"], "reputation": {"org_the_citadel": 25}},
    "sellsword": {"name": "Sellsword", "description": "Steel for hire. Loyal to gold, mostly.",
                  "skills": {"combat": 3, "intimidation": 3, "deception": 2, "survival": 2},
                  "gold": 60, "health": 24, "inventory": ["sword", "dagger", "leather armour"], "reputation": {}},
    "northern_noble": {"name": "Northern Lordling", "description": "A younger son of a Northern house sworn to Winterfell.",
                       "skills": {"persuasion": 3, "combat": 2, "insight": 2, "survival": 2},
                       "gold": 80, "health": 22, "inventory": ["castle-forged sword", "fur cloak", "signet ring"],
                       "reputation": {"house_stark": 25, "house_bolton": -10}, "allegiance": "stark"},
    "little_bird": {"name": "Little Bird", "description": "A spy who sells whispers in the Red Keep's shadows.",
                    "skills": {"deception": 4, "stealth": 4, "insight": 3, "persuasion": 1},
                    "gold": 50, "health": 16, "inventory": ["hidden knife", "forged letters"], "reputation": {}},
    "essosi_merchant": {"name": "Essosi Merchant", "description": "A trader from Pentos with ships, contacts and coin.",
                        "skills": {"persuasion": 4, "deception": 2, "insight": 2, "lore": 1},
                        "gold": 160, "health": 16, "inventory": ["ledger", "Myrish lace", "spices"], "reputation": {"org_iron_bank": 10}},
    "free_folk_raider": {"name": "Free Folk Raider", "description": "Born beyond the Wall; kneels to no one.",
                         "skills": {"survival": 4, "combat": 3, "stealth": 2, "intimidation": 1},
                         "gold": 8, "health": 24, "inventory": ["bronze axe", "furs"], "reputation": {"org_free_folk": 30, "org_nights_watch": -15}},
    "red_priest": {"name": "Acolyte of R'hllor", "description": "A follower of the Lord of Light who sees omens in fire.",
                   "skills": {"lore": 4, "persuasion": 3, "insight": 2, "intimidation": 1},
                   "gold": 35, "health": 18, "inventory": ["red robes", "fire-blessed blade"], "reputation": {"org_brotherhood_without_banners": 10}},
}

# intent -> (player skill, character stat that opposes it, description)
INTENTS: dict[str, dict[str, Any]] = {
    "say": {"skill": None, "stat": None, "label": "Speak", "description": "Just talk; no roll."},
    "persuade": {"skill": "persuasion", "stat": "diplomacy", "label": "Persuade", "description": "Convince them with reason or appeal."},
    "deceive": {"skill": "deception", "stat": "intrigue", "label": "Deceive", "description": "Lie convincingly."},
    "intimidate": {"skill": "intimidation", "stat": "prowess", "label": "Intimidate", "description": "Threaten or pressure."},
    "charm": {"skill": "persuasion", "stat": "intrigue", "label": "Charm / Flatter", "description": "Win them over with charm."},
    "insight": {"skill": "insight", "stat": "intrigue", "label": "Read intentions", "description": "Discern what they hide."},
    "lore": {"skill": "lore", "stat": None, "label": "Recall lore", "description": "Bring up history and knowledge."},
    "gift": {"skill": None, "stat": None, "label": "Offer gold", "description": "Give gold as a gift or bribe."},
    "duel": {"skill": "combat", "stat": "prowess", "label": "Challenge / Fight", "description": "Draw steel."},
    "help": {"skill": None, "stat": None, "label": "Offer help", "description": "Volunteer to aid their cause."},
}

OUTCOMES = ("critical_failure", "failure", "partial", "success", "critical_success")


def roll_check(intent: str, player_skills: dict[str, int], char_stats: dict[str, int], *, trust: float = 0.0,
               affect_mod: int = 0, rng: random.Random | None = None, extra_mod: int = 0) -> dict[str, Any] | None:
    spec = INTENTS.get(intent)
    if not spec or spec["skill"] is None:
        return None
    rng = rng or random.Random()
    roll = rng.randint(1, 20)
    modifier = int(player_skills.get(spec["skill"], 0)) + extra_mod
    if intent in ("persuade", "charm"):
        modifier += int(trust // 25)  # existing trust makes persuasion easier
    if intent == "deceive":
        modifier -= int(max(0.0, -trust) // 30)  # suspicious people are hard to fool
    opp = int(char_stats.get(spec["stat"], 5)) if spec["stat"] else 0
    dc = 10 + opp // 2 + affect_mod
    if intent == "lore":
        dc = 12
    total = roll + modifier
    margin = total - dc
    if roll == 20:
        outcome = "critical_success"
    elif roll == 1:
        outcome = "critical_failure"
    elif margin >= 0:
        outcome = "success"
    elif margin >= -3:
        outcome = "partial"
    else:
        outcome = "failure"
    return {"intent": intent, "skill": spec["skill"], "roll": roll, "modifier": modifier, "total": total, "dc": dc,
            "margin": margin, "outcome": outcome, "label": spec["label"]}


def outcome_factor(check: dict[str, Any] | None) -> float:
    if not check:
        return 1.0
    return {"critical_failure": -1.5, "failure": -0.8, "partial": 0.3, "success": 1.0, "critical_success": 1.6}[check["outcome"]]


def duel(player_skill: int, char_prowess: int, rng: random.Random) -> dict[str, Any]:
    p = rng.randint(1, 20) + player_skill * 2
    c = rng.randint(1, 20) + char_prowess
    damage = max(1, abs(p - c) // 2 + 1)
    return {"player_total": p, "character_total": c, "winner": "player" if p >= c else "character", "damage": damage}
