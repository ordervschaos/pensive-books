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
const AUTO_MAX_TURNS = 50;     // autonomous threads iterate change-by-change, so they get a higher ceiling
// One call must finish inside the ~150s worker wall clock (with headroom for the row writes and
// the chain dispatch). An abort still BILLS — the API keeps generating after we hang up — so the
// real defense is keeping turns short (effort: medium below), not this timer.
const CALL_TIMEOUT_MS = 140_000;
const ACK_TIMEOUT_MS = 15_000; // fast chat acknowledgement; the real tool turn follows
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
// layer 'dna' = node ops the author applies to book_nodes. layer 'prose-render' = a request to (re)generate
// scene prose; ops is empty and sceneIds names the scenes — the AUTHOR applies it and the prose streams in
// their browser via the v2 pipeline (docs/agent-context-model.md). The agent never generates prose itself.
interface AgentProposal { id: string; layer: "dna" | "prose-render"; summary: string; ops: NodeOp[]; sceneIds?: string[] }

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
  context_effort: "low" | "high" | null; // null = high (default)
  context_auto: boolean | null; // auto-accept mode: run autonomously, never park on ask_author
  turns: number;
  cancel_requested: boolean;
}
const ROW_COLS = "id, book_id, created_by, kind, status, evaluation, transcript, steps, pending, proposals, context_scope, context_analysis, context_effort, context_auto, turns, cancel_requested";

// Context filter aspects mirror the DNA tree's visual layers. null/[] scope = all.
type Aspect = "seed" | "premise" | "cast_world" | "story" | "prose";
const ASPECTS: Aspect[] = ["seed", "premise", "cast_world", "story", "prose"];

