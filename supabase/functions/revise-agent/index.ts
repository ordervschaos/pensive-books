// revise-agent — the editor's AGENT: a durable, tool-using loop that addresses the editor's
// evaluation the way a careful human would — read the actual pages the notes point at, ask the
// author the creative questions that matter (with suggested options), then propose a surgical
// revision plan.
//
// Where the one-shot architect (revise-outline) plans blind from the notes, this loop INVESTIGATES
// first. It is still read-only on the book: its only "write" is inserting a book_revisions row in
// awaiting_review — the author reviews that plan in the existing dialog, and build-revision applies
// it. So the trusted mutation path (version snapshot → structure → prose → drafts) is unchanged.
//
// Durability follows build-revision: the run lives in a book_agent_runs row; each self-chain link
// makes ONE Claude call (well under the ~150s worker cap), executes its tool calls, persists the
// transcript, and chains. An ask_author call parks the run in `awaiting_input` (no chain) until the
// author answers; the pg_cron watchdog only revives stalled 'running' rows.
//
//   client → POST { bookId, evaluation }            → insert row → chain          (authenticated)
//   client → POST { runId, answer }                 → append tool_result → chain  (authenticated)
//   self   → POST { runId, chain: true }            → one model call → …          (x-chain secret)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { type Brief, briefContext } from "../_shared/brief.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callClaude } from "../_shared/claude.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { tiptapToText } from "../_shared/words.ts";
import { serviceClient } from "../_shared/task.ts";
import { reinvoke, isChainCall } from "../_shared/self-chain.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";
import { sanitizePlan, type RevisionPlan } from "../_shared/revision-plan.ts";

const MAX_TURNS = 20;          // model calls per run — the runaway guard
// One call must finish inside the ~150s worker wall clock (with headroom for the row writes and
// the chain dispatch). An abort still BILLS — the API keeps generating after we hang up — so the
// real defense is keeping turns short (effort: medium below), not this timer.
const CALL_TIMEOUT_MS = 140_000;
const MAX_PAGE_CHARS = 12_000; // read_page output cap

// ── Row shapes ──
interface AgentStep { t: "user" | "note" | "read" | "ask" | "answer" | "plan" | "done"; label: string }
interface Pending {
  tool_use_id: string;
  question: string;
  options?: string[];
  // tool_results for read_page calls issued in the SAME assistant turn as the ask — the answer
  // message must carry results for every tool_use of that turn, so these ride along.
  preResults?: unknown[];
}
interface RunRow {
  id: number;
  book_id: number;
  created_by: string | null;
  kind: string; // 'eval' (per-run) | 'thread' (the persistent omni-rail conversation)
  status: string;
  evaluation: EvalResult | null;
  transcript: unknown[];
  steps: AgentStep[];
  pending: Pending | null;
  turns: number;
  cancel_requested: boolean;
}
const ROW_COLS = "id, book_id, created_by, kind, status, evaluation, transcript, steps, pending, turns, cancel_requested";

// The evaluation shape (book_evaluations.result), as produced by evaluate-book.
interface EvalIssue {
  severity?: string; note: string; evidence?: string; suggestion?: string;
  page_ref?: { id: number | null; title?: string; index?: number | null } | null;
}
interface EvalSection { id: string; title: string; stance?: string; assessment?: string; issues?: EvalIssue[] }
interface EvalResult {
  verdict: { genre_contract?: string; stance?: string; letter?: string; priorities?: string[] };
  sections: EvalSection[];
}

interface PageRow {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  metadata: { objective?: string; summary?: string } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  const service = serviceClient();

