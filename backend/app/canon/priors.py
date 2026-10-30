"""Behavioural priors for every character.

These are *starting points*, not scripts. Each player's world copies them into
`character_states` and they drift through play: reflection, repeated patterns of player
behaviour, off-screen interactions between characters, and the passage of time.

personality: 12 dimensions on 0..1
drives:      prioritised goals ({"goal", "priority", "from"?, "to"?}) - "from"/"to" use the
             timeline point notation so a drive can be era-specific
"""
from __future__ import annotations

from typing import Any

from .timeline import point

DIMENSIONS = ["honor", "ambition", "cunning", "cruelty", "compassion", "loyalty", "piety", "courage",
              "temper", "openness", "pride", "humor"]

TRAIT_EFFECTS: dict[str, dict[str, float]] = {
    "honorable": {"honor": 0.35, "loyalty": 0.1}, "honourable": {"honor": 0.35, "loyalty": 0.1},
    "just": {"honor": 0.2, "compassion": 0.1}, "dutiful": {"loyalty": 0.25, "honor": 0.1},
    "stern": {"humor": -0.25, "temper": 0.05}, "politically naive": {"cunning": -0.3, "openness": 0.1},
    "loving father": {"compassion": 0.25}, "fiercely protective": {"loyalty": 0.25, "temper": 0.15},
    "proud": {"pride": 0.35}, "impulsive under grief": {"temper": 0.2}, "brave": {"courage": 0.35},
    "brilliant commander": {"ambition": 0.1, "cunning": 0.1}, "romantic": {"compassion": 0.15, "openness": 0.1},
    "headstrong": {"temper": 0.2, "pride": 0.1}, "courteous": {"openness": 0.2, "temper": -0.15},
    "resilient": {"courage": 0.2}, "observant": {"cunning": 0.2}, "politically astute (later)": {"cunning": 0.2},
    "guarded": {"openness": -0.3}, "fierce": {"courage": 0.2, "temper": 0.15}, "independent": {"pride": 0.1, "openness": 0.05},
    "vengeful": {"cruelty": 0.2, "temper": 0.15}, "loyal to family": {"loyalty": 0.3}, "blunt": {"humor": 0.05, "openness": 0.05},
    "resourceful": {"cunning": 0.15}, "enigmatic": {"openness": -0.2}, "detached (as the raven)": {"compassion": -0.2, "openness": -0.1},
    "all-seeing": {"cunning": 0.2}, "wild": {"temper": 0.2}, "frightened": {"courage": -0.3},
    "brooding": {"humor": -0.2}, "self-sacrificing": {"compassion": 0.2, "honor": 0.15}, "reluctant leader": {"ambition": -0.25},
    "humble": {"pride": -0.3}, "loyal": {"loyalty": 0.3}, "mysterious": {"openness": -0.2},
    "ruthless": {"cruelty": 0.25, "compassion": -0.2}, "calculating": {"cunning": 0.3, "temper": -0.15},
    "obsessed with legacy": {"ambition": 0.3, "pride": 0.2}, "contemptuous of tyrion": {"compassion": -0.1},
    "ambitious": {"ambition": 0.35}, "paranoid": {"openness": -0.35}, "vindictive": {"cruelty": 0.25, "temper": 0.15},
    "fiercely maternal": {"loyalty": 0.25}, "cruel": {"cruelty": 0.35, "compassion": -0.25},
    "arrogant (early)": {"pride": 0.25}, "witty": {"humor": 0.35}, "devoted to cersei": {"loyalty": 0.15},
    "seeking redemption": {"honor": 0.15, "compassion": 0.1}, "drinks": {"humor": 0.1, "temper": -0.05},
    "knows things": {"cunning": 0.25}, "compassionate to outcasts": {"compassion": 0.3, "openness": 0.15},
    "cynical": {"piety": -0.2, "openness": -0.1, "humor": 0.1}, "resentful of his family": {"loyalty": -0.1},
    "sadistic": {"cruelty": 0.45, "compassion": -0.4}, "cowardly": {"courage": -0.4}, "petulant": {"temper": 0.3},
    "entitled": {"pride": 0.3, "compassion": -0.1}, "gentle": {"compassion": 0.25, "temper": -0.2, "cruelty": -0.2},
    "kind": {"compassion": 0.3, "openness": 0.15, "cruelty": -0.2}, "easily swayed": {"pride": -0.1, "cunning": -0.15},
    "steady": {"temper": -0.2, "loyalty": 0.1}, "pragmatic": {"cunning": 0.15, "honor": -0.05}, "weak": {"courage": -0.2},
    "guilty": {"piety": 0.1}, "zealous (later)": {"piety": 0.3}, "boisterous": {"humor": 0.25, "openness": 0.2},
    "drunkard": {"temper": 0.1}, "lustful": {"openness": 0.1}, "nostalgic": {}, "hates targaryens": {"temper": 0.1},
    "rigid": {"honor": 0.2, "openness": -0.15, "humor": -0.2}, "humourless": {"humor": -0.35},
    "grammatically pedantic": {"pride": 0.05}, "ruthless when certain": {"cruelty": 0.15}, "charming": {"openness": 0.25, "humor": 0.15},
    "popular": {"openness": 0.15}, "bookish": {"courage": -0.05}, "zealous": {"piety": 0.35}, "cold": {"compassion": -0.2, "openness": -0.2},
    "bitter": {"temper": 0.15, "openness": -0.1}, "honest": {"honor": 0.25}, "stubborn": {"pride": 0.15},
    "skilled smith": {}, "determined": {"ambition": 0.2, "courage": 0.1}, "idealistic": {"honor": 0.15, "compassion": 0.15},
    "merciless to enemies": {"cruelty": 0.25}, "believes in destiny": {"ambition": 0.2, "piety": 0.1}, "liberator": {"compassion": 0.2},
    "abusive": {"cruelty": 0.3}, "desperate": {"temper": 0.2}, "fearsome": {"courage": 0.2}, "devoted to daenerys": {"loyalty": 0.2},
    "devoted": {"loyalty": 0.3}, "guilt-ridden": {"honor": 0.05}, "lovesick": {}, "legendary knight": {"honor": 0.2, "courage": 0.2},
    "dignified": {"pride": 0.1, "temper": -0.1}, "multilingual": {}, "calm": {"temper": -0.25}, "disciplined": {"temper": -0.2},
    "terse": {"humor": -0.15, "openness": -0.1}, "devoted to missandei": {}, "bold": {"courage": 0.25}, "boastful": {"pride": 0.25, "humor": 0.1},
    "manipulative": {"cunning": 0.35, "honor": -0.3}, "patient": {"temper": -0.25}, "obsessed with catelyn": {},
    "smiling liar": {"honor": -0.25, "openness": 0.1}, "secretive": {"openness": -0.25}, "serves the realm": {"loyalty": 0.1, "honor": 0.1},
    "eloquent": {"openness": 0.1}, "eunuch": {}, "web of little birds": {"cunning": 0.2}, "feigns frailty": {"cunning": 0.2},
    "lannister loyalist": {"loyalty": 0.15}, "lecherous": {}, "pompous": {"pride": 0.2}, "amoral": {"honor": -0.3, "compassion": -0.15},
    "curious": {"openness": 0.2}, "loyal to cersei": {"loyalty": 0.2}, "unsettlingly polite": {"temper": -0.2},
    "fanatical": {"piety": 0.4, "openness": -0.15}, "shrewd": {"cunning": 0.25}, "ascetic": {"pride": -0.2},
    "jealous": {"temper": 0.15}, "street-smart": {"cunning": 0.15}, "warm in public": {"openness": 0.2},
    "sharp-tongued": {"humor": 0.25, "temper": 0.05}, "fearless": {"courage": 0.35}, "plotting": {"cunning": 0.3},
    "dashing": {"pride": 0.15, "openness": 0.1}, "devoted to renly": {}, "passionate": {"temper": 0.15, "openness": 0.15},
    "hedonistic": {"openness": 0.2}, "charismatic": {"openness": 0.2}, "overconfident": {"pride": 0.2},
    "cautious": {"courage": -0.1, "cunning": 0.1}, "insecure": {"pride": -0.1}, "craves acceptance": {"openness": 0.1},
    "traumatized": {"courage": -0.15, "openness": -0.15}, "torn between two families": {"loyalty": -0.1},
    "irreverent": {"humor": 0.2, "piety": -0.15}, "protective of theon": {}, "capable captain": {"courage": 0.1},
    "reckless": {"courage": 0.2, "cunning": -0.05}, "murderous": {"cruelty": 0.35}, "flamboyant": {"openness": 0.15, "pride": 0.15},
    "brutal": {"cruelty": 0.2}, "afraid of fire": {}, "secretly protective": {"compassion": 0.15},
    "monstrous": {"cruelty": 0.35}, "silent (later)": {"openness": -0.3}, "obedient to cersei": {"loyalty": 0.2},
    "earnest": {"honor": 0.15, "humor": -0.05}, "self-conscious": {"pride": -0.1}, "shy": {"openness": -0.15},
    "mysteriously talented": {}, "mercenary": {"loyalty": -0.25, "honor": -0.15}, "loyal for a price": {"loyalty": -0.1},
    "moral compass": {"honor": 0.25, "compassion": 0.15}, "practical": {"cunning": 0.1}, "convinced of prophecy": {"piety": 0.3},
    "seductive": {"openness": 0.1}, "centuries old": {}, "gruff": {"humor": -0.05, "openness": -0.05}, "fair": {"honor": 0.15},
    "wise": {"cunning": 0.1, "temper": -0.15}, "blind": {}, "harsh": {"compassion": -0.2, "temper": 0.1}, "gloomy": {"humor": 0.1},
    "deadpan": {"humor": 0.2}, "free": {"pride": 0.1}, "crude": {"humor": 0.15}, "smitten with brienne": {},
    "mocking": {"humor": 0.2}, "free-spirited": {"openness": 0.2}, "silent": {"openness": -0.4}, "implacable": {"compassion": -0.4},
    "ancient": {}, "inhuman": {"compassion": -0.5}, "cryptic": {"openness": -0.15}, "prophetic": {"piety": 0.1},
    "serious": {"humor": -0.2}, "frail": {"courage": -0.05}, "superstitious": {"piety": 0.15}, "unstable": {"temper": 0.3},
    "smothering": {}, "cunning": {"cunning": 0.3}, "charming menace": {"cruelty": 0.15, "openness": 0.1},
    "psychopathic": {"cruelty": 0.4, "compassion": -0.4}, "treacherous": {"honor": -0.3, "loyalty": -0.25}, "soft-spoken": {"temper": -0.2},
    "petty": {"pride": 0.1, "temper": 0.1}, "spiteful": {"cruelty": 0.15}, "precocious": {"pride": 0.1},
    "loyal to the starks": {"loyalty": 0.3}, "impulsive": {"temper": 0.2}, "well-meaning": {"compassion": 0.1},
    "veteran": {"courage": 0.15}, "dry humour": {"humor": 0.2}, "compassionate": {"compassion": 0.3}, "outspoken": {"openness": 0.1},
    "weary": {"humor": 0.05}, "faithful": {"piety": 0.25}, "resurrected six times": {"piety": 0.1}, "drunk": {"humor": 0.1},
    "jovial": {"humor": 0.25, "openness": 0.15}, "faith rekindled": {"piety": 0.2}, "cheerful": {"humor": 0.2, "openness": 0.15},
    "baker": {}, "speaks in third person": {}, "deadly": {"courage": 0.15}, "militarist": {"courage": 0.1, "compassion": -0.1},
    "contemptuous of sam": {"compassion": -0.15}, "sceptical": {"piety": -0.1}, "learned": {}, "boisterous ": {},
    "cowardly (self-described)": {"courage": -0.15}, "brave when it matters": {"courage": 0.2}, "can only say 'hodor'": {},
    "scheming": {"cunning": 0.25}, "warlock": {"cunning": 0.1}, "diplomatic": {"openness": 0.15}, "playful": {"humor": 0.25},
    "graceful": {}, "contemptuous of jon": {"compassion": -0.1}, "dutiful ": {},
    "scarred by greyscale": {}, "resentful of jon": {"compassion": -0.05},
}

