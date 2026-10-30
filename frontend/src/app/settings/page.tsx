"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Activity, Archive, ArrowRight, Eye, EyeOff, FlaskConical, KeyRound, ListRestart, Pencil, Plus, RotateCcw, Skull, Snowflake, Trash2, Workflow,
} from "lucide-react";
import { api, errorMessage, fetcher } from "@/lib/api";
import { usePlayer } from "@/lib/player-context";
import type { ApiKey } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, PageHeader } from "@/components/common";
import { ConfirmReset } from "@/components/confirm-reset";

type Provider = { id: string; label: string; base_url: string; default_model: string };
type Settings = { strategy: "round_robin" | "priority"; temperature: number; max_tokens: number; timeout_seconds: number; json_mode: boolean; max_attempts: number };
type Call = { id: number; key_name: string; provider: string; model: string; purpose: string; ok: number; status_code: number | null; latency_ms: number; error: string | null; created_at: string };
type Snapshot = { file: string; kind?: string; note?: string; bytes: number; sha256?: string; created_at?: string };
type Job = { id: number; kind: string; status: string; attempts: number; error: string | null; created_at: string; finished_at: string | null };

const MODEL_HINTS: Record<string, string[]> = {
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "meta-llama/llama-4-scout-17b-16e-instruct"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
  openrouter: ["meta-llama/llama-3.3-70b-instruct", "anthropic/claude-sonnet-4", "google/gemini-2.5-flash", "mistralai/mistral-large"],
  gemini: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
  custom: ["llama3.1", "qwen2.5:14b"],
};
const KEY_HELP: Record<string, string> = {
  groq: "console.groq.com → API Keys", openai: "platform.openai.com → API keys", openrouter: "openrouter.ai → Keys",
  gemini: "aistudio.google.com → Get API key", custom: "Any OpenAI-compatible server (Ollama, vLLM, LM Studio)",
};

type KeyForm = { id?: string; name: string; provider: string; key: string; model: string; base_url: string; priority: number; enabled: boolean };

