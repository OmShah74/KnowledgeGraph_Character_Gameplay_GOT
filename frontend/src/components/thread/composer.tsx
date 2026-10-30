"use client";

import { useState } from "react";
import { BookOpen, Coins, Eye, Gift, HandHelping, MessageCircle, Send, ShieldHalf, Sparkles, Swords, VenetianMask, Wind } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const INTENTS = [
  { id: "say", label: "Speak", icon: MessageCircle, artifact: null, help: "Just talk. No roll — they react to your words and how they already feel about you." },
  { id: "persuade", label: "Persuade", icon: Sparkles, artifact: "✶ Seven-Pointed Star", help: "Convince with reason or appeal. Your persuasion vs their diplomacy; existing trust helps." },
  { id: "charm", label: "Charm", icon: Wind, artifact: "✶ Seven-Pointed Star", help: "Flatter or win them over. Works poorly on the angry and the contemptuous." },
  { id: "deceive", label: "Deceive", icon: VenetianMask, artifact: "◉ Iron Coin", help: "Lie convincingly. Your deception vs their intrigue. If caught, they remember — and may stop believing you." },
  { id: "insight", label: "Read them", icon: Eye, artifact: "◉ Iron Coin", help: "Try to see what they really think. On success their private thought is revealed." },
  { id: "intimidate", label: "Intimidate", icon: ShieldHalf, artifact: "⚔ Valyrian steel", help: "Threaten. Raises fear, lowers affection. The brave answer threats with steel." },
  { id: "lore", label: "Recall lore", icon: BookOpen, artifact: "✶ Seven-Pointed Star", help: "Bring up histories, songs and legends." },
  { id: "help", label: "Offer help", icon: HandHelping, artifact: null, help: "Volunteer to aid their cause — a good way to earn quests and trust." },
  { id: "gift", label: "Offer gold", icon: Gift, artifact: null, help: "Give gold. The greedy value it more than the honourable." },
  { id: "duel", label: "Draw steel", icon: Swords, artifact: "⚔ Valyrian steel", help: "Fight. You may get hurt. Everyone will remember it." },
] as const;

export type IntentId = (typeof INTENTS)[number]["id"];

export function Composer({
  onSend, onContinue, busy, isScene, isRaven, participants, gold, disabled,
}: {
  onSend: (text: string, intent: IntentId, target: string | null, gold: number) => void;
  onContinue?: () => void;
  busy: boolean;
  isScene: boolean;
  isRaven: boolean;
  participants: { id: string; name: string }[];
  gold: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<IntentId>("say");
  const [target, setTarget] = useState<string>("all");
  const [amount, setAmount] = useState(10);
  const spec = INTENTS.find((i) => i.id === intent)!;
  const needsText = !["gift", "help", "duel"].includes(intent);
  const canSend = !busy && !disabled && (!needsText || text.trim().length > 0) && (intent !== "gift" || (amount > 0 && amount <= gold));

  function submit() {
    if (!canSend) return;
    onSend(text.trim(), intent, isScene && target !== "all" ? target : null, intent === "gift" ? amount : 0);
    setText("");
  }

  const available = INTENTS.filter((i) => !(isRaven && (i.id === "duel" || i.id === "intimidate" || i.id === "insight")));

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card/80 p-3 backdrop-blur">
      <div className="flex flex-wrap gap-1">
        {available.map((i) => (
          <Tooltip key={i.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setIntent(i.id)}
                className={cn("flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                  intent === i.id ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}
              >
                <i.icon className="size-3.5" /> {i.label}
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>{i.help}</p>
              {i.artifact && <p className="mt-1 text-primary">Judged by: {i.artifact}</p>}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{spec.help}</span>
        {spec.artifact && <span className="ml-auto shrink-0 text-primary">{spec.artifact}</span>}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {isScene && (
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="sm:w-44"><SelectValue placeholder="Address…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Address everyone</SelectItem>
              {participants.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {intent === "gift" && (
          <div className="flex items-center gap-1.5">
            <Coins className="size-4 text-amber-300" />
            <Input type="number" min={1} max={gold} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="w-24" aria-label="Gold" />
            <span className="text-xs text-muted-foreground">of {gold}</span>
          </div>
        )}
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={isRaven ? "Write your letter…" : needsText ? "What do you say? (Enter to send, Shift+Enter for a new line)" : "Optional words to go with it…"}
          className="min-h-[64px] resize-none"
          disabled={busy || disabled}
        />
        <div className="flex flex-col gap-1.5">
          <Button onClick={submit} disabled={!canSend}><Send className="size-4" /> {busy ? "…" : "Send"}</Button>
          {isScene && onContinue && <Button variant="outline" size="sm" onClick={onContinue} disabled={busy || disabled}>Let them talk</Button>}
        </div>
      </div>
    </div>
  );
}
