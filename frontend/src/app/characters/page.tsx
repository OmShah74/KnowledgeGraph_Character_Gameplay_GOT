"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { motion } from "motion/react";
import { Feather, MapPin, Search, Skull } from "lucide-react";
import { fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import type { CharacterListItem, Player } from "@/lib/types";
import { ordLabel, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CharacterSeal, HOUSE_SIGIL } from "@/components/heraldry";
import { ErrorBox, Loading, Mood, PageHeader } from "@/components/common";

export default function CharactersPage() {
  const { playerId } = usePlayer();
  const { data: players } = useSWR<Player[]>("/api/players", fetcher);
  const player = players?.find((p) => p.id === playerId);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("all");
  const [house, setHouse] = useState("all");
  const [alive, setAlive] = useState("all");
  const [ordOverride, setOrd] = useState<number | null>(null);
  const [limit, setLimit] = useState(60);
  const ord = ordOverride ?? player?.ord ?? 73;

  const { data, error } = useSWR<{ total: number; items: CharacterListItem[] }>(
    ["/api/characters", { q, tier: tier === "all" ? undefined : tier, house: house === "all" ? undefined : house, ord, player_id: playerId ?? undefined,
      alive: alive === "all" ? undefined : alive === "alive", limit: 400 }],
    fetcher, { keepPreviousData: true },
  );
  const items = useMemo(() => data?.items ?? [], [data]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Characters" subtitle="Every speaking character of the eight seasons is an agent. Their whereabouts, status and mood follow the timeline — and your world, if you are playing." />
      <Card className="mb-5 bg-card/60">
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_150px_170px_150px]">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or alias…" className="pl-8" />
          </div>
          <Select value={tier} onValueChange={setTier}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tiers</SelectItem>
              <SelectItem value="major">Major</SelectItem>
              <SelectItem value="supporting">Supporting</SelectItem>
              <SelectItem value="minor">Minor</SelectItem>
            </SelectContent>
          </Select>
          <Select value={house} onValueChange={setHouse}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All houses</SelectItem>
              {Object.keys(HOUSE_SIGIL).map((h) => <SelectItem key={h} value={h}>House {titleCase(h)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={alive} onValueChange={setAlive}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Living and dead</SelectItem>
              <SelectItem value="alive">Living</SelectItem>
              <SelectItem value="dead">Dead</SelectItem>
            </SelectContent>
          </Select>
          <div className="md:col-span-4">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Point in the story: <b className="text-primary">{ordLabel(ord)}</b>{player && ordOverride === null ? " (your current time)" : ""}</span>
              {ordOverride !== null && <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setOrd(null)}>Reset</Button>}
            </div>
            <Slider min={1} max={73} step={1} value={[ord]} onValueChange={([v]) => setOrd(v)} />
          </div>
        </CardContent>
      </Card>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      <div className="mb-3 text-xs text-muted-foreground">{items.length} characters</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.slice(0, limit).map((c, i) => (
          <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 20) * 0.015 }}>
            <Link href={`/characters/${c.id}`} prefetch={false}>
              <Card className={cn("h-full transition-all hover:-translate-y-0.5 hover:border-primary/50", !c.alive && "opacity-70")}>
                <CardContent className="flex gap-3 p-3">
                  <CharacterSeal name={c.name} house={c.house} size={44} dead={!c.alive} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-display text-sm">{c.name}</span>
                      {!c.alive && <Skull className="size-3.5 shrink-0 text-red-400" />}
                      {c.has_persona && <span title="Hand-written persona"><Feather className="size-3.5 shrink-0 text-primary" /></span>}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">{c.titles[0] ?? (c.house ? `House ${titleCase(c.house)}` : titleCase(c.tier))}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="h-5 text-[10px] capitalize">{c.tier}</Badge>
                      {c.location_name && c.alive && <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground"><MapPin className="size-3" />{c.location_name}</span>}
                      {c.mood && <Mood mood={c.mood} />}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
      {items.length > limit && (
        <div className="mt-5 text-center"><Button variant="outline" onClick={() => setLimit((l) => l + 60)}>Show more</Button></div>
      )}
    </div>
  );
}
