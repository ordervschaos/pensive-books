// agentThread — client surface for the book's ONE persistent agent conversation (docs/agent-rail.md,
// option B). The omni-rail: every AI action will eventually be a message/command into this thread.
//
// The thread lives in a book_agent_runs row with kind='thread' (one per book), driven by the
// book-agent edge fn — the same durable, self-chaining, stoppable loop as the editor agent, but it
// ends a turn in 'idle' instead of 'done' so the conversation continues. The rail watches the row over
// Realtime (useLatestTaskRow); refresh = no-op.
import { supabase } from "@/integrations/supabase/client";
import type { TaskRow } from "@/hooks/useLatestTaskRow";
import { applyNodeOps, describeOps, type NodeOp, type OpRow, type OpValidation } from "@/features/dna/lib/dnaChat";
import type { DnaNode, NodeKind, RenderBrief } from "@/features/dna/lib/novelDna";

export interface AgentStep {
  // user = the author's message · note = the agent's reply/narration · read = a node it read ·
  // ask = a creative question · answer = the author's answer to one · plan = a proposed change ·
  // applied/discarded = a resolved proposal kept in the feed as a collapsed card (carries its ops) ·
  // decision = an auto-mode creative fork the agent journaled (question in label, its options + when) ·
  // finding = fold-on-read: what the agent distilled from its reads (in `findings`). This is the run's
  // durable memory — steps are never pruned, whereas the raw reads in the transcript are.
  t: "user" | "note" | "read" | "ask" | "answer" | "plan" | "done" | "applied" | "discarded" | "decision" | "finding";
  label: string;
  options?: string[]; // present on decision steps — the choices the agent weighed (its pick stated in-text)
  findings?: { ref: string; finding: string }[]; // present on 'finding' steps — the banked distillations
  nodeId?: string; // present on 'plan' steps that staged options ON a node — the node whose picker to jump to

  at?: string; // present on decision steps — ISO timestamp of the fork
  ops?: NodeOp[]; // present on applied/discarded 'dna'/'expansion' steps — the change, for the collapsed card's detail
  // Per-op before/after, frozen at APPLY time (describeOps run against the pre-apply tree) — so the resolved
  // card can show the real old→new per field forever, even once the live tree has moved past it. Without this
  // the card can only echo the op's own payload (the new value, or "edit a node" when it has no readable
  // handle) — never what it replaced. Present on applied/discarded 'dna'/'expansion' steps.
  diff?: OpRow[];
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
// the dna-expand ENGINE for a structural pass (premise / beatsheet / scenes / contract / sketch): ops is empty
// and Apply runs generateExpansionOps → applyNodeOps client-side, so the agent delegates the craft (beat-sheet
// scheduling, scene→beat realization) it can't reproduce by hand. See docs/agent-rail.md. */
export interface AgentProposal { id: string; layer: "dna" | "prose-render" | "expansion"; summary: string; ops: NodeOp[]; sceneIds?: string[]; brief?: RenderBrief; nodeId?: string; target?: string }

// An archived conversation (the "+ New chat" snapshot) — its own row in book_agent_sessions, not
// embedded on the thread (see 20260701150000_book_agent_sessions_table.sql for why).
export interface AgentSession { id: number; steps: AgentStep[]; transcript: unknown[]; proposals: AgentProposal[]; ended_at: string; title: string | null }

export interface AgentThreadRow extends TaskRow {
  kind: string;
  steps: AgentStep[] | null;
  pending: { question: string; options?: string[] } | null;
  proposals: AgentProposal[] | null;
  report: string | null;
  cancel_requested: boolean;
  error: string | null;
  context_auto: boolean | null; // auto-accept mode is armed on this run (the watcher mirrors it)
  // The DECLARED focus (docs/agent-focus.md). The ROW is the source of truth, not client state: the
  // server self-clears a focus whose done() predicate fires, and the chip must follow that. NULL = the
  // author declared nothing (wide).
  context_focus_mode: string | null;
  context_focus_target: string | null;
  context_focus_at: string | null;
}

export const AGENT_THREAD_SELECT =
  "id, book_id, kind, status, created_at, updated_at, steps, pending, proposals, report, cancel_requested, error, context_auto, context_focus_mode, context_focus_target, context_focus_at";

// book-agent is invoked directly against the DEPLOYED edge fn + the active model stack in dev and prod
// alike — it is NOT mirrored in the eval-bridge dev bridge (that reimplements flows locally; book-agent's
// tool loop is too stateful/complex for that). VITE_LOCAL_BOOK_AGENT_URL is a narrower, different escape
// hatch: it doesn't reimplement anything, it just points this ONE fetch at a LOCALLY-served book-agent
// (`supabase functions serve`) instead of the deployed one — for exercising the claude-local bridge (see
// _shared/task.ts's hostedEnv: the local function itself is set up to read/write the SAME hosted book
// data, only its LLM calls move to claude-local). Undefined by default → unchanged behavior.
// Read through the whole `import.meta.env` object rather than `import.meta.env.VITE_X`: Vite still
// inlines it, and it stays defined under plain Node (where `import.meta.env` doesn't exist), so the
// headless agent harness can import this module unchanged. Same treatment as lib/localFn.ts.
const LOCAL_URL = (import.meta as { env?: Record<string, string | undefined> }).env
  ?.VITE_LOCAL_BOOK_AGENT_URL;

async function invoke(body: Record<string, unknown>): Promise<void> {
  if (LOCAL_URL) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(LOCAL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data as { error?: string })?.error) throw new Error((data as { error?: string }).error ?? `book-agent ${res.status}`);
    return;
  }
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
 *  (lib/dnaJourney.currentObjective) — injected into the agent prompt as a guided-flow anchor. `isNextStep`
 *  must be true ONLY for the explicit "Next" nudge click — it gates whether the objective is allowed to
 *  drive skill-brief selection server-side (a free-typed message that misses the trigger regexes should
 *  get no skill brief, not whatever the current guided-flow rung happens to match). */
