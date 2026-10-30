"use client";

/**
 * The live 3D scene for Story Mode.
 *
 *  - Third-person avatar: WASD / arrow keys (Shift to run), camera-relative movement, collisions
 *    with the cast, soft boundary. Drag to orbit the camera, scroll to zoom.
 *  - Cinematic camera: when you stand still while someone speaks, the camera eases to frame the speaker.
 *  - Cast: every named character in the scene, plus background extras. They turn toward whoever is
 *    speaking (or toward you when you approach), act out their mood, gesture while talking.
 *  - Speech bubbles above heads, a proximity prompt ("E — talk"), click-to-talk.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { appearanceAt, type TimedAppearance } from "@/lib/appearance";
import { CharacterFigure } from "@/components/three/character-figure";
import { DomLabel } from "@/components/three/dom-label";
import { StudioEnvironment } from "@/components/three/stage";
import { SceneSet, type SetId } from "./scene-sets";
import { SpeakerLight } from "./set-dressing";
import { playerAppearance, type StageCharacter } from "./stage-data";
export { playerAppearance, type StageCharacter };

type Props = {
  setId: SetId;
  house?: string;
  ord: number;
  cast: StageCharacter[];
  extras: string[];
  player: { name: string; appearance: TimedAppearance };
  speakingId: string | null; // "player" for the player
  bubble: string | null;
  focusId?: string | null;
  onNear?: (id: string | null) => void;
  onTalk?: (id: string) => void;
  inputLocked?: boolean; // true while typing: keyboard does not move the avatar
  height?: number | string;
};

const BOUND = 8.5;
const typingTarget = (el: Element | null) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);

function placeCast(n: number): [number, number][] {
  // Semicircle facing the player's spawn point, two rows for big scenes.
  const out: [number, number][] = [];
  const row1 = Math.min(n, 7);
  for (let i = 0; i < n; i++) {
    const inFirst = i < row1;
    const k = inFirst ? i : i - row1;
    const m = inFirst ? row1 : n - row1;
    const spread = Math.min(Math.PI * 0.85, 0.5 * Math.max(1, m - 1));
    const a = m === 1 ? 0 : -spread / 2 + (spread * k) / (m - 1);
    const r = inFirst ? 3.6 : 5.4;
    out.push([Math.sin(a) * r, -Math.cos(a) * r + 0.5]);
  }
  return out;
}

type Actor = { id: string; pos: THREE.Vector3; group: React.RefObject<THREE.Group | null> };

function Player({ appearance, name, actors, inputLocked, onNear, onTalk, speakingId, ctrl }: {
  appearance: TimedAppearance; name: string; actors: React.MutableRefObject<Actor[]>; inputLocked: boolean;
  onNear?: (id: string | null) => void; onTalk?: (id: string) => void; speakingId: string | null;
  ctrl: React.MutableRefObject<{ yaw: number; pitch: number; dist: number; idle: number; pos: THREE.Vector3; heading: number }>;
}) {
  const g = useRef<THREE.Group>(null);
  const walk = useRef(0);
  const keys = useRef<Record<string, boolean>>({});
  const near = useRef<string | null>(null);
  const lockRef = useRef(inputLocked);
  lockRef.current = inputLocked;
  const talkRef = useRef(onTalk);
  talkRef.current = onTalk;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typingTarget(document.activeElement) || lockRef.current) return;
      keys.current[e.key.toLowerCase()] = true;
      if (e.key.toLowerCase() === "e" && near.current) talkRef.current?.(near.current);
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false; };
    const blur = () => { keys.current = {}; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  useFrame((_, dt) => {
    const k = keys.current;
    const c = ctrl.current;
    let fx = 0, fz = 0;
    if (!lockRef.current) {
      if (k.w || k.arrowup) fz -= 1;
      if (k.s || k.arrowdown) fz += 1;
      if (k.a || k.arrowleft) fx -= 1;
      if (k.d || k.arrowright) fx += 1;
    }
    const moving = fx !== 0 || fz !== 0;
    const speed = k.shift ? 4.6 : 2.4;
    if (moving) {
      const len = Math.hypot(fx, fz);
      const sin = Math.sin(c.yaw), cos = Math.cos(c.yaw);
      const dx = (fx * cos + fz * sin) / len, dz = (-fx * sin + fz * cos) / len;
      const next = c.pos.clone().add(new THREE.Vector3(dx, 0, dz).multiplyScalar(speed * dt));
      // collide with the cast
      for (const a of actors.current) {
        const d = next.clone().sub(a.pos);
        d.y = 0;
        if (d.length() < 0.75) next.copy(a.pos).add(d.setLength(0.75));
      }
      if (next.length() > BOUND) next.setLength(BOUND);
      c.pos.copy(next);
      c.heading = Math.atan2(dx, dz);
      c.idle = 0;
    } else {
      c.idle += dt;
    }
    walk.current += ((moving ? (k.shift ? 1 : 0.7) : 0) - walk.current) * Math.min(1, dt * 10);
    if (g.current) {
      g.current.position.copy(c.pos);
      const cur = g.current.rotation.y;
      let diff = c.heading - cur;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      g.current.rotation.y = cur + diff * Math.min(1, dt * 10);
    }
    // nearest cast member for the talk prompt
    let best: string | null = null, bestD = 2.1;
    for (const a of actors.current) {
      const d = a.pos.distanceTo(c.pos);
      if (d < bestD) { bestD = d; best = a.id; }
    }
    if (best !== near.current) {
      near.current = best;
      onNear?.(best);
    }
  });

  return (
    <group ref={g}>
      <CharacterFigure appearance={appearance} name={name} walkRef={walk} talking={speakingId === "player"} lookAtPointer={false} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.36, 0.42, 40]} />
        <meshBasicMaterial color="#7dffa8" transparent opacity={0.65} />
      </mesh>
    </group>
  );
}

function CastMember({ c, pos, ord, speaking, bubble, focus, actorsRef, ctrl, onTalk, speakerRef }: {
  c: StageCharacter; pos: [number, number]; ord: number; speaking: boolean; bubble: string | null; focus: boolean;
  actorsRef: React.MutableRefObject<Actor[]>; ctrl: React.MutableRefObject<{ pos: THREE.Vector3 }>; onTalk?: (id: string) => void;
  speakerRef: React.MutableRefObject<string | null>;
}) {
  const group = useRef<THREE.Group>(null);
  const appearance = useMemo(() => appearanceAt(c, ord), [c, ord]);
  const world = useMemo(() => new THREE.Vector3(pos[0], 0, pos[1]), [pos]);
  useEffect(() => {
    const a: Actor = { id: c.id, pos: world, group };
    actorsRef.current = [...actorsRef.current.filter((x) => x.id !== c.id), a];
    return () => { actorsRef.current = actorsRef.current.filter((x) => x.id !== c.id); };
  }, [c.id, world, actorsRef]);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    // Look at the speaker; if the player is close, look at the player.
    let target: THREE.Vector3 | null = null;
    const playerDist = ctrl.current.pos.distanceTo(world);
    const speaker = actorsRef.current.find((a) => a.id === speakerRef.current);
    if (playerDist < 3.2 || speakerRef.current === "player") target = ctrl.current.pos;
    else if (speaker && speaker.id !== c.id) target = speaker.pos;
    else if (speaking) target = ctrl.current.pos;
    if (target) {
      const desired = Math.atan2(target.x - world.x, target.z - world.z);
      let diff = desired - g.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      g.rotation.y += diff * Math.min(1, dt * 4);
    }
  });
  return (
    <group ref={group} position={[pos[0], 0, pos[1]]} rotation={[0, Math.atan2(-pos[0], -pos[1] + 6), 0]}>
      <CharacterFigure appearance={appearance} mood={c.mood} talking={speaking} ghost={c.alive === false} name={c.name}
        showName highlight={focus} lookAtPointer={false} onClick={onTalk ? () => onTalk(c.id) : undefined} />
      {speaking && bubble && (
        <DomLabel position={[0, 2.45, 0]} text={bubble.length > 150 ? `${bubble.slice(0, 147)}…` : bubble} distanceFactor={4.2}
          minScale={0.8} maxScale={1.05} zBase={50}
          className="max-w-[280px] whitespace-normal rounded-xl border border-amber-200/40 bg-black/85 px-3 py-2 text-center font-sans text-[13px] leading-snug text-amber-50 shadow-xl" />
      )}
      {focus && !speaking && (
        <DomLabel position={[0, 2.4, 0]} text="E · Talk" distanceFactor={4} minScale={0.85} maxScale={1.1} zBase={45}
          className="rounded-full border border-emerald-300/60 bg-emerald-950/80 px-2 py-0.5 font-sans text-[11px] font-semibold text-emerald-200" />
      )}
    </group>
  );
}

function Extras({ names, ord }: { names: string[]; ord: number }) {
  const people = useMemo(() => names.slice(0, 4).map((n, i) => ({
    n, a: appearanceAt({ id: `extra_${n}_${i}`, tier: "minor", stats: { prowess: 9 } }, ord),
    p: [(i % 2 ? 1 : -1) * (6.6 + i * 0.4), -4.5 - i] as [number, number],
  })), [names, ord]);
  return (
    <>
      {people.map(({ n, a, p }) => (
        <group key={`${n}${p[0]}`} position={[p[0], 0, p[1]]} rotation={[0, p[0] > 0 ? -0.6 : 0.6, 0]}>
          <CharacterFigure appearance={a} name={n.replace(/\b\w/g, (m) => m.toUpperCase())} lookAtPointer={false} />
        </group>
      ))}
    </>
  );
}

function CameraRig({ ctrl, actors, speakingId }: {
  ctrl: React.MutableRefObject<{ yaw: number; pitch: number; dist: number; idle: number; pos: THREE.Vector3 }>;
  actors: React.MutableRefObject<Actor[]>; speakingId: string | null;
}) {
  const { camera, gl } = useThree();
  const look = useRef(new THREE.Vector3(0, 1.4, 0));
  useEffect(() => {
    const el = gl.domElement;
    let dragging = false, lx = 0, ly = 0;
    const down = (e: PointerEvent) => { dragging = true; lx = e.clientX; ly = e.clientY; };
    const up = () => { dragging = false; };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      ctrl.current.yaw -= (e.clientX - lx) * 0.006;
      ctrl.current.pitch = Math.max(0.08, Math.min(1.1, ctrl.current.pitch + (e.clientY - ly) * 0.004));
      lx = e.clientX; ly = e.clientY;
      ctrl.current.idle = 0;
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); ctrl.current.dist = Math.max(2.6, Math.min(11, ctrl.current.dist + e.deltaY * 0.004)); };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointermove", move);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { el.removeEventListener("pointerdown", down); window.removeEventListener("pointerup", up); window.removeEventListener("pointermove", move); el.removeEventListener("wheel", wheel); };
  }, [gl, ctrl]);
  useFrame((_, dt) => {
    const c = ctrl.current;
    const speaker = speakingId && speakingId !== "player" ? actors.current.find((a) => a.id === speakingId) : null;
    // Cinematic framing: idle player + someone speaking → ease the camera toward the speaker.
    let targetLook = c.pos.clone().add(new THREE.Vector3(0, 1.45, 0));
    let yaw = c.yaw;
    if (speaker && c.idle > 1.2) {
      const mid = c.pos.clone().lerp(speaker.pos, 0.6);
      targetLook = mid.add(new THREE.Vector3(0, 1.5, 0));
      const toSpeaker = speaker.pos.clone().sub(c.pos);
      yaw = Math.atan2(-toSpeaker.x, -toSpeaker.z) + 0.35;
      let diff = yaw - c.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      c.yaw += diff * Math.min(1, dt * 1.2);
    }
    look.current.lerp(targetLook, Math.min(1, dt * 4));
    const d = c.dist;
    const desired = new THREE.Vector3(
      look.current.x + Math.sin(c.yaw) * Math.cos(c.pitch) * d,
      look.current.y + Math.sin(c.pitch) * d,
      look.current.z + Math.cos(c.yaw) * Math.cos(c.pitch) * d,
    );
    camera.position.lerp(desired, Math.min(1, dt * 5));
    camera.lookAt(look.current);
  });
  return null;
}

export default function StoryStage({ setId, house, ord, cast, extras, player, speakingId, bubble, focusId, onNear, onTalk, inputLocked = false, height = "100%" }: Props) {
  const placed = useMemo(() => {
    const spots = placeCast(cast.length);
    return cast.map((c, i) => ({ c, pos: spots[i] }));
  }, [cast]);
  const actors = useRef<Actor[]>([]);
  const ctrl = useRef({ yaw: 0, pitch: 0.38, dist: 6.2, idle: 0, pos: new THREE.Vector3(0, 0, 4.6), heading: Math.PI });
  const speakerRef = useRef<string | null>(speakingId);
  const spot = useRef<THREE.Vector3 | null>(null);
  const radar = useRef<RadarRefs>({ world: null, dots: new Map() });
  useEffect(() => { speakerRef.current = speakingId; }, [speakingId]);
  return (
    <div className="relative isolate h-full w-full overflow-hidden" style={{ height }}>
      <Canvas shadows dpr={[1, 1.6]} camera={{ position: [0, 3.2, 10], fov: 50, near: 0.1, far: 140 }} gl={{ antialias: true }}>
        <Suspense fallback={null}>
          <SceneSet id={setId} house={house} />
          <StudioEnvironment intensity={0.5} />
          {placed.map(({ c, pos }) => (
            <CastMember key={c.id} c={c} pos={pos} ord={ord} speaking={speakingId === c.id} bubble={speakingId === c.id ? bubble : null}
              focus={focusId === c.id} actorsRef={actors} ctrl={ctrl} onTalk={onTalk} speakerRef={speakerRef} />
          ))}
          <Extras names={extras} ord={ord} />
          <Player appearance={player.appearance} name={player.name} actors={actors} inputLocked={inputLocked} onNear={onNear}
            onTalk={onTalk} speakingId={speakingId} ctrl={ctrl} />
          {speakingId === "player" && bubble && (
            <PlayerBubble ctrl={ctrl} text={bubble} />
          )}
          <CameraRig ctrl={ctrl} actors={actors} speakingId={speakingId} />
          <SpeakerTracker ctrl={ctrl} actors={actors} speakerRef={speakerRef} target={spot} />
          <SpeakerLight target={spot} />
          <RadarDriver ctrl={ctrl} actors={actors} speakerRef={speakerRef} radar={radar} />
        </Suspense>
      </Canvas>
      <Radar radar={radar} cast={placed} />
    </div>
  );
}

/** Where the spotlight should be: the speaker (or the player when they speak). */
function SpeakerTracker({ ctrl, actors, speakerRef, target }: {
  ctrl: React.MutableRefObject<{ pos: THREE.Vector3 }>; actors: React.MutableRefObject<Actor[]>;
  speakerRef: React.MutableRefObject<string | null>; target: React.MutableRefObject<THREE.Vector3 | null>;
}) {
  useFrame(() => {
    const id = speakerRef.current;
    target.current = id === "player" ? ctrl.current.pos : id ? actors.current.find((a) => a.id === id)?.pos ?? null : null;
  });
  return null;
}

