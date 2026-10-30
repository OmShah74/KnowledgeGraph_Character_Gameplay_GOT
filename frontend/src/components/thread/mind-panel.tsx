"use client";

import Link from "next/link";
import useSWR from "swr";
import { Brain, Ear, Link2, Target, Sparkles, Scale } from "lucide-react";
import { fetcher } from "@/lib/api";
import type { BehaviourProfile, Dims, Memory, ThreadLink } from "@/lib/types";
import { ordLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { RelationshipBars } from "@/components/relationship-bars";
import { DispositionBadge, Mood } from "@/components/common";

type Profile = BehaviourProfile & {
  character: { id: string; name: string };
  relationship: Dims & { stance: string; disposition: string };
  knows: { id: number; content: string; confidence: number; learned_from: string | null; channel: string; ord: number }[];
};

function Temperament({ prior, effective }: { prior: Record<string, number>; effective: Record<string, number> }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {Object.keys(effective).map((k) => {
        const d = effective[k] - (prior[k] ?? effective[k]);
        return (
          <div key={k} className="text-[11px]">
            <div className="flex justify-between"><span className="capitalize text-muted-foreground">{k}</span>
              <span className="tabular-nums">{effective[k].toFixed(2)}{Math.abs(d) >= 0.01 && <span className={d > 0 ? "text-emerald-400" : "text-red-400"}> {d > 0 ? "+" : ""}{d.toFixed(2)}</span>}</span>
            </div>
            <div className="relative h-1 rounded-full bg-muted">
              <div className="absolute h-1 rounded-full bg-primary/70" style={{ width: `${effective[k] * 100}%` }} />
              <div className="absolute top-[-2px] h-2 w-px bg-foreground/60" style={{ left: `${(prior[k] ?? 0) * 100}%` }} title="prior" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MindPanel({ playerId, characterId, links, names }: { playerId: string; characterId: string; links: ThreadLink[]; names: Record<string, string> }) {
  const { data: prof } = useSWR<Profile>(`/api/players/${playerId}/characters/${characterId}/profile`, fetcher, { refreshInterval: 15000 });
  const { data: mems } = useSWR<{ items: Memory[]; total: number }>(["/api/memories", { character_id: characterId, player_id: playerId, scope: "player", limit: 40 }], fetcher, { refreshInterval: 15000 });
  if (!prof) return <div className="p-4 text-xs text-muted-foreground">Reading their mind…</div>;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-display text-sm">{prof.character.name}</span>
          <DispositionBadge disposition={prof.relationship.disposition} stance={prof.relationship.stance} />
        </div>
        <RelationshipBars dims={prof.relationship} />
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <Mood mood={prof.mood} />
          <span>stress {(Number(prof.stress) * 100).toFixed(0)}%</span>
        </div>
      </div>
      <Tabs defaultValue="memory">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="memory" className="text-xs"><Brain className="size-3.5" /></TabsTrigger>
          <TabsTrigger value="mind" className="text-xs"><Target className="size-3.5" /></TabsTrigger>
          <TabsTrigger value="knows" className="text-xs"><Ear className="size-3.5" /></TabsTrigger>
          <TabsTrigger value="links" className="text-xs"><Link2 className="size-3.5" /></TabsTrigger>
        </TabsList>
        <TabsContent value="memory">
          <div className="mb-2 text-[11px] text-muted-foreground">What {prof.character.name} remembers of you and this world ({mems?.total ?? 0})</div>
          <ScrollArea className="h-[360px] pr-2">
            <ul className="space-y-2">
              {mems?.items.map((m) => (
                <li key={m.id} className="rounded-md border border-border bg-black/20 p-2 text-xs">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">{m.kind}</Badge>
                    <span>{ordLabel(m.ord)}</span>
                    {m.emotion && <span>· {m.emotion}</span>}
                    <span className="ml-auto">★ {m.importance.toFixed(2)}</span>
                  </div>
                  {m.content}
                </li>
              ))}
              {!mems?.items.length && <li className="text-xs text-muted-foreground">Nothing yet. Every exchange becomes a memory.</li>}
            </ul>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="mind" className="space-y-3">
          <div>
            <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground"><Target className="size-3" /> Goals</div>
            <ul className="space-y-1 text-xs">{prof.goals.slice(0, 5).map((g) => <li key={g.goal} className="flex justify-between gap-2"><span>{g.goal}</span><span className="shrink-0 text-muted-foreground">{g.source ?? "prior"}</span></li>)}</ul>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground"><Sparkles className="size-3" /> Learned in your world</div>
            {prof.learned.length ? (
              <ul className="space-y-1 text-xs">{prof.learned.slice().reverse().map((l) => <li key={l.rule} className="rounded border border-amber-400/20 bg-amber-500/5 px-2 py-1">{l.rule} <span className="text-[10px] text-muted-foreground">({ordLabel(l.ord)})</span></li>)}</ul>
            ) : <p className="text-xs text-muted-foreground">Nothing yet — patterns in how you treat them will teach them.</p>}
          </div>
          {prof.beliefs.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Beliefs</div>
              <ul className="space-y-1 text-xs">{prof.beliefs.map((b) => <li key={b.belief}>{b.belief} <span className="text-muted-foreground">({Math.round(b.confidence * 100)}%)</span></li>)}</ul>
            </div>
          )}
          <div>
            <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground"><Scale className="size-3" /> Temperament (bar) vs prior (tick)</div>
            <Temperament prior={prof.prior} effective={prof.effective} />
          </div>
        </TabsContent>
        <TabsContent value="knows">
          <div className="mb-2 text-[11px] text-muted-foreground">Facts and rumours they hold, and where they heard them</div>
          <ul className="space-y-2">
            {prof.knows.map((f) => (
              <li key={f.id} className="rounded-md border border-border p-2 text-xs">
                {f.content}
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {f.channel} {f.learned_from ? `from ${f.learned_from === "player" ? "you" : names[f.learned_from] ?? f.learned_from}` : ""} · believed {Math.round(f.confidence * 100)}%
                </div>
              </li>
            ))}
            {!prof.knows.length && <li className="text-xs text-muted-foreground">They hold no rumours from this world yet.</li>}
          </ul>
        </TabsContent>
        <TabsContent value="links">
          <div className="mb-2 text-[11px] text-muted-foreground">How this conversation is woven into others</div>
          <ul className="space-y-1.5 text-xs">
            {links.map((l) => (
              <li key={l.id} className={cn("rounded-md border border-border px-2 py-1.5")}>
                <span className="text-primary">{l.relation.replace("_", " ")}</span>{" "}
                {l.to_kind === "thread" ? <Link className="underline" href={`/play/thread/${l.to_id}`}>an earlier conversation</Link>
                  : l.to_kind === "plot" ? <Link className="underline" href={`/wiki?slug=${encodeURIComponent(`plot/${l.to_id}`)}&scope=${playerId}`}>{l.note || "a plot"}</Link>
                  : <Link className="underline" href={`/characters/${l.to_id}`} prefetch={false}>{names[l.to_id] ?? l.to_id}</Link>}
                {l.note && l.to_kind !== "plot" && <div className="text-[10px] text-muted-foreground">{l.note}</div>}
              </li>
            ))}
            {!links.length && <li className="text-muted-foreground">No links yet. Mention other people, or speak with characters entangled in plots.</li>}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  );
}
