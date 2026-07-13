// book-agent chain-link engine: advance() drives ONE turn of the durable loop — load the run, make one
// Claude call (bounded to the worker clock), execute/dispatch its tool calls, then persist and chain or
// park. chain() is the self-invoke that steps the loop; ackWith/rejectAndChain are its dispatch helpers.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callLLM } from "../_shared/llm.ts";
import { getRoleModels } from "../_shared/model-config.ts";
import { reinvoke } from "../_shared/self-chain.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";
import { ROW_COLS, type AgentProposal, type AgentStep, type Aspect, type Pending, type RunRow } from "./shared.ts";
import { threadToolsFor } from "./tools.ts";
import { toolResults } from "./exec-tools.ts";
import { maybeInjectRenderVerify } from "./verify.ts";
import { threadSystem } from "./context.ts";
import { proposeExpansion, proposeNodeOps, proposeOptions, proposeProseRender } from "./proposals.ts";
import { maybeEagerAck, maybeTitleThread } from "./ack.ts";
import { AUTO_CONTINUE_SENTINEL, FORCE_COMMIT_AFTER_READS, FORCE_COMMIT_SENTINEL, compactTranscript, latestAuthorAsk, trailingReadRun, withBookState, withCacheBreakpoints } from "./transcript.ts";

const MAX_TURNS = 20;          // model calls per run — the runaway guard
const AUTO_MAX_TURNS = 50;     // autonomous threads iterate change-by-change, so they get a higher ceiling
// One call must finish inside the ~150s worker wall clock (with headroom for the row writes and
// the chain dispatch). An abort still BILLS — the API keeps generating after we hang up — so the
// real defense is keeping turns short (effort: medium below), not this timer.
const CALL_TIMEOUT_MS = 140_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Self-chain: re-invoke ourselves to drive the run's next turn (the durable loop's step edge). No-op
// outside the edge runtime (local/tests), where EdgeRuntime is undefined.
function chain(runId: number) {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("book-agent", { runId }));
}

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
async function advance(service: SupabaseClient, runId: number) {
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
      await maybeEagerAck(service, row, ackModel);
      // Name the chat from its first message, once, off the response path (the history rail lists chats by
      // this title). Fire-and-forget: a failure or slow model must never delay the author's actual turn.
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(maybeTitleThread(service, ackModel, row));
    }
    // P2.3 — enforced render→verify (auto only): if the prior turn was an applied prose render, inject a
    // plan-conformance verdict into the transcript before this turn's model call. Best-effort; returns the
    // originals if nothing to verify or on any error, so the loop is never blocked.
    const rvResult = auto
      ? await maybeInjectRenderVerify(service, model, row)
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
      resp = await callLLM({
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

export { advance, chain };
