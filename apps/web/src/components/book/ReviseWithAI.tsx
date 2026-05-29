import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import type { EvalResult, Severity } from "./BookEvaluationSection";

// Same dual backend as the rest of the AI features: local bridge in dev, edge in prod.
const BRIDGE = import.meta.env.VITE_EVAL_BRIDGE_URL as string | undefined;

const MAX_ATTEMPTS = 3; // 1 try + 2 retries
const RETRY_BASE_MS = 1000;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ── Types (the revision plan mirrors replan-from-notes; the row mirrors the migration) ──
interface FixIssue {
  section: string;
  severity: Severity;
  note: string;
  evidence?: string;
  suggestion?: string;
}
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
  pages: PlanPage[];
  deletes: { ref: number; why?: string }[];
}
interface ProseTask {
  id: number; // resolved page id
  planIndex: number;
  title: string;
  mode: "write" | "revise";
  objective: string;
  why?: string;
  issues?: FixIssue[];
  state: "pending" | "writing" | "done" | "failed";
  changed?: string; // a short, honest "what this did" label
}
interface Progress {
  structureDone: boolean;
  addedIds: Record<number, number>; // planIndex → new page id (so resume never re-adds)
  tasks: ProseTask[];
  done: number;
  total: number;
  phase?: string; // transient label during the structural phase
}
type RevStatus = "planning" | "awaiting_review" | "building" | "done" | "cancelled" | "error";
interface RevisionRow {
  id: number;
  book_id: number;
  status: RevStatus;
  source: "prompt" | "evaluation";
  instruction: string | null;
  evaluation: EvalResult | null;
  plan: RevisionPlan | null;
  progress: Progress | null;
  version_id: number | null;
  cancel_requested: boolean;
  error: string | null;
}

const ROW_COLS = "id, book_id, status, source, instruction, evaluation, plan, progress, version_id, cancel_requested, error";
const ACTIVE: RevStatus[] = ["planning", "awaiting_review", "building"];

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
const TASK_TONE: Record<ProseTask["state"], string> = {
  pending: "text-[hsl(var(--pv-text-faint))]",
  writing: "text-[hsl(var(--pv-accent))]",
  done: "text-[hsl(var(--pv-text-muted))]",
  failed: "text-red-600 dark:text-red-400",
};

// The editor's page-anchored notes, grouped by target page (for revise tasks).
function groupByPage(result: EvalResult): Map<number, FixIssue[]> {
  const byPage = new Map<number, FixIssue[]>();
  for (const section of result.sections) {
    for (const issue of section.issues ?? []) {
      const id = issue.page_ref?.id;
      if (id == null) continue;
      const list = byPage.get(id) ?? [];
      list.push({
        section: section.title,
        severity: issue.severity,
        note: issue.note,
        evidence: issue.evidence,
        suggestion: issue.suggestion,
      });
      byPage.set(id, list);
    }
  }
  return byPage;
}

// A retargeted page revised (not rewritten) gets a synthetic note so generate-unit's revise
// mode adapts the prose to the new objective; a plain revise with no notes gets a tighten note.
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

export interface RevisionPrefill {
  instruction?: string;
  evaluation?: EvalResult;
}

/**
 * Revise with AI — one durable, resumable surface for asking the AI to change the book.
 *
 * The author types an instruction (or hands over the editor's notes); the architect proposes
 * a plan (what changes, and why, per page); the author reviews and builds. The whole task
 * lives in a `book_revisions` row watched over Realtime, so closing the tab never loses work:
 * completed pages are persisted as drafts, `progress` records what's done, and reopening the
 * book resumes from the first unfinished page. A version is snapshotted before any mutation.
 */