  try {
    const body = (await req.json().catch(() => ({}))) as {
      bookId?: number; evaluation?: EvalResult; instruction?: string; targetPageId?: number; runId?: number; answer?: string; chain?: boolean;
      message?: string;
    };

    // ── Continue call (self/watchdog): advance one model turn ──
    if (body.chain) {
      if (!isChainCall(req)) return json({ error: "Unauthorized" }, 401);
      if (!body.runId) return json({ error: "runId required" }, 400);
      await advance(service, apiKey, body.runId);
      return json({ ok: true });
    }

    // ── Authenticated client calls ──
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // Answer to an ask_author question: append the tool_result and resume the chain.
    if (body.runId) {
      const answer = (body.answer ?? "").trim();
      if (!answer) return json({ error: "answer is required" }, 400);
      const { data } = await userClient.from("book_agent_runs").select(ROW_COLS).eq("id", body.runId).maybeSingle();
      const row = data as RunRow | null;
      if (!row) return json({ error: "Run not found" }, 404);
      const { data: canEdit } = await userClient.rpc("user_can_edit_book", { _book_id: row.book_id });
      if (canEdit === false) return json({ error: "Access denied" }, 403);
      if (row.status !== "awaiting_input" || !row.pending) return json({ error: "Run is not waiting for input" }, 409);

      const transcript = [...row.transcript, {
        role: "user",
        content: [
          ...(row.pending.preResults ?? []),
          { type: "tool_result", tool_use_id: row.pending.tool_use_id, content: answer },
        ],
      }];
      const steps = [...row.steps, { t: "answer", label: answer } as AgentStep];
      const { error } = await service.from("book_agent_runs")
        .update({ transcript, steps, pending: null, status: "running" })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId: row.id }));
      return json({ status: "running", runId: row.id }, 202);
    }

    // ── Thread message (the persistent omni-rail conversation — docs/agent-rail.md) ──
    // A free-text message (no evaluation/instruction) to the book's ONE agent thread. Get-or-create
    // the thread row (kind='thread'), append the message, reset the per-turn budget, and drive it.
    // A turn ends in 'idle' (not 'done'), so the next message resumes with full transcript context.
    if (typeof body.message === "string" && !body.evaluation && !body.instruction) {
      const tBookId = body.bookId;
      const message = body.message.trim();
      if (!tBookId) return json({ error: "bookId is required" }, 400);
      if (!message) return json({ error: "message is required" }, 400);
      const { data: canEdit } = await userClient.rpc("user_can_edit_book", { _book_id: tBookId });
      if (canEdit === false) return json({ error: "Access denied" }, 403);

      const { data: existing } = await service
        .from("book_agent_runs").select(ROW_COLS).eq("book_id", tBookId).eq("kind", "thread").maybeSingle();
      const thread = existing as RunRow | null;

      if (thread && (thread.status === "running" || thread.status === "awaiting_input")) {
        return json({ error: "The agent is mid-turn — answer its question or stop it first." }, 409);
      }

      if (!thread) {
        const { data: run, error: insErr } = await service
          .from("book_agent_runs")
          .insert({
            book_id: tBookId,
            created_by: user.id,
            kind: "thread",
            status: "running",
            transcript: [{ role: "user", content: [{ type: "text", text: message }] }],
            steps: [{ t: "user", label: message }],
          })
          .select("id")
          .single();
        if (insErr) throw new Error(insErr.message);
        const id = (run as { id: number }).id;
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId: id }));
        return json({ status: "running", runId: id }, 202);
      }

      // A fresh turn on the existing thread: append the message, reset the per-turn budget, clear any
      // prior error/cancel, and run.
      const transcript = [...thread.transcript, { role: "user", content: [{ type: "text", text: message }] }];
      const steps = [...thread.steps, { t: "user", label: message } as AgentStep];
      const { error } = await service.from("book_agent_runs")
        .update({ transcript, steps, status: "running", turns: 0, pending: null, error: null, cancel_requested: false })
        .eq("id", thread.id);
      if (error) throw new Error(error.message);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId: thread.id }));
      return json({ status: "running", runId: thread.id }, 202);
    }

    // Start a run: snapshot the book context + EITHER the editor's read OR the author's free-text
    // instruction (the prose editor in the Draft rail uses the instruction path).
    const { bookId, evaluation, instruction, targetPageId } = body;
    if (!bookId) return json({ error: "bookId is required" }, 400);
    const hasEval = !!evaluation?.verdict && Array.isArray(evaluation.sections);
    const instr = (instruction ?? "").trim();
    if (!hasEval && !instr) {
      return json({ error: "Either a valid evaluation or an instruction is required" }, 400);
    }

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, brief, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);
    const { data: canEdit } = await userClient.rpc("user_can_edit_book", { _book_id: bookId });
    if (canEdit === false) return json({ error: "Access denied" }, 403);

    const { data: pages, error: pagesError } = await userClient
      .from("pages")
      .select("id, page_index, page_type, title, metadata")
      .eq("book_id", bookId).eq("archived", false)
      .order("page_index", { ascending: true });
    if (pagesError) throw new Error(`fetch pages: ${pagesError.message}`);
    if (!pages?.length) return json({ error: "Book has no pages" }, 400);

    const { data: threads } = await userClient
      .from("book_threads")
      .select("name, status, setup_page_id, payoff_page_id")
      .eq("book_id", bookId).neq("status", "closed");

    // Page-scoped run (the PageReview prose chat): focus the agent on one page only.
    const focusPage = targetPageId != null ? (pages as PageRow[]).find((p) => p.id === targetPageId) ?? null : null;

    const context = buildContext(
      book.name,
      book.brief as Brief | null,
      pages as PageRow[],
      (threads as ThreadLite[] | null) ?? [],
      hasEval ? evaluation! : null,
      instr || null,
      focusPage,
    );

    const { data: run, error: insErr } = await service
      .from("book_agent_runs")
      .insert({
        book_id: bookId,
        created_by: user.id,
        status: "running",
        target_page_id: focusPage ? targetPageId : null,
        evaluation: hasEval ? evaluation : null,
        transcript: [{ role: "user", content: [{ type: "text", text: context }] }],
        steps: [{ t: "note", label: focusPage ? `Reading "${focusPage.title || "this page"}" and its context.` : hasEval ? "Reading the editor's notes and the outline." : "Reading the author's request and the outline." }],
      })
      .select("id, created_at")
      .single();
    if (insErr) throw new Error(insErr.message);

    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId: (run as { id: number }).id }));
    return json({ status: "running", run }, 202);
  } catch (e) {
    console.error("revise-agent error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// ── One chain link: one Claude call, execute its tool calls, persist, chain or park ──
async function advance(service: SupabaseClient, apiKey: string, runId: number) {
  const { data } = await service.from("book_agent_runs").select(ROW_COLS).eq("id", runId).maybeSingle();
  const row = data as RunRow | null;
  if (!row || row.status !== "running") return; // not ours to drive (parked, finished, or gone)

  if (row.cancel_requested) {
    await service.from("book_agent_runs").update({ status: "cancelled" }).eq("id", runId);
    return;
  }
  if (row.turns >= MAX_TURNS) {
    await service.from("book_agent_runs")
      .update({ status: "error", error: `The agent ran past ${MAX_TURNS} turns without finishing — stopped as a safety measure.` })
      .eq("id", runId);
    return;
  }

  try {
    // Any tier works here: _shared/claude.ts converts tools/tool_use/tool_result both ways for
    // the OpenAI-compatible paths (DeepSeek, MuleRouter/Qwen), so the loop runs on cheap models too.
    const { high: model } = await getActiveModels();
    const turns = row.turns + 1;
    // Thread runs are the persistent omni-rail conversation: a conversational system prompt grounded
    // in the CURRENT book state (rebuilt per call so ids stay fresh), and the thread tool belt. Eval
    // runs keep the static plan-first system + tools.
    const isThread = row.kind === "thread";
    const system = isThread ? await threadSystem(service, row.book_id) : SYSTEM;
    const tools = isThread ? THREAD_TOOLS : TOOLS;
    // Count the turn BEFORE the call: a hard worker death mid-call still consumes budget, so a
    // crash-looping run hits MAX_TURNS instead of being revived forever by the watchdog.
    await service.from("book_agent_runs").update({ turns }).eq("id", runId);

    let resp;
    try {
      resp = await callClaude(apiKey, {
        model,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        // effort defaults to HIGH, which made every turn think past the 120s timer (observed:
        // five consecutive aborted-and-billed 120s calls). Medium keeps a turn at ~30-60s; the
        // author-gated plan review downstream is the quality backstop.
        output_config: { effort: "medium" },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools,
        messages: withCacheBreakpoints(row.transcript),
      }, {
        fn: "revise-agent",
        bookId: row.book_id,
        taskTable: "book_agent_runs",
        taskId: runId,
        userId: row.created_by,
      }, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    } catch (e) {
      if (isBillingError(e)) throw e; // won't recover — fail the run
      // Transient API failure/timeout: chain again (turn budget already spent bounds retries).
      console.error(`revise-agent run ${runId} call failed (turn ${turns}), retrying:`, e);
      await sleep(2000);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId }));
      return;
    }

    // deno-lint-ignore no-explicit-any
    const content = (resp?.content ?? []) as any[];
    const transcript = [...row.transcript, { role: "assistant", content }];
    const steps = [...row.steps];

    // The model's visible narration becomes the progress feed. On a thread it IS the agent's chat
    // reply, so keep it whole; on an eval run it's a one-line activity note, so cap it.
    for (const b of content) {
      if (b.type === "text" && String(b.text ?? "").trim()) {
        const txt = String(b.text).trim();
        steps.push({ t: "note", label: isThread ? txt : txt.slice(0, 300) });
      }
    }

    const toolUses = content.filter((b) => b.type === "tool_use");

    // ── Terminal tools first: a valid plan or a finish ends the run ──
    const planCall = toolUses.find((t) => t.name === "propose_revision_plan");
    if (planCall) {
      const outcome = await proposePlan(service, row, planCall.input as Partial<RevisionPlan>);
      if (outcome.ok) {
        steps.push({ t: "plan", label: outcome.summary });
        await service.from("book_agent_runs").update({
          status: "done",
          transcript,
          steps,
          revision_id: outcome.revisionId,
          report: outcome.summary,
        }).eq("id", runId);
        return;
      }
      // Invalid plan: hand the validation error back (with results for any sibling reads) and retry.
      const results = await toolResults(service, row.book_id, toolUses, steps, {
        [planCall.id]: `The plan was rejected: ${outcome.error} Fix it and call propose_revision_plan again.`,
      });
      transcript.push({ role: "user", content: results });
      await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId }));
      return;
    }

    const finishCall = toolUses.find((t) => t.name === "finish");
    if (finishCall) {
      const report = String((finishCall.input as { report?: string })?.report ?? "").trim() || "The agent finished without proposing changes.";
      steps.push({ t: "done", label: report.slice(0, 300) });
      // A thread turn ends QUIESCENT ('idle') so the conversation can continue; an eval run is terminal.
      await service.from("book_agent_runs")
        .update({ status: isThread ? "idle" : "done", transcript, steps, report }).eq("id", runId);
      return;
    }

    // ── ask_author parks the run; sibling read results ride along in `pending` ──
    const askCall = toolUses.find((t) => t.name === "ask_author");
    if (askCall) {
      const input = askCall.input as { question?: string; options?: string[] };
      const question = String(input?.question ?? "").trim();
      const preResults = await toolResults(service, row.book_id, toolUses.filter((t) => t.id !== askCall.id), steps);
      steps.push({ t: "ask", label: question.slice(0, 300) });
      const pending: Pending = {
        tool_use_id: askCall.id,
        question,
        options: Array.isArray(input?.options) ? input.options.map(String).slice(0, 4) : undefined,
        preResults: preResults.length ? preResults : undefined,
      };
      await service.from("book_agent_runs")
        .update({ status: "awaiting_input", transcript, steps, pending })
        .eq("id", runId);
      return; // no chain — resumes when the author answers
    }

    // ── Plain reads: execute, append, chain ──
    if (toolUses.length) {
      const results = await toolResults(service, row.book_id, toolUses, steps);
      transcript.push({ role: "user", content: results });
      await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId }));
      return;
    }

    // ── No tool call at all ──
    // On a THREAD this is a normal conversational reply (the agent answered without needing a tool):
    // the assistant's text is already captured as a 'note' step, so the turn is complete → go idle.
    if (isThread) {
      await service.from("book_agent_runs").update({ status: "idle", transcript, steps }).eq("id", runId);
      return;
    }
    // On an EVAL run, ending a turn with bare text is always wrong — finish/propose_revision_plan are
    // the only exits — and silently treating narration as a report masked the deepseek-tier bug for a
    // whole run. Nudge once and continue (bounded by the turn budget).
    transcript.push({
      role: "user",
      content: [{
        type: "text",
        text: "You ended your turn without calling a tool. Continue using your tools: read_page to investigate, ask_author for a creative fork, and end the run ONLY via propose_revision_plan (or finish if no changes are needed).",
      }],
    });
    await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId }));
  } catch (e) {
    const billing = isBillingError(e);
    await captureException(e, { function: "revise-agent", book_id: String(row.book_id), billing: String(billing) });
    const msg = billing ? "AI credits exhausted — the team has been notified." : String((e as Error)?.message ?? e).slice(0, 1000);
    await service.from("book_agent_runs").update({ status: "error", error: msg }).eq("id", runId);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Execute a turn's non-terminal tool calls (read_page; unknown tools get an error result) and
// return the tool_result blocks. `overrides` injects a prebuilt result for a given tool_use id.
// deno-lint-ignore no-explicit-any
async function toolResults(
  service: SupabaseClient,
  bookId: number,
  // deno-lint-ignore no-explicit-any
  toolUses: any[],
  steps: AgentStep[],
  overrides: Record<string, string> = {},
): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const t of toolUses) {
    if (overrides[t.id] != null) {
      results.push({ type: "tool_result", tool_use_id: t.id, content: overrides[t.id], is_error: true });
      continue;
    }
    if (t.name === "read_page") {
      const pageId = Number((t.input as { page_id?: number })?.page_id);
      const { data: page } = await service
        .from("pages").select("id, title, content, page_type, archived, book_id").eq("id", pageId).maybeSingle();
      if (!page || page.book_id !== bookId || page.archived) {
        results.push({ type: "tool_result", tool_use_id: t.id, content: `No page with id ${pageId} in this book.`, is_error: true });
        continue;
      }
      const text = tiptapToText(page.content).trim();
      steps.push({ t: "read", label: `Read “${page.title || "(untitled)"}” in full.` });
      results.push({
        type: "tool_result",
        tool_use_id: t.id,
        content: text ? text.slice(0, MAX_PAGE_CHARS) : "(this page has no prose yet)",
      });
    } else {
      results.push({ type: "tool_result", tool_use_id: t.id, content: `Unknown tool ${t.name}.`, is_error: true });
    }
  }
  return results;
}

