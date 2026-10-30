"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { BookOpen, ChevronDown, Eye, FileClock, History, Link2, Pencil, RefreshCw, Save, ScrollText, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { api, errorMessage, fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import type { WikiPage } from "@/lib/types";
import { timeAgo, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, ErrorBox, Loading } from "@/components/common";
import { Markdown } from "@/components/markdown";

type Catalog = Record<string, { slug: string; title: string }[]>;
type Revision = { id: number; version: number; author: string; created_at: string; content: string };
type Lint = { pages: number; broken_links: { page: string; link: string }[]; orphans: string[]; contradictions: { page: string; issue: string }[]; stale: string[] };
type LogRow = { id: number; action: string; slug: string | null; summary: string; created_at: string };

const CATEGORY_LABEL: Record<string, string> = {
  meta: "Index & log", chronicle: "Your chronicle", character: "Characters", house: "Houses", organization: "Orders & factions", location: "Places",
  storyline: "Storylines", event: "Events", plot: "Plots of your world", relationship: "Relationships", ontology: "Ontology",
};
const ORDER = ["meta", "chronicle", "plot", "relationship", "character", "house", "organization", "location", "storyline", "event", "ontology"];

function WikiInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { playerId } = usePlayer();
  const slug = params.get("slug") || "index";
  const scope = params.get("scope") || (playerId ?? "canon");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ meta: true, chronicle: true, plot: true, character: true });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [revOpen, setRevOpen] = useState(false);
  const [revView, setRevView] = useState<Revision | null>(null);
  const [lint, setLint] = useState<Lint | null>(null);

  const { data: catalog } = useSWR<Catalog>(["/api/wiki/catalog", { scope }], fetcher);
  const { data: page, error, mutate, isLoading } = useSWR<WikiPage>(["/api/wiki/page", { slug, scope }], fetcher);
  const { data: revisions } = useSWR<Revision[]>(revOpen ? ["/api/wiki/revisions", { slug, scope }] : null, fetcher);
  const { data: log } = useSWR<LogRow[]>(slug === "log" ? null : ["/api/wiki/log", { scope, limit: 12 }], fetcher, { refreshInterval: 20000 });

  useEffect(() => { setEditing(false); }, [slug, scope]);

  const go = (s: string, sc = scope) => router.push(`/wiki?slug=${encodeURIComponent(s)}&scope=${encodeURIComponent(sc)}`);
  const groups = useMemo(() => {
    if (!catalog) return [];
    const f = filter.toLowerCase();
    return ORDER.filter((k) => catalog[k]).map((k) => [k, catalog[k].filter((i) => !f || i.title.toLowerCase().includes(f))] as const).filter(([, v]) => v.length);
  }, [catalog, filter]);

  async function act(kind: "refresh" | "llm" | "save") {
    setBusy(kind);
    try {
      if (kind === "refresh") await api.get("/api/wiki/page", { slug, scope, refresh: true });
      if (kind === "llm") await api.post("/api/wiki/regenerate", { slug, scope, use_llm: true });
      if (kind === "save") { await api.put("/api/wiki/page", { slug, scope, content: draft, title: page?.title }); setEditing(false); }
      toast.success(kind === "llm" ? "The maesters rewrote the page from its sources." : kind === "save" ? "Page saved as a new revision." : "Recompiled from the latest sources.");
      mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function runLint() {
    try { setLint(await api.get<Lint>("/api/wiki/lint", { scope })); } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <div className="mx-auto grid max-w-[1500px] gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="h-fit bg-card/60 lg:sticky lg:top-20">
        <CardContent className="space-y-3 p-3">
          <Select value={scope} onValueChange={(v) => go(slug, v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="canon">Canon (the show)</SelectItem>
              {playerId && <SelectItem value={playerId}>Your world</SelectItem>}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a page…" className="pl-8" />
          </div>
          <ScrollArea className="h-[64vh] pr-2">
            {groups.map(([cat, items]) => (
              <div key={cat} className="mb-1">
                <button onClick={() => setOpen((o) => ({ ...o, [cat]: !o[cat] }))} className="flex w-full items-center gap-1 px-1 py-1.5 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
                  <ChevronDown className={cn("size-3.5 transition-transform", !open[cat] && !filter && "-rotate-90")} /> {CATEGORY_LABEL[cat] ?? cat} <span className="ml-auto">{items.length}</span>
                </button>
                {(open[cat] || filter) && (
                  <ul>
                    {items.slice(0, filter ? 60 : 250).map((i) => (
                      <li key={i.slug}>
                        <button onClick={() => go(i.slug)} className={cn("w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted", i.slug === slug && "bg-primary/15 text-primary")}>{i.title}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </ScrollArea>
          <Button variant="outline" size="sm" className="w-full" onClick={runLint}><ShieldCheck className="size-4" /> Lint this wiki</Button>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <BookOpen className="size-5 text-primary" />
          <span className="text-xs text-muted-foreground">{scope === "canon" ? "Canon wiki" : "Your world's wiki"} · {titleCase(slug.split("/")[0])}</span>
          {page && <Badge variant="outline">v{page.version}</Badge>}
          {page && <Badge variant="secondary" className="capitalize">{page.generated_by === "llm" ? "synthesised by LLM" : page.generated_by === "user" ? "edited by hand" : "compiled from data"}</Badge>}
          {page && <span className="text-[11px] text-muted-foreground">updated {timeAgo(page.updated_at)}</span>}
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => act("refresh")} disabled={!!busy}><RefreshCw className={cn("size-4", busy === "refresh" && "animate-spin")} /> Recompile</Button>
            <Button size="sm" variant="outline" onClick={() => act("llm")} disabled={!!busy}><Sparkles className="size-4" /> {busy === "llm" ? "Synthesising…" : "Synthesise"}</Button>
            {!editing ? <Button size="sm" variant="outline" onClick={() => { setDraft(page?.content ?? ""); setEditing(true); }} disabled={!page}><Pencil className="size-4" /> Edit</Button>
              : <><Button size="sm" onClick={() => act("save")} disabled={busy === "save"}><Save className="size-4" /> Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="size-4" /></Button></>}
            <Button size="sm" variant="outline" onClick={() => setRevOpen(true)} disabled={!page}><History className="size-4" /> Revisions</Button>
          </div>
        </div>

        {error ? <ErrorBox error={error} /> : isLoading && !page ? <Loading /> : !page ? <Empty>No such page.</Empty> : editing ? (
          <div className="grid gap-3 xl:grid-cols-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[70vh] font-mono text-xs" />
            <Card className="bg-card/60"><CardContent className="p-5"><div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground"><Eye className="size-3.5" /> Preview</div><Markdown content={draft} scope={scope} /></CardContent></Card>
          </div>
        ) : (
          <Card className="bg-card/60"><CardContent className="p-6"><Markdown content={page.content} scope={scope} /></CardContent></Card>
        )}

        {page && !editing && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="bg-card/60"><CardContent className="p-4 text-xs">
              <div className="mb-2 flex items-center gap-1 text-muted-foreground"><Link2 className="size-3.5" /> Backlinks ({page.backlinks.length})</div>
              <div className="flex flex-wrap gap-1">{page.backlinks.map((b) => <button key={b} onClick={() => go(b)}><Badge variant="outline">{b}</Badge></button>)}{!page.backlinks.length && <span className="text-muted-foreground">No page links here yet.</span>}</div>
            </CardContent></Card>
            <Card className="bg-card/60"><CardContent className="p-4 text-xs">
              <div className="mb-2 flex items-center gap-1 text-muted-foreground"><ScrollText className="size-3.5" /> Recent wiki activity</div>
              <ul className="space-y-1">{log?.map((l) => <li key={l.id}><span className="text-primary">{l.action}</span> {l.summary} <span className="text-muted-foreground">· {timeAgo(l.created_at)}</span></li>)}</ul>
            </CardContent></Card>
          </div>
        )}
      </div>

      <Dialog open={revOpen} onOpenChange={(o) => { setRevOpen(o); if (!o) setRevView(null); }}>
        <DialogContent className="max-h-[85vh] sm:max-w-4xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileClock className="size-5 text-primary" /> Revisions of {page?.title}</DialogTitle></DialogHeader>
          <div className="grid gap-3 md:grid-cols-[200px_1fr]">
            <ScrollArea className="h-[60vh]">
              <ul className="space-y-1 pr-2">
                {revisions?.map((r) => (
                  <li key={r.id}><button onClick={() => setRevView(r)} className={cn("w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted", revView?.id === r.id && "bg-primary/15")}>
                    v{r.version} · {r.author}<div className="text-[10px] text-muted-foreground">{timeAgo(r.created_at)}</div></button></li>
                ))}
              </ul>
            </ScrollArea>
            <ScrollArea className="h-[60vh] rounded-md border border-border p-3">
              {revView ? <Markdown content={revView.content} scope={scope} /> : <p className="text-xs text-muted-foreground">Choose a revision.</p>}
            </ScrollArea>
          </div>
          {revView && <Button variant="outline" onClick={() => { setDraft(revView.content); setEditing(true); setRevOpen(false); }}>Restore this version into the editor</Button>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!lint} onOpenChange={(o) => !o && setLint(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /> Wiki health</DialogTitle></DialogHeader>
          {lint && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">{lint.pages} pages checked.</p>
              {([["Contradictions", lint.contradictions.map((c) => `${c.page}: ${c.issue}`)], ["Stale (newer memories exist)", lint.stale], ["Broken links", lint.broken_links.map((b) => `${b.page} → ${b.link}`)], ["Orphans (nothing links here)", lint.orphans]] as const).map(([t, items]) => (
                <div key={t}><div className="font-medium">{t} <Badge variant="outline">{items.length}</Badge></div>
                  <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-xs text-muted-foreground">{items.slice(0, 50).map((x) => <li key={x}>{x}</li>)}</ul></div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function WikiPageRoute() {
  return <Suspense fallback={<Loading />}><WikiInner /></Suspense>;
}
