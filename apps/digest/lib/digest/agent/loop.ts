import type { SupabaseClient } from "@supabase/supabase-js";
import { ConflictError } from "../commands";
import { aiEnabled, callModelStep, type ToolCall, type Turn } from "../llm";
import { TOOLS, runTool, type ToolCtx } from "./tools";

// THE LOOP. One turn of the digest agent: the reader says something, the model reads and edits the digest
// through `tools.ts`, and it ends with something said back.
//
// Runs on DeepSeek, like everything in this app that isn't `web_search` (see `llm.ts` — the policy is
// enforced there, not remembered here).
//
// Note what this is NOT: there is no self-chaining, no durable run row, no watchdog. The DNA agent in the
// main app has all three because Supabase's worker dies at ~150s and a long turn has to survive being cut
// in half. This app is Next on Vercel — 300s and streaming on the ordinary Node runtime — so a turn is one
// request that simply runs to the end. Porting that machinery would be importing a workaround for a
// constraint we don't have.

/** Enough for read → read → act → report, with room to recover from a mistake. Past this something is wrong. */
const MAX_STEPS = 12;

export interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
}

export interface AgentTurn {
  /** What to say back to the reader. */
  text: string;
  /** What it did, in order — the narration the rail renders. */
  steps: AgentStep[];
  /** The conversation including this turn, to be carried into the next one. */
  messages: Turn[];
  stoppedAt: "answer" | "step_limit";
}

export interface DigestForAgent {
  id: number;
  owner_id: string;
  name: string;
  ai_enabled: boolean;
}

/**
 * The constitution: what this agent is and what it must not do. Static, so it sits at the front of the
 * prompt where a cache prefix can hold it — everything that varies per turn goes after.
 *
 * It is short on purpose. The tool descriptions already carry what each source kind is and what each field
 * means (generated from `sectionSchema.ts`), so restating any of that here would create the second copy
 * this codebase keeps deleting.
 */
const CONSTITUTION = `You help someone shape a daily digest that is compiled and mailed to their Kindle each morning.

A digest is a list of SECTIONS. Each section names a source — a feed, a mailbox, a search, their own
Readwise highlights — and every morning the pipeline gathers from it, writes it up, and sends the result.
Nothing you do sends anything: you change the configuration, and tomorrow's issue reflects it.

How to work:
- Read before you write. \`read_digest\` gives you the sections and their ids; \`check_readiness\` tells you
  what would silently fail at 6am; \`read_posts\` is the evidence for whether a source is earning its place.
- Prefer one good change to several speculative ones. This is someone's morning reading, not a backlog.
- Say what you did in one or two plain sentences. No preamble, no restating their request back to them.

Rules:
- NEVER remove a section, delete a message, or turn on a paid setting (ai_enabled, web_search_enabled)
  unless the reader has asked for that specific thing in this conversation. Ask first; a question is cheap.
- If you don't have what you need — which feed, which book, how often — ask one direct question and stop.
  Guessing a URL is worse than asking.
- If a tool refuses a change, read the refusal. It is usually telling you a real constraint, not a syntax
  problem to work around.`;

/**
 * The volatile half of the prompt: what this digest is, right now.
 *
 * Re-read from the database every turn and placed AFTER the constitution. Both parts of that matter — state
 * that comes from a query cannot be stale, and keeping the static text first is what lets a cache prefix
 * survive a conversation in which the configuration keeps changing.
 */
async function digestState(ctx: ToolCtx): Promise<string> {
  const [digest, readiness] = await Promise.all([
    runTool(ctx, "read_digest", {}),
    runTool(ctx, "check_readiness", {}),
  ]);
  return `<digest_state>\n${digest}\n\nReadiness:\n${readiness}\n</digest_state>`;
}

export async function runAgentTurn(opts: {
  supabase: SupabaseClient;
  digest: DigestForAgent;
  /** Everything said so far. Empty for a new conversation. */
  history: Turn[];
  message: string;
  signal?: AbortSignal;
}): Promise<AgentTurn> {
  if (!aiEnabled(opts.digest)) {
    throw new Error(
      "AI is off for this digest, and the agent is a model call like any other. Turn on AI writing in " +
        "Settings first.",
    );
  }

  // The concurrency guard, captured ONCE at the start of the turn: every write this turn makes is checked
  // against the configuration the model actually reasoned about, not against whatever the row says a
  // millisecond before the write lands. See `commands.ts` — this is the long window.
  const { data } = await opts.supabase
    .from("digests")
    .select("sections_version")
    .eq("id", opts.digest.id)
    .single();
  const ctx: ToolCtx = {
    supabase: opts.supabase,
    digestId: opts.digest.id,
    sections: { version: (data as { sections_version: number } | null)?.sections_version ?? 0 },
  };

  const system = `${CONSTITUTION}\n\n${await digestState(ctx)}`;
  const messages: Turn[] = [...opts.history, { role: "user", content: opts.message }];
  const steps: AgentStep[] = [];
  const meta = {
    fn: "digest-agent",
    operation: "turn",
    issueId: null,
    userId: opts.digest.owner_id,
  };

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const result = await callModelStep(
      { system, messages, tools: TOOLS, maxTokens: 2000, effort: "low", signal: opts.signal },
      meta,
    );

    messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
    if (!result.toolCalls.length) {
      return { text: result.text, steps, messages, stoppedAt: "answer" };
    }

    // Tool calls run in order rather than in parallel. They write to one jsonb array through one version
    // counter, so a parallel pair would race each other and the second would lose to the first.
    for (const call of result.toolCalls) {
      const outcome = await execute(ctx, call);
      steps.push(outcome);
      messages.push({ role: "tool", toolCallId: call.id, content: outcome.result });
    }
  }

  return {
    text:
      "I stopped after too many steps without reaching an answer. Nothing further was changed — " +
      "tell me what you'd like me to do and I'll take a narrower run at it.",
    steps,
    messages,
    stoppedAt: "step_limit",
  };
}

/**
 * Run one tool call, and turn every failure into something the model can read.
 *
 * Nothing here throws. A malformed argument, a refused write, a lost race — each is a thing the model can
 * respond to sensibly if it is told plainly, and each becomes an unrecoverable turn if it isn't. The
 * conflict case is the one worth naming: the instruction is to RE-READ, never to retry, because a retry
 * re-applies an intent computed against a configuration that no longer exists.
 */
async function execute(ctx: ToolCtx, call: ToolCall): Promise<AgentStep> {
  if (call.parseError) {
    return { tool: call.name, input: {}, result: `Error: ${call.parseError}`, isError: true };
  }
  try {
    return { tool: call.name, input: call.input, result: await runTool(ctx, call.name, call.input), isError: false };
  } catch (e) {
    const error = e as Error;
    const result =
      error instanceof ConflictError
        ? `${error.message}\n\nCall read_digest again and decide what to do given how it looks now. Do not simply repeat the change.`
        : `Error: ${error.message}`;
    return { tool: call.name, input: call.input, result, isError: true };
  }
}
