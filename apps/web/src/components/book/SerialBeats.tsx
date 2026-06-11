import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, RefreshCw, ArrowLeft, Check } from "lucide-react";
import { AnimatedEllipsis } from "./AnimatedEllipsis";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { transforms, saveBeat } from "@/lib/ladder";

interface BeatPage {
  id: number;
  title: string | null;
  objective: string;
  beat: string;
}

interface SerialBeatsProps {
  bookId: number;
  /** Bump to reload the page list (e.g. after the outline changes). */
  refreshKey?: number;
  /** Called after a beat is saved, so the host re-derives counts/state. */
  onChanged?: () => void;
}

/**
 * Serial beat picker — the human-pick build of the beats step. Instead of generating every beat at
 * once and letting a judge keep the best, we walk the book ONE page at a time: draft 3 takes for the
 * current page, the author picks (and can edit) one, we save it, then move to the next page — whose
 * takes are drafted grounded on the beat just approved. This makes every beat react to a previous
 * beat the author actually chose, so structural drift can't compound silently down the chain.
 *
 * Synchronous and client-driven (a beat is a paragraph): no durable job, just objective→takes calls
 * through the ladder, then saveBeat. In dev the takes come from the bridge (free); in prod, the edge.
 */
export function SerialBeats({ bookId, refreshKey, onChanged }: SerialBeatsProps) {
  const { toast } = useToast();
  const [pages, setPages] = useState<BeatPage[] | null>(null);
  const [index, setIndex] = useState(0);
  const [takes, setTakes] = useState<string[]>([]);
  const [takesFor, setTakesFor] = useState<number | null>(null); // page id the takes belong to
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const reqRef = useRef(0); // guards against a stale takes response landing on the wrong page

  // Load the ordered, objective-bearing text pages — each is one beat decision.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("pages")
        .select("id, title, page_type, metadata")
        .eq("book_id", bookId).eq("archived", false)
        .order("page_index", { ascending: true });
      if (!alive) return;
      const list: BeatPage[] = ((data as Array<{ id: number; title: string | null; page_type: string | null; metadata: { objective?: string; beat?: string } | null }>) ?? [])
        .filter((p) => p.page_type === "text" && (p.metadata?.objective ?? "").trim())
        .map((p) => ({ id: p.id, title: p.title, objective: (p.metadata?.objective ?? "").trim(), beat: (p.metadata?.beat ?? "").trim() }));
      setPages(list);
      // Start on the first page that still needs a beat (resume), else the first page.
      const firstGap = list.findIndex((p) => !p.beat);
      setIndex(firstGap === -1 ? 0 : firstGap);
    })();
    return () => { alive = false; };
  }, [bookId, refreshKey]);

  const current = pages && index >= 0 && index < pages.length ? pages[index] : null;
  const allDone = useMemo(() => !!pages && pages.length > 0 && pages.every((p) => p.beat), [pages]);

  const draftTakes = useCallback(async (page: BeatPage) => {
    const req = ++reqRef.current;
    setLoading(true);
    setTakes([]);
    setTakesFor(null);
    try {
      const got = await transforms.beatCandidates(bookId, page.id, page.objective, 3);
      if (req !== reqRef.current) return; // a newer request superseded this one
      setTakes(got);
      setTakesFor(page.id);
      setDraft(got[0] ?? "");
    } catch (e) {
      if (req !== reqRef.current) return;
      toast({ title: "Couldn't draft the takes", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [bookId, toast]);

  // When the current page changes: if it already has a beat, seat it for review; otherwise draft takes.
  useEffect(() => {
    if (!current) return;
    if (current.beat) {
      reqRef.current++; // cancel any in-flight draft
      setTakes([]);
      setTakesFor(null);
      setDraft(current.beat);
      setLoading(false);
    } else if (takesFor !== current.id) {
      void draftTakes(current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const saveAndNext = async () => {
    if (!current || saving) return;
    const text = draft.trim();
    if (!text) { toast({ title: "Pick or write a beat first", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await saveBeat(bookId, current.id, text);
      setPages((prev) => prev?.map((p) => (p.id === current.id ? { ...p, beat: text } : p)) ?? prev);
      onChanged?.();
      // Advance to the next page still needing a beat (forward from here), else stay (all done).
      const rest = pages?.slice(index + 1) ?? [];
      const nextGap = rest.findIndex((p) => !p.beat);
      if (nextGap !== -1) setIndex(index + 1 + nextGap);
      else setIndex(index + 1); // off the end → the done state
    } catch (e) {
      toast({ title: "Couldn't save the beat", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!pages) return null;
  if (pages.length === 0) {
    return <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">No pages with an objective yet — generate the outline first.</p>;
  }

  const decided = pages.filter((p) => p.beat).length;

  // Off the end (or every beat saved): the done summary. The studio's Approve button sits below this.
  if (!current || allDone) {
    return (
      <div className="rounded-xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-5 py-4">
        <p className="pv-serif text-[14px] text-foreground">All {pages.length} beats planned.</p>
        <p className="pv-serif mt-0.5 text-[13px] italic text-[hsl(var(--pv-text-faint))]">
          Read them in the graph below. Step back through any page to redraft its beat, or approve to write the prose.
        </p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setIndex(0)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Review from the start
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="pv-mono text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">
          Beat {index + 1} of {pages.length} · {decided} done
        </span>
        {index > 0 && (
          <button type="button" onClick={() => setIndex(index - 1)} className="pv-serif inline-flex items-center gap-1 text-[12.5px] text-[hsl(var(--pv-text-muted))] hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
        )}
      </div>

      <div>
        <h4 className="pv-serif text-[15px] leading-snug text-foreground">{current.title || "(untitled page)"}</h4>
        <p className="pv-serif mt-1 rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-3 py-2 text-[13px] leading-snug text-[hsl(var(--pv-text-muted))]">
          <span className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">Objective</span>
          <br />{current.objective}
        </p>
      </div>

      {loading ? (
        <p className="pv-serif py-4 text-[13.5px] italic text-[hsl(var(--pv-text-faint))]">
          Drafting 3 takes<AnimatedEllipsis />
        </p>
      ) : (
        <>
          {takes.length > 0 && (
            <div className="space-y-2">
              <span className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">Takes — pick one to edit</span>
              {takes.map((t, i) => {
                const active = t.trim() === draft.trim();
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDraft(t)}
                    className={[
                      "block w-full rounded-lg border px-3 py-2 text-left transition-colors",
                      active ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-accent))]/[0.06]"
                        : "border-[hsl(var(--pv-border-soft))] hover:border-foreground/30",
                    ].join(" ")}
                  >
                    <span className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">Take {i + 1}</span>
                    <p className="pv-serif mt-0.5 text-[13px] leading-snug text-foreground">{t}</p>
                  </button>
                );
              })}
            </div>
          )}

          <div>
            <span className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">
              {current.beat && takes.length === 0 ? "Saved beat — edit or redraft" : "Your beat"}
            </span>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              className="mt-1 pv-serif text-[14px] leading-relaxed"
              placeholder="Pick a take above, or write the beat yourself…"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={saveAndNext} disabled={saving || !draft.trim()}>
              <Check className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Use this beat & continue"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => current && draftTakes(current)} disabled={loading || saving}>
              <RefreshCw className="mr-2 h-4 w-4" /> Redraft 3 takes
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
