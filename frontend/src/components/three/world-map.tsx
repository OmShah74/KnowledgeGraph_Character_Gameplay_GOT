"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { FORESTS, MONUMENTS, REGION_LABELS, SEAS, SETTLEMENTS, toWorld, type Pt } from "@/lib/westeros-geo";
import { cn } from "@/lib/utils";
import { DomLabel } from "./dom-label";
import { bannerTexture } from "./textures";
import { Monument, TheWall } from "./monuments";
import { buildTerrainGeometry, getTerrain, type Terrain } from "./terrain";

export type MapLocation = { id: string; name: string; x: number; y: number; region: string; kind: string; description?: string };
export type LabelToggles = { places: boolean; towns: boolean; regions: boolean; seas: boolean };
export type Presence = Record<string, { count: number; names: string[] }>;

const WORLD = 60;

// ------------------------------------------------------------------ terrain & water
function TerrainMesh({ terrain }: { terrain: Terrain }) {
  const geometry = useMemo(() => buildTerrainGeometry(terrain, WORLD, 340), [terrain]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} receiveShadow castShadow>
      <meshStandardMaterial map={terrain.colorTexture} roughness={0.95} metalness={0.02} />
    </mesh>
  );
}

const waterVertex = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.z += sin(p.x * 0.6 + uTime * 0.9) * 0.03 + cos(p.y * 0.5 + uTime * 0.7) * 0.03;
    vec4 w = modelMatrix * vec4(p, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const waterFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  varying vec2 vUv;
  varying vec3 vWorld;
  float wave(vec2 p) {
    return sin(p.x * 3.1 + uTime * 0.8) * 0.5 + sin(p.y * 2.3 - uTime * 0.6) * 0.5 + sin((p.x + p.y) * 4.7 + uTime * 1.3) * 0.25;
  }
  void main() {
    float w = wave(vWorld.xz * 0.9);
    vec3 col = mix(uDeep, uShallow, 0.35 + 0.15 * w);
    float glint = pow(max(0.0, w), 6.0) * 0.18;
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
    col += glint + fres * 0.18;
    gl_FragColor = vec4(col, 0.86);
  }
`;

function Water() {
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDeep: { value: new THREE.Color("#0a2233") }, uShallow: { value: new THREE.Color("#1f5a73") } },
      vertexShader: waterVertex, fragmentShader: waterFragment, transparent: true, depthWrite: false,
    }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.getElapsedTime();
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, 0]} material={mat}>
      <planeGeometry args={[WORLD * 2.2, WORLD * 2.2, 96, 96]} />
    </mesh>
  );
}

// ------------------------------------------------------------------ forests (instanced)
function Forests({ terrain }: { terrain: Terrain }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const trees = useMemo(() => {
    const out: { p: THREE.Vector3; s: number; snowy: boolean }[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const f of FORESTS) {
      const n = Math.round(f.r * f.r * 34 * f.density);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * f.r;
        const mx = f.c[0] + Math.cos(a) * r, my = f.c[1] + Math.sin(a) * r * 0.85;
        if (!terrain.isLand(mx, my)) continue;
        const h = terrain.heightAt(mx, my);
        if (h > 1.4) continue;
        const [wx, wz] = toWorld([mx, my]);
        out.push({ p: new THREE.Vector3(wx, h, wz), s: 0.6 + rnd() * 0.7, snowy: !!f.snowy });
      }
    }
    return out;
  }, [terrain]);
  const geo = useMemo(() => {
    const g = new THREE.ConeGeometry(0.09, 0.32, 6);
    g.translate(0, 0.16, 0);
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.9 }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    trees.forEach((t, i) => {
      o.position.copy(t.p);
      o.scale.setScalar(t.s);
      o.rotation.y = i;
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(t.snowy ? (i % 3 === 0 ? "#dfe8ec" : "#2f4a3a") : i % 4 === 0 ? "#3d6b2f" : "#2a5226"));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [trees]);
  return <instancedMesh ref={ref} args={[geo, mat, Math.max(1, trees.length)]} castShadow />;
}

// ------------------------------------------------------------------ weather particles
function Particles({ kind, count, area, terrain }: { kind: "snow" | "embers"; count: number; area: [Pt, Pt]; terrain: Terrain }) {
  const ref = useRef<THREE.Points>(null);
  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const mx = area[0][0] + Math.random() * (area[1][0] - area[0][0]);
      const my = area[0][1] + Math.random() * (area[1][1] - area[0][1]);
      const [wx, wz] = toWorld([mx, my]);
      positions[i * 3] = wx;
      positions[i * 3 + 1] = Math.max(0, terrain.heightAt(mx, my)) + Math.random() * 4;
      positions[i * 3 + 2] = wz;
      speeds[i] = 0.3 + Math.random() * 0.6;
    }
    return { positions, speeds };
  }, [count, area, terrain]);
  useFrame((_, dt) => {
    const pts = ref.current;
    if (!pts) return;
    const p = pts.geometry.attributes.position as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    for (let i = 0; i < count; i++) {
      if (kind === "snow") {
        arr[i * 3 + 1] -= speeds[i] * dt;
        arr[i * 3] += Math.sin(arr[i * 3 + 1] * 2 + i) * dt * 0.1;
        if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = 4;
      } else {
        arr[i * 3 + 1] += speeds[i] * dt * 0.8;
        if (arr[i * 3 + 1] > 4.5) arr[i * 3 + 1] = 0.3;
      }
    }
    p.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={kind === "snow" ? 0.07 : 0.06}
        color={kind === "snow" ? "#f4f8ff" : "#ff8a3d"}
        transparent
        opacity={kind === "snow" ? 0.85 : 0.9}
        depthWrite={false}
        blending={kind === "embers" ? THREE.AdditiveBlending : THREE.NormalBlending}
      />
    </points>
  );
}

// ------------------------------------------------------------------ markers & labels
function Beacon({ height, active }: { height: number; active: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(clock.getElapsedTime() * 2.4) * 0.15 + (active ? 0.25 : 0);
  });
  return (
    <mesh ref={ref} position={[0, height / 2 + 0.2, 0]}>
      <cylinderGeometry args={[0.035, 0.11, height, 12, 1, true]} />
      <meshBasicMaterial color="#ffd36b" transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function LocationMarker({
  loc, terrain, presence, isCurrent, isSelected, interactive, showLabel, onSelect, onHover,
}: {
  loc: MapLocation;
  terrain: Terrain;
  presence?: { count: number; names: string[] };
  isCurrent: boolean;
  isSelected: boolean;
  interactive: boolean;
  showLabel: boolean;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
}) {
  const [wx, wz] = toWorld([loc.x, loc.y]);
  const y = Math.max(0.05, terrain.heightAt(loc.x, loc.y));
  const [hover, setHover] = useState(false);
  const count = presence?.count ?? 0;
  const grp = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!grp.current) return;
    const target = hover || isSelected ? 1.18 : 1;
    grp.current.scale.lerp(new THREE.Vector3(target, target, target), Math.min(1, dt * 8));
  });
  return (
    <group position={[wx, y, wz]}>
      <group
        ref={grp}
        onPointerOver={interactive ? (e) => { e.stopPropagation(); setHover(true); onHover?.(loc.id); document.body.style.cursor = "pointer"; } : undefined}
        onPointerOut={interactive ? () => { setHover(false); onHover?.(null); document.body.style.cursor = "auto"; } : undefined}
        onClick={interactive ? (e) => { e.stopPropagation(); onSelect?.(loc.id); } : undefined}
      >
        <group scale={0.85}><Monument id={loc.id} /></group>
        {/* generous invisible hit area */}
        <mesh visible={false} position={[0, 0.4, 0]}>
          <sphereGeometry args={[0.7, 8, 6]} />
          <meshBasicMaterial />
        </mesh>
      </group>
      {count > 0 && <Beacon height={0.5 + Math.min(10, count) * 0.16} active={hover || isSelected} />}
      {(isSelected || isCurrent) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.75, 0.85, 40]} />
          <meshBasicMaterial color={isCurrent ? "#7dffa8" : "#ffd36b"} transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
      )}
      {showLabel && (
        <DomLabel
          position={[0, 1.25, 0]}
          text={loc.name}
          badge={count > 0 ? count : null}
          interactive={interactive}
          onClick={() => onSelect?.(loc.id)}
          onEnter={() => { setHover(true); onHover?.(loc.id); }}
          onLeave={() => { setHover(false); onHover?.(null); }}
          distanceFactor={16}
          zBase={30}
          className={cn(
            "whitespace-nowrap rounded-md border px-2 py-0.5 font-display text-[13px] shadow-lg backdrop-blur transition-colors select-none",
            isCurrent ? "border-emerald-400/70 bg-emerald-950/80 text-emerald-200"
              : isSelected ? "border-amber-300/80 bg-amber-950/80 text-amber-100"
              : "border-amber-200/25 bg-black/65 text-amber-50 hover:border-amber-300/70",
          )}
          badgeClassName="ml-1.5 rounded bg-amber-400/20 px-1 text-[11px] text-amber-200"
        />
      )}
      {hover && presence && presence.names.length > 0 && (
        <DomLabel
          position={[0, 2.2, 0]}
          text={loc.name}
          sub={presence.names.slice(0, 8).join(", ") + (presence.names.length > 8 ? "…" : "")}
          distanceFactor={16}
          zBase={60}
          className="w-56 rounded-lg border border-amber-300/30 bg-black/85 p-2 font-display text-xs text-amber-200 shadow-xl"
          subClassName="mt-1 font-sans text-[11px] text-amber-100/70"
        />
      )}
    </group>
  );
}

function PlayerBanner({ loc, terrain, color, glyph }: { loc: MapLocation; terrain: Terrain; color: string; glyph: string }) {
  const tex = useMemo(() => bannerTexture(color, glyph), [color, glyph]);
  const geo = useMemo(() => new THREE.PlaneGeometry(0.55, 0.7, 16, 4), []);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array as Float32Array), [geo]);
  const g = useRef<THREE.Group>(null);
  useEffect(() => () => { tex.dispose(); geo.dispose(); }, [tex, geo]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3];
      p.setZ(i, Math.sin(x * 9 + t * 4) * 0.04 * (x + 0.275));
    }
    p.needsUpdate = true;
    if (g.current) g.current.position.y = Math.sin(t * 1.5) * 0.06;
  });
  const [wx, wz] = toWorld([loc.x, loc.y]);
  const y = Math.max(0.05, terrain.heightAt(loc.x, loc.y));
  return (
    <group position={[wx + 0.55, y, wz + 0.25]}>
      <group ref={g}>
        <mesh position={[0, 0.9, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 1.8, 8]} />
          <meshStandardMaterial color="#3a2a1a" />
        </mesh>
        <mesh geometry={geo} position={[0.3, 1.45, 0]}>
          <meshStandardMaterial map={tex} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

function Route({ from, to, terrain }: { from: MapLocation; to: MapLocation; terrain: Terrain }) {
  const points = useMemo(() => {
    const [ax, az] = toWorld([from.x, from.y]);
    const [bx, bz] = toWorld([to.x, to.y]);
    const ay = Math.max(0.1, terrain.heightAt(from.x, from.y)) + 0.4;
    const by = Math.max(0.1, terrain.heightAt(to.x, to.y)) + 0.4;
    const dist = Math.hypot(bx - ax, bz - az);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(ax, ay, az), new THREE.Vector3((ax + bx) / 2, Math.max(ay, by) + dist * 0.35, (az + bz) / 2), new THREE.Vector3(bx, by, bz));
    return curve.getPoints(80);
  }, [from, to, terrain]);
  const raven = useRef<THREE.Mesh>(null);
  const lineRef = useRef<{ material: { dashOffset: number } } | null>(null);
  useFrame(({ clock }, dt) => {
    const t = (clock.getElapsedTime() * 0.35) % 1;
    const p = points[Math.floor(t * (points.length - 1))];
    if (raven.current && p) raven.current.position.copy(p);
    if (lineRef.current) lineRef.current.material.dashOffset -= dt * 0.8;
  });
  return (
    <group>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Line ref={lineRef as any} points={points} color="#ffd36b" lineWidth={2.2} dashed dashSize={0.35} gapSize={0.2} transparent opacity={0.9} />
      <mesh ref={raven}>
        <sphereGeometry args={[0.09, 12, 10]} />
        <meshStandardMaterial color="#fff2c4" emissive="#ffb347" emissiveIntensity={2} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ camera
function CameraRig({ focus, controls, auto }: { focus: [number, number, number] | null; controls: React.RefObject<OrbitControlsImpl | null>; auto: boolean }) {
  const { camera } = useThree();
  const target = useRef<THREE.Vector3 | null>(null);
  useEffect(() => {
    if (focus) target.current = new THREE.Vector3(...focus);
  }, [focus]);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c || !target.current || auto) return;
    const k = Math.min(1, dt * 2.5);
    const delta = target.current.clone().sub(c.target).multiplyScalar(k);
    c.target.add(delta);
    camera.position.add(delta);
    c.update();
    if (delta.length() < 0.001) target.current = null;
  });
  return null;
}

// ------------------------------------------------------------------ scene
function Scene({
  locations, presence, current, selected, onSelect, labels, mode, bannerColor, bannerGlyph, controls,
}: {
  locations: MapLocation[];
  presence: Presence;
  current?: string | null;
  selected?: string | null;
  onSelect?: (id: string) => void;
  labels: LabelToggles;
  mode: "full" | "hero";
  bannerColor: string;
  bannerGlyph: string;
  controls: React.RefObject<OrbitControlsImpl | null>;
}) {
  const terrain = useMemo(() => getTerrain(), []);
  const byId = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l])), [locations]);
  const cur = current ? byId[current] : null;
  const sel = selected ? byId[selected] : null;
  const wallA = toWorld(MONUMENTS.wall.from);
  const wallB = toWorld(MONUMENTS.wall.to);
  const wallY = Math.max(terrain.heightAt(...MONUMENTS.wall.from), terrain.heightAt(20, 11), 0.1);
  const focus = useMemo<[number, number, number] | null>(() => {
    const l = sel || cur;
    if (!l) return null;
    const [x, z] = toWorld([l.x, l.y]);
    return [x, Math.max(0, terrain.heightAt(l.x, l.y)), z];
  }, [sel, cur, terrain]);
  const interactive = mode === "full";
  return (
    <>
      <color attach="background" args={["#0b0d10"]} />
      <fog attach="fog" args={["#0b0d10", 38, 95]} />
      <hemisphereLight args={["#cfe0ff", "#3b2a1a", 0.55]} />
      <directionalLight position={[-18, 30, -12]} intensity={2.3} color="#fff1d6" castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-35} shadow-camera-right={35} shadow-camera-top={35} shadow-camera-bottom={-35} />
      <directionalLight position={[20, 10, 25]} intensity={0.5} color="#8fb8ff" />
      <TerrainMesh terrain={terrain} />
      <Water />
      <Forests terrain={terrain} />
      <TheWall from={[wallA[0], wallY, wallA[1]]} to={[wallB[0], wallY, wallB[1]]} />
      <Particles kind="snow" count={mode === "hero" ? 500 : 700} area={[[3, 0], [40, 22]]} terrain={terrain} />
      <Particles kind="embers" count={160} area={[[58, 84], [66, 93]]} terrain={terrain} />
      <Particles kind="embers" count={60} area={[[31.5, 50], [35, 54]]} terrain={terrain} />
      {locations.map((l) => (
        <LocationMarker
          key={l.id}
          loc={l}
          terrain={terrain}
          presence={presence[l.id]}
          isCurrent={l.id === current}
          isSelected={l.id === selected}
          interactive={interactive}
          showLabel={labels.places}
          onSelect={onSelect}
        />
      ))}
      {labels.towns && SETTLEMENTS.map((s) => {
        const [x, z] = toWorld(s.at);
        const y = Math.max(0.05, terrain.heightAt(s.at[0], s.at[1]));
        return (
          <group key={s.name} position={[x, y, z]}>
            <mesh position={[0, 0.06, 0]}>
              <sphereGeometry args={[s.kind === "city" ? 0.09 : 0.06, 10, 8]} />
              <meshStandardMaterial color={s.kind === "ruin" ? "#7b7b7b" : s.kind === "city" ? "#e8d29a" : "#cdbb92"} />
            </mesh>
            <DomLabel position={[0, 0.45, 0]} text={s.name} distanceFactor={14} zBase={5}
              className={cn("whitespace-nowrap text-[11px] italic drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]", s.kind === "ruin" ? "text-zinc-400" : "text-amber-100/85")} />
          </group>
        );
      })}
      {labels.regions && REGION_LABELS.map((r) => {
        const [x, z] = toWorld(r.at);
        return (
          <DomLabel key={r.name} position={[x, 2.4, z]} text={r.name} distanceFactor={22} zBase={1}
            className="whitespace-nowrap font-display text-[17px] tracking-[0.35em] text-amber-100/45 drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]" />
        );
      })}
      {labels.seas && SEAS.map((s) => {
        const [x, z] = toWorld(s.at);
        return (
          <DomLabel key={s.name} position={[x, 0.3, z]} text={s.name} distanceFactor={22} zBase={1}
            className="whitespace-nowrap font-display text-[15px] italic tracking-[0.2em] text-sky-200/55" />
        );
      })}
      {cur && <PlayerBanner loc={cur} terrain={terrain} color={bannerColor} glyph={bannerGlyph} />}
      {cur && sel && cur.id !== sel.id && <Route from={cur} to={sel} terrain={terrain} />}
      <CameraRig focus={focus} controls={controls} auto={mode === "hero"} />
    </>
  );
}

export default function WorldMap3D({
  locations, presence = {}, current, selected, onSelect, labels = { places: true, towns: true, regions: true, seas: true },
  mode = "full", height = 560, bannerColor = "#8b1c1c", bannerGlyph = "crown", className,
}: {
  locations: MapLocation[];
  presence?: Presence;
  current?: string | null;
  selected?: string | null;
  onSelect?: (id: string) => void;
  labels?: LabelToggles;
  mode?: "full" | "hero";
  height?: number | string;
  bannerColor?: string;
  bannerGlyph?: string;
  className?: string;
}) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const start = useMemo<[number, number, number]>(() => {
    const l = locations.find((x) => x.id === current);
    if (!l) return [-8, 26, 22];
    const [x, z] = toWorld([l.x, l.y]);
    return [x, 15, z + 13];
  }, [locations, current]);
  const initialTarget = useMemo<[number, number, number]>(() => [start[0], 0, start[2] - 13], [start]);
  return (
    <div className={cn("relative isolate overflow-hidden rounded-xl border border-border", className)} style={{ height }}>
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: start, fov: 45, near: 0.1, far: 220 }} gl={{ antialias: true }}>
        <Suspense fallback={null}>
          <Scene locations={locations} presence={presence} current={current} selected={selected} onSelect={onSelect} labels={labels}
            mode={mode} bannerColor={bannerColor} bannerGlyph={bannerGlyph} controls={controls} />
        </Suspense>
        <OrbitControls
          ref={controls}
          target={initialTarget}
          enableDamping
          dampingFactor={0.08}
          maxPolarAngle={1.25}
          minDistance={3}
          maxDistance={70}
          autoRotate={mode === "hero"}
          autoRotateSpeed={0.35}
          enableZoom={mode === "full"}
          enablePan={mode === "full"}
        />
      </Canvas>
    </div>
  );
}
