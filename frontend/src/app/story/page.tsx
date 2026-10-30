"use client";

/**
 * Story Mode — the series as a playable RPG.
 *
 * Flow:  title card → canon beats (voiced, with bubbles) → you may speak up at any moment →
 *        characters answer in character → the scene resumes → "scene complete" → next scene
 *        (the story carries you there) → … → "chapter complete" → ravens bring news → next episode.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import {
  BookOpenText, CheckCircle2, Circle, Clapperboard, Crown, FastForward, Flag, Keyboard, LayoutDashboard, ListOrdered, MapPin, MessagesSquare, Pause, Play,
  ScrollText, SkipForward, Volume2, VolumeX, X,
} from "lucide-react";
import { api, errorMessage, fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import type { Check, Message, Player, Thread } from "@/lib/types";
import { ordLabel } from "@/lib/format";
import { PRESETS } from "@/lib/presets";
import { speak, stopSpeaking, ttsSupported } from "@/lib/voice";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CharacterSeal, Glyph } from "@/components/heraldry";
import { Loading, ErrorBox } from "@/components/common";
import { RelationshipBars } from "@/components/relationship-bars";
import { TimeReportDialog, type TickReport } from "@/components/play/time-report";
import { FateCheck, StoryStage } from "@/components/three/lazy";
import { DialogueBox, type Line, type Option } from "@/components/story/dialogue-box";
import { SceneRail, type SceneCard } from "@/components/story/scene-rail";
import { HOUSE_OF_LOCATION, playerAppearance, type SetId, type StageCharacter } from "@/components/story/stage-data";
import type { IntentId } from "@/components/thread/composer";

type Chapter = {
  player: Player;
  chapter: { ord: number; label: string; title: string; events: { id: string; title: string; description: string }[]; season: number; episode: number };
  scenes: SceneCard[]; done: number; total: number; current_scene_id: string | null; chapter_complete: boolean; is_last_chapter: boolean;
  series_progress: { seen: number; total: number };
};
type Beat = { i: number; speaker_id: string | null; speaker_name: string; text: string; extra: boolean };
type SceneDetail = SceneCard & { beats: Beat[]; characters: StageCharacter[]; thread_id?: string };
type Mode = "loading" | "intro" | "playing" | "paused" | "player_turn" | "awaiting" | "scene_end" | "chapter_end";

const LS_AUTO = "got.story.autoplay";
const LS_VOICE = "got.story.voice";
const readBool = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch { return d; } };
const writeBool = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* ignore */ } };

