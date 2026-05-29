import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import { buildDoc } from "@/lib/inlineMarkdown";
import { VersionService } from "@/services/VersionService";
import { groupByPage, type FixIssue } from "./ApplyEditorNotes";
import type { EvalResult } from "./BookEvaluationSection";

// Same dual backend as the rest of the AI features: local bridge in dev, edge in prod.
const BRIDGE = import.meta.env.VITE_EVAL_BRIDGE_URL as string | undefined;

const MAX_ATTEMPTS = 3; // 1 try + 2 retries
const RETRY_BASE_MS = 1000;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// The revision plan (mirrors supabase/functions/replan-from-notes output).
interface PlanPage {
  ref: number | null; // existing page id, or null for an added page
  op: "keep" | "revise" | "retarget" | "add";
  pageType: "section" | "text";
  title: string;
  objective: string;
  rebuild?: "rewrite" | "revise"; // retarget only
  why?: string;
}
interface RevisionPlan {
  summary: string;
  pages: PlanPage[]; // the new book, in final reading order
  deletes: { ref: number; why?: string }[];
}

const OP_LABEL: Record<PlanPage["op"], string> = {
  keep: "keep",
  revise: "revise prose",
  retarget: "new objective",
  add: "new page",
};
const OP_TONE: Record<PlanPage["op"], string> = {
  keep: "text-[hsl(var(--pv-text-faint))]",
  revise: "text-amber-600 dark:text-amber-500",
  retarget: "text-amber-600 dark:text-amber-500",
  add: "text-[hsl(var(--pv-accent))]",
};

interface Progress {
  done: number;
  total: number;
  phase: string;
  retrying?: number;
}

// A page whose objective changed but should be revised (not rewritten) gets a synthetic
// instruction so generate-unit's revise mode knows to adapt the prose to the new objective.
function reviseIssues(notes: FixIssue[] | undefined, objective: string, retargeted: boolean): FixIssue[] {
  const base = notes ?? [];
  if (retargeted) {
    return [
      {
        section: "Structure",
        severity: "high",
        note: `The page's objective has changed to: "${objective}". Revise the existing prose to fulfill the new objective while preserving the book's voice and continuity.`,
      },
      ...base,
    ];
  }
  return base.length
    ? base
    : [{ section: "Prose", severity: "medium", note: "Revise this page to address the editor's concerns and tighten the prose." }];
}

/**
 * v2 — structural revision. Turns the editor's evaluation into a revision plan (the
 * objective-tree diff), lets the author review it, then on confirm rebuilds the book:
 * archive deletes → create adds → retarget objectives → reorder → regenerate prose for
 * changed/new pages in final order. Snapshots a version first; everything lands as drafts.
 */
