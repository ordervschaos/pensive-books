// book-agent — the book's ONE tool-using story-editor AGENT: a durable loop over the Novel DNA tree
// (docs/agent-rail.md, agent-capabilities.md). It holds the whole book_nodes tree as a digest, discusses
// it, and proposes reviewable changes (node ops, prose-render requests, alternatives) the author applies.
//
// It is read-only on book_nodes itself: every propose_* tool ends the turn and stages a reviewable
// proposal in book_agent_runs.proposals — the author (or auto-accept) applies it through the existing
// write path (applyNodeOps / the v2 prose pipeline). There is no path from the agent straight to book_nodes.
//
// Durability: the run lives in a book_agent_runs row (kind='thread', one per book); each self-chain link
// makes ONE Claude call (well under the ~150s worker cap), executes its tool calls, persists the
// transcript, and chains. An ask_author call parks the run in `awaiting_input` (no chain) until the
// author answers; the pg_cron watchdog only revives stalled 'running' rows. See docs/agent-runtime-architecture.md.
//
//   client → POST { bookId, message }                → get-or-create thread → chain (authenticated)
//   client → POST { runId, answer }                  → append tool_result → chain  (authenticated)
//   self   → POST { runId, chain: true }              → one model call → …          (x-chain secret)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { type Brief, briefContext } from "../_shared/brief.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callLLM } from "../_shared/llm.ts";
import { getRoleModels } from "../_shared/model-config.ts";
// The pure engine + guided-journey derivation, edge twins of the web app's novelDna/dnaJourney (parity-locked
// by novelDna.parity.test.ts). threadSystem re-runs these on the LIVE tree each chain link so the objective +
// structural lints SENSE the current state instead of dead-reckoning from the author's message-time snapshot
// (docs/agent-improvement-plan.md P1.2).
import { analysisText, type AuthoringStatus, type DnaNode, type NodeContent, type NodeKind, type SceneContent } from "../_shared/novel-dna.ts";
import { currentObjective } from "../_shared/dna-journey.ts";
// The content schema the agent must conform to — GENERATED from the web app's NODE_SCHEMA (single source of
// truth), kept in sync by apps/web/.../dnaSchema.artifact.test.ts. Never hand-edit; edit NODE_SCHEMA + regen.
import dnaSchema from "../_shared/dna-schema.json" with { type: "json" };
import { serviceClient } from "../_shared/task.ts";
import { reinvoke, isChainCall } from "../_shared/self-chain.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";
import { judgeProse } from "../_shared/mandate-gate.ts";
import { judgeAgainstPlan, planHasContent, type PlanAxisVerdict, type ScenePlan } from "../_shared/plan-gate.ts";

const MAX_TURNS = 20;          // model calls per run — the runaway guard
const AUTO_MAX_TURNS = 50;     // autonomous threads iterate change-by-change, so they get a higher ceiling
// One call must finish inside the ~150s worker wall clock (with headroom for the row writes and
// the chain dispatch). An abort still BILLS — the API keeps generating after we hang up — so the
// real defense is keeping turns short (effort: medium below), not this timer.
const CALL_TIMEOUT_MS = 140_000;
const ACK_TIMEOUT_MS = 15_000; // fast chat acknowledgement; the real tool turn follows

