import { useEffect, useState } from "react";
import { Sparkles, Loader2, X } from "lucide-react";
import { AnimatedEllipsis } from "./AnimatedEllipsis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AIActionRow } from "./AIActionRow";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { RunControls } from "./RunControls";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { stampEdge } from "@/lib/planProvenance";
import { transforms } from "@/lib/ladder";
import { NodeOptions } from "./ladder-ui";

interface ScaffoldPage {
  pageType: "section" | "text";
  title: string;
  objective?: string;
}
// A planned thread the scaffold proposes, anchored to pages by their index in pages[].
interface ScaffoldThread {
  name: string;
  description: string;
  setupPageIndex: number | null;
  payoffPageIndex: number | null;
  targetDistance: number | null;
}
interface Scaffold {
  structure: string;
  pages: ScaffoldPage[];
  threads?: ScaffoldThread[];
  // The self-critique the architect produced before revising the outline — shown to the author so the
  // plan-pressure is visible (what the editor pass caught).
  critique?: string;
}

interface ScaffoldGeneratorProps {
  bookId: number;
  /** Called after pages are created (so the host can refresh / enable the toggle in UI). */
  onCreated?: () => void;
}

interface ScaffoldRow extends TaskRow {
  result: Scaffold | null;
  error: string | null;
}

/**
 * G2 — generate a book's objective tree from its brief. Proposes a chapter/page scaffold
 * (titles + objectives, no prose), lets the author review it, then creates the pages with
 * their objectives set. Honors the thesis: the author reviews the plan before committing.
 *
 * The proposal is a durable book_generations task row (kind 'scaffold'), not React state: a
 * refresh resumes the loader if it's still designing, or re-opens the review dialog if a proposal
 * is waiting. Creating the pages marks the row 'applied'; cancelling marks it 'dismissed' — so it
 * doesn't keep re-opening.
 */
