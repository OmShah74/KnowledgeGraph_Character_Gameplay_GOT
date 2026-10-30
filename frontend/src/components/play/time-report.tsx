"use client";

import { motion } from "motion/react";
import { Ear, Flame, GitBranch, Landmark, MessagesSquare, Skull, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArtifactShowcase } from "@/components/three/lazy";

export type TickReport = {
  ord: number;
  label: string;
  canon: { title: string; outcome: string; narration: string }[];
  deaths: string[];
  factions: string[];
  rumours: { from_name: string; to_name: string; fact: string }[];
  offscreen: { a: string; b: string; summary: string; source: string }[];
  plots: { plot: string; event: string; stage?: string; text?: string }[];
  new_plots: { id: string; title: string }[];
};

const OUTCOME_STYLE: Record<string, string> = {
  occurred: "border-amber-400/40 text-amber-200",
  altered: "border-sky-400/50 text-sky-300",
  prevented: "border-emerald-400/50 text-emerald-300",
};

function Section({ icon: Icon, title, children, empty }: { icon: typeof Flame; title: string; children: React.ReactNode; empty?: boolean }) {
  if (empty) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Icon className="size-3.5 text-primary" /> {title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function TimeReportDialog({ reports, open, onOpenChange }: { reports: TickReport[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <ArtifactShowcase kind="raven" className="h-20 w-20 shrink-0" interactive={false} spin={0.8} />
            <div>
              <DialogTitle className="font-display text-2xl text-primary">Ravens bring news</DialogTitle>
              <DialogDescription>What happened across the realm while time passed.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <ScrollArea className="max-h-[62vh] pr-3">
          <div className="space-y-6">
            {reports.map((r, idx) => (
              <motion.div key={r.ord} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.12 }} className="space-y-4 rounded-lg border border-border p-4">
                <div className="font-display text-lg text-primary">{r.label}</div>
                <Section icon={Landmark} title="Events of the realm" empty={!r.canon.length}>
                  {r.canon.map((c) => (
                    <div key={c.title} className="rounded-md bg-muted/40 p-2.5 text-sm">
                      <div className="flex items-center gap-2"><span className="font-medium">{c.title}</span><Badge variant="outline" className={OUTCOME_STYLE[c.outcome]}>{c.outcome}</Badge></div>
                      <p className="mt-1 text-xs text-muted-foreground">{c.narration}</p>
                    </div>
                  ))}
                </Section>
                <Section icon={Skull} title="The dead" empty={!r.deaths.length}>
                  <p className="text-sm text-red-300">{r.deaths.join(", ")}</p>
                </Section>
                <Section icon={MessagesSquare} title="Off-screen lives" empty={!r.offscreen.length}>
                  {r.offscreen.map((o, i) => <p key={i} className="text-sm text-foreground/90">• {o.summary}</p>)}
                </Section>
                <Section icon={Ear} title="Whispers" empty={!r.rumours.length}>
                  {r.rumours.map((x, i) => <p key={i} className="text-sm"><b>{x.from_name}</b> → <b>{x.to_name}</b>: <span className="text-muted-foreground">{x.fact}</span></p>)}
                </Section>
                <Section icon={GitBranch} title="Plots" empty={!r.plots.length && !r.new_plots.length}>
                  {r.plots.map((p, i) => <p key={i} className="text-sm"><b>{p.plot}</b>: {p.stage ? `${p.stage} — ` : ""}{p.text || p.event}</p>)}
                  {r.new_plots.map((p) => <p key={p.id} className="text-sm text-amber-200"><Sparkles className="mr-1 inline size-3.5" />New plot: {p.title}</p>)}
                </Section>
                <Section icon={Flame} title="Great houses" empty={!r.factions.length}>
                  {r.factions.map((f, i) => <p key={i} className="text-sm text-muted-foreground">{f}</p>)}
                </Section>
              </motion.div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
