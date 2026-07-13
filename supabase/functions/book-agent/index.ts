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
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callLLM, textFromLLM } from "../_shared/llm.ts";
import { getRoleModels } from "../_shared/model-config.ts";
import { serviceClient, userClient as createUserClient } from "../_shared/task.ts";
import { reinvoke, isChainCall } from "../_shared/self-chain.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";
import { ASPECTS, ROW_COLS, type AgentProposal, type AgentStep, type Aspect, type Pending, type RunRow } from "./shared.ts";
import { EAGER_ACK_SYSTEM, TITLE_SYSTEM } from "./prompts.ts";
import { threadToolsFor } from "./tools.ts";
import { toolResults } from "./exec-tools.ts";
import { maybeInjectRenderVerify, VERIFY_SENTINEL } from "./verify.ts";
import { threadSystem } from "./context.ts";
import { proposeExpansion, proposeNodeOps, proposeOptions, proposeProseRender } from "./proposals.ts";


const MAX_TURNS = 20;          // model calls per run — the runaway guard
const AUTO_MAX_TURNS = 50;     // autonomous threads iterate change-by-change, so they get a higher ceiling
// One call must finish inside the ~150s worker wall clock (with headroom for the row writes and
// the chain dispatch). An abort still BILLS — the API keeps generating after we hang up — so the
// real defense is keeping turns short (effort: medium below), not this timer.
const CALL_TIMEOUT_MS = 140_000;
const ACK_TIMEOUT_MS = 15_000; // fast chat acknowledgement; the real tool turn follows

// ── Context compaction ──
// A long run's transcript accumulates every read_node/search_nodes result — 14 full scene reads is
// ~200k chars (~50k tokens) re-sent on EVERY subsequent call. Observed on book 1229: once the prompt
// crossed ~60k tokens, most MuleRouter calls blew the 140s timeout (uncached prefill + reasoning) and
// the loop crawled at one successful turn per ~4 attempts. Once the transcript outgrows COMPACT_OVER,
// stub the bulky tool_result bodies in every tool-results message EXCEPT the newest BULKY one — the
// model's current working set stays intact, older reads become a one-line pointer it can re-read on
// demand (the live tree digest is always in <book_state> anyway). Keyed to the newest BULKY message,
// not a trailing-message count and not just any tool_result: batched turns pack a whole read sweep
// into ONE huge message, so a count-based window protects everything or nothing (the v1 bug — a count
// of 6 protected the entire 7-message transcript); and the post-apply "✓ Applied" ACK is itself a tiny
// tool_result message, so "newest tool message" flipped to the ack right after every apply and pruned
// the read sweep the model still needed — it then re-read everything, fixed one thing, lost it again
// (the v2 bug, caught live as a search/read/apply/re-read loop). Only a message actually CARRYING big
// results claims protection. Blocks are REPLACED, never removed, so tool_use ↔ tool_result pairing
// survives. Deterministic, so a retried link re-derives the identical transcript.
const COMPACT_OVER = 120_000; // chars of transcript JSON (~30k tokens) before pruning kicks in
const STUB_OVER = 700;        // only stub results bigger than this (small acks/errors aren't worth it)

function compactTranscript(transcript: unknown[]): unknown[] {
  if (JSON.stringify(transcript).length <= COMPACT_OVER) return transcript;
  // deno-lint-ignore no-explicit-any
  const hasBulkyResults = (m: any) =>
    m?.role === "user" && Array.isArray(m.content) &&
    // deno-lint-ignore no-explicit-any
    m.content.some((b: any) => b?.type === "tool_result" && typeof b.content === "string" && b.content.length > STUB_OVER && !b.content.includes("[PRUNED"));
  const newestToolMsg = transcript.reduce<number>((acc, m, i) => (hasBulkyResults(m) ? i : acc), -1);
  let changed = false;
  const out = transcript.map((m, i) => {
    if (i >= newestToolMsg || !hasBulkyResults(m)) return m;
    let msgChanged = false;
    // deno-lint-ignore no-explicit-any
    const content = ((m as { content: any[] }).content).map((b) => {
      if (b?.type !== "tool_result" || typeof b.content !== "string" || b.content.length <= STUB_OVER) return b;
      if (b.content.includes("[PRUNED")) return b; // already stubbed on a prior pass
      msgChanged = true;
      return { ...b, content: `${b.content.slice(0, 80)}… [PRUNED — an older full read, removed to keep context small. The live tree is in <book_state>; read_node/search_nodes again if you need this content.]` };
    });
    if (!msgChanged) return m;
    changed = true;
    return { ...(m as Record<string, unknown>), content };
  });
  return changed ? out : transcript;
}

