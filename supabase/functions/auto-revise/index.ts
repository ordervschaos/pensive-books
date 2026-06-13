// auto-revise — the closed eval→revise→re-eval loop ("loops, not better first drafts", automated).
//
// A first draft is a single forward pass; SOTA quality comes from circulating it through a critic.
// This orchestrator does that on the book chassis: evaluate the manuscript (the same editor's-read
// map-reduce), revise every page that drew a CRITICAL or MAJOR (high/medium) page-level note, then
// re-evaluate once so the author can see the before/after. One round — minor/polish notes are left
// for the human gate-5 read so the reviser never sands off voice chasing nits.
//
// Durable + self-chaining like generate-book (kind 'auto_revise'), phased:
//   eval   — insert a book_evaluations row, run the eval inline, queue the high/medium page issues
//   revise — revise ONE page per invocation (revisePage core), chaining through the queue
//   reeval — run the eval once more so the result is comparable; finish
//
//   client → POST { bookId, notify? }                 (authenticated kick-off)
//   self   → POST { generationId, chain:true }         (x-chain secret; advances one unit)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
import { serviceClient } from "../_shared/task.ts";
import { reinvoke, isChainCall } from "../_shared/self-chain.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { runEvaluation, type BookRow } from "../_shared/evaluate-core.ts";
import { revisePage, type ReviseIssue } from "../_shared/generate-unit-core.ts";
import { buildDoc } from "../_shared/build-doc.ts";
import { stampProse } from "../_shared/plan-provenance.ts";

const MAX_HEAD_ATTEMPTS = 3;   // poison-page guard: give up on a page that keeps killing the worker
const MAX_PAGES = 30;          // cap the round so a savage eval can't trigger a runaway revise job
const MAX_ISSUES_PER_PAGE = 8; // keep each page's revise prompt focused

interface QueueItem { pageId: number; issues: ReviseIssue[] }
interface Progress {
  phase: "eval" | "revise" | "reeval" | "done";
  label?: string;
  evalId?: number;
  reEvalId?: number;
  queue?: QueueItem[];
  total?: number;        // pages to revise this round
  revised?: number;
  failures?: number;
  headPageId?: number | null;
  headAttempts?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  const service = serviceClient();

