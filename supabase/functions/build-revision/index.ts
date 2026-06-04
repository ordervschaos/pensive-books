// build-revision — execute an approved revision plan (the "Revise with AI" build), as a durable,
// client-agnostic job.
//
// This was the client build cascade in ReviseWithAI.tsx: it ran in the browser, so closing the tab
// paused the build until the author returned. The plan + progress already lived in a book_revisions
// row (resumable by design), but the DRIVING loop was client-side. Now that loop is a SELF-CHAINING
// edge function: one structural phase + one prose page per invocation (each < the ~150s worker cap),
// persisting `progress` and fire-and-forgetting a call to itself for the next step. A pg_cron
// watchdog restarts a dropped link. The client only plans, reviews, and watches.
//
//   client → approve → set book_revisions.status='building' → POST { revisionId }   (authenticated)
//     → verify edit access → reinvoke self { revisionId, chain:true }
//
//   self → POST { revisionId, chain:true }                                          (x-chain secret)
//     → structure phase not done? run it (version snapshot, deletes, adds, retargets, reorder,
//       build the prose task list) → persist → chain
//     → else write the next prose page (generate-unit-core) → persist → chain or finish
//
// Faithful port of ReviseWithAI's runBuild (idempotent + resumable off `progress`): addedIds make
// page-creation re-entrant, tasks carry their own state, and cancel_requested is honored between
// pages.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { generateUnit, type ReviseIssue } from "../_shared/generate-unit-core.ts";
import { buildDoc } from "../_shared/build-doc.ts";
import { serviceClient } from "../_shared/task.ts";
import { reinvoke, isChainCall } from "../_shared/self-chain.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── Types (mirror ReviseWithAI / the migration) ──
interface FixIssue { section: string; severity: string; note: string; evidence?: string; suggestion?: string }
interface PlanPage {
  ref: number | null;
  op: "keep" | "revise" | "retarget" | "add";
  pageType: "section" | "text";
  title: string;
  objective: string;
  rebuild?: "rewrite" | "revise";
  why?: string;
}
interface RevisionPlan { summary: string; pages: PlanPage[]; deletes: { ref: number; why?: string }[] }
interface ProseTask {
  id: number; planIndex: number; title: string; mode: "write" | "revise"; objective: string;
  why?: string; issues?: FixIssue[]; state: "pending" | "writing" | "done" | "failed"; changed?: string;
}
interface Progress {
  structureDone: boolean;
  addedIds: Record<number, number>;
  tasks: ProseTask[];
  done: number;
  total: number;
  phase?: string;
}
interface EvalResult { sections: { title: string; issues?: { severity: string; note: string; evidence?: string; suggestion?: string; page_ref?: { id?: number } }[] }[] }
interface RevisionRow {
  id: number; book_id: number; status: string; plan: RevisionPlan | null; evaluation: EvalResult | null;
  progress: Progress | null; version_id: number | null; cancel_requested: boolean;
}

