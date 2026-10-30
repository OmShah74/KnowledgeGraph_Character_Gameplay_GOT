"use client";

import { CheckCircle2, Circle, CircleDot, Ghost, MapPin, PlayCircle, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";

export type SceneCard = {
  id: string; ord: number; idx: number; title: string; summary: string; location_id: string | null; location_name: string; set: string;
  participants: { id: string; name: string; alive: boolean }[]; extras: string[]; n_lines: number; events: string[];
  status: "unseen" | "in_progress" | "completed" | "skipped" | "lost"; beat_index: number; thread_id: string | null; here: boolean; diverged: boolean;
};

const ICON = { unseen: Circle, in_progress: CircleDot, completed: CheckCircle2, skipped: SkipForward, lost: Ghost };

export function SceneRail({ scenes, activeId, onPlay }: { scenes: SceneCard[]; activeId: string | null; onPlay: (id: string) => void }) {
  return (
    <ol className="space-y-1.5">
      {scenes.map((s, i) => {
        const Icon = ICON[s.status] ?? Circle;
        const active = s.id === activeId;
        return (
          <li key={s.id}>
            <button
              onClick={() => s.status !== "lost" && onPlay(s.id)}
              disabled={s.status === "lost"}
              className={cn("w-full rounded-lg border px-3 py-2 text-left transition-colors",
                active ? "border-primary bg-primary/15" : "border-border/70 bg-black/40 hover:border-primary/40",
                s.status === "lost" && "opacity-50")}
            >
              <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[11px] text-muted-foreground">
                <Icon className={cn("size-3.5 shrink-0", s.status === "completed" ? "text-emerald-400" : active ? "text-primary" : "")} />
                <span className="shrink-0">Scene {i + 1}</span>
                <span className="flex min-w-0 items-center gap-0.5"><MapPin className="size-3 shrink-0" /><span className="truncate">{s.location_name}</span></span>
                {s.events.length > 0 && <span className="shrink-0 rounded bg-amber-400/15 px-1 text-amber-200">key</span>}
                {s.diverged && <span className="shrink-0 rounded bg-sky-400/15 px-1 text-sky-300">changed</span>}
                {active && <PlayCircle className="ml-auto size-3.5 text-primary" />}
              </div>
              <div className="mt-0.5 line-clamp-1 text-xs font-medium">{s.participants.slice(0, 3).map((p) => p.name).join(", ") || "Voices"}</div>
              {active && <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{s.summary}</p>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
