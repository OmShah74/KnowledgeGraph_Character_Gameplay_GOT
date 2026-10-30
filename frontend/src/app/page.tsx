"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { motion } from "motion/react";
import { Brain, Ear, GitBranch, MessagesSquare, Network, Play, Plus, ScrollText, Trash2, Users } from "lucide-react";
import { api, errorMessage, fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import type { Player } from "@/lib/types";
import { titleCase, timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Sigil } from "@/components/heraldry";
import { Stat } from "@/components/common";
import { NewGameWizard } from "@/components/new-game-wizard";
import { ArtifactShowcase, HeroScene } from "@/components/three/lazy";

type Meta = { characters: number; lines: number; episodes: number; enabled_keys: number; players: number; neo4j: { available: boolean } };

const FEATURES = [
  { icon: Users, title: "Every character is an agent", text: "Over 200 characters drawn from all eight seasons, each with a persona, drives, temperament and a voice built from their actual lines." },
  { icon: Brain, title: "They remember you", text: "Episodic, reflective and shared memories per character and per playthrough, recalled by relevance, importance and recency." },
  { icon: Ear, title: "Rumours travel", text: "Tell Varys a secret in one conversation and it may reach Cersei in another — passed along by whoever trusts whom." },
  { icon: GitBranch, title: "Canon is only the beginning", text: "Canon events are pressures, not scripts. Save Ned, kill Joffrey early — the world adjudicates and diverges." },
  { icon: MessagesSquare, title: "Living off-screen", text: "While you travel, characters meet, argue, fall in love, scheme — and remember it. Plots emerge from their tensions." },
  { icon: Network, title: "A knowledge graph of the realm", text: "An ontology-backed graph of houses, kin, oaths, betrayals and storylines, queryable in Cypher and gated by time." },
];

export default function Home() {
  const router = useRouter();
  const { playerId, setPlayerId } = usePlayer();
  const [wizard, setWizard] = useState(false);
  const { data: meta } = useSWR<Meta>("/api/meta", fetcher);
  const { data: players, mutate } = useSWR<Player[]>("/api/players", fetcher);

  async function remove(p: Player) {
    try {
      await api.del(`/api/players/${p.id}`);
      if (playerId === p.id) setPlayerId(null);
      toast.success(`${p.name}'s tale has ended.`);
      mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-10">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-black/40">
        <HeroScene className="h-[440px] w-full md:h-[520px]" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-6 md:p-10">
          <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}
            className="font-display text-4xl font-bold tracking-[0.12em] text-primary drop-shadow-[0_3px_12px_rgba(0,0,0,0.9)] md:text-6xl">
            WESTEROS
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.7 }}
            className="mt-2 max-w-2xl text-sm text-foreground/85 md:text-base">
            A living Game of Thrones role-playing world. Every character is an AI agent with memory, ambitions and grudges —
            and the realm keeps turning whether you are watching or not.
          </motion.p>
          <div className="pointer-events-auto mt-5 flex flex-wrap gap-3">
            <Button size="lg" onClick={() => setWizard(true)}><Plus className="size-4" /> Begin a new tale</Button>
            {playerId && players?.some((p) => p.id === playerId) && (
              <Button size="lg" variant="outline" onClick={() => router.push("/play")}><Play className="size-4" /> Continue your tale</Button>
            )}
          </div>
        </div>
      </section>

      {meta && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Character agents" value={meta.characters} />
          <Stat label="Lines of the script" value={meta.lines.toLocaleString()} />
          <Stat label="Episodes" value={meta.episodes} />
          <Stat label="LLM keys" value={meta.enabled_keys || "none"} hint="Without keys, characters speak their canon lines" />
          <Stat label="Playthroughs" value={meta.players} />
        </section>
      )}

      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-2xl text-primary">Your tales</h2>
          <Button variant="outline" size="sm" onClick={() => setWizard(true)}><Plus className="size-4" /> New</Button>
        </div>
        {!players?.length ? (
          <Card className="border-dashed bg-card/40">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <ScrollText className="size-8 text-primary" />
              <p className="max-w-md text-sm text-muted-foreground">No one has entered the game yet. Choose who you are, when in the story you arrive and where — then speak with kings, queens and cutthroats.</p>
              <Button onClick={() => setWizard(true)}>Begin a new tale</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {players.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className={`group transition-colors hover:border-primary/50 ${p.id === playerId ? "border-primary/60" : ""}`}>
                  <CardContent className="flex gap-4 p-4">
                    <Sigil house={p.allegiance} size={52} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-display text-lg">{p.name}</span>
                        {p.id === playerId && <Badge className="text-[10px]">active</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{p.background_name}{p.allegiance ? ` · House ${titleCase(p.allegiance)}` : ""}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                        <Badge variant="secondary">{p.label}</Badge>
                        <Badge variant="outline">{p.location_name}</Badge>
                        <Badge variant="outline">{p.gold} gold</Badge>
                        <Badge variant="outline">{p.threads} conversations</Badge>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" onClick={() => { setPlayerId(p.id); router.push("/play"); }}><Play className="size-3.5" /> Play</Button>
                        <Button size="sm" variant="outline" asChild><Link href={`/world?player=${p.id}`} onClick={() => setPlayerId(p.id)}>Chronicle</Link></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-red-400" aria-label="Delete"><Trash2 className="size-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>End {p.name}&apos;s tale?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This deletes the playthrough and everything characters learned and remember about {p.name}: conversations, memories, relationships, rumours and plots.
                                Canon data is untouched. {p.updated_at ? `Last played ${timeAgo(p.updated_at)}.` : ""}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep it</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(p)} className="bg-destructive text-white hover:bg-destructive/90">Delete forever</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl text-primary">How this world lives</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="bg-card/60">
              <CardContent className="flex gap-3 p-4">
                <f.icon className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <div className="font-display text-sm">{f.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.text}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-display text-2xl text-primary">Fate is decided by artifacts, not dice</h2>
        <p className="mb-4 text-sm text-muted-foreground">When you try to persuade, deceive or fight, one of these is cast. Drag to turn them.</p>
        <div className="grid gap-3 md:grid-cols-3">
          {([
            ["star", "The Seven-Pointed Star", "Persuasion, charm and lore — judged by the Seven."],
            ["coin", "The Iron Coin of Braavos", "Deception and reading intentions — valar morghulis."],
            ["blade", "Valyrian Steel", "Duels and intimidation — steel decides."],
          ] as const).map(([k, title, text]) => (
            <Card key={k} className="overflow-hidden bg-card/60">
              <ArtifactShowcase kind={k} className="h-48 w-full" />
              <CardContent className="p-4 pt-2">
                <div className="font-display text-sm text-primary">{title}</div>
                <p className="text-xs text-muted-foreground">{text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <NewGameWizard open={wizard} onOpenChange={setWizard} />
    </div>
  );
}
