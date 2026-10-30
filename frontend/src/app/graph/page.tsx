"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Box, Crosshair, Database, Play, Route, Search, Sparkles, TerminalSquare, Trophy, Users, Waypoints, X } from "lucide-react";
import { api, errorMessage, fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import type { GraphLink, GraphNode, OntologyClass, OntologyRelation } from "@/lib/types";
import { ordLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, ErrorBox, Loading, PageHeader, Stat } from "@/components/common";
import { ForceGraph, type FGLink, type FGNode } from "@/components/force-graph";
import { ForceGraph3D } from "@/components/force-graph-3d";

type Sub = { nodes: GraphNode[]; links: GraphLink[] };
type NodeDetail = GraphNode & { edges: (GraphLink & { source_name: string; target_name: string; source_label: string; target_label: string })[] };
type Stats = { nodes: number; edges: number; by_label: Record<string, number>; by_type: Record<string, number>; neo4j: { available: boolean; nodes?: number; relationships?: number; error?: string | null } };
type CypherRes = { columns: string[]; rows: unknown[][]; graph: { nodes: { id: string; name: string; class?: string; labels: string[] }[]; links: { id: string; source: string; target: string; type: string }[] }; elapsed_ms: number; truncated: boolean };

const DEFAULT_CLASSES = ["Character", "House", "Organization", "Storyline", "Location", "Title", "Creature"];
const DEFAULT_TYPES = ["PARENT_OF", "SIBLING_OF", "SPOUSE_OF", "LOVER_OF", "SERVES", "SWORN_TO", "ALLY_OF", "ENEMY_OF", "BETRAYED", "KILLED", "MENTOR_OF", "MEMBER_OF", "IN_STORYLINE", "LOCATED_AT"];

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    const o = v as { name?: string; type?: string; id?: string };
    if (o.name) return o.name;
    if (o.type) return `[${o.type}]`;
    return JSON.stringify(v).slice(0, 140);
  }
  return String(v);
}

function NodePicker({ value, onChange, placeholder }: { value: string; onChange: (id: string, name: string) => void; placeholder: string }) {
  const [q, setQ] = useState("");
  const { data } = useSWR<GraphNode[]>(q.length >= 2 ? ["/api/graph/search", { q, limit: 12 }] : null, fetcher);
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={value ? `${placeholder}: ${value}` : placeholder} />
      {data && q.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {data.map((n) => (
            <button key={n.id} type="button" onClick={() => { onChange(n.id, n.name); setQ(""); }} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted">
              <span>{n.name}</span><span className="text-[10px] text-muted-foreground">{n.label}</span>
            </button>
          ))}
          {!data.length && <div className="px-3 py-2 text-xs text-muted-foreground">No match</div>}
        </div>
      )}
    </div>
  );
}

