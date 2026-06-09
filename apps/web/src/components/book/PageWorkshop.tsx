import { useCallback, useEffect, useRef, useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Loader2, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { isEdgeStale, isProseStale, metaHash, stampEdge, type PageMeta } from "@/lib/planProvenance";
import type { EvalResult, Severity } from "./BookEvaluationSection";

// The page's single AI unit: it looks at one page (its author-only objective + the editor's
// notes), takes the author's comment, then writes or revises. Empty text pages can only set an
// objective and *create* the page (generate mode); pages with prose can edit the objective, add
// a comment, and *revise* (revise mode, with a diff preview). Section pages get just the
// objective field.
//
// The generation is a DURABLE task: it runs as a book_generations row (kind page_write/page_revise,
// scoped to this page) written server-side by the generate-page edge function and watched here over
// Realtime. So a refresh mid-generation resumes the loader, and a finished proposal is still here to
// review/apply — nothing lives only in React. The dev bridge writes the same row.

// Mirrors generate-unit's ReviseIssue (and ReviseWithAI's FixIssue): one editorial note.
interface ReviseIssue {
  section: string;
  severity: Severity;
  note: string;
  evidence?: string;
  suggestion?: string;
}

interface Props {
  bookId: number;
  pageId: number;
  pageType: "text" | "section";
  /** Author-only page objective + setter (persisted to pages.metadata.objective by the host). */
  objective: string | null;
  onObjectiveChange: (next: string | null) => void;
  /** Current page prose as plain text — the "before" side of the revise diff; "" = empty page. */
  currentText: string;
  /** Append generated prose to the live editor (create flow). */
  onAppendProse: (prose: string) => void;
  /** Replace the page body with revised prose (revise flow). */
  onApply: (prose: string) => void;
}

// The page-generation task row (book_generations, scoped to this page).
interface PageGenRow extends TaskRow {
  kind: "page_write" | "page_revise";
  result: { text?: string } | null;
  error: string | null;
}

const SEV_TONE: Record<Severity, string> = {
  high: "text-red-600 dark:text-red-400",
  medium: "text-amber-600 dark:text-amber-500",
  low: "text-[hsl(var(--pv-text-faint))]",
};

// Pull this page's notes out of a stored evaluation (issues are anchored by page_ref.id).
function notesForPage(result: EvalResult, pageId: number): ReviseIssue[] {
  const out: ReviseIssue[] = [];
  for (const section of result.sections ?? []) {
    for (const issue of section.issues ?? []) {
      if (issue.page_ref?.id !== pageId) continue;
      out.push({
        section: section.title,
        severity: issue.severity,
        note: issue.note,
        evidence: issue.evidence,
        suggestion: issue.suggestion,
      });
    }
  }
  return out;
}

const diffStyles = {
  variables: {
    light: {
      diffViewerBackground: "transparent",
      addedBackground: "#d1fae5",
      addedColor: "#065f46",
      removedBackground: "#fee2e2",
      removedColor: "#991b1b",
      wordAddedBackground: "#86efac",
      wordRemovedBackground: "#fca5a5",
      gutterBackground: "transparent",
    },
  },
};

// Kick off a durable page-generation task (dual backend). Returns once the task is STARTED — the
// prose lands later as a 'ready' book_generations row the component watches. The dev bridge writes
// the same row, so dev resumes-on-refresh identically.
async function startPageGen(body: Record<string, unknown>): Promise<void> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/page`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return;
  }
  const { error } = await supabase.functions.invoke("generate-page", { body });
  if (error) throw error;
}

// objective→beat: generate a beat from a page's objective (downward transform). Synchronous; returns
// the beat text (the caller writes metadata.beat + stamps the edge). Dual backend, like generateOnePage.
async function objectiveToBeat(bookId: number, pageId: number, objective: string): Promise<string> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/objective-to-beat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookId, pageId, objective }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return String(d.beat ?? "").trim();
  }
  const { data, error } = await supabase.functions.invoke("objective-to-beat", { body: { bookId, pageId, objective } });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return String((data as { beat?: string })?.beat ?? "").trim();
}

// prose→beat: distill a beat from a page's prose (the reverse transform). Returns the beat text; the
// caller writes metadata.beat + reconciles the objective_beat & beat_prose edges.
async function proseToBeat(bookId: number, pageId: number, proseText: string): Promise<string> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/prose-to-beat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookId, pageId, proseText }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return String(d.beat ?? "").trim();
  }
  const { data, error } = await supabase.functions.invoke("prose-to-beat", { body: { bookId, pageId, proseText } });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return String((data as { beat?: string })?.beat ?? "").trim();
}

// beat→objective: distill a page's objective from its beat (reverse, up). Returns the objective text;
// the caller sets the page objective (host-owned) and reconciles the objective_beat edge.
async function beatToObjective(bookId: number, pageId: number, beat: string): Promise<string> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/beat-to-objective`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookId, pageId, beat }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return String(d.objective ?? "").trim();
  }
  const { data, error } = await supabase.functions.invoke("beat-to-objective", { body: { bookId, pageId, beat } });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return String((data as { objective?: string })?.objective ?? "").trim();
}