// Which book_nodes kinds each aspect covers. Mirrors lib/agentThread.ts ASPECT_KINDS.
const ASPECT_KINDS: Record<Aspect, string[]> = {
  seed: ["seed"],
  premise: ["premise"],
  cast_world: ["pillar", "character", "relationship", "tentpole", "world_fact", "location", "thread", "game", "voice_profile"],
  story: ["act", "beat", "scene"],
  prose: ["scene"],
};
// The set of node kinds in scope (null/[] = every kind). Used to filter context AND fence which nodes
// the agent may write ops against.
function scopedKinds(scope: Aspect[] | null): Set<string> | null {
  if (!scope || scope.length === 0) return null;
  const s = new Set<string>();
  for (const a of scope) for (const k of ASPECT_KINDS[a]) s.add(k);
  return s;
}
const ALL_NODE_KINDS = ["seed", "premise", "pillar", "act", "beat", "scene", "character", "relationship", "tentpole", "world_fact", "location", "thread", "game", "voice_profile"];

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
      bookId?: number; evaluation?: EvalResult; instruction?: string; targetPageId?: number; runId?: number; answer?: string; chain?: boolean; autoContinue?: boolean;
      message?: string; scope?: string[]; analysis?: string; effort?: "low" | "high"; auto?: boolean;
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

    // Auto-accept LIVE loop: the client applied the agent's last staged change to the tree and is asking us
    // to resume the run, so the agent's next turn reads the updated tree. Pure status flip + chain — no
    // transcript edit (the transcript already ends with the propose_node_ops tool_result the model replies
    // to) and NO turns reset, so MAX_TURNS still bounds the whole autonomous instruction.
    if (body.runId && body.autoContinue) {
      const { data } = await userClient.from("book_agent_runs").select(ROW_COLS).eq("id", body.runId).maybeSingle();
      const row = data as RunRow | null;
      if (!row) return json({ error: "Run not found" }, 404);
      const { data: canEdit } = await userClient.rpc("user_can_edit_book", { _book_id: row.book_id });
      if (canEdit === false) return json({ error: "Access denied" }, 403);
      if (row.kind !== "thread" || !row.context_auto) return json({ error: "Not an autonomous thread" }, 409);
      if (row.status !== "idle") return json({ status: row.status, runId: row.id }, 202); // already running/parked — nothing to resume
      await service.from("book_agent_runs").update({ status: "running" }).eq("id", row.id);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId: row.id }));
      return json({ status: "running", runId: row.id }, 202);
    }

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
      // Effort: "low" = propose inline on first response without exploring; "high" (default) = full tool loop.
      const effort: "low" | "high" = body.effort === "low" ? "low" : "high";
      // Auto-accept: run autonomously — the agent commits its own picks and never parks on ask_author; the
      // client auto-applies the proposals it stages. Carried on the run so every chain link sees it.
      const auto: boolean = body.auto === true;

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
            context_effort: effort,
            context_auto: auto,
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
        .update({ transcript, steps, status: "running", turns: 0, pending: null, error: null, cancel_requested: false, context_scope: scope, context_analysis: analysis, context_effort: effort, context_auto: auto })
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
  // Autonomous threads iterate one change per turn (plus a read or two), so they need a higher ceiling than
  // a single eval pass — but still bounded so a runaway can't loop forever.
  const auto = row.kind === "thread" && !!row.context_auto;
  const maxTurns = auto ? AUTO_MAX_TURNS : MAX_TURNS;
  if (row.turns >= maxTurns) {
    await service.from("book_agent_runs")
      .update({ status: "error", error: `The agent ran past ${maxTurns} turns without finishing — stopped as a safety measure.` })
      .eq("id", runId);
    return;
  }

  try {
    // Any tier works here: _shared/claude.ts converts tools/tool_use/tool_result both ways for
    // the OpenAI-compatible paths (DeepSeek, MuleRouter/Qwen), so the loop runs on cheap models too.
    const { high: model, low: ackModel } = await getActiveModels();
    // Thread runs are the persistent omni-rail conversation: a conversational system prompt grounded
    // in the CURRENT book state (rebuilt per call so ids stay fresh), and the thread tool belt. Eval
    // runs keep the static plan-first system + tools.
    const isThread = row.kind === "thread";
    if (isThread && row.turns === 0) {
      await maybeEagerAck(service, apiKey, row, ackModel);
    }
    const turns = row.turns + 1;
    // Boundaries removed (docs/agent-context-model.md): the agent always sees + may touch the whole book.
    // Forced null here (not row.context_scope) so even threads created under the old aspect-fence run
    // unfenced from now on; context is anchored by attached nodes, not filtered by kind.
    const scope: Aspect[] | null = null;
    const effort = row.context_effort ?? "high";
    // `auto` (autonomous mode: never park, commit own picks) computed above for the turn ceiling.
    const system = isThread ? await threadSystem(service, row.book_id, scope, row.context_analysis, effort, auto) : SYSTEM;
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
      // 4xx = bad request / model not found — not transient, fail immediately.
      const errMsg = (e instanceof Error ? e.message : String(e));
      if (/API 4\d\d:/.test(errMsg)) {
        await service.from("book_agent_runs").update({ status: "error", error: errMsg.slice(0, 500) }).eq("id", runId);
        return;
      }
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

    // OpenAI (GPT) requires a role:"tool" message for EVERY tool_call in an assistant message —
    // even for terminal calls (propose_node_ops, finish, etc.) that end the turn. Claude's API is
    // lenient (end_turn closes open calls implicitly), but GPT will error on the next user message
    // if any prior tool_call has no corresponding result. We inject synthetic ACK results for every
    // tool_use whose id is NOT covered by a real toolResults() call, then append them once per turn
    // ONLY when the run ends without a live toolResults() append (i.e. the terminal success paths).
    // deno-lint-ignore no-explicit-any
    const ackResults = (toolIds: string[]) => toolIds.map((id) => ({ type: "tool_result", tool_use_id: id, content: "ok" }));

    // ── Terminal tools first: a valid plan or a finish ends the run ──
    const planCall = toolUses.find((t) => t.name === "propose_revision_plan");
    if (planCall) {
      const outcome = await proposePlan(service, row, planCall.input as Partial<RevisionPlan>);
      if (outcome.ok) {
        steps.push({ t: "plan", label: outcome.summary });
        transcript.push({ role: "user", content: ackResults(toolUses.map((t) => t.id)) });
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
      }, auto);
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
        if (auto) {
          // Autonomous + LIVE apply: end the turn (idle) so the CLIENT applies these ops to book_nodes right
          // now, then resumes the run (the autoContinue call). One change per turn — the agent's NEXT turn
          // reads the UPDATED tree, so each change is visible before it proposes the next. The tool_result
          // tells it the change landed so it either continues or finishes (a real conclusion, not a dead stop).
          const ack = toolUses.map((t) => ({
            type: "tool_result", tool_use_id: t.id,
            content: t.id === opsCall.id
              ? "✓ Applied to the tree (autonomous mode — no review step). Your next turn will show the updated tree above. Propose the next change if the request needs more, or call finish with a one-line summary to conclude."
              : "ok",
          }));
          transcript.push({ role: "user", content: ack });
          await service.from("book_agent_runs").update({ status: "idle", transcript, steps, proposals }).eq("id", runId);
          return;
        }
        transcript.push({ role: "user", content: ackResults(toolUses.map((t) => t.id)) });
        await service.from("book_agent_runs")
          .update({ status: "idle", transcript, steps, proposals }).eq("id", runId);
        return; // the agent's narration is the reply; the proposal waits for the author
      }
      const results = await toolResults(service, row.book_id, toolUses, steps, {
        [opsCall.id]: `The change was rejected: ${outcome.error} Fix it and call propose_node_ops again, or just reply.`,
      }, auto);
      transcript.push({ role: "user", content: results });
      await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId }));
      return;
    }

    // ── propose_prose_render (thread): stage a "render prose" request and end the turn ──
    // The agent never generates prose itself (it's a long browser-streamed render); this records the
    // request in proposals[] and the AUTHOR applies it — the prose then streams in their browser via the
    // v2 pipeline (docs/agent-context-model.md). Same review channel as propose_node_ops.
    const renderCall = toolUses.find((t) => t.name === "propose_prose_render");
    if (renderCall) {
      const outcome = await proposeProseRender(service, row.book_id, renderCall.input as { summary?: string; sceneIds?: unknown });
      if (outcome.ok) {
        steps.push({ t: "plan", label: outcome.proposal.summary });
        const proposals = [...(row.proposals ?? []), outcome.proposal];
        const ack = auto
          ? `✓ Render requested and applied (autonomous mode — the scene prose was (re)generated in the author's browser). Your next turn will show the updated scene; continue if more is needed, or call finish.`
          : null;
        transcript.push({ role: "user", content: ack
          ? toolUses.map((t) => ({ type: "tool_result", tool_use_id: t.id, content: t.id === renderCall.id ? ack : "ok" }))
          : ackResults(toolUses.map((t) => t.id)) });
        await service.from("book_agent_runs").update({ status: "idle", transcript, steps, proposals }).eq("id", runId);
        return; // the proposal waits for the author to apply (the prose render runs client-side)
      }
      const results = await toolResults(service, row.book_id, toolUses, steps, {
        [renderCall.id]: `The render request was rejected: ${outcome.error} Fix it and call propose_prose_render again, or just reply.`,
      }, auto);
      transcript.push({ role: "user", content: results });
      await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId }));
      return;
    }

    // ── propose_options (thread): stage 2–4 alternatives ON the node and end the turn ──
    // The candidates land on book_nodes.proposals (NOT the run's proposals[]) — the tree's picker renders
    // them and chooseProposal commits one. The agent's narration is the reply; the pick waits for the author.
    const optionsCall = toolUses.find((t) => t.name === "propose_options");
    if (optionsCall) {
      const outcome = await proposeOptions(service, row.book_id, scope, optionsCall.input as { nodeId?: string; note?: string; options?: unknown[] });
      if (outcome.ok) {
        steps.push({ t: "plan", label: `Staged ${outcome.count} options for "${outcome.handle}" — pick one in the tree.` });
        transcript.push({ role: "user", content: ackResults(toolUses.map((t) => t.id)) });
        await service.from("book_agent_runs").update({ status: "idle", transcript, steps }).eq("id", runId);
        return;
      }
      const results = await toolResults(service, row.book_id, toolUses, steps, {
        [optionsCall.id]: `The options were rejected: ${outcome.error} Fix and call propose_options again, or just reply.`,
      }, auto);
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
      transcript.push({ role: "user", content: ackResults(toolUses.map((t) => t.id)) });
      await service.from("book_agent_runs")
        .update({ status: isThread ? "idle" : "done", transcript, steps, report }).eq("id", runId);
      return;
    }

    // ── ask_author: in auto mode the author is away, so don't park — answer the agent's own question with
    // "decide yourself and proceed" and chain, so an unattended run can't deadlock on a creative fork. ──
    const askCall = toolUses.find((t) => t.name === "ask_author");
    if (askCall && auto) {
      const results = await toolResults(service, row.book_id, toolUses, steps, {
        [askCall.id]: "You're in AUTONOMOUS mode — the author is away and cannot answer. Make the strongest creative decision yourself and proceed; don't ask again.",
      }, auto);
      transcript.push({ role: "user", content: results });
      await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("revise-agent", { runId }));
      return;
    }
    // ── ask_author parks the run; sibling read results ride along in `pending` ──
    if (askCall) {
      const input = askCall.input as { question?: string; options?: string[] };
      const question = String(input?.question ?? "").trim();
      const preResults = await toolResults(service, row.book_id, toolUses.filter((t) => t.id !== askCall.id), steps, {}, auto);
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
      const results = await toolResults(service, row.book_id, toolUses, steps, {}, auto);
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

const EAGER_ACK_SYSTEM = `You are the story editor's quick acknowledgement pass.
Reply with ONE short sentence (max 28 words) saying what you will do next.
Do not answer the substance yet. Do not claim findings. Do not use tools, bullets, or markdown.`;

function latestPlainUserText(transcript: unknown[]): string {
  const msg = transcript[transcript.length - 1] as { role?: string; content?: unknown[] } | undefined;
  if (msg?.role !== "user" || !Array.isArray(msg.content)) return "";
  // Only ack fresh human text. Tool-result user messages resume a prior tool turn and should not get a
  // synthetic "I'll..." note in the middle of the model's reasoning chain.
  if (msg.content.some((b) => (b as { type?: string })?.type === "tool_result")) return "";
  return msg.content
    .filter((b) => (b as { type?: string })?.type === "text")
    .map((b) => String((b as { text?: unknown }).text ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

// Two-phase "say, then do" for thread chat: make a tiny no-tools call from only the latest human
// message, write that one-line acknowledgement to the visible feed, then let the normal grounded
// tool loop run. If the ack itself has a transient issue, continue into the real turn rather than
// making UX worse; billing/config failures still surface through the main call path.
async function maybeEagerAck(service: SupabaseClient, apiKey: string, row: RunRow, model: string) {
  const userText = latestPlainUserText(row.transcript);
  if (!userText) return;
  const lastStep = row.steps[row.steps.length - 1];
  if (lastStep?.t !== "user") return; // ack already written for this fresh user message
  try {
    const resp = await callClaude(apiKey, {
      model,
      max_tokens: 120,
      system: [{ type: "text", text: EAGER_ACK_SYSTEM }],
      messages: [{ role: "user", content: [{ type: "text", text: userText.slice(0, 2000) }] }],
    }, {
      fn: "revise-agent-ack",
      bookId: row.book_id,
      taskTable: "book_agent_runs",
      taskId: row.id,
      userId: row.created_by,
    }, { signal: AbortSignal.timeout(ACK_TIMEOUT_MS) });

    const text = ((resp?.content ?? []) as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    if (!text) return;

    row.steps = [...row.steps, { t: "note", label: text } as AgentStep];
    await service.from("book_agent_runs").update({ steps: row.steps }).eq("id", row.id);
  } catch (e) {
    if (isBillingError(e)) throw e;
    console.error(`revise-agent run ${row.id} eager ack skipped:`, e);
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
  _auto = false,
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
      const schema = schemaFor([n.kind]); // hand back the kind's field schema so an edit uses the right keys
      steps.push({ t: "read", label: `Read ${n.kind} “${nodeHandle(n.content)}” in full.` });
      results.push({
        type: "tool_result", tool_use_id: t.id,
        content: `[${n.id}${n.authoring?.locked ? " · LOCKED" : ""}] ${n.kind}: ${JSON.stringify(n.content)}` + (childLines ? `\nchildren:\n${childLines}` : "") + (schema ? `\n\n${schema}` : ""),
      });
    } else if (t.name === "get_schema") {
      const kinds = (Array.isArray((t.input as { kinds?: unknown })?.kinds) ? (t.input as { kinds: unknown[] }).kinds : [])
        .filter((k): k is string => typeof k === "string");
      const schema = schemaFor(kinds);
      results.push(schema
        ? { type: "tool_result", tool_use_id: t.id, content: schema }
        : { type: "tool_result", tool_use_id: t.id, content: `No schema for ${JSON.stringify(kinds)}. Valid kinds: ${Object.keys(SCHEMA_BY_KIND).join(", ")}.`, is_error: true });
    } else if (t.name === "search_nodes") {
      // The agent's grep: full-text substring over EVERY node's content (incl. scene prose, which the digest
      // drops). ~200 nodes/book — fetch all and match in JS; only id/kind/handle/snippet go back to the model.
      const q = String((t.input as { query?: string })?.query ?? "").trim();
      if (!q) {
        results.push({ type: "tool_result", tool_use_id: t.id, content: "Provide a non-empty query string.", is_error: true });
        continue;
      }
      const { data: rows } = await service
        .from("book_nodes").select("id, kind, content").eq("book_id", bookId);
      const needle = q.toLowerCase();
      const hits: string[] = [];
      let more = 0;
      for (const r of (rows ?? []) as { id: string; kind: string; content: Record<string, unknown> | null }[]) {
        const text = JSON.stringify(r.content ?? {});
        const idx = text.toLowerCase().indexOf(needle);
        if (idx === -1) continue;
        if (hits.length >= 30) { more++; continue; }
        const start = Math.max(0, idx - 60);
        const end = Math.min(text.length, idx + needle.length + 60);
        const snippet = (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : "");
        hits.push(`[${r.id}] ${r.kind} “${nodeHandle(r.content)}” — ${snippet}`);
      }
      steps.push({ t: "read", label: `Searched for “${q}” (${hits.length + more} hit${hits.length + more === 1 ? "" : "s"}).` });
      results.push({
        type: "tool_result", tool_use_id: t.id,
        content: hits.length
          ? `${hits.length + more} match(es) for "${q}"${more ? ` (showing first 30)` : ""} — read_node any [id] for full content:\n${hits.join("\n")}`
          : `No nodes match "${q}".`,
      });
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
// reviews and applies. No context fence: it sees + may write the whole book (scope is forced null,
// docs/agent-context-model.md); the scope plumbing below is inert until/unless a fence returns.
interface DnaNodeRow { id: string; parent_id: string | null; kind: string; level: number; content: Record<string, unknown>; authoring: { locked?: boolean; status?: string } | null; proposals?: { id: string; content: Record<string, unknown>; note?: string }[] | null }

// A short human handle for a node (mirror of lib/dnaChat nodeLabel) for read summaries + step labels.
function nodeHandle(content: Record<string, unknown> | null | undefined): string {
  const c = content ?? {};
  const h = c.name ?? c.title ?? c.logline ?? c.summary ?? c.goal;
  return typeof h === "string" && h.trim() ? h.trim().slice(0, 60) : "(untitled)";
}

// ── Tree digest (docs/agent-context-model.md) ────────────────────────────────
// The system prompt ships the WHOLE tree every turn; dumping each node's full content (a beat's paragraph
// summary, every foundation field) is the bulk of the tokens. Instead each node shows a DIGEST: its
// handle/gist plus, for structure, its causal + meter SPINE (connector, needs, establishes, readings) —
// the relational glue an editor reasons over (e.g. a beat with no `connector`/`needs` reads as floating).
// Full content (the whole summary, a character's wound/lie, a scene's prose) is one read_node away.
const DIGEST_FIELDS: Record<string, string[]> = {
  seed: ["logline"],
  premise: ["dramatic_question"],
  pillar: ["controlling_idea"],
  character: ["name", "role", "tag"],
  relationship: ["a", "b", "bond"],
  world_fact: ["name", "category"],
  location: ["name", "mood"],
  thread: ["name", "kind", "promise"],
  game: ["name"],
  tentpole: ["title"],
  meter: ["name", "kind"],
  voice_profile: ["pov", "tense"],
  act: ["title", "goal", "target_pct", "turning_point"],
  beat: ["connector", "polarity", "needs", "establishes", "threads", "grounds_in", "realizes", "plays", "resolves", "readings"],
  scene: ["goal", "value_shift", "pov", "loc", "needs", "establishes", "grounds_in", "readings"],
};

// Pick only the digest fields that carry a value (drop null/empty so an ABSENT spine field — a beat with
// no `connector`/`needs` — reads clearly as missing rather than hiding inside a full dump).
function pickFields(content: Record<string, unknown> | null | undefined, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = content?.[f];
    if (v == null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[f] = v;
  }
  return out;
}

// First sentence (≤180 chars) of a beat's summary — its paragraph is too long to ship in full every turn.
function gistLine(content: Record<string, unknown> | null | undefined): string {
  const s = content?.summary;
  if (typeof s !== "string" || !s.trim()) return "";
  const t = s.trim();
  const m = t.match(/^[\s\S]*?[.!?](\s|$)/);
  let first = (m ? m[0] : t).trim();
  if (first.length > 180) first = first.slice(0, 179) + "…";
  return first;
}

// One-line digest of a node: handle/gist + compact spine (prose + verbose fields dropped; read_node for full).
function digestNode(kind: string, content: Record<string, unknown> | null | undefined): string {
  const fields = DIGEST_FIELDS[kind];
  const spine = fields ? pickFields(content, fields) : (content ?? {});
  const gist = kind === "beat" ? gistLine(content) : "";
  const json = Object.keys(spine).length ? JSON.stringify(spine) : "";
  return [gist, json].filter(Boolean).join(" · ") || nodeHandle(content);
}

const THREAD_DNA_TOOLS = [
  {
    name: "propose_prose_render",
    description: "Request that the book's prose pipeline (re)generate the FULL prose for one or more scenes — use this whenever the author asks you to write or rewrite a scene's prose from scratch. You do NOT generate the prose yourself: full prose generation is a long, browser-streamed render the author runs (it can't run inside this turn), so this stages a reviewable 'render prose' request the author applies — it then streams in their browser, in the book's voice, with full continuity. Pass the scene node id(s) (reading order) and a one-line summary. For SMALL wording fixes to EXISTING prose, use propose_node_ops to edit content.prose.text directly instead — only use this for full (re)generation. This records the request and ENDS your turn.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One line: which scene(s) and why you're (re)generating their prose." },
        sceneIds: { type: "array", items: { type: "string" }, description: "The scene node id(s) to (re)generate prose for, in reading order." },
      },
      required: ["summary", "sceneIds"],
    },
  },
  {
    name: "check_against_contract",
    description: "Judge a scene's PROSE against the book's brief mandate (genre, heat, success criteria). Pass the scene node's id; the scene must already have prose (content.prose.text) — if it's empty, propose_prose_render first. Returns a per-axis verdict (pass / partial / fail) with evidence, so you can tell the author whether the draft delivers what the brief promised. Read the scene first if you haven't.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "The scene node's id." } }, required: ["id"] },
  },
  {
    name: "read_node",
    description: "Read one DNA node's FULL content by id — its complete fields (a beat's whole summary, a character's wound/lie/idiolect, a scene's prose content.prose.text), the schema for its kind, and a one-line summary of its children. The tree you're given is a DIGEST (handle/gist + causal spine); use this to pull a node's full detail before judging or rewriting it.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "The node's id from the tree." } }, required: ["id"] },
  },
  {
    name: "get_schema",
    description: "Get the EXACT content field schema for one or more node kinds (e.g. beat, scene, character) — the required keys, allowed values, and id-ref types. Call this before you WRITE a node's content with propose_node_ops or propose_options (add / edit / replace_children) when you don't already have the schema in hand, so you use the right field names — wrong keys silently orphan the data.",
    input_schema: { type: "object", properties: { kinds: { type: "array", items: { type: "string" }, description: "The node kind(s) you're about to write, e.g. [\"beat\"] or [\"act\",\"beat\",\"scene\"] for a rebuild." } }, required: ["kinds"] },
  },
  {
    name: "search_nodes",
    description: "Full-text search across ALL the book's DNA nodes — every field of every node's content, INCLUDING scene prose (which the tree digest does NOT show). Returns matching node ids with a snippet around each hit, so you can FIND where something appears — a character name, a motif word, an echoed line, a phrase in the prose — and then read_node the ones you want in full. This is your grep: use it to gain context the digest doesn't carry (e.g. 'where is the keyring mentioned?', 'is this line echoed in the prose?', 'which scenes name Lena?').",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Case-insensitive text to search for — a name, motif word, or short phrase." } }, required: ["query"] },
  },
  {
    name: "propose_node_ops",
    description: "Propose a concrete change to the DNA tree the author reviews before it's applied: edit / add / delete / replace_children nodes by their real ids. This records the proposal and ENDS your turn — narrate what you're changing and why just before calling it. Never touch a LOCKED node. To REBUILD a whole level (replace all acts, or all beats under an act), use replace_children — NOT a pile of `add` ops, which would duplicate what's already there.",
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
              kind: { type: "string", description: "add: the new node's kind (character|relationship|tentpole|world_fact|thread|game|act|beat|scene|voice_profile)." },
              parentId: { type: "string", description: "add / replace_children: the existing parent node's id (e.g. the pillar, whose act children are the acts)." },
              childKind: { type: "string", description: "replace_children: which child kind to rebuild (e.g. 'act' to replace all acts, 'beat' to replace an act's beats)." },
              content: { type: "object", description: "edit: the fields to merge. add: the new node's content. Use the exact field names from the schema given.", additionalProperties: true },
              children: { type: "array", description: "replace_children: the NEW children as a nested tree — each { content, children? }; nesting follows the ladder (act→beat→scene). Every existing non-locked child of childKind is deleted first, so the rebuild never duplicates.", items: { type: "object", additionalProperties: true } },
            },
            required: ["op"],
          },
        },
      },
      required: ["summary", "ops"],
    },
  },
  {
    name: "propose_options",
    description: "Offer the author 2–4 ALTERNATIVE versions of ONE node's content to choose among (the options picker). Use this when the author asks for options/alternatives, or to break a node out of its one obvious 'modal' version. Each option is a COMPLETE content object for that node's kind (the exact field names from the schema, like an edit's content). The options must be meaningfully different FROM EACH OTHER — but every option MUST HONOR the node's ancestors as FIXED: a child elaborates what's above it (the logline, then the premise), it never rewrites it. Vary ONLY what the parent leaves open (e.g. premise options keep the logline's protagonist / inciting incident / goal / obstacle / stakes fixed and vary only the dramatic question + 5-part shape). NEVER reshape an ancestor's story into a different book, and never offer near-duplicates. This stages the options ON the node (the author picks one in the tree) and ENDS your turn. For a SINGLE revision, use propose_node_ops (edit) instead. Only target a non-locked node.",
    input_schema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "The existing node id to generate alternatives for." },
        note: { type: "string", description: "One line: the axis the options vary along (e.g. 'three takes on the protagonist's wound')." },
        options: {
          type: "array",
          description: "2–4 alternative content objects for this node's kind — each a complete value, meaningfully different from the others.",
          items: { type: "object", additionalProperties: true },
        },
      },
      required: ["nodeId", "options"],
    },
  },
];