  try {
    const body = (await req.json().catch(() => ({}))) as {
      bookId?: number; notify?: boolean; generationId?: number; chain?: boolean;
    };

    // ── Continue call (self/watchdog): advance the chain by one unit ──
    if (body.chain) {
      if (!isChainCall(req)) return json({ error: "Unauthorized" }, 401);
      if (!body.generationId) return json({ error: "generationId required" }, 400);
      await advance(service, apiKey, body.generationId);
      return json({ ok: true });
    }

    // ── Kick-off (authenticated client) ──
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { bookId, notify } = body;
    if (!bookId) return json({ error: "bookId is required" }, 400);

    const { data: book, error: bookError } = await userClient.from("books").select("id, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);
    if (!(await hasEditAccess(userClient, bookId, user.id, book.owner_id)))
      return json({ error: "Access denied" }, 403);

    const progress: Progress = { phase: "eval", label: "Evaluating the draft", revised: 0, failures: 0 };
    const { data: gen, error: insertError } = await service
      .from("book_generations")
      .insert({ book_id: bookId, created_by: user.id, kind: "auto_revise", scope: "book", status: "running", input: {}, progress, notify_email: notify === true })
      .select()
      .single();
    if (insertError || !gen) return json({ error: "Could not start auto-revise" }, 500);

    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("auto-revise", { generationId: gen.id }));
    return json({ status: "running", generation: gen }, 202);
  } catch (e) {
    console.error("auto-revise error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

async function advance(service: ReturnType<typeof serviceClient>, apiKey: string, genId: number) {
  const { data: row } = await service
    .from("book_generations").select("id, book_id, created_by, status, progress").eq("id", genId).maybeSingle();
  if (!row || row.status !== "running") return; // finished, errored, or gone — stop the chain

  const progress = (row.progress as Progress) ?? { phase: "eval" };

  try {
    if (progress.phase === "eval" || progress.phase === "reeval") {
      await runEvalPhase(service, apiKey, row.id, row.book_id, row.created_by as string | null, progress);
    } else if (progress.phase === "revise") {
      await runRevisePhase(service, apiKey, row.id, row.book_id, progress);
    } else {
      await service.from("book_generations").update({ status: "done" }).eq("id", genId);
    }
  } catch (e) {
    const billing = isBillingError(e);
    await captureException(e, { function: "auto-revise", book_id: String(row.book_id), billing: String(billing) });
    const msg = billing ? "AI credits exhausted — the team has been notified." : String((e as Error)?.message ?? e).slice(0, 1000);
    await service.from("book_generations").update({ status: "error", error: msg }).eq("id", genId);
  }
}

// eval / reeval: insert a book_evaluations row, run the editor's read inline, then either queue the
// high/medium page issues (first pass) or finish (re-eval pass).
async function runEvalPhase(
  service: ReturnType<typeof serviceClient>,
  apiKey: string,
  genId: number,
  bookId: number,
  createdBy: string | null,
  progress: Progress,
) {
  const isReeval = progress.phase === "reeval";
  const { high: evalModel } = await getActiveModels();
  const { data: book } = await service.from("books").select("id, name, subtitle, author, brief").eq("id", bookId).single();
  if (!book) throw new Error("Book not found");

  const { data: evalRow, error: insErr } = await service
    .from("book_evaluations")
    .insert({ book_id: bookId, created_by: createdBy, kind: "fiction", model: evalModel, status: "pending", brief_snapshot: (book as { brief?: unknown }).brief ?? null })
    .select("id").single();
  if (insErr || !evalRow) throw new Error("Could not start evaluation");

  // Inline (≈120s, designed to fit the worker cap). runEvaluation sets the eval row to done/error.
  await runEvaluation(service, apiKey, evalRow.id, book as unknown as BookRow, evalModel);

  if (isReeval) {
    await service.from("book_generations").update({
      status: "done",
      progress: { ...progress, phase: "done", reEvalId: evalRow.id, label: `Done — revised ${progress.revised ?? 0} page${(progress.revised ?? 0) === 1 ? "" : "s"}; re-read ready` },
    }).eq("id", genId);
    return;
  }

  // First pass: pull the result and queue the critical/major page-level issues.
  const { data: done } = await service.from("book_evaluations").select("status, result").eq("id", evalRow.id).maybeSingle();
  if (!done || done.status !== "done") throw new Error("Evaluation did not complete");
  const queue = await buildQueue(service, bookId, done.result);

  if (queue.length === 0) {
    await service.from("book_generations").update({
      status: "done",
      progress: { ...progress, phase: "done", evalId: evalRow.id, total: 0, label: "Done — no critical or major page-level issues to fix" },
    }).eq("id", genId);
    return;
  }

  await service.from("book_generations").update({
    progress: { ...progress, phase: "revise", evalId: evalRow.id, queue, total: queue.length, revised: 0, label: `Revising 0/${queue.length}` },
  }).eq("id", genId);
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("auto-revise", { generationId: genId }));
}

// revise: rework ONE page per invocation from its queued issues, then chain (or move to re-eval).
async function runRevisePhase(
  service: ReturnType<typeof serviceClient>,
  apiKey: string,
  genId: number,
  bookId: number,
  progress: Progress,
) {
  const queue = [...(progress.queue ?? [])];
  if (queue.length === 0) {
    await service.from("book_generations").update({ progress: { ...progress, phase: "reeval", label: "Re-reading the revised draft" } }).eq("id", genId);
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("auto-revise", { generationId: genId }));
    return;
  }

  const item = queue[0];
  // Poison-page guard (a page that keeps killing the worker mid-revise is skipped after N tries).
  const headAttempts = (progress.headPageId === item.pageId ? progress.headAttempts ?? 0 : 0) + 1;
  if (headAttempts > MAX_HEAD_ATTEMPTS) {
    console.error(`auto-revise: skipping page ${item.pageId} after ${MAX_HEAD_ATTEMPTS} stalled attempts`);
    await chainAfterPage(service, genId, progress, queue.slice(1), (progress.revised ?? 0), (progress.failures ?? 0) + 1);
    return;
  }
  await service.from("book_generations").update({ progress: { ...progress, headPageId: item.pageId, headAttempts } }).eq("id", genId);

  let revised = progress.revised ?? 0;
  let failures = progress.failures ?? 0;
  try {
    const { data: page } = await service.from("pages").select("id, title, content, metadata").eq("id", item.pageId).maybeSingle();
    const objective = (page?.metadata as { objective?: string } | null)?.objective;
    if (page) {
      const text = await revisePage(service, apiKey, { bookId, pageId: item.pageId, objective, issues: item.issues, log: { taskTable: "book_generations", taskId: genId } });
      if (text) {
        const { error: upErr } = await service.from("pages").update({ content: buildDoc(page.title, text) }).eq("id", item.pageId);
        if (upErr) throw new Error(upErr.message);
        await stampProse(service, item.pageId, objective, text); // re-sync the plan↔prose edge
        revised++;
      }
    }
  } catch (e) {
    if (isBillingError(e)) throw e; // bubble to the terminal-error handler
    failures++;
    console.error(`auto-revise: page ${item.pageId} revise failed:`, e);
  }

  await chainAfterPage(service, genId, progress, queue.slice(1), revised, failures);
}

async function chainAfterPage(
  service: ReturnType<typeof serviceClient>,
  genId: number,
  progress: Progress,
  rest: QueueItem[],
  revised: number,
  failures: number,
) {
  const next: Progress = {
    ...progress, queue: rest, revised, failures, headPageId: null, headAttempts: 0,
    phase: rest.length > 0 ? "revise" : "reeval",
    label: rest.length > 0 ? `Revising ${revised}/${progress.total ?? 0}` : "Re-reading the revised draft",
  };
  await service.from("book_generations").update({ progress: next }).eq("id", genId);
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("auto-revise", { generationId: genId }));
}

