// VoiceStep — the Voice step's Stage body. Same durable backend as VoiceGenerator (a book_generations
// 'voice' row drafts three candidate samples; choosing one saves it to books.bible.voice_sample as the
// few-shot anchor for every prose render), reshaped into the prototype's inline voice cards: a single
// loud "find the voice" hero, then the candidates as pick-cards with a Chosen state. The Stage owns the
// head and the approve gate; this renders only the body between them.
import { useEffect, useState } from "react";
import { Check, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { RunControls } from "../../RunControls";
import { ActionLink, Eyebrow, Hero, RunError, RunningCard } from "../studioUi";

interface VoiceResult { samples: string[] }
interface VoiceRow extends TaskRow { result: VoiceResult | null; error: string | null }

export function VoiceStep({ bookId, onStatusChange, onChanged }: { bookId: number; onStatusChange: (v: boolean) => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [current, setCurrent] = useState<string | null | undefined>(undefined); // undefined = loading
  const [saving, setSaving] = useState<number | null>(null);
  const [kicking, setKicking] = useState(false);

  const { row, refetch, stale } = useLatestTaskRow<VoiceRow>({
    table: "book_generations", bookId, match: { kind: "voice" }, activeStatuses: ["pending", "running"], staleMs: 120_000,
  });
  const generating = row?.status === "pending" || row?.status === "running";
  const samples = row?.status === "ready" ? row.result?.samples ?? [] : [];

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.from("books").select("bible").eq("id", bookId).maybeSingle();
      if (!alive) return;
      const v = ((data?.bible as { voice_sample?: string } | null)?.voice_sample ?? "").trim() || null;
      setCurrent(v);
      onStatusChange(!!v);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const generate = async () => {
    if (generating || kicking) return;
    setKicking(true);
    try {
      if (BRIDGE) await bridgeFetch(`/generate-voice/${bookId}`, { method: "POST" }).catch(() => {});
      else { const { error } = await supabase.functions.invoke("generate-voice", { body: { bookId } }); if (error) throw error; }
      refetch();
    } catch (e) {
      toast({ title: "Couldn't draft voice samples", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setKicking(false); }
  };

  const choose = async (i: number, sample: string) => {
    const text = sample.trim();
    if (!text || saving !== null) return;
    setSaving(i);
    try {
      const { data } = await supabase.from("books").select("bible").eq("id", bookId).maybeSingle();
      const bible = { ...((data?.bible as Record<string, unknown> | null) ?? {}), voice_sample: text };
      const { error } = await supabase.from("books").update({ bible }).eq("id", bookId);
      if (error) throw error;
      if (row) await supabase.from("book_generations").update({ status: "applied" }).eq("id", row.id);
      setCurrent(text);
      onStatusChange(true);
      refetch();
      onChanged();
      toast({ title: "Voice set", description: "Every page the AI writes will follow this voice." });
    } catch (e) {
      toast({ title: "Couldn't save the voice", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setSaving(null); }
  };

  if (current === undefined) return null;

  if (generating) {
    return <RunningCard label="Drafting three voices" sub="three candidate voices — pick one when they land" controls={<RunControls table="book_generations" row={row} stale={stale} onRestart={generate} refetch={refetch} />} />;
  }

  if (samples.length === 0 && !current) {
    return (
      <Hero icon={<Sparkles className="h-5 w-5" />} title="Find the book's voice"
        sub="Draft three candidate voices and pick one — it anchors the prose so it doesn't read as generic."
        onClick={generate} disabled={kicking} />
    );
  }

  // Cards: the freshly-drafted samples if present, else the single saved voice (the row was applied).
  const cards = samples.length > 0 ? samples : current ? [current] : [];

  return (
    <div className="space-y-3.5">
      {cards.map((text, i) => {
        const chosen = !!current && text.trim() === current.trim();
        return (
          <div key={i} className={`rounded-2xl border px-6 py-5 transition-colors ${chosen ? "border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-surface-2))]/60 shadow-[0_10px_30px_rgba(0,0,0,0.05)]" : "border-border bg-[hsl(var(--pv-surface-2))]/40"}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <Eyebrow>Voice {i + 1}</Eyebrow>
              <button
                type="button"
                onClick={() => void choose(i, text)}
                disabled={saving !== null || chosen}
                className={`pv-serif inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13.5px] transition-colors disabled:opacity-100 ${chosen ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:border-foreground/40"}`}
              >
                {saving === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : chosen ? <Check className="h-3.5 w-3.5" /> : null}
                {chosen ? "Chosen" : "Use this voice"}
              </button>
            </div>
            <p className={`pv-serif whitespace-pre-wrap text-[15.5px] leading-[1.65] text-foreground ${chosen ? "" : "max-h-[140px] overflow-hidden"}`}>{text}</p>
          </div>
        );
      })}
      <ActionLink icon={<RefreshCw className="h-3.5 w-3.5" />} busy={kicking} onClick={generate}>
        regenerate three fresh takes
      </ActionLink>
      {row?.status === "error" && <RunError msg={row.error} />}
    </div>
  );
}
