"use client";

/**
 * Fate checks are resolved by Westerosi artifacts instead of dice:
 *   The Seven-Pointed Star  — persuasion, charm, lore (the Seven judge your words)
 *   The Iron Coin of Braavos — deception, reading intentions (the Many-Faced God)
 *   Valyrian steel           — duels and intimidation
 * The artifact spins, slows and lands; its glow reveals the verdict.
 */
import { Canvas, useFrame } from "@react-three/fiber";
import { AnimatePresence, motion } from "motion/react";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Check } from "@/lib/types";
import { ARTIFACT_FOR_INTENT, VERDICT } from "@/components/fate-chip";
import { IronCoin, SevenPointedStar, ValyrianBlade } from "./artifacts";
import { Lights } from "./stage";

function Spinning({ artifact, settleMs, glow, done }: { artifact: "star" | "coin" | "blade"; settleMs: number; glow: string; done: boolean }) {
  const g = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const start = useRef<number | null>(null);
  useFrame(({ clock }, dt) => {
    const grp = g.current;
    if (!grp) return;
    if (start.current === null) start.current = clock.getElapsedTime();
    const t = (clock.getElapsedTime() - start.current) * 1000;
    const k = Math.min(1, t / settleMs);
    const speed = (1 - k) ** 2 * 22 + 0.25;
    if (artifact === "coin") {
      grp.rotation.x += speed * dt; // coin flips end over end
      grp.position.y = Math.sin(Math.min(1, k * 1.2) * Math.PI) * 0.8 * (1 - k);
    } else if (artifact === "blade") {
      grp.rotation.y += speed * dt;
      grp.rotation.z = (1 - k) * Math.sin(t / 90) * 0.3;
    } else {
      grp.rotation.y += speed * dt;
      grp.rotation.x = (1 - k) * 0.6;
    }
    if (light.current) light.current.intensity = done ? 14 + Math.sin(t / 160) * 4 : 2;
  });
  return (
    <>
      <pointLight ref={light} position={[0, 0, 2.2]} color={glow} distance={7} intensity={2} />
      <group ref={g}>
        {artifact === "star" && <SevenPointedStar scale={1.05} />}
        {artifact === "coin" && <IronCoin scale={1.05} />}
        {artifact === "blade" && <ValyrianBlade position={[0, -0.9, 0]} scale={0.95} />}
      </group>
    </>
  );
}

export function FateCheck({ check, onClose }: { check: Check; onClose?: () => void }) {
  const spec = ARTIFACT_FOR_INTENT[check.intent] ?? ARTIFACT_FOR_INTENT.persuade;
  const verdict = VERDICT[check.outcome];
  const settleMs = 1700;
  const [done, setDone] = useState(false);
  const [shown, setShown] = useState(1);

  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / settleMs);
      setShown(k < 1 ? 1 + Math.floor(Math.random() * 20) : check.roll);
      if (k < 1) raf = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [check.roll]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="flex items-center gap-4 rounded-xl border border-primary/30 bg-gradient-to-br from-card to-black/60 p-3 shadow-[0_0_40px_-10px] shadow-primary/30"
    >
      <div className="h-28 w-28 shrink-0">
        <Canvas dpr={[1, 1.75]} camera={{ position: [0, 0, 3.6], fov: 42 }} gl={{ alpha: true, antialias: true }}>
          <Suspense fallback={null}>
            <Lights />
            <Spinning artifact={spec.artifact} settleMs={settleMs} glow={verdict.glow} done={done} />
          </Suspense>
        </Canvas>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{spec.name} · {check.label}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-display text-3xl tabular-nums text-primary">{shown}</span>
          <span className="text-sm text-muted-foreground">
            {check.modifier >= 0 ? "+" : "−"}{Math.abs(check.modifier)} = {done ? check.total : "…"} vs {check.dc}
          </span>
        </div>
        <AnimatePresence>
          {done && (
            <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="mt-1">
              <div className={`font-display text-lg ${verdict.color}`}>{verdict.title}</div>
              <div className="text-xs text-muted-foreground">{verdict.line} <span className="opacity-70">— judged by {spec.deity}</span></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {onClose && done && (
        <button onClick={onClose} className="self-start text-xs text-muted-foreground hover:text-foreground" aria-label="Dismiss">✕</button>
      )}
    </motion.div>
  );
}