// Map the eval result's CRITICAL (high) + MAJOR (medium) page-anchored issues to a per-page queue,
// in reading order. Whole-book issues (no page_ref) are left for the human read. Section dividers and
// missing pages are dropped.
async function buildQueue(service: ReturnType<typeof serviceClient>, bookId: number, result: unknown): Promise<QueueItem[]> {
  const sections = ((result as { sections?: Array<{ id?: string; issues?: unknown[] }> } | null)?.sections) ?? [];
  const byPage = new Map<number, ReviseIssue[]>();
  for (const s of sections) {
    for (const raw of (s.issues ?? []) as Array<Record<string, unknown>>) {
      const sev = raw.severity;
      if (sev !== "high" && sev !== "medium") continue;
      const pid = (raw.page_ref as { id?: unknown } | null)?.id;
      if (typeof pid !== "number") continue;
      const issue: ReviseIssue = {
        section: typeof s.id === "string" ? s.id : undefined,
        severity: sev === "high" ? "critical" : "major",
        note: String(raw.note ?? "").trim(),
        evidence: typeof raw.evidence === "string" ? raw.evidence : undefined,
        suggestion: typeof raw.suggestion === "string" ? raw.suggestion : undefined,
      };
      if (!issue.note) continue;
      const list = byPage.get(pid) ?? [];
      if (list.length < MAX_ISSUES_PER_PAGE) { list.push(issue); byPage.set(pid, list); }
    }
  }
  if (byPage.size === 0) return [];

  // Keep only real text pages, in reading order; cap the round.
  const { data: pages } = await service
    .from("pages").select("id, page_index, page_type").eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });
  const order = (pages as Array<{ id: number; page_index: number; page_type: string | null }> | null) ?? [];
  const queue: QueueItem[] = [];
  for (const p of order) {
    if (p.page_type !== "text") continue;
    const issues = byPage.get(p.id);
    if (issues?.length) queue.push({ pageId: p.id, issues });
    if (queue.length >= MAX_PAGES) break;
  }
  return queue;
}
