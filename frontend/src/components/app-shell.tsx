"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import {
  BookOpen, Brain, Castle, Crown, Database, Globe, Menu, Network, Settings, Shapes, Swords, Users, X,
} from "lucide-react";
import { fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import type { Player } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const NAV = [
  { href: "/", label: "Realm", icon: Crown },
  { href: "/play", label: "Play", icon: Swords },
  { href: "/world", label: "Chronicle", icon: Globe },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/graph", label: "Knowledge Graph", icon: Network },
  { href: "/ontology", label: "Ontology", icon: Shapes },
  { href: "/wiki", label: "Wiki", icon: BookOpen },
  { href: "/data", label: "Script Data", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings },
];

type Meta = { enabled_keys: number; neo4j: { available: boolean }; characters: number; script_ingested: boolean };

function StatusChips() {
  const { data, error } = useSWR<Meta>("/api/meta", fetcher, { refreshInterval: 20000 });
  if (error) return <Badge variant="destructive">backend offline</Badge>;
  if (!data) return null;
  return (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={data.enabled_keys ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-300"}>
            {data.enabled_keys ? `${data.enabled_keys} LLM key${data.enabled_keys > 1 ? "s" : ""}` : "script-echo mode"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          {data.enabled_keys
            ? "Keys rotate cyclically with automatic failover."
            : "No API keys: characters answer with their own canon lines. Add keys in Settings."}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={data.neo4j?.available ? "border-sky-500/40 text-sky-300" : "text-muted-foreground"}>
            Neo4j {data.neo4j?.available ? "online" : "off"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{data.neo4j?.available ? "Cypher console enabled" : "Graph served from SQLite; start Neo4j for Cypher"}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function ActivePlayer() {
  const { playerId } = usePlayer();
  const { data } = useSWR<Player[]>("/api/players", fetcher, { refreshInterval: 15000 });
  const p = data?.find((x) => x.id === playerId);
  if (!p) return <span className="text-sm text-muted-foreground">No active playthrough</span>;
  return (
    <Link href="/play" className="flex items-center gap-2 text-sm hover:text-primary">
      <Castle className="size-4 text-primary" />
      <span className="font-medium">{p.name}</span>
      <Badge variant="secondary">{p.label}</Badge>
      <span className="hidden text-muted-foreground md:inline">· {p.location_name}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r border-sidebar-border bg-sidebar/90 backdrop-blur lg:block">
        <Link href="/" className="flex items-center gap-2 border-b border-sidebar-border px-5 py-4">
          <Crown className="size-5 text-primary" />
          <span className="font-display text-lg font-semibold tracking-wider text-primary">WESTEROS</span>
        </Link>
        {nav}
        <p className="absolute bottom-3 left-0 right-0 px-5 text-[11px] leading-snug text-muted-foreground">
          An agentic world. Characters remember, scheme, gossip and change.
        </p>
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-64 border-r border-sidebar-border bg-sidebar" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-sidebar-border px-5 py-4">
              <span className="font-display text-lg text-primary">WESTEROS</span>
              <button aria-label="Close menu" onClick={() => setOpen(false)}><X className="size-5" /></button>
            </div>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
          <button className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="size-5" /></button>
          <ActivePlayer />
          <div className="ml-auto"><StatusChips /></div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
