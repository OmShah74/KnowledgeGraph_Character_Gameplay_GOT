"use client";

/**
 * Procedural, articulated, animated human figures.
 *
 * Rig:   root → hips → (spine → chest → neck → head) + legs (thigh → knee → shin → foot)
 *        chest → shoulders → upper arm → elbow → forearm → hand (+ prop)
 * Face:  eyes (blink), brows (mood), mouth (talk / smile / frown), nose, ears
 * Life:  breathing, weight shift, saccadic glances, head tracking toward the pointer,
 *        mood posture (angry lean, grieving slump, elated bounce, terrified guard),
 *        talking gestures, and touch reactions (wave / reach for steel / nod).
 * Shared unit geometries are scaled per part, so a whole court renders cheaply.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { TimedAppearance } from "@/lib/appearance";
import { DomLabel } from "./dom-label";

// ------------------------------------------------------------------ shared geometry
const G = {
  sphere: new THREE.SphereGeometry(1, 20, 16),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  taper: new THREE.CylinderGeometry(0.8, 1, 1, 14),
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 18, 1, true),
  capsule: new THREE.CapsuleGeometry(1, 1, 6, 14),
  torus: new THREE.TorusGeometry(1, 0.12, 8, 24),
  cloak: (() => {
    const g = new THREE.CylinderGeometry(1, 1.35, 1, 18, 6, true, Math.PI * 0.6, Math.PI * 0.8);
    g.translate(0, -0.5, 0);
    return g;
  })(),
};

export type Reaction = "wave" | "steel" | "nod" | null;

function mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts });
}

type Mats = ReturnType<typeof buildMats>;
function buildMats(a: TimedAppearance, ghost: boolean) {
  const g = ghost ? { transparent: true, opacity: 0.38, emissive: new THREE.Color("#7fb8ff"), emissiveIntensity: 0.6, depthWrite: false } : {};
  const metal = a.outfit === "plate" || a.outfit === "armor" || a.outfit === "kingsguard";
  return {
    skin: mat(a.skin, { roughness: 0.6, ...g }),
    hair: mat(a.hair, { roughness: 0.9, ...g }),
    cloth: mat(a.primary, { roughness: metal ? 0.35 : 0.85, metalness: metal ? 0.75 : 0.05, ...g }),
    trim: mat(a.outfit === "kingsguard" ? "#d9b25f" : "#2b241d", { metalness: a.outfit === "kingsguard" ? 0.9 : 0.1, roughness: 0.5, ...g }),
    cloak: mat(a.cloak || a.primary, { side: THREE.DoubleSide, roughness: 0.9, ...g }),
    boots: mat("#2a1d14", { roughness: 0.8, ...g }),
    eyeWhite: mat("#f4efe6", { roughness: 0.3, ...g }),
    iris: mat(a.eyes || "#3b2f25", { emissive: new THREE.Color(a.glow && a.eyes ? a.eyes : "#000"), emissiveIntensity: a.glow ? 1.5 : 0, ...g }),
    mouth: mat("#6b2a26", g),
    steel: mat("#b8bcc4", { metalness: 1, roughness: 0.25, ...g }),
    gold: mat("#d9b25f", { metalness: 1, roughness: 0.25, ...g }),
    ice: mat("#bfefff", { metalness: 0.3, roughness: 0.1, emissive: new THREE.Color("#5ad1ff"), emissiveIntensity: 0.6, ...g }),
    leather: mat("#4a3322", g),
    glow: mat(a.glow || "#ff2a1a", { emissive: new THREE.Color(a.glow || "#ff2a1a"), emissiveIntensity: 2.5, ...g }),
    wood: mat("#5a3e26", g),
  };
}

function Part({ geo, m, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0] }: { geo: THREE.BufferGeometry; m: THREE.Material; p?: [number, number, number]; s?: [number, number, number]; r?: [number, number, number] }) {
  return <mesh geometry={geo} material={m} position={p} scale={s} rotation={r} castShadow />;
}

function Hair({ a, m }: { a: TimedAppearance; m: Mats }) {
  switch (a.hairStyle) {
    case "bald": case "none": return null;
    case "short": return <Part geo={G.sphere} m={m.hair} p={[0, 0.035, -0.012]} s={[0.128, 0.115, 0.13]} />;
    case "curly":
      return (
        <group>
          <Part geo={G.sphere} m={m.hair} p={[0, 0.04, -0.01]} s={[0.135, 0.12, 0.136]} />
          {[-0.08, 0, 0.08].map((x) => <Part key={x} geo={G.sphere} m={m.hair} p={[x, 0.11, 0.03]} s={[0.04, 0.035, 0.04]} />)}
        </group>
      );
    case "bun":
      return (
        <group>
          <Part geo={G.sphere} m={m.hair} p={[0, 0.03, -0.012]} s={[0.128, 0.115, 0.13]} />
          <Part geo={G.sphere} m={m.hair} p={[0, 0.07, -0.12]} s={[0.05, 0.05, 0.05]} />
        </group>
      );
    case "wild":
      return (
        <group>
          <Part geo={G.sphere} m={m.hair} p={[0, 0.03, -0.02]} s={[0.15, 0.13, 0.15]} />
          <Part geo={G.box} m={m.hair} p={[0, -0.12, -0.09]} s={[0.24, 0.24, 0.07]} r={[0.15, 0, 0]} />
        </group>
      );
    case "braids":
      return (
        <group>
          <Part geo={G.sphere} m={m.hair} p={[0, 0.03, -0.012]} s={[0.13, 0.118, 0.132]} />
          <Part geo={G.cyl} m={m.hair} p={[0, -0.17, -0.11]} s={[0.035, 0.36, 0.035]} r={[0.12, 0, 0]} />
          {[-0.09, 0.09].map((x) => <Part key={x} geo={G.cyl} m={m.hair} p={[x, -0.12, -0.04]} s={[0.022, 0.24, 0.022]} />)}
        </group>
      );
    default: // long
      return (
        <group>
          <Part geo={G.sphere} m={m.hair} p={[0, 0.03, -0.015]} s={[0.132, 0.118, 0.134]} />
          <Part geo={G.box} m={m.hair} p={[0, -0.13, -0.085]} s={[0.23, 0.3, 0.06]} r={[0.08, 0, 0]} />
        </group>
      );
  }
}

function Crown({ kind, m }: { kind: NonNullable<TimedAppearance["crown"]>; m: Mats }) {
  const material = kind === "gold" ? m.gold : kind === "ice" ? m.ice : kind === "flowers" ? m.glow : m.steel;
  return (
    <group position={[0, 0.1, 0]}>
      <mesh geometry={G.torus} material={material} scale={[0.115, 0.115, 0.6]} rotation={[Math.PI / 2, 0, 0]} />
      {Array.from({ length: kind === "ice" ? 9 : 7 }, (_, i) => {
        const a = (i / (kind === "ice" ? 9 : 7)) * Math.PI * 2;
        return (
          <mesh key={i} geometry={G.cone} material={material} position={[Math.cos(a) * 0.112, kind === "ice" ? 0.07 : 0.035, Math.sin(a) * 0.112]}
            scale={[0.016, kind === "ice" ? 0.14 : 0.07, 0.016]} />
        );
      })}
    </group>
  );
}

function PropInHand({ prop, m }: { prop: TimedAppearance["prop"]; m: Mats }) {
  switch (prop) {
    case "sword": case "longclaw":
      return (
        <group rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.02]}>
          <Part geo={G.box} m={m.steel} p={[0, 0.38, 0]} s={[0.035, 0.7, 0.008]} />
          <Part geo={G.box} m={prop === "longclaw" ? m.steel : m.trim} p={[0, 0.02, 0]} s={[0.13, 0.025, 0.03]} />
          <Part geo={G.cyl} m={m.leather} p={[0, -0.06, 0]} s={[0.016, 0.13, 0.016]} />
          <Part geo={G.sphere} m={prop === "longclaw" ? m.eyeWhite : m.gold} p={[0, -0.135, 0]} s={[0.025, 0.025, 0.025]} />
        </group>
      );
    case "needle":
      return (
        <group rotation={[Math.PI / 2, 0, 0]}>
          <Part geo={G.box} m={m.steel} p={[0, 0.3, 0]} s={[0.012, 0.55, 0.006]} />
          <Part geo={G.torus} m={m.steel} p={[0, 0.02, 0]} s={[0.035, 0.035, 0.035]} />
        </group>
      );
    case "dagger":
      return <Part geo={G.box} m={m.steel} p={[0, 0, 0.1]} s={[0.025, 0.012, 0.18]} />;
    case "cup":
      return <Part geo={G.taper} m={m.gold} p={[0, 0.04, 0.02]} s={[0.035, 0.07, 0.035]} />;
    case "book":
      return <Part geo={G.box} m={m.leather} p={[0, 0, 0.03]} s={[0.12, 0.16, 0.04]} />;
    case "spear": case "staff":
      return <Part geo={G.cyl} m={m.wood} p={[0, 0.25, 0]} s={[0.014, 1.5, 0.014]} />;
    case "axe":
      return (
        <group>
          <Part geo={G.cyl} m={m.wood} p={[0, 0.15, 0]} s={[0.016, 0.6, 0.016]} />
          <Part geo={G.box} m={m.steel} p={[0.05, 0.42, 0]} s={[0.1, 0.12, 0.012]} />
        </group>
      );
    case "bow":
      return <mesh geometry={G.torus} material={m.wood} position={[0, 0.1, 0]} scale={[0.3, 0.5, 0.3]} rotation={[0, Math.PI / 2, 0]} />;
    default:
      return null;
  }
}

export function CharacterFigure({
  appearance: a, mood = "calm", talking = false, ghost = false, reaction = null, lookAtPointer = true, onClick, name, showName = false,
  highlight = false, position = [0, 0, 0], rotationY = 0, walkRef,
}: {
  appearance: TimedAppearance;
  mood?: string | null;
  talking?: boolean;
  ghost?: boolean;
  reaction?: Reaction;
  lookAtPointer?: boolean;
  onClick?: () => void;
  name?: string;
  showName?: boolean;
  highlight?: boolean;
  position?: [number, number, number];
  rotationY?: number;
  /** 0..1 walking intensity, written every frame by a movement controller (no re-renders). */
  walkRef?: React.MutableRefObject<number>;
}) {
  const aKey = JSON.stringify(a);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const m = useMemo(() => buildMats(a, ghost), [aKey, ghost]);
  useEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);

  const root = useRef<THREE.Group>(null);
  const hips = useRef<THREE.Group>(null);
  const chest = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const browL = useRef<THREE.Mesh>(null);
  const browR = useRef<THREE.Mesh>(null);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const knees = useRef<(THREE.Group | null)[]>([]);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const foreL = useRef<THREE.Group>(null);
  const foreR = useRef<THREE.Group>(null);
  const cloak = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  const reactAt = useRef<number>(-10);
  const blinkAt = useRef<number>(2 + Math.random() * 3);
  const glance = useRef<{ x: number; y: number; t: number }>({ x: 0, y: 0, t: 0 });
  const seed = useMemo(() => Math.random() * 10, []);

  useEffect(() => {
    if (reaction) reactAt.current = performance.now() / 1000;
  }, [reaction]);

  const build = a.build;
  const H = a.height;
  const skirt = a.outfit === "gown" || a.outfit === "robes" || a.outfit === "maester" || a.outfit === "priestess" || a.outfit === "hooded";

  useFrame(({ clock, pointer }, dt) => {
    const t = clock.getElapsedTime() + seed;
    const now = performance.now() / 1000;
    const k = Math.min(1, dt * 6);
    const lerp = (o: THREE.Object3D | null, axis: "x" | "y" | "z", v: number) => {
      if (o) o.rotation[axis] += (v - o.rotation[axis]) * k;
    };
    // --- mood posture targets
    let lean = 0, headPitch = 0, bounce = 0, armSpread = 0, tremble = 0, browAngle = 0, mouthW = 1, headTilt = 0;
    switch (mood) {
      case "angry": case "furious": lean = 0.12; browAngle = 0.35; mouthW = 0.7; armSpread = 0.1; break;
      case "grieving": case "melancholy": headPitch = 0.38; lean = 0.08; browAngle = -0.35; mouthW = 0.8; break;
      case "elated": case "excited": bounce = 0.018; browAngle = -0.2; mouthW = 1.45; armSpread = 0.15; break;
      case "content": case "relaxed": mouthW = 1.2; break;
      case "terrified": case "anxious": tremble = 0.012; browAngle = -0.4; armSpread = -0.25; headPitch = 0.1; break;
      case "contemptuous": headTilt = -0.15; browAngle = 0.15; mouthW = 0.85; break;
    }
    // --- breathing & weight shift
    if (chest.current) chest.current.scale.y = 1 + Math.sin(t * 1.7) * 0.012;
    if (hips.current) {
      hips.current.rotation.z = Math.sin(t * 0.45) * 0.025;
      hips.current.position.y = (a.seated ? -0.38 : 0) + Math.abs(Math.sin(t * 4)) * bounce + Math.sin(t * 40) * tremble;
    }
    lerp(chest.current, "x", lean);
    // --- reaction to touch
    const sinceReact = now - reactAt.current;
    const reacting = sinceReact < 1.8 ? reaction : null;
    // --- arms
    const idleSwing = Math.sin(t * 0.9) * 0.04;
    let rArmX = idleSwing, rArmZ = -0.12 - armSpread, rFore = -0.25, lArmX = -idleSwing, lFore = -0.25;
    const lArmZ = 0.12 + armSpread;
    if (talking) {
      rArmX = -0.5 + Math.sin(t * 3.2) * 0.25;
      rFore = -0.9 + Math.sin(t * 4.1) * 0.25;
      rArmZ = -0.3;
    }
    if (reacting === "wave") { rArmZ = -2.6; rArmX = 0; rFore = -0.4 + Math.sin(sinceReact * 14) * 0.45; }
    if (reacting === "steel") { rArmX = 0.35; rArmZ = 0.15; rFore = -1.6; lean = -0.08; }
    if (reacting === "nod") headPitch += Math.sin(sinceReact * 6) * 0.25 * Math.max(0, 1 - sinceReact);
    if (mood === "terrified" || mood === "anxious") { rArmX = -1.0; rFore = -1.6; lArmX = -1.0; lFore = -1.6; }
    if (a.seated) { rArmX = -0.6; lArmX = -0.6; }
    // --- walking gait: legs, knees and counter-swinging arms
    const walk = a.seated ? 0 : Math.max(0, Math.min(1, walkRef?.current ?? 0));
    const gait = t * 9;
    legs.current.forEach((leg, i) => {
      if (!leg) return;
      const sgn = i === 0 ? 1 : -1;
      leg.rotation.x += ((walk > 0.05 ? Math.sin(gait) * 0.55 * walk * sgn : 0) - leg.rotation.x) * k;
    });
    knees.current.forEach((knee, i) => {
      if (!knee) return;
      const sgn = i === 0 ? 1 : -1;
      knee.rotation.x += ((walk > 0.05 ? Math.max(0, -Math.sin(gait) * sgn) * 0.8 * walk : 0) - knee.rotation.x) * k;
    });
    if (walk > 0.05 && !talking && !reacting) {
      rArmX = Math.sin(gait) * 0.5 * walk;
      lArmX = -Math.sin(gait) * 0.5 * walk;
    }
    lerp(armR.current, "x", rArmX); lerp(armR.current, "z", rArmZ); lerp(foreR.current, "x", rFore);
    lerp(armL.current, "x", lArmX); lerp(armL.current, "z", lArmZ); lerp(foreL.current, "x", lFore);
    // --- head: pointer tracking + saccades + talk nod
    if (now > glance.current.t) glance.current = { x: (Math.random() - 0.5) * 0.4, y: (Math.random() - 0.5) * 0.15, t: now + 1.5 + Math.random() * 3 };
    const lookY = lookAtPointer && hover ? pointer.x * 0.7 : glance.current.x;
    const lookX = lookAtPointer && hover ? -pointer.y * 0.3 : glance.current.y;
    lerp(head.current, "y", lookY);
    lerp(head.current, "x", lookX + headPitch + (talking ? Math.sin(t * 5) * 0.05 : 0));
    lerp(head.current, "z", headTilt);
    // --- blink
    if (eyes.current) {
      if (now > blinkAt.current) blinkAt.current = now + 2.5 + Math.random() * 3.5;
      const closing = blinkAt.current - now > 2.35 && blinkAt.current - now < 2.5;
      eyes.current.scale.y += ((closing ? 0.1 : 1) - eyes.current.scale.y) * Math.min(1, dt * 30);
    }
    // --- mouth & brows
    if (mouth.current) {
      const open = talking ? 0.4 + Math.abs(Math.sin(t * 13)) * 1.6 : 0.6;
      mouth.current.scale.set(0.045 * mouthW, 0.012 * open, 0.01);
    }
    if (browL.current) browL.current.rotation.z += (browAngle - browL.current.rotation.z) * k;
    if (browR.current) browR.current.rotation.z += (-browAngle - browR.current.rotation.z) * k;
    // --- cloak sway
    if (cloak.current) cloak.current.rotation.x = 0.05 + Math.sin(t * 1.3) * 0.03;
    // --- ghosts float
    if (root.current) root.current.position.y = position[1] + (ghost ? 0.15 + Math.sin(t * 1.2) * 0.06 : 0);
  });

  const shoulder = 0.2 * build;
  // Dothraki warriors ride bare-chested; everyone else (including Daenerys as khaleesi) wears a garment.
  const bareChest = a.outfit === "dothraki" && a.beard;
  return (
    <group ref={root} position={position} rotation={[0, rotationY, 0]} scale={H}>
      <group
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = onClick ? "pointer" : "auto"; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = "auto"; }}
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      >
        {a.seated && (
          <group position={[0, 0, -0.05]}>
            <Part geo={G.box} m={m.wood} p={[0, 0.45, 0]} s={[0.5, 0.06, 0.45]} />
            <Part geo={G.box} m={m.wood} p={[0, 0.8, -0.2]} s={[0.5, 0.7, 0.05]} />
            {[-0.28, 0.28].map((x) => <mesh key={x} geometry={G.torus} material={m.wood} position={[x, 0.3, 0.05]} scale={[0.28, 0.28, 1.6]} rotation={[0, Math.PI / 2, 0]} />)}
          </group>
        )}
        <group ref={hips} position={[0, 0, 0]}>
          {/* legs */}
          {[-1, 1].map((side, li) => (
            <group key={side} ref={(el) => { if (!a.seated) legs.current[li] = el; }} position={[side * 0.09 * build, 0.95, 0]} rotation={[a.seated ? -1.45 : 0, 0, 0]}>
              <Part geo={G.capsule} m={skirt ? m.cloth : m.leather} p={[0, -0.22, 0]} s={[0.065 * build, 0.17, 0.07 * build]} />
              <group ref={(el) => { if (!a.seated) knees.current[li] = el; }} position={[0, -0.46, 0]} rotation={[a.seated ? 1.45 : 0, 0, 0]}>
                <Part geo={G.capsule} m={m.boots} p={[0, -0.21, 0]} s={[0.055 * build, 0.17, 0.06 * build]} />
                <Part geo={G.box} m={m.boots} p={[0, -0.46, 0.05]} s={[0.09, 0.06, 0.2]} />
              </group>
            </group>
          ))}
          {skirt && <mesh geometry={G.cone} material={m.cloth} position={[0, 0.5, 0]} scale={[0.32 * build, 1.0, 0.28 * build]} rotation={[Math.PI, 0, 0]} castShadow />}
          {/* torso */}
          <group ref={chest} position={[0, 0.95, 0]}>
            <Part geo={G.capsule} m={bareChest ? m.skin : m.cloth} p={[0, 0.27, 0]} s={[0.17 * build, 0.2, 0.11 * build]} />
            <Part geo={G.cyl} m={m.trim} p={[0, 0.06, 0]} s={[0.17 * build, 0.04, 0.115 * build]} />
            {(a.outfit === "plate" || a.outfit === "armor" || a.outfit === "kingsguard") && [-1, 1].map((s) => (
              <Part key={s} geo={G.sphere} m={a.outfit === "kingsguard" ? m.gold : m.cloth} p={[s * shoulder, 0.47, 0]} s={[0.085, 0.06, 0.085]} />
            ))}
            {a.outfit === "furs" && <mesh geometry={G.torus} material={m.cloak} position={[0, 0.47, 0]} scale={[0.2 * build, 0.2 * build, 0.9]} rotation={[Math.PI / 2, 0, 0]} />}
            {a.outfit === "maester" && <mesh geometry={G.torus} material={m.steel} position={[0, 0.42, 0.02]} scale={[0.12, 0.12, 0.6]} rotation={[Math.PI / 2.4, 0, 0]} />}
            {a.outfit === "priestess" && <Part geo={G.sphere} m={m.glow} p={[0, 0.5, 0.1]} s={[0.025, 0.025, 0.025]} />}
            {a.cloak && <mesh ref={cloak} geometry={G.cloak} material={m.cloak} position={[0, 0.5, -0.02]} scale={[0.24 * build, a.seated ? 0.6 : 1.05, 0.2 * build]} castShadow />}
            {/* arms */}
            {([[-1, armL, foreL], [1, armR, foreR]] as const).map(([side, armRef, foreRef]) => (
              <group key={side} ref={armRef} position={[side * shoulder, 0.44, 0]}>
                <Part geo={G.capsule} m={bareChest ? m.skin : m.cloth} p={[0, -0.14, 0]} s={[0.05 * build, 0.11, 0.05 * build]} />
                <group ref={foreRef} position={[0, -0.29, 0]}>
                  <Part geo={G.capsule} m={bareChest ? m.skin : m.cloth} p={[0, -0.12, 0]} s={[0.045 * build, 0.1, 0.045 * build]} />
                  <group position={[0, -0.27, 0]}>
                    {side === -1 && a.goldenHand
                      ? <Part geo={G.sphere} m={m.gold} s={[0.045, 0.055, 0.035]} />
                      : <Part geo={G.sphere} m={m.skin} s={[0.042, 0.05, 0.032]} />}
                    {side === 1 && <PropInHand prop={a.prop} m={m} />}
                  </group>
                </group>
              </group>
            ))}
            {/* neck & head */}
            <Part geo={G.cyl} m={m.skin} p={[0, 0.52, 0]} s={[0.045, 0.09, 0.045]} />
            <group ref={head} position={[0, 0.66, 0]}>
              <Part geo={G.sphere} m={m.skin} s={[0.105, 0.125, 0.11]} />
              <Part geo={G.sphere} m={m.skin} p={[0, -0.07, 0.02]} s={[0.075, 0.06, 0.085]} />
              {[-0.1, 0.1].map((x) => <Part key={x} geo={G.sphere} m={m.skin} p={[x, 0, -0.005]} s={[0.018, 0.03, 0.015]} />)}
              <Part geo={G.cone} m={m.skin} p={[0, -0.015, 0.11]} s={[0.016, 0.045, 0.016]} r={[Math.PI / 2.6, 0, 0]} />
              <group ref={eyes} position={[0, 0.025, 0.088]}>
                {[-0.038, 0.038].map((x) => (
                  <group key={x} position={[x, 0, 0]}>
                    <Part geo={G.sphere} m={m.eyeWhite} s={[0.019, 0.013, 0.01]} />
                    <Part geo={G.sphere} m={m.iris} p={[0, 0, 0.008]} s={[0.009, 0.009, 0.005]} />
                  </group>
                ))}
              </group>
              <mesh ref={browL} geometry={G.box} material={m.hair} position={[-0.038, 0.055, 0.095]} scale={[0.035, 0.007, 0.008]} />
              <mesh ref={browR} geometry={G.box} material={m.hair} position={[0.038, 0.055, 0.095]} scale={[0.035, 0.007, 0.008]} />
              <mesh ref={mouth} geometry={G.box} material={m.mouth} position={[0, -0.06, 0.098]} scale={[0.045, 0.01, 0.01]} />
              {a.beard && <Part geo={G.sphere} m={m.hair} p={[0, -0.085, 0.045]} s={[0.075, 0.06, 0.06]} />}
              {a.scar && <Part geo={G.box} m={m.mouth} p={[0.055, 0.0, 0.085]} s={[0.006, 0.07, 0.004]} r={[0, 0, 0.4]} />}
              <Hair a={a} m={m} />
              {a.outfit === "hooded" && <Part geo={G.sphere} m={m.cloak} p={[0, 0.02, -0.01]} s={[0.135, 0.15, 0.135]} />}
              {a.crown && <Crown kind={a.crown} m={m} />}
              {a.helm === "hound" && (
                <group>
                  <Part geo={G.sphere} m={m.steel} p={[0, 0.01, 0]} s={[0.13, 0.14, 0.13]} />
                  <Part geo={G.box} m={m.steel} p={[0, -0.02, 0.13]} s={[0.07, 0.06, 0.12]} />
                </group>
              )}
              {a.helm === "knight" && <Part geo={G.sphere} m={m.steel} p={[0, 0.02, 0]} s={[0.125, 0.13, 0.125]} />}
            </group>
          </group>
        </group>
        {/* selection ring */}
        {(hover || highlight) && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
            <ringGeometry args={[0.32, 0.38, 40]} />
            <meshBasicMaterial color={highlight ? "#ffd36b" : "#ffffff"} transparent opacity={0.7} />
          </mesh>
        )}
      </group>
      {(showName || hover) && name && (
        <DomLabel position={[0, 2.0, 0]} text={name} distanceFactor={3.6} minScale={0.78} maxScale={1.05} zBase={20}
          className="whitespace-nowrap rounded border border-amber-300/30 bg-black/75 px-1.5 py-px font-display text-[12px] text-amber-100" />
      )}
    </group>
  );
}
