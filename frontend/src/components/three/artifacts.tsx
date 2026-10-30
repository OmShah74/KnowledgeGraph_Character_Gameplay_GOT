"use client";

/**
 * Procedurally modelled Game of Thrones artifacts (no external model files):
 *   SevenPointedStar  — the Faith of the Seven (fate of social checks)
 *   IronCoin          — iron coin of Braavos, "Valar Morghulis" (deception / insight)
 *   ValyrianBlade     — rippled Valyrian steel longsword (duels / intimidation)
 *   DragonEgg         — scaled egg with a heartbeat glow (Drogon / Rhaegal / Viserion palettes)
 *   IronThrone        — instanced swords fused into the throne
 *   Weirwood          — heart tree with a carved weeping face and red leaves
 *   Raven             — a messenger raven with flapping wings
 * Geometries and materials are memoised; textures are generated once per mount.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { barkTexture, ironCoinTexture, scaleTexture, valyrianTexture } from "./textures";

type GroupProps = { position?: [number, number, number]; rotation?: [number, number, number]; scale?: number };

function useDispose(...objs: { dispose: () => void }[]) {
  useEffect(() => () => objs.forEach((o) => o.dispose()), [objs]);
}

// ------------------------------------------------------------------ Seven-Pointed Star
export function SevenPointedStar({ color = "#d9b25f", glow = 0.15, ...props }: GroupProps & { color?: string; glow?: number }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const pts = 7;
    for (let i = 0; i <= pts * 2; i++) {
      const r = i % 2 === 0 ? 1 : 0.46;
      const a = (i / (pts * 2)) * Math.PI * 2 + Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.16, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3 });
    g.center();
    return g;
  }, []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color, metalness: 0.95, roughness: 0.28, emissive: new THREE.Color(color), emissiveIntensity: glow }),
    [color, glow],
  );
  useDispose(geometry, material);
  return (
    <group {...props}>
      <mesh geometry={geometry} material={material} castShadow />
      <mesh position={[0, 0, 0]}>
        <torusGeometry args={[0.16, 0.035, 12, 48]} />
        <meshStandardMaterial color="#f3e2b1" metalness={1} roughness={0.2} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ Iron Coin of Braavos
export function IronCoin(props: GroupProps) {
  const tex = useMemo(() => ironCoinTexture(), []);
  const materials = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: "#4a4741", metalness: 0.85, roughness: 0.55 });
    const face = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.7, roughness: 0.5, bumpMap: tex, bumpScale: 2 });
    return [side, face, face];
  }, [tex]);
  useDispose(tex, ...materials);
  return (
    <group {...props}>
      <mesh material={materials} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[1, 1, 0.12, 72]} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ Valyrian steel blade
export function ValyrianBlade({ pommelColor = "#c8a24a", ...props }: GroupProps & { pommelColor?: string }) {
  const tex = useMemo(() => valyrianTexture(), []);
  const bladeGeo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-0.09, 0);
    s.lineTo(0.09, 0);
    s.lineTo(0.075, 2.1);
    s.lineTo(0, 2.45);
    s.lineTo(-0.075, 2.1);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.018, bevelSegments: 2 });
    g.translate(0, 0, -0.01);
    // map UVs along the blade so the ripples run lengthwise
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + 0.1) * 2.5;
      uv[i * 2 + 1] = pos.getY(i) / 2.45;
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return g;
  }, []);
  const bladeMat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex, metalness: 1, roughness: 0.22, envMapIntensity: 1.2 }), [tex]);
  useDispose(tex, bladeGeo, bladeMat);
  return (
    <group {...props}>
      <mesh geometry={bladeGeo} material={bladeMat} castShadow />
      <mesh position={[0, -0.03, 0]}>
        <boxGeometry args={[0.62, 0.07, 0.09]} />
        <meshStandardMaterial color="#3a3227" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[0, -0.32, 0]}>
        <cylinderGeometry args={[0.045, 0.05, 0.52, 16]} />
        <meshStandardMaterial color="#3b2416" roughness={0.9} />
      </mesh>
      <mesh position={[0, -0.62, 0]}>
        <sphereGeometry args={[0.085, 20, 16]} />
        <meshStandardMaterial color={pommelColor} metalness={0.95} roughness={0.25} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ Dragon egg
const EGG_PALETTES = {
  drogon: { base: "#1a1212", edge: "#050303", glow: "#7a1d12", emissive: "#ff3b1f" },
  rhaegal: { base: "#20321f", edge: "#0b140b", glow: "#7a6b2a", emissive: "#9cff5a" },
  viserion: { base: "#d9cba4", edge: "#8d7a4d", glow: "#fff2c4", emissive: "#ffd36b" },
} as const;

export function DragonEgg({ variant = "drogon", pulse = true, ...props }: GroupProps & { variant?: keyof typeof EGG_PALETTES; pulse?: boolean }) {
  const pal = EGG_PALETTES[variant];
  const tex = useMemo(() => scaleTexture(pal.base, pal.edge, pal.glow), [pal]);
  const geometry = useMemo(() => {
    const g = new THREE.SphereGeometry(1, 72, 56);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const taper = v.y > 0 ? 1 - v.y * 0.22 : 1 + v.y * 0.05; // egg profile
      const ridge = 1 + Math.sin(v.y * 22 + Math.atan2(v.z, v.x) * 9) * 0.012;
      p.setXYZ(i, v.x * taper * ridge, v.y * 1.32, v.z * taper * ridge);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 3, metalness: 0.55, roughness: 0.38,
      emissive: new THREE.Color(pal.emissive), emissiveIntensity: 0.08 }),
    [tex, pal],
  );
  useDispose(tex, geometry, material);
  useFrame(({ clock }) => {
    if (!pulse) return;
    const t = clock.getElapsedTime();
    const beat = Math.max(0, Math.sin(t * 2.4)) ** 6 + Math.max(0, Math.sin(t * 2.4 - 0.5)) ** 8 * 0.6;
    material.emissiveIntensity = 0.06 + beat * 0.35;
  });
  return (
    <group {...props}>
      <mesh geometry={geometry} material={material} castShadow />
    </group>
  );
}

// ------------------------------------------------------------------ Iron Throne (instanced swords)
function swordGeometry(): THREE.BufferGeometry {
  const blade = new THREE.BoxGeometry(0.06, 1.1, 0.012);
  blade.translate(0, 0.55, 0);
  const guard = new THREE.BoxGeometry(0.26, 0.035, 0.04);
  const grip = new THREE.CylinderGeometry(0.018, 0.018, 0.2, 6);
  grip.translate(0, -0.1, 0);
  const pommel = new THREE.SphereGeometry(0.032, 8, 6);
  pommel.translate(0, -0.22, 0);
  const parts = [blade, guard, grip, pommel];
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  new Set([...parts, ...flat]).forEach((g) => g.dispose());
  return merged;
}

export function IronThrone({ swords = 170, ...props }: GroupProps & { swords?: number }) {
  const geometry = useMemo(() => swordGeometry(), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8a8d95", metalness: 0.9, roughness: 0.32 }), []);
  const ref = useRef<THREE.InstancedMesh>(null);
  useDispose(geometry, material);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Object3D();
    let i = 0;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const put = (x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1) => {
      if (i >= swords) return;
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.scale.setScalar(s);
      m.updateMatrix();
      mesh.setMatrixAt(i++, m.matrix);
    };
    // steps
    for (let s = 0; s < 3; s++) for (let k = 0; k < 9; k++) put(-0.9 + k * 0.22, 0.05 + s * 0.12, 0.9 - s * 0.25, Math.PI / 2, 0, rand(-0.15, 0.15), 1.2);
    // seat block
    for (let k = 0; k < 16; k++) put(rand(-0.65, 0.65), 0.55 + rand(-0.05, 0.05), rand(-0.3, 0.3), Math.PI / 2 + rand(-0.2, 0.2), rand(-0.4, 0.4), rand(-0.2, 0.2));
    // armrests
    for (const side of [-1, 1]) for (let k = 0; k < 10; k++) put(side * 0.72, 0.6 + rand(0, 0.5), rand(-0.35, 0.35), rand(-0.3, 0.3), 0, side * rand(0.05, 0.4));
    // the great fan of blades behind the seat
    for (let k = 0; i < swords; k++) {
      const a = rand(-1.15, 1.15);
      const r = rand(0.1, 0.5);
      put(Math.sin(a) * r, 0.7 + rand(0, 0.4), -0.45 + rand(-0.15, 0.1), rand(-0.12, 0.08), rand(-0.3, 0.3), -a * rand(0.7, 1.1), rand(1, 1.9));
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }, [swords]);
  return (
    <group {...props}>
      <instancedMesh ref={ref} args={[geometry, material, swords]} castShadow receiveShadow />
    </group>
  );
}

// ------------------------------------------------------------------ Weirwood heart tree
export function Weirwood({ leaves = 420, ...props }: GroupProps & { leaves?: number }) {
  const bark = useMemo(() => barkTexture(), []);
  const barkMat = useMemo(() => new THREE.MeshStandardMaterial({ map: bark, color: "#f2eee4", roughness: 0.85 }), [bark]);
  const branches = useMemo(() => {
    const trunk = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -1, 0), new THREE.Vector3(0.08, 0, 0.02), new THREE.Vector3(-0.05, 0.9, 0), new THREE.Vector3(0.02, 1.4, 0)]);
    const curves = [trunk];
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    for (let k = 0; k < 7; k++) {
      const start = trunk.getPoint(rand(0.55, 0.95));
      const dir = new THREE.Vector3(Math.cos(k * 0.9) * rand(0.6, 1.1), rand(0.3, 0.8), Math.sin(k * 0.9) * rand(0.6, 1.1));
      curves.push(new THREE.CatmullRomCurve3([start, start.clone().add(dir.clone().multiplyScalar(0.5)), start.clone().add(dir)]));
    }
    return curves.map((c, idx) => new THREE.TubeGeometry(c, 24, idx === 0 ? 0.2 : 0.06, 10, false));
  }, []);
  const leafRef = useRef<THREE.InstancedMesh>(null);
  const leafGeo = useMemo(() => new THREE.PlaneGeometry(0.11, 0.11), []);
  const leafMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#b3121b", emissive: "#4a0306", side: THREE.DoubleSide, roughness: 0.7 }), []);
  useDispose(bark, barkMat, leafGeo, leafMat, ...branches);
  useEffect(() => {
    const mesh = leafRef.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < leaves; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 1.0;
      o.position.set(Math.cos(a) * r, 1.15 + Math.random() * 0.75 - r * 0.15, Math.sin(a) * r);
      o.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [leaves]);
  const crown = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (crown.current) crown.current.rotation.z = Math.sin(clock.getElapsedTime() * 0.6) * 0.03;
  });
  return (
    <group {...props}>
      <group ref={crown}>
        {branches.map((g, i) => <mesh key={i} geometry={g} material={barkMat} castShadow />)}
        <instancedMesh ref={leafRef} args={[leafGeo, leafMat, leaves]} />
      </group>
      {/* the carved face, weeping red sap */}
      {[-0.07, 0.07].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.15, 0.2]}>
            <sphereGeometry args={[0.035, 12, 10]} />
            <meshStandardMaterial color="#5a0408" emissive="#3a0205" />
          </mesh>
          <mesh position={[x, 0.02, 0.205]}>
            <cylinderGeometry args={[0.008, 0.012, 0.22, 6]} />
            <meshStandardMaterial color="#8a0a12" emissive="#3a0205" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, -0.08, 0.2]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.06, 0.012, 6, 16, Math.PI]} />
        <meshStandardMaterial color="#5a0408" />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ Raven