// revise-node: rewrite a short plan node (objective/beat) against an instruction, PRESERVING what
// works. Returns the proposed text; the caller shows a diff and persists on accept.
async function reviseNode(bookId: number, pageId: number, layer: "objective" | "beat", current: string, instruction: string): Promise<string> {
  const body = { bookId, pageId, layer, current, instruction };
  if (BRIDGE) {
    const r = await bridgeFetch(`/revise-node`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return String(d.text ?? "").trim();
  }
  const { data, error } = await supabase.functions.invoke("revise-node", { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return String((data as { text?: string })?.text ?? "").trim();
}

// A reusable diff-based reviser for a SHORT node (objective / beat): the author types an instruction,
// the AI proposes a revision (preserving the rest), and the change lands as a before→after diff to
// accept or reject. Mirrors the prose revise flow's gate, at node scale.
function NodeReviser({
  current, busy, onRevise, onAccept,
}: {
  current: string;
  busy: boolean;
  onRevise: (instruction: string) => Promise<string>; // returns the proposed text
  onAccept: (proposed: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [proposed, setProposed] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const run = async () => {
    if (!instruction.trim() || working) return;
    setWorking(true);
    try { setProposed(await onRevise(instruction.trim())); }
    finally { setWorking(false); }
  };
  const accept = async () => {
    if (proposed == null) return;
    setWorking(true);
    try { await onAccept(proposed); setOpen(false); setProposed(null); setInstruction(""); }
    finally { setWorking(false); }
  };
  const reset = () => { setOpen(false); setProposed(null); setInstruction(""); };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={busy}
        className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground disabled:opacity-50"
        title="Revise this — preserves what's here, applies your change">
        ✎ Revise
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 p-3">
      {proposed == null ? (
        <>
          <Textarea
            value={instruction} onChange={(e) => setInstruction(e.target.value)} autoFocus
            placeholder="What should change? e.g. “make it colder, less wistful” — the rest is preserved."
            className="min-h-[56px] text-[13.5px]" disabled={working}
          />
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void run()} disabled={working || !instruction.trim()}
              className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50">
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {working ? "Revising…" : "Revise →"}
            </button>
            <button type="button" onClick={reset} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-[hsl(var(--pv-border-soft))] text-[13px]">
            <ReactDiffViewer oldValue={current} newValue={proposed} splitView={false}
              compareMethod={DiffMethod.WORDS} useDarkTheme={false} styles={diffStyles} hideLineNumbers showDiffOnly={false} />
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void accept()} disabled={working}
              className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50">
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Accept →
            </button>
            <button type="button" onClick={() => setProposed(null)} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">Re-do</button>
            <button type="button" onClick={reset} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">Discard</button>
          </div>
        </>
      )}
    </div>
  );
}

// A re-create control between two layers. Both directions REPLACE their target; the arrow shows the
// direction (↓ expand from above, ↑ distill from below). One verb — "re-create" — so the operation
// reads the same both ways, distinct from the per-node ✎ Revise (which preserves).
interface RecreateAction { label: string; onClick: () => void; disabled?: boolean; busy?: boolean }
function ConnectorBtn({ dir, action }: { dir: "down" | "up"; action: RecreateAction }) {
  return (
    <button
      type="button" onClick={action.onClick} disabled={action.disabled}
      title={dir === "down" ? "Re-create the lower layer from the upper — replaces it" : "Re-create the upper layer from the lower — replaces it"}
      className="pv-serif inline-flex items-center gap-1 text-[13px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50"
    >
      {action.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      {dir === "down" ? "↓" : "↑"} {action.label}
    </button>
  );
}
function Connector({ down, up }: { down: RecreateAction; up?: RecreateAction }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-[hsl(var(--pv-border-soft))]" />
      <ConnectorBtn dir="down" action={down} />
      {up && (
        <>
          <span className="text-[hsl(var(--pv-border-soft))]">·</span>
          <ConnectorBtn dir="up" action={up} />
        </>
      )}
      <div className="h-px flex-1 bg-[hsl(var(--pv-border-soft))]" />
    </div>
  );
}

export function PageWorkshop({
  bookId,
  pageId,
  pageType,
  objective,
  onObjectiveChange,
  currentText,
  onAppendProse,
  onApply,
}: Props) {
  const { toast } = useToast();
  // Local draft for the objective field; resynced when the page or its objective changes.
  const [objectiveDraft, setObjectiveDraft] = useState(objective ?? "");
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<ReviseIssue[]>([]);
  const [instruction, setInstruction] = useState("");
  const mounted = useRef(true);

  // The durable generation task for THIS page (create or revise). Watched over Realtime, so a
  // refresh mid-generation resumes the loader and a finished proposal is still here to review.
  const { row, refetch } = useLatestTaskRow<PageGenRow>({
    table: "book_generations",
    bookId,
    match: { target_page_id: pageId, kind: ["page_write", "page_revise"] },
    activeStatuses: ["pending", "running"],
  });
  const running = row?.status === "pending" || row?.status === "running";
  const proposed = row?.status === "ready" ? (row.result?.text ?? "").trim() || null : null;
  const genError = row?.status === "error" ? row.error : null;

  // Editable copy of a ready proposal — the author can tweak the prose before applying. Reseeded
  // when a new proposal arrives; left alone while the author edits it.
  const [proposedDraft, setProposedDraft] = useState("");
  useEffect(() => {
    setProposedDraft(proposed ?? "");
  }, [row?.id, proposed]);

  useEffect(() => {
    setObjectiveDraft(objective ?? "");
  }, [objective, pageId]);

  // Load this page's notes from the latest completed evaluation (if any). Reset on page change.
  // Evaluations live in book_evaluations in both modes (the bridge writes there too now), so we
  // always read from the table — generation is now a watched book_generations row (see the hook).
  useEffect(() => {
    mounted.current = true;
    setNotes([]);
    setInstruction("");
    setOpen(false);

    const apply = (result: EvalResult | null) => {
      if (mounted.current && result) setNotes(notesForPage(result, pageId));
    };

    supabase
      .from("book_evaluations")
      .select("result")
      .eq("book_id", bookId)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => apply((data?.result as EvalResult | null) ?? null));

    return () => {
      mounted.current = false;
    };
  }, [bookId, pageId]);

  const commitObjective = () => {
    const next = objectiveDraft.trim();
    if (next !== (objective ?? "")) onObjectiveChange(next || null);
  };

  const hasProse = currentText.trim().length > 0;
  const objectiveText = objectiveDraft.trim();

  // The page's stored metadata (objective stamp, beat, edge sync hashes) — the source for the
  // staleness badges and the beat editor. Refetched on page change and when a generation finishes.
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [beatDraft, setBeatDraft] = useState("");
  const [beatBusy, setBeatBusy] = useState(false);
  const loadMeta = useCallback(async () => {
    const { data } = await supabase.from("pages").select("metadata").eq("id", pageId).maybeSingle();
    const m = (data?.metadata as PageMeta | null) ?? null;
    setMeta(m);
    setBeatDraft(m?.beat ?? "");
  }, [pageId]);
  useEffect(() => { void loadMeta(); }, [loadMeta, row?.status]);

  // Compare against the LIVE saved objective (the prop), not the possibly-lagging fetched copy.
  const liveMeta: PageMeta = { ...(meta ?? {}), objective: objective ?? undefined };
  const stale = isProseStale(liveMeta, hasProse);
  // Beat is out of sync when the objective moved after the beat was written from it.
  const beatStale = !!meta?.beat?.trim() && isEdgeStale(objective, meta.beat, meta.sync?.objective_beat);

  // Write a beat to the page (generated or hand-edited): merge into metadata + stamp the
  // objective→beat edge as reconciled with the current objective. Reads metadata fresh to avoid
  // clobbering a concurrently-persisted summary/prose stamp.
  const persistBeat = async (text: string) => {
    const { data } = await supabase.from("pages").select("metadata").eq("id", pageId).maybeSingle();
    const base = (data?.metadata as PageMeta | null) ?? {};
    const stamped = stampEdge({ ...base, beat: text }, "objective_beat", objectiveText, text);
    const { error } = await supabase.from("pages").update({ metadata: stamped }).eq("id", pageId);
    if (error) throw error;
    await loadMeta();
  };

  // Generate the beat from the page's objective (the objective→beat transform).
  const generateBeat = async () => {
    if (beatBusy || !objectiveText) return;
    commitObjective();
    setBeatBusy(true);
    try {
      const text = await objectiveToBeat(bookId, pageId, objectiveText);
      if (text) { await persistBeat(text); }
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't write the beat", description: String((e as Error)?.message ?? e) });
    } finally {
      setBeatBusy(false);
    }
  };

  // Persist a hand-edited beat on blur (reconciled with the current objective).
  const saveBeat = async () => {
    const next = beatDraft.trim();
    if (next === (meta?.beat ?? "").trim()) return;
    try { await persistBeat(next); }
    catch (e) { toast({ variant: "destructive", title: "Couldn't save the beat", description: String((e as Error)?.message ?? e) }); }
  };

  // Distill the beat FROM the prose (the upward transform): backfill a missing beat, or pull a
  // hand-rewritten page back up into its plan. Reconciles BOTH edges — the beat now represents this
  // objective and this prose — so the page reads in sync top to bottom.
  const distillBeat = async () => {
    if (beatBusy || !hasProse) return;
    commitObjective();
    setBeatBusy(true);
    try {
      const text = await proseToBeat(bookId, pageId, currentText);
      if (text) {
        const { data } = await supabase.from("pages").select("metadata").eq("id", pageId).maybeSingle();
        let m: PageMeta = { ...((data?.metadata as PageMeta | null) ?? {}), beat: text };
        m = stampEdge(m, "objective_beat", objectiveText, text);
        m = stampEdge(m, "beat_prose", text, currentText);
        delete m.prose_src_hash;
        const { error } = await supabase.from("pages").update({ metadata: m }).eq("id", pageId);
        if (error) throw error;
        await loadMeta();
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't distill the beat", description: String((e as Error)?.message ?? e) });
    } finally {
      setBeatBusy(false);
    }
  };

  // Distill the page OBJECTIVE up from its beat (beat→objective): pull a hand-edited beat into the
  // objective. Sets the objective via the host (its persistence owner), then stamps the objective_beat
  // edge as reconciled with the new objective + the beat it was distilled from.
  const distillObjective = async () => {
    const beat = (meta?.beat ?? "").trim();
    if (beatBusy || !beat) return;
    setBeatBusy(true);
    try {
      const next = await beatToObjective(bookId, pageId, beat);
      if (next) {
        // One owned write sets BOTH the objective and the reconciled objective_beat edge, so they
        // can't be split by a race. Done FIRST and awaited; then the host call updates parent state
        // (its merge-safe write re-reads this and preserves the sync stamp).
        const { data } = await supabase.from("pages").select("metadata").eq("id", pageId).maybeSingle();
        const m = stampEdge({ ...((data?.metadata as PageMeta | null) ?? {}), objective: next }, "objective_beat", next, beat);
        const { error } = await supabase.from("pages").update({ metadata: m }).eq("id", pageId);
        if (error) throw error;
        setObjectiveDraft(next);
        onObjectiveChange(next); // sync parent state (host persistence is now merge-safe)
        await loadMeta();
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't distill the objective", description: String((e as Error)?.message ?? e) });
    } finally {
      setBeatBusy(false);
    }
  };

  // Accept a revised objective (preserve path): persist via the host; the beat, generated from the
  // OLD objective, is left to go stale (objective_beat now mismatches) — surfaced + re-syncable.
  const acceptObjectiveRevision = async (proposed: string) => {
    setObjectiveDraft(proposed);
    onObjectiveChange(proposed);
  };

  // Accept a revised beat (preserve path): the beat still serves this objective, so stamp
  // objective_beat in-sync; the prose, from the OLD beat, is left to go stale (beat_prose mismatches).
  const acceptBeatRevision = async (proposed: string) => {
    await persistBeat(proposed);
  };

  // Start a generation task (write or revise). The result arrives as a 'ready' row.
  const start = async (mode: "write" | "revise", issues?: ReviseIssue[]) => {
    if (running) return;
    commitObjective();
    try {
      await startPageGen({ bookId, pageId, objective: objectiveText, mode, issues });
      refetch();
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't start the editor", description: String((e as Error)?.message ?? e) });
    }
  };

  // Empty page: generate the page's prose from its objective (review, then add).
  const createPage = () => {
    if (!objectiveText) return;
    void start("write");
  };

  // Re-create this page's prose from its plan (the beat when present, else the objective), replacing
  // the body. Routed through the durable revise flow (slow gen + resume) with a strong rewrite note,
  // so it lands as a reviewable diff; applying re-stamps provenance.
  const rerenderFromObjective = () => {
    commitObjective();
    setOpen(true);
    const beat = beatDraft.trim();
    const note = beat
      ? `Rewrite this page's prose from scratch to realize this BEAT (its plan), fulfilling the objective. Replace the current prose; keep the book's voice and continuity.\nBEAT: ${beat}\nOBJECTIVE: ${objectiveText}`
      : `The objective for this page is: "${objectiveText}". Rewrite the prose from scratch to fulfil it, replacing the current prose, while keeping the book's voice and continuity.`;
    void start("revise", [{ section: "Plan", severity: "high", note }]);
  };

  // Page with prose: revise it against the editor's notes + the author's comment, then preview.
  const propose = () => {
    const issues: ReviseIssue[] = [...notes];
    const instr = instruction.trim();
    if (instr) issues.push({ section: "Author instruction", severity: "high", note: instr });
    if (issues.length === 0) {
      issues.push({
        section: "Polish",
        severity: "low",
        note: "Tighten and polish this page: sharpen the prose, cut redundancy, and improve flow without changing what happens.",
      });
    }
    void start("revise", issues);
  };

  // Apply a ready proposal: a create result is appended; a revise result replaces the body. Either
  // way mark the row applied so it doesn't re-open on the next load.
  const applyProposal = async () => {
    const text = proposedDraft.trim();
    if (!proposed || !row || !text) return;
    if (row.kind === "page_write") onAppendProse(text);
    else onApply(text);
    // The host re-stamps provenance from the current source on apply; mirror it locally so the "out
    // of sync" badge clears immediately rather than waiting on the async stamp + a refetch. Match the
    // beat-aware rule: beat present → stamp beat_prose, else the legacy objective hash.
    setMeta((m) => {
      const base = m ?? {};
      const beat = base.beat?.trim();
      if (beat) return { ...base, sync: { ...(base.sync ?? {}), beat_prose: { p: metaHash(beat), c: metaHash(text) } } };
      return { ...base, prose_src_hash: metaHash(objective ?? "") };
    });
    await supabase.from("book_generations").update({ status: "applied" }).eq("id", row.id);
    toast({
      title: row.kind === "page_write" ? "Page created" : "Revision applied",
      description: "Review the page and save when you're happy with it.",
    });
    setInstruction("");
    setOpen(false);
    refetch();
  };

  const discardProposal = async () => {
    if (row) await supabase.from("book_generations").update({ status: "dismissed" }).eq("id", row.id);
    refetch();
  };

  return (
    <div className="mx-8 mt-2 mb-6 border-t border-[hsl(var(--pv-border-soft))] pt-4">

      {/* ── LAYER · OBJECTIVE ── */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="pv-eyebrow">Objective for this page · author only</div>
        {pageType !== "section" && objectiveText && (
          <NodeReviser
            current={objectiveText}
            busy={beatBusy || running}
            onRevise={(instr) => reviseNode(bookId, pageId, "objective", objectiveText, instr)}
            onAccept={acceptObjectiveRevision}
          />
        )}
      </div>
      <input
        type="text"
        value={objectiveDraft}
        onChange={(e) => setObjectiveDraft(e.target.value)}
        onBlur={commitObjective}
        placeholder="Objective for this page — only you see this"
        title="Page objective (author-only — not shown to readers)"
        className="mt-1.5 w-full border-l-2 border-transparent bg-transparent pl-2 -ml-0.5 pv-serif text-[14.5px] italic leading-relaxed text-foreground placeholder:text-[hsl(var(--pv-text-faint))] focus:border-[hsl(var(--pv-border-soft))] focus:outline-none"
      />

      {pageType !== "section" && (
        <>
          {/* ── re-create between objective ↔ beat (both directions REPLACE the target) ── */}
          <Connector
            down={{ label: meta?.beat?.trim() ? "re-create beat" : "create beat", onClick: () => void generateBeat(), disabled: beatBusy || !objectiveText, busy: beatBusy }}
            up={meta?.beat?.trim() ? { label: "re-create objective", onClick: () => void distillObjective(), disabled: beatBusy } : undefined}
          />

          {/* ── LAYER · BEAT ── */}
          <div className="flex items-baseline justify-between gap-3">
            <div className="pv-eyebrow">Beat · the page's plan · author only</div>
            {beatDraft.trim() && (
              <NodeReviser
                current={beatDraft}
                busy={beatBusy || running}
                onRevise={(instr) => reviseNode(bookId, pageId, "beat", beatDraft.trim(), instr)}
                onAccept={acceptBeatRevision}
              />
            )}
          </div>
          <Textarea
            value={beatDraft}
            onChange={(e) => setBeatDraft(e.target.value)}
            onBlur={() => void saveBeat()}
            placeholder="One paragraph: what this page does, in order, to fulfil its objective — a plan, not prose."
            className="mt-2 min-h-[80px] pv-serif text-[14px] italic leading-relaxed"
            disabled={beatBusy}
          />
          {beatStale && (
            <p className="pv-serif mt-1.5 text-[13px] italic text-amber-600 dark:text-amber-500">
              The objective moved on — re-create this beat from the objective, or edit it to match.
            </p>
          )}

          {/* ── re-create between beat ↔ prose (both directions REPLACE the target) ── */}
          <Connector
            down={
              !hasProse
                ? { label: running ? "Writing…" : "create prose", onClick: createPage, disabled: !objectiveText || running, busy: running }
                : { label: "re-create prose", onClick: rerenderFromObjective, disabled: running || !objectiveText, busy: running && row?.kind !== "page_revise" }
            }
            up={hasProse ? { label: "re-create beat", onClick: () => void distillBeat(), disabled: beatBusy } : undefined}
          />

          {/* ── LAYER · PROSE ── */}
          <div className="pv-eyebrow">Prose · this page</div>
          {hasProse ? (
            <div className="mt-2 max-h-[200px] overflow-y-auto border-l-2 border-[hsl(var(--pv-border-soft))] pl-3 pv-serif text-[14px] leading-relaxed text-foreground whitespace-pre-wrap">
              {currentText}
            </div>
          ) : (
            <p className="mt-2 pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))]">
              No prose yet — use ↓ create prose above to generate it.
            </p>
          )}

          {/* Stale notice (informational only — re-render is always in the connector above). */}
          {hasProse && stale && (
            <p className="mt-1.5 pv-serif text-[13px] italic text-amber-600 dark:text-amber-500">
              Plan moved — this prose was written from an earlier objective.
            </p>
          )}

          {genError && !open && (
            <p className="mt-1.5 mb-0 pv-serif text-[13px] italic text-red-600 dark:text-red-400">{genError}</p>
          )}

          {/* Empty page: ready draft to review and add. */}
          {!hasProse && proposed && row?.kind === "page_write" && (
            <div className="space-y-3">
              <div className="pv-eyebrow">Proposed prose</div>
              <Textarea
                value={proposedDraft}
                onChange={(e) => setProposedDraft(e.target.value)}
                className="min-h-[200px] pv-serif text-[14.5px] leading-relaxed"
              />
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={applyProposal}
                  disabled={!proposedDraft.trim()}
                  className="pv-serif text-[14px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50"
                >
                  Add to page →
                </button>
                <button
                  type="button"
                  onClick={discardProposal}
                  className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))] transition-colors hover:text-foreground"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Page with prose: revise (the preserve path). */}
          {hasProse && (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <div className="pv-eyebrow">
                  Revise this page ·{" "}
                  <span className="pv-serif text-[13px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-muted))]">
                    preserves content · AI · author only
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
                  title="Revise this page — preserves what's here, applies your change"
                >
                  {open ? "Hide" : notes.length ? `✎ Revise · ${notes.length} ${notes.length === 1 ? "note" : "notes"}` : "✎ Revise"}
                </button>
              </div>

              {open && (
                <div className="mt-4 space-y-4">
                  {notes.length > 0 ? (
                    <div className="space-y-2">
                      <div className="pv-eyebrow">The editor's notes on this page</div>
                      {notes.map((n, i) => (
                        <div key={i} className="pv-serif text-[14px] leading-relaxed">
                          <p className="text-foreground">
                            <span className={`${SEV_TONE[n.severity]} font-medium`}>{n.severity}</span>{" "}
                            <span className="text-[hsl(var(--pv-text-faint))]">({n.section})</span> — {n.note}
                          </p>
                          {n.suggestion && <p className="mt-0.5 text-[hsl(var(--pv-text-muted))]">→ {n.suggestion}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="pv-serif text-[14px] italic leading-relaxed text-[hsl(var(--pv-text-muted))]">
                      No editor's notes flag this page. You can still give an instruction below, or revise to
                      polish.
                    </p>
                  )}

                  {!proposed && (
                    <div className="space-y-2">
                      <Textarea
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="Optional: tell the editor what to focus on for this page…"
                        className="min-h-[64px] text-[14px]"
                        disabled={running}
                      />
                      <button
                        type="button"
                        onClick={propose}
                        disabled={running}
                        className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground disabled:opacity-50"
                      >
                        {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {running ? "The editor is revising…" : "Propose a revision →"}
                      </button>
                    </div>
                  )}

                  {genError && (
                    <p className="pv-serif text-[14px] leading-relaxed text-red-600 dark:text-red-400">{genError}</p>
                  )}

                  {proposed && row?.kind === "page_revise" && (
                    <div className="space-y-3">
                      <div className="pv-eyebrow">Proposed changes</div>
                      <div className="overflow-x-auto rounded-lg border border-[hsl(var(--pv-border-soft))] text-[13px]">
                        <ReactDiffViewer
                          oldValue={currentText}
                          newValue={proposedDraft}
                          splitView={false}
                          compareMethod={DiffMethod.WORDS}
                          useDarkTheme={false}
                          styles={diffStyles}
                          hideLineNumbers
                          showDiffOnly={false}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="pv-eyebrow">Edit before applying</div>
                        <Textarea
                          value={proposedDraft}
                          onChange={(e) => setProposedDraft(e.target.value)}
                          className="min-h-[200px] pv-serif text-[14.5px] leading-relaxed"
                        />
                      </div>

                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={applyProposal}
                          disabled={!proposedDraft.trim()}
                          className="pv-serif text-[14px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50"
                        >
                          Apply to page →
                        </button>
                        <button
                          type="button"
                          onClick={propose}
                          className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
                        >
                          Re-propose
                        </button>
                        <button
                          type="button"
                          onClick={discardProposal}
                          className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))] transition-colors hover:text-foreground"
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