// ── Row shapes ──
interface AgentStep { t: "user" | "note" | "read" | "ask" | "answer" | "plan" | "done"; label: string }
interface Pending {
  tool_use_id: string;
  question: string;
  options?: string[];
  // tool_results for read tool calls (read_node/search_nodes/…) issued in the SAME assistant turn as the
  // ask — the answer message must carry results for every tool_use of that turn, so these ride along.
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
interface RenderBrief { focus: string; mustHonor?: string[]; avoid?: string[] }
interface AgentProposal { id: string; layer: "dna" | "prose-render" | "expansion"; summary: string; ops: NodeOp[]; sceneIds?: string[]; brief?: RenderBrief; nodeId?: string; target?: string }

interface RunRow {
  id: number;
  book_id: number;
  created_by: string | null;
  kind: string; // 'thread' (the persistent omni-rail conversation) — the only kind created today
  status: string;
  transcript: unknown[];
  steps: AgentStep[];
  pending: Pending | null;
  proposals: AgentProposal[] | null;
  context_scope: Aspect[] | null; // thread scope (docs/agent-rail.md): null = whole book
  context_analysis: string | null; // latest client-computed story analysis (backstop)
  context_objective: string | null; // latest client-computed current journey objective (guided-flow anchor)
  context_attached_ids: string[] | null; // the context tray: node ids the author attached as anchors
  context_effort: "low" | "high" | null; // null = high (default)
  context_auto: boolean | null; // auto-accept mode: run autonomously, never park on ask_author
  turns: number;
  cancel_requested: boolean;
}
const ROW_COLS = "id, book_id, created_by, kind, status, transcript, steps, pending, proposals, context_scope, context_analysis, context_objective, context_attached_ids, context_effort, context_auto, turns, cancel_requested";

// Context filter aspects mirror the DNA tree's visual layers. null/[] scope = all.
type Aspect = "seed" | "premise" | "cast_world" | "story" | "prose";
const ASPECTS: Aspect[] = ["seed", "premise", "cast_world", "story", "prose"];

// Which book_nodes kinds each aspect covers. Mirrors lib/agentThread.ts ASPECT_KINDS.
const ASPECT_KINDS: Record<Aspect, string[]> = {
  seed: ["seed"],
  premise: ["premise"],
  cast_world: ["pillar", "character", "relationship", "tentpole", "world_fact", "location", "thread", "game", "meter", "voice_profile"],
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
const ALL_NODE_KINDS = ["seed", "premise", "pillar", "act", "beat", "scene", "character", "relationship", "tentpole", "world_fact", "location", "thread", "game", "meter", "voice_profile"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  const service = serviceClient();

  try {
    const body = (await req.json().catch(() => ({}))) as {
      bookId?: number; runId?: number; answer?: string; chain?: boolean; autoContinue?: boolean;
      message?: string; scope?: string[]; analysis?: string; effort?: "low" | "high"; auto?: boolean; objective?: string; attachedIds?: string[];
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
      // Re-write `steps` (unchanged) alongside `status` — same unchanged-TOAST gotcha as the `turns` tick
      // below: a partial update can still arrive over Realtime with steps=null, blanking the feed, even with
      // REPLICA IDENTITY FULL. This fires on every auto-accept apply→continue cycle, so it's worth hardening.
      // cancel_requested reset here too: a Stop click that arrived after the prior turn already went
      // terminal leaves the flag stuck true, which would otherwise cancel THIS resumed turn on its first
      // advance() (the top-of-function check reads it unconditionally).
      await service.from("book_agent_runs").update({ status: "running", steps: row.steps, cancel_requested: false }).eq("id", row.id);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId: row.id }));
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
      // cancel_requested: false — same stale-flag hazard as autoContinue above: a Stop click that missed
      // the parked turn must not cancel the turn this answer just resumed.
      const { error } = await service.from("book_agent_runs")
        .update({ transcript, steps, pending: null, status: "running", cancel_requested: false })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId: row.id }));
      return json({ status: "running", runId: row.id }, 202);
    }

    // ── Thread message (the persistent omni-rail conversation — docs/agent-rail.md) ──
    // A free-text message to the book's ONE agent thread. Get-or-create the thread row (kind='thread'),
    // append the message, reset the per-turn budget, and drive it. A turn ends in 'idle' (not 'done'),
    // so the next message resumes with full transcript context.
    if (typeof body.message === "string") {
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
      // The client-computed CURRENT OBJECTIVE (the now journey rung + recipe) — the guided-flow anchor.
      const objective: string | null = typeof body.objective === "string" && body.objective.trim() ? body.objective.trim() : null;
      // The context tray: node ids the author attached as anchors. Stashed on the thread and hydrated into a
      // live <focus> block each turn (never glued to the message, so it can't go stale in the transcript).
      const attachedIds: string[] | null = Array.isArray(body.attachedIds)
        ? body.attachedIds.filter((id): id is string => typeof id === "string" && !!id).slice(0, 40)
        : null;
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
            context_objective: objective,
            context_attached_ids: attachedIds,
            context_effort: effort,
            context_auto: auto,
            transcript: [{ role: "user", content: [{ type: "text", text: message }] }],
            steps: [{ t: "user", label: message }],
          })
          .select("id")
          .single();
        if (insErr) throw new Error(insErr.message);
        const id = (run as { id: number }).id;
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId: id }));
        return json({ status: "running", runId: id }, 202);
      }

      // A fresh turn on the existing thread: append the message, reset the per-turn budget, clear any
      // prior error/cancel, and run.
      const transcript = [...thread.transcript, { role: "user", content: [{ type: "text", text: message }] }];
      const steps = [...thread.steps, { t: "user", label: message } as AgentStep];
      const { error } = await service.from("book_agent_runs")
        .update({ transcript, steps, status: "running", turns: 0, pending: null, error: null, cancel_requested: false, context_scope: scope, context_analysis: analysis, context_objective: objective, context_attached_ids: attachedIds, context_effort: effort, context_auto: auto })
        .eq("id", thread.id);
      if (error) throw new Error(error.message);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId: thread.id }));
      return json({ status: "running", runId: thread.id }, 202);
    }

    return json({ error: "Unrecognized request — expected { message } for the agent thread, { runId, answer }, or { runId, chain }." }, 400);
  } catch (e) {
    console.error("book-agent error:", e);
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
  // a guided conversation — but still bounded so a runaway can't loop forever.
  const auto = !!row.context_auto;
  const maxTurns = auto ? AUTO_MAX_TURNS : MAX_TURNS;
  if (row.turns >= maxTurns) {
    await service.from("book_agent_runs")
      .update({ status: "error", error: `The agent ran past ${maxTurns} turns without finishing — stopped as a safety measure.` })
      .eq("id", runId);
    return;
  }

  try {
    // Any tier works here: _shared/llm.ts converts tools/tool_use/tool_result both ways for
    // the OpenAI-compatible paths (DeepSeek, MuleRouter/Qwen), so the loop runs on cheap models too.
    const { agent: model, low: ackModel } = await getRoleModels();
    // P2.3 — enforced render→verify (auto only): if the prior turn was an applied prose render, inject a
    // plan-conformance verdict into the transcript before this turn's model call. Best-effort; returns the
    // originals if nothing to verify or on any error, so the loop is never blocked.
    const { transcript: baseTranscript, steps: baseSteps } = auto
      ? await maybeInjectRenderVerify(service, apiKey, model, row)
      : { transcript: row.transcript as unknown[], steps: row.steps };
    // A conversational system prompt grounded in the CURRENT book state (rebuilt per call so ids stay
    // fresh), and the thread tool belt.
    if (row.turns === 0) {
      await maybeEagerAck(service, apiKey, row, ackModel);
    }
    const turns = row.turns + 1;
    // Boundaries removed (docs/agent-context-model.md): the agent always sees + may touch the whole book.
    // Forced null here (not row.context_scope) so even threads created under the old aspect-fence run
    // unfenced from now on; context is anchored by attached nodes, not filtered by kind.
    const scope: Aspect[] | null = null;
    const effort = row.context_effort ?? "high";
    // `auto` (autonomous mode: never park, commit own picks) computed above for the turn ceiling.
    const system = await threadSystem(service, row.book_id, scope, row.context_analysis, effort, auto, row.context_objective, row.context_attached_ids);
    const tools = threadToolsFor(scope);
    // Count the turn BEFORE the call: a hard worker death mid-call still consumes budget, so a
    // crash-looping run hits MAX_TURNS instead of being revived forever by the watchdog.
    // Re-write `steps` (unchanged) alongside `turns` so this mid-"thinking" Realtime event carries the
    // steps column — otherwise Postgres omits the unchanged TOASTed jsonb from the WAL new-tuple and the
    // client's row arrives with steps=null, blanking the feed. (REPLICA IDENTITY FULL is the broader fix.)
    await service.from("book_agent_runs").update({ turns, steps: baseSteps }).eq("id", runId);

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
      resp = await callLLM(apiKey, {
        model,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        // effort defaults to HIGH, which made every turn think past the 120s timer (observed:
        // five consecutive aborted-and-billed 120s calls). Medium keeps a turn at ~30-60s; the
        // author-gated plan review downstream is the quality backstop.
        output_config: { effort: "medium" },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools,
        messages: withCacheBreakpoints(baseTranscript),
      }, {
        fn: "book-agent",
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
      console.error(`book-agent run ${runId} call failed (turn ${turns}), retrying:`, e);
      await sleep(2000);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId }));
      return;
    }
    clearInterval(cancelPoll);

    // deno-lint-ignore no-explicit-any
    const content = (resp?.content ?? []) as any[];
    const transcript = [...baseTranscript, { role: "assistant", content }];
    const steps = [...baseSteps];

    // The model's visible narration IS the agent's chat reply, so keep it whole.
    for (const b of content) {
      if (b.type === "text" && String(b.text ?? "").trim()) {
        steps.push({ t: "note", label: String(b.text).trim() });
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
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId }));
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
          ? `✓ Render STAGED (autonomous mode). The author's browser will apply it — (re)generating the scene prose — and the result shows on your NEXT turn (do not assume it's already written this turn). Continue if more is needed, or call finish.`
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
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId }));
      return;
    }

    // ── propose_expansion: delegate a heavy structural pass (beat sheet / scenes) to the dna-expand engine ──
    // Like propose_prose_render, the engine run happens CLIENT-side (browser owns retry/streaming + reuses the
    // exact generate+persist path); the agent only DECIDES to invoke it. Stage an 'expansion' request in
    // proposals[]; Apply runs generateExpansionOps → applyNodeOps there. Same review channel as the rest.
    const expandCall = toolUses.find((t) => t.name === "propose_expansion");
    if (expandCall) {
      const outcome = await proposeExpansion(service, row.book_id, expandCall.input as { summary?: string; nodeId?: string; target?: string });
      if (outcome.ok) {
        steps.push({ t: "plan", label: outcome.proposal.summary });
        const proposals = [...(row.proposals ?? []), outcome.proposal];
        const ack = auto
          ? `✓ Expansion STAGED (autonomous mode). The author's browser will run the engine and apply the result; the new nodes show on your NEXT turn (do not assume they exist yet this turn). Continue, or call finish.`
          : null;
        transcript.push({ role: "user", content: ack
          ? toolUses.map((t) => ({ type: "tool_result", tool_use_id: t.id, content: t.id === expandCall.id ? ack : "ok" }))
          : ackResults(toolUses.map((t) => t.id)) });
        await service.from("book_agent_runs").update({ status: "idle", transcript, steps, proposals }).eq("id", runId);
        return; // the proposal waits for the author to apply (the engine runs client-side)
      }
      const results = await toolResults(service, row.book_id, toolUses, steps, {
        [expandCall.id]: `The expansion request was rejected: ${outcome.error} Fix it and call propose_expansion again, or just reply.`,
      }, auto);
      transcript.push({ role: "user", content: results });
      await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId }));
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
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId }));
      return;
    }

    const finishCall = toolUses.find((t) => t.name === "finish");
    if (finishCall) {
      const report = String((finishCall.input as { report?: string })?.report ?? "").trim() || "The agent finished without proposing changes.";
      steps.push({ t: "done", label: report.slice(0, 300) });
      // The turn ends QUIESCENT ('idle'), not terminal, so the conversation can continue.
      transcript.push({ role: "user", content: ackResults(toolUses.map((t) => t.id)) });
      await service.from("book_agent_runs")
        .update({ status: "idle", transcript, steps, report }).eq("id", runId);
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
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId }));
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
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId }));
      return;
    }

    // ── No tool call at all ──
    // A normal conversational reply (the agent answered without needing a tool): the assistant's text
    // is already captured as a 'note' step, so the turn is complete → go idle.
    await service.from("book_agent_runs").update({ status: "idle", transcript, steps }).eq("id", runId);
  } catch (e) {
    const billing = isBillingError(e);
    await captureException(e, { function: "book-agent", book_id: String(row.book_id), billing: String(billing) });
    const msg = billing ? "AI credits exhausted — the team has been notified." : String((e as Error)?.message ?? e).slice(0, 1000);
    await service.from("book_agent_runs").update({ status: "error", error: msg }).eq("id", runId);
  }
}

