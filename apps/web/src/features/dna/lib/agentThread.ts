// agentThread — client surface for the book's ONE persistent agent conversation (docs/agent-rail.md,
// option B). The omni-rail: every AI action will eventually be a message/command into this thread.
//
// The thread lives in a book_agent_runs row with kind='thread' (one per book), driven by the
// book-agent edge fn — the same durable, self-chaining, stoppable loop as the editor agent, but it
// ends a turn in 'idle' instead of 'done' so the conversation continues. The rail watches the row over
// Realtime (useLatestTaskRow); refresh = no-op.
import { supabase } from "@/integrations/supabase/client";
import type { TaskRow } from "@/hooks/useLatestTaskRow";
import { applyNodeOps, type NodeOp, type OpValidation } from "@/features/dna/lib/dnaChat";
import type { DnaNode, NodeKind, RenderBrief } from "@/features/dna/lib/novelDna";

export interface AgentStep {
  // user = the author's message · note = the agent's reply/narration · read = a node it read ·
  // ask = a creative question · answer = the author's answer to one · plan = a proposed change ·
  // applied/discarded = a resolved proposal kept in the feed as a collapsed card (carries its ops).
  t: "user" | "note" | "read" | "ask" | "answer" | "plan" | "done" | "applied" | "discarded";
  label: string;
  ops?: NodeOp[]; // present on applied/discarded 'dna' steps — the change, for the collapsed card's detail
  sceneIds?: string[]; // present on applied/discarded 'prose-render' steps (ops is always []) — which scene(s)
  brief?: RenderBrief; // ditto — the curated brief that rode into that render, if any
  renderedProse?: Record<string, string>; // sceneId → a snippet of what actually got written, so the card shows
  // the real outcome, not just the brief that was fed in. Present only on applied 'prose-render' steps.
}

// The context filter aspects mirror the DNA tree's visual layers (not the journey stages).
// "cast_world" = pillar + all entity kinds (the tree's "cast & world" group);
// "story" = acts + beats + scenes (the tree's "story" spine).
export type Aspect = "seed" | "premise" | "cast_world" | "story" | "prose";
export const ALL_ASPECTS: Aspect[] = ["seed", "premise", "cast_world", "story", "prose"];
export const ASPECT_LABELS: Record<Aspect, string> = {
  seed: "seed", premise: "premise", cast_world: "cast & world", story: "story", prose: "prose",
};
export const ASPECT_KINDS: Record<Aspect, NodeKind[]> = {
  seed: ["seed"],
  premise: ["premise"],
  cast_world: ["pillar", "character", "relationship", "tentpole", "world_fact", "location", "thread", "game", "voice_profile"],
  story: ["act", "beat", "scene"],
  prose: ["scene"],
};

// A reviewable change the agent proposes. layer 'dna' = node ops applied through the book_nodes write path
// (applyNodeOps). layer 'prose-render' = a request to (re)generate scene prose: ops is empty, sceneIds names
// the scenes, and Apply runs the v2 prose pipeline client-side (docs/agent-context-model.md) — the agent
// never generates prose itself (it's a long browser-streamed render). layer 'expansion' = a request to run
// the dna-expand ENGINE for a heavy structural pass (target 'beatsheet' or 'scenes' on nodeId): ops is empty
// and Apply runs generateExpansionOps → applyNodeOps client-side, so the agent delegates the craft (beat-sheet
// scheduling, scene→beat realization) it can't reproduce by hand. See docs/agent-rail.md. */
export interface AgentProposal { id: string; layer: "dna" | "prose-render" | "expansion"; summary: string; ops: NodeOp[]; sceneIds?: string[]; brief?: RenderBrief; nodeId?: string; target?: string }

// An archived conversation (the "+ New chat" snapshot) — its own row in book_agent_sessions, not
// embedded on the thread (see 20260701150000_book_agent_sessions_table.sql for why).
export interface AgentSession { id: number; steps: AgentStep[]; transcript: unknown[]; proposals: AgentProposal[]; ended_at: string }

