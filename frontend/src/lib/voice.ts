"use client";

/**
 * Voice: text-to-speech for characters and speech-to-text for the player (Web Speech API).
 * Every character gets a stable voice (chosen from the browser's voices by gender) with pitch and
 * rate shaped by build and temperament, so Hodor rumbles and Joffrey whines. Everything degrades
 * gracefully when the browser has no speech support.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceProfile = { gender?: string | null; pitch?: number; rate?: number; seed: string };

const DEEP: Record<string, number> = {
  hodor: 0.55, gregor_clegane: 0.5, sandor_clegane: 0.62, khal_drogo: 0.6, tormund_giantsbane: 0.7, robert_baratheon: 0.72,
  tywin_lannister: 0.78, stannis_baratheon: 0.8, night_king: 0.5, varys: 1.05, joffrey_baratheon: 1.12, bran_stark: 0.95,
  arya_stark: 1.2, sansa_stark: 1.15, olenna_tyrell: 0.95, melisandre: 0.9, cersei_lannister: 1.0, tyrion_lannister: 0.92,
};

const FEMALE_HINT = /(female|woman|zira|susan|samantha|victoria|karen|hazel|moira|tessa|fiona|serena|libby|sonia|aria|jenny|emma|amy|kate)/i;
const MALE_HINT = /(male|man|david|mark|george|daniel|alex|fred|james|ryan|guy|thomas|oliver|arthur|brian|tom|eric)/i;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

function pickVoice(profile: VoiceProfile): SpeechSynthesisVoice | null {
  if (!ttsSupported()) return null;
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("en"));
  if (!voices.length) return null;
  const female = profile.gender === "female";
  const british = voices.filter((v) => /en-gb|uk|british/i.test(`${v.lang} ${v.name}`));
  const pool0 = british.length >= 2 ? british : voices; // Westeros sounds British
  const pool = pool0.filter((v) => (female ? FEMALE_HINT.test(v.name) : MALE_HINT.test(v.name) || !FEMALE_HINT.test(v.name)));
  const list = pool.length ? pool : pool0;
  return list[hash(profile.seed) % list.length];
}

/** Speak a line; resolves when finished (or after a length-based timeout if speech is unavailable). */
export function speak(text: string, profile: VoiceProfile, enabled = true): Promise<void> {
  const clean = text.replace(/\[[^\]]*\]/g, "").replace(/\*[^*]*\*/g, "").trim();
  const readingMs = Math.min(9000, 900 + clean.split(/\s+/).length * 330);
  if (!enabled || !ttsSupported() || !clean) return new Promise((r) => setTimeout(r, readingMs));
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      const u = new SpeechSynthesisUtterance(clean);
      const v = pickVoice(profile);
      if (v) u.voice = v;
      const base = DEEP[profile.seed] ?? (profile.gender === "female" ? 1.12 : 0.88);
      u.pitch = Math.max(0.1, Math.min(2, profile.pitch ?? base + ((hash(profile.seed) % 11) - 5) / 100));
      u.rate = Math.max(0.6, Math.min(1.4, profile.rate ?? 0.98));
      u.onend = finish;
      u.onerror = finish;
      window.speechSynthesis.speak(u);
      setTimeout(finish, readingMs * 2.5 + 2000); // safety net
    } catch {
      setTimeout(finish, readingMs);
    }
  });
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

// ------------------------------------------------------------------ speech-to-text
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechInput(onFinal?: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const finalCb = useRef(onFinal);
  finalCb.current = onFinal;

  useEffect(() => { setSupported(!!recognitionCtor()); }, []);

  const stop = useCallback(() => { rec.current?.stop(); }, []);
  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) { setError("Speech input is not supported in this browser (try Chrome or Edge)."); return; }
    try {
      const r = new Ctor();
      r.lang = "en-GB";
      r.continuous = false;
      r.interimResults = true;
      r.onresult = (e) => {
        let text = "";
        let final = false;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
          if (e.results[i].isFinal) final = true;
        }
        setInterim(text);
        if (final) finalCb.current?.(text.trim());
      };
      r.onerror = (e) => { setError(e.error === "not-allowed" ? "Microphone permission was denied." : `Speech error: ${e.error}`); };
      r.onend = () => { setListening(false); };
      rec.current = r;
      setError(null);
      setInterim("");
      setListening(true);
      r.start();
    } catch (e) {
      setListening(false);
      setError(String(e));
    }
  }, []);
  useEffect(() => () => rec.current?.abort(), []);
  return { supported, listening, interim, error, start, stop };
}
