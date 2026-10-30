"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { DragonEgg, IronThrone } from "./artifacts";
import { StudioEnvironment } from "./stage";

function Embers({ count = 260, cold = false }: { count?: number; cold?: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const data = useMemo(() => {
    const p = new Float32Array(count * 3);
    const s = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 9;
      p[i * 3 + 1] = Math.random() * 5;
      p[i * 3 + 2] = (Math.random() - 0.5) * 6;
      s[i] = 0.2 + Math.random() * 0.6;
    }
    return { p, s };
  }, [count]);
  useFrame((_, dt) => {
    const pts = ref.current;
    if (!pts) return;
    const a = pts.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      a[i * 3 + 1] += (cold ? -1 : 1) * data.s[i] * dt;
      a[i * 3] += Math.sin(a[i * 3 + 1] * 1.7 + i) * dt * 0.15;
      if (!cold && a[i * 3 + 1] > 5) a[i * 3 + 1] = -0.5;
      if (cold && a[i * 3 + 1] < -0.5) a[i * 3 + 1] = 5;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.p, 3]} />
      </bufferGeometry>
      <pointsMaterial size={cold ? 0.05 : 0.045} color={cold ? "#dff1ff" : "#ff8a3d"} transparent opacity={0.85}
        blending={cold ? THREE.NormalBlending : THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}

function OrbitingEggs() {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (g.current) g.current.rotation.y += dt * 0.25;
  });
  const eggs: ["drogon" | "rhaegal" | "viserion", number][] = [["drogon", 0], ["rhaegal", (2 * Math.PI) / 3], ["viserion", (4 * Math.PI) / 3]];
  return (
    <group ref={g} position={[0, 0.9, 0]}>
      {eggs.map(([v, a]) => (
        <group key={v} position={[Math.cos(a) * 2.3, Math.sin(a * 2) * 0.2, Math.sin(a) * 2.3]} rotation={[0.2, a, 0.15]}>
          <DragonEgg variant={v} scale={0.28} />
        </group>
      ))}
    </group>
  );
}

export default function HeroScene({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 2.2, 6.2], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        <Suspense fallback={null}>
          <fog attach="fog" args={["#0b0d10", 6, 16]} />
          <ambientLight intensity={0.45} />
          <StudioEnvironment intensity={1.2} />
          <spotLight position={[3, 7, 4]} angle={0.55} penumbra={0.6} intensity={110} color="#ffd9a0" castShadow />
          <pointLight position={[-3, 1.5, -2]} intensity={10} color="#6fa8ff" distance={10} />
          <pointLight position={[2.5, 0.5, 2]} intensity={10} color="#ff5a1f" distance={8} />
          <IronThrone position={[0, 0, 0]} scale={1.15} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <circleGeometry args={[3.2, 64]} />
            <meshStandardMaterial color="#1a1714" roughness={0.9} />
          </mesh>
          <OrbitingEggs />
          <group position={[2.5, 0, 0]}><Embers count={180} /></group>
          <group position={[-2.5, 0, 0]}><Embers count={180} cold /></group>
        </Suspense>
        <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.6} maxPolarAngle={1.45} minPolarAngle={0.9} target={[0, 1, 0]} />
      </Canvas>
    </div>
  );
}
