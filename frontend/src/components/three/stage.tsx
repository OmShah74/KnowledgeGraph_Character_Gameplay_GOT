"use client";

import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import type * as THREE from "three";
import { cn } from "@/lib/utils";

/** Slow turntable rotation for showcased artifacts. */
export function Turntable({ speed = 0.4, children }: { speed?: number; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (g.current) g.current.rotation.y += dt * speed;
  });
  return <group ref={g}>{children}</group>;
}

/** Procedural studio environment (no HDR download): warm fire panels, cold ice panels, for metal reflections. */
export function StudioEnvironment({ intensity = 1 }: { intensity?: number }) {
  return (
    <Environment resolution={128} frames={1}>
      <Lightformer form="rect" intensity={2.2 * intensity} color="#ffd9a0" position={[3, 3, 3]} scale={[4, 2, 1]} />
      <Lightformer form="rect" intensity={1.4 * intensity} color="#8fb8ff" position={[-4, 2, -2]} scale={[3, 3, 1]} />
      <Lightformer form="ring" intensity={1.6 * intensity} color="#ff7b3a" position={[0, -2, 3]} scale={2} />
      <Lightformer form="rect" intensity={0.8 * intensity} color="#ffffff" position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[8, 8, 1]} />
    </Environment>
  );
}

/** Shared lighting rig: warm key light (fire), cold rim light (ice). */
export function Lights({ intensity = 1 }: { intensity?: number }) {
  return (
    <>
      <ambientLight intensity={0.35 * intensity} />
      <directionalLight position={[3, 5, 4]} intensity={2.2 * intensity} color="#ffd9a0" castShadow />
      <directionalLight position={[-4, 2, -3]} intensity={1.1 * intensity} color="#8fb8ff" />
      <pointLight position={[0, -1.5, 2]} intensity={6 * intensity} distance={8} color="#ff7b3a" />
      <StudioEnvironment intensity={intensity} />
    </>
  );
}

/** A small self-contained canvas that showcases one artifact. */
export function ArtifactStage({
  children, className, camera = [0, 0.4, 4.2], interactive = false, spin = 0.35,
}: {
  children: React.ReactNode;
  className?: string;
  camera?: [number, number, number];
  interactive?: boolean;
  spin?: number;
}) {
  return (
    <div className={cn("relative", className)}>
      <Canvas dpr={[1, 1.75]} camera={{ position: camera, fov: 40 }} gl={{ antialias: true, alpha: true }}>
        <Suspense fallback={null}>
          <Lights />
          <Turntable speed={spin}>{children}</Turntable>
          {interactive && <OrbitControls enablePan={false} enableZoom={false} />}
        </Suspense>
      </Canvas>
    </div>
  );
}