export interface AgentThreadRow extends TaskRow {
  kind: string;
  steps: AgentStep[] | null;
  pending: { question: string; options?: string[] } | null;
  proposals: AgentProposal[] | null;
  report: string | null;
  cancel_requested: boolean;
  error: string | null;
  context_auto: boolean | null; // auto-accept mode is armed on this run (the watcher mirrors it)
}

export const AGENT_THREAD_SELECT =
  "id, book_id, kind, status, created_at, updated_at, steps, pending, proposals, report, cancel_requested, error, context_auto";

// book-agent is invoked directly (it is NOT mirrored in the dev bridge — the tool loop runs against
// the deployed edge fn + the active model stack in dev and prod alike).
async function invoke(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke("book-agent", { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
}

/** Send a free-text message to the book's one agent thread (creates it on first use). The agent always
 *  sees + may touch the whole book — context is anchored by attached nodes, not fenced by aspect scope
 *  (docs/agent-context-model.md). `analysis` is the client-computed story analysis (the engine lives in
 *  the web app) fed as a structural backstop. `effort` controls response style: "low" = propose inline on
 *  first response; "high" (default) = full tool loop. `auto` arms auto-accept mode on the run: the agent
 *  runs autonomously (commits its own option picks, never parks on ask_author) and the client watcher
 *  auto-applies whatever it stages. `objective` is the client-computed current journey rung
 *  (lib/dnaJourney.currentObjective) — injected into the agent prompt as a guided-flow anchor. */
export async function sendAgentMessage(bookId: number, message: string, analysis?: string, effort?: "low" | "high", auto?: boolean, objective?: string, attachedIds?: string[]): Promise<void> {
  await invoke({ bookId, message, ...(analysis?.trim() ? { analysis } : {}), ...(effort ? { effort } : {}), ...(auto ? { auto: true } : {}), ...(objective?.trim() ? { objective } : {}), ...(attachedIds?.length ? { attachedIds } : {}) });
}

/** Answer the agent's pending ask_author question, resuming the parked turn. */
export async function answerAgent(threadId: number, answer: string): Promise<void> {
  await invoke({ runId: threadId, answer });
}

/** Auto-accept LIVE loop: after the client applies the agent's staged change to the tree, resume the run so
 *  the agent's next turn reads the updated tree (one change per turn). No-op server-side unless the run is an
 *  idle autonomous thread. */
export async function continueAgent(threadId: number): Promise<void> {
  await invoke({ runId: threadId, autoContinue: true });
}

/** Log a HUMAN decision into the book's agent thread as a visible step WITHOUT a model call — the chat is
 *  the agent's surface, so author actions like choosing/discarding an option register there too. Best-effort:
 *  no-op if the thread doesn't exist yet (nothing to log into) or is mid-turn (don't race the edge fn's
 *  writes — same idle-only safety as resolveProposal). Surfaces over Realtime in the rail; refresh = no-op. */
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

// A short preview of the actual generated text, cut at a word boundary — enough to see what landed
// without bloating the row (the full text lives on the scene node itself, one click away in the tree).
function proseSnippet(text: string, max = 500): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

/** True while `proposalId` is still staged on the thread — a fresh read (not the caller's possibly-stale
 *  copy), used to guard against applying/discarding the SAME proposal twice from two concurrent callers
 *  (two open tabs, or a remounted auto-accept watcher racing a still-in-flight render). */
async function isStillPending(threadId: number, proposalId: string): Promise<boolean> {
  const { data } = await supabase.from("book_agent_runs").select("proposals").eq("id", threadId).maybeSingle();
  const proposals = Array.isArray(data?.proposals) ? (data!.proposals as AgentProposal[]) : [];
  return proposals.some((p) => p.id === proposalId);
}

/** Apply a reviewed proposal: run its node ops against book_nodes, then resolve it on the thread — drop it
 *  from proposals[] and leave an `applied` step (a collapsed card) so the chat keeps the context of what
 *  changed. Returns the validation so the rail can warn when the schema boundary rejected some ops. A
 *  no-op (empty validation) if the proposal was already resolved by a concurrent caller. */
export async function applyAgentProposal(bookId: number, threadId: number, proposal: AgentProposal, all: AgentProposal[], nodes: DnaNode[] = []): Promise<OpValidation> {
  if (!(await isStillPending(threadId, proposal.id))) return { ok: [], rejected: [] };
  if (proposal.layer === "expansion") {
    // Delegate to the dna-expand ENGINE: generateExpansionOps runs the same generate+enrich the buttons used
    // (beat-sheet scheduling, scene→beat realization) and returns reviewable ops; we apply them here. The
    // dynamic import breaks the agentThread ↔ dnaExpand cycle. A stale/invalid target throws → caller discards.
    const { generateExpansionOps } = await import("@/features/dna/lib/dnaExpand");
    const node = nodes.find((n) => n.id === proposal.nodeId);
    if (!node) throw new Error(`Expansion target ${proposal.nodeId} is no longer in the tree.`);
    const { ops } = await generateExpansionOps(bookId, node, proposal.target ?? "");
    const validation = await applyNodeOps(bookId, ops);
    await resolveProposal(threadId, proposal, "applied", all);
    return validation;
  }
  if (proposal.layer === "prose-render") {
    // Delegate to the v2 prose pipeline — expandNode streams off-worker (/api/stream-prose) + saves. The
    // dynamic import breaks the agentThread ↔ dnaExpand cycle (dnaExpand → stageGeneratedProposal → here).
    const { expandNode } = await import("@/features/dna/lib/dnaExpand");
    const index = new Map(nodes.map((n) => [n.id, n]));
    const renderedProse: Record<string, string> = {};
    for (const id of proposal.sceneIds ?? []) {
      const scene = index.get(id);
      if (!scene) continue;
      const { text } = await expandNode(bookId, scene, "prose", { brief: proposal.brief });
      if (text) renderedProse[id] = proseSnippet(text);
    }
    await resolveProposal(threadId, proposal, "applied", all, renderedProse);
    return { ok: [], rejected: [] };
  }
  const validation = await applyNodeOps(bookId, proposal.ops);
  await resolveProposal(threadId, proposal, "applied", all);
  return validation;
}

/** Discard a proposal without applying it — leaves a `discarded` step (a collapsed card) for context. */
export async function discardAgentProposal(threadId: number, proposalId: string, all: AgentProposal[]): Promise<void> {
  if (!(await isStillPending(threadId, proposalId))) return;
  const proposal = all.find((p) => p.id === proposalId);
  if (proposal) await resolveProposal(threadId, proposal, "discarded", all);
}

// Resolve a proposal: drop it from proposals[] AND append an applied/discarded step that carries its ops, so
// the resolution stays visible in the feed as a collapsed card. One row write (steps AND proposals re-read
// fresh — not the caller's possibly-stale `all` — so a concurrent resolver that already landed is detected
// and this call becomes a no-op instead of writing a second, byte-identical step).
async function resolveProposal(threadId: number, proposal: AgentProposal, verb: "applied" | "discarded", all: AgentProposal[], renderedProse?: Record<string, string>): Promise<void> {
  const { data } = await supabase.from("book_agent_runs").select("steps, proposals").eq("id", threadId).maybeSingle();
  const steps = Array.isArray(data?.steps) ? (data!.steps as AgentStep[]) : [];
  const currentProposals = Array.isArray(data?.proposals) ? (data!.proposals as AgentProposal[]) : all;
  if (!currentProposals.some((p) => p.id === proposal.id)) return; // already resolved by a concurrent caller
  const step: AgentStep = {
    t: verb, label: proposal.summary, ops: proposal.ops,
    ...(proposal.layer === "prose-render" ? { sceneIds: proposal.sceneIds, brief: proposal.brief } : {}),
    ...(renderedProse && Object.keys(renderedProse).length ? { renderedProse } : {}),
  };
  const next = currentProposals.filter((p) => p.id !== proposal.id);
  const { error } = await supabase.from("book_agent_runs").update({ steps: [...steps, step], proposals: next }).eq("id", threadId);
  if (error) throw error;
}

// ── Chat history ── archive the current conversation and start fresh / restore a past one. Client-side
// (RLS allows editor updates) and only safe while the thread is idle — the rail gates on `busy`/active.
// Archived sessions live in book_agent_sessions (one row per chat, see 20260701150000) — NOT embedded on
// the thread row — so archiving is a single INSERT instead of a read-modify-write of the whole history,
// and the (REPLICA IDENTITY FULL) thread row never carries past chats over Realtime.

const LIVE_COLS = "status, book_id, steps, transcript, proposals";

/** True while the row is mid-turn — the edge fn owns transcript/steps/proposals then, so a client write
 *  (archiving/restoring a session) would race it. Same guard `logAgentTurn`/`stageGeneratedProposal` use. */
function isBusy(status: unknown): boolean {
  return status === "running" || status === "awaiting_input";
}

/** How many archived chats this thread has — cheap enough to load whenever the thread does (the "Past
 *  chats" badge), unlike the full sessions themselves. */
export async function fetchAgentSessionCount(threadId: number): Promise<number> {
  const { count } = await supabase.from("book_agent_sessions").select("id", { count: "exact", head: true }).eq("thread_id", threadId);
  return count ?? 0;
}

/** The full archived history, newest first — only fetched when the author opens "Past chats". */
export async function fetchAgentSessions(threadId: number): Promise<AgentSession[]> {
  const { data, error } = await supabase.from("book_agent_sessions")
    .select("id, steps, transcript, proposals, ended_at").eq("thread_id", threadId).order("ended_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AgentSession[];
}

/** Archive the live conversation as a new book_agent_sessions row and start a fresh, empty thread. */
export async function startNewAgentSession(threadId: number): Promise<void> {
  const { data } = await supabase.from("book_agent_runs").select(LIVE_COLS).eq("id", threadId).maybeSingle();
  if (isBusy(data?.status)) throw new Error("The agent is mid-turn — wait for it to finish, then start a new chat.");
  const steps = Array.isArray(data?.steps) ? (data!.steps as AgentStep[]) : [];
  if (steps.length === 0) return; // nothing to archive
  const { error: insertError } = await supabase.from("book_agent_sessions").insert({
    thread_id: threadId, book_id: data!.book_id,
    steps, transcript: data?.transcript ?? [], proposals: data?.proposals ?? [],
    ended_at: new Date().toISOString(),
  });
  if (insertError) throw insertError;
  const { error } = await supabase.from("book_agent_runs")
    .update({ steps: [], transcript: [], proposals: [], pending: null, status: "idle" })
    .eq("id", threadId);
  if (error) throw error;
}

/** Restore a past session as the live thread, archiving the current one first (symmetric with new chat). */
export async function resumeAgentSession(threadId: number, sessionId: number): Promise<void> {
  const { data } = await supabase.from("book_agent_runs").select(LIVE_COLS).eq("id", threadId).maybeSingle();
  if (isBusy(data?.status)) throw new Error("The agent is mid-turn — wait for it to finish, then continue that chat.");
  const { data: target } = await supabase.from("book_agent_sessions").select("steps, transcript, proposals").eq("id", sessionId).maybeSingle();
  if (!target) return;
  const liveSteps = Array.isArray(data?.steps) ? (data!.steps as AgentStep[]) : [];
  if (liveSteps.length > 0) {
    const { error: insertError } = await supabase.from("book_agent_sessions").insert({
      thread_id: threadId, book_id: data!.book_id,
      steps: liveSteps, transcript: data?.transcript ?? [], proposals: data?.proposals ?? [],
      ended_at: new Date().toISOString(),
    });
    if (insertError) throw insertError;
  }
  const { error: deleteError } = await supabase.from("book_agent_sessions").delete().eq("id", sessionId);
  if (deleteError) throw deleteError;
  const { error } = await supabase.from("book_agent_runs")
    .update({ steps: target.steps, transcript: target.transcript, proposals: target.proposals, pending: null, status: "idle" })
    .eq("id", threadId);
  if (error) throw error;
}
