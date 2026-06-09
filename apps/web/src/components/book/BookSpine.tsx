import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { briefToPromptContext, type Brief } from "@/lib/brief";
import { metaHash } from "@/lib/planProvenance";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";

interface Spine { text?: string; brief_hash?: string }

/**
 * The Book Spine editor — the book-level objective (throughline) between the brief and the page
 * objectives. Generate it from the brief (the one-way brief→spine edge), or write it by hand. Stamps
 * the brief hash so the spine flags "out of sync" when the brief later changes. Self-fetches.
 */
export function BookSpine({ bookId, onChanged }: { bookId: number; onChanged?: () => void }) {
  const { toast } = useToast();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [spine, setSpine] = useState<Spine | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("books").select("brief, spine").eq("id", bookId).maybeSingle();
    setBrief((data?.brief as Brief | null) ?? null);
    const s = (data?.spine as Spine | null) ?? null;
    setSpine(s);
    setDraft(s?.text ?? "");
    setLoaded(true);
  }, [bookId]);
  useEffect(() => { void load(); }, [load]);

  // The brief's canonical text → hash; the spine is stale when the brief moved on since it was stamped.
  const briefHash = metaHash(briefToPromptContext(brief) ?? "");
  const stale = !!spine?.text?.trim() && !!spine?.brief_hash && spine.brief_hash !== briefHash;

  const persist = async (text: string) => {
    const next: Spine = { text, brief_hash: briefHash };
    const { error } = await supabase.from("books").update({ spine: next }).eq("id", bookId);
    if (error) throw error;
    await load();
    onChanged?.();
  };

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await briefToSpine(bookId);
      if (text) { setDraft(text); await persist(text); }
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't write the spine", description: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  // Distill the spine UP from the book's page objectives (objectives→spine): pull a hand-shaped
  // outline back into the book-level statement. Still stamps the current brief hash (the spine is now
  // reconciled with both — it reflects the outline and is current with the brief).
  const distill = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await objectivesToSpine(bookId);
      if (text) { setDraft(text); await persist(text); }
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't distill the spine", description: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const next = draft.trim();
    if (next === (spine?.text ?? "").trim()) return;
    try { await persist(next); }
    catch (e) { toast({ variant: "destructive", title: "Couldn't save the spine", description: String((e as Error)?.message ?? e) }); }
  };

  if (!loaded) return null;

  return (
    <section className="rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="pv-eyebrow">Book spine · the throughline · author only</div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy}
            className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50"
            title="Write the spine from the brief (top-down)"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {busy ? "Working…" : spine?.text?.trim() ? "Regenerate from brief →" : "Generate from brief →"}
          </button>
          <button
            type="button"
            onClick={() => void distill()}
            disabled={busy}
            className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground disabled:opacity-50"
            title="Reverse-outline: derive the spine from the page objectives (bottom-up)"
          >
            ↑ Distill from outline
          </button>
        </div>
      </div>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        placeholder="What the whole book is doing — its central objective and arc. Generate it from the brief, or write it yourself."
        className="mt-2 min-h-[96px] pv-serif text-[14.5px] leading-relaxed"
        disabled={busy}
      />
      {stale && (
        <p className="pv-serif mt-1.5 text-[13px] italic text-amber-600 dark:text-amber-500">
          The brief changed since this spine — regenerate it, or edit it to match.
        </p>
      )}
    </section>
  );
}

// brief→spine: generate the book spine from the brief (down-only). Returns the spine text.
async function briefToSpine(bookId: number): Promise<string> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/brief-to-spine`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookId }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return String(d.spine ?? "").trim();
  }
  const { data, error } = await supabase.functions.invoke("brief-to-spine", { body: { bookId } });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return String((data as { spine?: string })?.spine ?? "").trim();
}

// objectives→spine: distill the book spine from the page objectives (reverse, up). Returns the text.
async function objectivesToSpine(bookId: number): Promise<string> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/objectives-to-spine`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookId }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return String(d.spine ?? "").trim();
  }
  const { data, error } = await supabase.functions.invoke("objectives-to-spine", { body: { bookId } });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return String((data as { spine?: string })?.spine ?? "").trim();
}
