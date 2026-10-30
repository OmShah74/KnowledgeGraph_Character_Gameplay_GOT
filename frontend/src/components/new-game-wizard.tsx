"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Feather, MapPin, Shield, Sparkles } from "lucide-react";
import { api, errorMessage, fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import { episodesIn, titleCase, toOrd } from "@/lib/format";
import type { Episode, Player } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { HOUSE_SIGIL, Sigil } from "@/components/heraldry";

type Background = { id: string; name: string; description: string; skills: Record<string, number>; gold: number; health: number; inventory: string[]; allegiance?: string };
type StartLoc = { id: string; name: string; characters: string[]; count: number };

const STEPS = [
  { title: "Who are you?", icon: Feather },
  { title: "Your allegiance", icon: Shield },
  { title: "When does your tale begin?", icon: Sparkles },
  { title: "Where do you arrive?", icon: MapPin },
  { title: "Swear it", icon: Check },
];

export function NewGameWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { setPlayerId } = usePlayer();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [background, setBackground] = useState("hedge_knight");
  const [allegiance, setAllegiance] = useState<string | null>(null);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [location, setLocation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: backgrounds } = useSWR<Background[]>(open ? "/api/game/backgrounds" : null, fetcher);
  const { data: episodes } = useSWR<Episode[]>(open ? "/api/episodes" : null, fetcher);
  const { data: starts } = useSWR<StartLoc[]>(open ? ["/api/game/start-locations", { season, episode }] : null, fetcher);

  useEffect(() => {
    if (starts && starts.length && !starts.some((s) => s.id === location)) setLocation(starts[0].id);
  }, [starts, location]);

  const bg = backgrounds?.find((b) => b.id === background);
  const ep = useMemo(() => episodes?.find((e) => e.ord === toOrd(season, episode)), [episodes, season, episode]);
  const seasonEpisodes = useMemo(() => episodes?.filter((e) => e.season === season) ?? [], [episodes, season]);
  const canNext = step === 0 ? name.trim().length > 0 : step === 3 ? !!location : true;

  async function create() {
    setBusy(true);
    try {
      const p = await api.post<Player>("/api/players", { name: name.trim(), background, allegiance, bio, season, episode, location_id: location });
      setPlayerId(p.id);
      toast.success(`${p.name} enters the game of thrones at ${p.label}.`);
      onOpenChange(false);
      router.push("/play");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setStep(0); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-primary">Begin a new tale</DialogTitle>
          <DialogDescription>Create your persona, choose when and where in the story you arrive. The world will remember you.</DialogDescription>
        </DialogHeader>
        <ol className="mb-2 grid grid-cols-5 gap-1">
          {STEPS.map((s, i) => (
            <li key={s.title} className={cn("flex flex-col items-center gap-1 rounded-md px-1 py-2 text-center text-[11px]",
              i === step ? "bg-primary/15 text-primary" : i < step ? "text-emerald-400" : "text-muted-foreground")}>
              <s.icon className="size-4" />
              <span className="hidden sm:block">{s.title}</span>
            </li>
          ))}
        </ol>
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }} className="min-h-[340px]">
            {step === 0 && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pname">Your name</Label>
                    <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ser Duncan the Tall" maxLength={60} autoFocus />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pbio">A line of backstory (optional)</Label>
                    <Input id="pbio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Squire to an old hedge knight…" maxLength={300} />
                  </div>
                </div>
                <Label>Background — decides your skills, purse and how lords first see you</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {backgrounds?.map((b) => (
                    <button key={b.id} type="button" onClick={() => { setBackground(b.id); if (b.allegiance) setAllegiance(b.allegiance); }}
                      className={cn("rounded-lg border p-3 text-left transition-all", background === b.id ? "border-primary bg-primary/10 shadow-[0_0_20px_-8px] shadow-primary" : "border-border hover:border-primary/50")}>
                      <div className="flex items-center justify-between">
                        <span className="font-display text-sm text-foreground">{b.name}</span>
                        <span className="text-xs text-amber-300">{b.gold} gold</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{b.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {Object.entries(b.skills).map(([k, v]) => <Badge key={k} variant="secondary" className="text-[10px]">{k} +{v}</Badge>)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {step === 1 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Sworn swords are trusted by their own house and distrusted by its enemies. You may also stay unsworn.</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  <button type="button" onClick={() => setAllegiance(null)}
                    className={cn("flex flex-col items-center gap-1 rounded-lg border p-2 text-xs", allegiance === null ? "border-primary bg-primary/10" : "border-border hover:border-primary/40")}>
                    <Sigil size={36} />
                    Unsworn
                  </button>
                  {Object.keys(HOUSE_SIGIL).slice(0, 19).map((h) => (
                    <button key={h} type="button" onClick={() => setAllegiance(h)}
                      className={cn("flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors", allegiance === h ? "border-primary bg-primary/10" : "border-border hover:border-primary/40")}>
                      <Sigil house={h} size={36} />
                      {titleCase(h)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <Label>Season</Label>
                  <div className="mt-2 grid grid-cols-8 gap-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                      <button key={s} type="button" onClick={() => { setSeason(s); setEpisode(1); }}
                        className={cn("rounded-md border py-2 font-display text-sm", season === s ? "border-primary bg-primary/15 text-primary" : "border-border hover:border-primary/40")}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Episode — you arrive just after its events</Label>
                  <div className="mt-2 grid max-h-64 gap-1 overflow-y-auto pr-1">
                    {(seasonEpisodes.length ? seasonEpisodes : Array.from({ length: episodesIn(season) }, (_, i) => ({ episode: i + 1, title: "", label: `S${season}E${i + 1}`, events: [] as string[] }))).map((e) => (
                      <button key={e.episode} type="button" onClick={() => setEpisode(e.episode)}
                        className={cn("flex items-start gap-3 rounded-md border px-3 py-2 text-left text-sm", episode === e.episode ? "border-primary bg-primary/10" : "border-border hover:border-primary/40")}>
                        <span className="w-14 shrink-0 font-mono text-xs text-primary">{e.label}</span>
                        <span className="min-w-0">
                          <span className="block">{e.title}</span>
                          {e.events.length > 0 && <span className="block truncate text-xs text-muted-foreground">{e.events.join(" · ")}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Places where the great and the terrible are gathered at <b className="text-foreground">S{season}E{episode}</b>{ep ? ` — “${ep.title}”` : ""}.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {starts?.map((s) => (
                    <button key={s.id} type="button" onClick={() => setLocation(s.id)}
                      className={cn("rounded-lg border p-3 text-left", location === s.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40")}>
                      <div className="flex items-center justify-between">
                        <span className="font-display">{s.name}</span>
                        <Badge variant="outline">{s.count} notable</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.characters.join(", ")}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {step === 4 && (
              <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                <Sigil house={allegiance} size={96} />
                <div className="space-y-2 text-sm">
                  <div className="font-display text-2xl text-primary">{name || "Nameless"}</div>
                  <div>{bg?.name}{allegiance ? `, sworn to House ${titleCase(allegiance)}` : ", unsworn"}</div>
                  {bio && <div className="italic text-muted-foreground">“{bio}”</div>}
                  <div>Arrives at <b>{starts?.find((s) => s.id === location)?.name}</b> after <b>S{season}E{episode}{ep ? ` · ${ep.title}` : ""}</b>.</div>
                  <div className="text-muted-foreground">Purse: {bg?.gold} gold · Health: {bg?.health} · Carrying: {bg?.inventory.join(", ")}</div>
                  <p className="rounded-md border border-border bg-black/20 p-3 text-xs text-muted-foreground">
                    Canon is only the beginning. Characters will remember what you say, gossip about you, form opinions,
                    learn from how you treat them, and live their own lives while you travel. Your choices can save or doom them.
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><ArrowLeft className="size-4" /> Back</Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>Next <ArrowRight className="size-4" /></Button>
          ) : (
            <Button onClick={create} disabled={busy || !name.trim()}>{busy ? "Swearing…" : "Swear the oath and begin"}</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