// Validate the proposed plan against the CURRENT pages (fresh fetch — the author may have edited
// since the run started) and insert the book_revisions row the existing review/build flow owns.
async function proposePlan(
  service: SupabaseClient,
  row: RunRow,
  input: Partial<RevisionPlan>,
): Promise<{ ok: true; revisionId: number; summary: string } | { ok: false; error: string }> {
  const { data: pages, error } = await service
    .from("pages")
    .select("id, page_type, title, metadata")
    .eq("book_id", row.book_id).eq("archived", false);
  if (error) return { ok: false, error: `Could not load pages: ${error.message}.` };

  let plan: RevisionPlan;
  try {
    plan = sanitizePlan(input, (pages ?? []) as { id: number; page_type: string | null; title: string | null; metadata: { objective?: string } | null }[]);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
  const changes = plan.pages.filter((p) => p.op !== "keep").length + plan.deletes.length;
  if (changes === 0) return { ok: false, error: "The plan contains no changes — every page is 'keep' and nothing is deleted. Either propose real changes or call finish." };

  const { data: rev, error: insErr } = await service
    .from("book_revisions")
    .insert({
      book_id: row.book_id,
      created_by: row.created_by,
      status: "awaiting_review",
      source: row.evaluation ? "evaluation" : "instruction",
      instruction: null,
      evaluation: row.evaluation,
      plan,
      plan_only: false,
    })
    .select("id")
    .single();
  if (insErr) return { ok: false, error: `Could not save the plan: ${insErr.message}.` };
  return { ok: true, revisionId: (rev as { id: number }).id, summary: plan.summary || "Revision plan proposed." };
}

// Request-time cache breakpoints (never stored in the row, so they don't accumulate past the API's
// limit of 4): one on the big first user message, one on the last block of the latest message —
// each link re-reads the whole prefix from cache and only pays for the newest turn.
function withCacheBreakpoints(transcript: unknown[]): unknown[] {
  // deno-lint-ignore no-explicit-any
  const msgs = transcript.map((m) => ({ ...(m as any), content: ((m as any).content as any[]).map((b) => ({ ...b })) }));
  const mark = (msgIdx: number) => {
    const blocks = msgs[msgIdx]?.content;
    if (!Array.isArray(blocks) || !blocks.length) return;
    const last = blocks[blocks.length - 1];
    // cache_control is only valid on standard block types; text/tool_result/tool_use all qualify.
    if (last && typeof last === "object" && last.type !== "thinking" && last.type !== "redacted_thinking") {
      last.cache_control = { type: "ephemeral" };
    }
  };
  mark(0);
  if (msgs.length > 1) mark(msgs.length - 1);
  return msgs;
}

// ── Tools ────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "read_page",
    description: "Read a page's full prose. Use the real page [id]s from the outline. Always read a page before proposing to revise, retarget, or build on it.",
    input_schema: {
      type: "object",
      properties: { page_id: { type: "number", description: "The page's [id] from the outline." } },
      required: ["page_id"],
    },
  },
  {
    name: "ask_author",
    description: "Ask the author ONE creative decision question. Offer 2–4 concrete options when you can (put your recommendation first, marked '(recommended)'). The run pauses until they answer — so batch your thinking and ask only what genuinely changes the plan. At most 3 questions per run; never ask for permission to proceed.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The decision you need from the author, in one or two sentences." },
        options: { type: "array", items: { type: "string" }, description: "2–4 concrete suggestions the author can pick from. They can always answer in their own words instead." },
      },
      required: ["question"],
    },
  },
  {
    name: "propose_revision_plan",
    description: "Your final output: the revision plan the author will review before anything is built. The book's NEW page list in final reading order plus pages to delete. This ends the run.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "2-3 sentences: what this revision changes and why, tied to the editor's notes and the author's answers." },
        pages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ref: { type: ["number", "null"], description: "Existing page id, or null for an added page." },
              op: { type: "string", enum: ["keep", "revise", "retarget", "add"] },
              pageType: { type: "string", enum: ["section", "text"] },
              title: { type: "string" },
              objective: { type: "string" },
              rebuild: { type: "string", enum: ["rewrite", "revise"], description: "retarget only: rewrite fresh prose, or revise (adapt) the existing prose." },
              why: { type: "string", description: "One line tied to the evaluation or the author's answer." },
            },
            required: ["ref", "op", "pageType", "title", "objective"],
          },
        },
        deletes: {
          type: "array",
          items: {
            type: "object",
            properties: { ref: { type: "number" }, why: { type: "string" } },
            required: ["ref"],
          },
        },
      },
      required: ["summary", "pages", "deletes"],
    },
  },
  {
    name: "finish",
    description: "End the run WITHOUT proposing a plan — only when the notes genuinely need no changes, or the author's answers say to stop.",
    input_schema: {
      type: "object",
      properties: { report: { type: "string", description: "A short honest summary of what you found and why no plan was proposed." } },
      required: ["report"],
    },
  },
];

