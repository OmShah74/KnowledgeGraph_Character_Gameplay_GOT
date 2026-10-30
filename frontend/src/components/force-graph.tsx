"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

export type FGNode = { id: string; name: string; group: string; color?: string; size?: number };
export type FGLink = { source: string; target: string; type: string; color?: string };

const PALETTE = ["#e8c26a", "#e05a4f", "#6fb3e0", "#7ad69a", "#c792ea", "#f2a65a", "#9fd3c7", "#ef8fb5", "#b0bec5", "#ffd166"];

export function colorFor(key: string, explicit?: Record<string, string>): string {
  if (explicit?.[key]) return explicit[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function ForceGraph({
  nodes, links, height = 600, onNodeClick, highlight, groupColors, showLinkLabels = false,
}: {
  nodes: FGNode[];
  links: FGLink[];
  height?: number;
  onNodeClick?: (n: FGNode) => void;
  highlight?: string | null;
  groupColors?: Record<string, string>;
  showLinkLabels?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(320, entries[0].contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  // react-force-graph mutates objects; give it fresh copies when the inputs change.
  const data = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    return {
      nodes: nodes.map((n) => ({ ...n })),
      links: links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ ...l })),
    };
  }, [nodes, links]);

  const neighbours = useMemo(() => {
    if (!highlight) return null;
    const s = new Set<string>([highlight]);
    for (const l of links) {
      if (l.source === highlight) s.add(l.target);
      if (l.target === highlight) s.add(l.source);
    }
    return s;
  }, [highlight, links]);

  return (
    <div ref={wrap} className="w-full overflow-hidden rounded-lg border border-border bg-black/30">
      <ForceGraph2D
        width={width}
        height={height}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={4}
        cooldownTicks={120}
        linkColor={(l: object) => (l as FGLink).color || "rgba(232,194,106,0.18)"}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        linkLabel={(l: object) => (l as FGLink).type}
        nodeLabel={(n: object) => `${(n as FGNode).name} · ${(n as FGNode).group}`}
        onNodeClick={(n: object) => onNodeClick?.(n as FGNode)}
        nodeCanvasObject={(node: object, ctx: CanvasRenderingContext2D, scale: number) => {
          const n = node as FGNode & { x: number; y: number };
          const dim = neighbours && !neighbours.has(n.id);
          const r = (n.size ?? 4) + (highlight === n.id ? 3 : 0);
          ctx.globalAlpha = dim ? 0.15 : 1;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = n.color || colorFor(n.group, groupColors);
          ctx.fill();
          if (highlight === n.id) {
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1.5 / scale;
            ctx.stroke();
          }
          if (scale > 1.1 || (n.size ?? 4) >= 7 || highlight === n.id) {
            const fs = Math.max(10 / scale, 2.5);
            ctx.font = `${fs}px Inter, sans-serif`;
            ctx.fillStyle = "rgba(240,230,210,0.92)";
            ctx.textAlign = "center";
            ctx.fillText(n.name, n.x, n.y + r + fs);
          }
          ctx.globalAlpha = 1;
        }}
        linkCanvasObjectMode={() => (showLinkLabels ? "after" : undefined)}
        linkCanvasObject={
          showLinkLabels
            ? (link: object, ctx: CanvasRenderingContext2D, scale: number) => {
                const l = link as { source: { x: number; y: number }; target: { x: number; y: number }; type: string };
                if (scale < 1.6) return;
                const x = (l.source.x + l.target.x) / 2;
                const y = (l.source.y + l.target.y) / 2;
                ctx.font = `${Math.max(8 / scale, 2)}px Inter, sans-serif`;
                ctx.fillStyle = "rgba(232,194,106,0.75)";
                ctx.textAlign = "center";
                ctx.fillText(l.type, x, y);
              }
            : undefined
        }
      />
    </div>
  );
}
