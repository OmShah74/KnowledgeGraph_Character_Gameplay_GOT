"use client";

import dynamic from "next/dynamic";
import { Crown } from "lucide-react";

function Placeholder({ label = "Summoning the realm…", height = 300 }: { label?: string; height?: number | string }) {
  return (
    <div style={{ height }} className="flex w-full items-center justify-center rounded-xl border border-border bg-black/30">
      <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <Crown className="size-6 animate-pulse text-primary" />
        {label}
      </div>
    </div>
  );
}

export const WorldMap3D = dynamic(() => import("./world-map"), { ssr: false, loading: () => <Placeholder label="Drawing the map of the Known World…" height={560} /> });
export const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false, loading: () => <Placeholder label="Forging the Iron Throne…" height="100%" /> });
export const CharacterStage = dynamic(() => import("./character-stage"), { ssr: false, loading: () => <Placeholder label="Summoning…" height={420} /> });
export const CourtScene = dynamic(() => import("./character-stage").then((m) => m.CourtScene), { ssr: false, loading: () => <Placeholder label="The court assembles…" height={340} /> });
export const FateCheck = dynamic(() => import("./fate-check").then((m) => m.FateCheck), { ssr: false });
export const ArtifactShowcase = dynamic(() => import("./showcase"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-black/20" /> });
export const StoryStage = dynamic(() => import("../story/story-stage"), { ssr: false, loading: () => <Placeholder label="Setting the scene…" height="100%" /> });