// Sentinel prefixing the one-shot "act or finish" prod injected when an AUTONOMOUS turn ends with
// prose and no tool call. Its presence in the previous user message means the model stalled twice
// in a row — then the run goes idle honestly instead of prodding forever.
const AUTO_CONTINUE_SENTINEL = "[auto-continue]";

// Hard backstop for the gather-forever failure mode observed live on book 1229 (2026-07-09): a lint
// with hits scattered across a dozen+ scenes made the agent try to build a "complete inventory"
// before proposing anything — the compaction window prunes earlier reads before they're ever used,
// so it re-reads forever (one run hit 125 steps / 15 turns / 0 applies). Prompt guidance alone
// ("batch, don't sweep") cut the rate but didn't stop it — this forces a commit once reads run too
// long uninterrupted by any propose_*/finish.
const FORCE_COMMIT_AFTER_READS = 15;
const FORCE_COMMIT_SENTINEL = "[force-commit]";

// Trailing 'read' steps since the last commit-shaped step (plan/done/decision/answer/ask/user) —
// 'note' steps (a turn's own "let me look at X" narration) don't reset the count.
function trailingReadRun(steps: AgentStep[]): number {
  let n = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const t = steps[i].t;
    if (t === "read") { n++; continue; }
    if (t === "note") continue;
    break;
  }
  return n;
}



