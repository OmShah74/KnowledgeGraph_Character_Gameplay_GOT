"use client";

/**
 * Genshin-style dialogue box: speaker plate + typewriter line while the scene plays;
 * when it's your turn: suggested replies (1–4), free text, microphone, and approach.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Loader2, Mic, MicOff, Send, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechInput } from "@/lib/voice";
import { CharacterSeal } from "@/components/heraldry";
import { INTENTS, type IntentId } from "@/components/thread/composer";

export type Line = { key: string; speakerId: string | null; name: string; house?: string | null; text: string; kind: "canon" | "agent" | "player" | "narrator"; action?: string };
export type Option = { text: string; intent: string; target_id?: string | null };

function Typewriter({ text, onDone }: { text: string; onDone?: () => void }) {
  const [n, setN] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    setN(0);
    const id = setInterval(() => setN((x) => {
      if (x >= text.length) { clearInterval(id); done.current?.(); return x; }
      return x + 2;
    }), 18);
    return () => clearInterval(id);
  }, [text]);
  return <>{text.slice(0, n)}{n < text.length && <span className="opacity-40">▍</span>}</>;
}

export function DialogueBox({
  mode, line, options, optionsLoading, onNext, onSpeakUp, onSend, onCancel, targetName, autoplay, castNames,
}: {
  mode: "playing" | "paused" | "player_turn" | "awaiting";
  line: Line | null;
  options: Option[];
  optionsLoading: boolean;
  onNext: () => void;
  onSpeakUp: () => void;
  onSend: (text: string, intent: IntentId) => void;
  onCancel: () => void;
  targetName: string | null;
  autoplay: boolean;
  castNames: string;
}) {
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<IntentId>("say");
  const speech = useSpeechInput((final) => setText(final));
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode === "player_turn") { setText(""); setIntent("say"); setTimeout(() => input.current?.focus(), 60); }
  }, [mode]);
  useEffect(() => {
    if (speech.listening && speech.interim) setText(speech.interim);
  }, [speech.listening, speech.interim]);
  useEffect(() => {
    if (mode !== "player_turn") return;
    const key = (e: KeyboardEvent) => {
      if (document.activeElement === input.current && text) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && !text) {
        e.preventDefault(); // never type a stray digit while suggestions are loading
        if (n <= options.length) onSend(options[n - 1].text, options[n - 1].intent as IntentId);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [mode, options, onSend, text]);

  if (mode === "player_turn" || mode === "awaiting") {
    return (
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-primary/40 bg-black/85 p-4 shadow-2xl backdrop-blur-md">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          <span>Your turn{targetName ? <> — speaking to <b className="text-primary">{targetName}</b></> : <> — address <b className="text-primary">{castNames || "the room"}</b></>}</span>
          <button onClick={onCancel} className="ml-auto flex items-center gap-1 hover:text-foreground" aria-label="Back to the scene"><X className="size-3.5" /> Let the scene continue</button>
        </div>
        {mode === "awaiting" ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary" /> They weigh your words…</div>
        ) : (
          <>
            <div className="mb-3 grid gap-1.5">
              {optionsLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Thinking of what you might say…</div>}
              {options.map((o, i) => (
                <button key={o.text} onClick={() => onSend(o.text, o.intent as IntentId)}
                  className="group flex items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2 text-left text-sm transition-colors hover:border-primary/60 hover:bg-primary/10">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-primary/50 font-display text-xs text-primary">{i + 1}</span>
                  <span className="flex-1">{o.text}</span>
                  {o.intent !== "say" && <span className="rounded bg-primary/15 px-1.5 text-[10px] capitalize text-primary">{o.intent}</span>}
                  <ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
            <div className="mb-2 flex flex-wrap gap-1">
              {INTENTS.filter((i) => !["gift", "duel"].includes(i.id)).map((i) => (
                <button key={i.id} onClick={() => setIntent(i.id)} title={i.help}
                  className={cn("flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]", intent === i.id ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                  <i.icon className="size-3" /> {i.label}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && text.trim()) { e.preventDefault(); onSend(text.trim(), intent); }
                  if (e.key === "Escape") onCancel();
                }}
                rows={2}
                placeholder={speech.listening ? "Listening… speak now" : "Or say it in your own words… (Enter to speak)"}
                className="min-h-[52px] flex-1 resize-none rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
              />
              <button
                type="button"
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                disabled={!speech.supported}
                title={speech.supported ? (speech.listening ? "Stop listening" : "Speak with your voice") : "Voice input needs Chrome or Edge"}
                className={cn("flex size-11 items-center justify-center rounded-full border transition-colors",
                  speech.listening ? "animate-pulse border-red-400 bg-red-500/20 text-red-300" : "border-border text-muted-foreground hover:text-primary disabled:opacity-40")}
                aria-label="Voice input"
              >
                {speech.listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </button>
              <button type="button" onClick={() => text.trim() && onSend(text.trim(), intent)} disabled={!text.trim()}
                className="flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40" aria-label="Send">
                <Send className="size-4" /> Speak
              </button>
            </div>
            {speech.error && <p className="mt-1 text-[11px] text-red-300">{speech.error}</p>}
          </>
        )}
      </motion.div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {line && (
        <motion.div key={line.key} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          className="pointer-events-auto w-full max-w-3xl cursor-pointer select-none rounded-2xl border border-amber-200/25 bg-gradient-to-b from-black/80 to-black/90 px-5 pb-4 pt-3 shadow-2xl backdrop-blur-md"
          onClick={onNext}>
          <div className="mb-1 flex items-center gap-2">
            {line.kind !== "narrator" && <CharacterSeal name={line.name} house={line.house} size={26} />}
            <span className={cn("font-display text-base", line.kind === "player" ? "text-emerald-300" : line.kind === "narrator" ? "text-muted-foreground" : "text-primary")}>
              {line.kind === "narrator" ? "" : line.name}
            </span>
            {line.kind === "agent" && <span className="rounded bg-sky-500/15 px-1.5 text-[10px] text-sky-300">responds to you</span>}
            {line.kind === "canon" && <span className="text-[10px] text-muted-foreground/70">as it was told</span>}
          </div>
          {line.action && <p className="mb-1 text-xs italic text-muted-foreground">*{line.action}*</p>}
          <p className={cn("min-h-[2.8em] text-[15px] leading-relaxed", line.kind === "narrator" && "italic text-muted-foreground")}>
            <Typewriter text={line.text} />
          </p>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{autoplay ? "Auto-playing · click or Space to skip ahead" : "Click or press Space to continue"}</span>
            <button onClick={(e) => { e.stopPropagation(); onSpeakUp(); }} className="rounded-full border border-primary/50 px-3 py-1 font-medium text-primary hover:bg-primary/15">
              Speak up <kbd className="ml-1 rounded bg-primary/20 px-1 text-[10px]">T</kbd>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
