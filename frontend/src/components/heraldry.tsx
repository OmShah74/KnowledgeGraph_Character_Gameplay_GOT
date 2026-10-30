import { HERALDRY } from "@/lib/heraldry-icons";
import { cn } from "@/lib/utils";

export const HOUSE_SIGIL: Record<string, { glyph: string; color: string; field: string }> = {
  stark: { glyph: "wolf-head", color: "#d6d9dd", field: "#5b6470" },
  lannister: { glyph: "lion", color: "#f2c94c", field: "#8b1c1c" },
  baratheon: { glyph: "stag-head", color: "#1a1a1a", field: "#e3b23c" },
  targaryen: { glyph: "dragon-head", color: "#c0241b", field: "#111111" },
  greyjoy: { glyph: "octopus", color: "#e8c547", field: "#1b1b1b" },
  tyrell: { glyph: "rose", color: "#f0c845", field: "#2e6b2e" },
  martell: { glyph: "sun-spear", color: "#f2c94c", field: "#c2410c" },
  tully: { glyph: "fish-escape", color: "#d9dde2", field: "#2753a6" },
  arryn: { glyph: "eagle-head", color: "#f3f4f6", field: "#3b6db3" },
  bolton: { glyph: "crowned-skull", color: "#f4c6cf", field: "#7a1f2b" },
  frey: { glyph: "tower-bridge", color: "#8aa0c4", field: "#2c3e57" },
  tarly: { glyph: "hunting-horn", color: "#e6e1d2", field: "#24572b" },
  mormont: { glyph: "bear-head", color: "#1d1d1d", field: "#3b6e3b" },
  umber: { glyph: "giant", color: "#d6d0c3", field: "#5a4a3a" },
  karstark: { glyph: "heraldic-sun", color: "#f3f4f6", field: "#1d1d1d" },
  clegane: { glyph: "hound", color: "#1d1d1d", field: "#e3b23c" },
  seaworth: { glyph: "galleon", color: "#1d1d1d", field: "#9aa3ab" },
  tarth: { glyph: "sun", color: "#f2c94c", field: "#d0679d" },
  baelish: { glyph: "hummingbird", color: "#d9dde2", field: "#3f6b2f" },
  reed: { glyph: "lizardman", color: "#1d1d1d", field: "#5a7d3a" },
  payne: { glyph: "two-coins", color: "#f2c94c", field: "#6b4ea3" },
  dondarrion: { glyph: "lightning-arc", color: "#a78bfa", field: "#111111" },
  glover: { glyph: "gauntlet", color: "#d9dde2", field: "#a3241b" },
  royce: { glyph: "rune-stone", color: "#c08a4a", field: "#3a2a1a" },
  cassel: { glyph: "broadsword", color: "#d9dde2", field: "#5b6470" },
  dayne: { glyph: "falling-star", color: "#f3f4f6", field: "#6d5ea8" },
};

export const ORG_SIGIL: Record<string, { glyph: string; color: string; field: string }> = {
  nights_watch: { glyph: "raven", color: "#d9dde2", field: "#111111" },
  free_folk: { glyph: "pine-tree", color: "#d9dde2", field: "#4b4038" },
  kingsguard: { glyph: "black-knight-helm", color: "#111111", field: "#f3f4f6" },
  small_council: { glyph: "crown", color: "#f2c94c", field: "#4c1d95" },
  faith_militant: { glyph: "seven-pointed-star", color: "#f3f4f6", field: "#57534e" },
  brotherhood_without_banners: { glyph: "lightning-tree", color: "#c4b5fd", field: "#1f1430" },
  faceless_men: { glyph: "hooded-figure", color: "#d6d3d1", field: "#0c0c0c" },
  unsullied: { glyph: "spears", color: "#e7c48a", field: "#5a3a1a" },
  dothraki: { glyph: "horse-head", color: "#f0c96a", field: "#7c4a1e" },
  second_sons: { glyph: "crossed-swords", color: "#e5e5e5", field: "#44403c" },
  iron_bank: { glyph: "coins", color: "#f2c94c", field: "#3f3f46" },
  the_citadel: { glyph: "open-book", color: "#e5e5e5", field: "#3f3f46" },
  sand_snakes: { glyph: "sand-snake", color: "#f6c453", field: "#9a3412" },
  army_of_the_dead: { glyph: "frozen-orb", color: "#a5e3ff", field: "#0b1a2a" },
  children_of_the_forest: { glyph: "deku-tree", color: "#b3121b", field: "#e9e4d8" },
  sons_of_the_harpy: { glyph: "harpy", color: "#f2c94c", field: "#1d1d1d" },
  golden_company: { glyph: "crown-coin", color: "#f2c94c", field: "#3a2a0a" },
};

export function Glyph({ name, className, color }: { name: string; className?: string; color?: string }) {
  const icon = HERALDRY[name];
  if (!icon) return null;
  return (
    <svg viewBox={`0 0 ${icon.w} ${icon.h}`} className={cn("inline-block", className)} style={{ color }} aria-hidden
      dangerouslySetInnerHTML={{ __html: icon.body }} />
  );
}

export function sigilFor(house?: string | null) {
  return (house && HOUSE_SIGIL[house]) || { glyph: "crossed-swords", color: "#e5d3a1", field: "#3f3a33" };
}

/** A heater shield bearing a house's sigil. */
export function Sigil({ house, org, size = 40, className, title }: { house?: string | null; org?: string; size?: number; className?: string; title?: string }) {
  const s = org ? ORG_SIGIL[org] ?? sigilFor(null) : sigilFor(house);
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size * 1.15 }} title={title}>
      <svg viewBox="0 0 100 115" className="absolute inset-0 h-full w-full drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]" aria-hidden>
        <defs>
          <linearGradient id={`g-${house ?? org ?? "x"}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={s.field} stopOpacity="1" />
            <stop offset="1" stopColor="#000" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        <path d="M6 6 H94 V52 C94 82 72 102 50 111 C28 102 6 82 6 52 Z" fill={s.field} />
        <path d="M6 6 H94 V52 C94 82 72 102 50 111 C28 102 6 82 6 52 Z" fill={`url(#g-${house ?? org ?? "x"})`} opacity="0.55" />
        <path d="M6 6 H94 V52 C94 82 72 102 50 111 C28 102 6 82 6 52 Z" fill="none" stroke="#d9b25f" strokeOpacity="0.75" strokeWidth="3" />
      </svg>
      <Glyph name={s.glyph} color={s.color} className="relative -mt-[12%] h-[58%] w-[58%]" />
    </span>
  );
}

/** Character seal: house shield with initials fallback for houseless characters. */
export function CharacterSeal({ name, house, size = 44, dead = false }: { name: string; house?: string | null; size?: number; dead?: boolean }) {
  if (house && HOUSE_SIGIL[house]) {
    return (
      <span className={cn("relative inline-flex", dead && "grayscale opacity-60")}>
        <Sigil house={house} size={size} title={name} />
      </span>
    );
  }
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full border border-primary/40 bg-gradient-to-br from-stone-700 to-stone-900 font-display text-primary", dead && "grayscale opacity-60")}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      title={name}
    >
      {initials}
    </span>
  );
}
