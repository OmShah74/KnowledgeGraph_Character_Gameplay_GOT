"use client";

/**
 * Landmark models for the 3D map. Built from primitives at map scale (~1 world unit).
 * Each gameplay location id maps to a distinctive monument; everything else uses a castle
 * or town builder parameterised by stone colour and roofs.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

type V3 = [number, number, number];

function Tower({ p, r = 0.07, h = 0.5, color = "#77736b", roof = "#4b3b33" }: { p: V3; r?: number; h?: number; color?: string; roof?: string | null }) {
  return (
    <group position={p}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r * 1.1, h, 10]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {roof && (
        <mesh position={[0, h + r * 1.2, 0]} castShadow>
          <coneGeometry args={[r * 1.35, r * 2.6, 10]} />
          <meshStandardMaterial color={roof} roughness={0.7} />
        </mesh>
      )}
    </group>
  );
}

export function Castle({ color = "#7d786e", roof = "#5a3b2e", size = 0.45, towers = 4, keepH = 0.55 }: { color?: string; roof?: string | null; size?: number; towers?: number; keepH?: number }) {
  const s = size;
  const corners: V3[] = [[-s, 0, -s], [s, 0, -s], [s, 0, s], [-s, 0, s]];
  return (
    <group>
      {[[0, -s, 2 * s, 0.05], [0, s, 2 * s, 0.05], [-s, 0, 0.05, 2 * s], [s, 0, 0.05, 2 * s]].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.11, z]} castShadow>
          <boxGeometry args={[w + 0.04, 0.22, d + 0.04]} />
          <meshStandardMaterial color={color} roughness={0.95} />
        </mesh>
      ))}
      {corners.slice(0, towers).map((p, i) => <Tower key={i} p={p} h={0.36} color={color} roof={roof} />)}
      <mesh position={[0, keepH / 2, 0]} castShadow>
        <boxGeometry args={[s * 0.8, keepH, s * 0.8]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {roof && (
        <mesh position={[0, keepH + 0.1, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[s * 0.62, 0.22, 4]} />
          <meshStandardMaterial color={roof} />
        </mesh>
      )}
    </group>
  );
}

export function Town({ count = 7, roof = "#8a4b32" }: { count?: number; roof?: string }) {
  const houses = useMemo(
    () => Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + i;
      const r = 0.12 + (i % 3) * 0.1;
      return [Math.cos(a) * r, 0, Math.sin(a) * r, a] as [number, number, number, number];
    }),
    [count],
  );
  return (
    <group>
      {houses.map(([x, y, z, a], i) => (
        <group key={i} position={[x, y, z]} rotation={[0, a, 0]}>
          <mesh position={[0, 0.05, 0]}>
            <boxGeometry args={[0.1, 0.1, 0.08]} />
            <meshStandardMaterial color="#c9b79a" />
          </mesh>
          <mesh position={[0, 0.13, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[0.08, 0.07, 4]} />
            <meshStandardMaterial color={roof} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Pyramid({ color, scale = 1 }: { color: string; scale?: number }) {
  return (
    <group scale={scale}>
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} position={[0, 0.09 + k * 0.17, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <cylinderGeometry args={[(0.42 - k * 0.1) * 0.72, (0.5 - k * 0.1) * 0.72, 0.18, 4]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function Hightower() {
  const beacon = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (beacon.current) beacon.current.intensity = 2.5 + Math.sin(clock.getElapsedTime() * 2) * 1.5;
  });
  return (
    <group>
      <Town count={9} roof="#7a4b3b" />
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} position={[0.35, 0.25 + k * 0.42, 0]} castShadow>
          <cylinderGeometry args={[0.12 - k * 0.02, 0.14 - k * 0.02, 0.42, 10]} />
          <meshStandardMaterial color="#d8d2c4" />
        </mesh>
      ))}
      <mesh position={[0.35, 1.95, 0]}>
        <sphereGeometry args={[0.06, 12, 10]} />
        <meshStandardMaterial color="#ffd27a" emissive="#ffb347" emissiveIntensity={3} />
      </mesh>
      <pointLight ref={beacon} position={[0.35, 2, 0]} color="#ffb347" distance={6} />
    </group>
  );
}

function Wall({ length }: { length: number }) {
  return (
    <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
      <boxGeometry args={[length, 1.6, 0.28]} />
      <meshStandardMaterial color="#cfe6ff" emissive="#4d7fb8" emissiveIntensity={0.25} roughness={0.25} metalness={0.05} transparent opacity={0.93} />
    </mesh>
  );
}

export function TheWall({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
  const len = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const mid: V3 = [(from[0] + to[0]) / 2, Math.max(from[1], to[1]), (from[2] + to[2]) / 2];
  const angle = -Math.atan2(to[2] - from[2], to[0] - from[0]);
  return (
    <group position={mid} rotation={[0, angle, 0]}>
      <Wall length={len} />
    </group>
  );
}

function TitanOfBraavos() {
  return (
    <group position={[0.4, 0, 0.35]} scale={1.2}>
      {[-0.12, 0.12].map((x) => (
        <mesh key={x} position={[x, 0.3, 0]}>
          <boxGeometry args={[0.08, 0.6, 0.08]} />
          <meshStandardMaterial color="#5f6b5f" metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[0.32, 0.4, 0.14]} />
        <meshStandardMaterial color="#5f6b5f" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.06, 0]}>
        <sphereGeometry args={[0.09, 12, 10]} />
        <meshStandardMaterial color="#5f6b5f" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[0.22, 0.95, 0]} rotation={[0, 0, -0.6]}>
        <boxGeometry args={[0.05, 0.42, 0.05]} />
        <meshStandardMaterial color="#5f6b5f" />
      </mesh>
      <mesh position={[0, 1.13, 0.05]}>
        <sphereGeometry args={[0.025, 8, 6]} />
        <meshStandardMaterial color="#ff8a3d" emissive="#ff6a00" emissiveIntensity={2.5} />
      </mesh>
    </group>
  );
}

function Volcano({ smoke = true }: { smoke?: boolean }) {
  const puffs = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = puffs.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      c.position.y += dt * (0.25 + i * 0.03);
      c.scale.multiplyScalar(1 + dt * 0.25);
      if (c.position.y > 2.2) {
        c.position.y = 0.6;
        c.scale.setScalar(0.08);
      }
    });
  });
  return (
    <group>
      <mesh position={[0, 0.35, 0]} castShadow>
        <coneGeometry args={[0.45, 0.7, 14, 1, true]} />
        <meshStandardMaterial color="#2a2422" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.66, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.1, 16]} />
        <meshStandardMaterial color="#ff5a1f" emissive="#ff3300" emissiveIntensity={3} />
      </mesh>
      {smoke && (
        <group ref={puffs}>
          {Array.from({ length: 6 }, (_, i) => (
            <mesh key={i} position={[Math.sin(i) * 0.05, 0.6 + i * 0.27, 0]} scale={0.08 + i * 0.04}>
              <sphereGeometry args={[1, 10, 8]} />
              <meshStandardMaterial color="#3a3533" transparent opacity={0.35} depthWrite={false} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

function Domes({ color = "#d8b45a", count = 3 }: { color?: string; count?: number }) {
  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <group key={i} position={[(i - (count - 1) / 2) * 0.24, 0, (i % 2) * 0.15]}>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.24, 12]} />
            <meshStandardMaterial color="#e6d6b4" />
          </mesh>
          <mesh position={[0, 0.25, 0]}>
            <sphereGeometry args={[0.09, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={color} metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Tents({ color = "#a3906b", count = 6 }: { color?: string; count?: number }) {
  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} position={[Math.cos(i * 1.7) * 0.3, 0.07, Math.sin(i * 1.7) * 0.3]}>
          <coneGeometry args={[0.09, 0.15, 6]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

function BlackWalls() {
  return (
    <group>
      <mesh position={[0, 0.12, 0]}>
        <torusGeometry args={[0.38, 0.06, 8, 32]} />
        <meshStandardMaterial color="#141414" roughness={0.4} metalness={0.3} />
      </mesh>
      <Town count={10} roof="#7d3a2a" />
    </group>
  );
}

function HorseGate() {
  return (
    <group>
      {[-0.18, 0.18].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]} rotation={[0, 0, x > 0 ? -0.35 : 0.35]}>
          <boxGeometry args={[0.07, 0.48, 0.07]} />
          <meshStandardMaterial color="#6b4f35" />
        </mesh>
      ))}
      <Tents color="#b39a6e" count={8} />
    </group>
  );
}

/** The landmark shown at each gameplay location. */
export function Monument({ id }: { id: string }) {
  switch (id) {
    case "kings_landing":
      return (
        <group>
          <Town count={14} roof="#a3462d" />
          <group position={[0.15, 0, -0.1]}><Castle color="#a2412e" roof="#6b2a1f" size={0.32} keepH={0.6} /></group>
          <Tower p={[-0.35, 0, 0.25]} r={0.1} h={0.7} color="#e8e1d1" roof={null} />
        </group>
      );
    case "winterfell": return <Castle color="#8b8e93" roof="#42464d" size={0.42} keepH={0.6} />;
    case "the_dreadfort": return <Castle color="#4a3a3d" roof="#7a2b3d" size={0.32} />;
    case "castle_black": return <group position={[0, 0, 0.35]}><Castle color="#3d3b3a" roof={null} size={0.25} towers={2} keepH={0.5} /></group>;
    case "eastwatch": return <group position={[0, 0, 0.3]}><Castle color="#3d3b3a" roof={null} size={0.2} towers={2} /></group>;
    case "the_eyrie":
      return (
        <group>
          <mesh position={[0, 0.6, 0]} castShadow><coneGeometry args={[0.35, 1.3, 8]} /><meshStandardMaterial color="#7a7672" roughness={1} /></mesh>
          <Tower p={[0, 1.15, 0]} r={0.06} h={0.3} color="#f4f1ea" roof="#7aa6d6" />
          <Tower p={[0.1, 1.08, 0.05]} r={0.05} h={0.25} color="#f4f1ea" roof="#7aa6d6" />
        </group>
      );
    case "harrenhal":
      return (
        <group>
          {[0, 1, 2, 3, 4].map((k) => {
            const a = (k / 5) * Math.PI * 2;
            return <Tower key={k} p={[Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35]} r={0.1} h={0.65 - (k % 2) * 0.12} color="#2e2a27" roof={null} />;
          })}
        </group>
      );
    case "the_twins":
      return (
        <group>
          <Tower p={[-0.3, 0, 0]} r={0.1} h={0.55} color="#6d7078" />
          <Tower p={[0.3, 0, 0]} r={0.1} h={0.55} color="#6d7078" />
          <mesh position={[0, 0.25, 0]}><boxGeometry args={[0.6, 0.07, 0.12]} /><meshStandardMaterial color="#6d7078" /></mesh>
        </group>
      );
    case "riverrun": return <Castle color="#8a8f9a" roof="#355d9b" size={0.32} />;
    case "crossroads_inn": return <Town count={4} roof="#6b4a2f" />;
    case "casterly_rock":
      return (
        <group>
          <mesh position={[0, 0.35, 0]} castShadow scale={[1.1, 0.75, 0.9]}><dodecahedronGeometry args={[0.55, 1]} /><meshStandardMaterial color="#8b6f4e" roughness={0.9} /></mesh>
          <Tower p={[0.15, 0.62, 0.1]} r={0.05} h={0.25} color="#c8a24a" roof="#9b1c1c" />
        </group>
      );
    case "pyke":
      return (
        <group>
          {[[-0.2, 0], [0.15, 0.15], [0.2, -0.2]].map(([x, z], i) => (
            <group key={i} position={[x, 0, z]}>
              <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.08, 0.12, 0.6, 7]} /><meshStandardMaterial color="#3d3f44" /></mesh>
              <Tower p={[0, 0.6, 0]} r={0.05} h={0.22} color="#2e3035" roof="#1c1d20" />
            </group>
          ))}
        </group>
      );
    case "dragonstone":
      return (
        <group>
          <Castle color="#1f1f22" roof="#0f0f10" size={0.3} keepH={0.6} />
          <group position={[0.45, 0, -0.3]} scale={0.6}><Volcano /></group>
        </group>
      );
    case "storms_end":
      return <Tower p={[0, 0, 0]} r={0.22} h={0.75} color="#6f6d68" roof={null} />;
    case "highgarden": return <Castle color="#d9d2bf" roof="#4f8a3a" size={0.4} keepH={0.5} />;
    case "horn_hill": return <Castle color="#6f7a63" roof="#2f5f2f" size={0.28} />;
    case "oldtown": return <Hightower />;
    case "sunspear": return <Domes color="#e0a43a" count={4} />;
    case "water_gardens": return <Domes color="#f2d38a" count={2} />;
    case "last_hearth": return <Castle color="#6e6a63" roof="#3b3a37" size={0.3} />;
    case "braavos": return <group><Town count={12} roof="#4f6b78" /><TitanOfBraavos /></group>;
    case "pentos": return <Domes color="#c99a3a" count={3} />;
    case "volantis": return <BlackWalls />;
    case "vaes_dothrak": return <HorseGate />;
    case "dothraki_sea_plains": return <Tents color="#9a7b4f" count={10} />;
    case "meereen": return <Pyramid color="#d9c08a" scale={1.15} />;
    case "yunkai": return <Pyramid color="#d8b34a" scale={0.9} />;
    case "astapor": return <Pyramid color="#a54a32" scale={0.9} />;
    case "qarth": return <group><Domes color="#7fd1c4" count={3} /><mesh position={[0, 0.1, 0]}><torusGeometry args={[0.45, 0.04, 6, 32]} /><meshStandardMaterial color="#c9b48a" /></mesh></group>;
    case "valyria": return <group><Volcano /><group position={[0.6, 0, 0.2]} scale={0.7}><Volcano /></group></group>;
    case "hardhome": return <Tents color="#4b4038" count={7} />;
    case "beyond_wall": return <Tents color="#5c5146" count={5} />;
    case "three_eyed_raven_cave":
      return (
        <group>
          <mesh position={[0, 0.15, 0]}><sphereGeometry args={[0.35, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#d6dde3" /></mesh>
          <mesh position={[0, 0.5, 0]}><sphereGeometry args={[0.22, 10, 8]} /><meshStandardMaterial color="#b3121b" emissive="#3a0205" /></mesh>
        </group>
      );
    default:
      return <Castle size={0.28} />;
  }
}
