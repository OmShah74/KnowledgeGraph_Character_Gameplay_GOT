"""Canonical character-to-character relationships (temporal where relevant).

Each tuple: (source, RELATION, target, valid_from | None, valid_to | None, props)
Time points use the "season[.episode]" notation from timeline.point.
"""
from __future__ import annotations

from typing import Any

Rel = tuple[str, str, str, str | None, str | None, dict[str, Any]]


def R(a: str, rel: str, b: str, frm: str | None = None, to: str | None = None, **props: Any) -> Rel:
    return (a, rel, b, frm, to, props)


STARK_KIDS = ["robb_stark", "sansa_stark", "arya_stark", "bran_stark", "rickon_stark"]
LANNISTER_KIDS = ["cersei_lannister", "jaime_lannister", "tyrion_lannister"]
ROYAL_KIDS = ["joffrey_baratheon", "myrcella_baratheon", "tommen_baratheon"]

RELATIONS: list[Rel] = []

# ---------------------------------------------------------------- family
for kid in STARK_KIDS:
    RELATIONS.append(R("eddard_stark", "PARENT_OF", kid))
    RELATIONS.append(R("catelyn_stark", "PARENT_OF", kid))
RELATIONS += [
    R("eddard_stark", "PARENT_OF", "jon_snow", None, "7.7", putative=True, note="Raised Jon as his bastard to hide his true parentage"),
    R("lyanna_stark", "PARENT_OF", "jon_snow", "6.10", None, secret=True, note="Revealed in Bran's vision at the Tower of Joy"),
    R("rhaegar_targaryen", "PARENT_OF", "jon_snow", "7.7", None, secret=True, note="Revealed by Bran and Sam: Jon is Aegon Targaryen"),
    R("rickard_stark", "PARENT_OF", "eddard_stark"), R("rickard_stark", "PARENT_OF", "benjen_stark"), R("rickard_stark", "PARENT_OF", "lyanna_stark"),
    R("eddard_stark", "SIBLING_OF", "benjen_stark"), R("eddard_stark", "SIBLING_OF", "lyanna_stark"),
]
for i, a in enumerate(STARK_KIDS):
    for b in STARK_KIDS[i + 1:]:
        RELATIONS.append(R(a, "SIBLING_OF", b))
    RELATIONS.append(R(a, "SIBLING_OF", "jon_snow", None, None, raised_as=True))

for kid in LANNISTER_KIDS:
    RELATIONS.append(R("tywin_lannister", "PARENT_OF", kid))
RELATIONS += [R("cersei_lannister", "SIBLING_OF", "jaime_lannister", twin=True), R("cersei_lannister", "SIBLING_OF", "tyrion_lannister"),
              R("jaime_lannister", "SIBLING_OF", "tyrion_lannister"), R("tywin_lannister", "SIBLING_OF", "kevan_lannister"),
              R("kevan_lannister", "PARENT_OF", "lancel_lannister"), R("kevan_lannister", "PARENT_OF", "martyn_lannister"),
              R("kevan_lannister", "PARENT_OF", "willem_lannister")]
for kid in ROYAL_KIDS:
    RELATIONS.append(R("cersei_lannister", "PARENT_OF", kid))
    RELATIONS.append(R("jaime_lannister", "PARENT_OF", kid, None, None, secret=True, note="Born of incest; Robert believed them his"))
for i, a in enumerate(ROYAL_KIDS):
    for b in ROYAL_KIDS[i + 1:]:
        RELATIONS.append(R(a, "SIBLING_OF", b))

