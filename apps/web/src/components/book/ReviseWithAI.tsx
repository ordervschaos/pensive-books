import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedEllipsis } from "./AnimatedEllipsis";
import { WorkingIndicator, WORKING_PHRASES } from "./WorkingIndicator";
import { NotifyWhenDone } from "./NotifyWhenDone";
import { notify as fireNotification } from "@/lib/notify";
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
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { VersionService } from "@/services/VersionService";
import type { EvalResult, Severity } from "./BookEvaluationSection";

// Same dual backend as the rest of the AI features: local bridge in dev, edge in prod.

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
  planOnly?: boolean; // outline-only revision: apply changes the plan and writes no prose
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
  plan_only: boolean;
  progress: Progress | null;
  version_id: number | null;
  cancel_requested: boolean;
  error: string | null;
}

const ROW_COLS = "id, book_id, status, source, instruction, evaluation, plan, plan_only, progress, version_id, cancel_requested, error";
const ACTIVE: RevStatus[] = ["planning", "awaiting_review", "building"];

interface PageLite { id: number; title: string | null; page_type: string | null; page_index: number }
interface ThreadLite { id: number; name: string; status: string; description: string | null }
interface ContextMeta { pages: PageLite[]; threads: ThreadLite[] }
type PageDepth = "summary" | "full";

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
  /** Enter in outline-only mode (change objectives/structure, leave prose to re-render). */
  planOnly?: boolean;
}

