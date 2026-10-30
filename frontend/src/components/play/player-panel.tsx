"use client";

import { Backpack, Coins, Eye, Heart, Hourglass, Medal, MessageCircle, Scroll, ShieldHalf, Sparkles, Swords, VenetianMask, Footprints, BookOpen } from "lucide-react";
import type { Player, Quest } from "@/lib/types";
import { titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sigil } from "@/components/heraldry";

const SKILL_ICON: Record<string, typeof Swords> = {
  persuasion: MessageCircle, deception: VenetianMask, intimidation: ShieldHalf, insight: Eye, combat: Swords,
  lore: BookOpen, stealth: Footprints, survival: Sparkles,
};
const SKILL_HELP: Record<string, string> = {
  persuasion: "Adds to Persuade and Charm attempts (the Seven-Pointed Star).",
  deception: "Adds to lies (the Iron Coin).",
  intimidation: "Adds to threats (Valyrian steel).",
  insight: "Reveal what a character is really thinking (the Iron Coin).",
  combat: "Your edge in duels.",
  lore: "Recall histories and legends.",
  stealth: "Moving unseen (affects ambushes on the road).",
  survival: "Avoid ambushes while travelling.",
};

export function PlayerPanel({ player }: { player: Player }) {
  const hp = (player.health / player.max_health) * 100;
  const rep = Object.entries(player.reputation || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <Sigil house={player.allegiance} size={44} />
          <div className="min-w-0">
            <CardTitle className="truncate font-display text-lg">{player.name}</CardTitle>
            <div className="text-xs text-muted-foreground">{player.background_name}{player.allegiance ? ` · House ${titleCase(player.allegiance)}` : " · unsworn"}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs"><span className="flex items-center gap-1"><Heart className="size-3.5 text-red-400" /> Health</span><span className="tabular-nums">{player.health}/{player.max_health}</span></div>
          <Progress value={hp} className={cn("h-2", hp < 35 && "[&>div]:bg-red-500")} />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border border-border p-2"><Coins className="mx-auto size-4 text-amber-300" /><div className="mt-1 tabular-nums">{player.gold}</div><div className="text-[10px] text-muted-foreground">gold</div></div>
          <div className="rounded-md border border-border p-2"><Medal className="mx-auto size-4 text-primary" /><div className="mt-1 tabular-nums">{player.renown}</div><div className="text-[10px] text-muted-foreground">renown</div></div>
          <div className="rounded-md border border-border p-2"><Hourglass className="mx-auto size-4 text-sky-300" /><div className="mt-1 tabular-nums">{player.day}</div><div className="text-[10px] text-muted-foreground">day</div></div>
        </div>
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Skills</div>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(player.skills).map(([k, v]) => {
              const Icon = SKILL_ICON[k] ?? Sparkles;
              return (
                <Tooltip key={k}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs">
                      <Icon className="size-3.5 text-primary" />
                      <span className="capitalize">{k}</span>
                      <span className="ml-auto tabular-nums text-primary">+{v}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{SKILL_HELP[k]}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
        {rep.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Reputation</div>
            <div className="space-y-1">
              {rep.map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-xs">
                  <Sigil house={k.startsWith("house_") ? k.slice(6) : undefined} org={k.startsWith("org_") ? k.slice(4) : undefined} size={16} />
                  <span className="truncate">{titleCase(k.replace(/^(house|org)_/, ""))}</span>
                  <span className={cn("ml-auto tabular-nums", v >= 0 ? "text-emerald-400" : "text-red-400")}>{v > 0 ? "+" : ""}{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="mb-1.5 flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground"><Backpack className="size-3.5" /> Carrying</div>
          <div className="flex flex-wrap gap-1">{player.inventory.map((i) => <Badge key={i} variant="outline" className="text-[11px]">{i}</Badge>)}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function QuestList({ quests, names }: { quests: Quest[]; names: Record<string, string> }) {
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 font-display text-base"><Scroll className="size-4 text-primary" /> Quests</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {!quests.length && <p className="text-xs text-muted-foreground">No one has asked anything of you yet. Earn trust and characters will offer you tasks.</p>}
        {quests.map((q) => (
          <div key={q.id} className={cn("rounded-md border p-2.5", q.status === "completed" ? "border-emerald-500/30 opacity-70" : "border-border")}>
            <div className="flex items-start justify-between gap-2">
              <span className="font-display text-sm">{q.title}</span>
              <Badge variant={q.status === "completed" ? "secondary" : "outline"} className="shrink-0 text-[10px]">{q.status}</Badge>
            </div>
            {q.giver_id && <div className="text-[11px] text-muted-foreground">from {names[q.giver_id] ?? q.giver_id}</div>}
            <p className="mt-1 text-xs text-muted-foreground">{q.description}</p>
            <ul className="mt-2 space-y-1">
              {q.objectives.map((o, i) => (
                <li key={i} className={cn("flex items-center gap-2 text-xs", o.done && "text-emerald-400 line-through")}>
                  <span className={cn("size-3 rounded-full border", o.done ? "border-emerald-400 bg-emerald-400/40" : "border-muted-foreground")} />
                  {o.text || `${o.type.replace("_", " ")} ${names[o.target] ?? titleCase(o.target)}`}
                </li>
              ))}
            </ul>
            {(q.reward?.gold || q.reward?.renown) ? <div className="mt-1 text-[11px] text-amber-300">Reward: {q.reward.gold ? `${q.reward.gold} gold ` : ""}{q.reward.renown ? `+${q.reward.renown} renown` : ""}</div> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
