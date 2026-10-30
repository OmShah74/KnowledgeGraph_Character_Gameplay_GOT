"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Ear, GitBranch, GitMerge, Landmark, Network, ScrollText, Users } from "lucide-react";
import { fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import type { Faction, GameEvent, Plot } from "@/lib/types";
import { ordLabel, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DispositionBadge, Empty, Loading, Meter, PageHeader, Stat } from "@/components/common";
import { ForceGraph, type FGLink, type FGNode } from "@/components/force-graph";
import { Sigil } from "@/components/heraldry";

type Outcome = { event_id: string; title: string; outcome: string; narration: string; ord: number; label: string; importance: number };
type Fact = { id: number; content: string; secrecy: number; truth: number; ord: number; known_by: { character_id: string; name: string | null; confidence: number; learned_from: string | null; channel: string; ord: number }[] };
type Links = { nodes: { id: string; kind: string; name: string }[]; links: { source: string; target: string; relation: string; note?: string }[] };
type WorldRel = { a: string; b: string; a_name: string; b_name: string; trust: number; affection: number; respect: number; fear: number; familiarity: number; stance: string; disposition: string; interactions: number; notes: string };

const KINDS = ["all", "canon", "death", "offscreen", "rumour", "plot", "quest", "travel"];

export default function WorldPage() {
  const { playerId, ready } = usePlayer();
  const [kind, setKind] = useState("all");
  const base = playerId ? `/api/players/${playerId}` : null;
  const { data: events } = useSWR<GameEvent[]>(base ? [`${base}/events`, { limit: 300, kind: kind === "all" ? undefined : kind }] : null, fetcher, { keepPreviousData: true });
  const { data: outcomes } = useSWR<Outcome[]>(base ? `${base}/outcomes` : null, fetcher);
  const { data: plots } = useSWR<Plot[]>(base ? `${base}/plots` : null, fetcher);
  const { data: factions } = useSWR<Faction[]>(base ? `${base}/factions` : null, fetcher);
  const { data: facts } = useSWR<Fact[]>(base ? `${base}/facts` : null, fetcher);
  const { data: links } = useSWR<Links>(base ? `${base}/links` : null, fetcher);
  const { data: rels } = useSWR<WorldRel[]>(base ? `${base}/world-relationships` : null, fetcher);

  const web = useMemo(() => {
    const color: Record<string, string> = { thread: "#6fb3e0", plot: "#f2a65a", character: "#e8c26a" };
    const nodes: FGNode[] = (links?.nodes ?? []).map((n) => ({ id: n.id, name: n.name, group: n.kind, color: color[n.kind], size: n.kind === "character" ? 4 : 6 }));
    const fl: FGLink[] = (links?.links ?? []).map((l) => ({ source: l.source, target: l.target, type: l.relation, color: l.relation === "rumour_reached" ? "rgba(199,146,234,0.7)" : l.relation === "continues" ? "rgba(111,179,224,0.6)" : undefined }));
    return { nodes, links: fl };
  }, [links]);
  const relGraph = useMemo(() => {
    const ids = new Map<string, string>();
    (rels ?? []).forEach((r) => { ids.set(r.a, r.a_name); ids.set(r.b, r.b_name); });
    const nodes: FGNode[] = [...ids].map(([id, name]) => ({ id, name, group: "character", size: 4 }));
    const fl: FGLink[] = (rels ?? []).map((r) => ({ source: r.a, target: r.b, type: r.stance,
      color: r.disposition === "friendly" ? "rgba(52,211,153,0.55)" : r.disposition === "hostile" ? "rgba(248,113,113,0.6)" : "rgba(229,211,161,0.25)" }));
    return { nodes, links: fl };
  }, [rels]);

  if (!ready) return <Loading />;
  if (!playerId) return <Empty>Choose or begin a tale on the <Link className="text-primary underline" href="/">Realm</Link> page to see its chronicle.</Empty>;

  const divergent = (outcomes ?? []).filter((o) => o.outcome !== "occurred");
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="The Chronicle" subtitle="Everything that has happened in your world — what canon did, what you changed, what people whisper, and how every thread of the story is tied to the others." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Events recorded" value={events?.length ?? "…"} />
        <Stat label="Divergences" value={divergent.length} hint="Canon events altered or prevented in your world" />
        <Stat label="Active plots" value={(plots ?? []).filter((p) => p.status === "active").length} />
        <Stat label="Rumours" value={facts?.length ?? 0} />
        <Stat label="Evolved bonds" value={rels?.length ?? 0} />
      </div>
      <Tabs defaultValue="timeline">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="timeline"><ScrollText className="size-4" /> Timeline</TabsTrigger>
          <TabsTrigger value="divergence"><GitMerge className="size-4" /> Divergence</TabsTrigger>
          <TabsTrigger value="plots"><GitBranch className="size-4" /> Plots</TabsTrigger>
          <TabsTrigger value="rumours"><Ear className="size-4" /> Rumours</TabsTrigger>
          <TabsTrigger value="web"><Network className="size-4" /> Thread web</TabsTrigger>
          <TabsTrigger value="bonds"><Users className="size-4" /> Bonds</TabsTrigger>
          <TabsTrigger value="factions"><Landmark className="size-4" /> Factions</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-3">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k === "all" ? "All events" : titleCase(k)}</SelectItem>)}</SelectContent>
          </Select>
          {!events?.length ? <Empty>Nothing recorded yet.</Empty> : (
            <ol className="relative space-y-3 border-l border-border pl-5">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className={cn("absolute -left-[26px] top-1.5 size-2.5 rounded-full", e.canon ? "bg-primary" : "bg-sky-400")} />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="font-mono text-primary">{ordLabel(e.ord)}</span><Badge variant="outline" className="h-5 text-[10px]">{e.kind.replace("_", " ")}</Badge></div>
                  <div className="text-sm font-medium">{e.title}</div>
                  {e.description && <p className="text-xs text-muted-foreground">{e.description}</p>}
                </li>
              ))}
            </ol>
          )}
        </TabsContent>

        <TabsContent value="divergence" className="space-y-2">
          <p className="text-xs text-muted-foreground">Canon events are pressures, not destiny. Here is how each one played out in your world.</p>
          {(outcomes ?? []).map((o) => (
            <Card key={o.event_id} className={cn("bg-card/60", o.outcome !== "occurred" && "border-sky-400/40")}>
              <CardContent className="flex gap-3 p-3">
                <span className="w-14 shrink-0 font-mono text-xs text-primary">{o.label}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm"><Link className="hover:text-primary" href={`/wiki?slug=${encodeURIComponent(`event/${o.event_id}`)}&scope=${playerId}`}>{o.title}</Link>
                    <Badge variant="outline" className={cn("text-[10px]", o.outcome === "prevented" ? "text-emerald-300" : o.outcome === "altered" ? "text-sky-300" : "text-amber-200")}>{o.outcome}</Badge></div>
                  <p className="text-xs text-muted-foreground">{o.narration}</p>
                </div>
              </CardContent>
            </Card>
          ))}
          {!outcomes?.length && <Empty>Advance time to see canon unfold — or not.</Empty>}
        </TabsContent>

        <TabsContent value="plots" className="grid gap-3 md:grid-cols-2">
          {(plots ?? []).map((p) => (
            <Card key={p.id} className={cn("bg-card/60", p.status !== "active" && "opacity-70")}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-start justify-between gap-2 text-base"><span className="font-display">{p.title}</span><Badge variant="outline">{p.status}</Badge></CardTitle>
                <p className="text-xs text-muted-foreground">{p.premise}</p>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex flex-wrap gap-1">{p.character_names?.map((n, i) => <Link key={n} href={`/characters/${p.characters[i]}`} prefetch={false}><Badge variant="secondary">{n}</Badge></Link>)}</div>
                <ol className="space-y-1">
                  {p.stages.map((s, i) => (
                    <li key={s.name} className={cn("flex gap-2", i > p.stage && "text-muted-foreground")}>
                      <span className={cn("mt-1 size-2 shrink-0 rounded-full", i < p.stage ? "bg-primary" : i === p.stage ? "animate-pulse bg-primary" : "bg-muted")} />
                      <span><b>{s.name}</b> — {s.description}</span>
                    </li>
                  ))}
                </ol>
                <div><div className="flex justify-between"><span>Tension</span><span>{Math.round(p.tension * 100)}%</span></div><Meter value={p.tension * 100} className="mt-1" /></div>
                <details className="text-muted-foreground"><summary className="cursor-pointer text-foreground">Chronicle ({p.log.length})</summary>
                  <ul className="mt-1 space-y-1">{p.log.map((l, i) => <li key={i}><span className="font-mono text-primary">{l.label}</span> {l.text}</li>)}</ul></details>
                {!!p.linked_threads?.length && <div className="text-[11px]">Linked conversations: {p.linked_threads.map((t, i) => <Link key={t} className="mr-1 text-primary underline" href={`/play/thread/${t}`}>#{i + 1}</Link>)}</div>}
              </CardContent>
            </Card>
          ))}
          {!plots?.length && <Empty>No plots yet.</Empty>}
        </TabsContent>

        <TabsContent value="rumours" className="space-y-3">
          <p className="text-xs text-muted-foreground">Facts and rumours of your world and the path they travelled. Confidence decays with each retelling.</p>
          {(facts ?? []).map((f) => (
            <Card key={f.id} className="bg-card/60">
              <CardContent className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2"><p className="text-sm">“{f.content}”</p><Badge variant="outline" className="shrink-0 text-[10px]">secrecy {Math.round(f.secrecy * 100)}%</Badge></div>
                <div className="flex flex-wrap items-center gap-1 text-[11px]">
                  {f.known_by.map((k, i) => (
                    <span key={k.character_id} className="flex items-center gap-1">
                      {i > 0 && <span className="text-muted-foreground">→</span>}
                      <Link href={`/characters/${k.character_id}`} prefetch={false} className="rounded bg-muted px-1.5 py-0.5 hover:text-primary" title={`${k.channel}${k.learned_from ? ` from ${k.learned_from}` : ""} · ${Math.round(k.confidence * 100)}%`}>
                        {k.name ?? k.character_id} <span className="text-muted-foreground">{Math.round(k.confidence * 100)}%</span>
                      </Link>
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
          {!facts?.length && <Empty>No rumours yet. What you reveal in conversations becomes knowledge — and knowledge travels.</Empty>}
        </TabsContent>

        <TabsContent value="web" className="space-y-2">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span><span className="mr-1 inline-block size-2 rounded-full bg-[#6fb3e0]" />conversations</span>
            <span><span className="mr-1 inline-block size-2 rounded-full bg-[#f2a65a]" />plots</span>
            <span><span className="mr-1 inline-block size-2 rounded-full bg-[#e8c26a]" />characters</span>
            <span>violet links = a rumour from that conversation reached them</span>
          </div>
          {web.nodes.length ? <ForceGraph nodes={web.nodes} links={web.links} height={560} showLinkLabels onNodeClick={(n) => {
            if (n.group === "thread") window.location.href = `/play/thread/${n.id}`;
            else if (n.group === "character") window.location.href = `/characters/${n.id}`;
          }} /> : <Empty>Start conversations to weave the web.</Empty>}
        </TabsContent>

        <TabsContent value="bonds" className="space-y-4">
          {relGraph.nodes.length > 0 && <ForceGraph nodes={relGraph.nodes} links={relGraph.links} height={420} showLinkLabels onNodeClick={(n) => { window.location.href = `/characters/${n.id}`; }} />}
          <Card className="bg-card/60">
            <Table>
              <TableHeader><TableRow><TableHead>Who</TableHead><TableHead>Toward</TableHead><TableHead>Stance</TableHead><TableHead className="text-right">Trust</TableHead><TableHead className="text-right">Affection</TableHead><TableHead className="text-right">Fear</TableHead><TableHead className="text-right">Meetings</TableHead></TableRow></TableHeader>
              <TableBody>
                {(rels ?? []).map((r) => (
                  <TableRow key={`${r.a}-${r.b}`}>
                    <TableCell><Link href={`/characters/${r.a}`} prefetch={false} className="hover:text-primary">{r.a_name}</Link></TableCell>
                    <TableCell><Link href={`/characters/${r.b}`} prefetch={false} className="hover:text-primary">{r.b_name}</Link></TableCell>
                    <TableCell><DispositionBadge disposition={r.disposition} stance={r.stance} /></TableCell>
                    <TableCell className="text-right tabular-nums">{r.trust.toFixed(0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.affection.toFixed(0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.fear.toFixed(0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.interactions}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!rels?.length && <div className="p-4"><Empty>Bonds evolve when characters meet — in your scenes and off-screen as time passes.</Empty></div>}
          </Card>
        </TabsContent>

        <TabsContent value="factions" className="grid gap-3 md:grid-cols-2">
          {(factions ?? []).map((f) => (
            <Card key={f.faction_id} className="bg-card/60">
              <CardContent className="flex gap-3 p-4">
                <Sigil house={f.faction_id.startsWith("house_") ? f.faction_id.slice(6) : undefined} org={f.faction_id.startsWith("org_") ? f.faction_id.slice(4) : undefined} size={40} />
                <div className="min-w-0 flex-1 space-y-1.5 text-xs">
                  <div className="font-display text-sm">{f.name}</div>
                  {f.leader_id && <div className="text-muted-foreground">Led by <Link href={`/characters/${f.leader_id}`} prefetch={false} className="text-foreground hover:text-primary">{titleCase(f.leader_id)}</Link></div>}
                  {(["power", "wealth", "influence", "stability"] as const).map((k) => (
                    <div key={k}><div className="flex justify-between"><span className="capitalize">{k}</span><span className="tabular-nums">{f[k].toFixed(0)}</span></div><Meter value={f[k]} className="mt-0.5" /></div>
                  ))}
                  {Object.keys(f.stances).length > 0 && <div className="flex flex-wrap gap-1 pt-1">{Object.entries(f.stances).map(([o, s]) => <Badge key={o} variant="outline" className={cn("text-[10px]", s === "war" ? "text-red-300" : s === "alliance" ? "text-emerald-300" : "")}>{s} · {titleCase(o.replace(/^(house|org)_/, ""))}</Badge>)}</div>}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