const ROW_COLS = "id, book_id, status, plan, evaluation, progress, version_id, cancel_requested";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  const service = serviceClient();

  try {
    const body = (await req.json().catch(() => ({}))) as { revisionId?: number; chain?: boolean };

    // ── Continue call (self/watchdog): advance one step ──
    if (body.chain) {
      if (!isChainCall(req)) return json({ error: "Unauthorized" }, 401);
      if (!body.revisionId) return json({ error: "revisionId required" }, 400);
      await advance(service, apiKey, body.revisionId);
      return json({ ok: true });
    }

    // ── Kick-off (authenticated client; the row is already status='building') ──
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { revisionId } = body;
    if (!revisionId) return json({ error: "revisionId is required" }, 400);

    const { data: rev, error: revError } = await userClient
      .from("book_revisions")
      .select("id, book_id, status")
      .eq("id", revisionId)
      .maybeSingle();
    if (revError || !rev) return json({ error: "Revision not found" }, 404);

    // RLS already restricts SELECT to editors, but confirm the book is editable for the start.
    const { data: canEdit } = await userClient.rpc("user_can_edit_book", { _book_id: rev.book_id });
    if (canEdit === false) return json({ error: "Access denied" }, 403);

    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("build-revision", { revisionId }));
    return json({ status: "building", revisionId }, 202);
  } catch (e) {
    console.error("build-revision error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

async function advance(service: SupabaseClient, apiKey: string, revisionId: number) {
  const { data } = await service.from("book_revisions").select(ROW_COLS).eq("id", revisionId).maybeSingle();
  const row = data as RevisionRow | null;
  if (!row || row.status !== "building" || !row.plan) return; // not ours to drive

  // Honor a cancel requested between steps.
  if (row.cancel_requested) {
    await service.from("book_revisions").update({ status: "cancelled" }).eq("id", revisionId);
    return;
  }

  try {
    let progress: Progress = row.progress ?? { structureDone: false, addedIds: {}, tasks: [], done: 0, total: 0 };

    // ── Structural phase (fast, no Claude) — runs once, then chains to the prose cascade ──
    if (!progress.structureDone) {
      progress = await runStructure(service, row, progress);
      await service.from("book_revisions").update({ progress }).eq("id", revisionId);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("build-revision", { revisionId }));
      return;
    }

    // ── Prose cascade — one page per invocation ──
    const tasks = [...progress.tasks];
    const i = tasks.findIndex((t) => t.state === "pending" || t.state === "writing");
    if (i === -1) {
      await service.from("book_revisions").update({ status: "done" }).eq("id", revisionId);
      return;
    }

    tasks[i] = { ...tasks[i], state: "writing" };
    progress = { ...progress, tasks: [...tasks] };
    await service.from("book_revisions").update({ progress }).eq("id", revisionId);

    let ok = false;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      try {
        await buildPage(service, apiKey, row.book_id, tasks[i], revisionId);
        ok = true;
      } catch (e) {
        lastErr = e;
        if (isBillingError(e)) throw e; // won't recover — fail the run
        if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 250);
      }
    }
    if (!ok) console.error(`build-revision: page ${tasks[i].id} failed after ${MAX_ATTEMPTS} attempts:`, lastErr);

    tasks[i] = { ...tasks[i], state: ok ? "done" : "failed" };
    const done = tasks.filter((t) => t.state === "done").length;
    progress = { ...progress, tasks: [...tasks], done };

    const moreLeft = tasks.some((t) => t.state === "pending" || t.state === "writing");
    if (moreLeft) {
      await service.from("book_revisions").update({ progress }).eq("id", revisionId);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("build-revision", { revisionId }));
    } else {
      await service.from("book_revisions").update({ progress, status: "done" }).eq("id", revisionId);
    }
  } catch (e) {
    const billing = isBillingError(e);
    await captureException(e, { function: "build-revision", book_id: String(row.book_id), billing: String(billing) });
    const msg = billing ? "AI credits exhausted — the team has been notified." : String((e as Error)?.message ?? e).slice(0, 1000);
    await service.from("book_revisions").update({ status: "error", error: msg }).eq("id", revisionId);
  }
}

