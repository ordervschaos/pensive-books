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
import { DNA_STAGES, type StageKey } from "@/lib/dnaJourney";

export interface AgentStep {
  // user = the author's message · note = the agent's reply/narration · read = a node it read ·
  // ask = a creative question · answer = the author's answer to one · plan = a proposed change.
  t: "user" | "note" | "read" | "ask" | "answer" | "plan" | "done";
  label: string;
}

// The context filter's aspects ARE the DNA journey stages (premise → foundations → structure → scenes
// → draft). Empty/absent scope = the whole book.
export type Aspect = StageKey;
export const ALL_ASPECTS: Aspect[] = DNA_STAGES.map((s) => s.key);
export const ASPECT_LABELS = Object.fromEntries(DNA_STAGES.map((s) => [s.key, s.label])) as Record<Aspect, string>;
// Which book_nodes kinds each stage covers (scenes = scene structure, draft = scene prose — both are
// scene nodes). Mirrors STAGE_KINDS in supabase/functions/revise-agent/index.ts + dna-chat.
export const ASPECT_KINDS: Record<Aspect, NodeKind[]> = {
  premise: ["seed", "premise"],
  foundations: ["pillar", "character", "relationship", "tentpole", "world_fact", "voice_profile"],
  structure: ["movement", "beat", "thread", "game"],
  scenes: ["scene"],
  draft: ["scene"],
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
 *  client-computed story analysis (the engine lives in the web app) fed as a structural backstop. */
export async function sendAgentMessage(bookId: number, message: string, scope?: Aspect[], analysis?: string): Promise<void> {
  await invoke({ bookId, message, ...(scope && scope.length ? { scope } : {}), ...(analysis?.trim() ? { analysis } : {}) });
}

/** Answer the agent's pending ask_author question, resuming the parked turn. */
export async function answerAgent(threadId: number, answer: string): Promise<void> {
  await invoke({ runId: threadId, answer });
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
