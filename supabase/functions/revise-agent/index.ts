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
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callClaude } from "../_shared/claude.ts";
import { getActiveModels } from "../_shared/model-config.ts";
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── Row shapes ──
interface AgentStep { t: "note" | "read" | "ask" | "answer" | "plan" | "done"; label: string }
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
  status: string;
  evaluation: EvalResult | null;
  transcript: unknown[];
  steps: AgentStep[];
  pending: Pending | null;
  turns: number;
  cancel_requested: boolean;
}
const ROW_COLS = "id, book_id, created_by, status, evaluation, transcript, steps, pending, turns, cancel_requested";

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
      bookId?: number; evaluation?: EvalResult; runId?: number; answer?: string; chain?: boolean;
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
      const steps = [...row.steps, { t: "answer", label: answer.slice(0, 200) } as AgentStep];
      const { error } = await service.from("book_agent_runs")
        .update({ transcript, steps, pending: null, status: "running" })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId: row.id }));
      return json({ status: "running", runId: row.id }, 202);
    }

    // Start a run: snapshot the eval + the book context into the first user message.
    const { bookId, evaluation } = body;
    if (!bookId) return json({ error: "bookId is required" }, 400);
    if (!evaluation?.verdict || !Array.isArray(evaluation.sections)) {
      return json({ error: "A valid evaluation is required" }, 400);
    }

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, brief, bible, owner_id").eq("id", bookId).single();
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

    const context = buildContext(
      book.name,
      book.brief as Brief | null,
      (book.bible as { text?: string } | null)?.text?.trim() || null,
      pages as PageRow[],
      (threads as ThreadLite[] | null) ?? [],
      evaluation,
    );

    const { data: run, error: insErr } = await service
      .from("book_agent_runs")
      .insert({
        book_id: bookId,
        created_by: user.id,
        status: "running",
        evaluation,
        transcript: [{ role: "user", content: [{ type: "text", text: context }] }],
        steps: [{ t: "note", label: "Reading the editor's notes and the outline." }],
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
    let { high: model } = await getActiveModels();
    // The agent loop REQUIRES Anthropic tool use. The DeepSeek path in _shared/claude.ts strips
    // `tools` from the request and only extracts text from the response, so under the deepseek
    // tier the model can only NARRATE the reads it wants — it can never call a tool, and the run
    // dies after one turn. Pin to a Claude model when the tier is deepseek.
    if (model.startsWith("deepseek")) model = "claude-sonnet-4-6";
    const turns = row.turns + 1;
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
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
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

    // The model's visible narration becomes the progress feed.
    for (const b of content) {
      if (b.type === "text" && String(b.text ?? "").trim()) {
        steps.push({ t: "note", label: String(b.text).trim().slice(0, 300) });
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
      await service.from("book_agent_runs").update({ status: "done", transcript, steps, report }).eq("id", runId);
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

    // ── No tool call at all: nudge once and continue (bounded by the turn budget). Ending a turn
    // with bare text is always wrong here — finish/propose_revision_plan are the only exits — and
    // silently treating narration as a report masked the deepseek-tier bug for a whole run. ──
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
      source: "evaluation",
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
const SYSTEM = `You are the editor's agent for a book-writing studio. A developmental editor has evaluated the author's book; your job is to ADDRESS those notes — like a trusted human collaborator would: investigate first, involve the author in the creative forks, then propose a surgical revision plan.

You are given the brief, the bible, the CURRENT outline (each page with its real [id], type, title, objective, and summary), tracked threads, and the editor's full evaluation.

METHOD — work in this order:
1. TRIAGE the notes. Group them by root cause: several notes often share one fix (e.g. "the heroine is passive in the climax" + "her core wound is never confronted" may be one new scene). The verdict's priorities ("fix these first") are the highest-leverage changes.
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

// ── Context builders (mirror revise-outline) ─────────────────────────────────
interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}
interface ThreadLite { name: string; status: string; setup_page_id: number | null; payoff_page_id: number | null }

function buildContext(
  bookName: string,
  brief: Brief | null,
  bible: string | null,
  pages: PageRow[],
  threads: ThreadLite[],
  evaluation: EvalResult,
): string {
  return (
    `BOOK: ${bookName}\n\nBRIEF (the voice contract):\n${briefContext(brief)}` +
    (bible ? `\n\nBOOK BIBLE (established facts):\n${bible}` : "") +
    `\n\nCURRENT OUTLINE (real ids; read_page for full prose):\n${outlineContext(pages)}` +
    (threads.length ? `\n\nTRACKED THREADS (keep their setups & payoffs intact):\n${threadsContext(threads)}` : "") +
    `\n\nEDITOR'S EVALUATION (the notes to address):\n${evalContext(evaluation)}` +
    `\n\nAddress the editor's notes. Investigate first, consult the author on real creative forks, then propose the revision plan.`
  );
}

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — infer a sensible neutral voice)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}${brief.scope.word_target ? ` (≈${brief.scope.word_target} words)` : ""}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible neutral voice)";
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

// Minimal Tiptap JSON → plain text (mirrors evaluate-book).
function tiptapToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  let out = "";
  for (const child of n.content ?? []) out += tiptapToText(child);
  if (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(n.type ?? "")) out += "\n\n";
  return out;
}
