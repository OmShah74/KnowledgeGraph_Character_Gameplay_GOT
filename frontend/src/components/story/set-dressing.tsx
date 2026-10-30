"use client";

/**
 * Set dressing for Story Mode: the props, surfaces and atmosphere that turn a stage into a place.
 * Everything is procedural (canvas textures, instancing for repeated pieces) so the sets stay light.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type V3 = [number, number, number];

// ------------------------------------------------------------------ surfaces
const texCache = new Map<string, THREE.CanvasTexture>();

/** Flagstones, planks, cobbles, packed snow, sand or grass — a tiling canvas texture. */
export function surfaceTexture(kind: "flagstone" | "planks" | "cobble" | "snow" | "sand" | "grass" | "dirt", base: string, repeat = 8): THREE.CanvasTexture {
  const key = `${kind}|${base}|${repeat}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const shade = (a: number) => (a > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`);
  if (kind === "flagstone" || kind === "cobble") {
    const rows = kind === "flagstone" ? 6 : 12;
    const h = S / rows;
    for (let r = 0; r < rows; r++) {
      let x = (r % 2) * h * 0.5 - h;
      while (x < S) {
        const w = h * (kind === "flagstone" ? 1 + rnd() * 0.9 : 0.8 + rnd() * 0.4);
        g.fillStyle = shade((rnd() - 0.5) * 0.16);
        g.fillRect(x + 2, r * h + 2, w - 4, h - 4);
        g.strokeStyle = "rgba(0,0,0,0.45)";
        g.lineWidth = 3;
        g.strokeRect(x + 1, r * h + 1, w - 2, h - 2);
        x += w;
      }
    }
  } else if (kind === "planks") {
    const n = 10;
    for (let i = 0; i < n; i++) {
      g.fillStyle = shade((rnd() - 0.5) * 0.18);
      g.fillRect(0, (i * S) / n, S, S / n);
      g.fillStyle = "rgba(0,0,0,0.5)";
      g.fillRect(0, (i * S) / n, S, 2);
      for (let k = 0; k < 14; k++) {
        g.strokeStyle = `rgba(0,0,0,${0.06 + rnd() * 0.08})`;
        g.beginPath();
        const y = (i * S) / n + rnd() * (S / n);
        g.moveTo(0, y);
        g.bezierCurveTo(S * 0.3, y + rnd() * 4 - 2, S * 0.6, y + rnd() * 4 - 2, S, y);
        g.stroke();
      }
      const cut = rnd() * S;
      g.fillStyle = "rgba(0,0,0,0.45)";
      g.fillRect(cut, (i * S) / n, 2, S / n);
    }
  } else {
    // organic grounds: speckle + soft blotches
    const blot = kind === "snow" ? 0.06 : 0.14;
    for (let i = 0; i < 260; i++) {
      const r = 8 + rnd() * 50;
      const grd = g.createRadialGradient(rnd() * S, rnd() * S, 0, rnd() * S, rnd() * S, r);
      grd.addColorStop(0, shade((rnd() - 0.5) * blot * 2));
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
    }
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = kind === "grass" ? `rgba(${40 + rnd() * 60},${90 + rnd() * 80},${20 + rnd() * 30},0.5)` : shade((rnd() - 0.5) * 0.3);
      g.fillRect(rnd() * S, rnd() * S, kind === "grass" ? 1 : 2, kind === "grass" ? 4 : 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

export function Ground({ kind, color, size = 30, rough = 0.95 }: { kind: Parameters<typeof surfaceTexture>[0]; color: string; size?: number; rough?: number }) {
  const map = useMemo(() => surfaceTexture(kind, color, Math.round(size / 3)), [kind, color, size]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[size, 72]} />
      <meshStandardMaterial map={map} roughness={rough} />
    </mesh>
  );
}

// ------------------------------------------------------------------ props
const WOOD = "#5b3f27";
const DARK_WOOD = "#3b2818";
const IRON = "#2b2b2e";

export function Barrel({ p, rot = 0, lying = false, s = 1 }: { p: V3; rot?: number; lying?: boolean; s?: number }) {
  return (
    <group position={p} rotation={lying ? [0, rot, Math.PI / 2] : [0, rot, 0]} scale={s}>
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.32, 0.32, 0.9, 14]} />
        <meshStandardMaterial color={WOOD} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.45, 0]} scale={[1.18, 1, 1.18]}><sphereGeometry args={[0.3, 14, 8]} /><meshStandardMaterial color={WOOD} roughness={0.85} /></mesh>
      {[0.12, 0.78].map((y) => (
        <mesh key={y} position={[0, y, 0]}><torusGeometry args={[0.335, 0.025, 6, 20]} /><meshStandardMaterial color={IRON} metalness={0.7} roughness={0.5} /></mesh>
      ))}
    </group>
  );
}

