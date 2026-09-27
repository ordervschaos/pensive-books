// manuscript-agent chain-link engine — the same durable-loop shape as book-agent/advance.ts (one model
// call per link, bounded to the worker clock; execute its tool calls; persist; report whether to step),
// over a far smaller tool belt: pages in, staged changes out. driveChain runs links back-to-back in one
// worker while the wall-clock budget allows, then hands off to a fresh worker via chain().
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callLLM, textFromLLM } from "../_shared/llm.ts";
import { agentModelForTier, getRoleModels } from "../_shared/model-config.ts";
import { reinvoke } from "../_shared/self-chain.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";
import { ROW_COLS, type AgentStep, type ManuscriptChange, type Pending, type RunRow } from "./shared.ts";
import { TOOLS } from "./tools.ts";
import { bookState, toolResults, validateProposal } from "./exec-tools.ts";
import { SYSTEM, TITLE_SYSTEM } from "./prompts.ts";
import { FORCE_COMMIT_AFTER_READS, FORCE_COMMIT_SENTINEL, compactTranscript, latestAuthorAsk, notesBlock, trailingReadRun, withBookState, withCacheBreakpoints } from "./transcript.ts";

const MAX_TURNS = 20;
const CALL_TIMEOUT_MS = 140_000;
const WORKER_WALL_BUDGET_MS = 145_000;
const WRITE_HEADROOM_MS = 5_000;
const MIN_CONTINUE_MS = 90_000;
// Tools whose result is always "ok" — a turn that spoke and only called these needs no continuation.
const RESULT_BLIND = new Set(["record_notes", "suggest_action"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Outcome = "continue" | "retry" | "stop";

function chain(runId: number) {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("manuscript-agent", { runId }));
}

async function driveChain(service: SupabaseClient, runId: number) {
  const started = Date.now();
  while (true) {
    const remaining = WORKER_WALL_BUDGET_MS - (Date.now() - started);
    const callTimeout = Math.min(CALL_TIMEOUT_MS, remaining - WRITE_HEADROOM_MS);
    if (callTimeout < MIN_CONTINUE_MS) { chain(runId); return; }
    const outcome = await advance(service, runId, callTimeout);
    if (outcome === "stop") return;
    if (outcome === "retry") { await sleep(2000); chain(runId); return; }
  }
}

// deno-lint-ignore no-explicit-any
const ackAll = (toolUses: any[]) => toolUses.map((t) => ({ type: "tool_result", tool_use_id: t.id, content: "ok" }));

// Name the chat from its first message, once, off the response path.
async function maybeTitle(service: SupabaseClient, model: string, row: RunRow) {
  if (row.title?.trim()) return;
  const first = row.steps.find((s) => s.t === "user")?.label?.trim();
  if (!first) return;
  try {
    const resp = await callLLM({ model, max_tokens: 30, system: [{ type: "text", text: TITLE_SYSTEM }], messages: [{ role: "user", content: [{ type: "text", text: first.slice(0, 600) }] }] },
      { fn: "manuscript-agent-title", bookId: row.book_id, taskTable: "book_agent_runs", taskId: row.id, userId: row.created_by }, { signal: AbortSignal.timeout(15_000) });
    const title = textFromLLM(resp).replace(/["\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (title) await service.from("book_agent_runs").update({ title }).eq("id", row.id).is("title", null);
  } catch (e) { if (!isBillingError(e)) console.warn("manuscript-agent title skipped:", e); }
}

async function advance(service: SupabaseClient, runId: number, callTimeoutMs = CALL_TIMEOUT_MS): Promise<Outcome> {
  const { data } = await service.from("book_agent_runs").select(ROW_COLS).eq("id", runId).maybeSingle();
  const row = data as RunRow | null;
  if (!row || row.status !== "running") return "stop";
  if (row.cancel_requested) { await service.from("book_agent_runs").update({ status: "cancelled" }).eq("id", runId); return "stop"; }
  if (row.turns >= MAX_TURNS) {
    await service.from("book_agent_runs").update({ status: "error", error: `The agent ran past ${MAX_TURNS} turns without finishing — stopped as a safety measure.` }).eq("id", runId);
    return "stop";
  }

  try {
    // The author's pick (a selectable, tool-capable tier) wins; otherwise the admin's agent model.
    const roles = await getRoleModels();
    const model = agentModelForTier(row.context_model) ?? roles.agent;
    if (row.turns === 0 && typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(maybeTitle(service, roles.low, row));

    const baseTranscript = compactTranscript(row.transcript);
    const compacted = baseTranscript !== row.transcript;
    const baseSteps = row.steps;
    const turns = row.turns + 1;
    const staged = Array.isArray(row.proposals) ? row.proposals : [];
    const state = [await bookState(service, row.book_id, staged), notesBlock(baseSteps)].filter(Boolean).join("\n\n");
    const authorAsk = latestAuthorAsk(baseTranscript);
    // Count the turn BEFORE the call (a worker death mid-call still spends budget); re-write steps
    // alongside so the Realtime event carries the (TOASTed) column — see book-agent for the gotcha.
    await service.from("book_agent_runs").update({ turns, steps: baseSteps, ...(compacted ? { transcript: baseTranscript } : {}) }).eq("id", runId);

    const cancelCtrl = new AbortController();
    const cancelPoll = setInterval(async () => {
      const { data: cr } = await service.from("book_agent_runs").select("cancel_requested").eq("id", runId).maybeSingle();
      if ((cr as { cancel_requested?: boolean } | null)?.cancel_requested) cancelCtrl.abort("cancel_requested");
    }, 1000);
    const signal = AbortSignal.any([AbortSignal.timeout(callTimeoutMs), cancelCtrl.signal]);

    let resp;
    try {
      resp = await callLLM({
        model,
        max_tokens: 6000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages: withBookState(withCacheBreakpoints(baseTranscript), state, authorAsk),
      }, { fn: "manuscript-agent", bookId: row.book_id, taskTable: "book_agent_runs", taskId: runId, userId: row.created_by, transcriptIndex: baseTranscript.length }, { signal });
    } catch (e) {
      clearInterval(cancelPoll);
      if (cancelCtrl.signal.aborted && cancelCtrl.signal.reason === "cancel_requested") {
        await service.from("book_agent_runs").update({ status: "cancelled" }).eq("id", runId);
        return "stop";
      }
      if (isBillingError(e)) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/API 4\d\d:/.test(msg)) {
        await service.from("book_agent_runs").update({ status: "error", error: msg.slice(0, 500) }).eq("id", runId);
        return "stop";
      }
      console.error(`manuscript-agent run ${runId} call failed (turn ${turns}), retrying:`, e);
      return "retry";
    }
    clearInterval(cancelPoll);

    // deno-lint-ignore no-explicit-any
    const content = (resp?.content ?? []) as any[];
    const transcript = [...baseTranscript, { role: "assistant", content }];
    const steps = [...baseSteps];
    for (const b of content) if (b.type === "text" && String(b.text ?? "").trim()) steps.push({ t: "note", label: String(b.text).trim() });
    const toolUses = content.filter((b) => b.type === "tool_use");
    // A `reply` riding inside suggest_action is the chat reply (reasoning tiers often skip text blocks
    // beside a tool call) — surface it like narration, before the action step lands.
    for (const t of toolUses) {
      if (t.name !== "suggest_action") continue;
      const r = String((t.input as { reply?: unknown })?.reply ?? "").trim();
      if (r) steps.push({ t: "note", label: r });
    }
    const spoke = steps.length > baseSteps.length;

    // ── propose_changes: validate against the live pages, stage, end the turn ──
    const propose = toolUses.find((t) => t.name === "propose_changes");
    if (propose) {
      const outcome = await validateProposal(service, row.book_id, propose.input as { summary?: unknown; changes?: unknown }, staged);
      if (outcome.ok) {
        // Sibling result-blind tools (notes / an action) still execute so their steps land.
        const siblings = toolUses.filter((t) => t.id !== propose.id);
        await toolResults(service, row.book_id, siblings, steps);
        steps.push({ t: "plan", label: outcome.summary });
        // Re-read the staged list NOW, not from turn start: the author may have accepted/rejected a change
        // on the canvas while this call ran, and appending onto a stale copy would resurrect it.
        const { data: fresh } = await service.from("book_agent_runs").select("proposals").eq("id", runId).maybeSingle();
        const live = Array.isArray((fresh as { proposals?: unknown } | null)?.proposals) ? (fresh as { proposals: ManuscriptChange[] }).proposals : staged;
        const proposals: ManuscriptChange[] = [...live, ...outcome.changes];
        transcript.push({ role: "user", content: ackAll(toolUses) });
        await service.from("book_agent_runs").update({ status: "idle", transcript, steps, proposals }).eq("id", runId);
        return "stop";
      }
      const results = await toolResults(service, row.book_id, toolUses, steps, { [propose.id]: `The changes were rejected: ${outcome.error} Fix them and call propose_changes again, or just reply.` });
      transcript.push({ role: "user", content: results });
      await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
      return "continue";
    }

    const finish = toolUses.find((t) => t.name === "finish");
    if (finish) {
      const report = String((finish.input as { report?: string })?.report ?? "").trim();
      await toolResults(service, row.book_id, toolUses.filter((t) => t.id !== finish.id), steps);
      if (report && !spoke) steps.push({ t: "done", label: report.slice(0, 600) });
      transcript.push({ role: "user", content: ackAll(toolUses) });
      await service.from("book_agent_runs").update({ status: "idle", transcript, steps, report: report || null }).eq("id", runId);
      return "stop";
    }

    const ask = toolUses.find((t) => t.name === "ask_author");
    if (ask) {
      const input = ask.input as { question?: string; options?: string[] };
      const question = String(input?.question ?? "").trim();
      const preResults = await toolResults(service, row.book_id, toolUses.filter((t) => t.id !== ask.id), steps);
      steps.push({ t: "ask", label: question.slice(0, 400) });
      const pending: Pending = { tool_use_id: ask.id, question, options: Array.isArray(input?.options) ? input.options.map(String).slice(0, 4) : undefined, preResults: preResults.length ? preResults : undefined };
      await service.from("book_agent_runs").update({ status: "awaiting_input", transcript, steps, pending }).eq("id", runId);
      return "stop";
    }

    // Speak-and-act: a reply plus only result-blind tools is a complete exchange — no second call.
    if (toolUses.length && spoke && toolUses.every((t) => RESULT_BLIND.has(t.name))) {
      const results = await toolResults(service, row.book_id, toolUses, steps);
      transcript.push({ role: "user", content: results });
      await service.from("book_agent_runs").update({ status: "idle", transcript, steps }).eq("id", runId);
      return "stop";
    }

    // Reads (and result-blind tools without a reply): execute, append, step.
    if (toolUses.length) {
      const results = await toolResults(service, row.book_id, toolUses, steps);
      transcript.push({ role: "user", content: results });
      if (trailingReadRun(steps) >= FORCE_COMMIT_AFTER_READS) {
        transcript.push({ role: "user", content: [{ type: "text", text: `${FORCE_COMMIT_SENTINEL} You've done ${trailingReadRun(steps)} reads in a row without replying or proposing — stop gathering. Propose what you can from what you've read, answer the author, or call finish and say what's blocking you.` }] });
      }
      await service.from("book_agent_runs").update({ transcript, steps }).eq("id", runId);
      return "continue";
    }

    // No tool at all: a plain conversational reply — the turn is complete.
    await service.from("book_agent_runs").update({ status: "idle", transcript, steps }).eq("id", runId);
    return "stop";
  } catch (e) {
    const billing = isBillingError(e);
    await captureException(e, { function: "manuscript-agent", book_id: String(row.book_id), billing: String(billing) });
    const msg = billing ? "AI credits exhausted — the team has been notified." : String((e as Error)?.message ?? e).slice(0, 1000);
    await service.from("book_agent_runs").update({ status: "error", error: msg }).eq("id", runId);
    return "stop";
  }
}

export { advance, chain, driveChain };
