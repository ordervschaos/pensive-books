// book-agent side passes: the eager acknowledgement ("say, then do") shown before the real tool turn,
// and the one-shot chat titler. Both are best-effort and run off the main response path.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callLLM, textFromLLM } from "../_shared/llm.ts";
import { isBillingError } from "../_shared/sentry.ts";
import { type AgentStep, type RunRow } from "./shared.ts";
import { EAGER_ACK_SYSTEM, TITLE_SYSTEM } from "./prompts.ts";
import { threadToolsFor } from "./tools.ts";

const ACK_TIMEOUT_MS = 15_000; // fast chat acknowledgement; the real tool turn follows

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
async function maybeEagerAck(service: SupabaseClient, row: RunRow, model: string) {
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
    const toolNames = threadToolsFor().map((t) => (t as { name?: string }).name).filter(Boolean).join(", ");
    const capabilities = toolNames ? `<capabilities>${toolNames}</capabilities>\n` : "";
    const groundedText = objective + trail + capabilities +
      (prior ? `<prior_note>${prior}</prior_note>\n` : "") + userText.slice(0, 2000);
    const resp = await callLLM({
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
async function maybeTitleThread(service: SupabaseClient, model: string, row: RunRow) {
  if (row.title && row.title.trim()) return;
  const first = row.steps.find((s) => s.t === "user")?.label?.trim();
  if (!first) return;
  try {
    const resp = await callLLM({
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

export { maybeEagerAck, maybeTitleThread };
