import type { Dims } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROWS: { key: keyof Dims; label: string; signed: boolean; color: string }[] = [
  { key: "trust", label: "Trust", signed: true, color: "bg-sky-400" },
  { key: "affection", label: "Affection", signed: true, color: "bg-rose-400" },
  { key: "respect", label: "Respect", signed: true, color: "bg-amber-300" },
  { key: "fear", label: "Fear", signed: false, color: "bg-violet-400" },
  { key: "familiarity", label: "Familiarity", signed: false, color: "bg-emerald-400" },
];

export function RelationshipBars({ dims, compact = false, className }: { dims: Partial<Dims>; compact?: boolean; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      {ROWS.map((r) => {
        const v = Number(dims[r.key] ?? 0);
        const pct = r.signed ? Math.abs(v) / 2 : v;
        return (
          <div key={r.key} className="flex items-center gap-2 text-[11px]">
            {!compact && <span className="w-16 shrink-0 text-muted-foreground">{r.label}</span>}
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted" title={`${r.label}: ${v.toFixed(0)}`}>
              {r.signed ? (
                <>
                  <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
                  <div
                    className={cn("absolute top-0 h-full", v >= 0 ? r.color : "bg-red-500")}
                    style={v >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
                  />
                </>
              ) : (
                <div className={cn("h-full", r.color)} style={{ width: `${Math.min(100, pct)}%` }} />
              )}
            </div>
            {!compact && <span className="w-8 shrink-0 text-right tabular-nums">{v.toFixed(0)}</span>}
          </div>
        );
      })}
    </div>
  );
}
