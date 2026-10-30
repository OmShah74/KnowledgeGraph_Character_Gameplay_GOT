"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS: [string, string][] = [
  ["Find people", "The court view and the map show who is at your location right now. Their beacons on the map grow taller the more notable people are there."],
  ["Talk", "Open a conversation with one person, gather several into a scene, or send a raven to someone far away. Every word is remembered."],
  ["Choose an approach", "Speak plainly, or try to persuade, deceive, intimidate, charm, read intentions, recall lore, offer gold or help, or draw steel. Risky approaches are judged by an artifact: the Seven-Pointed Star, an Iron Coin of Braavos or Valyrian steel."],
  ["Watch relationships", "Each character tracks trust, affection, respect, fear and familiarity toward you. These decide whether they are allies, friends, wary, enemies or devoted."],
  ["They learn", "Repeated patterns change them. Lie twice and they stop believing you; help them and they will take risks for you. Their temperament drifts."],
  ["Secrets spread", "What you reveal becomes a rumour. People who trust each other pass it on, and it may reach someone you never spoke to."],
  ["Move through time", "Advance an episode: canon events press on, but your world can diverge. Characters meet off-screen and plots emerge from their tensions."],
  ["Travel", "Pick a destination on the map. Roads take days; crossing the Narrow Sea costs gold. Brigands may be waiting."],
];

export function HowToPlay() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card/60">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <HelpCircle className="size-4 text-primary" />
        <span className="font-display text-sm">How to play</span>
        <ChevronDown className={cn("ml-auto size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ol className="space-y-2 px-4 pb-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="flex gap-3 text-xs">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-[11px] text-primary">{i + 1}</span>
              <span><b className="text-foreground">{t}.</b> <span className="text-muted-foreground">{d}</span></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
