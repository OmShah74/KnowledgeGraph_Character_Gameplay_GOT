"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import { appearanceAt } from "@/lib/appearance";
import { CharacterFigure, type Reaction } from "./character-figure";
import { StudioEnvironment } from "./stage";

type FigureInput = { id: string; name: string; house?: string | null; gender?: string; culture?: string; tier?: string; stats?: Record<string, number>; titles?: string[] };

function Floor({ color = "#2a231c" }: { color?: string }) {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[6, 64]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      <ContactShadows position={[0, 0.005, 0]} opacity={0.55} scale={8} blur={2.4} far={3} />
    </>
  );
}

function StageLights() {
  return (
    <>
      <ambientLight intensity={0.45} />
      <spotLight position={[2.5, 5, 3.5]} angle={0.55} penumbra={0.7} intensity={45} color="#ffe2b8" castShadow />
      <pointLight position={[-3, 2, -2]} intensity={8} color="#7fa8ff" distance={10} />
      <pointLight position={[0, 1.2, 2.5]} intensity={4} color="#ffb070" distance={6} />
      <StudioEnvironment intensity={0.8} />
    </>
  );
}

/** One character, full height, orbitable. */
export default function CharacterStage({
  character, ord, mood, talking = false, ghost = false, reaction = null, onTouch, height = 420,
}: {
  character: FigureInput;
  ord: number;
  mood?: string | null;
  talking?: boolean;
  ghost?: boolean;
  reaction?: Reaction;
  onTouch?: () => void;
  height?: number;
}) {
  const appearance = useMemo(() => appearanceAt(character, ord), [character, ord]);
  return (
    <div style={{ height }} className="relative isolate w-full overflow-hidden">
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 1.3, 3.2], fov: 38 }} gl={{ antialias: true, alpha: true }}>
        <Suspense fallback={null}>
          <StageLights />
          <CharacterFigure appearance={appearance} mood={mood} talking={talking} ghost={ghost} reaction={reaction} onClick={onTouch} name={character.name} />
          <Floor />
        </Suspense>
        <OrbitControls target={[0, 1.0, 0]} enablePan={false} minDistance={1.6} maxDistance={5.5} maxPolarAngle={1.6} />
      </Canvas>
    </div>
  );
}

/** Everyone present at a place, arranged in a semicircle; click someone to approach them. */
export function CourtScene({
  people, ord, onSelect, selected, talkingId, height = 340,
}: {
  people: (FigureInput & { mood?: string | null; disposition?: string })[];
  ord: number;
  onSelect?: (id: string) => void;
  selected?: string[];
  talkingId?: string | null;
  height?: number;
}) {
  const key = people.slice(0, 9).map((p) => `${p.id}:${p.mood ?? ""}`).join("|");
  const placed = useMemo(() => {
    const shown = people.slice(0, 9);
    return shown.map((p, i) => {
      const n = shown.length;
      const spread = Math.min(Math.PI * 0.9, 0.42 * (n - 1));
      const a = n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1);
      const r = 3.2;
      return { p, pos: [Math.sin(a) * r, 0, -Math.cos(a) * r + r - 0.5] as [number, number, number], rot: -a, appearance: appearanceAt(p, ord) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ord]);
  return (
    <div style={{ height }} className="relative isolate w-full overflow-hidden">
      <Canvas shadows dpr={[1, 1.6]} camera={{ position: [0, 1.9, 5.4], fov: 42 }} gl={{ antialias: true, alpha: true }}>
        <Suspense fallback={null}>
          <StageLights />
          {placed.map(({ p, pos, rot, appearance }) => (
            <CharacterFigure
              key={p.id}
              appearance={appearance}
              mood={p.mood}
              position={pos}
              rotationY={rot}
              talking={talkingId === p.id}
              highlight={selected?.includes(p.id)}
              onClick={onSelect ? () => onSelect(p.id) : undefined}
              name={p.name}
              showName
            />
          ))}
          <Floor color="#231d18" />
        </Suspense>
        <OrbitControls target={[0, 1, 0.5]} enablePan={false} enableZoom={false} maxPolarAngle={1.45} minPolarAngle={0.9} minAzimuthAngle={-0.6} maxAzimuthAngle={0.6} />
      </Canvas>
    </div>
  );
}
