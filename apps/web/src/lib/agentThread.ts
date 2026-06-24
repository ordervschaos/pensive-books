// agentThread — client surface for the book's ONE persistent agent conversation (docs/agent-rail.md,
// option B). The omni-rail: every AI action will eventually be a message/command into this thread.
//
// The thread lives in a book_agent_runs row with kind='thread' (one per book), driven by the
// revise-agent edge fn — the same durable, self-chaining, stoppable loop as the editor agent, but it
// ends a turn in 'idle' instead of 'done' so the conversation continues. The rail watches the row over
// Realtime (useLatestTaskRow); refresh = no-op.
import { supabase } from "@/integrations/supabase/client";
import type { TaskRow } from "@/hooks/useLatestTaskRow";

export interface AgentStep {
  // user = the author's message · note = the agent's reply/narration · read = a page it read ·
  // ask = a creative question · answer = the author's answer to one · done = a closing report.
  t: "user" | "note" | "read" | "ask" | "answer" | "plan" | "done";
  label: string;
}

export interface AgentThreadRow extends TaskRow {
  kind: string;
  steps: AgentStep[] | null;
  pending: { question: string; options?: string[] } | null;
  report: string | null;
  cancel_requested: boolean;
  error: string | null;
}

export const AGENT_THREAD_SELECT =
  "id, book_id, kind, status, created_at, updated_at, steps, pending, report, cancel_requested, error";

// revise-agent is invoked directly (it is NOT mirrored in the dev bridge — the tool loop runs against
// the deployed edge fn + the active model stack in dev and prod alike).
async function invoke(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke("revise-agent", { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
}

/** Send a free-text message to the book's one agent thread (creates it on first use). */
export async function sendAgentMessage(bookId: number, message: string): Promise<void> {
  await invoke({ bookId, message });
}

/** Answer the agent's pending ask_author question, resuming the parked turn. */
export async function answerAgent(threadId: number, answer: string): Promise<void> {
  await invoke({ runId: threadId, answer });
}