// ── System prompt ────────────────────────────────────────────────────────────
const SYSTEM = `You are the prose editor's agent for a book-writing studio. Your job is to ADDRESS the author's request — which is EITHER a developmental editor's evaluation OR a specific change the author described — like a trusted human collaborator would: investigate first, involve the author in the creative forks, then propose a surgical revision plan.

You are given the brief, the CURRENT outline (each page with its real [id], type, title, objective, and summary), tracked threads, and EITHER the editor's full evaluation OR the author's requested change.

METHOD — work in this order:
1. TRIAGE the request. Group the work by root cause: several notes (or one broad ask like "make chapter 3 darker") often share one fix (e.g. "the heroine is passive in the climax" + "her core wound is never confronted" may be one new scene). When an evaluation is given, the verdict's priorities ("fix these first") are the highest-leverage changes.
2. INVESTIGATE. read_page the pages the high-leverage notes anchor to — never plan changes to prose you have not read. Read what you need, not the whole book.
3. CONSULT. If a genuinely creative fork decides the plan's shape (where a new scene goes, which of two approaches fits the author's intent, whether to cut a subplot), ask_author — with concrete options and your recommendation. Do not ask about trivia, mechanics, or permission. Many runs need zero questions.
4. PROPOSE. Call propose_revision_plan with a surgical plan. The author reviews it before anything is built, and prose generation happens downstream — you plan in OBJECTIVES (what each page must achieve), never in prose.

PLAN RULES (the plan is rejected if violated):
- Use ONLY the real [id]s given. Every existing page MUST appear either in "pages" (with its ref) or in "deletes" — never drop a page silently.
- Ops: "keep" (unchanged) · "revise" (same objective, prose needs fixing per the notes) · "retarget" (NEW objective; set rebuild: "rewrite" for a material change or "revise" for a minor shift) · "add" (a NEW page, ref null, with pageType, title, objective). Reorder by placing entries in the desired final order.
- "section" pages are chapter/part dividers; "text" pages carry prose. Keep an objective on every text page.
- Be surgical: mark "keep" for what works; change only what the notes (and the author's answers) demand.
- TRACKED THREADS are promises the book must keep. Never orphan a setup or its payoff — relocate the beat if you delete its page.

STYLE: before each tool call, narrate what you're doing and why in one or two plain sentences — the author sees this as a live progress feed. Be concrete ("Reading the tavern scene the passivity notes point at"), never generic ("Analyzing…").`;

