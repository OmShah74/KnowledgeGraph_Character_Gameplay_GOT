"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { motion } from "motion/react";
import {
  Bird, Clock, Compass, Eye, FastForward, Feather, GitBranch, Landmark, Map as MapIcon, MessagesSquare, Scroll, Users,
} from "lucide-react";
import { api, errorMessage, fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import type { PlayerState, PresentCharacter, TravelOption } from "@/lib/types";
import { ordLabel, timeAgo, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CharacterSeal, sigilFor } from "@/components/heraldry";
import { DispositionBadge, Empty, ErrorBox, Loading, Meter, Mood } from "@/components/common";
import { RelationshipBars } from "@/components/relationship-bars";
import { PlayerPanel, QuestList } from "@/components/play/player-panel";
import { TimeReportDialog, type TickReport } from "@/components/play/time-report";
import { HowToPlay } from "@/components/play/how-to-play";
import { CourtScene, WorldMap3D } from "@/components/three/lazy";
import type { LabelToggles, MapLocation } from "@/components/three/world-map";

type WorldStatic = { locations: MapLocation[] };
type RosterEntry = { id: string; name: string; tier: string; alive: boolean; location_id: string | null };

const EVENT_STYLE: Record<string, string> = {
  canon_occurred: "text-amber-200", canon_altered: "text-sky-300", canon_prevented: "text-emerald-300", death: "text-red-300",
  rumour: "text-violet-300", plot: "text-orange-300", plot_new: "text-orange-200", offscreen: "text-foreground/80", quest: "text-emerald-300",
  quest_new: "text-emerald-200", travel: "text-sky-200", start: "text-primary",
};

export default function PlayPage() {
  const router = useRouter();
  const { playerId, ready } = usePlayer();
  const { data: state, error, mutate } = useSWR<PlayerState>(playerId ? `/api/players/${playerId}` : null, fetcher);
  const { data: world } = useSWR<WorldStatic>("/api/world", fetcher);
  const { data: roster, mutate: mutateRoster } = useSWR<RosterEntry[]>(playerId ? `/api/players/${playerId}/roster` : null, fetcher);
  const [selectedLoc, setSelectedLoc] = useState<string | null>(null);
  const [labels, setLabels] = useState<LabelToggles>({ places: true, towns: true, regions: true, seas: true });
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reports, setReports] = useState<TickReport[] | null>(null);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [tab, setTab] = useState("court");

  const presence = useMemo(() => {
    const p: Record<string, { count: number; names: string[] }> = {};
    for (const r of roster ?? []) {
      if (!r.alive || !r.location_id || r.tier === "minor") continue;
      (p[r.location_id] ??= { count: 0, names: [] }).count++;
      p[r.location_id].names.push(r.name);
    }
    return p;
  }, [roster]);

  if (!ready) return <Loading />;
  if (!playerId) {
    return (
      <Empty>
        You have no active tale. <Link href="/" className="text-primary underline">Begin or choose one</Link> to play.
      </Empty>
    );
  }
  if (error) return <ErrorBox error={error} />;
  if (!state) return <Loading label="Riding to your location…" />;

  const p = state.player;
  const names = Object.fromEntries((roster ?? []).map((r) => [r.id, r.name]));
  const dest: TravelOption | undefined = state.travel.find((t) => t.id === selectedLoc);
  const banner = sigilFor(p.allegiance);

  async function startThread(ids: string[], kind: "chat" | "scene" | "raven") {
    setBusy(`thread:${kind}`);
    try {
      const t = await api.post<{ id: string }>(`/api/players/${playerId}/threads`, { character_ids: ids, kind });
      router.push(`/play/thread/${t.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function travel(id: string) {
    setBusy("travel");
    try {
      const r = await api.post<{ name: string; cost: { days: number }; encounter: { text: string } | null; quests_completed: string[] }>(`/api/players/${playerId}/travel`, { location_id: id });
      toast.success(`You arrive at ${r.name} after ${r.cost.days} days.`, { description: r.encounter?.text });
      r.quests_completed?.forEach((q) => toast.success(`Quest completed: ${q}`));
      setSelectedLoc(null);
      setPicked([]);
      await Promise.all([mutate(), mutateRoster()]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function advance(steps: number) {
    setBusy("advance");
    setAdvanceOpen(false);
    try {
      const r = await api.post<{ reports: TickReport[]; at_end: boolean }>(`/api/players/${playerId}/advance`, { steps });
      setReports(r.reports);
      if (r.at_end) toast.info("You have reached the end of the story. The world remains yours to explore.");
      await Promise.all([mutate(), mutateRoster()]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      {/* --------------------------------------------------- header: time & place */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-gradient-to-r from-card via-card/80 to-transparent p-4">
        <div className="flex items-center gap-2">
          <Clock className="size-5 text-primary" />
          <div>
            <div className="font-display text-xl text-primary">{p.label}</div>
            <div className="text-xs text-muted-foreground">“{state.episode_title}” · day {p.day}</div>
          </div>
        </div>
        <div className="mx-2 hidden h-10 w-px bg-border md:block" />
        <div className="flex items-center gap-2">
          <Compass className="size-5 text-primary" />
          <div>
            <div className="font-display text-lg">{state.location.name}</div>
            <div className="text-xs text-muted-foreground">{state.location.region_name}</div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {state.divergences > 0 && <Badge variant="outline" className="border-sky-400/40 text-sky-300"><GitBranch className="size-3" /> {state.divergences} divergences from canon</Badge>}
          <Button variant="outline" onClick={() => setAdvanceOpen(true)} disabled={busy === "advance" || p.ord >= state.max_ord}>
            <FastForward className="size-4" /> {busy === "advance" ? "The realm turns…" : p.ord >= state.max_ord ? "End of the story" : `Advance to ${ordLabel(p.ord + 1)}`}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        {/* --------------------------------------------------- left column */}
        <div className="space-y-4">
          <PlayerPanel player={p} />
          <QuestList quests={state.quests} names={names} />
        </div>

        {/* --------------------------------------------------- centre */}
        <div className="min-w-0 space-y-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="court"><Users className="size-4" /> Who is here ({state.present.length})</TabsTrigger>
              <TabsTrigger value="map"><MapIcon className="size-4" /> Map of the realm</TabsTrigger>
              <TabsTrigger value="threads"><MessagesSquare className="size-4" /> Conversations ({state.threads.length})</TabsTrigger>
              <TabsTrigger value="plots"><GitBranch className="size-4" /> Plots ({state.plots.filter((x) => x.status === "active").length})</TabsTrigger>
            </TabsList>

            <TabsContent value="court" className="space-y-3">
              {state.present.length === 0 ? (
                <Empty>No one of note is here at this moment. Travel elsewhere, send a raven, or let time pass.</Empty>
              ) : (
                <>
                  <Card className="overflow-hidden bg-black/30">
                    <CourtScene
                      people={state.present}
                      ord={p.ord}
                      selected={picked}
                      onSelect={(id) => toggle(id)}
                      height={340}
                    />
                    <div className="flex flex-wrap items-center gap-2 border-t border-border p-3 text-sm">
                      <span className="text-muted-foreground">
                        {picked.length ? `${picked.length} selected — ` : "Click figures or cards to select people. "}
                      </span>
                      <Button size="sm" disabled={picked.length !== 1 || !!busy} onClick={() => startThread(picked, "chat")}><Feather className="size-4" /> Speak with them</Button>
                      <Button size="sm" variant="outline" disabled={picked.length < 2 || !!busy} onClick={() => startThread(picked, "scene")}><Users className="size-4" /> Gather into a scene</Button>
                      {picked.length > 0 && <Button size="sm" variant="ghost" onClick={() => setPicked([])}>Clear</Button>}
                    </div>
                  </Card>
                  <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                    {state.present.map((c: PresentCharacter, i) => (
                      <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.4) }}>
                        <Card className={cn("cursor-pointer transition-all hover:border-primary/50", picked.includes(c.id) && "border-primary bg-primary/5")} onClick={() => toggle(c.id)}>
                          <CardContent className="flex gap-3 p-3">
                            <CharacterSeal name={c.name} house={c.house} size={40} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <Link href={`/characters/${c.id}`} prefetch={false} onClick={(e) => e.stopPropagation()} className="truncate font-display text-sm hover:text-primary">{c.name}</Link>
                                <DispositionBadge disposition={c.disposition} stance={c.stance} />
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <Mood mood={c.mood} /> {c.titles[0] ? <span className="truncate">· {c.titles[0]}</span> : null}
                              </div>
                              <RelationshipBars dims={c.relationship} compact className="mt-2" />
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="map" className="space-y-3">
              <div className="relative">
                {world && (
                  <WorldMap3D
                    locations={world.locations}
                    presence={presence}
                    current={p.location_id}
                    selected={selectedLoc}
                    onSelect={(id) => setSelectedLoc(id === p.location_id ? null : id)}
                    labels={labels}
                    height={620}
                    bannerColor={banner.field}
                    bannerGlyph={banner.glyph}
                  />
                )}
                <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-3 rounded-lg border border-border bg-black/70 px-3 py-2 text-xs backdrop-blur">
                  {(Object.keys(labels) as (keyof LabelToggles)[]).map((k) => (
                    <div key={k} className="flex items-center gap-1.5">
                      <Switch id={`lbl-${k}`} checked={labels[k]} onCheckedChange={(v) => setLabels((l) => ({ ...l, [k]: v }))} />
                      <Label htmlFor={`lbl-${k}`} className="text-xs capitalize">{k}</Label>
                    </div>
                  ))}
                </div>
                <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md bg-black/60 px-2 py-1 text-[11px] text-muted-foreground">
                  Drag to orbit · scroll to zoom · right-drag to pan · click a castle or its label to plan a journey
                </div>
                {dest && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="absolute right-3 top-3 z-10 w-72 rounded-xl border border-primary/40 bg-black/85 p-4 backdrop-blur">
                    <div className="font-display text-lg text-primary">{dest.name}</div>
                    <div className="text-xs text-muted-foreground">{titleCase(dest.region)}</div>
                    <p className="mt-2 text-xs text-foreground/80">{world?.locations.find((l) => l.id === dest.id)?.description}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded border border-border p-1.5"><div className="tabular-nums text-base">{dest.days}</div>days</div>
                      <div className="rounded border border-border p-1.5"><div className="tabular-nums text-base">{dest.gold}</div>gold</div>
                      <div className="rounded border border-border p-1.5"><div className="tabular-nums text-base">{presence[dest.id]?.count ?? 0}</div>notable</div>
                    </div>
                    {dest.sea_crossing && <p className="mt-2 text-[11px] text-sky-300">Requires passage across the Narrow Sea.</p>}
                    {presence[dest.id] && <p className="mt-2 line-clamp-3 text-[11px] text-muted-foreground">There: {presence[dest.id].names.join(", ")}</p>}
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" className="flex-1" disabled={busy === "travel" || p.gold < dest.gold} onClick={() => travel(dest.id)}>
                        <Compass className="size-4" /> {busy === "travel" ? "Riding…" : "Travel there"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSelectedLoc(null)}>Close</Button>
                    </div>
                  </motion.div>
                )}
              </div>
              <Card className="bg-card/60">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Send a raven</CardTitle></CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {(roster ?? []).filter((r) => r.alive && r.tier === "major" && r.location_id !== p.location_id && r.id !== "night_king").slice(0, 30).map((r) => (
                    <Button key={r.id} size="sm" variant="outline" className="h-7 text-xs" disabled={!!busy} onClick={() => startThread([r.id], "raven")}>
                      <Bird className="size-3.5" /> {r.name}
                    </Button>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="threads">
              {!state.threads.length ? <Empty>No conversations yet. Speak with someone who is here.</Empty> : (
                <div className="grid gap-2 md:grid-cols-2">
                  {state.threads.map((t) => (
                    <Link key={t.id} href={`/play/thread/${t.id}`}>
                      <Card className="h-full transition-colors hover:border-primary/50">
                        <CardContent className="space-y-1 p-3">
                          <div className="flex items-center gap-2">
                            {t.kind === "raven" ? <Bird className="size-4 text-sky-300" /> : t.kind === "scene" ? <Users className="size-4 text-primary" /> : <Feather className="size-4 text-primary" />}
                            <span className="truncate font-display text-sm">{t.title}</span>
                            <Badge variant="outline" className="ml-auto text-[10px]">{ordLabel(t.ord)}</Badge>
                          </div>
                          {t.summary && <p className="line-clamp-2 text-xs text-muted-foreground">{t.summary}</p>}
                          <div className="text-[11px] text-muted-foreground">{t.message_count} messages · {timeAgo(t.updated_at)}</div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="plots">
              {!state.plots.length ? <Empty>No plots have surfaced yet. Advance time — tensions between characters breed intrigue.</Empty> : (
                <div className="grid gap-3 md:grid-cols-2">
                  {state.plots.map((pl) => (
                    <Card key={pl.id} className={cn("bg-card/70", pl.status !== "active" && "opacity-60")}>
                      <CardContent className="space-y-2 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-display text-sm">{pl.title}</span>
                          <Badge variant="outline" className="text-[10px]">{pl.status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{pl.premise}</p>
                        <div className="flex gap-1">
                          {pl.stages.map((s, i) => (
                            <div key={s.name} title={`${s.name}: ${s.description}`} className={cn("h-1.5 flex-1 rounded-full", i < pl.stage ? "bg-primary" : i === pl.stage ? "bg-primary/60" : "bg-muted")} />
                          ))}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>Stage: {pl.stages[pl.stage]?.name}</span>
                          <span>Tension {(pl.tension * 100).toFixed(0)}%</span>
                        </div>
                        <Meter value={pl.tension * 100} />
                        <Link href={`/wiki?slug=${encodeURIComponent(`plot/${pl.id}`)}&scope=${playerId}`} className="text-[11px] text-primary underline">Read its chronicle →</Link>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* --------------------------------------------------- right column */}
        <div className="space-y-4">
          <HowToPlay />
          <Card className="bg-card/70">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 font-display text-base"><Scroll className="size-4 text-primary" /> The chronicle</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-[420px] pr-3">
                <ol className="space-y-3">
                  {state.events.map((e) => (
                    <li key={e.id} className="border-l-2 border-border pl-3">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="font-mono">{ordLabel(e.ord)}</span><span>{e.kind.replace("_", " ")}</span></div>
                      <div className={cn("text-sm", EVENT_STYLE[e.kind] ?? "")}>{e.title}</div>
                      {e.description && <p className="text-xs text-muted-foreground">{e.description}</p>}
                    </li>
                  ))}
                </ol>
              </ScrollArea>
              <Link href="/world" className="mt-2 inline-flex items-center gap-1 text-xs text-primary"><Eye className="size-3.5" /> Open the full chronicle</Link>
            </CardContent>
          </Card>
          <Card className="bg-card/70">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 font-display text-base"><Landmark className="size-4 text-primary" /> Power in the realm</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {state.factions.slice(0, 10).map((f) => (
                <div key={f.faction_id} className="text-xs">
                  <div className="flex justify-between"><span className="truncate">{f.name}</span><span className="tabular-nums text-muted-foreground">{f.power.toFixed(0)}</span></div>
                  <Meter value={f.power} className="mt-1" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={advanceOpen} onOpenChange={setAdvanceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-primary">Let time pass</DialogTitle>
            <DialogDescription>
              Each episode, canon events press on the realm (unless your world has changed their course), characters live their own lives off-screen,
              rumours spread, emotions settle and plots advance.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-start">
            {[1, 2, 3].map((n) => (
              <Button key={n} variant={n === 1 ? "default" : "outline"} disabled={p.ord + n > state.max_ord} onClick={() => advance(n)}>
                {n === 1 ? `One episode → ${ordLabel(p.ord + 1)}` : `${n} episodes → ${ordLabel(Math.min(state.max_ord, p.ord + n))}`}
              </Button>
            ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {reports && <TimeReportDialog reports={reports} open={!!reports} onOpenChange={(o) => !o && setReports(null)} />}
    </div>
  );
}