# Hand-authored drives for central characters (priors only — worlds evolve their own).
DRIVES: dict[str, list[dict[str, Any]]] = {
    "eddard_stark": [{"goal": "Protect my family and keep my honour intact", "priority": 0.95},
                     {"goal": "Uncover the truth behind Jon Arryn's death", "priority": 0.8, "from": "1.2"},
                     {"goal": "Serve Robert faithfully as Hand without becoming like the southern lords", "priority": 0.6, "from": "1.2"}],
    "catelyn_stark": [{"goal": "Keep my children alive and together", "priority": 0.95},
                      {"goal": "Find out who tried to murder Bran", "priority": 0.8, "from": "1.2", "to": "1.6"},
                      {"goal": "Trade the Kingslayer for my daughters", "priority": 0.85, "from": "2.1"}],
    "robb_stark": [{"goal": "Avenge my father and free my sisters", "priority": 0.95, "from": "1.9"},
                   {"goal": "Be a lord worthy of Winterfell", "priority": 0.7},
                   {"goal": "Hold the Northern alliance together", "priority": 0.7, "from": "2"}],
    "sansa_stark": [{"goal": "Survive the court and give nothing away", "priority": 0.9, "from": "1.9"},
                    {"goal": "Marry well and be a true lady", "priority": 0.7, "to": "1.9"},
                    {"goal": "Reclaim Winterfell and protect the North", "priority": 0.9, "from": "6"}],
    "arya_stark": [{"goal": "Learn to fight and never be helpless", "priority": 0.85},
                   {"goal": "Get home to my family", "priority": 0.8, "from": "1.9", "to": "4.10"},
                   {"goal": "Cross every name off my list", "priority": 0.85, "from": "2"}],
    "bran_stark": [{"goal": "Climb, ride and become a knight", "priority": 0.7, "to": "1.2"},
                   {"goal": "Understand my visions and find the Three-Eyed Raven", "priority": 0.85, "from": "2"},
                   {"goal": "Remember everything; prepare the living for the Night King", "priority": 0.9, "from": "6.5"}],
    "jon_snow": [{"goal": "Earn a name of my own and prove myself", "priority": 0.8, "to": "5"},
                 {"goal": "Defend the realms of men against the dead", "priority": 0.95, "from": "2.10"},
                 {"goal": "Protect my family and the North", "priority": 0.85, "from": "6"}],
    "tyrion_lannister": [{"goal": "Survive my family through wit", "priority": 0.9},
                         {"goal": "Be valued for my mind rather than mocked for my body", "priority": 0.75},
                         {"goal": "Govern well and keep the smallfolk from starving", "priority": 0.6, "from": "2"},
                         {"goal": "Put a just ruler on the throne", "priority": 0.8, "from": "5.8"}],
    "cersei_lannister": [{"goal": "Protect my children at any cost", "priority": 0.98},
                         {"goal": "Hold power in my own name", "priority": 0.9},
                         {"goal": "Destroy anyone who threatens or humiliates me", "priority": 0.8}],
    "jaime_lannister": [{"goal": "Be with Cersei and protect our children", "priority": 0.85},
                        {"goal": "Prove I am more than the Kingslayer", "priority": 0.65, "from": "3"},
                        {"goal": "Keep my word to Catelyn Stark", "priority": 0.6, "from": "3.10"}],
    "tywin_lannister": [{"goal": "Secure the Lannister legacy for a thousand years", "priority": 0.98},
                        {"goal": "Win the war at the lowest cost to House Lannister", "priority": 0.85}],
    "daenerys_targaryen": [{"goal": "Survive and protect my people", "priority": 0.85},
                           {"goal": "Reclaim the Iron Throne that is mine by right", "priority": 0.9, "from": "2"},
                           {"goal": "Break the wheel and end slavery", "priority": 0.8, "from": "3"}],
    "jorah_mormont": [{"goal": "Protect Daenerys and earn her forgiveness", "priority": 0.95},
                      {"goal": "Find a way home from exile", "priority": 0.4, "to": "1.6"}],
    "petyr_baelish": [{"goal": "Climb the ladder of chaos to the top", "priority": 0.95},
                      {"goal": "Possess what Catelyn would not give me", "priority": 0.6}],
    "varys": [{"goal": "Serve the realm and its smallfolk, not any single crown", "priority": 0.9},
              {"goal": "Know everything that happens, before it happens", "priority": 0.8}],
    "stannis_baratheon": [{"goal": "Claim the throne by right of law", "priority": 0.95},
                          {"goal": "Do my duty whatever it costs me", "priority": 0.85}],
    "davos_seaworth": [{"goal": "Serve my king honestly, even when it is unwelcome", "priority": 0.9},
                       {"goal": "Protect those who cannot protect themselves", "priority": 0.7}],
    "melisandre": [{"goal": "Find the Lord's chosen and bring the dawn", "priority": 0.95}],
    "brienne_of_tarth": [{"goal": "Keep my oaths", "priority": 0.98}, {"goal": "Be accepted as a true knight", "priority": 0.6}],
    "sandor_clegane": [{"goal": "Survive and answer to no one", "priority": 0.7}, {"goal": "Kill my brother", "priority": 0.8}],
    "theon_greyjoy": [{"goal": "Earn my father's respect and a place among the ironborn", "priority": 0.85, "to": "3"},
                      {"goal": "Atone for betraying the Starks", "priority": 0.9, "from": "5.10"}],
    "samwell_tarly": [{"goal": "Protect Gilly and the boy", "priority": 0.85, "from": "3"},
                      {"goal": "Learn what defeats the White Walkers", "priority": 0.85, "from": "3"}],
    "margaery_tyrell": [{"goal": "Become the queen", "priority": 0.9}, {"goal": "Protect my brother", "priority": 0.7}],
    "olenna_tyrell": [{"goal": "Keep House Tyrell powerful and its children safe", "priority": 0.95}],
    "ramsay_bolton": [{"goal": "Be acknowledged as true heir of the Dreadfort", "priority": 0.9},
                      {"goal": "Break whoever I can", "priority": 0.7}],
    "joffrey_baratheon": [{"goal": "Be feared and obeyed as king", "priority": 0.95}],
    "tormund_giantsbane": [{"goal": "Get the Free Folk south of the Wall alive", "priority": 0.9, "from": "5"}],
    "oberyn_martell": [{"goal": "Justice for Elia and her children", "priority": 0.98}],
    "night_king": [{"goal": "Bring the endless night", "priority": 1.0}],
    "bronn": [{"goal": "Get rich and get a castle", "priority": 0.9}, {"goal": "Stay alive", "priority": 0.85}],
    "missandei": [{"goal": "Serve Daenerys's cause of freedom", "priority": 0.9}],
    "grey_worm": [{"goal": "Protect the Queen and Missandei", "priority": 0.95}],
    "gendry": [{"goal": "Find a place where I belong", "priority": 0.7}],
    "ygritte": [{"goal": "Live free and see Jon choose the Free Folk", "priority": 0.85}],
    "euron_greyjoy": [{"goal": "Rule the seas and take a queen", "priority": 0.9}],
    "yara_greyjoy": [{"goal": "Rule the Iron Islands and protect my brother", "priority": 0.85}],
    "robert_baratheon": [{"goal": "Forget the weight of the crown", "priority": 0.7}, {"goal": "See the last Targaryens dead", "priority": 0.6}],
}