// Self-chain: re-invoke ourselves to drive the run's next turn (the durable loop's step edge). No-op
// outside the edge runtime (local/tests), where EdgeRuntime is undefined.
function chain(runId: number) {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId }));
}

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
    const userClient = createUserClient(req.headers.get("Authorization") ?? "");
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
      chain(row.id);
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
      chain(row.id);
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
        chain(id);
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
      chain(thread.id);
      return json({ status: "running", runId: thread.id }, 202);
    }

    return json({ error: "Unrecognized request — expected { message } for the agent thread, { runId, answer }, or { runId, chain }." }, 400);
  } catch (e) {
    console.error("book-agent error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// tool_result blocks for a turn's tool_uses: `message` for the terminal call, "ok" for its siblings —
// GPT requires a result for EVERY tool_call in an assistant message (Claude closes them implicitly).
// The all-"ok" case is ackResults() inside advance().
// deno-lint-ignore no-explicit-any
const ackWith = (toolUses: any[], callId: string, message: string) =>
  toolUses.map((t) => ({ type: "tool_result", tool_use_id: t.id, content: t.id === callId ? message : "ok" }));

// A propose_* tool's input was rejected: hand the model the reason as the failing call's tool_result
// (its sibling reads still execute), persist, and chain so it can correct and retry next turn.
async function rejectAndChain(
  service: SupabaseClient, runId: number, bookId: number,
  // deno-lint-ignore no-explicit-any
  toolUses: any[], steps: AgentStep[], transcript: unknown[],
  callId: string, message: string, auto: boolean,
) {
  const results = await toolResults(service, bookId, toolUses, steps, { [callId]: message }, auto);
  transcript.push({ role: "user", content: results });
  await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
  chain(runId);
}

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
    // _shared/llm.ts converts tools/tool_use/tool_result both ways for the OpenAI-compatible paths
    // (DeepSeek, MuleRouter/Qwen), so the loop runs on cheap models too — EXCEPT ones with no tool-use
    // endpoint (hermes 404s "No endpoints found that support tool use"). getRoleModels().agent is fenced
    // to a tool-capable model in model-config.ts, so `model` here is always safe to send `tools` to.
    const { agent: model, low: ackModel } = await getRoleModels();
    // Eager ack (fresh threads only) mutates row.steps in place — run it BEFORE capturing baseSteps below,
    // so the "unchanged steps" re-write at the update() a few lines down carries the ack note forward
    // instead of clobbering it with a pre-ack snapshot (the note would flash onto the row then vanish).
    if (row.turns === 0) {
      await maybeEagerAck(service, apiKey, row, ackModel);
      // Name the chat from its first message, once, off the response path (the history rail lists chats by
      // this title). Fire-and-forget: a failure or slow model must never delay the author's actual turn.
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(maybeTitleThread(service, apiKey, ackModel, row));
    }
    // P2.3 — enforced render→verify (auto only): if the prior turn was an applied prose render, inject a
    // plan-conformance verdict into the transcript before this turn's model call. Best-effort; returns the
    // originals if nothing to verify or on any error, so the loop is never blocked.
    const rvResult = auto
      ? await maybeInjectRenderVerify(service, apiKey, model, row)
      : { transcript: row.transcript as unknown[], steps: row.steps };
    const rawTranscript = rvResult.transcript;
    let baseSteps = rvResult.steps;
    // Prune stale bulky reads once the transcript is big (see compactTranscript). Persisted below with
    // the turns tick when it changed, so the row shrinks too (Realtime payload, next link's load).
    const baseTranscript = compactTranscript(rawTranscript);
    const compacted = baseTranscript !== rawTranscript;
    // The stable system prompt + the volatile book state (rebuilt per call so ids stay fresh; injected
    // into the latest message, not the system prompt — see threadSystem/withBookState), and the tool belt.
    const turns = row.turns + 1;
    // Boundaries removed (docs/agent-context-model.md): the agent always sees + may touch the whole book.
    // Forced null here (not row.context_scope) so even threads created under the old aspect-fence run
    // unfenced from now on; context is anchored by attached nodes, not filtered by kind.
    const scope: Aspect[] | null = null;
    const effort = row.context_effort ?? "high";
    // The author's standing ask: grounds the <task> anchor (appended after <book_state>) and the
    // intent hydration inside threadSystem (nodes the message names get their full plan inlined).
    const authorAsk = latestAuthorAsk(baseTranscript);
    // `auto` (autonomous mode: never park, commit own picks) computed above for the turn ceiling.
    const { instructions, bookState, groundingLabels } = await threadSystem(service, row.book_id, scope, row.context_analysis, effort, auto, row.context_objective, row.context_attached_ids, authorAsk);
    // Grounding steps (docs/agent-turn-grounding.md): surface what got silently pre-loaded this turn
    // (skill briefs, focus/mentioned node content) BEFORE the model call, so the author sees concrete
    // activity during the wait instead of a bare spinner. Folded into the same pre-call write below — no
    // extra round-trip. Deduped against this turn-cluster (since the last user/answer step): an auto run
    // re-injects the SAME skill/nodes every turn while nothing changed, and repeating the identical line
    // turn after turn is noise (this was the "10 identical Step 5/5 lines" bug), not information.
    const sinceUser = new Set<string>();
    for (let i = baseSteps.length - 1; i >= 0 && baseSteps[i].t !== "user" && baseSteps[i].t !== "answer"; i--) sinceUser.add(baseSteps[i].label);
    const freshGrounding = groundingLabels.filter((label) => !sinceUser.has(label));
    if (freshGrounding.length) baseSteps = [...baseSteps, ...freshGrounding.map((label) => ({ t: "read", label } as AgentStep))];
    const tools = threadToolsFor(scope);
    // Count the turn BEFORE the call: a hard worker death mid-call still consumes budget, so a
    // crash-looping run hits MAX_TURNS instead of being revived forever by the watchdog.
    // Re-write `steps` (unchanged) alongside `turns` so this mid-"thinking" Realtime event carries the
    // steps column — otherwise Postgres omits the unchanged TOASTed jsonb from the WAL new-tuple and the
    // client's row arrives with steps=null, blanking the feed. (REPLICA IDENTITY FULL is the broader fix.)
    await service.from("book_agent_runs").update({ turns, steps: baseSteps, ...(compacted ? { transcript: baseTranscript } : {}) }).eq("id", runId);

    // Poll for cancel_requested every 1s during the call so a user stop aborts the in-flight
    // Claude request rather than waiting up to CALL_TIMEOUT_MS for it to finish naturally. (Was
    // 5s — the composer stays locked until this fires, so the interval directly sets the worst-case
    // "stop felt unresponsive" wait; 1s trades a few more cheap SELECTs for a tighter bound.)
    const cancelCtrl = new AbortController();
    const cancelPoll = setInterval(async () => {
      const { data: cr } = await service.from("book_agent_runs").select("cancel_requested").eq("id", runId).maybeSingle();
      if ((cr as { cancel_requested?: boolean } | null)?.cancel_requested) cancelCtrl.abort("cancel_requested");
    }, 1000);
    const callSignal = AbortSignal.any([AbortSignal.timeout(CALL_TIMEOUT_MS), cancelCtrl.signal]);

    let resp;
    try {
      resp = await callLLM(apiKey, {
        model,
        // Sized to the 140s timer, not to ambition: decode runs ~55 tok/s on both the qwen and
        // sonnet tiers, so ~5k generated tokens (+ ~20s prefill) is all that physically fits. 8000
        // promised more than the clock could deliver — near-max turns died at 140s, were retried
        // verbatim, and timed out again in billed streaks (ai_calls 7830-32, 7853-55, 2026-07-09).
        // On Anthropic, thinking counts inside max_tokens, so this bounds the whole turn; big
        // proposals split across turns by design (replace_text keeps edits small).
        max_tokens: 5000,
        thinking: { type: "adaptive" },
        // effort defaults to HIGH, which made every turn think past the 120s timer (observed:
        // five consecutive aborted-and-billed 120s calls). Medium keeps a turn at ~30-60s; the
        // author-gated plan review downstream is the quality backstop. On the OpenAI-compatible
        // tiers this now maps to a provider reasoning bound in llm.ts (it was silently dropped
        // before — qwen reasoned unbounded, the root cause of the 2026-07-09 timeout streaks).
        output_config: { effort: "medium" },
        system: [{ type: "text", text: instructions, cache_control: { type: "ephemeral" } }],
        tools,
        messages: withBookState(withCacheBreakpoints(baseTranscript), bookState, authorAsk),
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
      chain(runId);
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
          transcript.push({ role: "user", content: ackWith(toolUses, opsCall.id, "✓ Applied to the tree (autonomous mode — no review step). Your next turn will show the updated tree. If the request needs more, propose the next change — batching every remaining INDEPENDENT edit into one propose_node_ops call — or call finish with a one-line summary to conclude.") });
          await service.from("book_agent_runs").update({ status: "idle", transcript, steps, proposals }).eq("id", runId);
          return;
        }
        transcript.push({ role: "user", content: ackResults(toolUses.map((t) => t.id)) });
        await service.from("book_agent_runs")
          .update({ status: "idle", transcript, steps, proposals }).eq("id", runId);
        return; // the agent's narration is the reply; the proposal waits for the author
      }
      await rejectAndChain(service, runId, row.book_id, toolUses, steps, transcript, opsCall.id, `The change was rejected: ${outcome.error} Fix it and call propose_node_ops again, or just reply.`, auto);
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
        transcript.push({ role: "user", content: auto
          ? ackWith(toolUses, renderCall.id, `✓ Render STAGED (autonomous mode). The author's browser will apply it — (re)generating the scene prose — and the result shows on your NEXT turn (do not assume it's already written this turn). Continue if more is needed, or call finish.`)
          : ackResults(toolUses.map((t) => t.id)) });
        await service.from("book_agent_runs").update({ status: "idle", transcript, steps, proposals }).eq("id", runId);
        return; // the proposal waits for the author to apply (the prose render runs client-side)
      }
      await rejectAndChain(service, runId, row.book_id, toolUses, steps, transcript, renderCall.id, `The render request was rejected: ${outcome.error} Fix it and call propose_prose_render again, or just reply.`, auto);
      return;
    }

    // ── propose_expansion: delegate a heavy structural pass (beat sheet / scenes) to the dna-expand engine ──
    // Like propose_prose_render, the engine run happens CLIENT-side (browser owns retry/streaming + reuses the
    // exact generate+persist path); the agent only DECIDES to invoke it. Stage an 'expansion' request in
    // proposals[]; Apply runs generateExpansionOps → applyNodeOps there. Same review channel as the rest.
    const expandCall = toolUses.find((t) => t.name === "propose_expansion");
    if (expandCall) {
      const outcome = await proposeExpansion(service, row.book_id, expandCall.input as { summary?: string; nodeId?: string; target?: string; brief?: unknown });
      if (outcome.ok) {
        steps.push({ t: "plan", label: outcome.proposal.summary });
        const proposals = [...(row.proposals ?? []), outcome.proposal];
        transcript.push({ role: "user", content: auto
          ? ackWith(toolUses, expandCall.id, `✓ Expansion STAGED (autonomous mode). The author's browser will run the engine and apply the result; the new nodes show on your NEXT turn (do not assume they exist yet this turn). Continue, or call finish.`)
          : ackResults(toolUses.map((t) => t.id)) });
        await service.from("book_agent_runs").update({ status: "idle", transcript, steps, proposals }).eq("id", runId);
        return; // the proposal waits for the author to apply (the engine runs client-side)
      }
      await rejectAndChain(service, runId, row.book_id, toolUses, steps, transcript, expandCall.id, `The expansion request was rejected: ${outcome.error} Fix it and call propose_expansion again, or just reply.`, auto);
      return;
    }

    // ── propose_options (thread): stage 2–4 alternatives ON the node and end the turn ──
    // The candidates land on book_nodes.proposals (NOT the run's proposals[]) — the tree's picker renders
    // them and chooseProposal commits one. The agent's narration is the reply; the pick waits for the author.
    const optionsCall = toolUses.find((t) => t.name === "propose_options");
    if (optionsCall) {
      const outcome = await proposeOptions(service, row.book_id, scope, optionsCall.input as { nodeId?: string; kind?: string; parentId?: string; note?: string; options?: unknown[] });
      if (outcome.ok) {
        steps.push({ t: "plan", label: `Staged ${outcome.count} options for "${outcome.handle}" — pick one in the tree.` });
        transcript.push({ role: "user", content: ackResults(toolUses.map((t) => t.id)) });
        await service.from("book_agent_runs").update({ status: "idle", transcript, steps }).eq("id", runId);
        return;
      }
      await rejectAndChain(service, runId, row.book_id, toolUses, steps, transcript, optionsCall.id, `The options were rejected: ${outcome.error} Fix and call propose_options again, or just reply.`, auto);
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

    // ── ask_author: in auto mode the author is away, so don't park — journal the fork as a 'decision'
    // step (question + options + when) so it survives the run for the author to review, then answer
    // instantly and chain, so an unattended run can't deadlock on a creative fork. ──
    const askCall = toolUses.find((t) => t.name === "ask_author");
    if (askCall && auto) {
      const askInput = askCall.input as { question?: string; options?: string[] };
      steps.push({
        t: "decision",
        label: String(askInput?.question ?? "").trim().slice(0, 300),
        options: Array.isArray(askInput?.options) ? askInput.options.map(String).slice(0, 4) : undefined,
        at: new Date().toISOString(),
      });
      const results = await toolResults(service, row.book_id, toolUses, steps, {
        [askCall.id]: "AUTONOMOUS mode — the author is away. Your stated choice is accepted and this fork has been journaled for the author to review later. Proceed with the option you chose; don't re-ask.",
      }, auto);
      transcript.push({ role: "user", content: results });
      await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
      chain(runId);
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
      const readRun = trailingReadRun(steps);
      if (auto && readRun >= FORCE_COMMIT_AFTER_READS) {
        transcript.push({
          role: "user",
          content: [{
            type: "text",
            text: `${FORCE_COMMIT_SENTINEL} You've done ${readRun} reads in a row without proposing a single fix — stop gathering. Pick whatever concrete fixes you can ALREADY make from what you've read (even just 2-3) and call propose_node_ops NOW. Do not read anything else first. If truly nothing you've read is fixable yet, call finish and say what's blocking you.`,
          }],
        });
      }
      await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
      chain(runId);
      return;
    }

    // ── No tool call at all ──
    // A normal conversational reply (the agent answered without needing a tool): the assistant's text
    // is already captured as a 'note' step, so the turn is complete → go idle.
    // EXCEPT in autonomous mode, where a bare narration ("once it applies, I'll render scene 9…") is a
    // stall, not a conclusion — the run would sit idle looking finished while work remains. Prod once:
    // act or call finish. The sentinel bounds it — a second consecutive bare turn goes idle for real.
    if (auto) {
      const prevUser = transcript[transcript.length - 2] as { role?: string; content?: unknown } | undefined;
      const wasNudged = prevUser?.role === "user" && JSON.stringify(prevUser.content ?? "").includes(AUTO_CONTINUE_SENTINEL);
      if (!wasNudged) {
        transcript.push({
          role: "user",
          content: [{
            type: "text",
            text: `${AUTO_CONTINUE_SENTINEL} You ended your turn with prose and no action — in autonomous mode that stalls the build. If the request is fully handled, call finish with a one-line summary. Otherwise take the next concrete step NOW (propose_node_ops / propose_prose_render / propose_expansion).`,
          }],
        });
        await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
        chain(runId);
        return;
      }
    }
    await service.from("book_agent_runs").update({ status: "idle", transcript, steps }).eq("id", runId);
  } catch (e) {
    const billing = isBillingError(e);
    await captureException(e, { function: "book-agent", book_id: String(row.book_id), billing: String(billing) });
    const msg = billing ? "AI credits exhausted — the team has been notified." : String((e as Error)?.message ?? e).slice(0, 1000);
    await service.from("book_agent_runs").update({ status: "error", error: msg }).eq("id", runId);
  }
}



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
    // Cheap grounding, all already in memory (no extra query/call): the guided-flow objective, a sliver of
    // recent trajectory (steps before this fresh user message), and the tool belt's names — so the ack
    // states a real anchor/next-action instead of free-associating from the raw text alone.
    // The objective rides ONLY when the message is GENERIC ("continue", "what's next"): on a concrete ask
    // it was the very thing the ack parroted back instead of the ask (the "acks the next pending task"
    // bug) — prompt guidance alone didn't stop it, so a concrete message now gets no objective at all.
    const generic = userText.trim().length < 18 || /^(continue|next|what'?s next|go( on)?|keep going|yes|ok(ay)?|do it|proceed|sure)\b/i.test(userText.trim());
    const objective = generic && row.context_objective ? `<objective>${row.context_objective}</objective>\n` : "";
    const recentSteps = row.steps.slice(0, -1).slice(-3)
      .map((s) => `${s.t}: ${s.label}`).join("\n");
    const trail = recentSteps ? `<recent_activity>\n${recentSteps}\n</recent_activity>\n` : "";
    const toolNames = threadToolsFor(null).map((t) => (t as { name?: string }).name).filter(Boolean).join(", ");
    const capabilities = toolNames ? `<capabilities>${toolNames}</capabilities>\n` : "";
    const groundedText = objective + trail + capabilities +
      (prior ? `<prior_note>${prior}</prior_note>\n` : "") + userText.slice(0, 2000);
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



// Name a fresh chat from its first message, once. Runs off the response path (fire-and-forget) so a slow or
// failed title never delays the author's turn. Guarded on title being empty, so it fires only on the opening
// turn and never overwrites a name. Best-effort: any failure leaves title null and the rail falls back to the
// client-derived title (the first message, trimmed).
async function maybeTitleThread(service: SupabaseClient, apiKey: string, model: string, row: RunRow) {
  if (row.title && row.title.trim()) return;
  const first = row.steps.find((s) => s.t === "user")?.label?.trim();
  if (!first) return;
  try {
    const resp = await callLLM(apiKey, {
      model,
      max_tokens: 24,
      system: [{ type: "text", text: TITLE_SYSTEM }],
      messages: [{ role: "user", content: [{ type: "text", text: first.slice(0, 1500) }] }],
    }, {
      fn: "book-agent-title",
      bookId: row.book_id,
      taskTable: "book_agent_runs",
      taskId: row.id,
      userId: row.created_by,
    }, { signal: AbortSignal.timeout(ACK_TIMEOUT_MS) });
    const title = textFromLLM(resp)
      .replace(/\s+/g, " ")
      .replace(/^["'“”]+|["'“”.]+$/g, "")
      .trim()
      .slice(0, 60);
    if (!title) return;
    // Don't clobber a title a concurrent turn may have set; only fill it while still null.
    await service.from("book_agent_runs").update({ title }).eq("id", row.id).is("title", null);
  } catch (e) {
    if (isBillingError(e)) throw e;
    console.error(`book-agent run ${row.id} title skipped:`, e);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));



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

// The author's standing ask this turn: the newest user message carrying PLAIN human text — skipping
// tool_result-only messages (mid-loop chain links) and the harness's own injected prods (the
// auto-continue / force-commit / auto-verify sentinels), which are role:"user" but not the author.
// Grounds the <task> anchor + the intent hydration in threadSystem. Deterministic over the stored
// transcript, so a retried link re-derives the identical prompt.
function latestAuthorAsk(transcript: unknown[]): string {
  const msgs = transcript as { role?: string; content?: unknown[] }[];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== "user" || !Array.isArray(m.content)) continue;
    const texts = m.content
      .filter((b) => (b as { type?: string })?.type === "text")
      .map((b) => String((b as { text?: unknown }).text ?? "").trim())
      .filter((t) => t && !t.startsWith(AUTO_CONTINUE_SENTINEL) && !t.startsWith(FORCE_COMMIT_SENTINEL) && !t.startsWith(VERIFY_SENTINEL));
    if (texts.length) return texts.join("\n").trim();
  }
  return "";
}

// Request-time state injection (never persisted): the live book state rides as the FINAL block of the
// latest user message, AFTER withCacheBreakpoints' marks — so the cached prefix (stable system prompt +
// the whole stored transcript) stays byte-identical across turns and only the fresh digest is paid
// uncached. Because it's never stored, the transcript holds exactly ONE current <book_state> per call —
// older turns carry none, so the model can't ground on a stale tree. Call AFTER withCacheBreakpoints
// (which deep-copies, making the append safe).
//
// `task` (the author's standing ask) is RE-STATED after the state dump: without it, the last thing the
// model reads before replying is the tree + lints, not the ask — the salience inversion behind "asked to
// render a scene, went and fixed lints" (long-context guidance: the query belongs AFTER the documents).
function withBookState(msgs: unknown[], state: string, task = ""): unknown[] {
  if (!state.trim() || !msgs.length) return msgs;
  const last = msgs[msgs.length - 1] as { role?: string; content?: unknown[] };
  if (last?.role !== "user" || !Array.isArray(last.content)) return msgs; // every call follows a user message; anything else, skip
  const anchor = task.trim()
    ? `\n\n<task note="the author's CURRENT ask — THIS is your job this turn; everything in <book_state> above is reference, not instruction">\n${task.trim().slice(0, 600)}\n</task>`
    : "";
  last.content = [...last.content, {
    type: "text",
    text: `<book_state note="the CURRENT live book — system-refreshed this turn; this is the tree/objective/analysis your instructions reference">\n${state}\n</book_state>${anchor}`,
  }];
  return msgs;
}

