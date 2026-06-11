import { useEffect, useState } from "react";
import { Sparkles, Check, Loader2 } from "lucide-react";
import { AnimatedEllipsis } from "./AnimatedEllipsis";
import { AIActionRow } from "./AIActionRow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { RunControls } from "./RunControls";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";

interface VoiceResult { samples: string[] }
interface VoiceRow extends TaskRow {
  result: VoiceResult | null;
  error: string | null;
}

interface VoiceGeneratorProps {
  bookId: number;
  /** Reports whether a voice sample is saved, so the journey rail can mark the step done. */
  onStatusChange?: (hasVoice: boolean) => void;
  /** Called after a voice is chosen (host refresh). */
  onChosen?: () => void;
}

/**
 * G4 — pick the book's prose VOICE. Drafts three candidate voice samples (durable book_generations
 * row, kind 'voice'), the author picks one, and it's saved to books.bible.voice_sample. Every prose
 * render then carries it as a few-shot anchor — the single biggest lever against the "this is AI"
 * tell. Style instructions don't make a voice; an exemplar does.
 */
export function VoiceGenerator({ bookId, onStatusChange, onChosen }: VoiceGeneratorProps) {
  const { toast } = useToast();
  const [kicking, setKicking] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [current, setCurrent] = useState<string | null | undefined>(undefined); // undefined = loading
  const [open, setOpen] = useState(false);

  const { row, refetch, stale } = useLatestTaskRow<VoiceRow>({
    table: "book_generations",
    bookId,
    match: { kind: "voice" },
    activeStatuses: ["pending", "running"],
    staleMs: 120_000,
  });

  const generating = row?.status === "pending" || row?.status === "running";
  const samples = row?.status === "ready" ? row.result?.samples ?? [] : [];

  // Load the saved voice once; report status up so the rail can mark the step done.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.from("books").select("bible").eq("id", bookId).maybeSingle();
      if (!alive) return;
      const v = ((data?.bible as { voice_sample?: string } | null)?.voice_sample ?? "").trim() || null;
      setCurrent(v);
      onStatusChange?.(!!v);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // Open the picker automatically when a fresh proposal lands.
  useEffect(() => {
    if (row?.status === "ready" && (row.result?.samples?.length ?? 0) > 0) setOpen(true);
  }, [row?.id, row?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    if (generating || kicking) return;
    setKicking(true);
    try {
      if (BRIDGE) {
        await bridgeFetch(`/generate-voice/${bookId}`, { method: "POST" }).catch(() => {});
      } else {
        const { error } = await supabase.functions.invoke("generate-voice", { body: { bookId } });
        if (error) throw error;
      }
      refetch();
    } catch (e) {
      toast({ title: "Couldn't draft voice samples", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setKicking(false);
    }
  };

  const choose = async (i: number) => {
    const sample = samples[i]?.trim();
    if (!sample || saving !== null) return;
    setSaving(i);
    try {
      const { data } = await supabase.from("books").select("bible").eq("id", bookId).maybeSingle();
      const bible = { ...((data?.bible as Record<string, unknown> | null) ?? {}), voice_sample: sample };
      const { error } = await supabase.from("books").update({ bible }).eq("id", bookId);
      if (error) throw error;
      if (row) await supabase.from("book_generations").update({ status: "applied" }).eq("id", row.id);
      setCurrent(sample);
      onStatusChange?.(true);
      setOpen(false);
      refetch();
      onChosen?.();
      toast({ title: "Voice set", description: "Every page the AI writes will follow this voice." });
    } catch (e) {
      toast({ title: "Couldn't save the voice", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  if (current === undefined) return null; // initial load — say nothing

  return (
    <>
      <AIActionRow
        icon={current ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        title={generating ? <span>Drafting voices<AnimatedEllipsis /></span> : current ? "Voice is set — try other samples" : "Find the book's voice"}
        description={current
          ? "A voice sample anchors every page the AI writes. Generate three fresh takes to swap it."
          : "Draft three candidate voices and pick one — it anchors the prose so it doesn't read as generic."}
        onClick={generate}
        loading={generating || kicking}
      />
      <RunControls table="book_generations" row={row} stale={stale} onRestart={generate} refetch={refetch} />
      {current && (
        <p className="px-5 pt-1 pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))] line-clamp-2">
          Current voice: “{current.slice(0, 200)}{current.length > 200 ? "…" : ""}”
        </p>
      )}
      {row?.status === "error" && (
        <p className="px-5 pt-1 pv-serif text-[13px] italic text-red-600 dark:text-red-400">{row.error}</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Pick the book's voice</DialogTitle>
            <DialogDescription>
              Three distinct takes on how the book could sound. Pick the one that feels right — it becomes the
              style anchor for every page the AI writes. You can regenerate or swap it later.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 -mx-2 px-2 space-y-3 py-1">
            {samples.map((s, i) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="pv-mono text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">Voice {i + 1}</span>
                  <Button size="sm" onClick={() => void choose(i)} disabled={saving !== null}>
                    {saving === i ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    {saving === i ? "Saving…" : "Use this voice"}
                  </Button>
                </div>
                <p className="pv-serif mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">{s}</p>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving !== null}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
