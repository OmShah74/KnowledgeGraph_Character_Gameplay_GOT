"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Brain, Plus, Search, Trash2, Wand2 } from "lucide-react";
import { api, errorMessage, fetcher } from "@/lib/api";
import type { Memory } from "@/lib/types";
import { ordLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Empty } from "@/components/common";

const KIND_STYLE: Record<string, string> = {
  canon: "border-stone-400/40 text-stone-300", canon_event: "border-amber-400/40 text-amber-200", episodic: "border-sky-400/40 text-sky-300",
  semantic: "border-violet-400/40 text-violet-300", reflection: "border-emerald-400/40 text-emerald-300", world: "border-orange-400/40 text-orange-300",
};

export function MemoryItem({ m, onDelete, showOwner = false }: { m: Memory; onDelete?: (id: number) => void; showOwner?: boolean }) {
  return (
    <li className="group rounded-lg border border-border bg-black/20 p-3 text-sm">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <Badge variant="outline" className={cn("h-5 text-[10px]", KIND_STYLE[m.kind])}>{m.kind.replace("_", " ")}</Badge>
        <span className="font-mono">{ordLabel(m.ord)}</span>
        {showOwner && m.character_name && <span>· {m.character_name}</span>}
        {m.counterpart_name && <span>· about {m.counterpart_name}</span>}
        {m.player_id ? <span className="text-sky-300">· your world</span> : <span>· canon</span>}
        {m.emotion && <span>· {m.emotion}</span>}
        {typeof m.score === "number" && <span className="text-primary">· score {m.score.toFixed(2)}</span>}
        <span className="ml-auto" title="importance">★ {m.importance.toFixed(2)}</span>
        {onDelete && (
          <button onClick={() => onDelete(m.id)} className="opacity-0 transition-opacity group-hover:opacity-100" aria-label="Delete memory">
            <Trash2 className="size-3.5 text-red-400" />
          </button>
        )}
      </div>
      <p className="leading-relaxed text-foreground/90">{m.content}</p>
    </li>
  );
}

export function MemoryManager({ characterId, playerId, ord }: { characterId: string; playerId?: string | null; ord?: number }) {
  const [scope, setScope] = useState<"all" | "canon" | "player">(playerId ? "all" : "canon");
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [recallQ, setRecallQ] = useState("");
  const [limit, setLimit] = useState(40);
  const key = ["/api/memories", { character_id: characterId, player_id: playerId ?? undefined, scope, kind: kind === "all" ? undefined : kind, q: q || undefined, ord_max: ord, limit }] as const;
  const { data, mutate } = useSWR<{ items: Memory[]; total: number }>(key as unknown as [string, Record<string, string | number | undefined>], fetcher, { keepPreviousData: true });
  const { data: recall, isLoading: recalling } = useSWR<Memory[]>(recallQ ? ["/api/memories/recall", { character_id: characterId, q: recallQ, ord: ord ?? 73, player_id: playerId ?? undefined, k: 8 }] : null, fetcher);
  const [draft, setDraft] = useState({ content: "", kind: "semantic", importance: 0.6 });
  const [addOpen, setAddOpen] = useState(false);

  async function del(id: number) {
    try {
      await api.del(`/api/memories/${id}`);
      toast.success("Memory erased.");
      mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function add() {
    try {
      await api.post("/api/memories", { character_id: characterId, player_id: draft.kind === "canon" ? null : playerId ?? null, content: draft.content, kind: draft.kind, importance: draft.importance, ord: ord ?? 0 });
      toast.success("Memory planted.");
      setAddOpen(false);
      setDraft({ content: "", kind: "semantic", importance: 0.6 });
      mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-primary"><Wand2 className="size-3.5" /> Recall test — what would come to their mind if someone said…</div>
        <form onSubmit={(e) => { e.preventDefault(); setRecallQ((e.currentTarget.elements.namedItem("rq") as HTMLInputElement).value); }} className="flex gap-2">
          <Input name="rq" placeholder="e.g. my father, the Wall, dragons, a betrayal" />
          <Button type="submit" variant="outline">Recall</Button>
        </form>
        {recallQ && (
          <ul className="mt-3 space-y-2">
            {recalling && <li className="text-xs text-muted-foreground">Searching memory…</li>}
            {recall?.map((m) => <MemoryItem key={m.id} m={m} />)}
            {recall && !recall.length && <li className="text-xs text-muted-foreground">Nothing surfaces.</li>}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memories…" className="pl-8" />
        </div>
        <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Canon + your world</SelectItem>
            <SelectItem value="canon">Canon only</SelectItem>
            <SelectItem value="player" disabled={!playerId}>Your world only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["all", "canon", "canon_event", "episodic", "semantic", "reflection", "world"].map((k) => <SelectItem key={k} value={k}>{k === "all" ? "All kinds" : k.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild><Button variant="outline"><Plus className="size-4" /> Plant a memory</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Brain className="size-5 text-primary" /> Plant a memory</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="Write it in their voice, e.g. “The stranger saved my life on the Kingsroad.”" />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Kind</Label>
                  <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["semantic", "episodic", "reflection", "world", "canon"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Importance {draft.importance.toFixed(2)}</Label>
                  <Slider min={0} max={1} step={0.05} value={[draft.importance]} onValueChange={([v]) => setDraft({ ...draft, importance: v })} className="mt-3" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{draft.kind === "canon" ? "Canon memories are shared by every playthrough." : playerId ? "This memory exists only in your current world." : "Without an active tale this becomes a canon memory."}</p>
            </div>
            <DialogFooter><Button onClick={add} disabled={!draft.content.trim()}>Plant</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="text-xs text-muted-foreground">{data?.total ?? 0} memories{ord ? ` up to ${ordLabel(ord)}` : ""}. Hover a memory to erase it.</div>
      {data && !data.items.length ? <Empty>No memories match.</Empty> : (
        <ul className="space-y-2">{data?.items.map((m) => <MemoryItem key={m.id} m={m} onDelete={del} />)}</ul>
      )}
      {data && data.total > data.items.length && <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + 40)}>Load more</Button>}
    </div>
  );
}
