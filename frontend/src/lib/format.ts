const PER_SEASON: Record<number, number> = { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10, 7: 7, 8: 6 };

export function ordLabel(ord: number | null | undefined): string {
  if (!ord || ord < 1) return "—";
  let rem = ord;
  for (let s = 1; s <= 8; s++) {
    if (rem <= PER_SEASON[s]) return `S${s}E${rem}`;
    rem -= PER_SEASON[s];
  }
  return "S8E6";
}

export function toOrd(season: number, episode: number): number {
  let o = 0;
  for (let s = 1; s < season; s++) o += PER_SEASON[s];
  return o + Math.min(episode, PER_SEASON[season] ?? 10);
}

export const episodesIn = (season: number) => PER_SEASON[season] ?? 10;

export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function dispositionColor(d: string | undefined): string {
  if (d === "friendly") return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
  if (d === "hostile") return "text-red-400 border-red-500/40 bg-red-500/10";
  return "text-amber-200 border-amber-400/30 bg-amber-400/5";
}

export function moodEmoji(m: string | null | undefined): string {
  const map: Record<string, string> = {
    calm: "😐", elated: "😄", excited: "😃", content: "🙂", relaxed: "😌", angry: "😠", furious: "😡",
    anxious: "😰", terrified: "😱", contemptuous: "😒", melancholy: "😔", grieving: "😢", neutral: "😐",
  };
  return map[m || "calm"] ?? "😐";
}

export function outcomeColor(o: string | undefined): string {
  switch (o) {
    case "critical_success": return "text-emerald-300";
    case "success": return "text-emerald-400";
    case "partial": return "text-amber-300";
    case "failure": return "text-red-400";
    case "critical_failure": return "text-red-500";
    default: return "text-muted-foreground";
  }
}

export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