RELATIONS += [
    R("robert_baratheon", "PARENT_OF", "gendry"),
    R("robert_baratheon", "SIBLING_OF", "stannis_baratheon"), R("robert_baratheon", "SIBLING_OF", "renly_baratheon"),
    R("stannis_baratheon", "SIBLING_OF", "renly_baratheon"),
    R("stannis_baratheon", "PARENT_OF", "shireen_baratheon"), R("selyse_baratheon", "PARENT_OF", "shireen_baratheon"),
    R("daenerys_targaryen", "SIBLING_OF", "viserys_targaryen"), R("daenerys_targaryen", "SIBLING_OF", "rhaegar_targaryen"),
    R("viserys_targaryen", "SIBLING_OF", "rhaegar_targaryen"),
    R("balon_greyjoy", "PARENT_OF", "theon_greyjoy"), R("balon_greyjoy", "PARENT_OF", "yara_greyjoy"),
    R("theon_greyjoy", "SIBLING_OF", "yara_greyjoy"), R("balon_greyjoy", "SIBLING_OF", "euron_greyjoy"),
    R("balon_greyjoy", "SIBLING_OF", "aeron_greyjoy"), R("euron_greyjoy", "SIBLING_OF", "aeron_greyjoy"),
    R("olenna_tyrell", "PARENT_OF", "mace_tyrell"), R("mace_tyrell", "PARENT_OF", "margaery_tyrell"),
    R("mace_tyrell", "PARENT_OF", "loras_tyrell"), R("margaery_tyrell", "SIBLING_OF", "loras_tyrell"),
    R("doran_martell", "SIBLING_OF", "oberyn_martell"), R("doran_martell", "PARENT_OF", "trystane_martell"),
    R("oberyn_martell", "PARENT_OF", "obara_sand"), R("oberyn_martell", "PARENT_OF", "nymeria_sand"),
    R("oberyn_martell", "PARENT_OF", "tyene_sand"), R("ellaria_sand", "PARENT_OF", "tyene_sand"),
    R("catelyn_stark", "SIBLING_OF", "lysa_arryn"), R("catelyn_stark", "SIBLING_OF", "edmure_tully"),
    R("lysa_arryn", "SIBLING_OF", "edmure_tully"), R("lysa_arryn", "PARENT_OF", "robin_arryn"),
    R("roose_bolton", "PARENT_OF", "ramsay_bolton"),
    R("walder_frey", "PARENT_OF", "black_walder"), R("walder_frey", "PARENT_OF", "lothar_frey"), R("walder_frey", "PARENT_OF", "roslin_frey"),
    R("randyll_tarly", "PARENT_OF", "samwell_tarly"), R("randyll_tarly", "PARENT_OF", "dickon_tarly"), R("randyll_tarly", "PARENT_OF", "talla_tarly"),
    R("melessa_tarly", "PARENT_OF", "samwell_tarly"), R("melessa_tarly", "PARENT_OF", "dickon_tarly"), R("melessa_tarly", "PARENT_OF", "talla_tarly"),
    R("samwell_tarly", "SIBLING_OF", "dickon_tarly"),
    R("jeor_mormont", "PARENT_OF", "jorah_mormont"),
    R("craster", "PARENT_OF", "gilly"),
    R("jojen_reed", "SIBLING_OF", "meera_reed"),
    R("davos_seaworth", "PARENT_OF", "matthos_seaworth"),
    R("sandor_clegane", "SIBLING_OF", "gregor_clegane"),
    R("maester_aemon", "RELATIVE_OF", "daenerys_targaryen", note="Great-great-uncle"),
    R("jon_snow", "RELATIVE_OF", "daenerys_targaryen", "7.7", None, secret=True, note="Aunt and nephew"),
    R("brynden_tully", "RELATIVE_OF", "catelyn_stark", note="Uncle"),
]