export function ScaffoldGenerator({ bookId, onCreated }: ScaffoldGeneratorProps) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [kicking, setKicking] = useState(false); // true between clicking Generate and the run row appearing
  const [reviseInstruction, setReviseInstruction] = useState("");
  const [revising, setRevising] = useState(false);
  const [showRevise, setShowRevise] = useState(false);

  const { row, refetch, stale } = useLatestTaskRow<ScaffoldRow>({
    table: "book_generations",
    bookId,
    match: { kind: "scaffold" },
    activeStatuses: ["pending", "running"],
    staleMs: 120_000,
  });

  const generating = row?.status === "pending" || row?.status === "running";
  const proposal = row?.status === "ready" ? row.result : null;

  // Editable copy of the proposal — the author revises titles/objectives and removes pages HERE,
  // before any pages are created (the dialog was previously a read-only preview). Seeded per row id,
  // so re-renders don't clobber in-progress edits; a refresh re-seeds from the durable row.
  const [draft, setDraft] = useState<Scaffold | null>(null);
  useEffect(() => {
    const p = row?.status === "ready" ? row.result : null;
    setDraft(p ? { structure: p.structure, pages: p.pages.map((x) => ({ ...x })), threads: (p.threads ?? []).map((t) => ({ ...t })) } : null);
  }, [row?.id, row?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const showReview = (!!proposal || creating) && !!draft;

  const updatePage = (i: number, patch: Partial<ScaffoldPage>) =>
    setDraft((d) => (d ? { ...d, pages: d.pages.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) } : d));

  // Apply a chosen objective option to a draft page, and persist the draft to the task row so a
  // refresh keeps it (same as the revise flow). Returns once persisted.
  const applyObjective = async (i: number, objective: string) => {
    const base = draft;
    if (!base) return;
    const next: Scaffold = { ...base, pages: base.pages.map((p, idx) => (idx === i ? { ...p, objective } : p)) };
    setDraft(next);
    if (row) {
      const { error } = await supabase.from("book_generations").update({ result: { ...next, critique: row.result?.critique } }).eq("id", row.id);
      if (error) throw new Error(error.message);
    }
  };

  // Drop a page and keep the planned threads' page-index anchors valid: an anchor at the deleted
  // index becomes null, anchors after it shift down by one.
  const deletePage = (i: number) =>
    setDraft((d) => {
      if (!d) return d;
      const remap = (idx: number | null) => (idx == null ? null : idx === i ? null : idx > i ? idx - 1 : idx);
      return {
        ...d,
        pages: d.pages.filter((_, idx) => idx !== i),
        threads: (d.threads ?? []).map((t) => ({ ...t, setupPageIndex: remap(t.setupPageIndex), payoffPageIndex: remap(t.payoffPageIndex) })),
      };
    });

  const generate = async () => {
    // Guard the gap between the click and the run row existing: until the row appears, `generating`
    // is still false, so without this a burst of clicks would spawn several scaffold runs.
    if (generating || kicking) return;
    setKicking(true);
    try {
      if (BRIDGE) {
        // Dev bridge writes the same book_generations row; we just kick it and watch the row.
        await bridgeFetch(`/spine-to-objectives/${bookId}`, { method: "POST" }).catch(() => {});
      } else {
        const { error } = await supabase.functions.invoke("spine-to-objectives", { body: { bookId } });
        if (error) throw error;
      }
      refetch();
    } catch (e) {
      toast({ title: "Couldn't generate outline", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setKicking(false);
    }
  };

  const dismiss = async () => {
    if (row) await supabase.from("book_generations").update({ status: "dismissed" }).eq("id", row.id);
    refetch();
  };

  const revise = async () => {
    const instr = reviseInstruction.trim();
    if (!instr || !draft || revising) return;
    setRevising(true);
    try {
      const body = { bookId, scaffold: draft, instruction: instr };
      let revised: Scaffold;
      if (BRIDGE) {
        const r = await bridgeFetch("/revise-scaffold", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        revised = d as Scaffold;
      } else {
        const { data, error } = await supabase.functions.invoke("revise-scaffold", { body });
        if (error) throw error;
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
        revised = data as Scaffold;
      }
      const next: Scaffold = {
        structure: revised.structure,
        pages: revised.pages.map((p) => ({ ...p })),
        threads: (revised.threads ?? []).map((t) => ({ ...t })),
      };
      setDraft(next);
      if (row) {
        await supabase.from("book_generations").update({
          result: { ...next, critique: row.result?.critique },
        }).eq("id", row.id);
      }
      setReviseInstruction(""); setShowRevise(false);
      toast({ title: "Outline revised", description: `${next.pages.length} pages — review the changes, then create when ready.` });
    } catch (e) {
      toast({ title: "Couldn't revise the outline", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setRevising(false);
    }
  };

  const create = async () => {
    if (!draft || !row) return;
    // The author may have edited/removed pages; create from the live draft, not the AI's original.
    // Kept 1:1 with draft.pages (removals go through the X button, which also remaps thread anchors),
    // so createdIds[index] still lines up with each thread's setup/payoff page index below.
    const pages = draft.pages.map((p) => ({ pageType: p.pageType, title: p.title.trim(), objective: (p.objective ?? "").trim() }));
    if (pages.length === 0) return;
    // Stacking scaffolds onto an already-populated book is how a book ends up with hundreds of
    // pages. Confirm before adding to a book that clearly already has content.
    const { count } = await supabase
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("book_id", bookId)
      .eq("archived", false);
    if (
      (count ?? 0) > 5 &&
      !window.confirm(`This book already has ${count} pages. Add ${pages.length} more from this outline?`)
    ) {
      return;
    }
    try {
      setCreating(true);
      // Claim the proposal up front: marking it 'applied' before creating any pages means a refresh
      // or second tab mid-create can't re-open this dialog and run the whole scaffold again (the
      // path that produced runaway page counts). A partial failure leaves a few pages to delete —
      // far better than a duplicated scaffold.
      await supabase.from("book_generations").update({ status: "applied" }).eq("id", row.id);
      // The spine each objective was derived from — used to stamp the spine→objective edge (C1 fix) so
      // an objective goes "stale" if the spine is later rewritten.
      const { data: bookRow } = await supabase.from("books").select("spine").eq("id", bookId).maybeSingle();
      const spineText = ((bookRow?.spine as { text?: string } | null)?.text ?? "").trim();
      // Create each page via the canonical RPC (handles page_index + valid defaults), then set its
      // title / type / objective. Track the created id at each page index so the planned threads can
      // be anchored to real page ids afterward.
      const createdIds: number[] = [];
      for (const page of pages) {
        const { data: newPage, error } = await supabase
          .rpc("create_next_page", { p_book_id: bookId })
          .select()
          .single();
        if (error) throw error;
        const newId = (newPage as { id: number }).id;
        createdIds.push(newId);
        const update: Record<string, unknown> = {
          title: page.title,
          page_type: page.pageType,
        };
        if (page.objective) update.metadata = stampEdge({ objective: page.objective }, "spine_objective", spineText, page.objective);
        const { error: upErr } = await supabase
          .from("pages")
          .update(update)
          .eq("id", newId);
        if (upErr) throw upErr;
      }

      // Persist the planned threads, mapping each page-index anchor to its created page id.
      const threadRows = (draft.threads ?? [])
        .filter((t) => t.name.trim())
        .map((t) => ({
          book_id: bookId,
          name: t.name.trim(),
          description: t.description || null,
          status: "planned",
          source: "ai",
          setup_page_id: t.setupPageIndex != null ? createdIds[t.setupPageIndex] ?? null : null,
          payoff_page_id: t.payoffPageIndex != null ? createdIds[t.payoffPageIndex] ?? null : null,
          target_distance: t.targetDistance,
        }));
      if (threadRows.length) {
        const { error: thErr } = await supabase.from("book_threads").insert(threadRows);
        if (thErr) throw thErr;
      }

      const threadNote = threadRows.length ? ` and ${threadRows.length} planned threads` : "";
      toast({ title: "Outline created", description: `${pages.length} pages added with objectives${threadNote}.` });
      setCreating(false);
      refetch();
      onCreated?.();
    } catch (e) {
      setCreating(false);
      toast({ title: "Couldn't create pages", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  return (
    <>
      <AIActionRow
        icon={<Sparkles className="h-4 w-4" />}
        title={generating ? <span>Designing<AnimatedEllipsis /></span> : "Generate outline from brief"}
        description="Propose the book's chapters and pages as objectives (no prose) — review, then create."
        onClick={generate}
        loading={generating || kicking}
      />
      <RunControls table="book_generations" row={row} stale={stale} onRestart={generate} refetch={refetch} />
      {row?.status === "error" && (
        <p className="px-5 pt-1 pv-serif text-[13px] italic text-red-600 dark:text-red-400">{row.error}</p>
      )}

      {showReview && (
        <div className="mt-3 rounded-lg border border-border bg-card space-y-3 p-4">
          <div>
            <p className="text-sm font-medium">Review &amp; edit the outline</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {draft?.structure ? `Structure: ${draft.structure}. ` : ""}
              {draft?.pages.length ?? 0} pages. Edit any title or objective, remove pages you don't want,
              then create. Creating sets each page's objective and turns on the objectives UI.
            </p>
          </div>

          {row?.result?.critique?.trim() && (
            <details className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <summary className="cursor-pointer select-none font-medium text-muted-foreground">
                What the editor pass caught (the outline was revised to address this)
              </summary>
              <pre className="mt-2 whitespace-pre-wrap pv-serif italic text-[hsl(var(--pv-text-faint))]">{row.result.critique.trim()}</pre>
            </details>
          )}

          <div className="space-y-3">
            {draft?.pages.map((p, i) => (
              p.pageType === "section" ? (
                <div key={i} className="group flex items-center gap-2 pt-4 first:pt-1">
                  <Input
                    value={p.title}
                    onChange={(e) => updatePage(i, { title: e.target.value })}
                    placeholder="Chapter / part title"
                    className="h-8 font-semibold"
                  />
                  <Button type="button" variant="ghost" size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-60 hover:!opacity-100"
                    onClick={() => deletePage(i)} aria-label="Remove">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div key={i} className="group relative rounded-md border border-border overflow-hidden">
                  <Input
                    value={p.title}
                    onChange={(e) => updatePage(i, { title: e.target.value })}
                    placeholder="Page title"
                    className="h-8 rounded-none border-0 border-b border-border focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <Textarea
                    value={p.objective ?? ""}
                    onChange={(e) => updatePage(i, { objective: e.target.value })}
                    placeholder="Objective — what this page must achieve (one sentence)"
                    rows={2}
                    className="rounded-none border-0 text-xs italic resize-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <div className="border-t border-border px-3 py-1.5">
                    <NodeOptions
                      busy={creating || revising}
                      onGenerate={() => transforms.objectiveOptionsDraft(bookId, draft, i)}
                      onAccept={(text) => applyObjective(i, text)}
                    />
                  </div>
                  <Button type="button" variant="ghost" size="icon"
                    className="absolute top-0.5 right-0.5 h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-60 hover:!opacity-100"
                    onClick={() => deletePage(i)} aria-label="Remove">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )
            ))}
          </div>

          {showRevise && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
              <Textarea
                value={reviseInstruction}
                onChange={(e) => setReviseInstruction(e.target.value)}
                placeholder='What should change? e.g. "cut the middle act to 8 pages" or "make the ending less neat"'
                rows={2}
                disabled={revising || creating}
                className="min-h-[56px] resize-none text-[13.5px]"
                autoFocus
              />
              <div className="mt-2 flex items-center gap-3">
                <button type="button" onClick={() => void revise()}
                  disabled={revising || creating || !reviseInstruction.trim()}
                  className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50">
                  {revising ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {revising ? "Revising…" : "Revise →"}
                </button>
                <button type="button" onClick={() => { setShowRevise(false); setReviseInstruction(""); }}
                  className="pv-serif text-[13px] italic text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            {!showRevise && (
              <button type="button" onClick={() => setShowRevise(true)} disabled={revising || creating}
                className="pv-serif text-[13px] italic text-muted-foreground hover:text-[hsl(var(--pv-accent))] transition-colors disabled:opacity-50 mr-auto">
                revise →
              </button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void dismiss()} disabled={creating}>Cancel</Button>
            <Button size="sm" onClick={create} disabled={creating || (draft?.pages.length ?? 0) === 0}>
              {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {creating ? "Creating…" : `Create ${draft?.pages.length ?? 0} pages`}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
