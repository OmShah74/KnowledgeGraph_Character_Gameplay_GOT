"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { AnimatePresence } from "motion/react";
import { ArrowLeft, Bird, Brain, Eye, EyeOff, Feather, Trash2, Users } from "lucide-react";
import { api, errorMessage, fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import type { Check, Message, PlayerState, Thread } from "@/lib/types";
import { ordLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ErrorBox, Loading } from "@/components/common";
import { MessageList } from "@/components/thread/message-list";
import { Composer, type IntentId } from "@/components/thread/composer";
import { MindPanel } from "@/components/thread/mind-panel";
import { CharacterStage, CourtScene, FateCheck } from "@/components/three/lazy";
import type { Reaction } from "@/components/three/character-figure";

type CharInfo = { id: string; name: string; house: string | null; gender: string; culture: string; tier: string; stats: Record<string, number>; titles: string[] };
type SendResult = { messages: Message[]; outcomes: { name: string; learned: string[]; quest?: string; quests_completed?: string[]; relationship: { stance: string; previous_stance?: string } }[] };

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { playerId } = usePlayer();
  const { data: thread, error, mutate } = useSWR<Thread>(`/api/threads/${id}`, fetcher);
  const { data: state, mutate: mutateState } = useSWR<PlayerState>(thread ? `/api/players/${thread.player_id}` : null, fetcher);
  const [busy, setBusy] = useState(false);
  const [omniscient, setOmniscient] = useState(false);
  const [fate, setFate] = useState<Check | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [talking, setTalking] = useState<string | null>(null);
  const [reaction, setReaction] = useState<Reaction>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const charIds = useMemo(() => thread?.character_ids ?? [], [thread]);
  const { data: chars } = useSWR<CharInfo[]>(charIds.length ? ["chars", charIds.join(",")] : null,
    () => Promise.all(charIds.map((c) => api.get<CharInfo>(`/api/characters/${c}`, { player_id: thread?.player_id }))));

  useEffect(() => {
    if (!focus && charIds.length) setFocus(charIds[0]);
  }, [charIds, focus]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread?.messages.length, busy]);

  if (error) return <ErrorBox error={error} />;
  if (!thread) return <Loading label="Unrolling the conversation…" />;

  const houses = Object.fromEntries((chars ?? []).map((c) => [c.id, c.house]));
  const names = Object.fromEntries((state?.present ?? []).map((c) => [c.id, c.name]).concat((chars ?? []).map((c) => [c.id, c.name])));
  const isScene = thread.kind === "scene";
  const isRaven = thread.kind === "raven";
  const ord = state?.player.ord ?? thread.ord;
  const focusChar = chars?.find((c) => c.id === focus);
  const rel = focus ? thread.relationships[focus] : undefined;
  const leftPlace = state && !isRaven && state.player.location_id !== thread.location_id;

  async function after(res: SendResult) {
    const firstCheck = res.messages.find((m) => m.meta?.check)?.meta.check ?? null;
    if (firstCheck) setFate(firstCheck);
    const speaker = res.messages[res.messages.length - 1]?.speaker_id ?? null;
    setTalking(speaker);
    setTimeout(() => setTalking(null), 3500);
    res.outcomes.forEach((o) => {
      o.learned?.forEach((l) => toast(`${o.name} learned something`, { description: l }));
      if (o.quest) toast.success(`${o.name} gives you a quest`, { description: o.quest });
      o.quests_completed?.forEach((q) => toast.success(`Quest completed: ${q}`));
      if (o.relationship?.previous_stance && o.relationship.stance !== o.relationship.previous_stance) {
        toast(`${o.name} now regards you as: ${o.relationship.stance}`);
      }
    });
    await Promise.all([mutate(), mutateState()]);
  }

  async function send(text: string, intent: IntentId, target: string | null, gold: number) {
    setBusy(true);
    setFate(null);
    try {
      const res = await api.post<SendResult>(`/api/threads/${id}/messages`, { content: text, intent, target_id: target, gold });
      await after(res);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function cont() {
    setBusy(true);
    try {
      await after(await api.post<SendResult>(`/api/threads/${id}/continue`));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function reflect() {
    try {
      await api.post(`/api/threads/${id}/reflect`, undefined, { now: true });
      toast.success("They reflect on what was said — memories consolidated, lessons learned.");
      mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove(withMemories: boolean) {
    try {
      await api.del(`/api/threads/${id}`, { delete_memories: withMemories });
      toast.success("Conversation deleted.");
      router.push("/play");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function touch() {
    const d = rel?.disposition;
    setReaction(null);
    setTimeout(() => setReaction(d === "friendly" ? "wave" : d === "hostile" ? "steel" : "nod"), 10);
  }

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild><Link href="/play"><ArrowLeft className="size-4" /> Back</Link></Button>
        <div className="flex items-center gap-2">
          {isRaven ? <Bird className="size-5 text-sky-300" /> : isScene ? <Users className="size-5 text-primary" /> : <Feather className="size-5 text-primary" />}
          <h1 className="font-display text-xl text-primary">{thread.title}</h1>
          <Badge variant="outline">{ordLabel(thread.ord)}</Badge>
          {isRaven && <Badge variant="secondary">by raven</Badge>}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5" title="Show every character's private thoughts (spoils the intrigue)">
            <Switch id="omni" checked={omniscient} onCheckedChange={setOmniscient} />
            <Label htmlFor="omni" className="flex items-center gap-1 text-xs">{omniscient ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />} Omniscient</Label>
          </div>
          <Button variant="outline" size="sm" onClick={reflect}><Brain className="size-4" /> Reflect now</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="ghost" size="sm" aria-label="Delete conversation"><Trash2 className="size-4" /></Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
                <AlertDialogDescription>You can delete only the transcript (they still remember), or also erase what they remember from it.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => remove(false)}>Transcript only</AlertDialogAction>
                <AlertDialogAction onClick={() => remove(true)} className="bg-destructive text-white hover:bg-destructive/90">Transcript and memories</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_340px]">
        {/* stage */}
        <div className="space-y-3">
          <Card className="overflow-hidden bg-black/30">
            {chars && (isScene ? (
              <CourtScene people={chars.map((c) => ({ ...c, mood: thread.relationships[c.id]?.mood }))} ord={ord} talkingId={talking}
                selected={focus ? [focus] : []} onSelect={setFocus} height={360} />
            ) : focusChar ? (
              <CharacterStage character={focusChar} ord={ord} mood={rel?.mood} talking={talking === focusChar.id || busy} reaction={reaction} onTouch={touch} height={360} />
            ) : null)}
            <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              {isScene ? "Click someone to see their mind." : "Drag to turn them. Click them to get a reaction — it depends on how they feel about you."}
            </div>
          </Card>
          {isScene && (
            <div className="flex flex-wrap gap-1.5">
              {thread.characters.map((c) => (
                <Button key={c.id} size="sm" variant={focus === c.id ? "default" : "outline"} className="h-7 text-xs" onClick={() => setFocus(c.id)}>{c.name}</Button>
              ))}
            </div>
          )}
        </div>

        {/* conversation */}
        <div className="flex min-h-[70vh] min-w-0 flex-col gap-3">
          <Card className="flex-1 overflow-y-auto bg-card/40 p-4" style={{ maxHeight: "calc(100vh - 340px)" }}>
            <MessageList messages={thread.messages} houses={houses} omniscient={omniscient} playerName={state?.player.name ?? "You"} />
            {busy && (
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${i * 120}ms` }} />)}</span>
                {isRaven ? "The raven flies…" : "They consider your words…"}
              </div>
            )}
            <div ref={bottom} />
          </Card>
          <AnimatePresence>{fate && <FateCheck key={`${fate.roll}-${fate.total}-${fate.dc}`} check={fate} onClose={() => setFate(null)} />}</AnimatePresence>
          {leftPlace ? (
            <div className="rounded-lg border border-amber-400/30 bg-amber-500/5 p-3 text-sm text-amber-100">
              You have left this place. Return here, start a new conversation where you are, or send a raven.
            </div>
          ) : (
            <Composer onSend={send} onContinue={isScene ? cont : undefined} busy={busy} isScene={isScene} isRaven={isRaven}
              participants={thread.characters} gold={state?.player.gold ?? 0} />
          )}
        </div>

        {/* mind */}
        <div>
          {focus && playerId && <MindPanel playerId={thread.player_id} characterId={focus} links={thread.links} names={names} />}
        </div>
      </div>
    </div>
  );
}