export async function sendAgentMessage(bookId: number, message: string, analysis?: string, effort?: "low" | "high", auto?: boolean, objective?: string, attachedIds?: string[], isNextStep?: boolean): Promise<void> {
  await invoke({ bookId, message, ...(analysis?.trim() ? { analysis } : {}), ...(effort ? { effort } : {}), ...(auto ? { auto: true } : {}), ...(objective?.trim() ? { objective } : {}), ...(attachedIds?.length ? { attachedIds } : {}), ...(isNextStep ? { isNextStep: true } : {}) });
}

/** Declare (or clear, with `mode: null`) the agent's focus — what we're working on (docs/agent-focus.md).
 *
 *  Deliberately its OWN call, not a field on sendAgentMessage and not an agent tool: the author must be
 *  able to clear the focus while a turn is mid-flight or the agent is wedged. Routing exit through the
 *  agent would inherit the agent's failure modes. The server reads focus at turn start, so a change lands
 *  on the next chain link and never corrupts the running one. */
export async function setAgentFocus(bookId: number, mode: string | null, target?: string | null): Promise<void> {
  await invoke({ bookId, setFocus: true, focusMode: mode, focusTarget: target ?? null });
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

/** Log a step into the book's agent thread WITHOUT a model call — either a human decision (choosing/
 *  discarding an option) or a system-authored note (e.g. the logline bootstrap announcing what it drafted).
 *  Creates the thread row (idle) if none exists yet, same as stageGeneratedProposal — a brand-new book has
 *  no thread until something writes to it, and this is often the FIRST thing that does. No-op if the thread
 *  is mid-turn (don't race the edge fn's writes — same idle-only safety as resolveProposal). Surfaces over
 *  Realtime in the rail; refresh = no-op. */
export async function logAgentTurn(bookId: number, label: string, t: AgentStep["t"] = "answer"): Promise<void> {
  const { data } = await supabase.from("book_agent_runs")
    .select("id, status, steps").eq("book_id", bookId).eq("kind", "thread").maybeSingle();
  if (!data) {
    const { error } = await supabase.from("book_agent_runs")
      .insert({ book_id: bookId, kind: "thread", status: "idle", steps: [{ t, label }] });
    if (error) throw new Error(error.message);
    return;
  }
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
export async function applyAgentProposal(bookId: number, threadId: number, proposal: AgentProposal, all: AgentProposal[], nodes: DnaNode[] = [], signal?: AbortSignal): Promise<OpValidation> {
  if (!(await isStillPending(threadId, proposal.id))) return { ok: [], rejected: [] };
  if (proposal.layer === "expansion") {
    const node = nodes.find((n) => n.id === proposal.nodeId);
    if (!node) throw new Error(`Expansion target ${proposal.nodeId} is no longer in the tree.`);
    if (proposal.target === "sketch") {
      // Sketch is an OWN-CONTENT refinement (like logline/prose), not a generic ops edit — it needs stampSketch
      // so the staleness chain (spec → sketch → prose) actually gets sealed. Write it directly via expandNode
      // rather than the generic ops layer below, which has no stamping hook for a plain `edit` op.
      const { expandNode } = await import("@/features/dna/lib/dnaExpand");
      await expandNode(bookId, node, "sketch", { brief: proposal.brief, signal });
      await resolveProposal(threadId, proposal, "applied", all);
      return { ok: [], rejected: [] };
    }
    // Delegate to the dna-expand ENGINE: generateExpansionOps runs the same generate+enrich the buttons used
    // (beat-sheet scheduling, scene→beat realization) and returns reviewable ops; we apply them here. The
    // dynamic import breaks the agentThread ↔ dnaExpand cycle. A stale/invalid target throws → caller discards.
    const { generateExpansionOps } = await import("@/features/dna/lib/dnaExpand");
    const { ops, callId } = await generateExpansionOps(bookId, node, proposal.target ?? "", proposal.brief, signal);
    // Diff against the pre-apply tree — the engine's own ops, not proposal.ops (empty for this layer), so the
    // resolved card can finally show what an expansion actually did (previously totally opaque).
    const diff = describeOps(ops, nodes);
    const validation = await applyNodeOps(bookId, ops, callId);
    await resolveProposal(threadId, proposal, "applied", all, { diff, ops });
    return validation;
  }
  if (proposal.layer === "prose-render") {
    // Delegate to the v2 prose pipeline — expandNode streams off-worker (the stream-prose edge fn) + saves. The
    // dynamic import breaks the agentThread ↔ dnaExpand cycle (dnaExpand → stageGeneratedProposal → here).
    const { expandNode } = await import("@/features/dna/lib/dnaExpand");
    const index = new Map(nodes.map((n) => [n.id, n]));
    const renderedProse: Record<string, string> = {};
    for (const id of proposal.sceneIds ?? []) {
      const scene = index.get(id);
      if (!scene) continue;
      const { text } = await expandNode(bookId, scene, "prose", { brief: proposal.brief, signal });
      if (text) renderedProse[id] = proseSnippet(text);
    }
    await resolveProposal(threadId, proposal, "applied", all, { renderedProse });
    return { ok: [], rejected: [] };
  }
  // Diff against the pre-apply tree (the same `nodes` ProposalCard already rendered as the accept preview) —
  // frozen here so the resolved card can show the real before/after even after the live tree moves on.
  const diff = describeOps(proposal.ops, nodes);
  const validation = await applyNodeOps(bookId, proposal.ops);
  // Game-twin invariant (docs/dna-structure-analysis.md Finding 2): if this proposal created a game, mint its
  // score meter + resolution thread. Dynamic import breaks the agentThread ↔ dnaExpand cycle; guarded so a
  // game-free edit never pays a tree reload.
  if (proposal.ops.some((o) => (o.op === "add" && o.kind === "game") || (o.op === "replace_children" && o.childKind === "game"))) {
    const { reconcileGameTwins } = await import("@/features/dna/lib/dnaExpand");
    await reconcileGameTwins(bookId).catch(() => {});
  }
  await resolveProposal(threadId, proposal, "applied", all, { diff });
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
async function resolveProposal(
  threadId: number, proposal: AgentProposal, verb: "applied" | "discarded", all: AgentProposal[],
  extra?: { renderedProse?: Record<string, string>; diff?: OpRow[]; ops?: NodeOp[] },
): Promise<void> {
  const { data } = await supabase.from("book_agent_runs").select("steps, proposals").eq("id", threadId).maybeSingle();
  const steps = Array.isArray(data?.steps) ? (data!.steps as AgentStep[]) : [];
  const currentProposals = Array.isArray(data?.proposals) ? (data!.proposals as AgentProposal[]) : all;
  if (!currentProposals.some((p) => p.id === proposal.id)) return; // already resolved by a concurrent caller
  const step: AgentStep = {
    t: verb, label: proposal.summary, ops: extra?.ops ?? proposal.ops,
    ...(proposal.layer === "prose-render" ? { sceneIds: proposal.sceneIds, brief: proposal.brief } : {}),
    ...(extra?.renderedProse && Object.keys(extra.renderedProse).length ? { renderedProse: extra.renderedProse } : {}),
    ...(extra?.diff?.length ? { diff: extra.diff } : {}),
  };
  const next = currentProposals.filter((p) => p.id !== proposal.id);
  const { error } = await supabase.from("book_agent_runs").update({ steps: [...steps, step], proposals: next }).eq("id", threadId);
  if (error) throw error;
}

// ── Chat history ── archive the current conversation and start fresh / restore a past one.
// Archived sessions live in book_agent_sessions (one row per chat, see 20260701150000) — NOT embedded on
// the thread row — so archiving is a single INSERT instead of a read-modify-write of the whole history,
// and the (REPLICA IDENTITY FULL) thread row never carries past chats over Realtime.
//
// Both mutations are RPCs (20260728120000 / 20260728130000) rather than statement chains from the
// browser: one round trip instead of three and five, one transaction instead of none, and the mid-turn
// guard runs under a row lock instead of as a check-then-act the edge function could slip between.
// They're invoker-rights, so the same RLS that allowed the client writes still governs.

/** How many archived chats this thread has — cheap enough to load whenever the thread does (the "Past
 *  chats" badge), unlike the full sessions themselves. */
export async function fetchAgentSessionCount(threadId: number): Promise<number> {
  const { count } = await supabase.from("book_agent_sessions").select("id", { count: "exact", head: true }).eq("thread_id", threadId);
  return count ?? 0;
}

/** The full archived history, newest first — only fetched when the author opens "Past chats". */
export async function fetchAgentSessions(threadId: number): Promise<AgentSession[]> {
  const { data, error } = await supabase.from("book_agent_sessions")
    .select("id, steps, transcript, proposals, ended_at, title").eq("thread_id", threadId).order("ended_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AgentSession[];
}

/** Archive the live conversation as a new book_agent_sessions row and start a fresh, empty thread.
 *
 *  One round trip, not three. This used to be SELECT → INSERT → UPDATE from the client, each waiting
 *  on the one before it, which cost the author ~2s and — because the three weren't a transaction — could
 *  leave a chat archived AND still live if anything died between the INSERT and the UPDATE. The RPC
 *  (20260728120000) does all three under one row lock; the mid-turn guard and the "nothing to archive"
 *  no-op moved in with it. Invoker-rights, so RLS is unchanged. */
export async function startNewAgentSession(threadId: number): Promise<void> {
  const { error } = await supabase.rpc("start_new_agent_session", { p_thread_id: threadId });
  if (error) throw error;
}

/** Restore a past session as the live thread, archiving the current one first (symmetric with new chat).
 *
 *  One round trip, not five. Same story as startNewAgentSession above, one degree worse: the old
 *  client chain (SELECT thread → SELECT target → INSERT archive → DELETE target → UPDATE thread) could
 *  delete an archived chat without restoring it — losing it — if it died in the middle. The RPC
 *  (20260728130000, fixed in …140000) runs the lot in one transaction under a row lock, and additionally
 *  scopes the session lookup to this thread: the old version looked it up by id alone.
 *
 *  Returns false when the session is already gone (resumed or deleted from another tab) — a benign
 *  no-op, but the caller has to know: it's holding an optimistic render of a chat that never arrived. */
export async function resumeAgentSession(threadId: number, sessionId: number): Promise<boolean> {
  const { data, error } = await supabase.rpc("resume_agent_session", { p_thread_id: threadId, p_session_id: sessionId });
  if (error) throw error;
  return data === true;
}