export function Crate({ p, rot = 0, s = 0.7 }: { p: V3; rot?: number; s?: number }) {
  return (
    <group position={[p[0], p[1] + s / 2, p[2]]} rotation={[0, rot, 0]}>
      <mesh castShadow receiveShadow><boxGeometry args={[s, s, s]} /><meshStandardMaterial color="#7a5a36" roughness={0.9} /></mesh>
      {[-1, 1].map((k) => (
        <mesh key={k} position={[0, 0, (k * s) / 2 + k * 0.005]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[s * 1.3, 0.06, 0.02]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>
      ))}
    </group>
  );
}

export function HayBale({ p, rot = 0 }: { p: V3; rot?: number }) {
  return (
    <mesh position={[p[0], p[1] + 0.3, p[2]]} rotation={[0, rot, Math.PI / 2]} castShadow receiveShadow>
      <cylinderGeometry args={[0.38, 0.38, 0.9, 16]} />
      <meshStandardMaterial color="#c9a85a" roughness={1} />
    </mesh>
  );
}

export function Cart({ p, rot = 0 }: { p: V3; rot?: number }) {
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.75, 0]} castShadow receiveShadow><boxGeometry args={[2.2, 0.12, 1.2]} /><meshStandardMaterial color={WOOD} /></mesh>
      {[-1, 1].map((k) => <mesh key={k} position={[0, 1, k * 0.58]} castShadow><boxGeometry args={[2.2, 0.45, 0.06]} /><meshStandardMaterial color={WOOD} /></mesh>)}
      {[-1, 1].map((k) => (
        <mesh key={k} position={[0, 0.45, k * 0.68]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.45, 0.45, 0.08, 14]} />
          <meshStandardMaterial color={DARK_WOOD} />
        </mesh>
      ))}
      <mesh position={[1.7, 0.7, 0]} rotation={[0, 0, -0.15]}><boxGeometry args={[1.4, 0.06, 0.06]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>
      <HayBale p={[-0.4, 0.8, 0]} rot={0.2} />
    </group>
  );
}

export function Bench({ p, w = 2.6, rot = 0 }: { p: V3; w?: number; rot?: number }) {
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow><boxGeometry args={[w, 0.08, 0.35]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>
      {[-1, 1].map((k) => <mesh key={k} position={[k * (w / 2 - 0.2), 0.22, 0]}><boxGeometry args={[0.08, 0.44, 0.3]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>)}
    </group>
  );
}

/** A long feasting table with benches, platters, cups and candles. */
export function FeastTable({ p, w = 5, rot = 0 }: { p: V3; w?: number; rot?: number }) {
  const items = useMemo(() => Array.from({ length: Math.floor(w / 0.8) }, (_, i) => -w / 2 + 0.4 + i * 0.8), [w]);
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.85, 0]} castShadow receiveShadow><boxGeometry args={[w, 0.09, 1.1]} /><meshStandardMaterial color="#5a3b22" roughness={0.75} /></mesh>
      <mesh position={[0, 0.9, 0]}><boxGeometry args={[w * 0.96, 0.01, 0.5]} /><meshStandardMaterial color="#7a1f1a" roughness={1} /></mesh>
      {[-1, 1].map((k) => <mesh key={k} position={[k * (w / 2 - 0.2), 0.42, 0]}><boxGeometry args={[0.12, 0.84, 0.9]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>)}
      {[-1, 1].map((k) => <Bench key={k} p={[0, 0, k * 0.85]} w={w * 0.95} />)}
      {items.map((x, i) => (
        <group key={x} position={[x, 0.9, (i % 2 ? 1 : -1) * 0.28]}>
          {i % 3 === 0 ? (
            <mesh position={[0, 0.03, 0]}><cylinderGeometry args={[0.18, 0.15, 0.04, 16]} /><meshStandardMaterial color="#a8a29a" metalness={0.6} roughness={0.35} /></mesh>
          ) : (
            <mesh position={[0, 0.08, 0]}><cylinderGeometry args={[0.05, 0.04, 0.16, 10]} /><meshStandardMaterial color="#9c7a3a" metalness={0.7} roughness={0.35} /></mesh>
          )}
        </group>
      ))}
      {[-w / 3, 0, w / 3].map((x) => <Candle key={x} p={[x, 0.9, 0]} />)}
    </group>
  );
}