type RadarRefs = { world: SVGGElement | null; dots: Map<string, SVGCircleElement> };
const R_SCALE = 4.4;

/** Writes the minimap transform every few frames: the map turns with the camera, the player stays centred. */
function RadarDriver({ ctrl, actors, speakerRef, radar }: {
  ctrl: React.MutableRefObject<{ pos: THREE.Vector3; yaw: number }>; actors: React.MutableRefObject<Actor[]>;
  speakerRef: React.MutableRefObject<string | null>; radar: React.MutableRefObject<RadarRefs>;
}) {
  const n = useRef(0);
  useFrame(() => {
    if (++n.current % 3) return;
    const { world, dots } = radar.current;
    if (!world) return;
    const c = ctrl.current;
    const deg = (c.yaw * 180) / Math.PI;
    world.setAttribute("transform", `translate(60 60) rotate(${deg.toFixed(1)}) translate(${(-c.pos.x * R_SCALE).toFixed(1)} ${(-c.pos.z * R_SCALE).toFixed(1)})`);
    for (const a of actors.current) {
      const d = dots.get(a.id);
      if (d) d.setAttribute("class", a.id === speakerRef.current ? "radar-speaking" : "");
    }
  });
  return null;
}

function Radar({ radar, cast }: { radar: React.MutableRefObject<RadarRefs>; cast: { c: StageCharacter; pos: [number, number] }[] }) {
  return (
    <div className="pointer-events-none absolute bottom-[calc(7vh+14px)] left-4 z-[6] hidden md:block" aria-hidden>
      <svg width="120" height="120" viewBox="0 0 120 120" className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]">
        <defs>
          <clipPath id="radar-clip"><circle cx="60" cy="60" r="56" /></clipPath>
          <radialGradient id="radar-bg"><stop offset="0" stopColor="#1b1612" stopOpacity="0.85" /><stop offset="1" stopColor="#0b0907" stopOpacity="0.92" /></radialGradient>
        </defs>
        <style>{`.radar-speaking{fill:#f3cf7a;r:5;animation:radarPulse 1s ease-in-out infinite}@keyframes radarPulse{50%{opacity:.45}}`}</style>
        <circle cx="60" cy="60" r="57" fill="url(#radar-bg)" stroke="#c9a24a" strokeOpacity="0.7" strokeWidth="2" />
        <g clipPath="url(#radar-clip)">
          <g ref={(el) => { radar.current.world = el; }}>
            <circle cx="0" cy="0" r={8.5 * R_SCALE} fill="none" stroke="#c9a24a" strokeOpacity="0.25" strokeDasharray="3 3" />
            {cast.map(({ c, pos }) => (
              <circle key={c.id} cx={pos[0] * R_SCALE} cy={pos[1] * R_SCALE} r="3.6"
                fill={c.alive === false ? "#7a8a9a" : "#e8dcc0"} stroke="#000" strokeWidth="1"
                ref={(el) => { if (el) radar.current.dots.set(c.id, el); else radar.current.dots.delete(c.id); }} />
            ))}
          </g>
        </g>
        <path d="M60 51 L66 66 L60 62 L54 66 Z" fill="#7dffa8" stroke="#000" strokeWidth="1" />
      </svg>
    </div>
  );
}

function PlayerBubble({ ctrl, text }: { ctrl: React.MutableRefObject<{ pos: THREE.Vector3 }>; text: string }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => { if (g.current) g.current.position.copy(ctrl.current.pos); });
  return (
    <group ref={g}>
      <DomLabel position={[0, 2.45, 0]} text={text.length > 150 ? `${text.slice(0, 147)}…` : text} distanceFactor={4.2} minScale={0.8} maxScale={1.05} zBase={55}
        className="max-w-[280px] whitespace-normal rounded-xl border border-emerald-300/40 bg-emerald-950/85 px-3 py-2 text-center font-sans text-[13px] leading-snug text-emerald-50 shadow-xl" />
    </group>
  );
}