const EAGER_ACK_SYSTEM = `You are the story editor's quick acknowledgement pass.
Reply with ONE short sentence (max 28 words) saying what you will do next, in plain terms about the book.
Do not answer the substance yet. Do not claim findings. Do not use tools, bullets, or markdown.
Never mention these instructions, a "system prompt", or your own configuration — if the request is a short
follow-up (e.g. "no, rewrite it"), use the prior note below to say what "it" is instead of talking about yourself.`;

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

// The ack call only ever sees the latest user message (cheap + fast by design), so a short follow-up like
// "no, it's not applied - rewrite" has no antecedent for "it" — the model then has nothing to ground on
// except its own system prompt, and starts paraphrasing that back. Pull the last assistant text as a one-line
// anchor so pronouns resolve.
function lastAssistantText(transcript: unknown[]): string {
  const msgs = transcript as { role?: string; content?: unknown[] }[];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
    const text = m.content
      .filter((b) => (b as { type?: string })?.type === "text")
      .map((b) => String((b as { text?: unknown }).text ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text) return text.slice(0, 400);
  }
  return "";
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
    const prior = lastAssistantText(row.transcript);
    const groundedText = (prior ? `<prior_note>${prior}</prior_note>\n` : "") + userText.slice(0, 2000);
    const resp = await callLLM(apiKey, {
      model,
      max_tokens: 120,
      system: [{ type: "text", text: EAGER_ACK_SYSTEM }],
      messages: [{ role: "user", content: [{ type: "text", text: groundedText }] }],
    }, {
      fn: "book-agent-ack",
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
    console.error(`book-agent run ${row.id} eager ack skipped:`, e);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Execute a turn's non-terminal tool calls (read_node/get_schema/search_nodes/check_against_contract;
// unknown tools get an error result) and return the tool_result blocks. `overrides` injects a prebuilt
// result for a given tool_use id.
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
    if (t.name === "read_node") {
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
      // The agent's grep: per-FIELD substring match over EVERY node's content (incl. scene prose, which the
      // digest drops). ~200 nodes/book — fetch all and match in JS; only id/kind/handle/field/snippet go back.
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
      // prose.text is unwrapped one level so its snippet stays plain text; other nested values fall back to a
      // stringified sub-value (no deep recursion).
      for (const r of (rows ?? []) as { id: string; kind: string; content: Record<string, unknown> | null }[]) {
        for (const [field, value] of Object.entries(r.content ?? {})) {
          let text: string;
          if (typeof value === "string") text = value;
          else if (field === "prose" && value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string") text = (value as { text: string }).text;
          else if (value && typeof value === "object") text = JSON.stringify(value);
          else continue;
          const idx = text.toLowerCase().indexOf(needle);
          if (idx === -1) continue;
          if (hits.length >= 30) { more++; continue; }
          const start = Math.max(0, idx - 60);
          const end = Math.min(text.length, idx + needle.length + 60);
          const snippet = (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : "");
          hits.push(`[${r.id}] ${r.kind} “${nodeHandle(r.content)}” — ${field}: “${snippet}”`);
        }
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
      const n = node as { id: string; kind: string; content: SceneContent };
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
      const check = ((t.input as { check?: string })?.check ?? "both");
      const doPlan = check !== "mandate", doMandate = check !== "plan";
      const { agent: model } = await getRoleModels();
      const meta = { fn: "book-agent-contract", bookId, taskTable: "book_agent_runs", taskId: null, userId: null };
      const sections: string[] = [];
      try {
        if (doPlan) {
          const res = await planConformanceSummary(service, apiKey, model, n.content, "book-agent-contract", bookId);
          sections.push(`PLAN CONFORMANCE (does the prose deliver the scene's own plan?):\n${res?.summary ?? "  (no prose to check)"}`);
        }
        if (doMandate) {
          const { data: book } = await service.from("books").select("brief").eq("id", bookId).maybeSingle();
          const brief = ((book as { brief?: Brief } | null)?.brief ?? {}) as Brief;
          const axes = await judgeProse(apiKey, model, brief, proseText, meta);
          const body = axes.map((a) => `  ${a.axis}: ${a.verdict.toUpperCase()} — ${a.detail}${a.evidence ? ` (e.g. "${a.evidence}")` : ""}`).join("\n");
          sections.push(`MANDATE CONFORMANCE (does the prose honor the brief?):\n${body || "  (judge returned no axes — inspect by hand)"}`);
        }
        steps.push({ t: "read", label: `Checked scene “${nodeHandle(n.content as Record<string, unknown>)}” against ${check === "both" ? "its plan + the brief" : check === "plan" ? "its plan" : "the brief"}.` });
        results.push({ type: "tool_result", tool_use_id: t.id, content: sections.join("\n\n") || "No checks ran — inspect by hand." });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: t.id, content: `Contract check failed: ${String((e as Error)?.message ?? e)}`, is_error: true });
      }
    } else {
      results.push({ type: "tool_result", tool_use_id: t.id, content: `Unknown tool ${t.name}.`, is_error: true });
    }
  }
  return results;
}

// Build a scene's PLAN SLICE from its DNA edges (resolving thread ids → names/promises so the judge reads the
// promise, not a hash) and judge its prose against it (P2.2). Shared by the check_against_contract tool and the
// P2.3 auto-verify. Returns null when the scene has no prose; `{axes:[], summary}` when it has no structural
// plan; else the judged axes + an indented summary. `fn` labels the caller in ai_calls.
async function planConformanceSummary(
  service: SupabaseClient, apiKey: string, model: string, content: SceneContent | null | undefined, fn: string, bookId: number,
): Promise<{ axes: PlanAxisVerdict[]; summary: string } | null> {
  const c = (content ?? {}) as SceneContent;
  const proseText = (c.prose?.text ?? "").trim();
  if (!proseText) return null;
  const threadRefs = Array.isArray(c.threads) ? c.threads : [];
  const threadIds = threadRefs.map((r) => r?.ref).filter((r): r is string => !!r);
  const { data: threadNodes } = threadIds.length
    ? await service.from("book_nodes").select("id, content").in("id", threadIds)
    : { data: [] as { id: string; content: Record<string, unknown> }[] };
  const tById = new Map((threadNodes ?? []).map((tn) => [tn.id, tn.content as { name?: string; promise?: string }]));
  const plan: ScenePlan = {
    goal: c.goal, outcome: c.outcome,
    valueShift: c.value_shift ? { value: c.value_shift.value, from: c.value_shift.from, to: c.value_shift.to, polarity: c.value_shift.polarity } : undefined,
    establishes: c.establishes, needs: c.needs,
    threads: threadRefs.map((r) => ({ name: tById.get(r?.ref ?? "")?.name ?? "(unnamed thread)", promise: tById.get(r?.ref ?? "")?.promise, role: r?.role ?? "advance" })),
  };
  if (!planHasContent(plan)) return { axes: [], summary: "  this scene has no structural plan (no value_shift / establishes / threads) to check against." };
  const axes = await judgeAgainstPlan(apiKey, model, plan, proseText, { fn, bookId, taskTable: "book_agent_runs", taskId: null, userId: null });
  const summary = axes.map((a) => `  ${a.field}: ${a.verdict.toUpperCase()} — ${a.detail}${a.evidence ? ` (e.g. "${a.evidence}")` : ""}`).join("\n");
  return { axes, summary };
}

// Marks the injected auto-verify block so a transient re-chain of the same turn doesn't append it twice.
const VERIFY_SENTINEL = "🔎 AUTO-VERIFY";

// P2.3 — enforced render→verify. In AUTO mode, right after an APPLIED prose render (the render was the prior
// assistant turn; the client has since written the prose and resumed us), judge the rendered scene(s) against
// their OWN plan and INJECT the verdict into the transcript before this turn's model call — so verify is a
// STRUCTURAL step the cheap model can't skip (it was only a line in the objective recipe before) and the model
// is told to FIX any fail before moving on. Returns the augmented { transcript, steps } (persisted) or the
// originals. Best-effort: any failure returns the originals unchanged so the auto loop never breaks.
async function maybeInjectRenderVerify(
  service: SupabaseClient, apiKey: string, model: string, row: RunRow,
): Promise<{ transcript: unknown[]; steps: AgentStep[] }> {
  const fallback = { transcript: row.transcript, steps: row.steps };
  try {
    // deno-lint-ignore no-explicit-any
    const transcript = row.transcript as { role: string; content: any[] }[];
    const lastAssistant = [...transcript].reverse().find((m) => m.role === "assistant");
    const renderUse = lastAssistant?.content?.find?.((b) => b.type === "tool_use" && b.name === "propose_prose_render");
    if (!renderUse) return fallback;
    const sceneIds = (Array.isArray(renderUse.input?.sceneIds) ? renderUse.input.sceneIds : [])
      .filter((s: unknown): s is string => typeof s === "string").slice(0, 3); // bound cost: at most 3 scenes/turn
    if (!sceneIds.length) return fallback;
    const lastMsg = transcript[transcript.length - 1];
    if (!lastMsg || lastMsg.role !== "user" || !Array.isArray(lastMsg.content)) return fallback;
    // Idempotency: skip if we already appended a verdict to this turn's ack (a transient call retry re-runs advance).
    if (lastMsg.content.some((b) => b.type === "text" && String(b.text ?? "").startsWith(VERIFY_SENTINEL))) return fallback;

    const blocks: string[] = [];
    for (const id of sceneIds) {
      const { data: sc } = await service.from("book_nodes").select("content").eq("id", id).maybeSingle();
      const content = (sc as { content?: SceneContent } | null)?.content;
      const res = await planConformanceSummary(service, apiKey, model, content, "book-agent-autoverify", row.book_id);
      if (!res || !res.axes.length) continue; // no prose written yet, or no structural plan → nothing to enforce
      blocks.push(`Scene [${id}] “${nodeHandle(content as Record<string, unknown>)}”:\n${res.summary}`);
    }
    if (!blocks.length) return fallback;
    const text = `${VERIFY_SENTINEL} (plan conformance — the server checked the scene(s) you just rendered against their own plan):\n\n${blocks.join("\n\n")}\n\nIf any axis FAILED, fix that scene FIRST — propose_prose_render again with a corrective brief, or propose_node_ops for a small wording fix — before rendering the next scene. If all PASSED, continue.`;
    const augmented = transcript.map((m, i) => i === transcript.length - 1 ? { ...m, content: [...m.content, { type: "text", text }] } : m);
    const steps = [...row.steps, { t: "read", label: "Auto-verified the rendered scene against its plan." } as AgentStep];
    await service.from("book_agent_runs").update({ transcript: augmented, steps }).eq("id", row.id);
    return { transcript: augmented, steps };
  } catch (e) {
    console.error(`book-agent auto-verify skipped (run ${row.id}):`, e);
    return fallback;
  }
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

// ── Tools shared across every thread (ask_author/finish are control-flow, not DNA-specific) ──────
const SHARED_TOOLS = [
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
    name: "finish",
    description: "End your turn without proposing a change — when the author's ask is answered by discussion alone, or (in autonomous mode) once every requested change has been made.",
    input_schema: {
      type: "object",
      properties: { report: { type: "string", description: "A short honest summary of what you found/did." } },
      required: ["report"],
    },
  },
];

// ── Thread mode = the DNA omni-rail (docs/agent-rail.md) ──────────────────────
// The agent holds the book's DNA tree (book_nodes), discusses it, and proposes node ops the author
// reviews and applies. No context fence: it sees + may write the whole book (scope is forced null,
// docs/agent-context-model.md); the scope plumbing below is inert until/unless a fence returns.
interface DnaNodeRow { id: string; parent_id: string | null; kind: string; level: number; position: number; content: Record<string, unknown>; authoring: { locked?: boolean; status?: string } | null; proposals?: { id: string; content: Record<string, unknown>; note?: string }[] | null }

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
  world_fact: ["name", "rule", "mechanism"],
  location: ["name", "mood"],
  thread: ["name", "kind", "promise"],
  game: ["name", "win_condition", "lose_condition"],
  tentpole: ["summary"],
  meter: ["name", "kind"],
  voice_profile: ["pov", "tense", "style"],
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

// Scene drafted marker — the one question a "draft the book" run asks every turn (is this scene next?),
// unanswerable from goal/value_shift/pov alone. content.prose is nested so DIGEST_FIELDS/pickFields skip it.
function draftedMarker(content: Record<string, unknown> | null | undefined): string {
  const words = (content?.prose as { words?: unknown } | undefined)?.words;
  return typeof words === "number" && words > 0 ? `prose: "${words.toLocaleString()}w"` : "undrafted";
}

// One-line digest of a node: handle/gist + compact spine (prose + verbose fields dropped; read_node for full).
function digestNode(kind: string, content: Record<string, unknown> | null | undefined): string {
  const fields = DIGEST_FIELDS[kind];
  const spine = fields ? pickFields(content, fields) : (content ?? {});
  const gist = kind === "beat" ? gistLine(content) : "";
  const json = Object.keys(spine).length ? JSON.stringify(spine) : "";
  const drafted = kind === "scene" ? draftedMarker(content) : "";
  return [gist, json, drafted].filter(Boolean).join(" · ") || nodeHandle(content);
}

const THREAD_DNA_TOOLS = [
  {
    name: "propose_prose_render",
    description: "Request that the book's prose pipeline (re)generate the FULL prose for one or more scenes — use this whenever the author asks you to write or rewrite a scene's prose from scratch. You do NOT generate the prose yourself: full prose generation is a long, browser-streamed render the author runs (it can't run inside this turn), so this stages a reviewable 'render prose' request the author applies — it then streams in their browser, in the book's voice, with full continuity. The pipeline already has the voice, the mandate, and a continuity digest of every prior page; your job is to ADD what it can't compute — so before you call this, investigate: read the scene's beat and the previous page(s), grep (search_nodes) for the specific threads/objects/facts THIS page must honor, and pass them in `brief`. Pass the scene node id(s) (reading order), a one-line summary, and the curated `brief`. For SMALL wording fixes to EXISTING prose, use propose_node_ops to edit content.prose.text directly instead — only use this for full (re)generation. This records the request and ENDS your turn.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One line: which scene(s) and why you're (re)generating their prose." },
        sceneIds: { type: "array", items: { type: "string" }, description: "The scene node id(s) to (re)generate prose for, in reading order." },
        brief: {
          type: "object",
          description: "OPTIONAL but strongly preferred: your curated, verbatim guidance for this page — injected on top of the pipeline's own context. Only include what you actually retrieved by reading/grepping; do not invent. Omit entirely if you have nothing beyond the plan to add.",
          properties: {
            focus: { type: "string", description: "One line: what this page is really ABOUT — the beat's turn in your read." },
            mustHonor: { type: "array", items: { type: "string" }, description: "Specific continuity that has to land, in your words: named objects, prior promises, a character's state or idiolect you pulled via read_node/search_nodes. e.g. 'Mara still carries the brass keyring she pocketed in ch.1'." },
            avoid: { type: "array", items: { type: "string" }, description: "Things NOT to repeat or contradict, beyond generic anti-repetition: e.g. 'the rain stopped last page — do not re-describe it'." },
          },
        },
      },
      required: ["summary", "sceneIds"],
    },
  },
  {
    name: "check_against_contract",
    description: "Judge a scene's PROSE against its contract — TWO complementary checks: (1) PLAN conformance — does the prose deliver the scene's OWN plan (its planned value_shift, the state keys its causal edges say it must `establishes`/`needs`, its thread work)? This is the scene doing its structural job so later scenes can rely on it. (2) MANDATE conformance — does it honor the book's brief (genre, heat, success criteria)? Pass the scene node's id; the scene must already have prose (content.prose.text) — if empty, propose_prose_render first. `check` selects which: 'plan' (default 'both'), 'mandate', or 'both'. Returns per-axis verdicts (pass / partial / fail) with evidence. Read the scene first if you haven't.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "The scene node's id." }, check: { type: "string", enum: ["plan", "mandate", "both"], description: "Which contract to check: 'plan' (the scene's own DNA plan), 'mandate' (the brief), or 'both' (default)." } }, required: ["id"] },
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
    name: "propose_expansion",
    description: "Delegate a HEAVY STRUCTURAL pass to the book's specialized generation engine instead of authoring it yourself: the GLOBAL beat sheet (target 'beatsheet') or a beat's SCENES (target 'scenes'). Use this — NOT propose_node_ops — for these two passes, because the engine schedules setup→payoff across the whole book, plays the games, and makes each scene inherit its beat's causal/thread/tentpole plan deterministically (craft you can't reliably reproduce by hand). 'beatsheet' generates ALL beats across every act in one causal pass — pass the PILLAR node's id. 'scenes' breaks ONE beat into scenes — pass that BEAT node's id (call it once per beat that still needs scenes, in reading order). This stages a reviewable 'expand' request the author applies; the engine then runs and its result lands in the tree. Authoring the spine (logline, premise, pillar, cast, acts) and small edits is still yours via propose_node_ops / propose_options — only the beat sheet and scenes go through here. ENDS your turn.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One line: what you're expanding and why (e.g. 'generate the global beat sheet', 'break beat 3 into scenes')." },
        nodeId: { type: "string", description: "For 'beatsheet': the PILLAR node's id. For 'scenes': the BEAT node's id to break into scenes." },
        target: { type: "string", enum: ["beatsheet", "scenes"], description: "'beatsheet' = all beats across all acts (nodeId = pillar); 'scenes' = one beat's scenes (nodeId = beat)." },
      },
      required: ["nodeId", "target"],
    },
  },
  {
    name: "propose_options",
    description: "Offer the author 2–4 ALTERNATIVE versions of ONE node's content to choose among (the options picker). Use this when the author asks for options/alternatives, or to break a node out of its one obvious 'modal' version. Each option is a COMPLETE content object for that node's kind (the exact field names from the schema, like an edit's content). The options must be meaningfully different FROM EACH OTHER — but every option MUST HONOR the node's ancestors as FIXED: a child elaborates what's above it (the logline, then the premise), it never rewrites it. Vary ONLY what the parent leaves open (e.g. premise options keep the logline's protagonist / inciting incident / goal / obstacle / stakes fixed and vary only the central question — plot OR thematic — and the optional 5-part shape). NEVER reshape an ancestor's story into a different book, and never offer near-duplicates. This stages the options ON the node (the author picks one in the tree) and ENDS your turn. For a SINGLE revision, use propose_node_ops (edit) instead. Only target a non-locked node.",
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

// The thread tool belt: ask_author + finish always; the DNA tools (the per-op kind fence does the
// fine-grained gating when a scope is set). null/[] scope = all.
function threadToolsFor(_scope: Aspect[] | null): unknown[] {
  return [...SHARED_TOOLS, ...THREAD_DNA_TOOLS];
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

const SYSTEM_THREAD = `## Role

You are a sharp, warm developmental STORY EDITOR — the author's single AI collaborator for the whole book, in conversation in the studio's right-hand rail.

You hold the book's DNA TREE: premise → foundations (pillar, cast, world, tentpoles, voice) → structure (acts, beats, threads) → scenes → prose. You see the WHOLE book and may touch any node (except LOCKED ones); the author anchors your attention by attaching nodes, but never fences you out of the rest. The tree (given below in \`<dna_tree>\`) is a DIGEST — each node shows its handle/gist plus, for structure, its causal + meter spine (connector, needs, establishes, readings). When a node's full detail matters — a beat's whole summary, a character's wound/lie, a scene's prose — read_node it before judging or rewriting. To FIND where something appears across the whole book — a name, a motif, an echoed line, a phrase in the prose the digest doesn't show — use search_nodes, then read_node the hits.

## What you can do

1. DISCUSS — answer, summarize, pressure-test. Reply in plain markdown prose and just end your turn (no tool needed). Be concrete, grounded in the real tree, referencing nodes by their [id]. When a node has PENDING OPTIONS and the author asks which is strongest, just RECOMMEND one in prose (name its option number + a one-line reason tied to the brief) — committing the pick is theirs, in the tree.
2. CHANGE THE TREE — when the author asks for a change (or agrees to one), call propose_node_ops with edit/add/delete ops over the real ids. The author reviews the diff and applies it; descendants of an edited node go stale and are regenerated later. NEVER touch a LOCKED node. Don't propose unless asked — talk first.
3. OFFER OPTIONS — when the author asks for alternatives/options, or to break a node out of its one obvious version, call propose_options with the node's [id] and 2–4 COMPLETE content objects, meaningfully different FROM EACH OTHER but each one HONORING the node's ancestors as fixed: a child elaborates the logline/premise above, it never rewrites it. Vary only what the parent leaves open (premise options keep the logline's protagonist/inciting/goal/obstacle/stakes and vary the central question — plot OR thematic — and optional shape); never reshape an ancestor into a different story, never near-duplicates. The author picks one in the tree. Use this only for choose-among-N; a single revision is propose_node_ops.
4. PROSE — to WRITE or REWRITE a scene's full prose, call propose_prose_render with the scene [id](s): you do NOT generate prose yourself (it's a long, browser-streamed render the author runs); you stage a request the author applies, and it streams in their browser. For SMALL wording fixes to EXISTING prose, use propose_node_ops to edit content.prose.text directly. Call check_against_contract with a scene's [id] to judge its EXISTING prose against the brief mandate (genre, heat, voice, success criteria) and relay the per-axis verdict. A common request — "write the first scene and see if it meets the brief" — is propose_prose_render (the author applies it; prose streams in) then check_against_contract once the scene has prose.
   - REBUILDS: to replace a whole level of the SPINE you author yourself — "rebuild the acts" — use ONE replace_children op (parentId = the level's parent, e.g. the pillar for acts; childKind = act). replace_children DELETES the existing children first, so the rebuild replaces rather than duplicates. Reserve the add op for genuinely APPENDING a single node alongside what's there.
5. BEAT SHEET & SCENES — do NOT author these by hand. The GLOBAL beat sheet and a beat's scenes are HEAVY structural passes with craft you can't reliably reproduce (setup→payoff scheduling across the whole book; each scene inheriting its beat's causal/thread/tentpole plan). Delegate them to the engine: call propose_expansion(nodeId = the PILLAR, target = 'beatsheet') to generate all beats across all acts once acts exist; call propose_expansion(nodeId = a BEAT, target = 'scenes') to break that beat into scenes (once per beat that still needs them). You still author the logline, premise, pillar, cast, and acts yourself (propose_node_ops / propose_options); only the beat sheet and scenes go through propose_expansion. Prose is propose_prose_render (item 4).

## Node kinds

seed, premise, pillar; foundations — character, relationship, world_fact, location, thread, game, tentpole, meter, voice_profile; structure — act, beat, scene. Before you WRITE a node's content (add / edit / replace_children), get the kind's EXACT field names with get_schema (read_node also returns them) — wrong keys silently orphan data.

## Guided flow

When a \`<current_objective>\` block is given, that's the one step to lead the author through next — the lowest unfinished rung of the book's DNA. If the author asks "what's next?", opens a fresh thread, or has no specific ask, drive THAT objective: do the step's recipe, then let the next message advance it. Don't march ahead to later rungs unprompted. But this is an anchor, not a leash — if the author steers somewhere else, follow them.

## Style

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
// Shape the agent's free-form brief into the stored RenderBrief: verbatim strings (we keep the agent's own
// words, per the design), just trimmed + bounded so a runaway tool call can't bloat the proposal. Returns
// undefined when there's nothing usable, so a no-brief render behaves exactly as before.
function sanitizeBrief(raw: unknown): RenderBrief | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { focus?: unknown; mustHonor?: unknown; avoid?: unknown };
  const line = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  const list = (x: unknown) => (Array.isArray(x) ? x.map(line).filter(Boolean).slice(0, 12) : []);
  const focus = line(r.focus).slice(0, 400);
  const mustHonor = list(r.mustHonor);
  const avoid = list(r.avoid);
  if (!focus && !mustHonor.length && !avoid.length) return undefined;
  return { focus, ...(mustHonor.length ? { mustHonor } : {}), ...(avoid.length ? { avoid } : {}) };
}

async function proposeProseRender(
  service: SupabaseClient,
  bookId: number,
  input: { summary?: string; sceneIds?: unknown; brief?: unknown },
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
  return { ok: true, proposal: { id: crypto.randomUUID(), layer: "prose-render", summary: String(input.summary ?? "Render prose").trim() || "Render prose", ops: [], sceneIds, brief: sanitizeBrief(input.brief) } };
}

// Stage an 'expansion' request: the dna-expand engine (client-side, on Apply) generates the beat sheet or a
// beat's scenes. We only VALIDATE the target here (node exists, not locked, right kind for the target); the
// engine does the real work + persistence in the browser (generateExpansionOps → applyNodeOps). 'beatsheet'
// needs the pillar (and acts to hang beats under); 'scenes' needs a beat.
async function proposeExpansion(
  service: SupabaseClient,
  bookId: number,
  input: { summary?: string; nodeId?: string; target?: string },
): Promise<{ ok: true; proposal: AgentProposal } | { ok: false; error: string }> {
  const target = String(input.target ?? "").trim();
  if (target !== "beatsheet" && target !== "scenes") {
    return { ok: false, error: `Unknown target "${target}" — propose_expansion only handles 'beatsheet' (nodeId = pillar) or 'scenes' (nodeId = beat).` };
  }
  const { data: rows } = await service.from("book_nodes").select("id, kind, authoring").eq("book_id", bookId);
  const nodes = (rows ?? []) as { id: string; kind: string; authoring: { locked?: boolean } | null }[];
  const node = nodes.find((n) => n.id === input.nodeId);
  if (!node) return { ok: false, error: `No node with id ${input.nodeId}.` };
  if (node.authoring?.locked) return { ok: false, error: `Node ${input.nodeId} is LOCKED — unlock it before expanding.` };
  if (target === "beatsheet") {
    if (node.kind !== "pillar") return { ok: false, error: `'beatsheet' expands the PILLAR (all acts at once) — pass the pillar node's id, not a ${node.kind}.` };
    if (!nodes.some((n) => n.kind === "act")) return { ok: false, error: "There are no acts yet — author the acts first (propose_node_ops), then generate the beat sheet." };
  }
  if (target === "scenes" && node.kind !== "beat") {
    return { ok: false, error: `'scenes' breaks ONE beat into scenes — pass a beat node's id, not a ${node.kind}.` };
  }
  const label = target === "beatsheet" ? "Generate the global beat sheet" : "Break the beat into scenes";
  return { ok: true, proposal: { id: crypto.randomUUID(), layer: "expansion", summary: String(input.summary ?? label).trim() || label, ops: [], nodeId: node.id, target } };
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
async function threadSystem(service: SupabaseClient, bookId: number, scope: Aspect[] | null, analysis: string | null, effort: "low" | "high" = "high", auto = false, objective: string | null = null, attachedIds: string[] | null = null): Promise<string> {
  const { data: book } = await service.from("books").select("name, brief, mode").eq("id", bookId).maybeSingle();
  const b = book as { name?: string; brief?: Brief; mode?: "prose" | "picture" } | null;
  const { data: rows } = await service
    .from("book_nodes").select("id, parent_id, kind, level, position, content, authoring, proposals").eq("book_id", bookId);
  const nodes = (rows ?? []) as DnaNodeRow[];
  const kinds = scopedKinds(scope); // null = all
  const totalScenes = nodes.filter((n) => n.kind === "scene").length;
  const totalBeats = nodes.filter((n) => n.kind === "beat").length;

  const serialize = (n: DnaNodeRow, inScope: boolean, seqIdx?: number): string => {
    if (!inScope) return `[${n.id}] L${n.level} ${n.kind}: <hidden>`;
    // Beats and scenes carry their 1-based reading-order number (matching the UI's tree badge + timeline
    // strip), so the agent names a node by the SAME number the author sees — not one it invents from the
    // objective's single "Scene N of 80" target pointer (the bug where it called scene 14 "scene 17").
    const total = n.kind === "scene" ? totalScenes : totalBeats;
    const num = seqIdx && (n.kind === "scene" || n.kind === "beat") ? ` ${seqIdx}/${total}` : "";
    let line = `[${n.id}${n.authoring?.locked ? " · LOCKED" : ""}] L${n.level} ${n.kind}${num}: ${digestNode(n.kind, n.content)}`;
    // Pending options (the picker channel) — surfaced so you can RECOMMEND which the author should pick.
    if (Array.isArray(n.proposals) && n.proposals.length) {
      line += `\n  PENDING OPTIONS (${n.proposals.length} — the author picks one; you may recommend which by its number): ` +
        JSON.stringify(n.proposals.map((p, i) => ({ option: i + 1, ...p.content })));
    }
    return line;
  };

  // Depth-first, by position — mirrors the client's reading order (novelDna.ts childrenOf/scenesInOrder), so
  // a beat's scenes list right after it and in draft order. A flat sort by `level` alone (the old behavior)
  // interleaves every act's beats and every beat's scenes into one global by-level list with no parent
  // linkage shown, so the agent had no way to tell which beat a scene belonged to — it once rendered a
  // later beat's scene believing it was next. Out-of-scope nodes still appear (as <hidden>) so ids for
  // parentId stay available.
  const byParent = new Map<string | null, DnaNodeRow[]>();
  for (const n of nodes) {
    const list = byParent.get(n.parent_id) ?? [];
    list.push(n);
    byParent.set(n.parent_id, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position);
  const visited = new Set<string>();
  const sorted: DnaNodeRow[] = [];
  const walk = (n: DnaNodeRow) => {
    if (visited.has(n.id)) return;
    visited.add(n.id);
    sorted.push(n);
    for (const c of byParent.get(n.id) ?? []) walk(c);
  };
  for (const root of byParent.get(null) ?? []) walk(root);
  // A node whose parent_id doesn't resolve within this book (orphaned/inconsistent data) would otherwise
  // vanish from the walk above — append any leftovers so the agent never silently loses a node's id.
  for (const n of nodes) walk(n);
  // Reading-order numbers for beats and scenes, assigned over the SAME DFS-by-position walk the client's
  // beatsInOrder/scenesInOrder / the render / the timeline strip use — so "beat 3"/"scene 14" denote the same
  // node in the digest, the UI, and the book.
  const beatNo = new Map<string, number>();
  const sceneNo = new Map<string, number>();
  for (const n of sorted) {
    if (n.kind === "beat") beatNo.set(n.id, beatNo.size + 1);
    else if (n.kind === "scene") sceneNo.set(n.id, sceneNo.size + 1);
  }
  const seqOf = (n: DnaNodeRow) => n.kind === "beat" ? beatNo.get(n.id) : n.kind === "scene" ? sceneNo.get(n.id) : undefined;
  const tree = sorted.map((n) => serialize(n, !kinds || kinds.has(n.kind), seqOf(n))).join("\n");

  // The context tray, HYDRATED: the author attached these nodes to work on, so we inline their FULL content
  // right here (not a bare pointer) — the agent doesn't need a read_node round-trip for the nodes it was
  // explicitly told matter. Ids that no longer resolve (a since-deleted node) drop out silently. Prose is
  // only carried for scene nodes — no other kind holds prose, and it's the bulk of the tokens, so we strip a
  // stray `prose` key from anything else. This block is rebuilt every turn from the live tree, so it can
  // never go stale the way the old glued-to-the-message "Focus —" prefix did.
  const byIdRow = new Map(nodes.map((n) => [n.id, n]));
  const focusNodes = (attachedIds ?? []).map((id) => byIdRow.get(id)).filter((n): n is DnaNodeRow => !!n);
  const focus = focusNodes.map((n) => {
    const content: Record<string, unknown> = { ...(n.content ?? {}) };
    if (n.kind !== "scene") delete content.prose; // prose only rides for scenes (docs/agent-context-model.md)
    return `[${n.id}${n.authoring?.locked ? " · LOCKED" : ""}] ${n.kind} “${nodeHandle(n.content)}”:\n${JSON.stringify(content)}`;
  }).join("\n\n");

  // LIVE re-derivation (docs/agent-improvement-plan.md P1.2): recompute the guided-flow objective and the
  // structural backstop from the CURRENT tree, so an auto run's resume — a pure status flip that never
  // refreshes the message-time snapshot — no longer keeps pointing at "TARGET NODE: scene 14" after scene 14
  // renders. Same functions the web client runs (currentObjective / analysisText), so the anchor advances on
  // its own each chain link. The client-computed `analysis`/`objective` params are kept only as a fallback for
  // the (transient) case where the live tree hasn't loaded. Map DB rows → the engine's DnaNode shape;
  // authoring.source isn't read by these derivations, so a constant is safe (see novelDna editContent).
  const liveNodes: DnaNode[] = nodes.map((n) => ({
    id: n.id, book_id: bookId, parent_id: n.parent_id, level: n.level, kind: n.kind as NodeKind, position: n.position,
    content: (n.content ?? {}) as NodeContent,
    authoring: { source: "user", locked: n.authoring?.locked ?? false, status: (n.authoring?.status as AuthoringStatus) ?? "empty" },
    proposals: n.proposals ?? undefined, chosen: null,
  }));
  const mode = b?.mode === "picture" ? "picture" : "prose";
  const liveObjective = currentObjective(liveNodes, { mode, bookSlug: String(bookId) }) || objective;
  // Only meaningful once structure exists — mirrors the client's gate (AgentRail), which sends undefined
  // otherwise. analysisText ignores its settings arg, so we pass {}.
  const hasStructure = liveNodes.some((n) => n.kind === "beat" || n.kind === "scene");
  const liveAnalysis = hasStructure ? analysisText(liveNodes, {}) : (analysis ?? "");

  // Each distinct kind of context gets its own XML tag so the model can unambiguously tell where one
  // section ends and the next begins (Anthropic's prompt-engineering guidance: XML tags reduce
  // misinterpretation when a prompt mixes instructions, context, and a large structured document).
  const blocks = [
    `<book_name>${b?.name ?? ""}</book_name>`,
    `<brief note="binding voice contract">\n${briefContext(b?.brief ?? null, { scope: "full", success: true, none: "(no brief)", empty: "(empty)" })}\n</brief>`,
    // The guided-flow anchor (docs/agent-capabilities.md): the ONE journey rung to drive the author
    // through next, derived client-side from the tree (lib/dnaJourney.currentObjective). An anchor, not
    // a fence — the agent still sees the whole tree below, but leads with this step unless the author
    // steers elsewhere. Recomputed each message, so it advances on its own as the tree fills.
    liveObjective?.trim() ? `<current_objective>\n${liveObjective.trim()}\n</current_objective>` : "",
    // The structural backstop (pacing / dangling-promise / sagging-run lints) — act on any ⚠ flags.
    liveAnalysis?.trim() ? `<story_analysis note="the structural backstop — address any ⚠ flags">\n${liveAnalysis.trim()}\n</story_analysis>` : "",
    // The context tray (docs/agent-context-model.md): the nodes the author attached to work on, hydrated in
    // full so you have their real content without a read_node. Lead with these unless the author steers
    // elsewhere — an anchor, not a fence: the whole tree is still below.
    focus ? `<focus note="the author attached these nodes to work on — their FULL content is inlined here; lead with them">\n${focus}\n</focus>` : "",
    `<dna_tree${kinds ? ` scope="${[...kinds].join(", ")}"` : ""}>\nEdit/add/delete nodes by their real ids below. LOCKED nodes are immutable.${kinds ? " Out-of-scope nodes show as <hidden>." : ""} Beat and scene lines show their reading-order number (e.g. \`beat 3/41\`, \`scene 14/80\`); when you refer to a beat or scene by number, use THAT number — never guess it or reuse the objective's target number for a different node.\n\n${tree || "(no nodes yet)"}\n</dna_tree>`,
  ].filter(Boolean);

  const scopeLine = scope && scope.length
    ? `\n\n<scope_note>\nIn scope this conversation: ${scope.join(", ")}. Only propose changes to these aspects.\n</scope_note>`
    : "";
  const effortLine = effort === "low"
    ? "\n\n<fast_mode>\nThe author wants a quick response. If the change is clear from the tree, call propose_node_ops immediately — one sentence of narration, then the proposal. Skip read_node unless prose content is essential. Only pause to ask if the request is genuinely ambiguous.\n</fast_mode>"
    : "";
  // Autonomous mode: the author is AWAY. The agent must carry every request to a committed change with no
  // human gate — it makes the option choices itself and never waits. (The client auto-applies what it stages.)
  const autoLine = auto
    ? "\n\n<autonomous_mode>\nThe author has stepped away and CANNOT review, pick, or answer. Carry every request all the way to a finished result yourself, then conclude:\n- Make ONE change per turn with propose_node_ops, OR render ONE scene per turn with propose_prose_render. Both are APPLIED LIVE immediately — there is no review step, and your NEXT turn shows the updated tree/scene. Don't say \"I propose\" or wait for approval; just make the change (or request the render), then continue.\n- READ THEN ACT — don't over-read. The tree above is a DIGEST (handle/gist + causal spine). When the change needs a node's full detail (a beat's whole summary, a character's profile, a scene's prose), read_node it FIRST — but only the node(s) you're about to change. Don't sweep the tree; the digest is enough to decide what to touch.\n- NEVER call ask_author. At a creative fork, decide with your best judgment and proceed.\n- Prefer to commit directly: when you'd weigh options, just pick the strongest and write it with propose_node_ops. (Avoid propose_options in autonomous mode — there's no one to pick.)\n- ALWAYS CONCLUDE: once the request is fully handled, call finish with a one-line summary of what you changed. Don't stop mid-thought after a change — keep going until you finish.\n</autonomous_mode>"
    : "";
  return `${SYSTEM_THREAD}${scopeLine}${effortLine}${autoLine}\n\n${blocks.join("\n\n")}`;
}
