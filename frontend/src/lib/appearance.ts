/**
 * Visual appearance of each character for the procedural 3D figures.
 * Central characters have hand-tuned presets; everyone else is derived from house,
 * gender, culture, tier and stats so that no two houses look alike.
 */
import { HOUSE_SIGIL } from "@/components/heraldry";

export type Outfit = "armor" | "plate" | "leather" | "robes" | "gown" | "furs" | "maester" | "hooded" | "kingsguard" | "rags" | "dothraki" | "priestess";
export type Hair = "short" | "long" | "braids" | "bald" | "curly" | "bun" | "wild" | "none";
export type Prop = "sword" | "needle" | "longclaw" | "staff" | "cup" | "book" | "spear" | "axe" | "bow" | "dagger" | "none";

export type Appearance = {
  height: number;       // 0.85 .. 1.25
  build: number;        // 0.8 slim .. 1.35 massive
  skin: string;
  hair: string;
  hairStyle: Hair;
  beard: boolean;
  outfit: Outfit;
  primary: string;      // tunic / dress colour
  cloak: string | null; // cloak colour
  crown?: "gold" | "iron" | "ice" | "flowers" | null;
  helm?: "hound" | "knight" | null;
  prop: Prop;
  eyes?: string;
  glow?: string;        // supernatural emissive tint (Night King, Melisandre's ruby)
};

const SKIN = { fair: "#e8c4a6", pale: "#f0d8c4", olive: "#c99a72", brown: "#9a6a48", dark: "#6b4630", ice: "#9fd3ea" };
const HAIR = { black: "#1d1714", brown: "#4a3222", auburn: "#8a3b1e", blonde: "#d8b46a", silver: "#e9e6df", grey: "#9a958d", red: "#a33b1f" };

