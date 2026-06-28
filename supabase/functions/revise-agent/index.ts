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
// The content schema the agent must conform to — GENERATED from the web app's NODE_SCHEMA (single source of
// truth), kept in sync by apps/web/.../dnaSchema.artifact.test.ts. Never hand-edit; edit NODE_SCHEMA + regen.
import dnaSchema from "../_shared/dna-schema.json" with { type: "json" };
import { tiptapToText } from "../_shared/words.ts";
import { serviceClient } from "../_shared/task.ts";
import { reinvoke, isChainCall } from "../_shared/self-chain.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";
import { sanitizePlan, type RevisionPlan } from "../_shared/revision-plan.ts";
import { judgeProse } from "../_shared/mandate-gate.ts";

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
// A node op over book_nodes — the DNA substrate's edit/add/delete/replace_children (mirrors lib/dnaChat.ts).
interface NewSubtree { content: Record<string, unknown>; children?: NewSubtree[] }
type NodeOp =
  | { op: "edit"; id: string; content: Record<string, unknown> }
  | { op: "add"; kind: string; parentId: string; content: Record<string, unknown> }
  | { op: "delete"; id: string }
  // Rebuild a level: delete the parent's existing non-locked `childKind` children (cascade), add `children` fresh.
  | { op: "replace_children"; parentId: string; childKind: string; children: NewSubtree[] };

// A reviewable change the agent proposes against the DNA tree; the author applies it (applyNodeOps)
// through the existing book_nodes write path (docs/agent-rail.md). One layer now: the DNA tree.
interface AgentProposal { id: string; layer: "dna"; summary: string; ops: NodeOp[] }

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
  proposals: AgentProposal[] | null;
  context_scope: Aspect[] | null; // thread scope (docs/agent-rail.md): null = whole book
  context_analysis: string | null; // latest client-computed story analysis (backstop)
  turns: number;
  cancel_requested: boolean;
}
const ROW_COLS = "id, book_id, created_by, kind, status, evaluation, transcript, steps, pending, proposals, context_scope, context_analysis, turns, cancel_requested";

// The context filter's aspects ARE the DNA journey stages. null/[] scope = all.
type Aspect = "premise" | "foundations" | "structure" | "scenes" | "draft";
const ASPECTS: Aspect[] = ["premise", "foundations", "structure", "scenes", "draft"];