/**
 * Revise with AI -- one durable, resumable surface for asking the AI to change the book.
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
  // The success banner persists until the author dismisses it; keyed by revision id
  // so a fresh "done" revision shows its own banner again.
  const [dismissedDoneId, setDismissedDoneId] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");
  // Outline-only mode: the architect changes objectives + structure and writes no prose; changed
  // pages are left flagged "out of sync" to re-render later. Set by the "Revise the outline" entry.
  const [planOnly, setPlanOnly] = useState(false);
  const [attachedEval, setAttachedEval] = useState<EvalResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contextMeta, setContextMeta] = useState<ContextMeta | null>(null);
  // per-page depth: only pages wanting extra context appear here; absent = outline only
  const [pageDepth, setPageDepth] = useState<Map<number, PageDepth>>(new Map());
  // null = all threads; [] = none; [ids] = specific subset
  const [selectedThreadIds, setSelectedThreadIds] = useState<number[] | null>(null);
  const [openPicker, setOpenPicker] = useState<"pages" | "threads" | null>(null);

  // "Notify me when done": email (notify_email on the row → DB trigger) + a
  // browser notification this tab fires when the build/plan reaches a terminal
  // state. notifyRef mirrors the state for the status-transition effect below.
  const [notify, setNotify] = useState(false);
  const notifyRef = useRef(false);
  const prevStatusRef = useRef<RevStatus | null>(null);

  const onToggleNotify = (next: boolean) => {
    setNotify(next);
    notifyRef.current = next;
    if (row?.id != null)
      void supabase.from("book_revisions").update({ notify_email: next }).eq("id", row.id);
  };

  // Fire a browser notification on the transition into done/error (not on the
  // initial load of an already-finished row — prevStatus starts null).
  useEffect(() => {
    const s = row?.status;
    const prev = prevStatusRef.current;
    prevStatusRef.current = s ?? null;
    if (!s || !prev) return;
    const wasTerminal = prev === "done" || prev === "error" || prev === "cancelled";
    if (!wasTerminal && s === "done" && !BRIDGE) {
      // The edge job (prod) drove the build to completion — refresh the host's drafts here.
      // In dev runBuild's own success path already calls onApplied, so skip to avoid double-firing.
      onApplied?.();
    }
    if (!notifyRef.current) return;
    if (!wasTerminal && (s === "done" || s === "error")) {
      fireNotification(
        s === "done" ? "Your AI revision is done" : "Your AI revision didn't finish",
        {
          body:
            s === "done"
              ? "Review the changes under “View drafts”."
              : "It ran into a problem and stopped.",
          url: window.location.href,
          tag: `revision-${row!.id}`,
        },
      );
    }
  }, [row?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (id: number, fields: Partial<RevisionRow>) => {
    const { error } = await supabase.from("book_revisions").update(fields).eq("id", id);
    if (error) throw error;
  };

  // ── Load the latest revision + context metadata in parallel ──
  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    Promise.all([
      supabase.from("book_revisions").select(ROW_COLS).eq("book_id", bookId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("books").select("brief, bible").eq("id", bookId).single(),
      supabase.from("pages")
        .select("id, title, page_type, page_index")
        .eq("book_id", bookId).eq("archived", false)
        .order("page_index", { ascending: true }),
      supabase.from("book_threads")
        .select("id, name, status, description")
        .eq("book_id", bookId).neq("status", "closed"),
    ]).then(([revResult, , pagesResult, threadsResult]) => {
      if (!mounted.current) return;
      setRow((revResult.data as RevisionRow | null) ?? null);
      const pages = (pagesResult.data as PageLite[] | null) ?? [];
      setContextMeta({ pages, threads: (threadsResult.data as ThreadLite[] | null) ?? [] });
      // Default depths: last 2 text pages = full, everything else = summary
      const textPages = pages.filter(p => p.page_type !== "section");
      const defaults = new Map<number, PageDepth>();
      textPages.forEach((p, i) => {
        defaults.set(p.id, i >= textPages.length - 2 ? "full" : "summary");
      });
      setPageDepth(defaults);
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
    if (prefill.planOnly) setPlanOnly(true);
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
      planOnly: current.plan_only || undefined,
      ctx: {
        pageCtx: Array.from(pageDepth.entries()).map(([id, depth]) => ({
          id,
          summary: depth === "summary",
          full: depth === "full",
        })),
        threadIds: selectedThreadIds,
      },
    };
    if (BRIDGE) {
      const r = await bridgeFetch(`/replan/${bookId}`, {
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
      // Retry the architect call: the dev bridge's `claude -p` is congestion-bound and can time out
      // or drop a socket (prod's edge call is steadier but can blip too). Same backoff the build
      // cascade uses per page — so a single flaky call doesn't dump the author back to the form.
      let plan: RevisionPlan | null = null;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !plan?.pages?.length; attempt++) {
        try {
          plan = await callArchitect(current);
        } catch (e) {
          lastErr = e;
          if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 250);
        }
      }
      if (!plan?.pages?.length) throw lastErr ?? new Error("No revision plan returned.");
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
          plan_only: planOnly,
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

  // ── Generate + persist one page's prose: write = beat-to-prose, revise = revise-prose ──
  const buildPage = async (task: ProseTask) => {
    const isRevise = task.mode === "revise";
    const fn = isRevise ? "revise-prose" : "beat-to-prose";
    const body: Record<string, unknown> = isRevise
      ? { bookId, pageId: task.id, objective: task.objective, issues: task.issues }
      : { bookId, pageId: task.id, level: "page", objective: task.objective };
    let text: string;
    if (BRIDGE) {
      const r = await bridgeFetch(`/${fn}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      text = String(d.text ?? "").trim();
    } else {
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      text = String(data?.text ?? "").trim();
    }
    if (text) {
      const { error: upErr } = await supabase.from("pages").update({ content: buildDoc(task.title, text) }).eq("id", task.id);
      if (upErr) throw upErr;
    }
  };

  // ── The build cascade -- idempotent + resumable off `progress` ──
  const runBuild = async (start: RevisionRow) => {
    if (!start.plan) return;
    busyRef.current = true;
    setBusy(true);
    let current = start;
    // The author's requested mode governs the build — not whether the planner echoed planOnly into
    // the plan. Outline-only writes no prose even if the plan still carries rebuild hints.
    const planOnly = current.plan_only === true || current.plan.planOnly === true;
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

        // 4. Retargets -- set the new objective; drop the stale summary.
        progress = { ...progress, phase: "Updating objectives…" };
        await patch(current.id, { progress });
        setRow((r) => (r ? { ...r, progress } : r));
        for (const p of current.plan.pages) {
          if (p.op !== "retarget" || p.ref == null) continue;
          const { data: cur } = await supabase.from("pages").select("metadata").eq("id", p.ref).maybeSingle();
          const meta = { ...((cur?.metadata as Record<string, unknown>) ?? {}), objective: p.objective };
          // Plan-only leaves prose (so its summary still matches it) and lets the page go out-of-sync;
          // a prose rebuild drops the now-stale summary.
          if (!planOnly) delete (meta as { summary?: unknown }).summary;
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

        // Build the prose task list (in final reading order so the cascade flows forward).
        // Plan-only writes no prose: the empty task list makes the build finish right after this
        // structural phase, leaving changed pages flagged out-of-sync to re-render later.
        const notesByPage = current.evaluation ? groupByPage(current.evaluation) : new Map<number, FixIssue[]>();
        const tasks: ProseTask[] = [];
        for (let i = 0; !planOnly && i < current.plan.pages.length; i++) {
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

      // 6. Prose cascade -- resume skips pages already done; checks cancel between pages.
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
          `${failures ? ` (${failures} failed)` : ""}. Review the changes under "View drafts", then save a version to keep -- or revert to discard.`,
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

  // Auto-resume a job this fresh mount finds mid-flight, so a refresh never strands an active
  // revision behind a manual "Resume" click. Planning is always client-driven (a single replan
  // call), so re-drive it on either backend. A build in dev (bridge) is client-driven too, so
  // re-drive it; in prod the build is owned by the self-chaining edge job + the pg_cron watchdog,
  // so we only watch here (re-driving client-side would race the live chain).
  const autoResumedRef = useRef<number | null>(null);
  useEffect(() => {
    if (loading || !row || busyRef.current) return;
    if (autoResumedRef.current === row.id) return;
    if (row.status === "planning") {
      autoResumedRef.current = row.id;
      void runPlanning(row);
    } else if (row.status === "building" && BRIDGE) {
      autoResumedRef.current = row.id;
      void runBuild(row);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, row?.id, row?.status]);

  const approve = async () => {
    if (!row) return;
    setReviewOpen(false);
    await patch(row.id, { status: "building" }).catch(() => {});
    const next = { ...row, status: "building" as const };
    setRow(next);
    if (BRIDGE) {
      // Dev: drive the build client-side via the bridge (free local generation). It's row-backed,
      // so a refresh still resumes; it just doesn't progress with the tab closed (dev only).
      await runBuild(next);
    } else {
      // Prod: hand the build to the self-chaining edge job. We only watch the row from here — the
      // Realtime channel (activeId watches 'building') streams progress, and a pg_cron watchdog
      // restarts the chain if a link dies, so the build survives a closed tab.
      const { error } = await supabase.functions.invoke("build-revision", { body: { revisionId: row.id } });
      if (error) {
        const msg = String((error as Error)?.message ?? error);
        await patch(row.id, { status: "error", error: msg }).catch(() => {});
        setRow((r) => (r ? { ...r, status: "error", error: msg } : r));
        toast({ title: "Couldn't start the build", description: msg, variant: "destructive" });
      }
    }
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
  // The plan under review: outline-only changes the plan and writes no prose.
  const reviewPlanOnly = !!(row?.plan_only || row?.plan?.planOnly);
  const counts = row?.plan
    ? row.plan.pages.reduce(
        (acc, p) => ((acc[p.op]++), acc),
        { keep: 0, revise: 0, retarget: 0, add: 0 } as Record<PlanPage["op"], number>
      )
    : null;
  const changeCount = counts ? counts.revise + counts.retarget + counts.add + (row?.plan?.deletes.length ?? 0) : 0;

  return (
    <section ref={rootRef} className="rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="pv-eyebrow">
          Revise with AI ·{" "}
          <span className="pv-serif text-[13px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-muted))]">
            describe a change · author only
          </span>
        </div>
      </div>

      {loading && <p className="pv-serif mt-3 text-[14px] italic text-[hsl(var(--pv-text-faint))]">Checking<AnimatedEllipsis /></p>}

      {/* Success — stays until the author dismisses it, with a link to proofread the drafts. */}
      {!loading && !active && row?.status === "done" && dismissedDoneId !== row.id && (
        <DoneBanner
          bookId={bookId}
          progress={row.progress}
          onDismiss={() => setDismissedDoneId(row.id)}
        />
      )}

      {/* The input form -- shown when there's no active revision. */}
      {!loading && !active && (
        <div className="mt-3 space-y-3">
          {row && row.status !== "planning" && row.status !== "done" && (
            <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
              {row.status === "cancelled" && "Last revision cancelled."}
              {row.status === "error" && `Last revision failed: ${row.error ?? "unknown error"}`}
            </p>
          )}
          <Textarea
            ref={textareaRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={planOnly
              ? 'Reshape the outline -- e.g. "Split chapter 2 into two, add a turning-point scene before the climax, and cut the detour to the harbour."'
              : 'Describe the change you want -- e.g. "Make chapter 3 darker, give the protagonist a real decision in the middle, and cut the subplot about the map."'}
            className="min-h-[88px] pv-serif text-[14.5px] leading-relaxed"
          />

          {/* Mode: outline-only re-plans objectives/structure and leaves prose to re-render; full also
              rewrites prose for changed pages. The "Revise the outline" entry preselects outline-only. */}
          <ModeToggle planOnly={planOnly} onChange={setPlanOnly} />

          {/* Context row -- brief + outline always sent; choose page depth and threads */}
          {contextMeta && (() => {
            const sumCount = Array.from(pageDepth.values()).filter(d => d === "summary").length;
            const fullCount = Array.from(pageDepth.values()).filter(d => d === "full").length;
            const pageLabel = pageDepth.size > 0 ? `Pages · ${sumCount}s ${fullCount}f` : "Pages";
            const threadCount = selectedThreadIds === null
              ? contextMeta.threads.length
              : selectedThreadIds.length;
            const threadLabel = selectedThreadIds !== null
              ? `Threads ${threadCount}/${contextMeta.threads.length}`
              : `Threads ${contextMeta.threads.length}`;
            const threadsOn = selectedThreadIds === null || selectedThreadIds.length > 0;
            return (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="pv-eyebrow mr-0.5 text-[9px] text-[hsl(var(--pv-text-faint))]">Context</span>
                  <CtxChip label={pageLabel} picker expanded={openPicker === "pages"} on
                    onClick={() => setOpenPicker(p => p === "pages" ? null : "pages")} />
                  {contextMeta.threads.length > 0 && (
                    <CtxChip label={threadLabel} picker expanded={openPicker === "threads"}
                      on={threadsOn}
                      onClick={() => setOpenPicker(p => p === "threads" ? null : "threads")} />
                  )}
                  {attachedEval && (
                    <CtxChip label="Editor's notes" accent onRemove={() => setAttachedEval(null)} />
                  )}
                </div>
                {openPicker === "pages" && (
                  <PageContextPicker pages={contextMeta.pages} depth={pageDepth}
                    onChange={setPageDepth} />
                )}
                {openPicker === "threads" && (
                  <ThreadPicker threads={contextMeta.threads} selected={selectedThreadIds}
                    onChange={setSelectedThreadIds} />
                )}
              </div>
            );
          })()}

          <div className="flex items-center justify-between gap-3">
            <p className="pv-serif text-[12.5px] leading-relaxed text-[hsl(var(--pv-text-faint))]">
              {planOnly
                ? "The AI proposes outline changes you review before anything sticks. A version is saved first; changed pages are left flagged out-of-sync to re-render."
                : "The AI proposes a plan you review before anything changes. A version is saved first; results land in your drafts."}
            </p>
            <Button onClick={startRevision} disabled={busy || (!instruction.trim() && !attachedEval)}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {busy ? "Planning…" : planOnly ? "Plan the outline →" : "Plan the revision →"}
            </Button>
          </div>
        </div>
      )}

      {/* Planning in flight. */}
      {!loading && active && row!.status === "planning" && (
        <>
          <WorkingIndicator
            phrases={row!.source === "evaluation" ? WORKING_PHRASES.planFromNotes : WORKING_PHRASES.planFromPrompt}
          />
          <div className="mt-2 flex items-center justify-end gap-3">
            {busy ? (
              <NotifyWhenDone enabled={notify} onChange={onToggleNotify} />
            ) : (
              <Button variant="ghost" onClick={() => runPlanning(row!)}>Resume</Button>
            )}
          </div>
        </>
      )}

      {/* Plan ready -- review inline summary; the dialog holds the detail. */}
      {!loading && active && row!.status === "awaiting_review" && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="pv-serif text-[14.5px] leading-relaxed text-foreground">
            A revision plan is ready -- {changeCount} change{changeCount === 1 ? "" : "s"} across the book.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={discard}>Discard</Button>
            <Button onClick={() => setReviewOpen(true)}>{reviewPlanOnly ? "Review changes" : "Review & build"}</Button>
          </div>
        </div>
      )}

      {/* Building -- live per-page status, survives reload, cancellable + resumable. */}
      {!loading && active && row!.status === "building" && row!.progress && (
        <BuildStatus
          progress={row!.progress}
          busy={busy}
          serverDriven={!BRIDGE}
          cancelRequested={row!.cancel_requested}
          onResume={() => runBuild(row!)}
          onCancel={requestCancel}
          notify={notify}
          onToggleNotify={onToggleNotify}
        />
      )}

      {/* Review dialog (also reachable from the inline "Review & build"). */}
      <Dialog open={reviewOpen} onOpenChange={(v) => !busy && setReviewOpen(v)}>
        <DialogContent className="max-w-2xl max-h-[82vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{reviewPlanOnly ? "Review the outline changes" : "Review the revision plan"}</DialogTitle>
            <DialogDescription>{row?.plan?.summary}</DialogDescription>
          </DialogHeader>

          {counts && (
            <div className="pv-mono flex flex-wrap gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">
              <span>{counts.add} new</span>
              <span>{counts.retarget} retargeted</span>
              {!reviewPlanOnly && <span>{counts.revise} revised</span>}
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
                <div className="pv-eyebrow mb-1">Deleted (archived -- reversible)</div>
                {row?.plan?.deletes.map((d) => (
                  <div key={d.ref} className="pv-serif text-[12.5px] text-[hsl(var(--pv-text-faint))]">
                    · page {d.ref}{d.why ? ` -- ${d.why}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="items-center gap-3 sm:justify-between">
            <div className="flex flex-col gap-1">
              {/* The build can run for minutes — opt into a heads-up before you walk away. */}
              {!reviewPlanOnly && <NotifyWhenDone enabled={notify} onChange={onToggleNotify} />}
              <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">
                {changeCount} change{changeCount === 1 ? "" : "s"} · {reviewPlanOnly
                  ? "changed pages left to re-render (flagged out-of-sync)"
                  : "rebuilds prose for changed pages"}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={discard} disabled={busy}>Discard</Button>
              <Button onClick={approve} disabled={busy || changeCount === 0}>
                {reviewPlanOnly ? "Apply outline changes" : "Build"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// Success banner — shown after a revision finishes, until the author dismisses it.
// The work landed as drafts, so the call to action is to proofread them.
function DoneBanner({
  bookId,
  progress,
  onDismiss,
}: {
  bookId: number;
  progress: Progress | null;
  onDismiss: () => void;
}) {
  const done = progress?.done ?? 0;
  const failures = progress?.tasks.filter((t) => t.state === "failed").length ?? 0;
  const pageWord = done === 1 ? "page" : "pages";
  return (
    <div className="mt-3 flex items-start gap-3 rounded-xl border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/10 p-4">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--pv-accent))]" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="pv-serif text-[14.5px] leading-relaxed text-foreground">
          Revision complete — {done} {pageWord} rebuilt
          {failures ? ` (${failures} failed)` : ""}. The changes are saved as drafts.
        </p>
        <Link
          to={`/books/${bookId}/draft`}
          className="pv-mono inline-flex items-center text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--pv-accent))] underline-offset-4 hover:underline"
        >
          Proofread the drafts →
        </Link>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// Live build status -- the per-page changelog the author watches (and can leave / resume).
function BuildStatus({
  progress,
  busy,
  serverDriven,
  cancelRequested,
  onResume,
  onCancel,
  notify,
  onToggleNotify,
}: {
  progress: Progress;
  busy: boolean;
  serverDriven: boolean;
  cancelRequested: boolean;
  onResume: () => void;
  onCancel: () => void;
  notify: boolean;
  onToggleNotify: (enabled: boolean) => void;
}) {
  const total = progress.total || progress.tasks.length;
  // "Running" means work is actively progressing: either this tab is driving it (busy), or the
  // self-chaining edge job owns it (serverDriven). In prod we never show a "Paused/Resume" state —
  // the chain + pg_cron watchdog keep it moving even with the tab closed.
  const running = busy || serverDriven;
  // The build narrates its real phase (structure work, then per-page writing).
  // We feed that single live phrase to WorkingIndicator so it reads as truthful
  // progress, not invented verbs — but with the same prominent animated chrome.
  const phase = progress.structureDone
    ? `Writing pages — ${progress.done}/${total} done`
    : progress.phase ?? "Working";
  return (
    <div className="mt-3 space-y-3">
      {running ? (
        <WorkingIndicator phrases={[phase]} />
      ) : (
        <p className="pv-serif text-[15px] italic text-[hsl(var(--pv-text-muted))]">
          Paused — {phase}.
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {running && <NotifyWhenDone enabled={notify} onChange={onToggleNotify} className="mr-auto" />}
        {!running && <Button variant="ghost" onClick={onResume}>Resume</Button>}
        <Button variant="ghost" onClick={onCancel} disabled={cancelRequested}>
          {cancelRequested ? "Stopping…" : "Cancel"}
        </Button>
      </div>
      {progress.tasks.length > 0 && (
        <div className="space-y-1">
          {progress.tasks.map((t) => (
            <div key={t.id} className="flex items-baseline justify-between gap-3 pl-3">
              <span className="pv-serif text-[13.5px] text-foreground">
                {t.title || "(untitled)"}
                {t.why && <span className="ml-2 text-[hsl(var(--pv-text-faint))]">-- {t.why}</span>}
              </span>
              <span className={`pv-mono shrink-0 text-[10px] uppercase tracking-[0.14em] ${TASK_TONE[t.state]}`}>
                {t.state === "writing" ? "writing…" : t.state === "done" ? "done" : t.state === "failed" ? "failed" : "queued"}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">
        You can leave this page -- the work persists. Reopen the book to resume or cancel.
      </p>
    </div>
  );
}

// ModeToggle — outline-only vs full revision. A two-segment pill: outline-only re-plans objectives
// and structure (no prose written; changed pages go out-of-sync); full also rewrites prose.
function ModeToggle({ planOnly, onChange }: { planOnly: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="inline-flex w-fit rounded-full border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))] p-0.5">
        {[
          { v: true, label: "Outline only" },
          { v: false, label: "Rewrite prose" },
        ].map((m) => (
          <button
            key={String(m.v)}
            type="button"
            aria-pressed={planOnly === m.v}
            onClick={() => onChange(m.v)}
            className={cn(
              "pv-mono rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors",
              planOnly === m.v
                ? "bg-foreground text-background"
                : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">
        {planOnly
          ? "Change objectives & structure only — prose is left to re-render, changed pages flagged out-of-sync."
          : "Re-plan and rebuild prose for changed pages."}
      </span>
    </div>
  );
}

// CtxChip — two variants:
//   toggle (Brief, Bible, Editor's notes): simple on/off, looks like a labeled checkbox
//   picker (Outline, Threads): opens a sub-panel; shows a chevron and current selection count
function CtxChip({
  label, on, accent, picker, expanded, onToggle, onRemove, onClick,
}: {
  label: string;
  on?: boolean;
  accent?: boolean;
  picker?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  onClick?: () => void;
}) {
  // Removable badge (Editor's notes)
  if (onRemove) {
    return (
      <span className={cn(
        "pv-mono inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]",
        accent
          ? "border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/10 text-[hsl(var(--pv-accent))]"
          : "border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))] text-[hsl(var(--pv-text-muted))]"
      )}>
        {label}
        <button type="button" onClick={onRemove} aria-label={`Remove ${label}`}
          className="ml-0.5 opacity-50 hover:opacity-100">×</button>
      </span>
    );
  }

  // Picker chip (Outline, Threads) — clicking opens/closes a sub-panel
  if (picker) {
    return (
      <button type="button" onClick={onClick} aria-expanded={expanded}
        className={cn(
          "pv-mono inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] transition-colors",
          expanded
            ? "border-foreground bg-foreground text-background"
            : on
              ? "border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))] text-[hsl(var(--pv-text-muted))] hover:border-foreground/30"
              : "border-[hsl(var(--pv-border-soft))]/40 bg-transparent text-[hsl(var(--pv-text-faint))] opacity-50"
        )}>
        {label}
        <span aria-hidden>{expanded ? "▴" : "▾"}</span>
      </button>
    );
  }

  // Toggle chip (Brief, Bible) — simple yes/no
  return (
    <button type="button" onClick={onToggle} aria-pressed={on}
      title={on ? `${label} included — click to exclude` : `${label} excluded — click to include`}
      className={cn(
        "pv-mono inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] transition-colors",
        on
          ? "border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))] text-[hsl(var(--pv-text-muted))] hover:border-foreground/30"
          : "border-[hsl(var(--pv-border-soft))]/40 bg-transparent text-[hsl(var(--pv-text-faint))] opacity-40 hover:opacity-70"
      )}>
      <span aria-hidden className={on ? "text-[hsl(var(--pv-accent))]" : "text-[hsl(var(--pv-text-faint))]"}>
        {on ? "✓" : "○"}
      </span>
      {label}
    </button>
  );
}

function PageContextPicker({
  pages, depth, onChange,
}: {
  pages: PageLite[];
  depth: Map<number, PageDepth>;
  onChange: (next: Map<number, PageDepth>) => void;
}) {
  const textPages = pages.filter(p => p.page_type !== "section");

  const setDepth = (id: number, d: PageDepth) => {
    onChange(new Map(depth).set(id, d));
  };

  const setAll = (d: PageDepth) => {
    const next = new Map(depth);
    for (const p of textPages) next.set(p.id, d);
    onChange(next);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40">
      {/* Column headers -- clicking sets ALL pages to that depth */}
      <div className="grid grid-cols-[1fr_80px_56px] items-center border-b border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))] px-3 py-2">
        <span className="pv-eyebrow text-[9px] text-[hsl(var(--pv-text-faint))]">
          Outline always included
        </span>
        <button type="button" onClick={() => setAll("summary")} title="Set all to summary"
          className="pv-mono text-center text-[9px] text-[hsl(var(--pv-text-faint))] hover:text-foreground">Summary</button>
        <button type="button" onClick={() => setAll("full")} title="Set all to full prose"
          className="pv-mono text-center text-[9px] text-[hsl(var(--pv-text-faint))] hover:text-foreground">Full</button>
      </div>

      {/* Page rows */}
      <div className="max-h-56 overflow-y-auto">
        {pages.map(p => {
          if (p.page_type === "section") {
            return (
              <p key={p.id} className="pv-serif px-3 pb-0.5 pt-3 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--pv-text-faint))]">
                {p.title || "(section)"}
              </p>
            );
          }
          const cur = depth.get(p.id) ?? "summary";
          const name = p.title || "this page";
          return (
            <div key={p.id} className="grid grid-cols-[1fr_80px_56px] items-center px-3 py-1.5 hover:bg-[hsl(var(--pv-surface-2))]/60">
              <span className="pv-serif truncate pr-2 text-[13.5px] text-foreground">{p.title || "(untitled)"}</span>
              <div className="flex justify-center">
                <input type="radio" name={`pd-${p.id}`} checked={cur === "summary"}
                  onChange={() => setDepth(p.id, "summary")}
                  aria-label={`${name}: summary`}
                  className="h-3.5 w-3.5 cursor-pointer accent-[hsl(var(--pv-accent))]" />
              </div>
              <div className="flex justify-center">
                <input type="radio" name={`pd-${p.id}`} checked={cur === "full"}
                  onChange={() => setDepth(p.id, "full")}
                  aria-label={`${name}: full prose`}
                  className="h-3.5 w-3.5 cursor-pointer accent-[hsl(var(--pv-accent))]" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThreadPicker({
  threads, selected, onChange,
}: {
  threads: ThreadLite[];
  selected: number[] | null;
  onChange: (ids: number[] | null) => void;
}) {
  const allIds = threads.map(t => t.id);
  const effective = selected ?? allIds;
  const toggle = (id: number) => {
    const next = effective.includes(id) ? effective.filter(x => x !== id) : [...effective, id];
    onChange(next.length === allIds.length ? null : next);
  };
  return (
    <div className="overflow-hidden rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40">
      <div className="flex items-center justify-between border-b border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))] px-3 py-2">
        <span className="pv-eyebrow text-[9px] text-[hsl(var(--pv-text-faint))]">
          {effective.length} of {allIds.length} threads included
        </span>
        <div className="flex gap-3">
          <button type="button" onClick={() => onChange(null)}
            className="pv-mono text-[10px] text-[hsl(var(--pv-text-muted))] hover:text-foreground">All</button>
          <button type="button" onClick={() => onChange([])}
            className="pv-mono text-[10px] text-[hsl(var(--pv-text-muted))] hover:text-foreground">None</button>
        </div>
      </div>
      <div className="max-h-52 overflow-y-auto">
        {threads.map(t => {
          const on = effective.includes(t.id);
          return (
            <label key={t.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-[hsl(var(--pv-surface-2))]/60">
              <input type="checkbox" checked={on} onChange={() => toggle(t.id)}
                aria-label={t.name}
                className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[hsl(var(--pv-accent))]" />
              <span className={cn("pv-serif min-w-0 flex-1 truncate text-[13.5px]",
                on ? "text-foreground" : "text-[hsl(var(--pv-text-faint))]")}>
                {t.name}
              </span>
              <span className="pv-mono shrink-0 text-[9px] text-[hsl(var(--pv-text-faint))]">{t.status}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
