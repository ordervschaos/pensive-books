// agentThread — client surface for the book's ONE persistent agent conversation (docs/agent-rail.md,
// option B). The omni-rail: every AI action will eventually be a message/command into this thread.
//
// The thread lives in a book_agent_runs row with kind='thread' (one per book), driven by the
// revise-agent edge fn — the same durable, self-chaining, stoppable loop as the editor agent, but it
// ends a turn in 'idle' instead of 'done' so the conversation continues. The rail watches the row over
// Realtime (useLatestTaskRow); refresh = no-op.
import { supabase } from "@/integrations/supabase/client";
import type { TaskRow } from "@/hooks/useLatestTaskRow";
import { applyNodeOps, type NodeOp, type OpValidation } from "@/lib/dnaChat";
import type { NodeKind } from "@/lib/novelDna";

export interface AgentStep {
  // user = the author's message · note = the agent's reply/narration · read = a node it read ·
  // ask = a creative question · answer = the author's answer to one · plan = a proposed change.
  t: "user" | "note" | "read" | "ask" | "answer" | "plan" | "done";
  label: string;
}

// The context filter aspects mirror the DNA tree's visual layers (not the journey stages).
// "cast_world" = pillar + all entity kinds (the tree's "cast & world" group);
// "story" = movements + beats + scenes (the tree's "story" spine).
export type Aspect = "seed" | "premise" | "cast_world" | "story" | "prose";
export const ALL_ASPECTS: Aspect[] = ["seed", "premise", "cast_world", "story", "prose"];
export const ASPECT_LABELS: Record<Aspect, string> = {
  seed: "seed", premise: "premise", cast_world: "cast & world", story: "story", prose: "prose",
};
export const ASPECT_KINDS: Record<Aspect, NodeKind[]> = {
  seed: ["seed"],
  premise: ["premise"],
  cast_world: ["pillar", "character", "relationship", "tentpole", "world_fact", "location", "thread", "game", "voice_profile"],
  story: ["movement", "beat", "scene"],
  prose: ["scene"],
};

// A reviewable change the agent proposes against the DNA tree; the author applies it through the
// existing book_nodes write path (applyNodeOps). See docs/agent-rail.md.
export interface AgentProposal { id: string; layer: "dna"; summary: string; ops: NodeOp[] }

// An archived conversation (the "+ New chat" snapshot), kept on the row for the history viewer.
export interface AgentSession { steps: AgentStep[]; transcript: unknown[]; proposals: AgentProposal[]; ended_at: string }

export interface AgentThreadRow extends TaskRow {
  kind: string;
  steps: AgentStep[] | null;
  pending: { question: string; options?: string[] } | null;
  proposals: AgentProposal[] | null;
  sessions: AgentSession[] | null;
  report: string | null;
  cancel_requested: boolean;
  error: string | null;
}

export const AGENT_THREAD_SELECT =
  "id, book_id, kind, status, created_at, updated_at, steps, pending, proposals, sessions, report, cancel_requested, error";