// Which book_nodes kinds each stage covers (scenes = scene structure, draft = scene prose — both scene
// nodes). Mirrors lib/agentThread.ts ASPECT_KINDS + dna-chat STAGE_KINDS.
const ASPECT_KINDS: Record<Aspect, string[]> = {
  premise: ["seed", "premise"],
  foundations: ["pillar", "character", "relationship", "tentpole", "world_fact", "voice_profile"],
  structure: ["movement", "beat", "thread", "game"],
  scenes: ["scene"],
  draft: ["scene"],
};
// The set of node kinds in scope (null/[] = every kind). Used to filter context AND fence which nodes
// the agent may write ops against.
function scopedKinds(scope: Aspect[] | null): Set<string> | null {
  if (!scope || scope.length === 0) return null;
  const s = new Set<string>();
  for (const a of scope) for (const k of ASPECT_KINDS[a]) s.add(k);
  return s;
}
const ALL_NODE_KINDS = ["seed", "premise", "pillar", "movement", "beat", "scene", "character", "relationship", "tentpole", "world_fact", "thread", "game", "voice_profile"];

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
      message?: string; scope?: string[]; analysis?: string;
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

      // The aspects the agent may see + touch this turn (null = whole book).
      const scope: Aspect[] | null = Array.isArray(body.scope) && body.scope.length
        ? (body.scope.filter((s): s is Aspect => (ASPECTS as string[]).includes(s)))
        : null;
      // The client-computed story analysis (the engine lives in the web app) — refreshed this turn.
      const analysis: string | null = typeof body.analysis === "string" && body.analysis.trim() ? body.analysis.trim() : null;

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
            context_scope: scope,
            context_analysis: analysis,
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
        .update({ transcript, steps, status: "running", turns: 0, pending: null, error: null, cancel_requested: false, context_scope: scope, context_analysis: analysis })
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
    const scope = row.context_scope;
    const system = isThread ? await threadSystem(service, row.book_id, scope, row.context_analysis) : SYSTEM;
    const tools = isThread ? threadToolsFor(scope) : TOOLS;
    // Count the turn BEFORE the call: a hard worker death mid-call still consumes budget, so a
    // crash-looping run hits MAX_TURNS instead of being revived forever by the watchdog.
    // Re-write `steps` (unchanged) alongside `turns` so this mid-"thinking" Realtime event carries the
    // steps column — otherwise Postgres omits the unchanged TOASTed jsonb from the WAL new-tuple and the
    // client's row arrives with steps=null, blanking the feed. (REPLICA IDENTITY FULL is the broader fix.)
    await service.from("book_agent_runs").update({ turns, steps: row.steps }).eq("id", runId);

    // Poll for cancel_requested every 5s during the call so a user stop aborts the in-flight
    // Claude request rather than waiting up to CALL_TIMEOUT_MS for it to finish naturally.
    const cancelCtrl = new AbortController();
    const cancelPoll = setInterval(async () => {
      const { data: cr } = await service.from("book_agent_runs").select("cancel_requested").eq("id", runId).maybeSingle();
      if ((cr as { cancel_requested?: boolean } | null)?.cancel_requested) cancelCtrl.abort("cancel_requested");
    }, 5000);
    const callSignal = AbortSignal.any([AbortSignal.timeout(CALL_TIMEOUT_MS), cancelCtrl.signal]);

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
      }, { signal: callSignal });
    } catch (e) {
      clearInterval(cancelPoll);
      // User cancelled mid-call: mark the row and exit cleanly.
      if (cancelCtrl.signal.aborted && cancelCtrl.signal.reason === "cancel_requested") {
        await service.from("book_agent_runs").update({ status: "cancelled" }).eq("id", runId);
        return;
      }
      if (isBillingError(e)) throw e; // won't recover — fail the run
      // Transient API failure/timeout: chain again (turn budget already spent bounds retries).
      console.error(`revise-agent run ${runId} call failed (turn ${turns}), retrying:`, e);
      await sleep(2000);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId }));
      return;
    }
    clearInterval(cancelPoll);

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

    // ── propose_node_ops (thread): record a reviewable DNA change and end the turn ──
    // A thread proposal lands in proposals[]; the author applies it from the rail via applyNodeOps
    // (the existing book_nodes write path). Validated against the live tree + the scope fence.
    const opsCall = toolUses.find((t) => t.name === "propose_node_ops");
    if (opsCall) {
      const outcome = await proposeNodeOps(service, row.book_id, scope, opsCall.input as { summary?: string; ops?: unknown[] });
      if (outcome.ok) {
        steps.push({ t: "plan", label: outcome.proposal.summary });
        const proposals = [...(row.proposals ?? []), outcome.proposal];
        await service.from("book_agent_runs")
          .update({ status: "idle", transcript, steps, proposals }).eq("id", runId);
        return; // the agent's narration is the reply; the proposal waits for the author
      }
      const results = await toolResults(service, row.book_id, toolUses, steps, {
        [opsCall.id]: `The change was rejected: ${outcome.error} Fix it and call propose_node_ops again, or just reply.`,
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
    } else if (t.name === "read_node") {
      const id = String((t.input as { id?: string })?.id ?? "");
      const { data: node } = await service
        .from("book_nodes").select("id, kind, content, authoring, book_id").eq("id", id).maybeSingle();
      if (!node || (node as { book_id?: number }).book_id !== bookId) {
        results.push({ type: "tool_result", tool_use_id: t.id, content: `No node with id ${id} in this book.`, is_error: true });
        continue;
      }
      const n = node as { id: string; kind: string; content: Record<string, unknown>; authoring: { locked?: boolean } };
      // Children (one level down) as a summary so the agent can navigate without re-reading everything.
      const { data: kids } = await service
        .from("book_nodes").select("id, kind, content").eq("book_id", bookId).eq("parent_id", id).order("position", { ascending: true });
      const childLines = (kids ?? []).map((k) => `  - [${(k as { id: string }).id}] ${(k as { kind: string }).kind}: ${nodeHandle((k as { content: Record<string, unknown> }).content)}`).join("\n");
      steps.push({ t: "read", label: `Read ${n.kind} “${nodeHandle(n.content)}” in full.` });
      results.push({
        type: "tool_result", tool_use_id: t.id,
        content: `[${n.id}${n.authoring?.locked ? " · LOCKED" : ""}] ${n.kind}: ${JSON.stringify(n.content)}` + (childLines ? `\nchildren:\n${childLines}` : ""),
      });
    } else if (t.name === "render_scene_prose") {
      const id = String((t.input as { id?: string })?.id ?? "");
      const { data: node } = await service
        .from("book_nodes").select("id, kind, content, authoring, book_id").eq("id", id).maybeSingle();
      if (!node || (node as { book_id?: number }).book_id !== bookId) {
        results.push({ type: "tool_result", tool_use_id: t.id, content: `No node with id ${id} in this book.`, is_error: true });
        continue;
      }
      const n = node as { id: string; kind: string; content: Record<string, unknown>; authoring: Record<string, unknown> };
      if (n.kind !== "scene") {
        results.push({ type: "tool_result", tool_use_id: t.id, content: `Node ${id} is a ${n.kind}, not a scene — only scenes have prose.`, is_error: true });
        continue;
      }
      // Render via the deployed dna-expand (the single source of the DNA prose pipeline), authenticated
      // server-to-server with the chain secret, then persist the prose to the scene node.
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/dna-expand`;
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
            "x-chain": Deno.env.get("CHAIN_SECRET") ?? "",
          },
          body: JSON.stringify({ bookId, nodeId: id, target: "prose", light: true }),
        });
        const out = (await resp.json().catch(() => ({}))) as { prose?: string; error?: string };
        const prose = (out.prose ?? "").trim();
        if (!resp.ok || out.error || !prose) {
          results.push({ type: "tool_result", tool_use_id: t.id, content: `Render failed: ${out.error ?? `status ${resp.status}`}`, is_error: true });
          continue;
        }
        const words = prose.split(/\s+/).filter(Boolean).length;
        await service.from("book_nodes").update({
          content: { ...n.content, prose: { text: prose, words } },
          authoring: { ...n.authoring, source: n.authoring.source === "user" ? "ai_then_user" : "ai", status: "accepted" },
        }).eq("id", id);
        steps.push({ t: "read", label: `Drafted prose for scene “${nodeHandle(n.content)}” (${words} words).` });
        results.push({ type: "tool_result", tool_use_id: t.id, content: `Rendered ${words} words and saved to scene ${id}. Prose:\n\n${prose.slice(0, MAX_PAGE_CHARS)}` });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: t.id, content: `Render failed: ${String((e as Error)?.message ?? e)}`, is_error: true });
      }
    } else if (t.name === "check_against_contract") {
      const id = String((t.input as { id?: string })?.id ?? "");
      const { data: node } = await service
        .from("book_nodes").select("id, kind, content, book_id").eq("id", id).maybeSingle();
      if (!node || (node as { book_id?: number }).book_id !== bookId) {
        results.push({ type: "tool_result", tool_use_id: t.id, content: `No node with id ${id} in this book.`, is_error: true });
        continue;
      }
      const n = node as { id: string; kind: string; content: { prose?: { text?: string }; goal?: string } };
      const proseText = (n.content?.prose?.text ?? "").trim();
      if (n.kind !== "scene") {
        results.push({ type: "tool_result", tool_use_id: t.id, content: `Node ${id} is a ${n.kind}, not a scene — only scene prose can be checked against the contract.`, is_error: true });
        continue;
      }
      if (!proseText) {
        results.push({ type: "tool_result", tool_use_id: t.id, content: `Scene ${id} has no prose yet (content.prose.text is empty). Render or write the scene before checking it.`, is_error: true });
        continue;
      }
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) {
        results.push({ type: "tool_result", tool_use_id: t.id, content: "Contract check unavailable: ANTHROPIC_API_KEY not configured.", is_error: true });
        continue;
      }
      const { data: book } = await service.from("books").select("brief").eq("id", bookId).maybeSingle();
      const brief = ((book as { brief?: Brief } | null)?.brief ?? {}) as Brief;
      const { high: model } = await getActiveModels();
      try {
        const axes = await judgeProse(apiKey, model, brief, proseText, { fn: "revise-agent-contract", bookId, taskTable: "book_agent_runs", taskId: null, userId: null });
        const summary = axes.map((a) => `${a.axis}: ${a.verdict.toUpperCase()} — ${a.detail}${a.evidence ? ` (e.g. "${a.evidence}")` : ""}`).join("\n");
        steps.push({ t: "read", label: `Checked scene “${nodeHandle(n.content)}” against the brief contract.` });
        results.push({ type: "tool_result", tool_use_id: t.id, content: summary || "The judge returned no axes — inspect by hand." });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: t.id, content: `Contract check failed: ${String((e as Error)?.message ?? e)}`, is_error: true });
      }
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

// ── Thread mode = the DNA omni-rail (docs/agent-rail.md) ──────────────────────
// The agent holds the book's DNA tree (book_nodes), discusses it, and proposes node ops the author
// reviews and applies. The context filter (scope) fences which node kinds it sees AND may write.
interface DnaNodeRow { id: string; parent_id: string | null; kind: string; level: number; content: Record<string, unknown>; authoring: { locked?: boolean; status?: string } | null }

// A short human handle for a node (mirror of lib/dnaChat nodeLabel) for read summaries + step labels.
function nodeHandle(content: Record<string, unknown> | null | undefined): string {
  const c = content ?? {};
  const h = c.name ?? c.title ?? c.logline ?? c.summary ?? c.goal;
  return typeof h === "string" && h.trim() ? h.trim().slice(0, 60) : "(untitled)";
}

const THREAD_DNA_TOOLS = [
  {
    name: "render_scene_prose",
    description: "Generate (draft) the PROSE for a scene from its plan, in the book's voice, and save it to the scene's content.prose.text. Pass the scene node's id. Use this to draft a scene the author asked you to write, or before checking it against the contract. Returns the drafted prose. Overwrites any existing prose on that scene, so confirm with the author first if the scene already has prose you'd be replacing.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "The scene node's id." } }, required: ["id"] },
  },
  {
    name: "check_against_contract",
    description: "Judge a scene's PROSE against the book's brief mandate (genre, heat, success criteria). Pass the scene node's id; the scene must already have prose (content.prose.text) — render or write it first if it's empty. Returns a per-axis verdict (pass / partial / fail) with evidence, so you can tell the author whether the draft delivers what the brief promised. Read the scene first if you haven't.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "The scene node's id." } }, required: ["id"] },
  },
  {
    name: "read_node",
    description: "Read one DNA node's FULL content by id — including a scene's prose (content.prose.text) and a one-line summary of its children. The tree summary you're given strips prose to stay lean; use this to read a scene in full before judging or rewriting it.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "The node's id from the tree." } }, required: ["id"] },
  },
  {
    name: "propose_node_ops",
    description: "Propose a concrete change to the DNA tree the author reviews before it's applied: edit / add / delete / replace_children nodes by their real ids. This records the proposal and ENDS your turn — narrate what you're changing and why just before calling it. Only touch nodes whose kind is in scope; never touch a LOCKED node. To REBUILD a whole level (replace all acts, or all beats under an act), use replace_children — NOT a pile of `add` ops, which would duplicate what's already there.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One line: what this change does." },
        ops: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["edit", "add", "delete", "replace_children"] },
              id: { type: "string", description: "edit/delete: the existing node id." },
              kind: { type: "string", description: "add: the new node's kind (character|relationship|tentpole|world_fact|thread|game|movement|beat|scene|voice_profile)." },
              parentId: { type: "string", description: "add / replace_children: the existing parent node's id (e.g. the pillar, whose movement children are the acts)." },
              childKind: { type: "string", description: "replace_children: which child kind to rebuild (e.g. 'movement' to replace all acts, 'beat' to replace an act's beats)." },
              content: { type: "object", description: "edit: the fields to merge. add: the new node's content. Use the exact field names from the schema given.", additionalProperties: true },
              children: { type: "array", description: "replace_children: the NEW children as a nested tree — each { content, children? }; nesting follows the ladder (movement→beat→scene). Every existing non-locked child of childKind is deleted first, so the rebuild never duplicates.", items: { type: "object", additionalProperties: true } },
            },
            required: ["op"],
          },
        },
      },
      required: ["summary", "ops"],
    },
  },
];

// The thread tool belt: ask_author always; read_node + propose_node_ops whenever ANY aspect is in
// scope (the per-op kind fence does the fine-grained gating). null/[] scope = all.
function threadToolsFor(_scope: Aspect[] | null): unknown[] {
  return [TOOLS.find((t) => t.name === "ask_author")!, ...THREAD_DNA_TOOLS];
}

const CONTENT_SCHEMAS = dnaSchema.promptGuide;

const SYSTEM_THREAD = `You are a sharp, warm developmental STORY EDITOR — the author's single AI collaborator for the whole book, in conversation in the studio's right-hand rail.

You hold the book's DNA TREE: premise → foundations (pillar, cast, world, tentpoles, voice) → structure (movements, beats, threads) → scenes → prose. The tree below is FILTERED to the aspects in scope for this conversation, and prose is stripped to stay lean — use read_node to read a scene's full prose before judging or rewriting it.

You can do three things:
1. DISCUSS — answer, summarize, pressure-test. Reply in plain MARKDOWN prose and just end your turn (no tool needed). Be concrete, grounded in the real tree, referencing nodes by their [id].
2. CHANGE THE TREE — when the author asks for a change (or agrees to one), call propose_node_ops with edit/add/delete ops over the real ids. The author reviews the diff and applies it; descendants of an edited node go stale and are regenerated later. ONLY touch nodes whose kind is in scope; NEVER touch a LOCKED node. Don't propose unless asked — talk first.
3. DRAFT & CHECK PROSE — call render_scene_prose with a scene's [id] to draft (or redraft) its prose from its plan, in the book's voice (it saves to the scene and returns the text). Call check_against_contract with a scene's [id] to judge its existing prose against the brief mandate (genre, heat, voice, success criteria) and get a per-axis verdict you relay to the author. A common request — "write the first scene and see if it meets the brief" — is render_scene_prose then check_against_contract on the same scene. render OVERWRITES existing prose, so if a scene already has prose, confirm before redrafting.
   • REBUILDS: to replace a whole level — "rebuild the acts", "4 movements with all-new beats" — use ONE replace_children op (parentId = the level's parent, e.g. the pillar for acts; childKind = movement; children = the new movements, each nesting its beats). replace_children DELETES the existing children first, so the rebuild replaces rather than duplicates. Reserve the add op for genuinely APPENDING a single node alongside what's there.

${CONTENT_SCHEMAS}

Be tight. Don't propose changes the author didn't ask for; when they're just talking, just talk.`;

// Keep only { content, children } from a model-proposed subtree (drop stray op/kind/id fields the model
// may emit), recursively — the shape applyNodeOps expects for a replace_children rebuild.
function sanitizeSubtree(subs: unknown[]): NewSubtree[] {
  const out: NewSubtree[] = [];
  for (const s of Array.isArray(subs) ? subs : []) {
    if (!s || typeof s !== "object") continue;
    const sub = s as { content?: Record<string, unknown>; children?: unknown[] };
    if (!sub.content || typeof sub.content !== "object") continue;
    const kids = Array.isArray(sub.children) ? sanitizeSubtree(sub.children) : [];
    out.push(kids.length ? { content: sub.content, children: kids } : { content: sub.content });
  }
  return out;
}

// Validate proposed ops against the LIVE tree + the scope fence; build the reviewable proposal. Mirrors
// dna-chat's parser: ids must exist, never LOCKED, add-kinds valid, and every touched kind in scope.
async function proposeNodeOps(
  service: SupabaseClient,
  bookId: number,
  scope: Aspect[] | null,
  input: { summary?: string; ops?: unknown[] },
): Promise<{ ok: true; proposal: AgentProposal } | { ok: false; error: string }> {
  const { data: rows } = await service.from("book_nodes").select("id, kind, authoring").eq("book_id", bookId);
  const nodes = (rows ?? []) as { id: string; kind: string; authoring: { locked?: boolean } | null }[];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kinds = scopedKinds(scope); // null = all kinds allowed
  const allowed = (kind: string) => !kinds || kinds.has(kind);

  const ops: NodeOp[] = [];
  for (const raw of Array.isArray(input.ops) ? input.ops : []) {
    const o = raw as { op?: string; id?: string; kind?: string; childKind?: string; parentId?: string; content?: Record<string, unknown>; children?: unknown[] };
    if (o.op === "edit" && o.id && byId.has(o.id) && !byId.get(o.id)!.authoring?.locked && allowed(byId.get(o.id)!.kind) && o.content) {
      ops.push({ op: "edit", id: o.id, content: o.content });
    } else if (o.op === "delete" && o.id && byId.has(o.id) && !byId.get(o.id)!.authoring?.locked && allowed(byId.get(o.id)!.kind)) {
      ops.push({ op: "delete", id: o.id });
    } else if (o.op === "add" && o.parentId && byId.has(o.parentId) && o.kind && ALL_NODE_KINDS.includes(o.kind) && allowed(o.kind) && o.content) {
      ops.push({ op: "add", kind: o.kind, parentId: o.parentId, content: o.content });
    } else if (o.op === "replace_children" && o.parentId && byId.has(o.parentId) && !byId.get(o.parentId)!.authoring?.locked && o.childKind && ALL_NODE_KINDS.includes(o.childKind) && allowed(o.childKind) && Array.isArray(o.children) && o.children.length) {
      const children = sanitizeSubtree(o.children);
      if (children.length) ops.push({ op: "replace_children", parentId: o.parentId, childKind: o.childKind, children });
    }
  }
  if (ops.length === 0) {
    return { ok: false, error: kinds ? `No valid ops — every op must target a non-locked node whose kind is in scope (${scope!.join(", ")}), or add a child of one.` : "No valid ops — reference real, non-locked node ids." };
  }
  return { ok: true, proposal: { id: crypto.randomUUID(), layer: "dna", summary: String(input.summary ?? "Proposed change").trim() || "Proposed change", ops } };
}

// The thread's system prompt carries the CURRENT DNA tree, FILTERED to the in-scope kinds and rebuilt
// every call so ids stay fresh as the author edits (the transcript holds only the conversation). Prose
// is always stripped (read_node fetches it). A one-line premise/pillar frame is always included so the
// agent is grounded even when 'premise' isn't in scope.
async function threadSystem(service: SupabaseClient, bookId: number, scope: Aspect[] | null, analysis: string | null): Promise<string> {
  const { data: book } = await service.from("books").select("name, brief").eq("id", bookId).maybeSingle();
  const b = book as { name?: string; brief?: Brief } | null;
  const { data: rows } = await service
    .from("book_nodes").select("id, parent_id, kind, level, content, authoring").eq("book_id", bookId);
  const nodes = (rows ?? []) as DnaNodeRow[];
  const kinds = scopedKinds(scope); // null = all

  const serialize = (n: DnaNodeRow): string => {
    let content = n.content;
    if (n.kind === "scene" && content && typeof content === "object" && "prose" in content) {
      const { prose: _drop, ...rest } = content as Record<string, unknown>;
      content = rest; // prose is heavy — read_node fetches it
    }
    return `[${n.id}${n.authoring?.locked ? " · LOCKED" : ""}] L${n.level} ${n.kind}: ${JSON.stringify(content)}`;
  };

  const inTree = nodes.filter((n) => !kinds || kinds.has(n.kind)).sort((a, b) => a.level - b.level);
  const tree = inTree.map(serialize).join("\n");

  // Always-on grounding frame: the premise logline + pillar controlling idea (one line each), even when
  // 'premise' isn't scoped, so the agent knows what book it's editing.
  const frame: string[] = [];
  if (kinds) {
    const premise = nodes.find((n) => n.kind === "premise");
    const pillar = nodes.find((n) => n.kind === "pillar");
    if (premise) frame.push(`premise: ${nodeHandle(premise.content)}`);
    if (pillar?.content?.controlling_idea) frame.push(`controlling idea: ${String(pillar.content.controlling_idea).slice(0, 160)}`);
  }

  const blocks = [
    `BOOK: ${b?.name ?? ""}`,
    `BRIEF (binding voice contract): ${briefContext(b?.brief ?? null, { scope: "full", success: true, none: "(no brief)", empty: "(empty)" })}`,
    frame.length ? `FOR GROUNDING (not necessarily in scope):\n${frame.join("\n")}` : "",
    // The structural backstop (pacing / dangling-promise / sagging-run lints) — act on any ⚠ flags.
    analysis?.trim() ? `STORY ANALYSIS (the structural backstop — address any ⚠ flags):\n${analysis.trim()}` : "",
    `THE DNA TREE${kinds ? ` (in scope: ${[...kinds].join(", ")})` : ""} — edit/add/delete by these ids; LOCKED = immutable:\n${tree || "(no nodes in scope yet)"}`,
  ].filter(Boolean);

  const scopeLine = scope && scope.length ? `\n\nIN SCOPE THIS CONVERSATION: ${scope.join(", ")}. Only propose changes to these aspects.` : "";
  return `${SYSTEM_THREAD}${scopeLine}\n\n${blocks.join("\n\n")}`;
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