# Openness to strangers shapes the default trust a character extends to the player.
STRANGER_DISPOSITION_OVERRIDES: dict[str, float] = {
    "tyrion_lannister": 0.15, "davos_seaworth": 0.2, "samwell_tarly": 0.25, "tormund_giantsbane": 0.1,
    "cersei_lannister": -0.3, "ramsay_bolton": -0.1, "joffrey_baratheon": -0.25, "petyr_baelish": 0.1,
    "varys": 0.05, "tywin_lannister": -0.2, "stannis_baratheon": -0.15, "arya_stark": -0.15, "sandor_clegane": -0.2,
    "night_king": -1.0, "walder_frey": -0.2, "olenna_tyrell": 0.0, "eddard_stark": 0.1,
}


def personality(character: dict[str, Any]) -> dict[str, float]:
    p = {d: 0.5 for d in DIMENSIONS}
    stats = character.get("stats") or {}
    p["cunning"] += (stats.get("intrigue", 5) - 8) / 30
    p["courage"] += (stats.get("prowess", 5) - 8) / 40
    p["ambition"] += (stats.get("diplomacy", 5) - 8) / 60
    for t in character.get("traits") or []:
        for dim, delta in TRAIT_EFFECTS.get(t.lower().strip(), {}).items():
            p[dim] += delta
    if character.get("religion") in ("rhllor", "drowned_god", "many_faced_god") and character.get("tier") != "minor":
        p["piety"] += 0.1
    return {k: round(max(0.0, min(1.0, v)), 3) for k, v in p.items()}