export function Candle({ p, h = 0.22, light = false }: { p: V3; h?: number; light?: boolean }) {
  const flame = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 12 + seed;
    if (flame.current) flame.current.scale.set(1, 1 + Math.sin(t) * 0.18 + Math.sin(t * 2.7) * 0.1, 1);
  });
  return (
    <group position={p}>
      <mesh position={[0, h / 2, 0]}><cylinderGeometry args={[0.035, 0.04, h, 8]} /><meshStandardMaterial color="#eadfc4" roughness={0.6} /></mesh>
      <mesh ref={flame} position={[0, h + 0.045, 0]}><coneGeometry args={[0.022, 0.08, 6]} /><meshBasicMaterial color="#ffd27a" toneMapped={false} /></mesh>
      {light && <pointLight position={[0, h + 0.2, 0]} color="#ffb862" intensity={1.6} distance={4} decay={1.8} />}
    </group>
  );
}

/** A wall-mounted torch in an iron sconce, with a real flickering light. */
export function Sconce({ p, rot = 0, light = true }: { p: V3; rot?: number; light?: boolean }) {
  const flame = useRef<THREE.Mesh>(null);
  const lamp = useRef<THREE.PointLight>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 10 + seed;
    const f = 1 + Math.sin(t) * 0.1 + Math.sin(t * 2.1) * 0.07;
    if (flame.current) flame.current.scale.set(1, f, 1);
    if (lamp.current) lamp.current.intensity = 5 * f;
  });
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <mesh position={[0, 0, 0.12]} rotation={[0.5, 0, 0]}><cylinderGeometry args={[0.05, 0.035, 0.55, 8]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>
      <mesh position={[0, -0.05, 0.02]}><boxGeometry args={[0.12, 0.25, 0.05]} /><meshStandardMaterial color={IRON} metalness={0.7} /></mesh>
      <mesh ref={flame} position={[0, 0.32, 0.26]}><coneGeometry args={[0.09, 0.32, 8]} /><meshBasicMaterial color="#ffb347" toneMapped={false} transparent opacity={0.92} /></mesh>
      {light && <pointLight ref={lamp} position={[0, 0.5, 0.45]} color="#ff9440" distance={7} decay={1.7} />}
    </group>
  );
}

/** Crenellated curtain wall with a wall-walk — castles read as castles. */
export function CastleWall({ p, w, h = 7, rot = 0, color }: { p: V3; w: number; h?: number; rot?: number; color: string }) {
  const merlons = Math.floor(w / 1.2);
  const ref = useRef<THREE.InstancedMesh>(null);
  const map = useMemo(() => surfaceTexture("flagstone", color, 1), [color]);
  const wallMap = useMemo(() => { const t = map.clone(); t.repeat.set(w / 4, h / 4); t.needsUpdate = true; return t; }, [map, w, h]);
  useEffect(() => () => wallMap.dispose(), [wallMap]);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < merlons; i++) {
      o.position.set(-w / 2 + 0.6 + i * 1.2, h + 0.35, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [merlons, w, h]);
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow><boxGeometry args={[w, h, 1]} /><meshStandardMaterial map={wallMap} color="#ffffff" roughness={0.95} /></mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, merlons]} castShadow>
        <boxGeometry args={[0.7, 0.7, 1]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </instancedMesh>
    </group>
  );
}

export function Tower({ p, r = 2.2, h = 13, color }: { p: V3; r?: number; h?: number; color: string }) {
  return (
    <group position={p}>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow><cylinderGeometry args={[r, r * 1.08, h, 20]} /><meshStandardMaterial color={color} roughness={0.95} /></mesh>
      <mesh position={[0, h + 0.4, 0]}><cylinderGeometry args={[r * 1.15, r * 1.15, 0.8, 20]} /><meshStandardMaterial color={color} roughness={0.95} /></mesh>
      {[0.3, 0.55, 0.8].map((k) => (
        <mesh key={k} position={[0, h * k, r * 1.01]}><boxGeometry args={[0.25, 0.7, 0.05]} /><meshBasicMaterial color="#ffb050" toneMapped={false} /></mesh>
      ))}
    </group>
  );
}