export function ReviseStructure({ bookId, result, onApplied }: { bookId: number; result: EvalResult; onApplied?: () => void }) {
  const { toast } = useToast();
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<RevisionPlan | null>(null);
  const [open, setOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  const generatePlan = async () => {
    try {
      setPlanning(true);
      let data: RevisionPlan;
      if (BRIDGE) {
        const r = await fetch(`${BRIDGE}/replan/${bookId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ evaluation: result }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        data = d as RevisionPlan;
      } else {
        const { data: fnData, error } = await supabase.functions.invoke("replan-from-notes", {
          body: { bookId, evaluation: result },
        });
        if (error) throw error;
        if ((fnData as { error?: string })?.error) throw new Error((fnData as { error: string }).error);
        data = fnData as RevisionPlan;
      }
      if (!data?.pages?.length) throw new Error("No revision plan returned.");
      setPlan(data);
      setOpen(true);
    } catch (e) {
      toast({ title: "Couldn't plan the revision", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setPlanning(false);
    }
  };

  // Generate + persist one page's prose (write or revise mode), via bridge or edge.
  const buildPage = async (task: { id: number; mode: "write" | "revise"; objective: string; issues?: FixIssue[]; title: string }) => {
    const body: Record<string, unknown> = { bookId, pageId: task.id, level: "page", mode: task.mode, objective: task.objective };
    if (task.mode === "revise") body.issues = task.issues;
    let text: string;
    if (BRIDGE) {
      const r = await fetch(`${BRIDGE}/unit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      text = String(d.text ?? "").trim();
    } else {
      const { data, error } = await supabase.functions.invoke("generate-unit", { body });
      if (error) throw error;
      text = String(data?.text ?? "").trim();
    }
    if (text) {
      const { error: upErr } = await supabase.from("pages").update({ content: buildDoc(task.title, text) }).eq("id", task.id);
      if (upErr) throw upErr;
    }
  };

  const build = async () => {
    if (!plan) return;
    try {
      setBuilding(true);

      // 1. Restore point before any mutation.
      setProgress({ done: 0, total: 0, phase: "Saving a version…" });
      const [hasChanges, latest] = await Promise.all([
        VersionService.hasUncommittedChanges(bookId),
        VersionService.getLatestVersion(bookId),
      ]);
      if (hasChanges || !latest) {
        await VersionService.createCommit(bookId, "Snapshot before revising structure from notes");
      }

      // 2. Archive deletes (reversible; they leave the active set).
      if (plan.deletes.length) {
        setProgress({ done: 0, total: 0, phase: "Removing pages…" });
        const { error } = await supabase.from("pages").update({ archived: true }).in("id", plan.deletes.map((d) => d.ref));
        if (error) throw error;
      }

      // 3. Create added pages → resolve each "add" entry to a concrete id.
      setProgress({ done: 0, total: 0, phase: "Creating new pages…" });
      const addedIds = new Map<number, number>(); // plan.pages index → new page id
      for (let i = 0; i < plan.pages.length; i++) {
        const p = plan.pages[i];
        if (p.op !== "add") continue;
        const { data: newPage, error } = await supabase.rpc("create_next_page", { p_book_id: bookId }).select().single();
        if (error) throw error;
        const id = (newPage as { id: number }).id;
        const update: Record<string, unknown> = { title: p.title, page_type: p.pageType };
        if (p.objective) update.metadata = { objective: p.objective };
        const { error: upErr } = await supabase.from("pages").update(update).eq("id", id);
        if (upErr) throw upErr;
        addedIds.set(i, id);
      }

      // 4. Retargets — set the new objective; drop the stale summary (prose will change).
      setProgress({ done: 0, total: 0, phase: "Updating objectives…" });
      for (const p of plan.pages) {
        if (p.op !== "retarget" || p.ref == null) continue;
        const { data: cur } = await supabase.from("pages").select("metadata").eq("id", p.ref).maybeSingle();
        const meta = { ...((cur?.metadata as Record<string, unknown>) ?? {}), objective: p.objective };
        delete (meta as { summary?: unknown }).summary;
        const { error } = await supabase.from("pages").update({ metadata: meta }).eq("id", p.ref);
        if (error) throw error;
      }

      // 5. Reorder to the plan's order (two-phase to dodge the unique page_index constraint).
      setProgress({ done: 0, total: 0, phase: "Reordering…" });
      const finalOrder = plan.pages
        .map((p, i) => (p.op === "add" ? addedIds.get(i) : p.ref))
        .filter((x): x is number => x != null);
      for (const id of finalOrder) {
        const { error } = await supabase.from("pages").update({ page_index: -(id + 10000) }).eq("id", id);
        if (error) throw error;
      }
      for (let i = 0; i < finalOrder.length; i++) {
        const { error } = await supabase.from("pages").update({ page_index: i }).eq("id", finalOrder[i]);
        if (error) throw error;
      }
      await supabase.from("books").update({ objectives_enabled: true }).eq("id", bookId);

      // 6. Regenerate prose for changed/new TEXT pages, in final reading order so the
      //    cascade feeds each freshly-written page forward into the next.
      const notesByPage = groupByPage(result);
      const tasks: Array<{ id: number; mode: "write" | "revise"; objective: string; issues?: FixIssue[]; title: string }> = [];
      for (let i = 0; i < plan.pages.length; i++) {
        const p = plan.pages[i];
        if (p.pageType === "section" || p.op === "keep") continue;
        const id = p.op === "add" ? addedIds.get(i)! : p.ref!;
        if (p.op === "add" || (p.op === "retarget" && p.rebuild !== "revise")) {
          if (!p.objective) continue; // nothing to write from; leave the page empty for the author
          tasks.push({ id, mode: "write", objective: p.objective, title: p.title });
        } else {
          // revise, or retarget with rebuild="revise"
          tasks.push({
            id,
            mode: "revise",
            objective: p.objective,
            issues: reviseIssues(notesByPage.get(id)?.issues, p.objective, p.op === "retarget"),
            title: p.title,
          });
        }
      }

      let failures = 0;
      setProgress({ done: 0, total: tasks.length, phase: "Writing pages…" });
      for (let i = 0; i < tasks.length; i++) {
        let ok = false;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
          try {
            await buildPage(tasks[i]);
            ok = true;
          } catch (e) {
            console.error(`revise-structure: page ${tasks[i].id} attempt ${attempt}/${MAX_ATTEMPTS} failed`, e);
            if (attempt < MAX_ATTEMPTS) {
              setProgress({ done: i, total: tasks.length, phase: "Writing pages…", retrying: attempt });
              await sleep(RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 250);
            }
          }
        }
        if (!ok) failures++;
        setProgress({ done: i + 1, total: tasks.length, phase: "Writing pages…" });
      }

      toast({
        title: failures ? "Restructured with some failures" : "Book restructured",
        description:
          `${tasks.length - failures} of ${tasks.length} page${tasks.length === 1 ? "" : "s"} rebuilt` +
          `${failures ? ` (${failures} failed)` : ""}. Review the changes under “View drafts”, then save a version to keep — or revert to discard.`,
        variant: failures ? "destructive" : undefined,
      });
      setOpen(false);
      setPlan(null);
      onApplied?.();
    } catch (e) {
      toast({ title: "Couldn't apply the revision", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setBuilding(false);
      setProgress(null);
    }
  };

  const counts = plan
    ? plan.pages.reduce(
        (acc, p) => {
          acc[p.op]++;
          return acc;
        },
        { keep: 0, revise: 0, retarget: 0, add: 0 } as Record<PlanPage["op"], number>
      )
    : null;
  const changeCount = counts ? counts.revise + counts.retarget + counts.add + (plan?.deletes.length ?? 0) : 0;

  return (
    <div className="rounded-xl border border-[hsl(var(--pv-border-soft))] px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="pv-eyebrow">Revise the structure</div>
        <button
          type="button"
          onClick={generatePlan}
          disabled={planning || building}
          className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground disabled:opacity-60"
        >
          {planning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {planning ? "Planning…" : "Plan a revision →"}
        </button>
      </div>
      <p className="pv-serif mt-1.5 text-[13.5px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
        Acts on the structural notes: proposes a new objective plan — adding, retargeting, reordering, or
        cutting pages — for you to review, then rebuilds the affected pages. Saves a version first; changes land in drafts.
      </p>

      <Dialog open={open} onOpenChange={(v) => !building && setOpen(v)}>
        <DialogContent className="max-w-2xl max-h-[82vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Review the revision plan</DialogTitle>
            <DialogDescription>
              {plan?.summary}
            </DialogDescription>
          </DialogHeader>

          {counts && (
            <div className="pv-mono flex flex-wrap gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">
              <span>{counts.add} new</span>
              <span>{counts.retarget} retargeted</span>
              <span>{counts.revise} revised</span>
              <span>{plan?.deletes.length ?? 0} deleted</span>
              <span>{counts.keep} kept</span>
            </div>
          )}

          <div className="-mx-2 flex-1 space-y-1 overflow-y-auto px-2">
            {plan?.pages.map((p, i) => (
              <div key={i} className={p.pageType === "section" ? "pt-2" : "pl-3"}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`pv-serif text-[14px] ${p.pageType === "section" ? "font-semibold" : ""} text-foreground`}>
                    {p.pageType === "section" ? "# " : ""}{p.title || "(untitled)"}
                  </span>
                  <span className={`pv-mono shrink-0 text-[10px] uppercase tracking-[0.14em] ${OP_TONE[p.op]}`}>
                    {OP_LABEL[p.op]}{p.op === "retarget" && p.rebuild ? ` · ${p.rebuild}` : ""}
                  </span>
                </div>
                {(p.op === "retarget" || p.op === "add") && p.objective && (
                  <div className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-muted))]">◎ {p.objective}</div>
                )}
                {p.why && <div className="pv-serif text-[12.5px] leading-snug text-[hsl(var(--pv-text-faint))]">{p.why}</div>}
              </div>
            ))}

            {(plan?.deletes.length ?? 0) > 0 && (
              <div className="mt-3 border-t border-[hsl(var(--pv-border-soft))] pt-2">
                <div className="pv-eyebrow mb-1">Deleted (archived — reversible)</div>
                {plan?.deletes.map((d) => (
                  <div key={d.ref} className="pv-serif text-[12.5px] text-[hsl(var(--pv-text-faint))]">
                    · page {d.ref}{d.why ? ` — ${d.why}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
              {building && progress
                ? progress.total
                  ? progress.retrying
                    ? `${progress.phase} retrying ${progress.done + 1}/${progress.total}`
                    : `${progress.phase} ${progress.done}/${progress.total}`
                  : progress.phase
                : `${changeCount} change${changeCount === 1 ? "" : "s"} · rebuilds prose for changed pages`}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={building}>Cancel</Button>
              <Button onClick={build} disabled={building || changeCount === 0}>
                {building ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {building ? "Building…" : "Build"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