// ── Thread mode (the persistent omni-rail conversation — docs/agent-rail.md) ──
// Phase 1: the agent can READ and DISCUSS the book. Propose tools (per-layer changes the author
// applies) land in later phases. The agent ends a turn by simply replying — no tool needed.
const THREAD_TOOLS = TOOLS.filter((t) => t.name === "read_page" || t.name === "ask_author");

const SYSTEM_THREAD = `You are the story editor's agent for a book-writing studio — the author's single AI collaborator for the WHOLE book, holding an ongoing conversation in the studio's right-hand rail.

You are given the CURRENT book state below: the brief (the voice contract), the outline with each page's real [id], type, title, and objective, and any tracked threads. Use read_page to read a page's full prose before discussing or judging it. Use ask_author when a genuine creative fork needs the author's call — offer 2–4 concrete options with your recommendation first.

Right now your job is to READ and DISCUSS: answer questions, summarize, pressure-test the story, and talk through ideas — grounded in the actual book, referencing pages by their [id]. Reply in plain prose; just end your turn with your message (you don't need a tool to reply). Be concrete and concise. (Proposing concrete changes the author can apply comes later.)`;

// The thread's system prompt carries the CURRENT book state, rebuilt every call so page [id]s stay
// fresh as the author edits (the transcript holds only the conversation).
async function threadSystem(service: SupabaseClient, bookId: number): Promise<string> {
  const { data: book } = await service.from("books").select("name, brief").eq("id", bookId).maybeSingle();
  const { data: pages } = await service
    .from("pages").select("id, page_index, page_type, title, metadata")
    .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });
  const { data: threads } = await service
    .from("book_threads").select("name, status, setup_page_id, payoff_page_id")
    .eq("book_id", bookId).neq("status", "closed");
  const ctx =
    `BOOK: ${(book as { name?: string } | null)?.name ?? ""}\n\nBRIEF (the voice contract):\n${briefContext((book as { brief?: Brief } | null)?.brief ?? null, { scope: "full", success: true, none: "(no brief set)", empty: "(brief is empty)" })}` +
    `\n\nCURRENT OUTLINE (real ids; read_page for full prose):\n${outlineContext(((pages ?? []) as PageRow[]))}` +
    ((threads?.length) ? `\n\nTRACKED THREADS (keep their setups & payoffs intact):\n${threadsContext(threads as ThreadLite[])}` : "");
  return `${SYSTEM_THREAD}\n\n${ctx}`;
}