/** Wooden gallery / scaffolding along a wall. */
export function Gallery({ p, w = 10, h = 3, rot = 0 }: { p: V3; w?: number; h?: number; rot?: number }) {
  const posts = Math.floor(w / 2) + 1;
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <mesh position={[0, h, 0]} castShadow receiveShadow><boxGeometry args={[w, 0.15, 1.6]} /><meshStandardMaterial color={WOOD} /></mesh>
      <mesh position={[0, h + 0.55, 0.78]}><boxGeometry args={[w, 0.08, 0.08]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>
      {Array.from({ length: posts }, (_, i) => -w / 2 + (i * w) / (posts - 1)).map((x) => (
        <group key={x}>
          <mesh position={[x, h / 2, 0.7]} castShadow><boxGeometry args={[0.16, h, 0.16]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>
          <mesh position={[x, h + 0.3, 0.78]}><boxGeometry args={[0.07, 0.6, 0.07]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>
        </group>
      ))}
    </group>
  );
}

export function TrainingDummy({ p, rot = 0 }: { p: V3; rot?: number }) {
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.8, 0]}><cylinderGeometry args={[0.05, 0.05, 1.6, 6]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>
      <mesh position={[0, 1.25, 0]} castShadow><cylinderGeometry args={[0.22, 0.2, 0.7, 10]} /><meshStandardMaterial color="#b89a62" roughness={1} /></mesh>
      <mesh position={[0, 1.3, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.04, 0.04, 1, 6]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>
      <mesh position={[0, 1.75, 0]} castShadow><sphereGeometry args={[0.16, 10, 8]} /><meshStandardMaterial color="#b89a62" roughness={1} /></mesh>
    </group>
  );
}

export function ArcheryTarget({ p, rot = 0 }: { p: V3; rot?: number }) {
  return (
    <group position={p} rotation={[0, rot, 0]}>
      {[-0.35, 0.35].map((x) => <mesh key={x} position={[x, 0.7, -0.15]} rotation={[-0.2, 0, 0]}><boxGeometry args={[0.06, 1.5, 0.06]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>)}
      {[["#e8dcc0", 0.55], ["#2a2a2a", 0.42], ["#2a5aa8", 0.3], ["#b8242a", 0.18], ["#e8c25a", 0.07]].map(([c, r], i) => (
        <mesh key={i} position={[0, 1.15, 0.01 * i]} rotation={[-0.2, 0, 0]}><circleGeometry args={[r as number, 24]} /><meshStandardMaterial color={c as string} side={THREE.DoubleSide} /></mesh>
      ))}
    </group>
  );
}

export function WeaponRack({ p, rot = 0 }: { p: V3; rot?: number }) {
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.9, 0]}><boxGeometry args={[1.6, 0.08, 0.12]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>
      <mesh position={[0, 0.25, 0]}><boxGeometry args={[1.6, 0.08, 0.3]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>
      {[-0.55, -0.2, 0.15, 0.5].map((x, i) => (
        <group key={x} position={[x, 0.75, 0]} rotation={[0, 0, (i - 1.5) * 0.04]}>
          <mesh><boxGeometry args={[0.05, 1.2, 0.015]} /><meshStandardMaterial color="#c8ccd2" metalness={0.9} roughness={0.25} /></mesh>
          <mesh position={[0, -0.5, 0]}><boxGeometry args={[0.24, 0.04, 0.04]} /><meshStandardMaterial color="#6a5030" /></mesh>
        </group>
      ))}
    </group>
  );
}

export function Rug({ p, w = 3, d = 8, color = "#6e1b18", border = "#c9a24a", rot = 0 }: { p: V3; w?: number; d?: number; color?: string; border?: string; rot?: number }) {
  return (
    <group position={[p[0], p[1] + 0.012, p[2]]} rotation={[-Math.PI / 2, 0, rot]}>
      <mesh receiveShadow><planeGeometry args={[w, d]} /><meshStandardMaterial color={border} roughness={1} /></mesh>
      <mesh position={[0, 0, 0.002]} receiveShadow><planeGeometry args={[w - 0.3, d - 0.3]} /><meshStandardMaterial color={color} roughness={1} /></mesh>
    </group>
  );
}

export function Rocks({ count = 24, radius = [8, 16] as [number, number], color = "#5c5a57", y = 0 }: { count?: number; radius?: [number, number]; color?: string; y?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = radius[0] + Math.random() * (radius[1] - radius[0]);
      o.position.set(Math.cos(a) * r, y + 0.1, Math.sin(a) * r);
      o.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const s = 0.25 + Math.random() * 0.9;
      o.scale.set(s * (0.8 + Math.random() * 0.6), s * 0.6, s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [count, radius, y]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} castShadow receiveShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color={color} roughness={1} flatShading />
    </instancedMesh>
  );
}

export function Log({ p, rot = 0, l = 3 }: { p: V3; rot?: number; l?: number }) {
  return (
    <mesh position={[p[0], p[1] + 0.25, p[2]]} rotation={[0, rot, Math.PI / 2]} castShadow receiveShadow>
      <cylinderGeometry args={[0.25, 0.3, l, 10]} />
      <meshStandardMaterial color="#4a3a2c" roughness={1} />
    </mesh>
  );
}

/** Market stall with a striped awning. */
export function Stall({ p, rot = 0, color = "#b23a2a" }: { p: V3; rot?: number; color?: string }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 8;
    const g = c.getContext("2d")!;
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#efe4c8" : color; g.fillRect(i * 8, 0, 8, 8); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [color]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow><boxGeometry args={[2.2, 1, 0.9]} /><meshStandardMaterial color="#7a5a36" /></mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x * 1.05, 1.25, z * 0.5]}><boxGeometry args={[0.07, 2.5, 0.07]} /><meshStandardMaterial color={DARK_WOOD} /></mesh>
      ))}
      <mesh position={[0, 2.5, 0.1]} rotation={[-0.25, 0, 0]} castShadow><boxGeometry args={[2.4, 0.04, 1.5]} /><meshStandardMaterial map={tex} roughness={1} /></mesh>
      {[-0.7, -0.25, 0.2, 0.65].map((x, i) => (
        <mesh key={x} position={[x, 1.1, 0]}><sphereGeometry args={[0.16, 10, 8]} /><meshStandardMaterial color={["#e0a030", "#a82a2a", "#6a8a2a", "#d8c070"][i]} /></mesh>
      ))}
    </group>
  );
}

