"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { BookOpen, Feather, History, MapPin, Quote, Skull, Sparkles, Swords, Users } from "lucide-react";
import { fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import type { CharacterDetail, Player } from "@/lib/types";
import { ordLabel, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { CharacterSeal, Sigil } from "@/components/heraldry";
import { DispositionBadge, ErrorBox, Loading, Meter, Mood } from "@/components/common";
import { Markdown } from "@/components/markdown";
import { RelationshipBars } from "@/components/relationship-bars";
import { MemoryManager } from "@/components/memory-manager";
import { ForceGraph, type FGLink, type FGNode } from "@/components/force-graph";
import { CharacterStage } from "@/components/three/lazy";
import type { Reaction } from "@/components/three/character-figure";

type Line = { id: number; ord: number; label: string; sentence: string; line_no: number };

function Lines({ id }: { id: string }) {
  const [q, setQ] = useState("");
  const [season, setSeason] = useState<number | null>(null);
  const { data } = useSWR<{ items: Line[]; total: number }>(["/api/characters/" + id + "/lines", { q: q || undefined, season: season ?? undefined, limit: 150 }], fetcher, { keepPreviousData: true });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search their words…" className="max-w-xs" />
        {[null, 1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
          <Button key={String(s)} size="sm" variant={season === s ? "default" : "outline"} onClick={() => setSeason(s)}>{s ? `S${s}` : "All"}</Button>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">{data?.total ?? 0} lines</div>
      <ul className="space-y-1.5">
        {data?.items.map((l) => (
          <li key={l.id} className="flex gap-3 rounded-md border border-border/60 bg-black/20 px-3 py-2 text-sm">
            <span className="w-14 shrink-0 font-mono text-[11px] text-primary">{l.label}</span>
            <span>{l.sentence}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CharacterPage() {
  const { id } = useParams<{ id: string }>();
  const { playerId } = usePlayer();
  const { data: players } = useSWR<Player[]>("/api/players", fetcher);
  const player = players?.find((p) => p.id === playerId);
  const [ordOverride, setOrd] = useState<number | null>(null);
  const ord = ordOverride ?? player?.ord ?? 73;
  const { data: c, error } = useSWR<CharacterDetail>([`/api/characters/${id}`, { ord, player_id: playerId ?? undefined }], fetcher, { keepPreviousData: true });
  const [reaction, setReaction] = useState<Reaction>(null);

  const graph = useMemo(() => {
    if (!c) return { nodes: [] as FGNode[], links: [] as FGLink[] };
    const nodes: FGNode[] = [{ id: c.id, name: c.name, group: "self", color: "#ffd36b", size: 9 }];
    const links: FGLink[] = [];
    for (const n of c.network) {
      nodes.push({ id: n.id, name: n.name, group: n.disposition, color: n.disposition === "friendly" ? "#34d399" : n.disposition === "hostile" ? "#f87171" : "#e5d3a1", size: 5 });
      links.push({ source: c.id, target: n.id, type: n.stance, color: n.disposition === "friendly" ? "rgba(52,211,153,0.5)" : n.disposition === "hostile" ? "rgba(248,113,113,0.5)" : "rgba(229,211,161,0.3)" });
    }
    return { nodes, links };
  }, [c]);

  if (error) return <ErrorBox error={error} />;
  if (!c) return <Loading label="Summoning the character…" />;

  const dead = !c.alive;
  const stats = Object.entries(c.stats || {});
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* ------------------------------------------------ header */}
      <div className="flex flex-wrap items-start gap-4">
        <CharacterSeal name={c.name} house={c.house} size={64} dead={dead} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl text-primary">{c.name}</h1>
            {dead && <Badge variant="destructive"><Skull className="size-3" /> dead by {c.label}</Badge>}
            {c.persona.has_hand_written && <Badge variant="outline" className="border-primary/40 text-primary"><Feather className="size-3" /> hand-written persona</Badge>}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{c.titles_now.join(" · ") || (c.house ? `of House ${titleCase(c.house)}` : titleCase(c.tier))}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {c.house && <Link href={`/wiki?slug=house/${c.house}`}><Badge variant="secondary" className="gap-1"><Sigil house={c.house} size={14} /> House {titleCase(c.house)}</Badge></Link>}
            {c.location_name && !dead && <Badge variant="outline"><MapPin className="size-3" /> {c.location_name} at {c.label}</Badge>}
            {c.storyline && !dead && <Badge variant="outline">{titleCase(c.storyline)}</Badge>}
            {c.culture && <Badge variant="outline">{titleCase(c.culture)}</Badge>}
            <Badge variant="outline">{c.line_count} lines · {ordLabel(c.first_ord)}–{ordLabel(c.last_ord)}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild><Link href={`/wiki?slug=${encodeURIComponent(`character/${c.id}`)}&scope=${playerId ?? "canon"}`}><BookOpen className="size-4" /> Wiki</Link></Button>
          <Button variant="outline" size="sm" asChild><Link href={`/graph?center=${c.id}`}><Users className="size-4" /> In the graph</Link></Button>
        </div>
      </div>

      {/* ------------------------------------------------ timeline scrubber */}
      <Card className="bg-card/60">
        <CardContent className="p-4">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <History className="size-4 text-primary" />
            <span>See {c.name.split(" ")[0]} through time: <b className="text-primary">{ordLabel(ord)}</b></span>
            {player && ordOverride === null && <span className="text-xs text-muted-foreground">(your current time)</span>}
            {ordOverride !== null && <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => setOrd(null)}>Back to {player ? "your time" : "the end"}</Button>}
          </div>
          <Slider min={1} max={73} value={[ord]} onValueChange={([v]) => setOrd(v)} />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">{[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <span key={s}>S{s}</span>)}</div>
          <p className="mt-2 text-[11px] text-muted-foreground">Their appearance, whereabouts, relationships, what they know and what they remember all follow the timeline. Nothing after this point is revealed to them.</p>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* ------------------------------------------------ 3D figure */}
        <div className="space-y-4">
          <Card className="overflow-hidden bg-black/30">
            <CharacterStage
              character={c}
              ord={ord}
              mood={c.profile.mood}
              ghost={dead}
              reaction={reaction}
              onTouch={() => { const d = c.player_relationship?.disposition; setReaction(null); setTimeout(() => setReaction(d === "friendly" ? "wave" : d === "hostile" ? "steel" : "nod"), 10); }}
              height={460}
            />
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              <Mood mood={c.profile.mood} />
              <span>{dead ? "A spectre of the past" : "Drag to turn · click to provoke a reaction"}</span>
            </div>
          </Card>
          {c.player_relationship && (
            <Card className="bg-card/70">
              <CardHeader className="pb-2"><CardTitle className="flex items-center justify-between text-sm">Toward you <DispositionBadge disposition={c.player_relationship.disposition} stance={c.player_relationship.stance} /></CardTitle></CardHeader>
              <CardContent><RelationshipBars dims={c.player_relationship} /></CardContent>
            </Card>
          )}
          {stats.length > 0 && (
            <Card className="bg-card/70">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Swords className="size-4 text-primary" /> Abilities</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {stats.map(([k, v]) => (
                  <div key={k} className="text-xs"><div className="flex justify-between"><span className="capitalize">{k}</span><span className="tabular-nums">{v}/20</span></div><Meter value={v} max={20} className="mt-1" /></div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ------------------------------------------------ tabs */}
        <Tabs defaultValue="overview" className="min-w-0">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="persona">Persona</TabsTrigger>
            <TabsTrigger value="mind">Mind</TabsTrigger>
            <TabsTrigger value="relations">Relationships</TabsTrigger>
            <TabsTrigger value="memory">Memories</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="lines">Lines</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {c.summary && (c.arc_complete ? <p className="text-sm leading-relaxed">{c.summary}</p> : (
              <details className="rounded-md border border-border bg-black/20 p-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground">Full-series summary (contains spoilers beyond {c.label})</summary>
                <p className="mt-2 leading-relaxed">{c.summary}</p>
              </details>
            ))}
            {c.death_ord && c.death_ord <= ord && <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-200"><Skull className="mr-1 inline size-4" /> {ordLabel(c.death_ord)} — {c.death_note}</div>}
            {c.traits.length > 0 && <div className="flex flex-wrap gap-1.5">{c.traits.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}</div>}
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="bg-card/60">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Drives</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {c.profile.goals.map((g) => (
                    <div key={g.goal}><div className="flex justify-between gap-2 text-xs"><span>{g.goal}</span><span className="text-muted-foreground">{g.source ?? "prior"}</span></div><Meter value={g.priority * 100} className="mt-1" /></div>
                  ))}
                </CardContent>
              </Card>
              <Card className="bg-card/60">
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Quote className="size-4" /> Voice</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {c.voice.catchphrases?.length ? <div className="flex flex-wrap gap-1">{c.voice.catchphrases.map((p) => <Badge key={p} variant="outline">“{p}”</Badge>)}</div> : null}
                  {c.voice.top_partners?.length ? <p className="text-muted-foreground">Talks most with {c.voice.top_partners.slice(0, 6).map((p) => p.name).join(", ")}.</p> : null}
                  {c.voice.signature_lines?.filter((s) => s.ord <= ord).slice(0, 4).map((s) => (
                    <blockquote key={s.text} className="border-l-2 border-primary/60 pl-2 italic text-foreground/85">“{s.text}” <span className="not-italic text-muted-foreground">— {s.label}</span></blockquote>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="persona" className="space-y-4">
            {c.persona.hand_written && (
              <Card className="bg-card/60"><CardHeader className="pb-0"><CardTitle className="text-sm">Permanent behaviour document <span className="text-xs font-normal text-muted-foreground">(gated to {c.label})</span></CardTitle></CardHeader>
                <CardContent><Markdown content={c.persona.hand_written} /></CardContent></Card>
            )}
            <Card className="bg-card/60"><CardHeader className="pb-0"><CardTitle className="text-sm">Generated profile (from canon data and the script)</CardTitle></CardHeader>
              <CardContent><Markdown content={c.persona.generated} /></CardContent></Card>
          </TabsContent>

          <TabsContent value="mind" className="space-y-4">
            {!playerId && <p className="text-xs text-muted-foreground">Showing priors. Start a tale to watch this mind change through play.</p>}
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="bg-card/60">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Temperament</CardTitle></CardHeader>
                <CardContent className="space-y-1.5">
                  {Object.entries(c.profile.effective).map(([k, v]) => {
                    const d = v - (c.profile.prior[k] ?? v);
                    return (
                      <div key={k} className="text-xs">
                        <div className="flex justify-between"><span className="capitalize">{k}</span><span className="tabular-nums">{v.toFixed(2)}{Math.abs(d) >= 0.01 && <span className={d > 0 ? "text-emerald-400" : "text-red-400"}> ({d > 0 ? "+" : ""}{d.toFixed(2)})</span>}</span></div>
                        <Meter value={v * 100} className="mt-1" />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
              <Card className="bg-card/60">
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="size-4 text-primary" /> Learned behaviour & beliefs</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {c.profile.learned.length ? c.profile.learned.map((l) => <div key={l.rule} className="rounded border border-amber-400/20 bg-amber-500/5 px-2 py-1.5">{l.rule}<div className="text-[10px] text-muted-foreground">{l.source} · {ordLabel(l.ord)} · strength {l.strength}</div></div>)
                    : <p className="text-muted-foreground">No learned behaviour in this world yet.</p>}
                  {c.profile.beliefs.map((b) => <div key={b.belief} className="text-foreground/85">• {b.belief} <span className="text-muted-foreground">({Math.round(b.confidence * 100)}%)</span></div>)}
                  <div className="pt-2 text-[11px] text-muted-foreground">Emotion now: {c.profile.affect.label ?? "calm"} (P {Number(c.profile.affect.p ?? 0).toFixed(2)}, A {Number(c.profile.affect.a ?? 0).toFixed(2)}, D {Number(c.profile.affect.d ?? 0).toFixed(2)})</div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="relations" className="space-y-4">
            <ForceGraph nodes={graph.nodes} links={graph.links} height={320} showLinkLabels />
            <div className="grid gap-2 md:grid-cols-2">
              {c.network.map((n) => (
                <Card key={n.id} className="bg-card/60">
                  <CardContent className="space-y-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/characters/${n.id}`} prefetch={false} className="font-display text-sm hover:text-primary">{n.name}</Link>
                      <DispositionBadge disposition={n.disposition} stance={n.stance} />
                    </div>
                    <RelationshipBars dims={n} compact />
                    {n.reasons.length > 0 && <p className="text-[11px] text-muted-foreground">{n.reasons.join("; ")}</p>}
                    <Link href={`/wiki?slug=${encodeURIComponent(`relationship/${[c.id, n.id].sort().join("--")}`)}&scope=${playerId ?? "canon"}`} className="text-[11px] text-primary underline">Their shared history →</Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="memory"><MemoryManager characterId={c.id} playerId={playerId} ord={ord} /></TabsContent>

          <TabsContent value="events">
            <ol className="space-y-2">
              {c.events.map((e) => (
                <li key={e.label + e.title} className={cn("rounded-md border p-3 text-sm", e.witnessed ? "border-primary/40" : "border-border")}>
                  <div className="flex items-center gap-2 text-xs"><span className="font-mono text-primary">{e.label}</span><span className="font-medium">{e.title}</span>
                    {e.witnessed && <Badge variant="outline" className="text-[10px]">witnessed</Badge>}{e.outcome !== "occurred" && <Badge variant="outline" className="text-[10px] text-sky-300">{e.outcome}</Badge>}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{e.text}</p>
                </li>
              ))}
            </ol>
          </TabsContent>

          <TabsContent value="lines"><Lines id={c.id} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