# ---------------------------------------------------------------- marriage, betrothal, romance
RELATIONS += [
    R("eddard_stark", "SPOUSE_OF", "catelyn_stark", None, "1.9"),
    R("robert_baratheon", "SPOUSE_OF", "cersei_lannister", None, "1.7"),
    R("stannis_baratheon", "SPOUSE_OF", "selyse_baratheon", None, "5.10"),
    R("daenerys_targaryen", "SPOUSE_OF", "khal_drogo", "1.1", "1.10"),
    R("daenerys_targaryen", "SPOUSE_OF", "hizdahr_zo_loraq", "5.7", "5.9"),
    R("robb_stark", "SPOUSE_OF", "talisa_stark", "2.10", "3.9"),
    R("tyrion_lannister", "SPOUSE_OF", "sansa_stark", "3.8", "5.3"),
    R("ramsay_bolton", "SPOUSE_OF", "sansa_stark", "5.6", "6.9"),
    R("joffrey_baratheon", "SPOUSE_OF", "margaery_tyrell", "4.2", "4.2"),
    R("tommen_baratheon", "SPOUSE_OF", "margaery_tyrell", "5.3", "6.10"),
    R("lysa_arryn", "SPOUSE_OF", "petyr_baelish", "4.5", "4.7"),
    R("roose_bolton", "SPOUSE_OF", "walda_bolton", "4", "6.2"),
    R("edmure_tully", "SPOUSE_OF", "roslin_frey", "3.9", None),
    R("joffrey_baratheon", "BETROTHED_TO", "sansa_stark", "1", "2.10"),
    R("joffrey_baratheon", "BETROTHED_TO", "margaery_tyrell", "2.10", "4.2"),
    R("robb_stark", "BETROTHED_TO", "roslin_frey", "1.9", "2.10", note="The broken Frey vow"),
    R("myrcella_baratheon", "BETROTHED_TO", "trystane_martell", "2.6", "5.10"),
    R("jaime_lannister", "LOVER_OF", "cersei_lannister", None, "8.5"),
    R("jon_snow", "LOVER_OF", "ygritte", "3.5", "4.9"),
    R("jon_snow", "LOVER_OF", "daenerys_targaryen", "7.7", "8.6"),
    R("tyrion_lannister", "LOVER_OF", "shae", "1.8", "4.6"),
    R("renly_baratheon", "LOVER_OF", "loras_tyrell", None, "2.5"),
    R("oberyn_martell", "LOVER_OF", "ellaria_sand", None, "4.8"),
    R("grey_worm", "LOVER_OF", "missandei", "7.2", "8.4"),
    R("daenerys_targaryen", "LOVER_OF", "daario_naharis", "4.4", "6.10"),
    R("arya_stark", "LOVER_OF", "gendry", "8.2", None),
    R("jaime_lannister", "LOVER_OF", "brienne_of_tarth", "8.4", "8.4"),
    R("samwell_tarly", "LOVER_OF", "gilly", "4", None),
    R("cersei_lannister", "LOVER_OF", "lancel_lannister", "1", "2.10"),
    R("ramsay_bolton", "LOVER_OF", "myranda", "3", "6.1"),
    R("loras_tyrell", "LOVER_OF", "olyvar", "4", "5.6"),
    R("tormund_giantsbane", "ADMIRES", "brienne_of_tarth", "6.4", None, note="Persistent unrequited infatuation"),
    R("jorah_mormont", "ADMIRES", "daenerys_targaryen", "1", "8.3", note="Unrequited love"),
    R("petyr_baelish", "ADMIRES", "catelyn_stark", None, "3.9", note="Lifelong obsession"),
    R("petyr_baelish", "ADMIRES", "sansa_stark", "4.3", "7.7", note="Transferred obsession"),
    R("theon_greyjoy", "WARD_OF", "eddard_stark", None, "1.9", note="Hostage-ward after Balon's rebellion"),
    R("sansa_stark", "HOSTAGE_OF", "cersei_lannister", "1.9", "4.2"),
    R("jaime_lannister", "HOSTAGE_OF", "robb_stark", "1.9", "2.10"),
    R("theon_greyjoy", "HOSTAGE_OF", "ramsay_bolton", "3", "5.10"),
    R("yara_greyjoy", "HOSTAGE_OF", "euron_greyjoy", "7.2", "7.7"),
    R("ellaria_sand", "HOSTAGE_OF", "cersei_lannister", "7.3", None),
]