def stranger_trust(character: dict[str, Any], pers: dict[str, float] | None = None) -> float:
    pers = pers or personality(character)
    if character["id"] in STRANGER_DISPOSITION_OVERRIDES:
        return STRANGER_DISPOSITION_OVERRIDES[character["id"]]
    return round((pers["openness"] - 0.5) * 0.6 + (pers["compassion"] - 0.5) * 0.3 - (pers["cruelty"] - 0.5) * 0.3, 3)


def default_drives(character: dict[str, Any]) -> list[dict[str, Any]]:
    if character["id"] in DRIVES:
        return DRIVES[character["id"]]
    drives = [{"goal": "Survive the turmoil of the war", "priority": 0.6}]
    if character.get("house"):
        drives.append({"goal": f"Advance the interests of House {character['house'].title()}", "priority": 0.55})
    pers = personality(character)
    if pers["ambition"] > 0.6:
        drives.append({"goal": "Rise above my station", "priority": 0.6})
    if pers["loyalty"] > 0.65:
        drives.append({"goal": "Stay true to those I serve", "priority": 0.65})
    if pers["piety"] > 0.65:
        drives.append({"goal": "Do the will of my god", "priority": 0.6})
    return drives


def active_drives(drives: list[dict[str, Any]], ord_: int) -> list[dict[str, Any]]:
    out = []
    for d in drives:
        if d.get("from") and point(d["from"]) > ord_:
            continue
        if d.get("to") and point(d["to"]) < ord_:
            continue
        out.append(d)
    return sorted(out, key=lambda d: -float(d.get("priority", 0.5)))
