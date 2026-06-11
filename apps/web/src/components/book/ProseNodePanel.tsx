import { useCallback, useEffect, useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { ExternalLink, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { buildDoc } from "@/lib/inlineMarkdown";
import { stampProse } from "@/lib/planProvenance";
import { NodeLabel, RecreateButton, ReviseButton, diffStyles } from "./ladder-ui";

// ProseNodePanel — the prose layer, edited from the resolution map's node sheet WITHOUT opening the
// page. Prose is the heavy, durable node: re-create and revise both route through the same
// generate-page task the page workshop uses (resumable, watched over Realtime), then write
// pages.content directly via buildDoc — so the map can write a page's body with no editor mounted.
//
//   RE-CREATE (↓ from beat) — rewrite the whole page from its plan. REPLACES the body.
//   REVISE    (✎)           — nudge the prose with an instruction. PRESERVES, shows a diff.
//
// "Open page ↗" stays available for anyone who wants the full editor; the point is they don't HAVE to.

interface PageGenRow extends TaskRow {
  kind: "page_write" | "page_revise";
  result: { text?: string } | null;
  error: string | null;
}

// Kick off the durable page-generation task (dual backend), same contract as the page workshop.
async function startPageGen(body: Record<string, unknown>): Promise<void> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/page`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return;
  }
  const { error } = await supabase.functions.invoke("generate-page", { body });
  if (error) throw error;
}

export function ProseNodePanel({
  bookId, pageId, pageTitle, objective, beat, prose, onSaved, onOpenPage,
}: {
  bookId: number;
  pageId: number;
  pageTitle: string | null;
  objective: string;
  beat: string;
  prose: string;          // current prose as plain text ("" = empty page)
  onSaved: () => void;    // refresh the map after the body changes
  onOpenPage: () => void; // navigate to the full page editor
}) {
  const { toast } = useToast();
  const [instruction, setInstruction] = useState("");
  const [revising, setRevising] = useState(false);

  const hasProse = prose.trim().length > 0;

  // The durable generation task for THIS page. Watched over Realtime: a refresh resumes the loader,
  // and a finished proposal is still here to review.
  const { row, refetch } = useLatestTaskRow<PageGenRow>({
    table: "book_generations",
    bookId,
    match: { target_page_id: pageId, kind: ["page_write", "page_revise"] },
    activeStatuses: ["pending", "running"],
  });
  const running = row?.status === "pending" || row?.status === "running";
  const proposed = row?.status === "ready" ? (row.result?.text ?? "").trim() || null : null;
  const genError = row?.status === "error" ? row.error : null;

  const [draft, setDraft] = useState("");
  useEffect(() => { setDraft(proposed ?? ""); }, [row?.id, proposed]);

  const start = useCallback(async (mode: "write" | "revise", issues?: Array<{ section: string; severity: string; note: string }>) => {
    if (running) return;
    try {
      await startPageGen({ bookId, pageId, objective, mode, issues });
      refetch();
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't start", description: String((e as Error)?.message ?? e) });
    }
  }, [running, bookId, pageId, objective, refetch, toast]);

  // Re-create the prose from its plan (beat when present, else objective). REPLACES the body. Empty
  // page → a plain write; existing prose → a durable revise carrying a strong rewrite note.
  const recreate = () => {
    if (!hasProse) { void start("write"); return; }
    const b = beat.trim();
    const note = b
      ? `Rewrite this page's prose from scratch to realize this BEAT (its plan), fulfilling the objective. Replace the current prose; keep the book's voice and continuity.\nBEAT: ${b}\nOBJECTIVE: ${objective}`
      : `The objective for this page is: "${objective}". Rewrite the prose from scratch to fulfil it, replacing the current prose, while keeping the book's voice and continuity.`;
    void start("revise", [{ section: "Plan", severity: "high", note }]);
  };

  // Revise the prose with an instruction. PRESERVES what works.
  const propose = () => {
    const instr = instruction.trim();
    if (!instr) return;
    void start("revise", [{ section: "Author instruction", severity: "high", note: instr }]);
  };

  // Apply a ready proposal: write the page body directly (buildDoc), re-stamp prose provenance, and
  // mark the row applied so it doesn't re-open. The map refreshes via onSaved.
  const apply = async () => {
    const text = draft.trim();
    if (!proposed || !row || !text) return;
    try {
      const { error } = await supabase.from("pages").update({ content: buildDoc(pageTitle, text) }).eq("id", pageId);
      if (error) throw error;
      await stampProse(pageId, objective, text);
      await supabase.from("book_generations").update({ status: "applied" }).eq("id", row.id);
      toast({ title: hasProse ? "Prose replaced" : "Page written", description: "The page body was updated from here." });
      setInstruction("");
      setRevising(false);
      refetch();
      onSaved();
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't apply", description: String((e as Error)?.message ?? e) });
    }
  };

  const discard = async () => {
    if (row) await supabase.from("book_generations").update({ status: "dismissed" }).eq("id", row.id);
    refetch();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <NodeLabel>Prose</NodeLabel>
        <button
          type="button" onClick={onOpenPage}
          className="pv-serif inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
          title="Open the full page editor"
        >
          Open page <ExternalLink className="h-3 w-3" />
        </button>
      </div>

      {/* Current prose, read-only — so you can see what you're acting on without leaving the map. */}
      <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30 p-3">
        {hasProse ? (
          <p className="pv-serif whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">{prose}</p>
        ) : (
          <p className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-faint))]">This page has no prose yet.</p>
        )}
      </div>

      {/* No proposal pending: offer re-create (replace) + revise (preserve). */}
      {!proposed && !running && (
        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <RecreateButton dir="down" action={{ label: hasProse ? "re-create from plan" : "write prose", onClick: recreate, disabled: !objective }} />
            {hasProse && <ReviseButton onClick={() => setRevising((v) => !v)} label={revising ? "Cancel" : "Revise"} />}
          </div>
          {revising && hasProse && (
            <div className="space-y-2 rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 p-3">
              <Textarea
                value={instruction} onChange={(e) => setInstruction(e.target.value)} autoFocus
                placeholder="What should change? The rest of the page is preserved."
                className="min-h-[56px] text-[13.5px]"
              />
              <button type="button" onClick={propose} disabled={!instruction.trim()}
                className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50">
                Revise →
              </button>
            </div>
          )}
        </div>
      )}

      {running && (
        <p className="pv-serif inline-flex items-center gap-2 text-[13.5px] italic text-[hsl(var(--pv-text-muted))]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> The editor is writing…
          <span className="not-italic text-[hsl(var(--pv-text-faint))]">·</span>
          <button
            type="button"
            onClick={async () => {
              if (row) await supabase.from("book_generations").update({ status: "error", error: "Stopped by the author." }).eq("id", row.id);
              refetch();
            }}
            className="not-italic text-[hsl(var(--pv-text-faint))] underline-offset-2 hover:text-foreground hover:underline"
          >
            cancel
          </button>
        </p>
      )}

      {genError && <p className="pv-serif text-[13.5px] italic text-red-600 dark:text-red-400">{genError}</p>}

      {/* Ready proposal: review the change (diff for a revise, the draft for a fresh write), then apply. */}
      {proposed && (
        <div className="space-y-3">
          {hasProse ? (
            <div className="overflow-x-auto rounded-lg border border-[hsl(var(--pv-border-soft))] text-[13px]">
              <ReactDiffViewer oldValue={prose} newValue={draft} splitView={false}
                compareMethod={DiffMethod.WORDS} useDarkTheme={false} styles={diffStyles} hideLineNumbers showDiffOnly={false} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <div className="pv-eyebrow">Edit before applying</div>
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[200px] pv-serif text-[14.5px] leading-relaxed" />
          </div>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => void apply()} disabled={!draft.trim()}
              className="pv-serif text-[14px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50">
              {hasProse ? "Apply to page →" : "Add to page →"}
            </button>
            <button type="button" onClick={() => void discard()}
              className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))] transition-colors hover:text-foreground">
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