function QuickStart({ onStarted, onCancel }: { onStarted?: () => void; onCancel?: () => void }) {
  const router = useRouter();
  const { setPlayerId } = usePlayer();
  const [busy, setBusy] = useState<string | null>(null);
  async function begin(id: string) {
    const p = PRESETS.find((x) => x.id === id)!;
    setBusy(id);
    try {
      const pl = await api.post<Player>("/api/players", { name: p.name, background: p.background, allegiance: p.allegiance, season: p.season, episode: p.episode, location_id: p.location_id });
      setPlayerId(pl.id);
      onStarted?.();
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="mx-auto max-w-5xl py-6">
      <div className="mb-6 text-center">
        <Clapperboard className="mx-auto mb-2 size-8 text-primary" />
        <h1 className="font-display text-3xl text-primary md:text-4xl">Begin your journey</h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">Choose who you are. The story will carry you from scene to scene — speak up whenever you wish, and the realm will remember.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {PRESETS.map((p) => (
          <Card key={p.id} className="group overflow-hidden border-border/80 bg-card/70 transition-all hover:-translate-y-0.5 hover:border-primary/60">
            <CardContent className="flex h-full flex-col gap-3 p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-12 items-center justify-center rounded-full border border-primary/40 bg-black/40"><Glyph name={p.glyph} className="size-7" color="#e8c26a" /></span>
                <div>
                  <div className="font-display text-lg">{p.title}</div>
                  <div className="text-xs text-muted-foreground">S{p.season}E{p.episode} · {p.name}</div>
                </div>
              </div>
              <p className="flex-1 text-sm text-foreground/80">{p.hook}</p>
              <Button onClick={() => begin(p.id)} disabled={!!busy}>{busy === p.id ? "Riding out…" : "Begin"}</Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {onCancel && <div className="mt-4 text-center"><Button variant="ghost" onClick={onCancel}>Back to my current journey</Button></div>}
      <p className="mt-6 text-center text-xs text-muted-foreground">Want full control over name, house, time and place? Use <Link href="/" className="text-primary underline">the detailed creator on the Realm page</Link>.</p>
    </div>
  );
}

export default function StoryPage() {
  const { playerId, ready } = usePlayer();
  const [starting, setStarting] = useState(false);
  if (!ready) return <Loading />;
  if (!playerId || starting) return <QuickStart onStarted={() => setStarting(false)} onCancel={playerId ? () => setStarting(false) : undefined} />;
  return <StoryGame key={playerId} playerId={playerId} onNewJourney={() => { stopSpeaking(); setStarting(true); }} />;
}

function StoryGame({ playerId, onNewJourney }: { playerId: string; onNewJourney: () => void }) {
  const { data: chapter, error, mutate } = useSWR<Chapter>(playerId ? `/api/story/${playerId}` : null, fetcher);
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [line, setLine] = useState<Line | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [near, setNear] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [fate, setFate] = useState<Check | null>(null);
  const [reports, setReports] = useState<TickReport[] | null>(null);
  const [autoplay, setAutoplay] = useState(true);
  const [voice, setVoice] = useState(true);
  const [rail, setRail] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [help, setHelp] = useState(false);

  const beatRef = useRef(0);
  const queueRef = useRef<Line[]>([]);
  const tokenRef = useRef(0);
  const modeRef = useRef<Mode>("loading");
  const autoRef = useRef(true);
  const voiceRef = useRef(true);
  const sceneRef = useRef<SceneDetail | null>(null);
  modeRef.current = mode;
  autoRef.current = autoplay;
  voiceRef.current = voice;
  sceneRef.current = scene;

  useEffect(() => { setAutoplay(readBool(LS_AUTO, true)); setVoice(readBool(LS_VOICE, ttsSupported())); }, []);
  useEffect(() => () => stopSpeaking(), []);

  const { data: thread, mutate: mutateThread } = useSWR<Thread>(scene?.thread_id ? `/api/threads/${scene.thread_id}` : null, fetcher);
  const houses = useMemo(() => Object.fromEntries((scene?.characters ?? []).map((c) => [c.id, c.house ?? null])), [scene]);
  const genders = useMemo(() => Object.fromEntries((scene?.characters ?? []).map((c) => [c.id, c.gender])), [scene]);
  const player = chapter?.player;
  const avatar = useMemo(() => (player ? playerAppearance(player.background, player.allegiance, player.name) : null), [player]);

  // ---------------------------------------------------------------- playback
  const showLine = useCallback(async (l: Line) => {
    const token = ++tokenRef.current;
    setLine(l);
    setSpeaking(l.kind === "player" ? "player" : l.speakerId);
    await speak(l.text, { seed: l.speakerId ?? l.name, gender: l.kind === "player" ? "male" : genders[l.speakerId ?? ""] }, voiceRef.current && l.kind !== "narrator");
    if (token !== tokenRef.current) return false;
    setSpeaking(null);
    return true;
  }, [genders]);

  const advance = useCallback(async () => {
    const sc = sceneRef.current;
    if (!sc || !playerId) return;
    let next = queueRef.current.shift();
    if (!next) {
      const i = beatRef.current;
      if (i >= sc.beats.length) {
        stopSpeaking();
        setSpeaking(null);
        setMode("scene_end");
        return;
      }
      const b = sc.beats[i];
      beatRef.current = i + 1;
      void api.post(`/api/story/${playerId}/scenes/${sc.id}/beat`, { index: i }).catch(() => undefined);
      next = { key: `b${sc.id}-${i}`, speakerId: b.speaker_id, name: b.speaker_name, house: b.speaker_id ? houses[b.speaker_id] : null,
        text: b.text, kind: b.extra ? "narrator" : "canon" };
      if (b.extra) next = { ...next, text: `${b.speaker_name}: ${b.text}` };
    }
    const finished = await showLine(next);
    if (finished && autoRef.current && modeRef.current === "playing") {
      setTimeout(() => { if (modeRef.current === "playing") void advance(); }, 420);
    }
  }, [playerId, houses, showLine]);

  const enterScene = useCallback(async (sid: string) => {
    if (!playerId) return;
    tokenRef.current++;
    stopSpeaking();
    setMode("loading");
    setLine(null);
    setSpeaking(null);
    setFate(null);
    try {
      const sc = await api.post<SceneDetail>(`/api/story/${playerId}/scenes/${sid}/enter`, { follow: true });
      beatRef.current = sc.beat_index;
      queueRef.current = [];
      setScene(sc);
      setTarget(null);
      setMode("intro");
      void mutate();
    } catch (e) {
      toast.error(errorMessage(e));
      setMode("paused");
    }
  }, [playerId, mutate]);

  // first scene of the chapter
  useEffect(() => {
    if (!chapter || scene || mode !== "loading" || reports) return;
    if (chapter.current_scene_id) void enterScene(chapter.current_scene_id);
    else setMode("chapter_end");
  }, [chapter, scene, mode, reports, enterScene]);

  // the title card fades into the scene
  useEffect(() => {
    if (mode !== "intro") return;
    const id = setTimeout(() => { setMode("playing"); void advance(); }, 2600);
    return () => clearTimeout(id);
  }, [mode, advance]);

  const speakUp = useCallback(async (who?: string | null) => {
    const sc = sceneRef.current;
    if (!sc || !playerId) return;
    tokenRef.current++;
    stopSpeaking();
    setSpeaking(null);
    const tgt = who ?? target ?? null;
    setTarget(tgt);
    setMode("player_turn");
    setOptions([]);
    setOptionsLoading(true);
    try {
      setOptions(await api.get<Option[]>(`/api/story/${playerId}/scenes/${sc.id}/options`, { target_id: tgt ?? undefined }));
    } catch {
      setOptions([]);
    } finally {
      setOptionsLoading(false);
    }
  }, [playerId, target]);

  const send = useCallback(async (text: string, intent: IntentId) => {
    const sc = sceneRef.current;
    if (!sc?.thread_id || !playerId) return;
    setMode("awaiting");
    setLine(null);
    setSpeaking("player");
    setLine({ key: `p${Date.now()}`, speakerId: null, name: player?.name ?? "You", text, kind: "player" });
    try {
      const res = await api.post<{ messages: Message[] }>(`/api/threads/${sc.thread_id}/messages`, { content: text, intent, target_id: target });
      const check = res.messages.find((m) => m.meta?.check)?.meta.check ?? null;
      if (check) setFate(check);
      queueRef.current = res.messages.map((m) => ({
        key: `m${m.id}`, speakerId: m.speaker_id, name: m.speaker_name ?? "Someone", house: m.speaker_id ? houses[m.speaker_id] : null,
        text: m.content, kind: "agent" as const, action: m.meta?.action || undefined,
      }));
      res.messages.forEach((m) => {
        m.meta?.learned?.forEach((l) => toast(`${m.speaker_name} learned something`, { description: l }));
        if (m.meta?.quest) toast.success(`${m.speaker_name} gives you a quest`, { description: m.meta.quest });
        if (m.meta?.previous_stance && m.meta.stance && m.meta.stance !== m.meta.previous_stance) toast(`${m.speaker_name} now regards you as: ${m.meta.stance}`);
      });
      void mutateThread();
      setMode("playing");
      setTimeout(() => void advance(), check ? 1900 : 200);
    } catch (e) {
      toast.error(errorMessage(e));
      setMode("player_turn");
    }
  }, [playerId, target, player, houses, advance, mutateThread]);

  const finishScene = useCallback(async (skipped = false) => {
    const sc = sceneRef.current;
    if (!sc || !playerId) return;
    tokenRef.current++;
    stopSpeaking();
    try {
      const r = await api.post<{ chapter: Chapter; next_scene_id: string | null }>(`/api/story/${playerId}/scenes/${sc.id}/complete`, { skipped });
      await mutate(r.chapter, { revalidate: false });
      if (r.next_scene_id) await enterScene(r.next_scene_id);
      else { setScene(null); setMode("chapter_end"); }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [playerId, mutate, enterScene]);

  const nextChapter = useCallback(async () => {
    if (!playerId) return;
    setMode("loading");
    try {
      const r = await api.post<{ reports: TickReport[]; chapter: Chapter }>(`/api/story/${playerId}/next-chapter`);
      setReports(r.reports);
      setScene(null);
      await mutate(r.chapter, { revalidate: false });
    } catch (e) {
      toast.error(errorMessage(e));
      setMode("chapter_end");
    }
  }, [playerId, mutate]);

  // the fate artifact lingers a moment, then clears the stage
  useEffect(() => {
    if (!fate) return;
    const id = setTimeout(() => setFate(null), 5200);
    return () => clearTimeout(id);
  }, [fate]);

  // scene end → continue automatically after a pause when auto-playing
  useEffect(() => {
    if (mode !== "scene_end" || !autoplay) return;
    const id = setTimeout(() => void finishScene(false), 6000);
    return () => clearTimeout(id);
  }, [mode, autoplay, finishScene]);

  // keyboard: Space = next line, T = speak up
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === " " && (modeRef.current === "playing" || modeRef.current === "paused")) {
        e.preventDefault();
        if (modeRef.current === "paused") setMode("playing");
        void advance();
      }
      if (e.key.toLowerCase() === "t" && ["playing", "paused"].includes(modeRef.current)) { e.preventDefault(); void speakUp(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [advance, speakUp]);

  // ---------------------------------------------------------------- render
  if (error) return <ErrorBox error={error} />;
  if (!chapter || !player || !avatar) return <Loading label="The maesters open the chronicle…" />;

  const idx = scene ? chapter.scenes.findIndex((s) => s.id === scene.id) : -1;
  const progress = chapter.total ? (chapter.done / chapter.total) * 100 : 0;
  const nextScene = scene ? chapter.scenes.slice(idx + 1).find((s) => s.status === "unseen") : null;
  const focus = target ?? near;
  const focusRel = focus && thread?.relationships ? thread.relationships[focus] : undefined;
  const focusName = focus ? scene?.characters.find((c) => c.id === focus)?.name ?? null : null;
  const eventTitle = Object.fromEntries(chapter.chapter.events.map((e) => [e.id, e.title]));
  const objectives = chapter.scenes.filter((s) => s.events.length > 0).flatMap((s) => s.events.map((e) => ({
    id: `${s.id}-${e}`, title: eventTitle[e] ?? e.replace(/_/g, " "), where: s.location_name, scene: s.id,
    done: s.status === "completed" || s.status === "skipped", active: s.id === scene?.id,
  })));
  const nextObjective = objectives.find((o) => !o.done);
  const cinematic = mode === "intro" || (mode === "playing" && line?.kind === "canon");

  return (
    <div className="-m-4 md:-m-6">
      <div className="relative h-[calc(100vh-56px)] min-h-[560px] w-full overflow-hidden bg-black">
        {scene ? (
          <StoryStage
            setId={(scene.set as SetId) ?? "great_hall"}
            house={HOUSE_OF_LOCATION[scene.location_id ?? ""] ?? player.allegiance ?? "stark"}
            ord={scene.ord}
            cast={scene.characters}
            extras={scene.extras}
            player={{ name: player.name, appearance: avatar }}
            speakingId={speaking}
            bubble={line?.text ?? null}
            focusId={focus}
            onNear={setNear}
            onTalk={(id) => { setTarget(id); void speakUp(id); }}
            inputLocked={mode === "player_turn" || mode === "awaiting"}
          />
        ) : (
          <div className="flex h-full items-center justify-center"><Crown className="size-10 animate-pulse text-primary" /></div>
        )}

        {/* ---------------------------------------------- cinematic framing */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55)_100%)]" />
        <motion.div className="pointer-events-none absolute inset-x-0 top-0 bg-black" initial={false} animate={{ height: cinematic ? "7vh" : 0 }} transition={{ duration: 0.8, ease: "easeInOut" }} />
        <motion.div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black" initial={false} animate={{ height: cinematic ? "7vh" : 0 }} transition={{ duration: 0.8, ease: "easeInOut" }} />

        {/* ---------------------------------------------- top HUD */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-3 p-3">
          <div className="pointer-events-auto rounded-xl border border-border bg-black/70 px-4 py-2.5 backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="font-display text-lg text-primary">{chapter.chapter.label}</span>
              <span className="font-display text-sm">“{chapter.chapter.title}”</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Scene {Math.max(1, idx + 1)} of {chapter.total}</span>
              {scene && <span className="flex items-center gap-0.5"><MapPin className="size-3" />{scene.location_name}</span>}
            </div>
            <Progress value={progress} className="mt-1.5 h-1 w-56" />
            {objectives.length > 0 && (
              <div className="mt-2.5 w-64 space-y-1 border-t border-border/60 pt-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary/80"><Flag className="size-3" /> Story of this episode</div>
                {objectives.slice(0, 3).map((o) => (
                  <button key={o.id} onClick={() => !o.active && void enterScene(o.scene)} title={`${o.title} — ${o.where}`}
                    className={cn("flex w-full items-start gap-1.5 text-left text-[11px] leading-tight", o.done ? "text-muted-foreground line-through" : o === nextObjective ? "text-amber-100" : "text-foreground/70")}>
                    {o.done ? <CheckCircle2 className="mt-px size-3 shrink-0 text-emerald-400" /> : <Circle className={cn("mt-px size-3 shrink-0", o === nextObjective && "text-primary")} />}
                    <span className="line-clamp-2">{o.title}<span className="text-muted-foreground"> · {o.where}</span></span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="pointer-events-auto ml-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-black/70 p-1.5 backdrop-blur">
            <Button size="sm" variant={autoplay ? "default" : "outline"} className="h-8" onClick={() => { const v = !autoplay; setAutoplay(v); writeBool(LS_AUTO, v); if (v && mode === "paused") { setMode("playing"); void advance(); } }}>
              {autoplay ? <Pause className="size-4" /> : <Play className="size-4" />} {autoplay ? "Auto" : "Manual"}
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => { const v = !voice; setVoice(v); writeBool(LS_VOICE, v); if (!v) stopSpeaking(); }} title="Character voices">
              {voice ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => void finishScene(true)} disabled={!scene} title="Skip this scene"><SkipForward className="size-4" /></Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setLogOpen((v) => !v)} title="Conversation log"><ScrollText className="size-4" /></Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setRail((v) => !v)} title="Scenes of this chapter"><ListOrdered className="size-4" /></Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setHelp((v) => !v)} title="Controls"><Keyboard className="size-4" /></Button>
            <Button size="sm" variant="outline" className="h-8" onClick={onNewJourney} title="Begin a new journey"><Clapperboard className="size-4" /></Button>
            <Button size="sm" variant="outline" className="h-8" asChild title="The hub: map, quests, all conversations"><Link href="/play"><LayoutDashboard className="size-4" /></Link></Button>
          </div>
        </div>

        {/* ---------------------------------------------- scene rail */}
        <AnimatePresence>
          {rail && (
            <motion.aside initial={{ x: 320, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 320, opacity: 0 }}
              className="absolute bottom-3 right-3 top-[92px] hidden w-72 flex-col rounded-xl border border-border bg-black/70 backdrop-blur lg:flex">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground"><Clapperboard className="size-3.5 text-primary" /> This chapter</div>
              <ScrollArea className="flex-1 p-2"><SceneRail scenes={chapter.scenes} activeId={scene?.id ?? null} onPlay={(id) => void enterScene(id)} /></ScrollArea>
              {scene && scene.characters.length > 0 && (
                <div className="border-t border-border p-2">
                  <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">Who&apos;s here</div>
                  <div className="flex flex-wrap gap-1">
                    {scene.characters.map((c) => {
                      const rel = thread?.relationships?.[c.id];
                      return (
                        <button key={c.id} onClick={() => { setTarget(c.id); void speakUp(c.id); }} title={`Speak to ${c.name}`}
                          className={cn("flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-[11px] transition-colors",
                            speaking === c.id ? "border-primary bg-primary/15" : focus === c.id ? "border-emerald-400/60" : "border-border hover:border-primary/50")}>
                          <CharacterSeal name={c.name} house={c.house} size={18} />
                          <span>{c.name.split(" ")[0]}</span>
                          {rel && <span className="text-[9px] text-muted-foreground">{rel.stance}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {focusName && focusRel && (
                <div className="border-t border-border p-3">
                  <div className="mb-1 flex items-center justify-between text-xs"><span className="font-display text-primary">{focusName}</span><span className="text-muted-foreground">{focusRel.stance} · {focusRel.mood}</span></div>
                  <RelationshipBars dims={focusRel} compact />
                </div>
              )}
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ---------------------------------------------- conversation log */}
        <AnimatePresence>
          {logOpen && thread && (
            <motion.aside initial={{ x: -340, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -340, opacity: 0 }}
              className="absolute bottom-3 left-3 top-[112px] flex w-80 flex-col rounded-xl border border-border bg-black/80 backdrop-blur">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
                <MessagesSquare className="size-3.5 text-primary" /> Scene conversation
                <Link href={`/play/thread/${thread.id}`} className="ml-auto text-primary underline">Open</Link>
                <button onClick={() => setLogOpen(false)} aria-label="Close"><X className="size-3.5" /></button>
              </div>
              <ScrollArea className="flex-1 p-3">
                <ul className="space-y-2 text-xs">
                  {thread.messages.map((m) => (
                    <li key={m.id} className={cn(m.role === "player" && "text-emerald-200", m.role === "narrator" && "italic text-muted-foreground")}>
                      {m.role !== "narrator" && <b className="text-primary">{m.role === "player" ? player.name : m.speaker_name}: </b>}
                      {m.content}
                      {m.meta?.canon ? null : m.role === "character" && <span className="ml-1 rounded bg-sky-500/15 px-1 text-[9px] text-sky-300">live</span>}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ---------------------------------------------- controls help */}
        <AnimatePresence>
          {help && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute right-3 top-[92px] z-20 w-72 rounded-xl border border-primary/30 bg-black/90 p-4 text-xs">
              <div className="mb-2 font-display text-sm text-primary">Controls</div>
              <ul className="space-y-1.5 text-muted-foreground">
                {[["W A S D / arrows", "walk (Shift to run)"], ["Drag · scroll", "turn and zoom the camera"], ["E · click someone", "talk to them"], ["T", "speak up in the scene"],
                  ["Space · click the box", "next line"], ["1 – 4", "pick a suggested reply"], ["🎙", "speak with your voice"]].map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-3"><kbd className="rounded bg-muted px-1.5 text-foreground">{k}</kbd><span>{v}</span></li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---------------------------------------------- fate check */}
        <AnimatePresence>
          {fate && <div className="absolute left-1/2 top-24 z-20 w-[440px] -translate-x-1/2"><FateCheck key={`${fate.roll}-${fate.total}`} check={fate} onClose={() => setFate(null)} /></div>}
        </AnimatePresence>

        {/* ---------------------------------------------- title card */}
        <AnimatePresence>
          {mode === "intro" && scene && (
            <motion.div key={scene.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}
              className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/70 via-black/30 to-black/70">
              <div className="max-w-2xl px-6 text-center">
                <motion.div initial={{ letterSpacing: "0.6em", opacity: 0 }} animate={{ letterSpacing: "0.3em", opacity: 1 }} transition={{ duration: 1.2 }}
                  className="font-display text-sm uppercase text-primary/80">{scene.location_name}</motion.div>
                <motion.h2 initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3, duration: 0.8 }}
                  className="mt-2 font-display text-3xl text-amber-50 drop-shadow md:text-5xl">{scene.participants.slice(0, 3).map((p) => p.name.split(" ")[0]).join(" · ")}</motion.h2>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} className="mt-3 text-sm text-amber-100/80">{scene.summary}</motion.p>
                {scene.diverged && <p className="mt-2 text-xs text-sky-300">This scene has changed in your world — some who would be here are gone.</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---------------------------------------------- scene / chapter end */}
        <AnimatePresence>
          {mode === "scene_end" && scene && (
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex items-center justify-center bg-black/55">
              <Card className="w-[min(92vw,520px)] border-primary/40 bg-black/85">
                <CardContent className="space-y-3 p-6 text-center">
                  <div className="font-display text-xs uppercase tracking-[0.3em] text-primary/80">Scene complete</div>
                  <div className="font-display text-xl">{scene.title}</div>
                  {nextScene ? (
                    <p className="text-sm text-muted-foreground">Next: <b className="text-foreground">{nextScene.participants.slice(0, 3).map((p) => p.name).join(", ")}</b> at {nextScene.location_name}{autoplay ? " — continuing shortly…" : "."}</p>
                  ) : <p className="text-sm text-muted-foreground">That was the last scene of this chapter.</p>}
                  <div className="flex justify-center gap-2">
                    <Button onClick={() => void finishScene(false)}><FastForward className="size-4" /> {nextScene ? "Continue the story" : "End the chapter"}</Button>
                    <Button variant="outline" onClick={() => { beatRef.current = 0; setMode("playing"); void advance(); }}>Replay</Button>
                    <Button variant="ghost" onClick={() => void speakUp()}>Linger and talk</Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
          {mode === "chapter_end" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
              <Card className="w-[min(94vw,620px)] border-primary/40 bg-black/90">
                <CardContent className="space-y-4 p-7 text-center">
                  <BookOpenText className="mx-auto size-8 text-primary" />
                  <div className="font-display text-xs uppercase tracking-[0.3em] text-primary/80">Chapter complete</div>
                  <div className="font-display text-2xl">{chapter.chapter.label} · {chapter.chapter.title}</div>
                  {chapter.chapter.events.length > 0 && (
                    <ul className="space-y-1 text-left text-sm text-muted-foreground">
                      {chapter.chapter.events.slice(0, 4).map((e) => <li key={e.id}>• <b className="text-foreground">{e.title}</b> — {e.description}</li>)}
                    </ul>
                  )}
                  <p className="text-xs text-muted-foreground">Series progress: {chapter.series_progress.seen} of {chapter.series_progress.total} scenes witnessed.</p>
                  {chapter.is_last_chapter ? (
                    <p className="text-sm text-primary">You have reached the end of the story. The realm remains yours to explore from the hub.</p>
                  ) : (
                    <Button size="lg" onClick={() => void nextChapter()}>Ride on to {ordLabel(chapter.chapter.ord + 1)}</Button>
                  )}
                  <div><Link href="/play" className="text-xs text-primary underline">Or visit the hub first</Link></div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---------------------------------------------- dialogue */}
        <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 z-[5] flex justify-center px-3 pb-4 md:pl-36", rail && "lg:pr-[300px]")}>
          {(mode === "playing" || mode === "paused" || mode === "player_turn" || mode === "awaiting") && (
            <DialogueBox
              mode={mode === "paused" ? "playing" : mode}
              line={line}
              options={options}
              optionsLoading={optionsLoading}
              onNext={() => { if (modeRef.current !== "playing") setMode("playing"); void advance(); }}
              onSpeakUp={() => void speakUp()}
              onSend={(t, i) => void send(t, i)}
              onCancel={() => { setMode("playing"); setTarget(null); void advance(); }}
              targetName={target ? scene?.characters.find((c) => c.id === target)?.name ?? null : null}
              autoplay={autoplay}
              castNames={(scene?.characters ?? []).slice(0, 3).map((c) => c.name.split(" ")[0]).join(", ")}
            />
          )}
        </div>

        {mode === "loading" && <div className="absolute inset-0 flex items-center justify-center bg-black/40"><Loading label="The scene is being set…" /></div>}
      </div>
      {reports && (
        <TimeReportDialog reports={reports} open={!!reports} onOpenChange={(o) => { if (!o) setReports(null); }} />
      )}
    </div>
  );
}