export function CellBars({ p, w = 4, rot = 0 }: { p: V3; w?: number; rot?: number }) {
  const n = Math.floor(w / 0.25);
  return (
    <group position={p} rotation={[0, rot, 0]}>
      {Array.from({ length: n }, (_, i) => -w / 2 + i * 0.25).map((x) => (
        <mesh key={x} position={[x, 1.4, 0]}><cylinderGeometry args={[0.025, 0.025, 2.8, 6]} /><meshStandardMaterial color={IRON} metalness={0.8} roughness={0.45} /></mesh>
      ))}
      {[0.1, 2.75].map((y) => <mesh key={y} position={[0, y, 0]}><boxGeometry args={[w, 0.08, 0.08]} /><meshStandardMaterial color={IRON} metalness={0.8} /></mesh>)}
    </group>
  );
}

export function Chains({ p }: { p: V3 }) {
  return (
    <group position={p}>
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} position={[0, -i * 0.12, 0]} rotation={[0, i % 2 ? Math.PI / 2 : 0, 0]}>
          <torusGeometry args={[0.05, 0.014, 6, 12]} />
          <meshStandardMaterial color={IRON} metalness={0.8} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

/** Painted map table (the Painted Table at Dragonstone / the small council's map). */
export function MapTable({ p, w = 5, d = 2.6 }: { p: V3; w?: number; d?: number }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#24435a"; g.fillRect(0, 0, 512, 256);
    // Westeros (rough silhouette) and Essos
    g.fillStyle = "#9c8a5a";
    g.beginPath();
    g.moveTo(150, 10); g.lineTo(200, 14); g.lineTo(206, 60); g.lineTo(230, 110); g.lineTo(218, 150); g.lineTo(240, 200);
    g.lineTo(212, 246); g.lineTo(150, 236); g.lineTo(130, 190); g.lineTo(110, 150); g.lineTo(126, 100); g.lineTo(118, 50); g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(290, 70); g.lineTo(500, 50); g.lineTo(505, 210); g.lineTo(330, 230); g.lineTo(300, 170); g.closePath();
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.12)";
    for (let i = 0; i < 512; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <group position={p}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow><boxGeometry args={[w, 1, d]} /><meshStandardMaterial color="#2c2018" /></mesh>
      <mesh position={[0, 1.005, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[w * 0.94, d * 0.9]} /><meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.25} roughness={0.7} /></mesh>
      {[[-1.2, -0.4, "#b8242a"], [-0.9, 0.5, "#e8c25a"], [0.8, -0.3, "#3a3a3a"], [1.5, 0.2, "#7a1b18"], [-1.5, 0.1, "#dcdcdc"]].map(([x, z, c], i) => (
        <mesh key={i} position={[x as number, 1.08, z as number]}><coneGeometry args={[0.06, 0.16, 6]} /><meshStandardMaterial color={c as string} metalness={0.4} /></mesh>
      ))}
    </group>
  );
}