// ── Context builders (mirror revise-outline) ─────────────────────────────────
interface ThreadLite { name: string; status: string; setup_page_id: number | null; payoff_page_id: number | null }

function buildContext(
  bookName: string,
  brief: Brief | null,
  pages: PageRow[],
  threads: ThreadLite[],
  evaluation: EvalResult | null,
  instruction: string | null,
  focusPage: PageRow | null = null,
): string {
  const directive = evaluation
    ? `\n\nEDITOR'S EVALUATION (the notes to address):\n${evalContext(evaluation)}` +
      `\n\nAddress the editor's notes. Investigate first, consult the author on real creative forks, then propose the revision plan.`
    : `\n\nTHE AUTHOR'S REQUESTED CHANGE:\n${instruction}` +
      (focusPage
        ? `\n\nFOCUS — this is a SINGLE-PAGE prose chat about page [id=${focusPage.id}] "${focusPage.title || "(untitled)"}". Read THAT page first; keep the change to this one page (op "revise"/"rewrite" on it) unless the author explicitly asks otherwise. Use the surrounding pages only as context. Consult the author on real creative forks, then propose the revision plan.`
        : `\n\nMake this change to the book. Investigate the affected pages first, consult the author on real creative forks, then propose the revision plan.`);
  return (
    `BOOK: ${bookName}\n\nBRIEF (the voice contract):\n${briefContext(brief, { scope: "full", success: true, none: "(no brief set — infer a sensible neutral voice)", empty: "(brief is empty — infer a sensible neutral voice)" })}` +
    `\n\nCURRENT OUTLINE (real ids; read_page for full prose):\n${outlineContext(pages)}` +
    (threads.length ? `\n\nTRACKED THREADS (keep their setups & payoffs intact):\n${threadsContext(threads)}` : "") +
    directive
  );
}