// revise-agent is invoked directly (it is NOT mirrored in the dev bridge — the tool loop runs against
// the deployed edge fn + the active model stack in dev and prod alike).
async function invoke(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke("revise-agent", { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
}

/** Send a free-text message to the book's one agent thread (creates it on first use). `scope` filters
 *  which book aspects the agent sees + can touch (omit / empty = the whole book). `analysis` is the
 *  client-computed story analysis (the engine lives in the web app) fed as a structural backstop.
 *  `effort` controls response style: "low" = propose inline on first response; "high" (default) = full tool loop. */
export async function sendAgentMessage(bookId: number, message: string, scope?: Aspect[], analysis?: string, effort?: "low" | "high"): Promise<void> {
  await invoke({ bookId, message, ...(scope && scope.length ? { scope } : {}), ...(analysis?.trim() ? { analysis } : {}), ...(effort ? { effort } : {}) });
}

/** Answer the agent's pending ask_author question, resuming the parked turn. */
export async function answerAgent(threadId: number, answer: string): Promise<void> {
  await invoke({ runId: threadId, answer });
}

/** Log a HUMAN decision into the book's agent thread as a visible step WITHOUT a model call — the chat is
 *  the agent's surface, so author actions like choosing/discarding an option register there too. Best-effort:
 *  no-op if the thread doesn't exist yet (nothing to log into) or is mid-turn (don't race the edge fn's
 *  writes — same idle-only safety as dropProposal). Surfaces over Realtime in the rail; refresh = no-op. */
export async function logAgentTurn(bookId: number, label: string, t: AgentStep["t"] = "answer"): Promise<void> {
  const { data } = await supabase.from("book_agent_runs")
    .select("id, status, steps").eq("book_id", bookId).eq("kind", "thread").maybeSingle();
  if (!data) return;
  const busy = data.status === "running" || data.status === "awaiting_input";
  if (busy) return; // don't write steps while the edge fn owns the row
  const steps = [...(Array.isArray(data.steps) ? (data.steps as AgentStep[]) : []), { t, label }];
  await supabase.from("book_agent_runs").update({ steps }).eq("id", data.id);
}

/** Stage a client-GENERATED proposal (produced by the dna-expand engine, not the chat agent) onto the book's
 *  ONE agent thread, so it rides the SAME review channel as the agent's own propose_node_ops: the tree
 *  overlays it as phantoms/marks, and the rail applies/discards it. Creates the thread row (idle) if none
 *  exists yet; refuses while a turn is running (the edge fn owns the row's proposals[] then). */
export async function stageGeneratedProposal(bookId: number, proposal: AgentProposal): Promise<void> {
  const { data } = await supabase.from("book_agent_runs")
    .select("id, status, proposals").eq("book_id", bookId).eq("kind", "thread").maybeSingle();
  if (!data) {
    const { error } = await supabase.from("book_agent_runs")
      .insert({ book_id: bookId, kind: "thread", status: "idle", proposals: [proposal] });
    if (error) throw new Error(error.message);
    return;
  }
  if (data.status === "running" || data.status === "awaiting_input")
    throw new Error("The agent is mid-turn — wait for it to finish, then generate.");
  const next = [...(Array.isArray(data.proposals) ? (data.proposals as AgentProposal[]) : []), proposal];
  const { error } = await supabase.from("book_agent_runs").update({ proposals: next }).eq("id", data.id);
  if (error) throw new Error(error.message);
}

/** Apply a reviewed proposal: run its node ops against book_nodes, then drop it from the thread. Returns the
 *  validation so the rail can warn when the schema boundary rejected some ops (they didn't land). */
export async function applyAgentProposal(bookId: number, threadId: number, proposal: AgentProposal, all: AgentProposal[]): Promise<OpValidation> {
  const validation = await applyNodeOps(bookId, proposal.ops);
  await dropProposal(threadId, proposal.id, all);
  return validation;
}

/** Discard a proposal without applying it. */
export async function discardAgentProposal(threadId: number, proposalId: string, all: AgentProposal[]): Promise<void> {
  await dropProposal(threadId, proposalId, all);
}

// Remove one proposal from the thread's proposals[] (RLS lets the editor update the row; the edge fn
// only writes proposals during a running turn, so there's no collision while the thread is idle).
async function dropProposal(threadId: number, proposalId: string, all: AgentProposal[]): Promise<void> {
  const next = all.filter((p) => p.id !== proposalId);
  const { error } = await supabase.from("book_agent_runs").update({ proposals: next }).eq("id", threadId);
  if (error) throw error;
}

// ── Chat history ── archive the current conversation and start fresh / restore a past one. Client-side
// (RLS allows editor updates) and only safe while the thread is idle — the rail gates on `busy`/active.

const SESSIONS_COLS = "steps, transcript, proposals, sessions";

/** Archive the live conversation into sessions[] and start a fresh, empty thread. */
export async function startNewAgentSession(threadId: number): Promise<void> {
  const { data } = await supabase.from("book_agent_runs").select(SESSIONS_COLS).eq("id", threadId).maybeSingle();
  const steps = Array.isArray(data?.steps) ? (data!.steps as AgentStep[]) : [];
  if (steps.length === 0) return; // nothing to archive
  const sessions = Array.isArray(data?.sessions) ? (data!.sessions as AgentSession[]) : [];
  const archived: AgentSession = {
    steps,
    transcript: Array.isArray(data?.transcript) ? (data!.transcript as unknown[]) : [],
    proposals: Array.isArray(data?.proposals) ? (data!.proposals as AgentProposal[]) : [],
    ended_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("book_agent_runs")
    .update({ steps: [], transcript: [], proposals: [], pending: null, status: "idle", sessions: [archived, ...sessions] })
    .eq("id", threadId);
  if (error) throw error;
}

/** Restore a past session as the live thread, archiving the current one first (symmetric with new chat). */
export async function resumeAgentSession(threadId: number, index: number): Promise<void> {
  const { data } = await supabase.from("book_agent_runs").select(SESSIONS_COLS).eq("id", threadId).maybeSingle();
  const sessions = Array.isArray(data?.sessions) ? (data!.sessions as AgentSession[]) : [];
  const target = sessions[index];
  if (!target) return;
  const steps = Array.isArray(data?.steps) ? (data!.steps as AgentStep[]) : [];
  const remaining = sessions.filter((_, i) => i !== index);
  const nextSessions: AgentSession[] = steps.length > 0
    ? [{
        steps,
        transcript: Array.isArray(data?.transcript) ? (data!.transcript as unknown[]) : [],
        proposals: Array.isArray(data?.proposals) ? (data!.proposals as AgentProposal[]) : [],
        ended_at: new Date().toISOString(),
      }, ...remaining]
    : remaining;
  const { error } = await supabase.from("book_agent_runs")
    .update({ steps: target.steps, transcript: target.transcript, proposals: target.proposals, pending: null, status: "idle", sessions: nextSessions })
    .eq("id", threadId);
  if (error) throw error;
}