/** Stained-glass window that throws a soft shaft of coloured light into the hall. */
export function LightShaft({ p, rot = 0, color = "#ffe2a8", w = 1.6, h = 3.4, len = 12, tilt = 0.75 }: { p: V3; rot?: number; color?: string; w?: number; h?: number; len?: number; tilt?: number }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(w * 0.55, w * 1.6, len, 4, 1, true);
    g.rotateY(Math.PI / 4);
    g.translate(0, -len / 2, 0);
    return g;
  }, [w, len]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.075 + Math.sin(clock.getElapsedTime() * 0.4 + seed) * 0.02;
  });
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <mesh><planeGeometry args={[w, h]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
      <mesh geometry={geo} rotation={[tilt, 0, 0]}>
        <meshBasicMaterial ref={mat} color={color} transparent opacity={0.08} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Low drifting ground mist built from soft sprite planes. */
export function GroundMist({ color = "#d8e2ee", count = 14, radius = 12, opacity = 0.35, y = 0.25 }: { color?: string; count?: number; radius?: number; opacity?: number; y?: number }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  const puffs = useMemo(() => Array.from({ length: count }, (_, i) => ({
    a: (i / count) * Math.PI * 2 + Math.random(), r: radius * (0.35 + Math.random() * 0.65), s: 4 + Math.random() * 5, sp: 0.02 + Math.random() * 0.04,
  })), [count, radius]);
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    group.current?.children.forEach((m, i) => {
      const p = puffs[i];
      p.a += p.sp * dt;
      m.position.set(Math.cos(p.a) * p.r, y + (i % 3) * 0.12, Math.sin(p.a) * p.r);
    });
  });
  return (
    <group ref={group}>
      {puffs.map((p, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, p.a]} scale={p.s}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={tex} color={color} transparent opacity={opacity} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Drifting god-light motes for interiors (dust in the sun) — cheap points. */
export function Motes({ count = 140, color = "#ffe6b0", area = 8 }: { count?: number; color?: string; area?: number }) {
  const ref = useRef<THREE.Points>(null);
  const data = useMemo(() => {
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { p[i * 3] = (Math.random() - 0.5) * area * 2; p[i * 3 + 1] = Math.random() * 6; p[i * 3 + 2] = (Math.random() - 0.5) * area * 2; }
    return p;
  }, [count, area]);
  useFrame(({ clock }) => {
    if (ref.current) { ref.current.rotation.y = clock.getElapsedTime() * 0.01; ref.current.position.y = Math.sin(clock.getElapsedTime() * 0.2) * 0.2; }
  });
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[data, 3]} /></bufferGeometry>
      <pointsMaterial size={0.035} color={color} transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

/** Spotlight pool that follows whoever is speaking (a stage-craft trick that reads well in-game). */
export function SpeakerLight({ target }: { target: React.MutableRefObject<THREE.Vector3 | null> }) {
  const light = useRef<THREE.SpotLight>(null);
  const ring = useRef<THREE.Mesh>(null);
  const tgt = useMemo(() => new THREE.Object3D(), []);
  const cur = useRef(new THREE.Vector3(0, 0, 0));
  const amt = useRef(0);
  useFrame((_, dt) => {
    const t = target.current;
    amt.current += ((t ? 1 : 0) - amt.current) * Math.min(1, dt * 3);
    if (t) cur.current.lerp(t, Math.min(1, dt * 5));
    tgt.position.copy(cur.current);
    tgt.updateMatrixWorld();
    if (light.current) {
      light.current.position.set(cur.current.x + 1.2, 7, cur.current.z + 2);
      light.current.intensity = 26 * amt.current;
    }
    if (ring.current) {
      ring.current.position.set(cur.current.x, 0.025, cur.current.z);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.35 * amt.current;
      ring.current.rotation.z += dt * 0.4;
    }
  });
  return (
    <>
      <primitive object={tgt} />
      <spotLight ref={light} target={tgt} angle={0.32} penumbra={0.8} distance={14} decay={1.4} color="#ffe7c2" />
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.62, 48]} />
        <meshBasicMaterial color="#f3cf7a" transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );
}