export function ReviseWithAI({
  bookId,
  prefill,
  onPrefillConsumed,
  onApplied,
}: {
  bookId: number;
  prefill?: RevisionPrefill | null;
  onPrefillConsumed?: () => void;
  onApplied?: () => void;
}) {
  const { toast } = useToast();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mounted = useRef(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const busyRef = useRef(false); // this tab is actively driving planning/build

  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<RevisionRow | null>(null);
  const [instruction, setInstruction] = useState("");
  const [attachedEval, setAttachedEval] = useState<EvalResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const patch = async (id: number, fields: Partial<RevisionRow>) => {
    const { error } = await supabase.from("book_revisions").update(fields).eq("id", id);
    if (error) throw error;
  };

  // ── Load the latest revision for this book + subscribe to it over Realtime ──
  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    supabase
      .from("book_revisions")
      .select(ROW_COLS)
      .eq("book_id", bookId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!mounted.current) return;
        setRow((data as RevisionRow | null) ?? null);
        setLoading(false);
      });
    return () => {
      mounted.current = false;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [bookId]);

  // Watch the active row so other tabs / a reload reflect status + progress live. The driving
  // tab also setRow()s locally; Realtime echoes are idempotent.
  const activeId = row && ACTIVE.includes(row.status) ? row.id : null;
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (activeId == null) return;
    channelRef.current = supabase
      .channel(`book_revision_${activeId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "book_revisions", filter: `id=eq.${activeId}` },
        (payload) => {
          if (!mounted.current || busyRef.current) return; // our own writes already applied locally
          setRow((payload as unknown as { new: RevisionRow }).new);
        }
      )
      .subscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // A prefill from the editor's report: attach the evaluation, focus, scroll into view.
  useEffect(() => {
    if (!prefill) return;
    if (prefill.evaluation) setAttachedEval(prefill.evaluation);
    if (prefill.instruction) setInstruction((cur) => cur || prefill.instruction!);
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => textareaRef.current?.focus(), 300);
    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // ── Architect: build the revision plan ──
  const callArchitect = async (current: RevisionRow): Promise<RevisionPlan> => {
    const body = {
      bookId,
      evaluation: current.evaluation ?? undefined,
      instruction: current.instruction ?? undefined,
    };
    if (BRIDGE) {
      const r = await fetch(`${BRIDGE}/replan/${bookId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      return d as RevisionPlan;
    }
    const { data, error } = await supabase.functions.invoke("replan-from-notes", { body });
    if (error) throw error;
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data as RevisionPlan;
  };

  const runPlanning = async (current: RevisionRow) => {
    busyRef.current = true;
    setBusy(true);
    try {
      const plan = await callArchitect(current);
      if (!plan?.pages?.length) throw new Error("No revision plan returned.");
      await patch(current.id, { plan, status: "awaiting_review" });
      const next = { ...current, plan, status: "awaiting_review" as const };
      setRow(next);
      setReviewOpen(true);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      await patch(current.id, { status: "error", error: msg }).catch(() => {});
      setRow((r) => (r ? { ...r, status: "error", error: msg } : r));
      toast({ title: "Couldn't plan the revision", description: msg, variant: "destructive" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const startRevision = async () => {
    const instr = instruction.trim();
    if (!instr && !attachedEval) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("book_revisions")
        .insert({
          book_id: bookId,
          status: "planning",
          source: attachedEval ? "evaluation" : "prompt",
          instruction: instr || null,
          evaluation: attachedEval ?? null,
        })
        .select(ROW_COLS)
        .single();
      if (error) throw error;
      const current = data as RevisionRow;
      setRow(current);
      setInstruction("");
      setAttachedEval(null);
      busyRef.current = false; // runPlanning re-acquires
      await runPlanning(current);
    } catch (e) {
      busyRef.current = false;
      setBusy(false);
      toast({ title: "Couldn't start the revision", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  // ── Generate + persist one page's prose (write or revise mode) ──
  const buildPage = async (task: ProseTask) => {
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

  // ── The build cascade — idempotent + resumable off `progress` ──
  const runBuild = async (start: RevisionRow) => {
    if (!start.plan) return;
    busyRef.current = true;
    setBusy(true);
    let current = start;
    try {
      let progress: Progress = current.progress ?? { structureDone: false, addedIds: {}, tasks: [], done: 0, total: 0 };
      let versionId = current.version_id;

      if (!progress.structureDone) {
        // 1. Restore point before any mutation.
        progress = { ...progress, phase: "Saving a version…" };
        await patch(current.id, { progress });
        setRow((r) => (r ? { ...r, progress } : r));
        if (versionId == null) {
          const [hasChanges, latest] = await Promise.all([
            VersionService.hasUncommittedChanges(bookId),
            VersionService.getLatestVersion(bookId),
          ]);
          if (hasChanges || !latest) {
            versionId = await VersionService.createCommit(bookId, "Snapshot before AI revision");
            await patch(current.id, { version_id: versionId });
          }
        }

        // 2. Archive deletes (reversible).
        if (current.plan.deletes.length) {
          progress = { ...progress, phase: "Removing pages…" };
          await patch(current.id, { progress });
          setRow((r) => (r ? { ...r, progress } : r));
          const { error } = await supabase.from("pages").update({ archived: true }).in("id", current.plan.deletes.map((d) => d.ref));
          if (error) throw error;
        }

        // 3. Create added pages (idempotent: skip indices already resolved in addedIds).
        progress = { ...progress, phase: "Creating new pages…" };
        await patch(current.id, { progress });
        setRow((r) => (r ? { ...r, progress } : r));
        const addedIds: Record<number, number> = { ...progress.addedIds };
        for (let i = 0; i < current.plan.pages.length; i++) {
          const p = current.plan.pages[i];
          if (p.op !== "add" || addedIds[i] != null) continue;
          const { data: newPage, error } = await supabase.rpc("create_next_page", { p_book_id: bookId }).select().single();
          if (error) throw error;
          const id = (newPage as { id: number }).id;
          const update: Record<string, unknown> = { title: p.title, page_type: p.pageType };
          if (p.objective) update.metadata = { objective: p.objective };
          const { error: upErr } = await supabase.from("pages").update(update).eq("id", id);
          if (upErr) throw upErr;
          addedIds[i] = id;
          progress = { ...progress, addedIds };
          await patch(current.id, { progress }); // persist incrementally so resume never re-adds
        }

        // 4. Retargets — set the new objective; drop the stale summary.
        progress = { ...progress, phase: "Updating objectives…" };
        await patch(current.id, { progress });
        setRow((r) => (r ? { ...r, progress } : r));
        for (const p of current.plan.pages) {
          if (p.op !== "retarget" || p.ref == null) continue;
          const { data: cur } = await supabase.from("pages").select("metadata").eq("id", p.ref).maybeSingle();
          const meta = { ...((cur?.metadata as Record<string, unknown>) ?? {}), objective: p.objective };
          delete (meta as { summary?: unknown }).summary;
          const { error } = await supabase.from("pages").update({ metadata: meta }).eq("id", p.ref);
          if (error) throw error;
        }

        // 5. Reorder (two-phase to dodge the unique page_index constraint).
        progress = { ...progress, phase: "Reordering…" };
        await patch(current.id, { progress });
        setRow((r) => (r ? { ...r, progress } : r));
        const finalOrder = current.plan.pages
          .map((p, i) => (p.op === "add" ? addedIds[i] : p.ref))
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

        // Build the prose task list (in final reading order so the cascade flows forward).
        const notesByPage = current.evaluation ? groupByPage(current.evaluation) : new Map<number, FixIssue[]>();
        const tasks: ProseTask[] = [];
        for (let i = 0; i < current.plan.pages.length; i++) {
          const p = current.plan.pages[i];
          if (p.pageType === "section" || p.op === "keep") continue;
          const id = p.op === "add" ? addedIds[i] : p.ref;
          if (id == null) continue;
          if (p.op === "add" || (p.op === "retarget" && p.rebuild !== "revise")) {
            if (!p.objective) continue; // nothing to write from; leave it for the author
            tasks.push({
              id, planIndex: i, title: p.title, mode: "write", objective: p.objective, why: p.why,
              state: "pending", changed: p.op === "add" ? "New page written." : "Rewritten for the new objective.",
            });
          } else {
            tasks.push({
              id, planIndex: i, title: p.title, mode: "revise", objective: p.objective, why: p.why,
              issues: reviseIssues(notesByPage.get(id), p.objective, p.op === "retarget"),
              state: "pending", changed: p.op === "retarget" ? "Revised for the new objective." : "Revised to address the notes.",
            });
          }
        }
        progress = { structureDone: true, addedIds, tasks, done: 0, total: tasks.length, phase: undefined };
        await patch(current.id, { progress });
        current = { ...current, version_id: versionId, progress };
        setRow(current);
      }

      // 6. Prose cascade — resume skips pages already done; checks cancel between pages.
      const tasks = [...progress.tasks];
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].state === "done") continue;

        const { data: fresh } = await supabase.from("book_revisions").select("cancel_requested").eq("id", current.id).maybeSingle();
        if ((fresh as { cancel_requested?: boolean } | null)?.cancel_requested) {
          await patch(current.id, { status: "cancelled" });
          setRow((r) => (r ? { ...r, status: "cancelled" } : r));
          toast({ title: "Revision cancelled", description: "Completed pages are kept in your drafts. Re-run or revert when you're ready." });
          return;
        }

        tasks[i] = { ...tasks[i], state: "writing" };
        progress = { ...progress, tasks: [...tasks] };
        await patch(current.id, { progress });
        setRow((r) => (r ? { ...r, progress } : r));

        let ok = false;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
          try {
            await buildPage(tasks[i]);
            ok = true;
          } catch (e) {
            console.error(`revise-with-ai: page ${tasks[i].id} attempt ${attempt}/${MAX_ATTEMPTS} failed`, e);
            if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 250);
          }
        }
        tasks[i] = { ...tasks[i], state: ok ? "done" : "failed" };
        progress = { ...progress, tasks: [...tasks], done: tasks.filter((t) => t.state === "done").length };
        await patch(current.id, { progress });
        setRow((r) => (r ? { ...r, progress } : r));
      }

      const failures = tasks.filter((t) => t.state === "failed").length;
      await patch(current.id, { status: "done" });
      setRow((r) => (r ? { ...r, status: "done" } : r));
      toast({
        title: failures ? "Revised with some failures" : "Revision complete",
        description:
          `${tasks.length - failures} of ${tasks.length} page${tasks.length === 1 ? "" : "s"} rebuilt` +
          `${failures ? ` (${failures} failed)` : ""}. Review the changes under “View drafts”, then save a version to keep — or revert to discard.`,
        variant: failures ? "destructive" : undefined,
      });
      onApplied?.();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      await patch(current.id, { status: "error", error: msg }).catch(() => {});
      setRow((r) => (r ? { ...r, status: "error", error: msg } : r));
      toast({ title: "Couldn't finish the revision", description: msg, variant: "destructive" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!row) return;
    setReviewOpen(false);
    await patch(row.id, { status: "building" }).catch(() => {});
    const next = { ...row, status: "building" as const };
    setRow(next);
    await runBuild(next);
  };

  const requestCancel = async () => {
    if (!row) return;
    await patch(row.id, { cancel_requested: true }).catch(() => {});
    setRow((r) => (r ? { ...r, cancel_requested: true } : r));
  };

  const discard = async () => {
    if (!row) return;
    setReviewOpen(false);
    await patch(row.id, { status: "cancelled" }).catch(() => {});
    setRow((r) => (r ? { ...r, status: "cancelled" } : r));
  };

  const resetForm = () => setRow(null);

  // ── Render ──
  const active = row && ACTIVE.includes(row.status);
  const counts = row?.plan
    ? row.plan.pages.reduce(
        (acc, p) => ((acc[p.op]++), acc),
        { keep: 0, revise: 0, retarget: 0, add: 0 } as Record<PlanPage["op"], number>
      )
    : null;
  const changeCount = counts ? counts.revise + counts.retarget + counts.add + (row?.plan?.deletes.length ?? 0) : 0;

  return (
    <section ref={rootRef} className="mt-8 border-t border-border pt-6">
      <div className="flex items-baseline justify-between gap-3">
        <div className="pv-eyebrow">
          Revise with AI ·{" "}
          <span className="pv-serif text-[13px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-muted))]">
            describe a change · author only
          </span>
        </div>
      </div>

      {loading && <p className="pv-serif mt-3 text-[14px] italic text-[hsl(var(--pv-text-faint))]">Checking…</p>}

      {/* The input form — shown when there's no active revision. */}
      {!loading && !active && (
        <div className="mt-3 space-y-3">
          {row && row.status !== "planning" && (
            <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
              {row.status === "done" && "Last revision complete — review it under “View drafts”."}
              {row.status === "cancelled" && "Last revision cancelled."}
              {row.status === "error" && `Last revision failed: ${row.error ?? "unknown error"}`}
            </p>
          )}
          <Textarea
            ref={textareaRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Describe the change you want — e.g. “Make chapter 3 darker, give the protagonist a real decision in the middle, and cut the subplot about the map.”"
            className="min-h-[88px] pv-serif text-[14.5px] leading-relaxed"
          />
          {attachedEval && (
            <div className="flex items-center gap-2">
              <span className="pv-mono rounded-full bg-[hsl(var(--pv-surface-2))] px-2.5 py-1 text-[10.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-muted))]">
                ◎ acting on the editor's notes
              </span>
              <button type="button" onClick={() => setAttachedEval(null)} className="text-[hsl(var(--pv-text-faint))] hover:text-foreground" aria-label="detach editor's notes">✕</button>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="pv-serif text-[12.5px] leading-relaxed text-[hsl(var(--pv-text-faint))]">
              The AI proposes a plan you review before anything changes. A version is saved first; results land in your drafts.
            </p>
            <Button onClick={startRevision} disabled={busy || (!instruction.trim() && !attachedEval)}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {busy ? "Planning…" : "Plan the revision →"}
            </Button>
          </div>
        </div>
      )}

      {/* Planning in flight. */}
      {!loading && active && row!.status === "planning" && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="pv-serif text-[15px] italic text-[hsl(var(--pv-text-muted))]">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Planning the revision…
          </p>
          {!busy && (
            <Button variant="ghost" onClick={() => runPlanning(row!)}>Resume</Button>
          )}
        </div>
      )}

      {/* Plan ready — review inline summary; the dialog holds the detail. */}
      {!loading && active && row!.status === "awaiting_review" && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="pv-serif text-[14.5px] leading-relaxed text-foreground">
            A revision plan is ready — {changeCount} change{changeCount === 1 ? "" : "s"} across the book.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={discard}>Discard</Button>
            <Button onClick={() => setReviewOpen(true)}>Review &amp; build</Button>
          </div>
        </div>
      )}

      {/* Building — live per-page status, survives reload, cancellable + resumable. */}
      {!loading && active && row!.status === "building" && row!.progress && (
        <BuildStatus
          progress={row!.progress}
          busy={busy}
          cancelRequested={row!.cancel_requested}
          onResume={() => runBuild(row!)}
          onCancel={requestCancel}
        />
      )}

      {/* Review dialog (also reachable from the inline "Review & build"). */}
      <Dialog open={reviewOpen} onOpenChange={(v) => !busy && setReviewOpen(v)}>
        <DialogContent className="max-w-2xl max-h-[82vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Review the revision plan</DialogTitle>
            <DialogDescription>{row?.plan?.summary}</DialogDescription>
          </DialogHeader>

          {counts && (
            <div className="pv-mono flex flex-wrap gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">
              <span>{counts.add} new</span>
              <span>{counts.retarget} retargeted</span>
              <span>{counts.revise} revised</span>
              <span>{row?.plan?.deletes.length ?? 0} deleted</span>
              <span>{counts.keep} kept</span>
            </div>
          )}

          <div className="-mx-2 flex-1 space-y-1 overflow-y-auto px-2">
            {row?.plan?.pages.map((p, i) => (
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

            {(row?.plan?.deletes.length ?? 0) > 0 && (
              <div className="mt-3 border-t border-[hsl(var(--pv-border-soft))] pt-2">
                <div className="pv-eyebrow mb-1">Deleted (archived — reversible)</div>
                {row?.plan?.deletes.map((d) => (
                  <div key={d.ref} className="pv-serif text-[12.5px] text-[hsl(var(--pv-text-faint))]">
                    · page {d.ref}{d.why ? ` — ${d.why}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
              {changeCount} change{changeCount === 1 ? "" : "s"} · rebuilds prose for changed pages
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={discard} disabled={busy}>Discard</Button>
              <Button onClick={approve} disabled={busy || changeCount === 0}>Build</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// Live build status — the per-page changelog the author watches (and can leave / resume).
function BuildStatus({
  progress,
  busy,
  cancelRequested,
  onResume,
  onCancel,
}: {
  progress: Progress;
  busy: boolean;
  cancelRequested: boolean;
  onResume: () => void;
  onCancel: () => void;
}) {
  const total = progress.total || progress.tasks.length;
  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="pv-serif text-[15px] italic text-[hsl(var(--pv-text-muted))]">
          {progress.structureDone
            ? <>Writing pages — {progress.done}/{total} done{busy ? "…" : ""}</>
            : <>{progress.phase ?? "Working…"}</>}
        </p>
        <div className="flex gap-2">
          {!busy && <Button variant="ghost" onClick={onResume}>Resume</Button>}
          <Button variant="ghost" onClick={onCancel} disabled={cancelRequested}>
            {cancelRequested ? "Stopping…" : "Cancel"}
          </Button>
        </div>
      </div>
      {progress.tasks.length > 0 && (
        <div className="space-y-1">
          {progress.tasks.map((t) => (
            <div key={t.id} className="flex items-baseline justify-between gap-3 pl-3">
              <span className="pv-serif text-[13.5px] text-foreground">
                {t.title || "(untitled)"}
                {t.why && <span className="ml-2 text-[hsl(var(--pv-text-faint))]">— {t.why}</span>}
              </span>
              <span className={`pv-mono shrink-0 text-[10px] uppercase tracking-[0.14em] ${TASK_TONE[t.state]}`}>
                {t.state === "writing" ? "writing…" : t.state === "done" ? "done" : t.state === "failed" ? "failed" : "queued"}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">
        You can leave this page — the work persists. Reopen the book to resume or cancel.
      </p>
    </div>
  );
}