export const PRESETS: Record<string, Partial<Appearance>> = {
  eddard_stark: { hair: HAIR.brown, hairStyle: "long", beard: true, outfit: "leather", primary: "#4a4f57", cloak: "#5b6470", prop: "sword", build: 1.1 },
  catelyn_stark: { hair: HAIR.auburn, hairStyle: "braids", outfit: "gown", primary: "#2c4a7a", cloak: "#5b6470", skin: SKIN.fair },
  robb_stark: { hair: HAIR.auburn, hairStyle: "curly", beard: true, outfit: "armor", primary: "#3e4652", cloak: "#5b6470", prop: "sword", build: 1.1 },
  sansa_stark: { hair: HAIR.red, hairStyle: "long", outfit: "gown", primary: "#3d5a8a", cloak: "#2d2f35", skin: SKIN.pale },
  arya_stark: { hair: HAIR.brown, hairStyle: "short", outfit: "leather", primary: "#4d3e2e", cloak: "#3a352e", prop: "needle", height: 0.88, build: 0.8 },
  bran_stark: { hair: HAIR.brown, hairStyle: "short", outfit: "furs", primary: "#4b4235", cloak: "#5a5045", height: 0.92, build: 0.85 },
  jon_snow: { hair: HAIR.black, hairStyle: "curly", beard: true, outfit: "furs", primary: "#1b1b1d", cloak: "#111113", prop: "longclaw", build: 1.05 },
  tyrion_lannister: { hair: HAIR.blonde, hairStyle: "short", beard: true, outfit: "leather", primary: "#7a1f1f", cloak: null, prop: "cup", height: 0.68, build: 1.05 },
  cersei_lannister: { hair: HAIR.blonde, hairStyle: "long", outfit: "gown", primary: "#8b1c1c", cloak: null, crown: "gold", prop: "cup", skin: SKIN.pale },
  jaime_lannister: { hair: HAIR.blonde, hairStyle: "short", beard: true, outfit: "kingsguard", primary: "#d7c48a", cloak: "#f2f2f2", prop: "sword", build: 1.12 },
  tywin_lannister: { hair: HAIR.grey, hairStyle: "bald", beard: true, outfit: "robes", primary: "#7a1414", cloak: "#5a0e0e", build: 1.05 },
  joffrey_baratheon: { hair: HAIR.blonde, hairStyle: "short", outfit: "robes", primary: "#7a1f1f", cloak: "#e3b23c", crown: "gold", prop: "sword", height: 0.95, build: 0.85 },
  robert_baratheon: { hair: HAIR.black, hairStyle: "short", beard: true, outfit: "leather", primary: "#5a3a1a", cloak: "#e3b23c", crown: "gold", prop: "cup", build: 1.35 },
  stannis_baratheon: { hair: HAIR.black, hairStyle: "bald", beard: true, outfit: "armor", primary: "#3a3a3a", cloak: "#c7a23a", crown: "flowers", prop: "sword" },
  renly_baratheon: { hair: HAIR.black, hairStyle: "short", outfit: "robes", primary: "#2f5a2f", cloak: "#e3b23c", crown: "gold" },
  daenerys_targaryen: { hair: HAIR.silver, hairStyle: "braids", outfit: "gown", primary: "#e9e1d0", cloak: "#2a1010", skin: SKIN.pale, eyes: "#6b4fa0", height: 0.95, build: 0.85 },
  viserys_targaryen: { hair: HAIR.silver, hairStyle: "long", outfit: "robes", primary: "#3a1a1a", cloak: null, skin: SKIN.pale, build: 0.85 },
  khal_drogo: { hair: HAIR.black, hairStyle: "braids", beard: true, outfit: "dothraki", primary: "#5a3a22", cloak: null, skin: SKIN.olive, prop: "axe", height: 1.15, build: 1.3 },
  jorah_mormont: { hair: HAIR.grey, hairStyle: "bald", beard: true, outfit: "leather", primary: "#3d4a3a", cloak: "#2e3a2a", prop: "sword", build: 1.15 },
  missandei: { hair: HAIR.black, hairStyle: "curly", outfit: "gown", primary: "#5a7a9a", skin: SKIN.dark, prop: "book", build: 0.85 },
  grey_worm: { hair: HAIR.black, hairStyle: "bald", outfit: "leather", primary: "#4a3a2a", skin: SKIN.dark, prop: "spear", helm: "knight" },
  daario_naharis: { hair: HAIR.brown, hairStyle: "long", beard: true, outfit: "leather", primary: "#2a4a5a", prop: "dagger" },
  petyr_baelish: { hair: HAIR.grey, hairStyle: "short", beard: true, outfit: "robes", primary: "#2f3a2a", cloak: "#1f2a1a", build: 0.85 },
  varys: { hair: HAIR.grey, hairStyle: "bald", outfit: "robes", primary: "#5a3a6a", cloak: "#3a2a4a", build: 1.1 },
  margaery_tyrell: { hair: HAIR.brown, hairStyle: "long", outfit: "gown", primary: "#2e7a3e", crown: "gold", skin: SKIN.fair },
  olenna_tyrell: { hair: HAIR.grey, hairStyle: "bun", outfit: "gown", primary: "#3a5a3a", height: 0.85 },
  loras_tyrell: { hair: HAIR.brown, hairStyle: "curly", outfit: "armor", primary: "#3d6a3d", cloak: "#2e6b2e", prop: "sword" },
  oberyn_martell: { hair: HAIR.black, hairStyle: "long", beard: true, outfit: "leather", primary: "#c2410c", skin: SKIN.olive, prop: "spear" },
  ellaria_sand: { hair: HAIR.black, hairStyle: "long", outfit: "gown", primary: "#b45309", skin: SKIN.olive, prop: "dagger" },
  theon_greyjoy: { hair: HAIR.brown, hairStyle: "short", beard: true, outfit: "leather", primary: "#2a2a2a", cloak: "#1b1b1b", prop: "bow" },
  yara_greyjoy: { hair: HAIR.brown, hairStyle: "short", outfit: "leather", primary: "#2a2a2a", prop: "axe" },
  euron_greyjoy: { hair: HAIR.black, hairStyle: "long", beard: true, outfit: "leather", primary: "#1b1b1b", prop: "axe" },
  sandor_clegane: { hair: HAIR.black, hairStyle: "long", beard: false, outfit: "plate", primary: "#3a3a3a", cloak: null, helm: "hound", prop: "sword", height: 1.15, build: 1.3 },
  gregor_clegane: { hair: HAIR.black, hairStyle: "short", outfit: "plate", primary: "#2a2a2a", helm: "knight", prop: "sword", height: 1.3, build: 1.4 },
  brienne_of_tarth: { hair: HAIR.blonde, hairStyle: "short", outfit: "plate", primary: "#4a6ea8", cloak: null, prop: "sword", height: 1.18, build: 1.15 },
  podrick_payne: { hair: HAIR.brown, hairStyle: "short", outfit: "leather", primary: "#4a3a2a", height: 0.95 },
  bronn: { hair: HAIR.brown, hairStyle: "short", beard: true, outfit: "leather", primary: "#5a4a3a", prop: "sword" },
  davos_seaworth: { hair: HAIR.grey, hairStyle: "short", beard: true, outfit: "leather", primary: "#4a4a3a", cloak: "#3a3a2e" },
  melisandre: { hair: HAIR.red, hairStyle: "long", outfit: "priestess", primary: "#8b0f0f", cloak: "#5a0808", glow: "#ff2a1a", skin: SKIN.pale },
  samwell_tarly: { hair: HAIR.brown, hairStyle: "short", outfit: "furs", primary: "#1b1b1d", cloak: "#111113", prop: "book", build: 1.35, height: 0.95 },
  gilly: { hair: HAIR.brown, hairStyle: "braids", outfit: "furs", primary: "#5a4a3a", height: 0.9, build: 0.85 },
  tormund_giantsbane: { hair: HAIR.red, hairStyle: "wild", beard: true, outfit: "furs", primary: "#5a4532", cloak: "#6a5642", prop: "axe", height: 1.15, build: 1.3 },
  ygritte: { hair: HAIR.red, hairStyle: "wild", outfit: "furs", primary: "#5a4a3a", prop: "bow", build: 0.85 },
  ramsay_bolton: { hair: HAIR.black, hairStyle: "short", outfit: "leather", primary: "#3a2a2e", cloak: "#7a1f2b", prop: "dagger" },
  roose_bolton: { hair: HAIR.black, hairStyle: "short", outfit: "armor", primary: "#2a2025", cloak: "#7a1f2b" },
  night_king: { hair: HAIR.silver, hairStyle: "none", outfit: "rags", primary: "#2a3a44", skin: SKIN.ice, crown: "ice", eyes: "#7fe0ff", glow: "#5ad1ff", prop: "spear", height: 1.12 },
  hodor: { hair: HAIR.brown, hairStyle: "short", beard: true, outfit: "leather", primary: "#5a4a3a", height: 1.25, build: 1.35 },
  maester_aemon: { hair: HAIR.silver, hairStyle: "bald", outfit: "maester", primary: "#1b1b1d", height: 0.9, build: 0.85 },
  pycelle: { hair: HAIR.grey, hairStyle: "bald", beard: true, outfit: "maester", primary: "#3a3a4a" },
  qyburn: { hair: HAIR.grey, hairStyle: "short", outfit: "robes", primary: "#2a2a2a", prop: "book" },
  jaqen_hghar: { hair: HAIR.red, hairStyle: "long", outfit: "hooded", primary: "#2a2a2a", prop: "dagger" },
  high_sparrow: { hair: HAIR.grey, hairStyle: "short", outfit: "rags", primary: "#8a7a62" },
  walder_frey: { hair: HAIR.grey, hairStyle: "bald", outfit: "robes", primary: "#2c3e57", height: 0.85, build: 0.8 },
  gendry: { hair: HAIR.black, hairStyle: "short", outfit: "leather", primary: "#4a3a2a", prop: "axe", build: 1.15 },
  beric_dondarrion: { hair: HAIR.blonde, hairStyle: "short", outfit: "armor", primary: "#3a2a4a", cloak: "#1f1430", prop: "sword", glow: "#ff6a00" },
  three_eyed_raven: { hair: HAIR.silver, hairStyle: "long", beard: true, outfit: "robes", primary: "#6b5a44", glow: "#9cff5a" },
};