function KeyDialog({ form, setForm, providers, onSaved }: { form: KeyForm | null; setForm: (f: KeyForm | null) => void; providers: Provider[]; onSaved: () => void }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!form) return null;
  const editing = !!form.id;
  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      if (editing) {
        await api.patch(`/api/llm/keys/${form.id}`, { name: form.name, provider: form.provider, model: form.model, base_url: form.base_url || null, priority: form.priority, enabled: form.enabled, ...(form.key ? { key: form.key } : {}) });
      } else {
        await api.post("/api/llm/keys", { name: form.name, provider: form.provider, key: form.key, model: form.model, base_url: form.base_url || null, priority: form.priority, enabled: form.enabled });
      }
      toast.success(editing ? "Key updated." : "Key added to the rotation.");
      setForm(null);
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && setForm(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="size-5 text-primary" /> {editing ? `Edit ${form.name}` : "Add an API key"}</DialogTitle>
          <DialogDescription>Keys are encrypted at rest and never shown again. Add as many as you like — they rotate cyclically and fail over automatically.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="groq-1" /></div>
            <div className="space-y-1.5"><Label>Provider</Label>
              <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v, model: MODEL_HINTS[v]?.[0] ?? form.model })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>API key {editing && <span className="text-xs text-muted-foreground">(leave blank to keep the current one)</span>}</Label>
            <div className="flex gap-2">
              <Input type={show ? "text" : "password"} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="sk-…" autoComplete="off" />
              <Button type="button" variant="outline" size="icon" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide key" : "Show key"}>{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Where to get one: {KEY_HELP[form.provider]}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} list="model-hints" />
            <datalist id="model-hints">{(MODEL_HINTS[form.provider] ?? []).map((m) => <option key={m} value={m} />)}</datalist>
            <div className="flex flex-wrap gap-1">{(MODEL_HINTS[form.provider] ?? []).map((m) => <button key={m} type="button" onClick={() => setForm({ ...form, model: m })} className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:border-primary">{m}</button>)}</div>
          </div>
          {form.provider === "custom" && <div className="space-y-1.5"><Label>Base URL</Label><Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="http://localhost:11434/v1" /></div>}
          <div className="grid grid-cols-2 items-end gap-3">
            <div className="space-y-1.5"><Label>Priority (higher first in priority mode)</Label><Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></div>
            <div className="flex items-center gap-2 pb-2"><Switch id="en" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} /><Label htmlFor="en">Enabled</Label></div>
          </div>
        </div>
        <DialogFooter><Button onClick={save} disabled={busy || !form.name.trim() || !form.model.trim() || (!editing && form.key.trim().length < 4)}>{busy ? "Saving…" : editing ? "Save changes" : "Add key"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KeysTab() {
  const { data: providers } = useSWR<Provider[]>("/api/llm/providers", fetcher);
  const { data: keys, mutate } = useSWR<ApiKey[]>("/api/llm/keys", fetcher, { refreshInterval: 10000 });
  const { data: settings, mutate: mutateSettings } = useSWR<Settings>("/api/llm/settings", fetcher);
  const [form, setForm] = useState<KeyForm | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  async function test(k: ApiKey) {
    setTesting(k.id);
    try {
      const r = await api.post<{ ok: boolean; latency_ms: number; reply?: string; error?: string }>(`/api/llm/keys/${k.id}/test`);
      if (r.ok) toast.success(`${k.name} answered in ${r.latency_ms} ms`, { description: r.reply });
      else toast.error(`${k.name} failed`, { description: r.error });
      mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTesting(null);
    }
  }
  async function patch(k: ApiKey, body: Record<string, unknown>) {
    try { await api.patch(`/api/llm/keys/${k.id}`, body); mutate(); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function remove(k: ApiKey) {
    try { await api.del(`/api/llm/keys/${k.id}`); toast.success(`${k.name} removed.`); mutate(); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function saveSettings(s: Partial<Settings>) {
    try { await api.put("/api/llm/settings", s); mutateSettings(); } catch (e) { toast.error(errorMessage(e)); }
  }

  const enabled = (keys ?? []).filter((k) => k.enabled);
  const order = settings?.strategy === "priority" ? [...enabled].sort((a, b) => b.priority - a.priority) : enabled;
  return (
    <div className="space-y-5">
      <Card className="bg-card/60">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><KeyRound className="size-5 text-primary" /> API keys</CardTitle>
            <CardDescription>Groq, OpenAI, OpenRouter, Gemini or any OpenAI-compatible server. One key is used on its own; several keys rotate.</CardDescription>
          </div>
          <Button onClick={() => setForm({ name: `key${(keys?.length ?? 0) + 1}`, provider: "groq", key: "", model: MODEL_HINTS.groq[0], base_url: "", priority: 0, enabled: true })}>
            <Plus className="size-4" /> Add key
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {!keys?.length && <Empty>No keys yet. Without one, characters answer with their own lines from the script (script-echo mode). Press <b>+ Add key</b> to bring them fully to life.</Empty>}
          {keys?.map((k) => (
            <div key={k.id} className={cn("grid items-center gap-3 rounded-lg border p-3 md:grid-cols-[1.4fr_1fr_1fr_auto]", k.enabled ? "border-border" : "border-border/40 opacity-60")}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{k.name}</span>
                  <Badge variant="outline" className="capitalize">{k.provider}</Badge>
                  {k.cooling_down && <Badge variant="outline" className="border-sky-400/40 text-sky-300"><Snowflake className="size-3" /> cooling {k.cooldown_remaining}s</Badge>}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">{k.model} · {k.key_hint}</div>
                {k.last_error && <div className="truncate text-[11px] text-red-300" title={k.last_error}>{k.last_error}</div>}
              </div>
              <div className="text-xs text-muted-foreground">
                <div><span className="text-emerald-400">{k.success_count} ok</span> · <span className="text-red-400">{k.failure_count} failed</span></div>
                <div>{k.last_used_at ? `used ${timeAgo(k.last_used_at)}` : "never used"}</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Switch checked={k.enabled} onCheckedChange={(v) => patch(k, { enabled: v })} aria-label="Enabled" />
                <span>priority</span>
                <Input type="number" className="h-7 w-16" defaultValue={k.priority} onBlur={(e) => Number(e.target.value) !== k.priority && patch(k, { priority: Number(e.target.value) })} />
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => test(k)} disabled={testing === k.id}><FlaskConical className="size-3.5" /> {testing === k.id ? "…" : "Test"}</Button>
                {k.cooling_down && <Button size="sm" variant="ghost" onClick={() => api.post(`/api/llm/keys/${k.id}/reset-cooldown`).then(() => mutate())} aria-label="Reset cooldown"><RotateCcw className="size-3.5" /></Button>}
                <Button size="sm" variant="ghost" onClick={() => setForm({ id: k.id, name: k.name, provider: k.provider, key: "", model: k.model, base_url: k.base_url ?? "", priority: k.priority, enabled: k.enabled })} aria-label="Edit"><Pencil className="size-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(k)} aria-label="Delete"><Trash2 className="size-3.5 text-red-400" /></Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {settings && (
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Workflow className="size-5 text-primary" /> Rotation & generation</CardTitle>
            <CardDescription>How requests are spread across keys, and how characters speak.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <Label>Strategy</Label>
              <div className="grid grid-cols-2 gap-2">
                {([["round_robin", "Round robin", "Every request starts at the next key, spreading load over all keys."], ["priority", "Priority", "Always try the highest-priority healthy key first."]] as const).map(([v, t, d]) => (
                  <button key={v} onClick={() => saveSettings({ strategy: v })} className={cn("rounded-lg border p-3 text-left", settings.strategy === v ? "border-primary bg-primary/10" : "border-border hover:border-primary/40")}>
                    <div className="text-sm font-medium">{t}</div><div className="text-[11px] text-muted-foreground">{d}</div>
                  </button>
                ))}
              </div>
              <div className="rounded-lg border border-border bg-black/20 p-3">
                <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Failover chain</div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {order.length ? order.map((k, i) => (
                    <span key={k.id} className="flex items-center gap-1.5">
                      {i > 0 && <ArrowRight className="size-3 text-muted-foreground" />}
                      <Badge variant={k.cooling_down ? "outline" : "secondary"} className={k.cooling_down ? "text-sky-300" : ""}>{k.name}</Badge>
                    </span>
                  )) : <span className="text-muted-foreground">no enabled keys</span>}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">Timeouts, 429s and 5xx put a key on an exponential cooldown and the request moves to the next one instantly. Cooling keys are used only as a last resort. A single key is retried once.</p>
              </div>
            </div>
            <div className="space-y-4">
              <div><div className="mb-1 flex justify-between text-sm"><Label>Temperature</Label><span className="tabular-nums">{settings.temperature.toFixed(2)}</span></div>
                <Slider min={0} max={1.5} step={0.05} value={[settings.temperature]} onValueCommit={([v]) => saveSettings({ temperature: v })} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Max tokens</Label><Input type="number" defaultValue={settings.max_tokens} onBlur={(e) => saveSettings({ max_tokens: Number(e.target.value) })} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Timeout (s)</Label><Input type="number" defaultValue={settings.timeout_seconds} onBlur={(e) => saveSettings({ timeout_seconds: Number(e.target.value) })} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Max attempts</Label><Input type="number" defaultValue={settings.max_attempts} onBlur={(e) => saveSettings({ max_attempts: Number(e.target.value) })} /></div>
              </div>
              <div className="flex items-center gap-2"><Switch id="jm" checked={settings.json_mode} onCheckedChange={(v) => saveSettings({ json_mode: v })} /><Label htmlFor="jm">Ask providers for strict JSON (auto-disabled per key if unsupported)</Label></div>
            </div>
          </CardContent>
        </Card>
      )}
      <KeyDialog form={form} setForm={setForm} providers={providers ?? []} onSaved={mutate} />
    </div>
  );
}

function UsageTab() {
  const { data: stats } = useSWR<{ per_key: { key_name: string; provider: string; model: string; calls: number; ok: number; avg_latency: number; prompt_tokens: number; completion_tokens: number }[]; per_purpose: { purpose: string; calls: number; ok: number }[] }>("/api/llm/stats", fetcher, { refreshInterval: 15000 });
  const { data: calls } = useSWR<Call[]>(["/api/llm/calls", { limit: 100 }], fetcher, { refreshInterval: 10000 });
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-card/60">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Per key</CardTitle></CardHeader>
          <CardContent>
            {!stats?.per_key.length ? <p className="text-xs text-muted-foreground">No calls yet.</p> : (
              <Table><TableHeader><TableRow><TableHead>Key</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Success</TableHead><TableHead className="text-right">Avg ms</TableHead><TableHead className="text-right">Tokens</TableHead></TableRow></TableHeader>
                <TableBody>{stats.per_key.map((k) => (
                  <TableRow key={k.key_name}><TableCell>{k.key_name}<div className="text-[10px] text-muted-foreground">{k.model}</div></TableCell><TableCell className="text-right">{k.calls}</TableCell>
                    <TableCell className="text-right">{Math.round((k.ok / k.calls) * 100)}%</TableCell><TableCell className="text-right">{Math.round(k.avg_latency)}</TableCell><TableCell className="text-right">{(k.prompt_tokens + k.completion_tokens).toLocaleString()}</TableCell></TableRow>
                ))}</TableBody></Table>
            )}
          </CardContent>
        </Card>
        <Card className="bg-card/60">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Per agent role</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {stats?.per_purpose.map((p) => (
              <div key={p.purpose} className="flex items-center gap-2 text-xs"><span className="w-28 capitalize">{p.purpose}</span>
                <div className="h-2 flex-1 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, (p.calls / (stats.per_purpose[0]?.calls || 1)) * 100)}%` }} /></div>
                <span className="w-16 text-right tabular-nums">{p.calls}</span></div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card className="bg-card/60">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Activity className="size-4 text-primary" /> Recent calls</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Key</TableHead><TableHead>Purpose</TableHead><TableHead>Status</TableHead><TableHead className="text-right">ms</TableHead></TableRow></TableHeader>
            <TableBody>{calls?.map((c) => (
              <TableRow key={c.id}><TableCell className="whitespace-nowrap text-xs">{timeAgo(c.created_at)}</TableCell><TableCell className="text-xs">{c.key_name}</TableCell><TableCell className="text-xs">{c.purpose}</TableCell>
                <TableCell className="text-xs">{c.ok ? <span className="text-emerald-400">ok</span> : <span className="text-red-400" title={c.error ?? ""}>{c.status_code ?? "error"}</span>}</TableCell><TableCell className="text-right text-xs tabular-nums">{c.latency_ms}</TableCell></TableRow>
            ))}</TableBody></Table>
        </CardContent>
      </Card>
    </div>
  );
}

function RealmTab() {
  const { playerId } = usePlayer();
  const { data: snaps, mutate } = useSWR<{ initial: Snapshot[]; archives: Snapshot[]; confirm_phrase: string }>("/api/admin/snapshots", fetcher);
  const { data: jobs, mutate: mutateJobs } = useSWR<{ items: Job[]; stats: Record<string, number> }>(["/api/admin/jobs", { limit: 40 }], fetcher, { refreshInterval: 8000 });
  async function archive() {
    try { const r = await api.post<Snapshot>("/api/admin/snapshots/archive", { note: "manual" }); toast.success(`Archived as ${r.file}`); mutate(); } catch (e) { toast.error(errorMessage(e)); }
  }
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
  return (
    <div className="space-y-5">
      <Card className="border-red-500/30 bg-red-950/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-300"><Skull className="size-5" /> Restart Westeros</CardTitle>
          <CardDescription>
            Revert the entire world to its pristine initial snapshot: every playthrough, conversation, memory, learned behaviour, drifted prior, rumour, plot and wiki edit.
            The current state is <b>always archived first</b> and can be restored below. API keys are kept unless you choose otherwise.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <ConfirmReset action="reset_all" title="Restart Westeros?" description="Everything learned since the beginning will be reverted to the initial snapshot. Nothing is destroyed: the current world is archived first." trigger={<Button variant="destructive"><Skull className="size-4" /> Restart Westeros</Button>} onDone={() => { mutate(); window.location.href = "/"; }} />
          {playerId && <ConfirmReset action="reset_player" target={playerId} title="Restart your tale?" description="Only your active playthrough returns to how it began. Other tales are untouched. The database is archived first." trigger={<Button variant="outline"><ListRestart className="size-4" /> Restart only my tale</Button>} onDone={() => (window.location.href = "/play")} />}
          <Button variant="outline" onClick={archive}><Archive className="size-4" /> Archive now</Button>
        </CardContent>
      </Card>
      <Card className="bg-card/60">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Snapshots & archives</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {snaps?.initial.map((s) => (
            <div key={s.file} className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 p-2 text-xs">
              <Badge>initial</Badge><span className="font-mono">{s.file}</span><span className="text-muted-foreground">{mb(s.bytes)} · {s.created_at}</span>
              {s.sha256 && <span className="truncate font-mono text-[10px] text-muted-foreground" title={s.sha256}>sha256 {s.sha256.slice(0, 16)}…</span>}
            </div>
          ))}
          {snaps?.archives.map((s) => (
            <div key={s.file} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-xs">
              <Badge variant="outline">archive</Badge><span className="font-mono">{s.file}</span><span className="text-muted-foreground">{mb(s.bytes)}{s.created_at ? ` · ${timeAgo(s.created_at)}` : ""}</span>
              <div className="ml-auto">
                <ConfirmReset action="restore_archive" target={s.file} title={`Restore ${s.file}?`} description="The world returns to this archive. The current state is archived first." trigger={<Button size="sm" variant="outline"><RotateCcw className="size-3.5" /> Restore</Button>} onDone={() => window.location.reload()} />
              </div>
            </div>
          ))}
          {!snaps?.archives.length && <p className="text-xs text-muted-foreground">No archives yet. One is created automatically before every reset, restore, re-ingest or graph rebuild.</p>}
        </CardContent>
      </Card>
      <Card className="bg-card/60">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm">Background cognition queue</CardTitle>
          <div className="flex items-center gap-2 text-xs">
            {Object.entries(jobs?.stats ?? {}).map(([k, v]) => <Badge key={k} variant="outline">{k} {v}</Badge>)}
            <Button size="sm" variant="outline" onClick={() => api.post("/api/admin/jobs/drain").then(() => mutateJobs())}>Run now</Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Job</TableHead><TableHead>Status</TableHead><TableHead>Tries</TableHead><TableHead>Queued</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{jobs?.items.map((j) => (
              <TableRow key={j.id}><TableCell className="text-xs">{j.id}</TableCell><TableCell className="text-xs">{j.kind}</TableCell>
                <TableCell className="text-xs"><span className={j.status === "done" ? "text-emerald-400" : j.status === "failed" ? "text-red-400" : "text-amber-300"} title={j.error ?? ""}>{j.status}</span></TableCell>
                <TableCell className="text-xs">{j.attempts}</TableCell><TableCell className="text-xs">{timeAgo(j.created_at)}</TableCell>
                <TableCell>{j.status === "failed" && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => api.post(`/api/admin/jobs/${j.id}/retry`).then(() => mutateJobs())}>Retry</Button>}</TableCell></TableRow>
            ))}</TableBody></Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Settings" subtitle="Language-model keys and rotation, usage, and the guardianship of the realm: snapshots, archives, restarts and the background cognition queue." />
      <Tabs defaultValue="keys">
        <TabsList>
          <TabsTrigger value="keys"><KeyRound className="size-4" /> API keys</TabsTrigger>
          <TabsTrigger value="usage"><Activity className="size-4" /> Usage</TabsTrigger>
          <TabsTrigger value="realm"><Archive className="size-4" /> Realm & data</TabsTrigger>
        </TabsList>
        <TabsContent value="keys"><KeysTab /></TabsContent>
        <TabsContent value="usage"><UsageTab /></TabsContent>
        <TabsContent value="realm"><RealmTab /></TabsContent>
      </Tabs>
    </div>
  );
}
