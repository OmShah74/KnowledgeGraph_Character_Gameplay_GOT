"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Archive, Skull } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Prepared = { token: string; confirm_phrase: string; current: Record<string, number>; expires_in: number };

/**
 * Two-step guarded destructive action:
 *   1. "prepare" -> backend returns a short-lived token and a summary of what will be reset
 *   2. the user must type the exact confirmation phrase; the backend archives the current
 *      database before reverting, so nothing is ever lost.
 */
export function ConfirmReset({
  action, target, trigger, title, description, onDone,
}: {
  action: "reset_all" | "restore_archive" | "reset_player";
  target?: string;
  trigger: React.ReactNode;
  title: string;
  description: string;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [phrase, setPhrase] = useState("");
  const [keepKeys, setKeepKeys] = useState(true);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  async function begin(o: boolean) {
    setOpen(o);
    setPhrase("");
    setStep(1);
    setPrep(null);
    if (!o) return;
    try {
      setPrep(await api.post<Prepared>("/api/admin/reset/prepare", { action, target }));
    } catch (e) {
      toast.error(errorMessage(e));
      setOpen(false);
    }
  }

  async function confirm() {
    if (!prep) return;
    setBusy(true);
    try {
      const path = action === "reset_all" ? "/api/admin/reset/confirm" : action === "restore_archive" ? "/api/admin/restore/confirm" : "/api/admin/players/reset/confirm";
      const res = await api.post<{ archived?: { file: string } }>(path, { token: prep.token, phrase, keep_api_keys: keepKeys });
      toast.success(`Done. The previous state was archived as ${res.archived?.file ?? "an archive"}.`);
      setOpen(false);
      onDone?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={begin}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-300"><Skull className="size-5" /> {title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {prep && step === 1 && (
          <div className="space-y-3 text-sm">
            <p className="font-medium">Are you sure? This is what exists right now:</p>
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border p-3 text-xs">
              {Object.entries(prep.current).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2"><span className="text-muted-foreground">{k.replace(/_/g, " ")}</span><span className="tabular-nums">{v}</span></div>
              ))}
            </div>
            <p className="flex items-center gap-2 text-xs text-emerald-300"><Archive className="size-4" /> The current database will be archived first and can be restored later.</p>
          </div>
        )}
        {prep && step === 2 && (
          <div className="space-y-3 text-sm">
            <Label htmlFor="phrase">Type <span className="font-mono text-red-300">{prep.confirm_phrase}</span> to confirm</Label>
            <Input id="phrase" autoFocus value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={prep.confirm_phrase} />
            {action !== "reset_player" && (
              <div className="flex items-center gap-2">
                <Switch id="keep" checked={keepKeys} onCheckedChange={setKeepKeys} />
                <Label htmlFor="keep">Keep my API keys and LLM settings</Label>
              </div>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {step === 1 ? (
            <Button variant="destructive" disabled={!prep} onClick={() => setStep(2)}>I understand, continue</Button>
          ) : (
            <Button variant="destructive" disabled={busy || !prep || phrase.trim() !== prep.confirm_phrase} onClick={() => void confirm()}>
              {busy ? "Restoring…" : "Yes, do it"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