# ---------------------------------------------------------------- service & oaths
RELATIONS += [
    R("brienne_of_tarth", "SWORN_TO", "renly_baratheon", "2.3", "2.5"),
    R("brienne_of_tarth", "SWORN_TO", "catelyn_stark", "2.5", "3.9"),
    R("brienne_of_tarth", "SWORN_TO", "sansa_stark", "6.4", None),
    R("podrick_payne", "SERVES", "tyrion_lannister", "2", "4.6"),
    R("podrick_payne", "SERVES", "brienne_of_tarth", "4.4", None),
    R("bronn", "SERVES", "tyrion_lannister", "1.6", "4.6"),
    R("bronn", "SERVES", "jaime_lannister", "5.2", "8.4"),
    R("sandor_clegane", "SERVES", "joffrey_baratheon", "1", "2.9"),
    R("gregor_clegane", "SERVES", "tywin_lannister", "1", "4.10"),
    R("gregor_clegane", "SERVES", "cersei_lannister", "5.10", "8.5"),
    R("qyburn", "SERVES", "cersei_lannister", "4.10", "8.5"),
    R("jorah_mormont", "SERVES", "daenerys_targaryen", "1", "4.8"),
    R("jorah_mormont", "SERVES", "daenerys_targaryen", "7.5", "8.3"),
    R("jorah_mormont", "SPIES_ON", "daenerys_targaryen", "1", "4.8", for_="varys"),
    R("barristan_selmy", "SERVES", "robert_baratheon", "1", "1.7"),
    R("barristan_selmy", "SERVES", "daenerys_targaryen", "3", "5.4"),
    R("missandei", "SERVES", "daenerys_targaryen", "3.4", "8.4"),
    R("grey_worm", "SERVES", "daenerys_targaryen", "3.4", "8.6"),
    R("daario_naharis", "SERVES", "daenerys_targaryen", "3.8", None),
    R("davos_seaworth", "SERVES", "stannis_baratheon", None, "5.10"),
    R("davos_seaworth", "SERVES", "jon_snow", "6.2", "8.6"),
    R("melisandre", "SERVES", "stannis_baratheon", "2", "5.10"),
    R("varys", "SERVES", "daenerys_targaryen", "6.1", "8.5"),
    R("tyrion_lannister", "SERVES", "daenerys_targaryen", "5.8", "8.5"),
    R("theon_greyjoy", "SERVES", "robb_stark", "1.7", "2.2"),
    R("hodor", "SERVES", "bran_stark", "1", "6.5"),
    R("pycelle", "SERVES", "tywin_lannister", "1", "4.10"),
    R("pycelle", "SERVES", "cersei_lannister", "5", "6.10"),
    R("ros", "SERVES", "petyr_baelish", "1.5", "3.6"),
    R("shae", "SERVES", "sansa_stark", "2.3", "4.3", note="Handmaiden"),
    R("osha", "SERVES", "bran_stark", "1.4", "3.5"),
    R("meera_reed", "SERVES", "bran_stark", "3", "7.4"),
    R("lyanna_mormont", "SWORN_TO", "jon_snow", "6.7", "8.3"),
    R("yohn_royce", "SWORN_TO", "sansa_stark", "6.9", None),
    R("roose_bolton", "SWORN_TO", "robb_stark", "1.8", "3.9"),
    R("walder_frey", "SWORN_TO", "robb_stark", "1.9", "3.9"),
    R("rickard_karstark", "SWORN_TO", "robb_stark", "1.8", "3.5"),
    R("greatjon_umber", "SWORN_TO", "robb_stark", "1.8", "3.9"),
    R("kevan_lannister", "SERVES", "tywin_lannister", None, "4.10"),
    R("salladhor_saan", "SERVES", "stannis_baratheon", "2", "4"),
    R("gendry", "SERVES", "daenerys_targaryen", "8.4", "8.5"),
    R("euron_greyjoy", "SERVES", "cersei_lannister", "7", "8.5"),
]