// Outline with objectives + summaries for every text page (the agent reads full prose by tool).
function outlineContext(pages: PageRow[]): string {
  return pages
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      let line = p.page_type === "section"
        ? `[id=${p.id}] # ${p.title || "(untitled section)"}${obj ? ` -- ${obj}` : ""}`
        : `[id=${p.id}] - "${p.title || "(untitled)"}"${obj ? ` -- ${obj}` : ""}`;
      const sum = p.metadata?.summary?.trim();
      if (sum && p.page_type !== "section") line += `\n  [summary: ${sum}]`;
      return line;
    })
    .join("\n");
}

function threadsContext(threads: ThreadLite[]): string {
  return threads
    .map((t) => {
      const setup = t.setup_page_id != null ? ` setup@page ${t.setup_page_id}` : "";
      const payoff = t.payoff_page_id != null ? ` payoff@page ${t.payoff_page_id}` : "";
      return `- "${t.name}" (${t.status})${setup}${payoff}`;
    })
    .join("\n");
}

function evalContext(ev: EvalResult): string {
  const v = ev.verdict ?? {};
  const head = [
    v.genre_contract ? `Genre contract: ${v.genre_contract}` : "",
    v.stance ? `Stance: ${v.stance}` : "",
    v.letter ? `Editorial letter: ${v.letter}` : "",
    v.priorities?.length ? `Fix these first:\n${v.priorities.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const sections = (ev.sections ?? [])
    .map((s) => {
      const issues = (s.issues ?? [])
        .map((is) => {
          const sev = is.severity ? `[${is.severity}] ` : "";
          const page = is.page_ref?.id != null ? ` (page id ${is.page_ref.id})` : "";
          const sug = is.suggestion ? `  → ${is.suggestion}` : "";
          return `  - ${sev}${is.note}${page}${sug}`;
        })
        .join("\n");
      return `## ${s.title}${s.stance ? ` — ${s.stance}` : ""}${s.assessment ? `\n${s.assessment}` : ""}${issues ? `\n${issues}` : ""}`;
    })
    .join("\n\n");

  return `${head}\n\n${sections}`.trim();
}

