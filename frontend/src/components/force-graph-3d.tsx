"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { colorFor, type FGLink, type FGNode } from "./force-graph";

const ForceGraph3DLib = dynamic(() => import("react-force-graph-3d"), { ssr: false });

/** 3D force-directed knowledge graph (three.js) with animated relation particles. */
export function ForceGraph3D({ nodes, links, height = 620, onNodeClick, groupColors }: {
  nodes: FGNode[];
  links: FGLink[];
  height?: number;
  onNodeClick?: (n: FGNode) => void;
  groupColors?: Record<string, string>;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((e) => setWidth(Math.max(320, e[0].contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const data = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes: nodes.map((n) => ({ ...n })), links: links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ ...l })) };
  }, [nodes, links]);
  return (
    <div ref={wrap} className="w-full overflow-hidden rounded-lg border border-border bg-black">
      <ForceGraph3DLib
        width={width}
        height={height}
        graphData={data}
        backgroundColor="#07080a"
        nodeLabel={(n: object) => `${(n as FGNode).name} · ${(n as FGNode).group}`}
        nodeColor={(n: object) => (n as FGNode).color || colorFor((n as FGNode).group, groupColors)}
        nodeVal={(n: object) => ((n as FGNode).size ?? 4) * 0.8}
        nodeOpacity={0.95}
        linkColor={(l: object) => (l as FGLink).color || "rgba(232,194,106,0.35)"}
        linkOpacity={0.45}
        linkWidth={0.6}
        linkLabel={(l: object) => (l as FGLink).type}
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={1.2}
        linkDirectionalParticleSpeed={0.004}
        onNodeClick={(n: object) => onNodeClick?.(n as FGNode)}
        cooldownTicks={140}
      />
    </div>
  );
}