export function Raven({ flap = true, ...props }: GroupProps & { flap?: boolean }) {
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  const wing = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.9, 0.12);
    s.lineTo(0.75, -0.08);
    s.lineTo(0.5, -0.12);
    s.lineTo(0.2, -0.1);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  }, []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#121318", roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }), []);
  useDispose(wing, mat);
  useFrame(({ clock }) => {
    if (!flap) return;
    const a = Math.sin(clock.getElapsedTime() * 7) * 0.7;
    if (left.current) left.current.rotation.x = a;
    if (right.current) right.current.rotation.x = -a;
  });
  return (
    <group {...props}>
      <mesh material={mat} scale={[0.32, 0.22, 0.6]}>
        <sphereGeometry args={[1, 18, 14]} />
      </mesh>
      <mesh material={mat} position={[0, 0.12, 0.55]}>
        <sphereGeometry args={[0.16, 16, 12]} />
      </mesh>
      <mesh position={[0, 0.1, 0.76]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.05, 0.2, 8]} />
        <meshStandardMaterial color="#2b2a28" />
      </mesh>
      <mesh position={[0.05, 0.17, 0.66]}>
        <sphereGeometry args={[0.022, 8, 6]} />
        <meshStandardMaterial color="#d4a017" emissive="#5a4000" />
      </mesh>
      <mesh position={[-0.05, 0.17, 0.66]}>
        <sphereGeometry args={[0.022, 8, 6]} />
        <meshStandardMaterial color="#d4a017" emissive="#5a4000" />
      </mesh>
      <mesh ref={left} geometry={wing} material={mat} position={[0.15, 0.05, 0.05]} rotation={[0, 0, 0]} />
      <mesh ref={right} geometry={wing} material={mat} position={[-0.15, 0.05, 0.05]} scale={[-1, 1, 1]} />
      <mesh material={mat} position={[0, 0, -0.65]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.18, 0.4, 4]} />
      </mesh>
    </group>
  );
}
