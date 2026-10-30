/** Light-weight data shared by Story Mode pages and the 3D stage (no three.js imports). */
import { appearanceFor, type TimedAppearance } from "@/lib/appearance";

export type SetId =
  | "throne_room" | "war_room" | "courtyard_snow" | "wall_yard" | "snow_forest" | "weirwood_cave" | "great_hall" | "dungeon"
  | "sea_keep" | "ruined_hall" | "tavern" | "sky_hall" | "garden" | "library" | "essos_plaza" | "dothraki_camp" | "pyramid_hall" | "ruins";

export const HOUSE_OF_LOCATION: Record<string, string> = {
  winterfell: "stark", kings_landing: "lannister", dragonstone: "targaryen", castle_black: "stark", eastwatch: "stark",
  the_dreadfort: "bolton", pyke: "greyjoy", the_twins: "frey", riverrun: "tully", the_eyrie: "arryn", casterly_rock: "lannister",
  storms_end: "baratheon", highgarden: "tyrell", horn_hill: "tarly", sunspear: "martell", water_gardens: "martell", last_hearth: "umber",
  meereen: "targaryen", harrenhal: "lannister",
};

export type StageCharacter = {
  id: string; name: string; house?: string | null; gender?: string; culture?: string; tier?: string;
  stats?: Record<string, number>; titles?: string[]; mood?: string | null; alive?: boolean;
};

export function playerAppearance(background: string, allegiance: string | null, name: string): TimedAppearance {
  const base = appearanceFor({ id: `player_${name}`, house: allegiance, tier: "major", stats: { prowess: background === "hedge_knight" || background === "sellsword" ? 14 : 8 } });
  const outfit: Record<string, TimedAppearance["outfit"]> = {
    hedge_knight: "armor", maester_acolyte: "maester", sellsword: "leather", northern_noble: "furs", little_bird: "hooded",
    essosi_merchant: "robes", free_folk_raider: "furs", red_priest: "priestess",
  };
  const prop: Record<string, TimedAppearance["prop"]> = {
    hedge_knight: "sword", sellsword: "sword", northern_noble: "sword", free_folk_raider: "axe", little_bird: "dagger",
    maester_acolyte: "book", essosi_merchant: "cup", red_priest: "staff",
  };
  return { ...base, outfit: outfit[background] ?? base.outfit, prop: prop[background] ?? base.prop, crown: null, helm: null };
}
