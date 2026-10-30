"use client";

import { motion } from "motion/react";
import { Brain, ScrollText, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import type { Message } from "@/lib/types";
import { moodEmoji } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CharacterSeal } from "@/components/heraldry";
import { FateChip } from "@/components/fate-chip";

const DIM_LABEL: Record<string, string> = { trust: "trust", affection: "affection", respect: "respect", fear: "fear" };

function Deltas({ delta }: { delta?: Record<string, number | undefined> }) {
  if (!delta) return null;
  const items = Object.entries(delta).filter(([k, v]) => DIM_LABEL[k] && v && Math.abs(v) >= 0.5);
  if (!items.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {items.map(([k, v]) => {
        const up = (v ?? 0) > 0;
        const good = k === "fear" ? !up : up;
        return (
          <span key={k} className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]", good ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300")}>
            {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
            {DIM_LABEL[k]} {up ? "+" : ""}{Math.round(v ?? 0)}
          </span>
        );
      })}
    </span>
  );
}

export function MessageList({ messages, houses, omniscient, playerName }: {
  messages: Message[];
  houses: Record<string, string | null | undefined>;
  omniscient: boolean;
  playerName: string;
}) {
  return (
    <div className="space-y-4">
      {messages.map((m, i) => {
        const isNew = i >= messages.length - 3;
        if (m.role === "narrator" || m.role === "system") {
          return (
            <motion.div key={m.id} initial={isNew ? { opacity: 0 } : false} animate={{ opacity: 1 }} className="mx-auto max-w-2xl text-center text-sm italic text-muted-foreground">
              <ScrollText className="mx-auto mb-1 size-4 text-primary/70" />
              {m.content}
            </motion.div>
          );
        }
        if (m.role === "player") {
          return (
            <motion.div key={m.id} initial={isNew ? { opacity: 0, x: 12 } : false} animate={{ opacity: 1, x: 0 }} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm border border-primary/30 bg-primary/10 px-4 py-2.5">
                <div className="mb-0.5 flex items-center justify-end gap-2 text-[11px] text-primary/80">
                  {m.meta?.intent && m.meta.intent !== "say" && <span className="rounded bg-primary/15 px-1.5 capitalize">{m.meta.intent}</span>}
                  {playerName}
                </div>
                <p className="whitespace-pre-wrap text-sm">{m.content}</p>
              </div>
            </motion.div>
          );
        }
        const meta = m.meta || {};
        return (
          <motion.div key={m.id} initial={isNew ? { opacity: 0, x: -12 } : false} animate={{ opacity: 1, x: 0 }} className="flex gap-3">
            <CharacterSeal name={m.speaker_name || "?"} house={houses[m.speaker_id || ""]} size={36} />
            <div className="min-w-0 max-w-[85%] space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-display text-sm text-primary">{m.speaker_name}</span>
                {meta.emotion && <span className="text-muted-foreground">{moodEmoji(meta.emotion)} {meta.emotion}</span>}
                {meta.stance && meta.previous_stance && meta.stance !== meta.previous_stance && (
                  <span className="rounded-full border border-amber-400/40 px-1.5 text-amber-200">now {meta.stance}</span>
                )}
                {meta.llm?.fallback && <span className="rounded bg-muted px-1.5 text-muted-foreground" title={meta.llm.reason}>canon line</span>}
              </div>
              {meta.action && <p className="text-xs italic text-muted-foreground">*{meta.action}*</p>}
              <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {meta.check && <FateChip check={meta.check} />}
                {meta.duel && <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">⚔ duel {meta.duel.player_total} vs {meta.duel.character_total} — {meta.duel.winner === "player" ? "you prevail" : "you are bested"}</span>}
                <Deltas delta={meta.delta as Record<string, number>} />
              </div>
              {(meta.thought_revealed || omniscient) && meta.thought && (
                <div className={cn("flex gap-2 rounded-lg border px-3 py-2 text-xs", meta.thought_revealed ? "border-violet-400/40 bg-violet-500/10 text-violet-200" : "border-dashed border-border text-muted-foreground")}>
                  <Brain className="mt-0.5 size-3.5 shrink-0" />
                  <span><b>{meta.thought_revealed ? "You read their face:" : "Private thought:"}</b> {meta.thought}</span>
                </div>
              )}
              {meta.learned && meta.learned.length > 0 && (
                <div className="flex gap-2 rounded-lg border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                  <span><b>{m.speaker_name} has learned:</b> {meta.learned.join(" ")}</span>
                </div>
              )}
              {meta.quest && <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">New quest: <b>{meta.quest}</b></div>}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
