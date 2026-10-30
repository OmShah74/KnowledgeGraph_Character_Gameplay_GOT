import type { Check } from "@/lib/types";

export const ARTIFACT_FOR_INTENT: Record<string, { artifact: "star" | "coin" | "blade"; name: string; deity: string }> = {
  persuade: { artifact: "star", name: "The Seven-Pointed Star", deity: "the Seven" },
  charm: { artifact: "star", name: "The Seven-Pointed Star", deity: "the Seven" },
  lore: { artifact: "star", name: "The Seven-Pointed Star", deity: "the Seven" },
  deceive: { artifact: "coin", name: "An Iron Coin of Braavos", deity: "the Many-Faced God" },
  insight: { artifact: "coin", name: "An Iron Coin of Braavos", deity: "the Many-Faced God" },
  intimidate: { artifact: "blade", name: "Valyrian Steel", deity: "the Warrior" },
  duel: { artifact: "blade", name: "Valyrian Steel", deity: "the Warrior" },
};

export const VERDICT: Record<Check["outcome"], { title: string; line: string; color: string; glow: string }> = {
  critical_success: { title: "The gods smile", line: "Fortune itself bends the knee.", color: "text-emerald-300", glow: "#59ffb0" },
  success: { title: "Fortune favours you", line: "Your words find their mark.", color: "text-emerald-400", glow: "#7dffa8" },
  partial: { title: "Half-heard prayers", line: "Swayed, but not won.", color: "text-amber-300", glow: "#ffd36b" },
  failure: { title: "The Stranger turns away", line: "They see through you.", color: "text-red-400", glow: "#ff5a4a" },
  critical_failure: { title: "Valar morghulis", line: "It backfires — badly.", color: "text-red-500", glow: "#ff1f1f" },
};

/** Static, compact verdict chip for messages already in the history. */
export function FateChip({ check }: { check: Check }) {
  const spec = ARTIFACT_FOR_INTENT[check.intent] ?? ARTIFACT_FOR_INTENT.persuade;
  const v = VERDICT[check.outcome];
  const icon = spec.artifact === "star" ? "✶" : spec.artifact === "coin" ? "◉" : "⚔";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-black/30 px-2 py-0.5 text-[11px]" title={`${spec.name}: ${check.roll}${check.modifier >= 0 ? "+" : ""}${check.modifier}=${check.total} vs ${check.dc}`}>
      <span className="text-primary">{icon}</span>
      <span className="text-muted-foreground">{check.label}</span>
      <span className="tabular-nums">{check.total}/{check.dc}</span>
      <span className={v.color}>{v.title}</span>
    </span>
  );
}