const CULTURE_SKIN: Record<string, string> = { dornish: SKIN.olive, dothraki: SKIN.olive, naathi: SKIN.dark, valyrian: SKIN.pale, northmen: SKIN.fair, free_folk: SKIN.fair };

function seeded(id: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function appearanceFor(c: { id: string; house?: string | null; gender?: string; culture?: string; tier?: string; stats?: Record<string, number>; titles?: string[] }): Appearance {
  const r = seeded(c.id);
  const female = c.gender === "female";
  const house = c.house ? HOUSE_SIGIL[c.house] : undefined;
  const prowess = c.stats?.prowess ?? 6;
  const hairs = [HAIR.black, HAIR.brown, HAIR.brown, HAIR.auburn, HAIR.blonde, HAIR.grey];
  const isMaester = (c.titles || []).some((t) => /maester/i.test(t)) || /maester/.test(c.id);
  const base: Appearance = {
    height: female ? 0.93 + r() * 0.08 : 0.98 + r() * 0.12,
    build: Math.min(1.3, 0.85 + prowess / 40 + r() * 0.1),
    skin: CULTURE_SKIN[c.culture || ""] ?? (r() < 0.15 ? SKIN.olive : SKIN.fair),
    hair: hairs[Math.floor(r() * hairs.length)],
    hairStyle: female ? (r() < 0.5 ? "long" : "braids") : r() < 0.15 ? "bald" : r() < 0.6 ? "short" : "long",
    beard: !female && r() < 0.55,
    outfit: isMaester ? "maester" : female ? (c.tier === "minor" ? "rags" : "gown") : prowess >= 12 ? "armor" : c.house ? "leather" : "rags",
    primary: house?.field ?? "#4a4036",
    cloak: house && c.tier !== "minor" ? house.field : null,
    crown: null,
    helm: null,
    prop: !female && prowess >= 10 ? "sword" : "none",
  };
  return { ...base, ...(PRESETS[c.id] || {}) };
}

// ------------------------------------------------------------------ appearance through time
// Each entry patches the appearance from a timeline point ("season.episode") onward.
export type Era = { from: string; patch: Partial<Appearance> & { seated?: boolean; goldenHand?: boolean; scar?: boolean } };
export const ERAS: Record<string, Era[]> = {
  arya_stark: [{ from: "4", patch: { height: 0.92 } }, { from: "6", patch: { height: 0.95, hairStyle: "bun" } }, { from: "7", patch: { cloak: "#3a352e", outfit: "leather" } }],
  bran_stark: [{ from: "1.2", patch: { seated: true } }, { from: "6.5", patch: { hairStyle: "long", primary: "#3a3328" } }],
  jaime_lannister: [{ from: "3.3", patch: { prop: "none", outfit: "leather", primary: "#4a3a2a", cloak: null, beard: true, hairStyle: "long" } },
                    { from: "4", patch: { goldenHand: true, outfit: "kingsguard", cloak: "#f2f2f2", hairStyle: "short", prop: "sword" } },
                    { from: "7", patch: { outfit: "armor", primary: "#8b1c1c", cloak: "#8b1c1c" } }],
  cersei_lannister: [{ from: "5.10", patch: { hairStyle: "short", primary: "#2a2a2a" } }, { from: "6.10", patch: { crown: "gold", primary: "#151515" } }],
  daenerys_targaryen: [{ from: "1.2", patch: { outfit: "dothraki", primary: "#8a6a4a", cloak: null } }, { from: "2", patch: { outfit: "gown", primary: "#5a8ab0" } },
                       { from: "4", patch: { primary: "#c9d6e2" } }, { from: "7", patch: { primary: "#1b1b1d", cloak: "#2a0a0a" } },
                       { from: "7.6", patch: { primary: "#f2f2f2", cloak: "#e8e8e8" } }, { from: "8.4", patch: { primary: "#1b1b1d", cloak: "#5a0a0a" } }],
  sansa_stark: [{ from: "4.5", patch: { hair: "#1d1714", primary: "#2a2a2a" } }, { from: "5.3", patch: { hair: "#a33b1f" } },
                { from: "6.4", patch: { primary: "#2a2f3a", cloak: "#4a3a2a" } }, { from: "8.6", patch: { crown: "iron" } }],
  jon_snow: [{ from: "6.10", patch: { cloak: "#3a2a1e" } }, { from: "8.6", patch: { cloak: "#111113" } }],
  theon_greyjoy: [{ from: "3.7", patch: { outfit: "rags", primary: "#5a5045", hairStyle: "long", beard: true, scar: true } }, { from: "6.4", patch: { outfit: "leather", primary: "#2a2a2a" } }],
  tyrion_lannister: [{ from: "2.10", patch: { scar: true } }, { from: "6", patch: { primary: "#1b1b1d" } }],
  sandor_clegane: [{ from: "1", patch: { scar: true, helm: null } }],
  stannis_baratheon: [{ from: "2", patch: { crown: "flowers" } }],
  tommen_baratheon: [{ from: "4.5", patch: { crown: "gold" } }],
  robb_stark: [{ from: "1.10", patch: { crown: "iron" } }],
  margaery_tyrell: [{ from: "5.7", patch: { outfit: "rags", primary: "#8a7a62", crown: null } }, { from: "6.6", patch: { outfit: "gown", primary: "#e8e2d4" } }],
};

const PER_SEASON = [10, 10, 10, 10, 10, 10, 7, 6];
function eraOrd(key: string): number {
  const [s, e] = key.split(".").map(Number);
  return PER_SEASON.slice(0, s - 1).reduce((a, b) => a + b, 0) + (e || 1);
}

export type TimedAppearance = Appearance & { seated?: boolean; goldenHand?: boolean; scar?: boolean };

export function appearanceAt(c: Parameters<typeof appearanceFor>[0], ord: number): TimedAppearance {
  let a: TimedAppearance = appearanceFor(c);
  for (const era of ERAS[c.id] || []) {
    if (eraOrd(era.from) <= ord) a = { ...a, ...era.patch };
  }
  return a;
}
