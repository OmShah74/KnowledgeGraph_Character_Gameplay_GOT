"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { BookOpen, CheckCircle2, ChevronRight, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { api, errorMessage, fetcher } from "@/lib/api";
import type { OntologyClass, OntologyRelation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorBox, Loading, PageHeader, Stat } from "@/components/common";

type Ont = { classes: OntologyClass[]; relations: OntologyRelation[] };
type Validation = { edges_checked: number; valid: boolean; issues: { kind: string; edge?: string; type?: string; expected?: string; source?: string; target?: string }[] };

function ClassTree({ classes, parent, depth, selected, onSelect }: { classes: OntologyClass[]; parent: string | null; depth: number; selected: string | null; onSelect: (n: string) => void }) {
  const kids = classes.filter((c) => c.parent === parent);
  return (
    <ul className={cn(depth > 0 && "ml-3 border-l border-border pl-2")}>
      {kids.map((c) => (
        <li key={c.name}>
          <button onClick={() => onSelect(c.name)} className={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted", selected === c.name && "bg-primary/15 text-primary")}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
            <span className="truncate">{c.name}</span>
            {c.instance_count > 0 && <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{c.instance_count}</span>}
          </button>
          <ClassTree classes={classes} parent={c.name} depth={depth + 1} selected={selected} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

export default function OntologyPage() {
  const { data, error, mutate } = useSWR<Ont>("/api/ontology", fetcher);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [selected, setSelected] = useState<string | null>("Character");
  const [classDlg, setClassDlg] = useState<{ mode: "new" | "edit"; name: string; parent: string; description: string; color: string; properties: string } | null>(null);
  const [relDlg, setRelDlg] = useState<{ mode: "new" | "edit"; name: string; domain: string; range: string; description: string; symmetric: boolean; temporal: boolean } | null>(null);
  const [filter, setFilter] = useState("");
  const sel = useMemo(() => data?.classes.find((c) => c.name === selected), [data, selected]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const rels = data.relations.filter((r) => !filter || r.name.includes(filter.toUpperCase()) || r.domain === filter || r.range === filter);
  const selRels = sel ? data.relations.filter((r) => r.domain === sel.name || r.range === sel.name) : [];

  async function saveClass() {
    if (!classDlg) return;
    try {
      const properties = classDlg.properties.trim() ? JSON.parse(classDlg.properties) : {};
      if (classDlg.mode === "new") await api.post("/api/ontology/classes", { name: classDlg.name, parent: classDlg.parent, description: classDlg.description, color: classDlg.color, properties });
      else await api.patch(`/api/ontology/classes/${classDlg.name}`, { parent: classDlg.parent, description: classDlg.description, color: classDlg.color, properties });
      toast.success("Ontology updated.");
      setClassDlg(null);
      mutate();
    } catch (e) {
      toast.error(e instanceof SyntaxError ? "Properties must be valid JSON" : errorMessage(e));
    }
  }
  async function saveRel() {
    if (!relDlg) return;
    try {
      const body = { domain: relDlg.domain, range: relDlg.range, description: relDlg.description, symmetric: relDlg.symmetric, temporal: relDlg.temporal };
      if (relDlg.mode === "new") await api.post("/api/ontology/relations", { name: relDlg.name, ...body });
      else await api.patch(`/api/ontology/relations/${relDlg.name}`, body);
      toast.success("Relation saved.");
      setRelDlg(null);
      mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function del(kind: "classes" | "relations", name: string) {
    try {
      await api.del(`/api/ontology/${kind}/${name}`);
      toast.success(`${name} deleted.`);
      mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function validate() {
    try {
      setValidation(await api.get<Validation>("/api/ontology/validate"));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const classNames = data.classes.map((c) => c.name);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Ontology" subtitle="The schema of the world. Every node in the knowledge graph has a class; every edge has a typed relation with a domain, range, symmetry and temporality. Edges that violate the schema are rejected.">
        <Button variant="outline" size="sm" onClick={validate}><CheckCircle2 className="size-4" /> Validate graph</Button>
      </PageHeader>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Classes" value={data.classes.length} />
        <Stat label="Relation types" value={data.relations.length} />
        <Stat label="Temporal relations" value={data.relations.filter((r) => r.temporal).length} />
        <Stat label="Custom (yours)" value={data.classes.filter((c) => !c.builtin).length + data.relations.filter((r) => !r.builtin).length} />
      </div>
      {validation && (
        <div className={cn("mb-5 rounded-lg border p-3 text-sm", validation.valid ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-200" : "border-red-500/40 bg-red-500/5 text-red-200")}>
          {validation.valid ? <span><CheckCircle2 className="mr-1 inline size-4" /> All {validation.edges_checked.toLocaleString()} edges conform to the ontology.</span> : (
            <div><ShieldAlert className="mr-1 inline size-4" /> {validation.issues.length} issue(s):
              <ul className="mt-1 list-disc pl-5 text-xs">{validation.issues.slice(0, 20).map((i, k) => <li key={k}>{i.kind}: {i.type ?? ""} {i.source ?? ""} → {i.target ?? ""} {i.expected ? `(expected ${i.expected})` : ""}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit bg-card/60">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Class hierarchy</CardTitle>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setClassDlg({ mode: "new", name: "", parent: selected ?? "Entity", description: "", color: "#94a3b8", properties: "{}" })}><Plus className="size-4" /></Button>
          </CardHeader>
          <CardContent><ClassTree classes={data.classes} parent={null} depth={0} selected={selected} onSelect={setSelected} /></CardContent>
        </Card>
        <div className="space-y-5">
          {sel && (
            <Card className="bg-card/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: sel.color }} />
                  <span className="font-display">{sel.name}</span>
                  {sel.builtin ? <Badge variant="outline">built-in</Badge> : <Badge>custom</Badge>}
                  <span className="text-xs font-normal text-muted-foreground">{sel.instance_count} instances</span>
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="outline" asChild><Link href={`/wiki?slug=ontology/${sel.name}`}><BookOpen className="size-4" /> Wiki</Link></Button>
                    <Button size="sm" variant="outline" onClick={() => setClassDlg({ mode: "edit", name: sel.name, parent: sel.parent ?? "Entity", description: sel.description, color: sel.color, properties: JSON.stringify(sel.properties, null, 2) })}><Pencil className="size-4" /></Button>
                    {!sel.builtin && <Button size="sm" variant="outline" onClick={() => del("classes", sel.name)}><Trash2 className="size-4 text-red-400" /></Button>}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{sel.description}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  Inherits:{" "}
                  {(() => {
                    const chain: string[] = [];
                    let cur: string | null = sel.name;
                    while (cur) { chain.unshift(cur); cur = data.classes.find((c) => c.name === cur)?.parent ?? null; }
                    return chain.map((n, i) => <span key={n} className="flex items-center gap-1">{i > 0 && <ChevronRight className="size-3" />}<button className="hover:text-primary" onClick={() => setSelected(n)}>{n}</button></span>);
                  })()}
                </div>
                {Object.keys(sel.properties ?? {}).length > 0 && (
                  <div className="flex flex-wrap gap-1">{Object.entries(sel.properties).map(([k, v]) => <Badge key={k} variant="secondary" className="font-mono text-[10px]">{k}: {String(v)}</Badge>)}</div>
                )}
                <div className="text-xs">
                  <div className="mb-1 text-muted-foreground">Relations touching {sel.name}</div>
                  <div className="flex flex-wrap gap-1">{selRels.map((r) => <Badge key={r.name} variant="outline" className="font-mono text-[10px]">{r.domain} —{r.name}→ {r.range}</Badge>)}</div>
                </div>
              </CardContent>
            </Card>
          )}
          <Card className="bg-card/60">
            <CardHeader className="flex-row flex-wrap items-center gap-2 pb-2">
              <CardTitle className="text-sm">Relations</CardTitle>
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or class…" className="ml-auto h-8 w-56" />
              <Button size="sm" onClick={() => setRelDlg({ mode: "new", name: "", domain: "Character", range: "Character", description: "", symmetric: false, temporal: true })}><Plus className="size-4" /> Relation</Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Relation</TableHead><TableHead>Domain → Range</TableHead><TableHead>Kind</TableHead><TableHead className="text-right">Edges</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {rels.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell><div className="font-mono text-xs text-primary">{r.name}</div><div className="max-w-md text-[11px] text-muted-foreground">{r.description}</div></TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{r.domain} → {r.range}</TableCell>
                      <TableCell className="space-x-1 whitespace-nowrap">{r.symmetric && <Badge variant="outline" className="text-[10px]">symmetric</Badge>}{r.temporal && <Badge variant="outline" className="text-[10px]">temporal</Badge>}{!r.builtin && <Badge className="text-[10px]">custom</Badge>}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.edge_count.toLocaleString()}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => setRelDlg({ mode: "edit", name: r.name, domain: r.domain, range: r.range, description: r.description, symmetric: r.symmetric, temporal: r.temporal })}><Pencil className="size-3.5" /></Button>
                        {!r.builtin && <Button size="sm" variant="ghost" className="h-7" onClick={() => del("relations", r.name)}><Trash2 className="size-3.5 text-red-400" /></Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!classDlg} onOpenChange={(o) => !o && setClassDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{classDlg?.mode === "new" ? "New class" : `Edit ${classDlg?.name}`}</DialogTitle></DialogHeader>
          {classDlg && (
            <div className="space-y-3">
              {classDlg.mode === "new" && <div className="space-y-1.5"><Label>Name (identifier)</Label><Input value={classDlg.name} onChange={(e) => setClassDlg({ ...classDlg, name: e.target.value })} placeholder="Prophecy" /></div>}
              <div className="grid grid-cols-[1fr_90px] gap-3">
                <div className="space-y-1.5"><Label>Parent</Label>
                  <Select value={classDlg.parent} onValueChange={(v) => setClassDlg({ ...classDlg, parent: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">{classNames.filter((n) => n !== classDlg.name).map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label>Colour</Label><Input type="color" value={classDlg.color} onChange={(e) => setClassDlg({ ...classDlg, color: e.target.value })} className="h-9 p-1" /></div>
              </div>
              <div className="space-y-1.5"><Label>Description</Label><Textarea value={classDlg.description} onChange={(e) => setClassDlg({ ...classDlg, description: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Properties (JSON schema hints)</Label><Textarea value={classDlg.properties} onChange={(e) => setClassDlg({ ...classDlg, properties: e.target.value })} className="font-mono text-xs" /></div>
            </div>
          )}
          <DialogFooter><Button onClick={saveClass}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!relDlg} onOpenChange={(o) => !o && setRelDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{relDlg?.mode === "new" ? "New relation" : `Edit ${relDlg?.name}`}</DialogTitle></DialogHeader>
          {relDlg && (
            <div className="space-y-3">
              {relDlg.mode === "new" && <div className="space-y-1.5"><Label>Name (UPPER_SNAKE_CASE)</Label><Input value={relDlg.name} onChange={(e) => setRelDlg({ ...relDlg, name: e.target.value.toUpperCase() })} placeholder="FORETOLD_BY" /></div>}
              <div className="grid grid-cols-2 gap-3">
                {(["domain", "range"] as const).map((k) => (
                  <div key={k} className="space-y-1.5"><Label className="capitalize">{k}</Label>
                    <Select value={relDlg[k]} onValueChange={(v) => setRelDlg({ ...relDlg, [k]: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-72">{classNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent></Select></div>
                ))}
              </div>
              <div className="space-y-1.5"><Label>Description</Label><Textarea value={relDlg.description} onChange={(e) => setRelDlg({ ...relDlg, description: e.target.value })} /></div>
              <div className="flex gap-6">
                <div className="flex items-center gap-2"><Switch id="sym" checked={relDlg.symmetric} onCheckedChange={(v) => setRelDlg({ ...relDlg, symmetric: v })} /><Label htmlFor="sym">Symmetric</Label></div>
                <div className="flex items-center gap-2"><Switch id="tmp" checked={relDlg.temporal} onCheckedChange={(v) => setRelDlg({ ...relDlg, temporal: v })} /><Label htmlFor="tmp">Temporal (valid from/to)</Label></div>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={saveRel}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