// The structure phase: snapshot a version, archive deletes, create adds, retarget objectives,
// reorder, and build the prose task list. Idempotent off addedIds. Pure DB work (no Claude).
async function runStructure(service: SupabaseClient, row: RevisionRow, progressIn: Progress): Promise<Progress> {
  const plan = row.plan!;
  const bookId = row.book_id;
  let progress = progressIn;

  // 1. Restore point before any mutation (always snapshot if we haven't already).
  if (row.version_id == null) {
    const { data: versionId } = await service.rpc("create_book_version", { p_book_id: bookId, p_commit_message: "Snapshot before AI revision" });
    if (versionId != null) await service.from("book_revisions").update({ version_id: versionId }).eq("id", row.id);
  }

  // 2. Archive deletes (reversible).
  if (plan.deletes.length) {
    const { error } = await service.from("pages").update({ archived: true }).in("id", plan.deletes.map((d) => d.ref));
    if (error) throw new Error(error.message);
  }

  // 3. Create added pages (skip indices already resolved — re-entrant on resume).
  const addedIds: Record<number, number> = { ...progress.addedIds };
  for (let i = 0; i < plan.pages.length; i++) {
    const p = plan.pages[i];
    if (p.op !== "add" || addedIds[i] != null) continue;
    const { data: newPage, error } = await service.rpc("create_next_page", { p_book_id: bookId }).select().single();
    if (error) throw new Error(error.message);
    const id = (newPage as { id: number }).id;
    const update: Record<string, unknown> = { title: p.title, page_type: p.pageType };
    if (p.objective) update.metadata = { objective: p.objective };
    const { error: upErr } = await service.from("pages").update(update).eq("id", id);
    if (upErr) throw new Error(upErr.message);
    addedIds[i] = id;
    progress = { ...progress, addedIds };
    await service.from("book_revisions").update({ progress }).eq("id", row.id); // persist incrementally
  }

  // 4. Retargets — set the new objective; drop the stale summary.
  for (const p of plan.pages) {
    if (p.op !== "retarget" || p.ref == null) continue;
    const { data: cur } = await service.from("pages").select("metadata").eq("id", p.ref).maybeSingle();
    const meta = { ...((cur?.metadata as Record<string, unknown>) ?? {}), objective: p.objective };
    delete (meta as { summary?: unknown }).summary;
    const { error } = await service.from("pages").update({ metadata: meta }).eq("id", p.ref);
    if (error) throw new Error(error.message);
  }

  // 5. Reorder (two-phase to dodge the unique page_index constraint).
  const finalOrder = plan.pages.map((p, i) => (p.op === "add" ? addedIds[i] : p.ref)).filter((x): x is number => x != null);
  for (const id of finalOrder) {
    const { error } = await service.from("pages").update({ page_index: -(id + 10000) }).eq("id", id);
    if (error) throw new Error(error.message);
  }
  for (let i = 0; i < finalOrder.length; i++) {
    const { error } = await service.from("pages").update({ page_index: i }).eq("id", finalOrder[i]);
    if (error) throw new Error(error.message);
  }

  // 6. Build the prose task list (final reading order, so the cascade flows forward).
  const notesByPage = row.evaluation ? groupByPage(row.evaluation) : new Map<number, FixIssue[]>();
  const tasks: ProseTask[] = [];
  for (let i = 0; i < plan.pages.length; i++) {
    const p = plan.pages[i];
    if (p.pageType === "section" || p.op === "keep") continue;
    const id = p.op === "add" ? addedIds[i] : p.ref;
    if (id == null) continue;
    if (p.op === "add" || (p.op === "retarget" && p.rebuild !== "revise")) {
      if (!p.objective) continue;
      tasks.push({ id, planIndex: i, title: p.title, mode: "write", objective: p.objective, why: p.why, state: "pending", changed: p.op === "add" ? "New page written." : "Rewritten for the new objective." });
    } else {
      tasks.push({ id, planIndex: i, title: p.title, mode: "revise", objective: p.objective, why: p.why, issues: reviseIssues(notesByPage.get(id), p.objective, p.op === "retarget"), state: "pending", changed: p.op === "retarget" ? "Revised for the new objective." : "Revised to address the notes." });
    }
  }

  return { structureDone: true, addedIds, tasks, done: 0, total: tasks.length, phase: undefined };
}

// Generate + persist one page's prose (write or revise), via the shared per-page worker.
async function buildPage(service: SupabaseClient, apiKey: string, bookId: number, task: ProseTask, revisionId: number) {
  const text = await generateUnit(service, apiKey, {
    bookId,
    pageId: task.id,
    level: "page",
    mode: task.mode,
    objective: task.objective,
    issues: task.mode === "revise" ? (task.issues as ReviseIssue[]) : undefined,
    log: { taskTable: "book_revisions", taskId: revisionId },
  });
  if (text) {
    const { error } = await service.from("pages").update({ content: buildDoc(task.title, text) }).eq("id", task.id);
    if (error) throw new Error(error.message);
  }
}

// ── Pure helpers ported from ReviseWithAI ──
function groupByPage(result: EvalResult): Map<number, FixIssue[]> {
  const byPage = new Map<number, FixIssue[]>();
  for (const section of result.sections ?? []) {
    for (const issue of section.issues ?? []) {
      const id = issue.page_ref?.id;
      if (id == null) continue;
      const list = byPage.get(id) ?? [];
      list.push({ section: section.title, severity: issue.severity, note: issue.note, evidence: issue.evidence, suggestion: issue.suggestion });
      byPage.set(id, list);
    }
  }
  return byPage;
}

function reviseIssues(notes: FixIssue[] | undefined, objective: string, retargeted: boolean): FixIssue[] {
  const base = notes ?? [];
  if (retargeted) {
    return [
      { section: "Structure", severity: "high", note: `The page's objective has changed to: "${objective}". Revise the existing prose to fulfill the new objective while preserving the book's voice and continuity.` },
      ...base,
    ];
  }
  return base.length
    ? base
    : [{ section: "Prose", severity: "medium", note: "Revise this page to address the editor's concerns and tighten the prose." }];
}