function Explorer({ colors, classes, relations }: { colors: Record<string, string>; classes: OntologyClass[]; relations: OntologyRelation[] }) {
  const params = useSearchParams();
  const { playerId } = usePlayer();
  const [ord, setOrd] = useState(10);
  const [timeless, setTimeless] = useState(false);
  const [selClasses, setSelClasses] = useState<string[]>(DEFAULT_CLASSES);
  const [selTypes, setSelTypes] = useState<string[]>(DEFAULT_TYPES);
  const [center, setCenter] = useState<string | null>(params.get("center"));
  const [depth, setDepth] = useState(2);
  const [storyline, setStoryline] = useState("all");
  const [includePlayer, setIncludePlayer] = useState(false);
  const [mode3d, setMode3d] = useState(false);
  const [inspect, setInspect] = useState<string | null>(params.get("center"));

  const query = {
    ord: timeless ? undefined : ord, classes: center ? undefined : selClasses.join(","), types: selTypes.join(","), center: center ?? undefined,
    depth, storyline: storyline === "all" ? undefined : `story_${storyline}`, player_id: playerId ?? undefined, include_player: includePlayer, limit: 4000,
  };
  const { data, error, isLoading } = useSWR<Sub>(["/api/graph/subgraph", query], fetcher, { keepPreviousData: true });
  const { data: detail } = useSWR<NodeDetail>(inspect ? [`/api/graph/node/${inspect}`, { ord: timeless ? undefined : ord, player_id: playerId ?? undefined }] : null, fetcher);
  const storylines = useSWR<{ storylines: { id: string; name: string }[] }>("/api/world", fetcher).data?.storylines ?? [];

  const fg = useMemo(() => {
    const deg: Record<string, number> = {};
    for (const l of data?.links ?? []) { deg[l.source] = (deg[l.source] ?? 0) + 1; deg[l.target] = (deg[l.target] ?? 0) + 1; }
    const nodes: FGNode[] = (data?.nodes ?? []).map((n) => ({ id: n.id, name: n.name, group: n.label, color: colors[n.label], size: Math.min(10, 3 + Math.sqrt(deg[n.id] ?? 1)) }));
    const links: FGLink[] = (data?.links ?? []).map((l) => ({ source: l.source, target: l.target, type: l.type,
      color: l.type === "ENEMY_OF" || l.type === "KILLED" || l.type === "BETRAYED" ? "rgba(248,113,113,0.55)" : l.type === "ALLY_OF" || l.type === "LOVER_OF" ? "rgba(52,211,153,0.5)" : undefined }));
    return { nodes, links };
  }, [data, colors]);

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
      <Card className="h-fit bg-card/60">
        <CardContent className="space-y-4 p-4 text-sm">
          <div>
            <div className="mb-1 flex items-center justify-between"><Label>Point in time</Label><span className="font-mono text-xs text-primary">{timeless ? "all time" : ordLabel(ord)}</span></div>
            <Slider min={1} max={73} value={[ord]} onValueChange={([v]) => setOrd(v)} disabled={timeless} />
            <div className="mt-2 flex items-center gap-2"><Switch id="tl" checked={timeless} onCheckedChange={setTimeless} /><Label htmlFor="tl" className="text-xs">Ignore time (show all edges)</Label></div>
          </div>
          <div>
            <Label className="mb-1 block">Ego network</Label>
            <NodePicker value={center ?? ""} placeholder="Centre on…" onChange={(id) => { setCenter(id); setInspect(id); }} />
            {center && (
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="secondary">{center}</Badge>
                <span className="text-xs text-muted-foreground">depth</span>
                {[1, 2, 3].map((d) => <Button key={d} size="sm" variant={depth === d ? "default" : "outline"} className="h-6 w-6 p-0" onClick={() => setDepth(d)}>{d}</Button>)}
                <button onClick={() => setCenter(null)} aria-label="Clear centre"><X className="size-4 text-muted-foreground" /></button>
              </div>
            )}
          </div>
          <div>
            <Label className="mb-1 block">Storyline (plot group)</Label>
            <Select value={storyline} onValueChange={setStoryline}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72"><SelectItem value="all">All storylines</SelectItem>{storylines.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {!center && (
            <div>
              <Label className="mb-1 block">Classes</Label>
              <div className="flex flex-wrap gap-1">
                {classes.filter((c) => c.instance_count > 0).map((c) => (
                  <button key={c.name} onClick={() => toggle(selClasses, c.name, setSelClasses)}
                    className={cn("rounded-full border px-2 py-0.5 text-[11px]", selClasses.includes(c.name) ? "border-transparent text-black" : "border-border text-muted-foreground")}
                    style={selClasses.includes(c.name) ? { background: c.color } : undefined}>{c.name}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between"><Label>Relations</Label>
              <div className="flex gap-1"><button className="text-[10px] text-primary" onClick={() => setSelTypes(relations.map((r) => r.name))}>all</button><button className="text-[10px] text-primary" onClick={() => setSelTypes(DEFAULT_TYPES)}>reset</button></div>
            </div>
            <ScrollArea className="h-40">
              <div className="flex flex-wrap gap-1 pr-2">
                {relations.filter((r) => r.edge_count > 0).map((r) => (
                  <button key={r.name} onClick={() => toggle(selTypes, r.name, setSelTypes)} title={r.description}
                    className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]", selTypes.includes(r.name) ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground")}>
                    {r.name}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
          <div className="flex items-center gap-2"><Switch id="pl" checked={includePlayer} onCheckedChange={setIncludePlayer} disabled={!playerId} /><Label htmlFor="pl" className="text-xs">Include your world&apos;s layer (memories, facts, plots)</Label></div>
          <div className="flex items-center gap-2"><Switch id="d3" checked={mode3d} onCheckedChange={setMode3d} /><Label htmlFor="d3" className="flex items-center gap-1 text-xs"><Box className="size-3.5" /> 3D view</Label></div>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {isLoading && <span>Loading…</span>}
          <span>{fg.nodes.length} nodes · {fg.links.length} edges</span>
          {!timeless && <span>· only what is true at {ordLabel(ord)}</span>}
        </div>
        {error ? <ErrorBox error={error} /> : !fg.nodes.length ? <Empty>No nodes for these filters.</Empty> : mode3d
          ? <ForceGraph3D nodes={fg.nodes} links={fg.links} height={680} onNodeClick={(n) => setInspect(n.id)} />
          : <ForceGraph nodes={fg.nodes} links={fg.links} height={680} highlight={inspect} onNodeClick={(n) => setInspect(n.id)} showLinkLabels />}
        <div className="flex flex-wrap gap-2 text-[11px]">
          {Object.entries(colors).filter(([k]) => fg.nodes.some((n) => n.group === k)).map(([k, c]) => <span key={k} className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: c }} />{k}</span>)}
        </div>
      </div>

      <Card className="h-fit bg-card/60">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Crosshair className="size-4 text-primary" /> Inspector</CardTitle></CardHeader>
        <CardContent>
          {!detail ? <p className="text-xs text-muted-foreground">Click a node to inspect it.</p> : (
            <div className="space-y-3 text-xs">
              <div>
                <div className="font-display text-base text-primary">{detail.name}</div>
                <div className="flex items-center gap-2"><Badge style={{ background: colors[detail.label] }} className="text-black">{detail.label}</Badge><span className="font-mono text-muted-foreground">{detail.id}</span></div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCenter(detail.id)}><Waypoints className="size-3.5" /> Centre here</Button>
                {detail.label === "Character" && <Button size="sm" variant="outline" className="h-7 text-xs" asChild><Link href={`/characters/${detail.id}`} prefetch={false}><Users className="size-3.5" /> Character</Link></Button>}
              </div>
              <details><summary className="cursor-pointer text-muted-foreground">Properties</summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/40 p-2 text-[10px]">{JSON.stringify(detail.props, null, 2)}</pre></details>
              <div className="text-muted-foreground">{detail.edges.length} edges {timeless ? "" : `at ${ordLabel(ord)}`}</div>
              <ScrollArea className="h-80 pr-2">
                <ul className="space-y-1">
                  {detail.edges.map((e) => {
                    const out = e.source === detail.id;
                    return (
                      <li key={e.id} className="rounded border border-border/60 px-2 py-1">
                        <span className="font-mono text-[10px] text-primary">{e.type}</span> {out ? "→" : "←"}{" "}
                        <button className="hover:text-primary" onClick={() => setInspect(out ? e.target : e.source)}>{out ? e.target_name : e.source_name}</button>
                        {(e.valid_from || e.valid_to) && <span className="ml-1 text-[10px] text-muted-foreground">({ordLabel(e.valid_from)}–{e.valid_to ? ordLabel(e.valid_to) : "…"})</span>}
                        {e.layer === "player" && <Badge variant="outline" className="ml-1 h-4 text-[9px] text-sky-300">your world</Badge>}
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CypherConsole({ available }: { available: boolean }) {
  const { data: examples } = useSWR<{ title: string; query: string }[]>("/api/graph/cypher/examples", fetcher);
  const [query, setQuery] = useState("MATCH (k:Character)-[r:KILLED]->(v:Character) RETURN k.name AS killer, v.name AS victim, r.valid_from AS ord ORDER BY ord LIMIT 25");
  const [allowWrite, setAllowWrite] = useState(false);
  const [res, setRes] = useState<CypherRes | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      setRes(await api.post<CypherRes>("/api/graph/cypher", { query, allow_write: allowWrite }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const g = useMemo(() => ({
    nodes: (res?.graph.nodes ?? []).map((n) => ({ id: n.id, name: n.name, group: n.class ?? n.labels[0] ?? "Entity" })),
    links: (res?.graph.links ?? []).filter((l) => l.source && l.target).map((l) => ({ source: l.source, target: l.target, type: l.type })),
  }), [res]);
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-fit bg-card/60">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Examples</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {examples?.map((e) => <button key={e.title} onClick={() => setQuery(e.query)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted">{e.title}</button>)}
        </CardContent>
      </Card>
      <div className="space-y-3">
        {!available && <div className="rounded-md border border-amber-400/30 bg-amber-500/5 p-3 text-xs text-amber-100">Neo4j is not connected, so Cypher is unavailable. Start it with <code>docker compose up neo4j</code>; the explorer keeps working on the SQLite graph meanwhile.</div>}
        <Textarea value={query} onChange={(e) => setQuery(e.target.value)} className="min-h-[120px] font-mono text-xs" onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); }} />
        <div className="flex items-center gap-3">
          <Button onClick={run} disabled={busy || !available}><Play className="size-4" /> {busy ? "Running…" : "Run (Ctrl+Enter)"}</Button>
          <div className="flex items-center gap-2"><Switch id="aw" checked={allowWrite} onCheckedChange={setAllowWrite} /><Label htmlFor="aw" className="text-xs text-red-300">Allow writes</Label></div>
          {res && <span className="text-xs text-muted-foreground">{res.rows.length} rows · {res.elapsed_ms} ms{res.truncated ? " · truncated" : ""}</span>}
        </div>
        {res && g.nodes.length > 0 && <ForceGraph nodes={g.nodes} links={g.links} height={380} showLinkLabels />}
        {res && (
          <Card className="overflow-x-auto bg-card/60">
            <Table>
              <TableHeader><TableRow>{res.columns.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{res.rows.slice(0, 200).map((r, i) => <TableRow key={i}>{r.map((v, j) => <TableCell key={j} className="text-xs">{cellText(v)}</TableCell>)}</TableRow>)}</TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}

function PathFinder() {
  const [a, setA] = useState<{ id: string; name: string } | null>({ id: "jon_snow", name: "Jon Snow" });
  const [b, setB] = useState<{ id: string; name: string } | null>({ id: "cersei_lannister", name: "Cersei Lannister" });
  const [ord, setOrd] = useState(73);
  const { data, isLoading } = useSWR<{ engine: string; path: { node: string; name: string; label: string; via: { type: string } | null }[] }>(
    a && b ? ["/api/graph/path", { a: a.id, b: b.id, ord: ord === 73 ? undefined : ord }] : null, fetcher);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_260px]">
        <NodePicker value={a?.name ?? ""} placeholder="From" onChange={(id, name) => setA({ id, name })} />
        <NodePicker value={b?.name ?? ""} placeholder="To" onChange={(id, name) => setB({ id, name })} />
        <div><div className="mb-1 text-xs">At {ord === 73 ? "the end (Neo4j if available)" : ordLabel(ord)}</div><Slider min={1} max={73} value={[ord]} onValueChange={([v]) => setOrd(v)} /></div>
      </div>
      {isLoading && <Loading label="Tracing the threads of fate…" />}
      {data && (data.path.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {data.path.map((s, i) => (
            <span key={s.node + i} className="flex items-center gap-2">
              {s.via && <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">{s.via.type}</span>}
              <Badge variant="secondary" className="text-sm">{s.name}</Badge>
            </span>
          ))}
          <span className="text-xs text-muted-foreground">({data.engine})</span>
        </div>
      ) : <Empty>No path at this point in time — their worlds have not touched yet.</Empty>)}
    </div>
  );
}

function Analytics() {
  const [ord, setOrd] = useState(30);
  const { data: central } = useSWR<{ id: string; name: string; score: number; degree: number }[]>(["/api/graph/centrality", { ord, top: 20 }], fetcher, { keepPreviousData: true });
  const { data: comms } = useSWR<Record<string, { id: string; name: string; members: string[] }[]>>("/api/graph/communities", fetcher);
  const [season, setSeason] = useState("1");
  const max = central?.[0]?.score ?? 1;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="bg-card/60">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Trophy className="size-4 text-primary" /> Most central characters (PageRank) at {ordLabel(ord)}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Slider min={1} max={73} value={[ord]} onValueChange={([v]) => setOrd(v)} />
          {central?.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <span className="w-5 text-right text-muted-foreground">{i + 1}</span>
              <Link href={`/characters/${c.id}`} prefetch={false} className="w-40 truncate hover:text-primary">{c.name}</Link>
              <div className="h-2 flex-1 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(c.score / max) * 100}%` }} /></div>
              <span className="w-12 text-right tabular-nums text-muted-foreground">{c.degree} ties</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="bg-card/60">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="size-4 text-primary" /> Conversation communities (Louvain on the script)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-1">{["1", "2", "3", "4", "5", "6", "7", "8"].map((s) => <Button key={s} size="sm" variant={season === s ? "default" : "outline"} className="h-7 w-9 p-0" onClick={() => setSeason(s)}>S{s}</Button>)}</div>
          {(comms?.[season] ?? []).map((c) => (
            <div key={c.id} className="rounded-md border border-border p-2 text-xs">
              <div className="mb-1 font-medium">{c.name}</div>
              <div className="text-muted-foreground">{c.members.length} members</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function GraphPageInner() {
  const { data: stats } = useSWR<Stats>("/api/graph/stats", fetcher);
  const { data: ont } = useSWR<{ classes: OntologyClass[]; relations: OntologyRelation[] }>("/api/ontology", fetcher);
  const colors = useMemo(() => Object.fromEntries((ont?.classes ?? []).map((c) => [c.name, c.color])), [ont]);
  async function sync() {
    try {
      const r = await api.post<{ synced: boolean; nodes?: number; reason?: string }>("/api/graph/sync-neo4j");
      if (r.synced) toast.success(`Neo4j synced: ${r.nodes} nodes.`);
      else toast.error(`Neo4j unavailable: ${r.reason}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  return (
    <div className="mx-auto max-w-[1700px]">
      <PageHeader title="Knowledge Graph" subtitle="An ontology-backed, time-aware graph of the realm: kin, oaths, loves, betrayals, kills, storylines, conversations and inferred feuds. SQLite is the source of truth; Neo4j mirrors it for Cypher.">
        <Button variant="outline" size="sm" onClick={sync}><Database className="size-4" /> Sync to Neo4j</Button>
      </PageHeader>
      {stats && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Nodes" value={stats.nodes.toLocaleString()} />
          <Stat label="Edges" value={stats.edges.toLocaleString()} />
          <Stat label="Classes in use" value={Object.keys(stats.by_label).length} />
          <Stat label="Relation types" value={Object.keys(stats.by_type).length} />
          <Stat label="Neo4j" value={stats.neo4j.available ? `${stats.neo4j.nodes ?? 0} nodes` : "offline"} hint={stats.neo4j.error ?? ""} />
        </div>
      )}
      <Tabs defaultValue="explore">
        <TabsList>
          <TabsTrigger value="explore"><Search className="size-4" /> Explore</TabsTrigger>
          <TabsTrigger value="cypher"><TerminalSquare className="size-4" /> Cypher</TabsTrigger>
          <TabsTrigger value="path"><Route className="size-4" /> Paths</TabsTrigger>
          <TabsTrigger value="analytics"><Trophy className="size-4" /> Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="explore">{ont ? <Explorer colors={colors} classes={ont.classes} relations={ont.relations} /> : <Loading />}</TabsContent>
        <TabsContent value="cypher"><CypherConsole available={!!stats?.neo4j.available} /></TabsContent>
        <TabsContent value="path"><PathFinder /></TabsContent>
        <TabsContent value="analytics"><Analytics /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function GraphPage() {
  return <Suspense fallback={<Loading />}><GraphPageInner /></Suspense>;
}
