"use client";

/**
 * Location sets for Story Mode scenes. Each set is assembled from shared primitives
 * (floor, walls, pillars, banners, braziers, trees, particles) at a 1 unit ≈ 1 metre scale,
 * centred on a 7 m playable circle where the cast stands.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { IronThrone, Weirwood } from "@/components/three/artifacts";
import { bannerTexture } from "@/components/three/textures";
import {
  ArcheryTarget, Barrel, Bench, Candle, Cart, CastleWall, CellBars, Chains, Crate, FeastTable, Gallery, Ground, GroundMist, HayBale, LightShaft,
  Log, MapTable, Motes, Rocks, Rug, Sconce, Stall, Tower, TrainingDummy, WeaponRack,
} from "./set-dressing";
import { HOUSE_SIGIL } from "@/components/heraldry";

import { HOUSE_OF_LOCATION, type SetId } from "./stage-data";
export { HOUSE_OF_LOCATION, type SetId };

const BOOKS = ["#6a2a1a", "#2a3a5a", "#5a4a1a", "#3a5a2a"];

function Pillar({ p, h = 6, r = 0.35, color = "#5b5650" }: { p: [number, number, number]; h?: number; r?: number; color?: string }) {
  return (
    <group position={p}>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow><cylinderGeometry args={[r, r * 1.1, h, 16]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
      <mesh position={[0, 0.15, 0]}><boxGeometry args={[r * 2.6, 0.3, r * 2.6]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[0, h - 0.1, 0]}><boxGeometry args={[r * 2.6, 0.25, r * 2.6]} /><meshStandardMaterial color={color} /></mesh>
    </group>
  );
}

function Wall({ p, w, h, rot = 0, color }: { p: [number, number, number]; w: number; h: number; rot?: number; color: string }) {
  return (
    <mesh position={[p[0], h / 2, p[2]]} rotation={[0, rot, 0]} receiveShadow castShadow>
      <boxGeometry args={[w, h, 0.6]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

function Banner({ p, house, rot = 0, h = 3.2 }: { p: [number, number, number]; house: string; rot?: number; h?: number }) {
  const s = HOUSE_SIGIL[house] ?? HOUSE_SIGIL.stark;
  const tex = useMemo(() => bannerTexture(s.field, s.glyph, s.color), [s]);
  const geo = useMemo(() => new THREE.PlaneGeometry(1.4, h, 8, 12), [h]);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array as Float32Array), [geo]);
  const seed = useMemo(() => Math.random() * 10, []);
  useEffect(() => () => { tex.dispose(); geo.dispose(); }, [tex, geo]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + seed;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = base[i * 3 + 1];
      pos.setZ(i, Math.sin(t * 1.6 + y * 1.4) * 0.05 * (h / 2 - y) / h);
    }
    pos.needsUpdate = true;
  });
  return (
    <mesh geometry={geo} position={p} rotation={[0, rot, 0]} castShadow>
      <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.9} />
    </mesh>
  );
}

function Fire({ p, scale = 1, light = true }: { p: [number, number, number]; scale?: number; light?: boolean }) {
  const flame = useRef<THREE.Mesh>(null);
  const lamp = useRef<THREE.PointLight>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 9 + seed;
    const f = 1 + Math.sin(t) * 0.08 + Math.sin(t * 2.3) * 0.06;
    if (flame.current) flame.current.scale.set(scale * (0.9 + Math.sin(t * 1.7) * 0.05), scale * f, scale);
    if (lamp.current) lamp.current.intensity = 14 * scale * f;
  });
  return (
    <group position={p}>
      <mesh position={[0, 0.5 * scale, 0]}><cylinderGeometry args={[0.28 * scale, 0.18 * scale, 1 * scale, 10]} /><meshStandardMaterial color="#2a2420" metalness={0.6} /></mesh>
      <mesh ref={flame} position={[0, 1.25 * scale, 0]}>
        <coneGeometry args={[0.22, 0.6, 10]} />
        <meshStandardMaterial color="#ffb347" emissive="#ff6a00" emissiveIntensity={3} transparent opacity={0.9} />
      </mesh>
      {light && <pointLight ref={lamp} position={[0, 1.6 * scale, 0]} color="#ff9a4a" distance={10} decay={1.6} />}
    </group>
  );
}

function Table({ p, w = 3, d = 1.2, color = "#5a3e26" }: { p: [number, number, number]; w?: number; d?: number; color?: string }) {
  return (
    <group position={p}>
      <mesh position={[0, 0.9, 0]} castShadow receiveShadow><boxGeometry args={[w, 0.1, d]} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x * (w / 2 - 0.1), 0.45, z * (d / 2 - 0.1)]}><boxGeometry args={[0.1, 0.9, 0.1]} /><meshStandardMaterial color={color} /></mesh>
      ))}
    </group>
  );
}

function Pines({ count = 90, radius = [9, 24] as [number, number], snowy = true }: { count?: number; radius?: [number, number]; snowy?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => { const g = new THREE.ConeGeometry(0.9, 3.2, 7); g.translate(0, 1.9, 0); return g; }, []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: snowy ? "#2d4436" : "#2f5a2a", roughness: 0.9 }), [snowy]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = radius[0] + Math.random() * (radius[1] - radius[0]);
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      o.scale.setScalar(0.7 + Math.random() * 0.9);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [count, radius]);
  return <instancedMesh ref={ref} args={[geo, mat, count]} castShadow />;
}

function Weather({ kind, count = 600, area = 18 }: { kind: "snow" | "embers" | "dust" | "ash"; count?: number; area?: number }) {
  const ref = useRef<THREE.Points>(null);
  const data = useMemo(() => {
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * area * 2;
      p[i * 3 + 1] = Math.random() * 9;
      p[i * 3 + 2] = (Math.random() - 0.5) * area * 2;
    }
    return p;
  }, [count, area]);
  useFrame((_, dt) => {
    const pts = ref.current;
    if (!pts) return;
    const a = pts.geometry.attributes.position.array as Float32Array;
    const v = kind === "embers" ? 0.9 : kind === "snow" ? -0.8 : kind === "ash" ? -0.3 : 0.05;
    for (let i = 0; i < count; i++) {
      a[i * 3 + 1] += v * dt * (0.6 + (i % 7) / 10);
      a[i * 3] += Math.sin(a[i * 3 + 1] + i) * dt * 0.2;
      if (a[i * 3 + 1] < 0) a[i * 3 + 1] = 9;
      if (a[i * 3 + 1] > 9) a[i * 3 + 1] = 0;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  });
  const color = kind === "snow" ? "#f4f8ff" : kind === "embers" ? "#ff8a3d" : kind === "ash" ? "#8a8580" : "#e8d3a0";
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[data, 3]} /></bufferGeometry>
      <pointsMaterial size={kind === "snow" ? 0.07 : 0.05} color={color} transparent opacity={0.8} depthWrite={false}
        blending={kind === "embers" ? THREE.AdditiveBlending : THREE.NormalBlending} />
    </points>
  );
}

function Hall({ floor, wall, house, pillars = true, hearth = true, planks = false }: { floor: string; wall: string; house: string; pillars?: boolean; hearth?: boolean; planks?: boolean }) {
  return (
    <>
      <Ground kind={planks ? "planks" : "flagstone"} color={floor} />
      {[-7, 0, 7].map((z) => [-10.6, 10.6].map((x) => <Sconce key={`${x}${z}`} p={[x, 3.2, z - 1]} rot={x < 0 ? Math.PI / 2 : -Math.PI / 2} light={z === 0} />))}
      <Motes />
      <Wall p={[0, 0, -10]} w={22} h={8} color={wall} />
      <Wall p={[-11, 0, 0]} w={20} h={8} rot={Math.PI / 2} color={wall} />
      <Wall p={[11, 0, 0]} w={20} h={8} rot={Math.PI / 2} color={wall} />
      {pillars && [-6, -2, 2].map((z) => [-7, 7].map((x) => <Pillar key={`${x}${z}`} p={[x, 0, z]} h={7.5} color={wall} />))}
      {[-4, 4].map((x) => <Banner key={x} p={[x, 4.6, -9.6]} house={house} />)}
      {[-10.6, 10.6].map((x) => <Banner key={x} p={[x, 4.4, -4]} house={house} rot={x < 0 ? Math.PI / 2 : -Math.PI / 2} h={2.6} />)}
      {hearth && <Fire p={[0, 0, -8.6]} scale={1.6} />}
      <Fire p={[-6, 0, 4]} />
      <Fire p={[6, 0, 4]} />
    </>
  );
}

export function SceneSet({ id, house = "stark" }: { id: SetId; house?: string }) {
  switch (id) {
    case "throne_room":
      return (
        <>
          <color attach="background" args={["#160c08"]} /><fog attach="fog" args={["#160c08", 12, 32]} />
          <ambientLight intensity={0.35} />
          <Hall floor="#5a2a1e" wall="#6e3a2a" house={house} hearth={false} />
          <mesh position={[0, 0.3, -7.5]} receiveShadow><boxGeometry args={[6, 0.6, 3]} /><meshStandardMaterial color="#3a1c14" /></mesh>
          <IronThrone position={[0, 0.6, -7.6]} scale={1.5} />
          <Rug p={[0, 0, -1]} w={2.4} d={11} color="#7a1414" border="#d4a640" />
          {[-8, 0, 8].map((z) => <LightShaft key={z} p={[-10.4, 6, z * 0.5 - 3]} rot={Math.PI / 2} color="#ffd59a" />)}
          {[-4, 4].map((x) => <group key={x}><Candle p={[x * 0.6, 0.6, -6.3]} h={0.6} light /><Candle p={[x * 0.75, 0.6, -6.6]} h={0.45} /></group>)}
          <directionalLight position={[2, 9, 4]} intensity={1.4} color="#ffd9a0" castShadow />
        </>
      );
    case "war_room":
      return (
        <>
          <color attach="background" args={["#0b0b0d"]} /><fog attach="fog" args={["#0b0b0d", 10, 26]} />
          <ambientLight intensity={0.3} />
          <Hall floor="#1c1c1f" wall="#26262b" house={house} />
          <MapTable p={[0, 0, -3.5]} />
          {[-2.6, 2.6].map((x) => <Candle key={x} p={[x, 1, -2.4]} h={0.4} light />)}
          <LightShaft p={[0, 6.5, -9.6]} color="#c8d8ff" tilt={0.9} />
          <pointLight position={[0, 3, -3.5]} intensity={10} color="#ffcf8a" distance={8} />
          <Weather kind="ash" count={200} />
        </>
      );
    case "courtyard_snow":
      return (
        <>
          <color attach="background" args={["#9aa7b4"]} /><fog attach="fog" args={["#9aa7b4", 10, 34]} />
          <hemisphereLight args={["#dfe9f5", "#5a5550", 0.9]} />
          <directionalLight position={[-6, 10, 6]} intensity={1.2} color="#eef3ff" castShadow />
          <Ground kind="snow" color="#e4e8ec" rough={1} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}><circleGeometry args={[2.6, 40]} /><meshStandardMaterial color="#b9b2a6" roughness={1} transparent opacity={0.22} /></mesh>
          <CastleWall p={[0, 0, -11.5]} w={26} h={8} color="#7d8085" />
          <CastleWall p={[-12.5, 0, 0]} w={24} h={8} rot={Math.PI / 2} color="#7d8085" />
          <CastleWall p={[12.5, 0, 0]} w={24} h={8} rot={-Math.PI / 2} color="#7d8085" />
          <Tower p={[-12, 0, -11]} color="#73767b" /><Tower p={[12, 0, -11]} color="#73767b" />
          <Tower p={[0, 0, -17]} r={3.2} h={20} color="#6a6d72" />
          <Gallery p={[-11.2, 0, 0]} w={14} rot={Math.PI / 2} />
          <Cart p={[7.5, 0, -6]} rot={-0.5} />
          {[[-7.5, -7.5], [-8.2, -6.6], [-6.8, -7]].map(([x, z], i) => <Barrel key={i} p={[x, 0, z]} rot={i} />)}
          <Crate p={[8.6, 0, -8.6]} /><Crate p={[9.2, 0, -7.9]} rot={0.4} s={0.6} /><Crate p={[8.8, 0.7, -8.5]} rot={0.2} s={0.55} />
          <HayBale p={[9.5, 0, -3]} rot={0.3} /><HayBale p={[9.8, 0, -1.8]} rot={-0.2} />
          {[[-8, 6], [-6.6, 7.2]].map(([x, z], i) => <ArcheryTarget key={i} p={[x, 0, z]} rot={Math.PI * 0.75} />)}
          <TrainingDummy p={[7, 0, 5.5]} rot={-0.6} /><WeaponRack p={[9.6, 0, 3]} rot={-Math.PI / 2} />
          <Rocks count={14} radius={[9, 11]} color="#8a8c90" />
          <GroundMist color="#eef3fa" opacity={0.22} />
          {[-3, 3].map((x) => <Banner key={x} p={[x, 5.5, -10.6]} house={house} h={3.6} />)}
          <Fire p={[-5, 0, 2]} /><Fire p={[5, 0, 2]} />
          <Weather kind="snow" count={900} />
        </>
      );
    case "wall_yard":
      return (
        <>
          <color attach="background" args={["#a9b8c6"]} /><fog attach="fog" args={["#a9b8c6", 12, 40]} />
          <hemisphereLight args={["#e3eefa", "#4a4a4a", 0.95]} />
          <directionalLight position={[4, 12, 8]} intensity={1.1} castShadow />
          <Ground kind="snow" color="#d9dee3" rough={1} />
          <Gallery p={[0, 0, -11.2]} w={22} h={4} />
          <Gallery p={[0, 4.15, -11.6]} w={18} h={4} />
          <Barrel p={[-7, 0, -2]} /><Barrel p={[-7.6, 0, -1.4]} rot={1} /><Crate p={[7.4, 0, -2]} />
          <WeaponRack p={[8.5, 0, 2]} rot={-Math.PI / 2} /><TrainingDummy p={[-6, 0, 5]} rot={0.5} /><TrainingDummy p={[-4.5, 0, 6.5]} rot={0.3} />
          <GroundMist color="#f1f6fc" opacity={0.25} />
          <mesh position={[0, 20, -14]}><boxGeometry args={[80, 40, 4]} /><meshStandardMaterial color="#cfe6ff" emissive="#4d7fb8" emissiveIntensity={0.2} roughness={0.2} /></mesh>
          {[-6, 6].map((x) => <group key={x} position={[x, 0, -6]}><Wall p={[0, 0, 0]} w={4} h={5} color="#2a2826" /></group>)}
          <Banner p={[0, 3.6, -11.6]} house="stark" />
          <Fire p={[-4, 0, 3]} /><Fire p={[4, 0, 3]} />
          <Weather kind="snow" count={900} />
        </>
      );
    case "snow_forest":
      return (
        <>
          <color attach="background" args={["#7b8fa3"]} /><fog attach="fog" args={["#7b8fa3", 6, 26]} />
          <hemisphereLight args={["#cfe0ff", "#2a2a2a", 0.8]} />
          <directionalLight position={[-5, 10, -4]} intensity={0.9} color="#cfe3ff" castShadow />
          <Ground kind="snow" color="#dde3e8" rough={1} />
          <Pines count={120} />
          <Rocks count={30} radius={[5, 14]} color="#6a6d72" />
          <Log p={[-3.5, 0, -1]} rot={0.6} /><Log p={[4.2, 0, -2.5]} rot={-0.3} l={2.4} />
          <GroundMist color="#e8eef6" count={18} opacity={0.4} />
          <Fire p={[0, 0, -3]} scale={0.8} />
          <Weather kind="snow" count={1000} />
        </>
      );
    case "weirwood_cave":
      return (
        <>
          <color attach="background" args={["#050806"]} /><fog attach="fog" args={["#050806", 5, 18]} />
          <ambientLight intensity={0.25} />
          <Ground kind="dirt" color="#2a2b26" />
          <Weirwood position={[0, 0, -5]} scale={2.4} />
          <Rocks count={40} radius={[6, 12]} color="#3a3a34" />
          <GroundMist color="#a8ffb0" opacity={0.12} />
          <Motes color="#b8ffb0" />
          <pointLight position={[0, 4, -3]} intensity={12} color="#9cff8a" distance={14} />
          <Fire p={[3, 0, 1]} scale={0.7} />
        </>
      );
    case "dungeon":
      return (
        <>
          <color attach="background" args={["#060505"]} /><fog attach="fog" args={["#060505", 6, 20]} />
          <ambientLight intensity={0.15} />
          <Hall floor="#221c1c" wall="#2e2626" house={house} pillars hearth={false} />
          <CellBars p={[-7, 0, -7.5]} w={5} /><CellBars p={[7, 0, -7.5]} w={5} />
          {[-2, 0, 2].map((x) => <Chains key={x} p={[x, 3, -9.5]} />)}
          <Rocks count={10} radius={[6, 9]} color="#3a3434" />
          <mesh position={[0, 1.2, -6]}><boxGeometry args={[0.2, 2.4, 0.2]} /><meshStandardMaterial color="#4a3a2a" /></mesh>
          <mesh position={[0, 2.4, -6]}><boxGeometry args={[2, 0.2, 0.2]} /><meshStandardMaterial color="#4a3a2a" /></mesh>
        </>
      );
    case "sea_keep":
      return (
        <>
          <color attach="background" args={["#3a4550"]} /><fog attach="fog" args={["#3a4550", 10, 40]} />
          <hemisphereLight args={["#aab8c6", "#1a1a1a", 0.8]} />
          <directionalLight position={[6, 10, 4]} intensity={1} castShadow />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]}><planeGeometry args={[200, 200]} /><meshStandardMaterial color="#1d3442" roughness={0.3} metalness={0.4} /></mesh>
          <mesh position={[0, -0.3, 0]} receiveShadow><cylinderGeometry args={[9, 10, 1, 24]} /><meshStandardMaterial color="#3a3c40" /></mesh>
          {[-5, 5].map((x) => <Pillar key={x} p={[x, 0.2, -6]} h={8} r={0.8} color="#2e3035" />)}
          <Banner p={[0, 3.6, -6.2]} house="greyjoy" />
          <Rocks count={26} radius={[10, 16]} color="#2a2c30" y={-0.5} />
          <Barrel p={[6, 0.2, 2]} /><Crate p={[-6.4, 0.2, 2.4]} /><Sconce p={[-5, 3, -5.2]} /><Sconce p={[5, 3, -5.2]} />
          <GroundMist color="#9aa8b4" opacity={0.3} y={0.4} />
          <Weather kind="ash" count={200} />
        </>
      );
    case "ruined_hall":
      return (
        <>
          <color attach="background" args={["#1a1714"]} /><fog attach="fog" args={["#1a1714", 8, 28]} />
          <ambientLight intensity={0.35} />
          <directionalLight position={[3, 10, 2]} intensity={1} castShadow />
          <Ground kind="flagstone" color="#2a2622" />
          <Rocks count={40} radius={[4, 12]} color="#3a3530" />
          <Log p={[3, 0, 3]} rot={1.1} l={4} />
          {[[-7, -5, 7], [7, -5, 4], [-7, 1, 3], [7, 1, 7], [0, -9, 9]].map(([x, z, h]) => <Pillar key={`${x}${z}`} p={[x, 0, z]} h={h} r={0.7} color="#2e2a27" />)}
          <Banner p={[0, 3.4, -8.5]} house={house} />
          <Fire p={[0, 0, -4]} scale={1.2} />
          <Weather kind="ash" count={300} />
        </>
      );
    case "tavern":
      return (
        <>
          <color attach="background" args={["#120c08"]} /><fog attach="fog" args={["#120c08", 8, 22]} />
          <ambientLight intensity={0.35} />
          <Hall floor="#4a3322" wall="#5a4030" house={house} pillars={false} planks />
          <Table p={[-3, 0, -3]} /><Table p={[3, 0, -3]} /><Table p={[0, 0, -6]} w={4} />
          {[[-3, -3], [3, -3], [0, -6]].map(([x, z]) => <Candle key={`${x}${z}`} p={[x, 0.95, z]} light />)}
          <Bench p={[-3, 0, -2.1]} /><Bench p={[3, 0, -2.1]} />
          <mesh position={[-8, 0.55, 2]} castShadow><boxGeometry args={[1, 1.1, 6]} /><meshStandardMaterial color="#3b2818" /></mesh>
          {[0, 1, 2].map((i) => <Barrel key={i} p={[-9.8, 0, -1 + i * 0.75]} lying rot={Math.PI / 2} s={0.9} />)}
          <Barrel p={[8.6, 0, -6]} /><Barrel p={[9.2, 0, -5.3]} /><Crate p={[8.8, 0, -7.4]} />
        </>
      );
    case "sky_hall":
      return (
        <>
          <color attach="background" args={["#c6dcf0"]} /><fog attach="fog" args={["#c6dcf0", 14, 40]} />
          <hemisphereLight args={["#ffffff", "#9ab0c8", 1.1]} />
          <directionalLight position={[4, 10, 6]} intensity={1.3} castShadow />
          <Ground kind="flagstone" color="#e9edf2" rough={0.5} />
          {[-4, 4].map((x) => <LightShaft key={x} p={[x, 6, -9.6]} color="#e6f2ff" tilt={0.8} />)}
          {[-6, -2, 2].map((z) => [-7, 7].map((x) => <Pillar key={`${x}${z}`} p={[x, 0, z]} h={8} color="#f1f3f6" />))}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -6]}><ringGeometry args={[1.2, 1.5, 48]} /><meshStandardMaterial color="#7aa6d6" /></mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, -6]}><circleGeometry args={[1.2, 48]} /><meshStandardMaterial color="#9ec2e8" emissive="#6a96c8" emissiveIntensity={0.4} /></mesh>
          <Banner p={[0, 4.6, -9.6]} house="arryn" />
        </>
      );
    case "garden":
      return (
        <>
          <color attach="background" args={["#a8c8e8"]} /><fog attach="fog" args={["#a8c8e8", 18, 50]} />
          <hemisphereLight args={["#fff6e0", "#4a6a2a", 1]} />
          <directionalLight position={[8, 12, 6]} intensity={1.6} color="#fff1d6" castShadow />
          <Ground kind="grass" color="#6f9a4c" />
          <Bench p={[-4, 0, -5]} rot={Math.PI / 2} /><Bench p={[4, 0, -5]} rot={-Math.PI / 2} />
          <mesh position={[0, 0.3, -5]}><cylinderGeometry args={[2, 2.2, 0.6, 32]} /><meshStandardMaterial color="#d9d2bf" /></mesh>
          <mesh position={[0, 0.62, -5]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[1.8, 32]} /><meshStandardMaterial color="#5aa0c8" metalness={0.3} roughness={0.2} /></mesh>
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            return <mesh key={i} position={[Math.cos(a) * 9, 0.6, Math.sin(a) * 9]} castShadow><boxGeometry args={[2.2, 1.2, 0.8]} /><meshStandardMaterial color="#3d6a2c" /></mesh>;
          })}
          {Array.from({ length: 40 }, (_, i) => (
            <mesh key={i} position={[Math.cos(i) * (6 + (i % 3)), 0.25, Math.sin(i * 1.3) * (6 + (i % 4))]}><sphereGeometry args={[0.12, 8, 6]} /><meshStandardMaterial color={i % 2 ? "#f0c845" : "#c2410c"} /></mesh>
          ))}
          <Banner p={[-3, 3.2, -9]} house={house} /><Banner p={[3, 3.2, -9]} house={house} />
          <Weather kind="dust" count={150} />
        </>
      );
    case "library":
      return (
        <>
          <color attach="background" args={["#100c08"]} /><fog attach="fog" args={["#100c08", 8, 24]} />
          <ambientLight intensity={0.35} />
          <Hall floor="#3a2e22" wall="#4a3e30" house={house} pillars={false} hearth={false} />
          {[-8, -4, 4, 8].map((x) => <mesh key={x} position={[x, 2.5, -9]} castShadow><boxGeometry args={[3, 5, 0.8]} /><meshStandardMaterial color="#3b2a1a" /></mesh>)}
          <Table p={[0, 0, -4]} />
          {[-1, 0, 1].map((x) => <Candle key={x} p={[x, 0.95, -4]} h={0.3} light={x === 0} />)}
          {[-8, -4, 4, 8].map((x, i) => [1, 2.2, 3.4].map((y, j) => (
            <mesh key={`${x}${y}`} position={[x, y, -8.5]}><boxGeometry args={[2.6, 0.5, 0.3]} /><meshStandardMaterial color={BOOKS[(i + j) % BOOKS.length]} /></mesh>
          )))}
          <LightShaft p={[0, 6, -9.4]} color="#ffe6b8" />
          <pointLight position={[0, 2, -4]} intensity={6} color="#ffcf8a" distance={8} />
        </>
      );
    case "essos_plaza":
    case "pyramid_hall":
      return (
        <>
          <color attach="background" args={[id === "pyramid_hall" ? "#2a1a10" : "#d9b98a"]} />
          <fog attach="fog" args={[id === "pyramid_hall" ? "#2a1a10" : "#d9b98a", 16, 48]} />
          <hemisphereLight args={["#fff2d6", "#8a6a3a", 1]} />
          <directionalLight position={[8, 12, 4]} intensity={1.8} color="#ffe2b0" castShadow />
          <Ground kind={id === "pyramid_hall" ? "flagstone" : "cobble"} color="#c9a46a" />
          {id === "essos_plaza" && <><Stall p={[-8, 0, 2]} rot={Math.PI / 2} /><Stall p={[8, 0, 1]} rot={-Math.PI / 2} color="#2a5a8a" /><Stall p={[-8.5, 0, -3]} rot={Math.PI / 2} color="#7a2a7a" /><Crate p={[6.5, 0, 4]} /><Barrel p={[7, 0, 4.8]} /></>}
          {id === "pyramid_hall" && <><Rug p={[0, 0, -2]} w={3} d={12} color="#2a1a40" border="#c9a24a" />{[-6, 6].map((x) => <LightShaft key={x} p={[x, 6, -9]} color="#ffd7a0" />)}</>}
          {[-6, -2, 2].map((z) => [-7, 7].map((x) => <Pillar key={`${x}${z}`} p={[x, 0, z]} h={6} color="#d6b27a" />))}
          {[0, 1, 2, 3].map((k) => (
            <mesh key={k} position={[0, 1 + k * 2, -18]} rotation={[0, Math.PI / 4, 0]}><cylinderGeometry args={[(8 - k * 2) * 0.72, (9 - k * 2) * 0.72, 2, 4]} /><meshStandardMaterial color="#d9c08a" /></mesh>
          ))}
          <Banner p={[-3, 3.4, -8]} house="targaryen" /><Banner p={[3, 3.4, -8]} house="targaryen" />
          <Weather kind="dust" count={250} />
        </>
      );
    case "dothraki_camp":
      return (
        <>
          <color attach="background" args={["#e0a868"]} /><fog attach="fog" args={["#e0a868", 14, 46]} />
          <hemisphereLight args={["#ffd9a0", "#6a7a3a", 0.9]} />
          <directionalLight position={[-10, 6, 4]} intensity={1.5} color="#ffb070" castShadow />
          <Ground kind="grass" color="#a8a85a" />
          <Rocks count={20} radius={[6, 10]} color="#8a7a5a" />
          {[[-5, 4], [5, 5], [-6, -4]].map(([x, z], i) => <mesh key={i} position={[x, 0.8, z]}><cylinderGeometry args={[0.06, 0.08, 1.6, 6]} /><meshStandardMaterial color="#5a3f27" /></mesh>)}
          <GroundMist color="#ffd9a0" opacity={0.12} />
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return <mesh key={i} position={[Math.cos(a) * 11, 1.4, Math.sin(a) * 11]} castShadow><coneGeometry args={[1.8, 2.8, 8]} /><meshStandardMaterial color="#9a7b4f" /></mesh>;
          })}
          <Fire p={[0, 0, -3]} scale={1.4} />
          <Weather kind="embers" count={160} area={6} />
        </>
      );
    case "ruins":
      return (
        <>
          <color attach="background" args={["#1a0c08"]} /><fog attach="fog" args={["#1a0c08", 8, 30]} />
          <ambientLight intensity={0.3} />
          <directionalLight position={[3, 8, -6]} intensity={1.2} color="#ff7a3a" castShadow />
          <Ground kind="dirt" color="#2a2422" />
          <Rocks count={50} radius={[3, 13]} color="#2e2826" />
          <GroundMist color="#5a3a30" opacity={0.25} />
          {[[-6, -6, 5], [6, -4, 3], [-4, 2, 2], [5, 3, 6]].map(([x, z, h]) => <Pillar key={`${x}${z}`} p={[x, 0, z]} h={h} r={0.6} color="#3a3330" />)}
          <Weather kind="embers" count={400} />
        </>
      );
    default: // great_hall
      return (
        <>
          <color attach="background" args={["#120d0a"]} /><fog attach="fog" args={["#120d0a", 10, 30]} />
          <ambientLight intensity={0.35} />
          <directionalLight position={[3, 10, 4]} intensity={0.8} castShadow />
          <Hall floor="#3c3028" wall="#57493c" house={house} />
          <FeastTable p={[-5, 0, -1]} w={6} rot={Math.PI / 2} /><FeastTable p={[5, 0, -1]} w={6} rot={Math.PI / 2} />
          <mesh position={[0, 0.2, -7]} receiveShadow castShadow><boxGeometry args={[8, 0.4, 2.4]} /><meshStandardMaterial color="#3b2a1e" /></mesh>
          <FeastTable p={[0, 0.4, -7]} w={5} />
          <Rug p={[0, 0, 0]} w={2.2} d={9} color="#3a2a4a" border="#a0804a" />
        </>
      );
  }
}
