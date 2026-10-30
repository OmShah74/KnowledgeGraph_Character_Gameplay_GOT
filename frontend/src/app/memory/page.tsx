"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Search, Trash2 } from "lucide-react";
import { api, errorMessage, fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import type { CharacterListItem, Memory } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Empty, PageHeader, Stat } from "@/components/common";
import { MemoryItem, MemoryManager } from "@/components/memory-manager";
import { ArtifactShowcase } from "@/components/three/lazy";

type Stats = { by_kind: Record<string, number>; total: number; top_characters: { character_id: string; name: string; n: number }[] };

export default function MemoryPage() {
  const { playerId } = usePlayer();
  const [character, setCharacter] = useState<string>("tyrion_lannister");
  const [q, setQ] = useState("");
  const { data: chars } = useSWR<{ items: CharacterListItem[] }>(["/api/characters", { limit: 400 }], fetcher);
  const { data: stats, mutate: mutateStats } = useSWR<Stats>(["/api/memories/stats", { player_id: playerId ?? undefined }], fetcher);
  const { data: search } = useSWR<{ items: Memory[]; total: number }>(q ? ["/api/memories", { q, player_id: playerId ?? undefined, limit: 50 }] : null, fetcher);

  async function wipeAll() {
    if (!playerId) return;
    try {
      const r = await api.del<{ deleted: number }>("/api/memories", { player_id: playerId });
      toast.success(`Erased ${r.deleted} memories from your world.`);
      mutateStats();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 grid items-center gap-4 md:grid-cols-[1fr_220px]">
        <PageHeader title="The Weirwood of Memory" subtitle="Every character keeps long-term memories: canon recollections from the script, shared history with each person they know, and everything that happens in your world. Search, test recall, plant and erase." />
        <ArtifactShowcase kind="weirwood" className="hidden h-44 md:block" spin={0.15} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Memories in scope" value={stats?.total?.toLocaleString() ?? "…"} />
        {Object.entries(stats?.by_kind ?? {}).slice(0, 3).map(([k, v]) => <Stat key={k} label={k.replace("_", " ")} value={v.toLocaleString()} />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="bg-card/60">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Whose mind?</CardTitle></CardHeader>
            <CardContent>
              <Select value={character} onValueChange={setCharacter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-80">
                  {chars?.items.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          {playerId && stats?.top_characters?.length ? (
            <Card className="bg-card/60">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Who remembers you most</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {stats.top_characters.map((t) => (
                  <button key={t.character_id} onClick={() => setCharacter(t.character_id)} className="flex w-full justify-between rounded px-2 py-1 text-left text-xs hover:bg-muted">
                    <span>{t.name}</span><span className="tabular-nums text-muted-foreground">{t.n}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          ) : null}
          {playerId && (
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="outline" className="w-full text-red-300"><Trash2 className="size-4" /> Erase all memories of your world</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Make every character forget you?</AlertDialogTitle>
                  <AlertDialogDescription>All memories created in this playthrough are erased. Canon memories remain. Relationships and learned behaviour are not changed.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={wipeAll} className="bg-destructive text-white hover:bg-destructive/90">Erase</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        <div className="space-y-6">
          <div>
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search across every character's memories…" className="pl-8" />
            </div>
            {q && (search?.items.length ? <ul className="space-y-2">{search.items.map((m) => <MemoryItem key={m.id} m={m} showOwner />)}</ul> : <Empty>No memories contain that.</Empty>)}
          </div>
          {!q && <MemoryManager key={character} characterId={character} playerId={playerId} />}
        </div>
      </div>
    </div>
  );
}