// The thread tool belt: ask_author always; read_node + propose_node_ops whenever ANY aspect is in
// scope (the per-op kind fence does the fine-grained gating). null/[] scope = all.
function threadToolsFor(_scope: Aspect[] | null): unknown[] {
  return [TOOLS.find((t) => t.name === "ask_author")!, ...THREAD_DNA_TOOLS];
}

const CONTENT_SCHEMAS = dnaSchema.promptGuide;

// Schema-on-demand: the full CONTENT_SCHEMAS block is ~2k chars of every kind's field list. Rather than
// ship it every turn, we serve the relevant kind's schema when the agent reads or writes a node
// (read_node result + the get_schema tool). promptGuide is a legend line followed by one `- <kind> → …`
// bullet per kind; split it so we can hand back just the kinds in play.
const SCHEMA_LINES = CONTENT_SCHEMAS.split("\n");
const SCHEMA_HEADER = SCHEMA_LINES[0];
const SCHEMA_BY_KIND: Record<string, string> = {};
for (const line of SCHEMA_LINES) {
  const m = line.match(/^- (\w+) →/);
  if (m) SCHEMA_BY_KIND[m[1]] = line;
}
// The exact field schema for one or more kinds (legend + the matching bullets), or "" if none match.
function schemaFor(kinds: string[]): string {
  const lines = [...new Set(kinds)].map((k) => SCHEMA_BY_KIND[k]).filter(Boolean);
  return lines.length ? `${SCHEMA_HEADER}\n${lines.join("\n")}` : "";
}

