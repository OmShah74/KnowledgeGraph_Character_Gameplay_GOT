"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Database, FileUp, RefreshCw, Search, UserX } from "lucide-react";
import { api, errorMessage, fetcher } from "@/lib/api";
import type { Episode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loading, PageHeader, Stat } from "@/components/common";

type Status = {
  script_ingested: boolean; graph_built: boolean; script_path: string | null; characters: number; lines: number; episodes: number;
  top_speakers: { id: string; name: string; line_count: number }[]; unmapped_speakers: { speaker_raw: string; n: number }[];
  lines_per_season: { season: number; n: number }[]; hand_written_personas: string[];
};
type ScriptLine = { id: number; ord: number; label?: string; line_no: number; speaker_raw: string; character_id: string | null; character_name: string | null; sentence: string };

function EpisodeReader({ ord }: { ord: number }) {
  const { data } = useSWR<ScriptLine[]>(`/api/script/episode/${ord}`, fetcher);
  if (!data) return <Loading />;
  return (
    <ul className="space-y-1">
      {data.map((l) => (
        <li key={l.id} className="grid grid-cols-[150px_1fr] gap-3 text-sm">
          {l.character_id ? <Link href={`/characters/${l.character_id}`} prefetch={false} className="truncate text-right font-display text-xs text-primary hover:underline">{l.character_name}</Link>
            : <span className="truncate text-right text-xs italic text-muted-foreground">{l.speaker_raw}</span>}
          <span className="text-foreground/90">{l.sentence}</span>
        </li>
      ))}
    </ul>
  );
}

export default function DataPage() {
  const { data: status, mutate } = useSWR<Status>("/api/data/status", fetcher);
  const { data: episodes } = useSWR<Episode[]>("/api/episodes", fetcher);
  const [ep, setEp] = useState(1);
  const [q, setQ] = useState("");
  const { data: hits } = useSWR<ScriptLine[]>(q.length > 2 ? ["/api/script/search", { q, limit: 80 }] : null, fetcher);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function reingest() {
    setBusy(true);
    try {
      const r = await api.post<{ ingest: { rows: number }; archived: { file: string } }>("/api/data/reingest", { confirm: true });
      toast.success(`Re-ingested ${r.ingest.rows} lines. Previous state archived as ${r.archived.file}.`);
      mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(f: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await api.post<{ ingest: { rows: number; auto_characters: number }; columns: Record<string, string> }>("/api/data/upload", fd);
      toast.success(`Ingested ${r.ingest.rows} lines; ${r.ingest.auto_characters} new speakers discovered.`, { description: `Columns: ${Object.entries(r.columns).map(([k, v]) => `${k}=${v}`).join(", ")}` });
      mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!status) return <Loading />;
  const maxSeason = Math.max(...status.lines_per_season.map((s) => s.n), 1);
  const cur = episodes?.find((e) => e.ord === ep);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Script Data" subtitle="The screenplay of all eight seasons is the foundation: every line is indexed for search, speakers are resolved to characters, and conversations between them become relationships, memories and voices.">
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}><FileUp className="size-4" /> Upload CSV / XLSX</Button>
        <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="outline" size="sm" disabled={busy}><RefreshCw className={cn("size-4", busy && "animate-spin")} /> Re-ingest</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Re-ingest the script?</AlertDialogTitle>
              <AlertDialogDescription>Characters, canon memories and the canon knowledge graph are rebuilt from the script file. The current database is archived first. Player worlds are kept.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={reingest}>Archive and re-ingest</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageHeader>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Lines" value={status.lines.toLocaleString()} />
        <Stat label="Episodes" value={status.episodes} />
        <Stat label="Characters" value={status.characters} />
        <Stat label="Hand-written personas" value={status.hand_written_personas.length} />
        <Stat label="Graph" value={status.graph_built ? "built" : "pending"} />
      </div>
      <Tabs defaultValue="reader">
        <TabsList>
          <TabsTrigger value="reader">Script reader</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="stats">Statistics</TabsTrigger>
        </TabsList>
        <TabsContent value="reader" className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="bg-card/60">
            <ScrollArea className="h-[70vh]">
              <ul className="p-2">
                {episodes?.map((e) => (
                  <li key={e.ord}><button onClick={() => setEp(e.ord)} className={cn("w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted", ep === e.ord && "bg-primary/15 text-primary")}>
                    <span className="mr-2 font-mono text-[11px]">{e.label}</span>{e.title}</button></li>
                ))}
              </ul>
            </ScrollArea>
          </Card>
          <Card className="bg-card/60">
            <CardHeader className="pb-2">
              <CardTitle className="font-display">{cur?.label} · {cur?.title}</CardTitle>
              <div className="flex flex-wrap gap-1 text-xs">{cur?.events.map((e) => <Badge key={e} variant="outline">{e}</Badge>)}<span className="text-muted-foreground">{cur?.line_count} lines · aired {cur?.release_date}</span></div>
            </CardHeader>
            <CardContent><ScrollArea className="h-[62vh] pr-3"><EpisodeReader ord={ep} /></ScrollArea></CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="search" className="space-y-3">
          <div className="relative max-w-xl"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every line ever spoken (e.g. winter is coming)" className="pl-8" /></div>
          <ul className="space-y-1.5">
            {hits?.map((h) => (
              <li key={h.id} className="grid grid-cols-[70px_150px_1fr] gap-3 rounded-md border border-border/60 bg-black/20 px-3 py-2 text-sm">
                <button onClick={() => setEp(h.ord)} className="text-left font-mono text-[11px] text-primary">{h.label}</button>
                <span className="truncate text-xs">{h.character_name ?? h.speaker_raw}</span>
                <span>{h.sentence}</span>
              </li>
            ))}
          </ul>
        </TabsContent>
        <TabsContent value="stats" className="grid gap-4 md:grid-cols-2">
          <Card className="bg-card/60">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Database className="size-4 text-primary" /> Lines per season</CardTitle></CardHeader>
            <CardContent>
              <div className="flex h-48 items-end gap-2">
                {status.lines_per_season.map((s) => (
                  <div key={s.season} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] tabular-nums text-muted-foreground">{s.n}</span>
                    <div className="w-full rounded-t bg-gradient-to-t from-primary/40 to-primary" style={{ height: `${(s.n / maxSeason) * 150}px` }} />
                    <span className="text-xs">S{s.season}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/60">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Most lines</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {status.top_speakers.slice(0, 15).map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <Link href={`/characters/${s.id}`} prefetch={false} className="w-40 truncate hover:text-primary">{s.name}</Link>
                  <div className="h-2 flex-1 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(s.line_count / status.top_speakers[0].line_count) * 100}%` }} /></div>
                  <span className="w-12 text-right tabular-nums">{s.line_count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="bg-card/60 md:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><UserX className="size-4" /> Speakers not resolved to a character (crowds, roles, noise)</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">{status.unmapped_speakers.map((u) => <Badge key={u.speaker_raw} variant="outline">{u.speaker_raw} · {u.n}</Badge>)}</CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
