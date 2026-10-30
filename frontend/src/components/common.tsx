"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { dispositionColor, moodEmoji } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Loading({ label = "Consulting the maesters…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-red-300">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {msg}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

export function DispositionBadge({ disposition, stance }: { disposition?: string; stance?: string }) {
  return (
    <Badge variant="outline" className={cn("capitalize", dispositionColor(disposition))}>
      {stance || disposition}
    </Badge>
  );
}

export function Mood({ mood }: { mood?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={`Mood: ${mood || "calm"}`}>
      <span aria-hidden>{moodEmoji(mood)}</span>
      <span className="capitalize">{mood || "calm"}</span>
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-card/60 px-3 py-2" title={hint}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function Meter({ value, max = 100, className }: { value: number; max?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}