const SYSTEM_THREAD = `You are a sharp, warm developmental STORY EDITOR — the author's single AI collaborator for the whole book, in conversation in the studio's right-hand rail.

You hold the book's DNA TREE: premise → foundations (pillar, cast, world, tentpoles, voice) → structure (acts, beats, threads) → scenes → prose. You see the WHOLE book and may touch any node (except LOCKED ones); the author anchors your attention by attaching nodes, but never fences you out of the rest. The tree below is a DIGEST — each node shows its handle/gist plus, for structure, its causal + meter spine (connector, needs, establishes, readings). When a node's full detail matters — a beat's whole summary, a character's wound/lie, a scene's prose — read_node it before judging or rewriting. To FIND where something appears across the whole book — a name, a motif, an echoed line, a phrase in the prose the digest doesn't show — use search_nodes, then read_node the hits.

You can do four things:
1. DISCUSS — answer, summarize, pressure-test. Reply in plain MARKDOWN prose and just end your turn (no tool needed). Be concrete, grounded in the real tree, referencing nodes by their [id]. When a node has PENDING OPTIONS and the author asks which is strongest, just RECOMMEND one in prose (name its option number + a one-line reason tied to the brief) — committing the pick is theirs, in the tree.
2. CHANGE THE TREE — when the author asks for a change (or agrees to one), call propose_node_ops with edit/add/delete ops over the real ids. The author reviews the diff and applies it; descendants of an edited node go stale and are regenerated later. NEVER touch a LOCKED node. Don't propose unless asked — talk first.
3. OFFER OPTIONS — when the author asks for alternatives/options, or to break a node out of its one obvious version, call propose_options with the node's [id] and 2–4 COMPLETE content objects, meaningfully different FROM EACH OTHER but each one HONORING the node's ancestors as fixed: a child elaborates the logline/premise above, it never rewrites it. Vary only what the parent leaves open (premise options keep the logline's protagonist/inciting/goal/obstacle/stakes and vary the dramatic question + shape); never reshape an ancestor into a different story, never near-duplicates. The author picks one in the tree. Use this only for choose-among-N; a single revision is propose_node_ops.
4. PROSE — to WRITE or REWRITE a scene's full prose, call propose_prose_render with the scene [id](s): you do NOT generate prose yourself (it's a long, browser-streamed render the author runs); you stage a request the author applies, and it streams in their browser. For SMALL wording fixes to EXISTING prose, use propose_node_ops to edit content.prose.text directly. Call check_against_contract with a scene's [id] to judge its EXISTING prose against the brief mandate (genre, heat, voice, success criteria) and relay the per-axis verdict. A common request — "write the first scene and see if it meets the brief" — is propose_prose_render (the author applies it; prose streams in) then check_against_contract once the scene has prose.
   • REBUILDS: to replace a whole level — "rebuild the acts", "4 acts with all-new beats" — use ONE replace_children op (parentId = the level's parent, e.g. the pillar for acts; childKind = act; children = the new acts, each nesting its beats). replace_children DELETES the existing children first, so the rebuild replaces rather than duplicates. Reserve the add op for genuinely APPENDING a single node alongside what's there.

NODE KINDS: seed, premise, pillar; foundations — character, relationship, world_fact, location, thread, game, tentpole, meter, voice_profile; structure — act, beat, scene. Before you WRITE a node's content (add / edit / replace_children), get the kind's EXACT field names with get_schema (read_node also returns them) — wrong keys silently orphan data.

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

// Validate a prose-render request: every id must be a real, non-locked SCENE in this book. Builds the
// reviewable proposal (layer 'prose-render', no ops). The author applies it and the prose streams in their
// browser via the v2 pipeline — the agent never renders prose in-worker (docs/agent-context-model.md).
async function proposeProseRender(
  service: SupabaseClient,
  bookId: number,
  input: { summary?: string; sceneIds?: unknown },
): Promise<{ ok: true; proposal: AgentProposal } | { ok: false; error: string }> {
  const { data: rows } = await service.from("book_nodes").select("id, kind, authoring").eq("book_id", bookId);
  const byId = new Map(((rows ?? []) as { id: string; kind: string; authoring: { locked?: boolean } | null }[]).map((n) => [n.id, n]));
  const ids = Array.isArray(input.sceneIds) ? input.sceneIds.filter((x): x is string => typeof x === "string") : [];
  const sceneIds: string[] = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (n && n.kind === "scene" && !n.authoring?.locked && !sceneIds.includes(id)) sceneIds.push(id);
  }
  if (sceneIds.length === 0) return { ok: false, error: "No valid scene ids — propose_prose_render targets real, non-locked SCENE nodes by their [id]." };
  return { ok: true, proposal: { id: crypto.randomUUID(), layer: "prose-render", summary: String(input.summary ?? "Render prose").trim() || "Render prose", ops: [], sceneIds } };
}

// Stage 2–4 alternative content objects ON a node as pickable options (the options/picker channel). The
// candidates write to book_nodes.proposals; the author commits one in the tree (chooseProposal). Gated by
// the same live-tree + scope + lock fence as proposeNodeOps — this only stages, it never commits.
async function proposeOptions(
  service: SupabaseClient,
  bookId: number,
  scope: Aspect[] | null,
  input: { nodeId?: string; note?: string; options?: unknown[] },
): Promise<{ ok: true; handle: string; count: number } | { ok: false; error: string }> {
  const { data: rows } = await service.from("book_nodes").select("id, kind, content, authoring").eq("book_id", bookId);
  const nodes = (rows ?? []) as { id: string; kind: string; content: Record<string, unknown> | null; authoring: { locked?: boolean } | null }[];
  const node = nodes.find((n) => n.id === input.nodeId);
  if (!node) return { ok: false, error: `No node with id ${input.nodeId}.` };
  if (node.authoring?.locked) return { ok: false, error: `Node ${input.nodeId} is LOCKED — unlock it before offering options.` };
  const kinds = scopedKinds(scope);
  if (kinds && !kinds.has(node.kind)) return { ok: false, error: `Node ${input.nodeId} is a ${node.kind}, not in scope (${scope!.join(", ")}).` };
  const objects = (Array.isArray(input.options) ? input.options : []).filter((o) => o && typeof o === "object" && !Array.isArray(o)) as Record<string, unknown>[];
  if (objects.length < 2) return { ok: false, error: "Offer at least 2 distinct option objects (2–4)." };
  const note = input.note?.trim();
  const proposals = objects.slice(0, 4).map((content) => ({ id: crypto.randomUUID(), content, ...(note ? { note } : {}), source: "options" }));
  const { error } = await service.from("book_nodes").update({ proposals }).eq("id", node.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, handle: nodeHandle(node.content), count: proposals.length };
}

// The thread's system prompt carries the CURRENT DNA tree, FILTERED to the in-scope kinds and rebuilt
// every call so ids stay fresh as the author edits (the transcript holds only the conversation). Each node
// is a DIGEST — handle/gist + causal spine, full content via read_node (see digestNode). A one-line
// premise/pillar frame is always included so the agent is grounded even when 'premise' isn't in scope.
async function threadSystem(service: SupabaseClient, bookId: number, scope: Aspect[] | null, analysis: string | null, effort: "low" | "high" = "high", auto = false): Promise<string> {
  const { data: book } = await service.from("books").select("name, brief").eq("id", bookId).maybeSingle();
  const b = book as { name?: string; brief?: Brief } | null;
  const { data: rows } = await service
    .from("book_nodes").select("id, parent_id, kind, level, content, authoring, proposals").eq("book_id", bookId);
  const nodes = (rows ?? []) as DnaNodeRow[];
  const kinds = scopedKinds(scope); // null = all

  const serialize = (n: DnaNodeRow, inScope: boolean): string => {
    if (!inScope) return `[${n.id}] L${n.level} ${n.kind}: <hidden>`;
    let line = `[${n.id}${n.authoring?.locked ? " · LOCKED" : ""}] L${n.level} ${n.kind}: ${digestNode(n.kind, n.content)}`;
    // Pending options (the picker channel) — surfaced so you can RECOMMEND which the author should pick.
    if (Array.isArray(n.proposals) && n.proposals.length) {
      line += `\n  PENDING OPTIONS (${n.proposals.length} — the author picks one; you may recommend which by its number): ` +
        JSON.stringify(n.proposals.map((p, i) => ({ option: i + 1, ...p.content })));
    }
    return line;
  };

  // Always show the full structural shape — out-of-scope nodes appear as <hidden> so the agent
  // always has every node's id (needed for parentId in add ops) without seeing irrelevant content.
  const sorted = [...nodes].sort((a, b) => a.level - b.level);
  const tree = sorted.map((n) => serialize(n, !kinds || kinds.has(n.kind))).join("\n");

  const blocks = [
    `BOOK: ${b?.name ?? ""}`,
    `BRIEF (binding voice contract): ${briefContext(b?.brief ?? null, { scope: "full", success: true, none: "(no brief)", empty: "(empty)" })}`,
    // The structural backstop (pacing / dangling-promise / sagging-run lints) — act on any ⚠ flags.
    analysis?.trim() ? `STORY ANALYSIS (the structural backstop — address any ⚠ flags):\n${analysis.trim()}` : "",
    `THE DNA TREE${kinds ? ` (in scope: ${[...kinds].join(", ")}; others shown as <hidden>)` : ""} — edit/add/delete by these ids; LOCKED = immutable:\n${tree || "(no nodes yet)"}`,
  ].filter(Boolean);

  const scopeLine = scope && scope.length ? `\n\nIN SCOPE THIS CONVERSATION: ${scope.join(", ")}. Only propose changes to these aspects.` : "";
  const effortLine = effort === "low"
    ? "\n\nFAST MODE: The author wants a quick response. If the change is clear from the tree, call propose_node_ops immediately — one sentence of narration, then the proposal. Skip read_node unless prose content is essential. Only pause to ask if the request is genuinely ambiguous."
    : "";
  // Autonomous mode: the author is AWAY. The agent must carry every request to a committed change with no
  // human gate — it makes the option choices itself and never waits. (The client auto-applies what it stages.)
  const autoLine = auto
    ? "\n\nAUTONOMOUS MODE — the author has stepped away and CANNOT review, pick, or answer. Carry every request all the way to a finished result yourself, then conclude:\n• Make ONE change per turn with propose_node_ops. It is APPLIED LIVE immediately — there is no review step, and your NEXT turn shows the updated tree. Don't say \"I propose\" or wait for approval; just make the change, then continue.\n• READ THEN ACT — don't over-read. The tree above is a DIGEST (handle/gist + causal spine). When the change needs a node's full detail (a beat's whole summary, a character's profile, a scene's prose), read_node it FIRST — but only the node(s) you're about to change. Don't sweep the tree; the digest is enough to decide what to touch.\n• NEVER call ask_author. At a creative fork, decide with your best judgment and proceed.\n• Prefer to commit directly: when you'd weigh options, just pick the strongest and write it with propose_node_ops. (Avoid propose_options in autonomous mode — there's no one to pick.)\n• ALWAYS CONCLUDE: once the request is fully handled, call finish with a one-line summary of what you changed. Don't stop mid-thought after a change — keep going until you finish."
    : "";
  return `${SYSTEM_THREAD}${scopeLine}${effortLine}${autoLine}\n\n${blocks.join("\n\n")}`;
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
