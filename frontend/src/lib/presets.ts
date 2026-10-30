/** One-click journeys: a persona, a moment in the story and a place to arrive. */
export type JourneyPreset = {
  id: string;
  title: string;
  hook: string;
  name: string;
  background: string;
  allegiance: string | null;
  season: number;
  episode: number;
  location_id: string;
  glyph: string;
};

export const PRESETS: JourneyPreset[] = [
  { id: "north", title: "A Son of the North", hook: "Winterfell, the day a deserter is judged and direwolves are found in the snow. Winter is coming.",
    name: "Torrhen Snowbrook", background: "northern_noble", allegiance: "stark", season: 1, episode: 1, location_id: "winterfell", glyph: "wolf-head" },
  { id: "court", title: "A Little Bird at Court", hook: "King's Landing. A new Hand arrives, the treasury is empty, and every whisper has a price.",
    name: "Lyra Vane", background: "little_bird", allegiance: null, season: 1, episode: 3, location_id: "kings_landing", glyph: "hooded-figure" },
  { id: "essos", title: "A Merchant of Pentos", hook: "A Targaryen princess is sold to a Dothraki khal. Fortunes will be made — and lost.",
    name: "Tarro Mopanis", background: "essosi_merchant", allegiance: null, season: 1, episode: 1, location_id: "pentos", glyph: "coins" },
  { id: "watch", title: "A Sworn Brother", hook: "Castle Black. New recruits, old grudges, and something stirring beyond the Wall.",
    name: "Edric Stone", background: "hedge_knight", allegiance: null, season: 1, episode: 3, location_id: "castle_black", glyph: "raven" },
  { id: "war", title: "A Sellsword in the War", hook: "The Riverlands burn. Kings are crowned in the North and the South. Steel is in demand.",
    name: "Harwin Blackfyre", background: "sellsword", allegiance: null, season: 2, episode: 1, location_id: "riverrun", glyph: "crossed-swords" },
  { id: "freefolk", title: "Of the Free Folk", hook: "Beyond the Wall, Mance Rayder gathers the clans. A crow walks among you.",
    name: "Asha of the Frozen Shore", background: "free_folk_raider", allegiance: null, season: 3, episode: 1, location_id: "beyond_wall", glyph: "pine-tree" },
];