# ---------------------------------------------------------------- alliances / enmities / mentors
RELATIONS += [
    R("tyrion_lannister", "ALLY_OF", "varys", "2", "8.5"),
    R("tyrion_lannister", "ALLY_OF", "bronn", "1.6", None),
    R("tyrion_lannister", "ALLY_OF", "jaime_lannister", None, "8.5"),
    R("jon_snow", "ALLY_OF", "samwell_tarly", "1.4", None),
    R("jon_snow", "ALLY_OF", "tormund_giantsbane", "5.1", None),
    R("jon_snow", "ALLY_OF", "davos_seaworth", "5.1", None),
    R("jon_snow", "ALLY_OF", "daenerys_targaryen", "7.3", "8.6"),
    R("jon_snow", "ALLY_OF", "sansa_stark", "6.4", None),
    R("sansa_stark", "ALLY_OF", "petyr_baelish", "4.3", "7.7"),
    R("arya_stark", "ALLY_OF", "sandor_clegane", "4", "4.10"),
    R("arya_stark", "ALLY_OF", "sandor_clegane", "8.5", "8.5"),
    R("daenerys_targaryen", "ALLY_OF", "yara_greyjoy", "6.9", None),
    R("daenerys_targaryen", "ALLY_OF", "olenna_tyrell", "6.10", "7.3"),
    R("daenerys_targaryen", "ALLY_OF", "ellaria_sand", "6.10", "7.2"),
    R("stannis_baratheon", "ALLY_OF", "jon_snow", "4.10", "5.10"),
    R("cersei_lannister", "ALLY_OF", "euron_greyjoy", "7.1", "8.5"),
    R("tywin_lannister", "ALLY_OF", "walder_frey", "3", "4.10"),
    R("tywin_lannister", "ALLY_OF", "roose_bolton", "3", "4.10"),
    R("tywin_lannister", "ALLY_OF", "olenna_tyrell", "2.10", "4.10"),
    R("margaery_tyrell", "ALLY_OF", "olenna_tyrell"),
    R("varys", "ALLY_OF", "illyrio_mopatis"),
    R("brienne_of_tarth", "ALLY_OF", "jaime_lannister", "3.5", None),
    R("theon_greyjoy", "ALLY_OF", "yara_greyjoy", "6.4", None),
    R("sansa_stark", "ALLY_OF", "theon_greyjoy", "5.10", None),
    R("arya_stark", "ALLY_OF", "gendry", "2", None),
    R("bran_stark", "ALLY_OF", "meera_reed", "3", None),
    R("cersei_lannister", "ALLY_OF", "qyburn", "4.10", "8.5"),

    R("eddard_stark", "ENEMY_OF", "cersei_lannister", "1.5", "1.9"),
    R("robb_stark", "ENEMY_OF", "tywin_lannister", "1.8", "3.9"),
    R("robb_stark", "ENEMY_OF", "joffrey_baratheon", "1.9", "3.9"),
    R("stannis_baratheon", "ENEMY_OF", "joffrey_baratheon", "2", "4.2"),
    R("stannis_baratheon", "ENEMY_OF", "renly_baratheon", "2.3", "2.5"),
    R("stannis_baratheon", "ENEMY_OF", "ramsay_bolton", "5.4", "5.10"),
    R("tyrion_lannister", "ENEMY_OF", "cersei_lannister", "2", "8.5"),
    R("tyrion_lannister", "ENEMY_OF", "joffrey_baratheon", "1", "4.2"),
    R("tyrion_lannister", "ENEMY_OF", "tywin_lannister", "4.6", "4.10"),
    R("cersei_lannister", "ENEMY_OF", "margaery_tyrell", "3", "6.10"),
    R("cersei_lannister", "ENEMY_OF", "high_sparrow", "5.7", "6.10"),
    R("cersei_lannister", "ENEMY_OF", "olenna_tyrell", "6.10", "7.3"),
    R("cersei_lannister", "ENEMY_OF", "ellaria_sand", "5", None),
    R("cersei_lannister", "ENEMY_OF", "daenerys_targaryen", "6.10", "8.5"),
    R("cersei_lannister", "ENEMY_OF", "arya_stark", "1.8", "8.5"),
    R("daenerys_targaryen", "ENEMY_OF", "night_king", "7.6", "8.3"),
    R("jon_snow", "ENEMY_OF", "night_king", "5.8", "8.3"),
    R("jon_snow", "ENEMY_OF", "ramsay_bolton", "6.4", "6.9"),
    R("jon_snow", "ENEMY_OF", "alliser_thorne", "1.3", "6.3"),
    R("sansa_stark", "ENEMY_OF", "ramsay_bolton", "5.6", "6.9"),
    R("sansa_stark", "ENEMY_OF", "joffrey_baratheon", "1.9", "4.2"),
    R("sansa_stark", "ENEMY_OF", "petyr_baelish", "7.7", "7.7"),
    R("theon_greyjoy", "ENEMY_OF", "ramsay_bolton", "3", "6.9"),
    R("arya_stark", "ENEMY_OF", "walder_frey", "3.9", "6.10"),
    R("arya_stark", "ENEMY_OF", "meryn_trant", "1.8", "5.10"),
    R("arya_stark", "ENEMY_OF", "gregor_clegane", "2", "8.5"),
    R("arya_stark", "ENEMY_OF", "joffrey_baratheon", "1.2", "4.2"),
    R("arya_stark", "ENEMY_OF", "sandor_clegane", "1.2", "3.10", note="On her kill list"),
    R("arya_stark", "ENEMY_OF", "the_waif", "5.5", "6.8"),
    R("oberyn_martell", "ENEMY_OF", "gregor_clegane", "4", "4.8"),
    R("oberyn_martell", "ENEMY_OF", "tywin_lannister", "4", "4.8"),
    R("sandor_clegane", "ENEMY_OF", "gregor_clegane"),
    R("yara_greyjoy", "ENEMY_OF", "euron_greyjoy", "6.2", "8.5"),
    R("daenerys_targaryen", "ENEMY_OF", "xaro_xhoan_daxos", "2.10", "2.10"),
    R("daenerys_targaryen", "ENEMY_OF", "viserys_targaryen", "1.5", "1.6"),
    R("jaime_lannister", "ENEMY_OF", "eddard_stark", "1.5", "1.9"),
    R("petyr_baelish", "BETRAYED", "eddard_stark", "1.7", None),
    R("roose_bolton", "BETRAYED", "robb_stark", "3.9", None),
    R("walder_frey", "BETRAYED", "robb_stark", "3.9", None),
    R("theon_greyjoy", "BETRAYED", "robb_stark", "2.6", None),
    R("shae", "BETRAYED", "tyrion_lannister", "4.6", None),
    R("jorah_mormont", "BETRAYED", "daenerys_targaryen", "1", None, note="Revealed in S4E8"),
    R("varys", "BETRAYED", "daenerys_targaryen", "8.5", None),
    R("doreah", "BETRAYED", "daenerys_targaryen", "2.10", None),
    R("euron_greyjoy", "BETRAYED", "yara_greyjoy", "7.2", None),
    R("olenna_tyrell", "BETRAYED", "joffrey_baratheon", "4.2", None),
    R("jaime_lannister", "BETRAYED", "brienne_of_tarth", "8.4", None, note="Leaves her for Cersei"),

    R("syrio_forel", "MENTOR_OF", "arya_stark", "1.3", "1.8"),
    R("jaqen_hghar", "MENTOR_OF", "arya_stark", "5", "6.8"),
    R("sandor_clegane", "MENTOR_OF", "arya_stark", "4", "4.10"),
    R("three_eyed_raven", "MENTOR_OF", "bran_stark", "6.1", "6.5"),
    R("jojen_reed", "MENTOR_OF", "bran_stark", "3", "4.10"),
    R("jeor_mormont", "MENTOR_OF", "jon_snow", "1.3", "3.4"),
    R("maester_aemon", "MENTOR_OF", "samwell_tarly", "1.4", "5.7"),
    R("barristan_selmy", "MENTOR_OF", "daenerys_targaryen", "3", "5.4"),
    R("jorah_mormont", "MENTOR_OF", "daenerys_targaryen", "1", "4.8"),
    R("shireen_baratheon", "MENTOR_OF", "davos_seaworth", "3", "5.9", note="Teaches Davos to read"),
    R("olenna_tyrell", "MENTOR_OF", "margaery_tyrell"),
    R("petyr_baelish", "MENTOR_OF", "sansa_stark", "4.3", "7.7"),
    R("melisandre", "MENTOR_OF", "stannis_baratheon", "2", "5.10"),
    R("tywin_lannister", "MENTOR_OF", "arya_stark", "2.4", "2.8", note="Unknowingly takes Arya as cupbearer"),
    R("tyrion_lannister", "MENTOR_OF", "daenerys_targaryen", "6.1", "8.5"),
    R("davos_seaworth", "MENTOR_OF", "gendry", "3.6", None),
    R("bronn", "MENTOR_OF", "podrick_payne", "2", "4.6"),
]
