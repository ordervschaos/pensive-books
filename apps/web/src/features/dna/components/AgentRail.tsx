// AgentRail — the studio's single conversational agent surface (docs/agent-rail.md, option B). One
// thread per book; you talk to the story editor's agent, which reads pages and discusses the book.
// Phase 1 is read + discuss; per-layer proposals (generate/revise/dna/scene) fold in next.
//
// The whole conversation lives in a book_agent_runs row (kind='thread'); this panel sends a message
// and projects the row live (refresh = no-op). Mirrors ReviseChat's shape but is driven by the
// agent's `steps` feed rather than a per-layer chat thread.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Loader2, WandSparkles, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow } from "@/hooks/useLatestTaskRow";
import { stopRun } from "@/lib/stopRun";
import {
  AGENT_THREAD_SELECT, answerAgent, applyAgentProposal, ASPECT_KINDS, discardAgentProposal,
  fetchAgentSessionCount, fetchAgentSessions, resumeAgentSession, sendAgentMessage, setAgentFocus, startNewAgentSession,
  type AgentProposal, type AgentSession, type Aspect, type AgentStep, type AgentThreadRow,
} from "@/features/dna/lib/agentThread";
import { availableCommands, matchCommands, type AgentCommand } from "@/features/dna/lib/agentCommands";
import { nodeLabel } from "@/features/dna/lib/dnaChat";
import { analysisText, byId, STRUCTURE_TEMPLATES, type BookSettings, type DnaNode, type NodeKind } from "@/features/dna/lib/novelDna";
import { chooseStructure } from "@/features/dna/lib/dnaSkeleton";
import { saveNodes } from "@/features/dna/lib/bookNodes";
import { currentObjective, currentObjectiveKey, nextDraftTarget } from "@/features/dna/lib/dnaJourney";
import { useChatScroll } from "@/components/book/shared/useChatScroll";
import { useAutoAccept } from "@/features/dna/hooks/useAutoAccept";
import { useAdmin } from "@/hooks/use-admin";
import { useLatestAiCall } from "@/features/dna/hooks/useLatestAiCall";
import { ActionLink, Eyebrow, RunError } from "@/components/book/shared/studioUi";
import { snapshotTree } from "@/features/dna/lib/treeVersions";
import { briefIdea, type Brief } from "@/lib/brief";
import {
  START_DOORS, START_DOORS_LEAD, STEP_TEACH, IDEA_TEACH,
  STRUCTURE_BLURB, STRUCTURE_DOOR_LEAD, STRUCTURE_DOOR_MESSAGE,
} from "./agentRail/journeyContent";
import { AgentRailControls } from "./agentRail/AgentRailControls";
import { FocusChip, suggestFocusMode } from "./agentRail/FocusChip";
import { StepBubble } from "./agentRail/StepBubble";
import { ProposalCard } from "./agentRail/ProposalCard";
import { SessionHistory } from "./agentRail/SessionHistory";
import { Composer, type ComposerMenu } from "./agentRail/Composer";
import { OptionsCard } from "./agentRail/OptionsCard";
import { AdminPromptPeek } from "./agentRail/AdminPromptPeek";

// The composer's "@" trigger: group 1 = the boundary (start-of-draft or the whitespace before "@"), which the
// strip-on-pick replacement restores; group 2 = the query typed after it.
const MENTION_RE = /(^|\s)@([^@\n]*)$/;

export function AgentRail({ bookId, nodes, settings, bookSlug, brief, attachedIds = [], onAttach, onDetach, onJump }: {
  bookId: number; nodes: DnaNode[]; settings: BookSettings; bookSlug?: string; // bookSlug feeds the reader URL into the final render/publish hand-off
  brief?: Brief | null; // the books.brief — lets the greeting tell "no idea yet" (ideate) from "idea set, no logline" (teach the logline)
  attachedIds?: string[]; onDetach?: (id: string) => void; // slice 2 — the context tray (anchors); omitted = no tray
  onAttach?: (id: string) => void; // "@" in the composer — attach an anchor WITHOUT going to the tree row's @ icon
  onJump?: (id: string) => void; // reveals + scrolls to a node in the tree — lets a staged-options step jump to its picker
}) {
  const { toast } = useToast();

  // The structural backstop (pacing / dangling-promise / sagging-run lints), computed from the live
  // tree — sent with each message so the agent acts on drift/sag. Only meaningful once structure exists.
  const analysis = useMemo(() => {
    const hasStructure = nodes.some((n) => n.kind === "beat" || n.kind === "scene");
    return hasStructure ? analysisText(nodes, settings) : undefined;
  }, [nodes, settings]);

  // The guided-flow anchor (docs/agent-capabilities.md): the ONE journey rung to drive the author through
  // next, derived live from the tree. Sent with each message so the agent leads with it.
  // `brief` rides along because the journey's FIRST rung — the discovery interview — is gated outside the
  // tree, on brief.vision (docs/agent-guidance-system.md D3).
  const objective = useMemo(
    () => currentObjective(nodes, { bookSlug, brief }),
    [nodes, bookSlug, brief],
  );
  // The one-line headline of the objective (the "▸ Step n/5 · …" line) — the greeting's "do we know where
  // this book is?" test.
  const objectiveHeadline = useMemo(() => objective.split("\n").find((l) => l.startsWith("▸"))?.replace(/^▸\s*/, "") ?? "", [objective]);
  // The substep key behind that headline (e.g. "seed", "beats") — picks the greeting's teaching line, gates
  // the start doors to the interview rung, and seeds the focus chip's suggestion.
  const objectiveKey = useMemo(() => currentObjectiveKey(nodes, brief), [nodes, brief]);
  // The suggestion behind the focus chip is DERIVED (the journey rung) and merely OFFERED — never
  // auto-applied. "Derived proposes, author disposes": the agent's mode has always been computed; what's
  // new (docs/agent-focus.md) is that the author can see it and say no.
  const suggestedFocus = useMemo(() => suggestFocusMode(objectiveKey), [objectiveKey]);
  const suggestedFocusTarget = useMemo(
    () => (suggestedFocus === "draft-scene" ? nextDraftTarget(nodes)?.scene.id : undefined),
    [suggestedFocus, nodes],
  );
  // The rung BEFORE the first rung: on the SEED step with no idea in the brief, the guide's job is ideation,
  // not loglines — the greeting switches stance on this flag. It sits AFTER the
  // interview deliberately: a blank author is ideated with INSIDE the interview (STEP_RECIPE.interview says
  // so), so a fresh book gets the interview card, and this fires only for the odd book that reached the seed
  // (interview compiled or skipped) still carrying no idea.
  const needsIdea = objectiveKey === "seed" && !briefIdea(brief)?.trim();
  // The attached nodes resolved against the live tree (ids referencing since-deleted nodes drop out). These
  // anchor the agent — their ids ride OUT-OF-BAND on the message (not glued to the text), and the edge fn
  // rebuilds a live, hydrated <focus> block from them every turn, so the tray can never go stale in the
  // transcript. The agent still sees the whole book (docs/agent-context-model.md).
  const attached = useMemo(() => {
    const index = byId(nodes);
    return attachedIds.map((id) => index.get(id)).filter((n): n is DnaNode => !!n);
  }, [attachedIds, nodes]);
  // Only the ids that still resolve to live nodes travel to the server (a since-deleted id would just drop
  // out there too, but pruning here keeps the wire payload honest).
  const attachedLiveIds = useMemo(() => attached.map((n) => n.id), [attached]);

  // Which aspects EXIST (have nodes of their kinds). The agent always sees the whole book — there is no
  // context fence (docs/agent-context-model.md); this only gates slash-command relevance (generate vs
  // revise). 'prose' needs a scene with written prose; the others just need a node of one of their kinds.
  const available = useMemo<Aspect[]>(() => {
    const kinds = new Set<NodeKind>(nodes.map((n) => n.kind));
    const hasProse = nodes.some((n) => n.kind === "scene" && !!(n.content as { prose?: { text?: string } })?.prose?.text?.trim());
    return (Object.keys(ASPECT_KINDS) as Aspect[]).filter((a) =>
      a === "prose" ? hasProse : ASPECT_KINDS[a].some((k) => kinds.has(k)),
    );
  }, [nodes]);

  // Effort: "low" = propose inline first response; "high" = full tool loop. Persisted per book.
  const effortKey = `agent-effort-${bookId}`;
  const [effort, setEffort] = useState<"low" | "high">(() => {
    try { return localStorage.getItem(effortKey) === "low" ? "low" : "high"; } catch { return "high"; }
  });
  const setEffortMode = (mode: "low" | "high") => {
    if (mode === effort) return;
    setEffort(mode);
    try { localStorage.setItem(effortKey, mode); } catch { /* ignore */ }
  };

  // Auto-accept: arm autonomous mode. The agent commits its own option picks and never parks; the watcher
  // (useAutoAccept, below) auto-applies whatever it stages. Persisted per book.
  const autoKey = `agent-auto-${bookId}`;
  const [auto, setAuto] = useState<boolean>(() => {
    try { return localStorage.getItem(autoKey) === "1"; } catch { return false; }
  });
  const toggleAuto = () => setAuto((v) => {
    const next = !v;
    try { localStorage.setItem(autoKey, next ? "1" : "0"); } catch { /* ignore */ }
    // Checkpoint the tree the moment autonomous mode arms — this is where per-op review stops, so it's
    // the one place the author most needs a "before" state to diff against or fall back to.
    if (next) void snapshotTree(bookId).catch(() => {});
    return next;
  });
  const { row, refetch, stale } = useLatestTaskRow<AgentThreadRow>({
    table: "book_agent_runs",
    bookId,
    select: AGENT_THREAD_SELECT,
    match: { kind: "thread" },
    activeStatuses: ["running"], // awaiting_input idles on the author; only 'running' arms the watchdog
    staleMs: 6 * 60 * 1000,
  });

  // ── The DECLARED focus (docs/agent-focus.md slice 1) ──
  // The ROW is the source of truth, never local state: the server self-clears a focus whose done()
  // predicate fires (interview → vision compiled, draft-scene → the scene has prose), and the chip must
  // follow that. Reading it off `row` also means it survives reloads and rides Realtime for free.
  const focusMode = row?.context_focus_mode ?? null;
  const focusTargetLabel = useMemo(() => {
    const id = row?.context_focus_target;
    const n = id ? byId(nodes).get(id) : undefined;
    return n ? nodeLabel(n) : undefined;
  }, [row?.context_focus_target, nodes]);
  const applyFocus = async (mode: string | null, target?: string | null) => {
    try {
      await setAgentFocus(bookId, mode, target);
      await refetch();
    } catch (e) {
      toast({ title: "Couldn't change the focus", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };
  const rowSteps = useMemo(() => (Array.isArray(row?.steps) ? row!.steps! : []) as AgentStep[], [row]);
  const rowProposals = useMemo(() => (Array.isArray(row?.proposals) ? row!.proposals! : []) as AgentProposal[], [row]);
  // Optimistic chat switching (newChat / resume below). Both archive-and-swap the whole thread, and both
  // outcomes are known at click time, so the rail renders the destination immediately and lets the write
  // land under it. `since` is the row's updated_at as it was when the author clicked: a BEFORE UPDATE
  // trigger bumps that column, so "updated_at moved" is the exact signal that OUR write committed and
  // came back — which is also what makes this safe against the stale Realtime snapshot of the outgoing
  // chat that arrives mid-flight. Writes keep using rowSteps/rowProposals: what's on screen is a
  // prediction, what's on the server is what we mutate.
  const [predicted, setPredicted] = useState<{ steps: AgentStep[]; proposals: AgentProposal[]; since?: string } | null>(null);
  const steps = predicted ? predicted.steps : rowSteps;
  const proposals = predicted ? predicted.proposals : rowProposals;
  useEffect(() => {
    if (predicted && row?.updated_at && row.updated_at !== predicted.since) setPredicted(null);
  }, [predicted, row]);
  // Nodes carrying STAGED OPTIONS (book_nodes.proposals, written by the agent's propose_options). The tree
  // renders the same decision in place via ProposalPicker; surfacing it here too is what makes the rail
  // self-sufficient — every choice the agent puts to the author (proposal · question · options) is now
  // resolvable without leaving the conversation. Same writes either way (lib/dnaProposals.ts).
  const optionNodes = useMemo(() => nodes.filter((n) => (n.proposals?.length ?? 0) > 0), [nodes]);
  const running = row?.status === "running";
  const awaiting = row?.status === "awaiting_input";
  const active = running || awaiting;

  // Admin-only debug peek at the raw LLM request (docs/agent-turn-grounding.md) — the latest ai_calls
  // row for this run. Fetched whenever there's a run (not gated on `running`) so it stays visible
  // after the turn finishes, not just while the "thinking…" loader is up. Never fetched for
  // non-admins (the hook no-ops when disabled), so this costs nothing for the common case.
  const { isAdmin } = useAdmin();
  const liveCall = useLatestAiCall("book_agent_runs", row?.id, isAdmin);

  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  // Only the slow engine layers (expansion/prose-render) get a real Stop — applyingAbortRef holds the
  // in-flight controller so ProposalCard's Stop button can cancel the browser-side generation mid-call.
  const applyingAbortRef = useRef<AbortController | null>(null);

  // Auto-accept watcher — when armed, performs the author's gestures (apply / pick / answer) automatically.
  // Shares applyingId/applyingAbortRef with the manual path so a card the watcher is applying shows the
  // same live "applying"/Stop feedback instead of looking idle while it streams in the background.
  useAutoAccept({ enabled: auto, bookId, row, nodes, refetch, onApplyingChange: setApplyingId, abortRef: applyingAbortRef });
  const [historyOpen, setHistoryOpen] = useState(false);
  // Past chats live in book_agent_sessions, not on the row (20260701150000) — a thread can carry a lot
  // of archived history, so we only load a cheap count for the badge and fetch the full list (with each
  // session's step feed) the moment the author actually opens "Past chats".
  const [sessionCount, setSessionCount] = useState(0);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionsStale, setSessionsStale] = useState(true);
  const threadId = row?.id;
  useEffect(() => {
    if (!threadId) { setSessionCount(0); setSessions([]); setSessionsStale(true); return; }
    setSessionsStale(true);
    void fetchAgentSessionCount(threadId).then(setSessionCount);
  }, [threadId]);
  useEffect(() => {
    if (!historyOpen || !threadId || !sessionsStale) return;
    void fetchAgentSessions(threadId).then((rows) => { setSessions(rows); setSessionsStale(false); });
  }, [historyOpen, threadId, sessionsStale]);
  // Optimistic echo of the just-sent message until the row reflects it over Realtime.
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const { scrollRef, atBottom, scrollToBottom } = useChatScroll([steps.length, proposals.length, optionNodes.length, running, awaiting, !!optimistic] as const);

  // ── Composer autocomplete ── Two triggers over one popover (Composer owns the rendering + keys):
  //   "/" at the start of the draft → the slash-command list; picking one drops its editable prompt in.
  //   "@" anywhere → a node picker that attaches an anchor to the context tray. Before this, attaching
  //   context meant leaving the chat for the tree row's "@" icon — the last routine gesture the rail
  //   couldn't perform itself.
  const taRef = useRef<HTMLTextAreaElement>(null);
  const focusComposer = () => requestAnimationFrame(() => {
    const el = taRef.current;
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  });

  const slashQuery = draft.startsWith("/") ? draft.slice(1) : null;
  const cmds = useMemo(
    () => (slashQuery === null ? [] : matchCommands(availableCommands(available), slashQuery)),
    [slashQuery, available],
  );

  // The "@" token being typed: an "@…" run at the caret-end of the draft, anchored to a word boundary so a
  // mid-word "@" (an email address) doesn't open the picker. The query may contain spaces — node labels are
  // prose, not handles — which is safe because a query that matches nothing closes the menu on its own.
  // Slash wins when both could match (a draft can only start with one of them, so they're disjoint anyway).
  const mentionQuery = useMemo(() => {
    if (slashQuery !== null) return null;
    return draft.match(MENTION_RE)?.[2] ?? null;
  }, [draft, slashQuery]);
  const mentionHits = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.trim().toLowerCase();
    return nodes
      .filter((n) => !attachedIds.includes(n.id))
      .filter((n) => !q || nodeLabel(n, n.kind).toLowerCase().includes(q) || n.kind.includes(q))
      .slice(0, 8);
  }, [mentionQuery, nodes, attachedIds]);

  const [hi, setHi] = useState(0);
  useEffect(() => { setHi(0); }, [slashQuery, mentionQuery]);

  const pickCommand = (c: AgentCommand) => {
    setDraft(c.prompt);
    focusComposer();
  };
  // Attaching consumes the "@query" token — the anchor rides out-of-band on the message (attachedLiveIds),
  // so leaving the text behind would double-say it.
  const pickMention = (n: DnaNode) => {
    onAttach?.(n.id);
    setDraft(draft.replace(MENTION_RE, "$1"));
    focusComposer();
  };

  const menu = useMemo<ComposerMenu | null>(() => {
    if (active) return null;
    if (slashQuery !== null) {
      if (!cmds.length) return null;
      return {
        items: cmds.map((c) => ({ key: c.id, left: `/${c.trigger}`, right: c.hint })),
        hi, setHi, onPick: (i) => pickCommand(cmds[i]), onEscape: () => setDraft(""),
      };
    }
    if (mentionQuery !== null && onAttach) {
      if (!mentionHits.length) return null;
      return {
        items: mentionHits.map((n) => ({ key: n.id, left: n.kind, right: nodeLabel(n, n.kind) })),
        hi, setHi, onPick: (i) => pickMention(mentionHits[i]),
        onEscape: () => setDraft(draft.replace(MENTION_RE, "$1")),
      };
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, slashQuery, cmds, mentionQuery, mentionHits, hi, draft, onAttach]);

  useEffect(() => {
    // Clear the echo once the row reflects it — a free message lands as a 'user' step, an answer to a
    // question as an 'answer' step.
    if (optimistic != null && steps.some((s) => (s.t === "user" || s.t === "answer") && s.label === optimistic)) setOptimistic(null);
  }, [steps, optimistic]);
  useEffect(() => { if (optimistic != null) scrollToBottom(false); }, [optimistic, scrollToBottom]);

  // `isNextStep` must be true ONLY for a guided-flow click — today that means the start doors below (the
  // "Next step" nudge that used to be the other caller was removed 2026-08-04). It's the signal that lets
  // the server treat the guided-flow objective as the actual ask (and so use it to pick a skill brief). A
  // free-typed composer message must NOT carry that signal, even though `objective` still rides along for
  // the agent's own orientation — otherwise an unrelated typed question that happens to miss the skill
  // triggers silently drags in whatever playbook the current rung matches.
  const send = async (text: string, opts: { isNextStep?: boolean } = {}) => {
    const t = text.trim();
    if (!t || busy || active) return;
    setBusy(true);
    setDraft("");
    // The message is just the author's text now — the attached anchors ride out-of-band (attachedLiveIds)
    // and the edge fn hydrates them into a live <focus> block each turn. optimistic = the sent text so the
    // echo matches the stored 'user' step and clears cleanly.
    setOptimistic(t);
    try {
      await sendAgentMessage(bookId, t, analysis, effort, auto, objective, attachedLiveIds, opts.isNextStep);
      refetch();
    } catch (e) {
      setOptimistic(null);
      setDraft(t);
      toast({ title: "The agent couldn't respond", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const reply = async (text: string) => {
    const t = text.trim();
    if (!t || busy || !row || !awaiting) return;
    setBusy(true);
    setAnswer("");
    setOptimistic(t);
    try {
      await answerAgent(row.id, t);
      refetch();
    } catch (e) {
      setOptimistic(null);
      setAnswer(t);
      toast({ title: "Couldn't send your answer", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  // Optimistic: flips the instant Stop is clicked, before the write round-trips, so the button
  // reflects the click immediately instead of waiting on stopRun()'s await + a refetch SELECT to
  // land row.cancel_requested. Resets itself once the row actually leaves `running` (below).
  const [stopping, setStopping] = useState(false);
  useEffect(() => { if (!running) setStopping(false); }, [running]);

  const stop = async () => {
    if (!row || !active) return;
    setStopping(true);
    try { await stopRun("book_agent_runs", row.id, row.status); refetch(); }
    catch (e) { setStopping(false); toast({ title: "Couldn't stop", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  // After archiving/restoring a chat, the count badge and (if reopened) the full list need a fresh read.
  const invalidateSessions = () => { setSessionsStale(true); if (threadId) void fetchAgentSessionCount(threadId).then(setSessionCount); };

  // Blank the rail first, then archive. Even as a single RPC the write is a round trip the author would
  // otherwise spend staring at the conversation they just asked to leave, so we show them the empty
  // thread now and reconcile after. Rolls back on failure — the prediction can't outlive its write.
  const newChat = async () => {
    if (!row || busy || active || predicted) return;
    const prevCount = sessionCount;
    setPredicted({ steps: [], proposals: [], since: row.updated_at });
    setSessionCount((c) => c + 1); // the archive-to-be; invalidateSessions replaces this with the truth
    setHistoryOpen(false);
    try { await startNewAgentSession(row.id); invalidateSessions(); refetch(); }
    catch (e) {
      setPredicted(null); setSessionCount(prevCount);
      toast({ title: "Couldn't start a new chat", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  // Same trick, and here we can predict the *content*: the session's steps are already in hand from the
  // "Past chats" fetch that rendered the button, so the restored chat can paint before the swap lands.
  const resume = async (sessionId: number) => {
    if (!row || busy || active || predicted) return;
    const target = sessions.find((s) => s.id === sessionId);
    const prevCount = sessionCount;
    if (target) setPredicted({ steps: target.steps ?? [], proposals: target.proposals ?? [], since: row.updated_at });
    // One row leaves the archive (the restored one) and, unless the live thread is empty, one joins it.
    setSessionCount((c) => Math.max(0, c - 1 + (rowSteps.length > 0 ? 1 : 0)));
    setHistoryOpen(false);
    try {
      const restored = await resumeAgentSession(row.id, sessionId);
      invalidateSessions(); refetch();
      // The session was gone (another tab got there first). Nothing was written, so nothing will bump
      // updated_at to release the prediction — drop it by hand or the rail shows a chat that isn't there.
      if (!restored) {
        setPredicted(null); setSessionCount(prevCount);
        toast({ title: "That chat is no longer there", description: "It was resumed or removed somewhere else." });
      }
    }
    catch (e) {
      setPredicted(null); setSessionCount(prevCount);
      toast({ title: "Couldn't continue that chat", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  const apply = async (p: AgentProposal) => {
    if (!row || applyingId) return;
    setApplyingId(p.id);
    const isAbortable = p.layer === "expansion" || p.layer === "prose-render";
    const controller = isAbortable ? new AbortController() : null;
    applyingAbortRef.current = controller;
    try {
      const { rejected } = await applyAgentProposal(bookId, row.id, p, rowProposals, nodes, controller?.signal);
      refetch();
      if (rejected.length) {
        const reasons = rejected.map((r) => r.reasons[0]).filter(Boolean).slice(0, 3).join("; ");
        toast({ title: `Applied with ${rejected.length} skipped`, description: `Some changes didn't fit the schema and weren't saved: ${reasons}`, variant: "destructive" });
      } else {
        toast({ title: p.layer === "prose-render" ? "Prose rendered" : "Applied", description: p.summary || "Change applied to the DNA tree." });
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        toast({ title: "Stopped", description: "The proposal is still staged — run it again whenever you're ready." });
      } else {
        toast({ title: "Couldn't apply", description: String((e as Error)?.message ?? e), variant: "destructive" });
      }
    } finally { applyingAbortRef.current = null; setApplyingId(null); }
  };

  const stopApply = () => { applyingAbortRef.current?.abort(); };

  const discard = async (p: AgentProposal) => {
    if (!row) return;
    try { await discardAgentProposal(row.id, p.id, rowProposals); refetch(); }
    catch (e) { toast({ title: "Couldn't discard", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  // The start doors (journeyContent.START_DOORS) — the interview's entry points, offered ONLY on a fresh
  // thread at the interview rung. They live INSIDE the interview's first turn on purpose: the journey strip
  // still says one corridor ("1 Idea — Interview"), because that's the truth; the doors are only how you
  // walk into it. They are also the rail's ONLY nudge now — see the note where the "Next step" card used
  // to be, below.
  const showDoors = steps.length === 0 && !optimistic && objectiveKey === "interview";
  // The structure door is two-step: click it and the method list replaces the door grid, because picking a
  // skeleton WRITES to the tree and that deserves a named choice rather than a surprise. The methods come
  // from the engine's registry (novelDna.STRUCTURE_TEMPLATES) plus "none", so a new registry entry shows up
  // here for free — the doors don't keep their own copy of the method list.
  const [pickingStructure, setPickingStructure] = useState(false);
  const structureChoices = useMemo(
    () => [...Object.values(STRUCTURE_TEMPLATES).map((t) => ({ key: t.key, label: t.label, slots: t.slots.length })),
      { key: "none", label: "No structure", slots: 0 }],
    [],
  );
  // Pick a method → write it to the pillar, materialize its slots, and only then open the interview against
  // that frame. One save (chooseStructure returns pillar + skeleton together) so the tree is never half-set.
  const pickStructure = async (key: string, label: string) => {
    if (busy || active) return;
    setBusy(true);
    try {
      const rows = chooseStructure(nodes, bookId, key);
      if (rows.length) await saveNodes(rows);
    } catch (e) {
      toast({ title: "Couldn't set the structure", description: String((e as Error)?.message ?? e), variant: "destructive" });
      setBusy(false);
      return;
    }
    setBusy(false);
    setPickingStructure(false);
    await send(STRUCTURE_DOOR_MESSAGE(label, key === "none"), { isNextStep: true });
  };

  return (
    // No panel bg/border here — this sits on the same chrome tone as the page's title bar (set by the
    // fixed rail container in DnaTreePage.tsx). Header height (h-11 = 44px = DnaTreePage's HEADER_H)
    // and border-bottom match the title bar's exactly, so the two read as ONE merged top strip with
    // no seam between them.
    <div className="flex h-full flex-col px-3.5 pb-3">
      <div className="box-border flex h-11 shrink-0 items-center gap-2 border-b border-[hsl(var(--pv-border-soft))]">
        <WandSparkles className="h-4 w-4 shrink-0 text-[hsl(var(--pv-accent))]" />
        <Eyebrow tone="accent" className="shrink-0">Agent</Eyebrow>
        {/* The focus chip — what we're working on, and one click to leave it. Deliberately NOT disabled
            while a turn runs: exit must never depend on the agent being healthy (docs/agent-focus.md §6). */}
        <FocusChip
          mode={focusMode}
          targetLabel={focusTargetLabel}
          suggested={suggestedFocus}
          suggestedTarget={suggestedFocusTarget}
          onSet={(m, t) => void applyFocus(m, t)}
        />
        <AgentRailControls
          auto={auto} onToggleAuto={toggleAuto}
          effort={effort} onSetEffort={setEffortMode}
          active={active}
          sessionCount={sessionCount} historyOpen={historyOpen} onToggleHistory={() => setHistoryOpen((v) => !v)}
          onNewChat={() => void newChat()} newChatDisabled={busy || active || steps.length === 0}
        />
      </div>

      {/* Past chats — archived conversations, read-only until resumed. */}
      {historyOpen && sessions.length > 0 && (
        <div className="sidebar-scroll mt-2 shrink-0 max-h-[40%] overflow-y-auto rounded-xl border border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/30 px-3 py-2">
          <SessionHistory sessions={sessions} onResume={resume} busy={busy || active} nodes={nodes} />
        </div>
      )}

      {/* Conversation — bleeds past the shell's own right padding (-mr-3.5 cancels it) so the
          scrollbar sits flush on the rail's true edge instead of floating with a gap; pr-3.5 puts
          that same inset back as padding, so the text itself still lines up with everything else. */}
      <div className="relative mt-3 min-h-0 flex-1 -mr-3.5">
        <div ref={scrollRef} className="sidebar-scroll h-full space-y-3.5 overflow-y-auto pr-3.5">
          {/* The guide's greeting — the agent speaks first. Journey-aware and scripted (zero cost, zero
              latency): orient, teach the current rung's concept, and let the next-step card below carry
              the offer. On a fresh brief this is the "explain what a logline is" moment; on an emptied
              chat mid-journey it re-teaches wherever the book actually is. */}
          {steps.length === 0 && !optimistic && (
            <div className="space-y-2.5">
              <p className="pv-serif text-[13.5px] leading-[1.6] text-[hsl(var(--pv-text-muted))]">
                {objectiveHeadline
                  ? (needsIdea
                    ? <>Welcome — I'm your story editor. Every book here grows from one idea, and you haven't set one yet. That's fine: finding it is part of the work. Tell me a genre, a feeling, or a scene you can't shake — or let me pitch a few directions.</>
                    : <>Welcome — I'm your story editor. I'll walk you from your brief to finished prose, one rung at a time — <span className="pv-mono text-[10.5px] uppercase tracking-[0.08em]">idea → foundations → structure → scenes → prose</span> — and teach you the craft behind each rung as we go.</>)
                  : <>Talk to the editor's agent about the whole book — ask a question, get a summary, pressure-test the story. It reads the actual pages before it answers.</>}
              </p>
              {objectiveHeadline && (needsIdea ? IDEA_TEACH : objectiveKey && STEP_TEACH[objectiveKey]) && (
                <p className="border-l-2 border-[hsl(var(--pv-accent))]/40 pl-2.5 pv-serif text-[12.5px] italic leading-[1.55] text-[hsl(var(--pv-text-faint))]">
                  {needsIdea ? IDEA_TEACH : STEP_TEACH[objectiveKey!]}
                </p>
              )}
              {/* The doors. Each is just a canned first message (+ which vision section to capture into) —
                  no branch in the journey, no schema behind it. Picking one carries isNextStep so the
                  server still runs the interview step's playbook; the door only says where to begin. */}
              {showDoors && !pickingStructure && (
                <div className="space-y-2 pt-1">
                  <p className="pv-serif text-[12.5px] leading-[1.55] text-[hsl(var(--pv-text-muted))]">{START_DOORS_LEAD}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {START_DOORS.map((d) => (
                      <button key={d.key} type="button" disabled={busy}
                        onClick={() => (d.opensPicker ? setPickingStructure(true) : void send(d.message, { isNextStep: true }))}
                        title={d.opensPicker ? d.hint : d.message}
                        className="rounded-xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-2.5 py-1.5 text-left transition-colors hover:border-[hsl(var(--pv-accent))]/50 hover:bg-[hsl(var(--pv-accent))]/[0.06] disabled:opacity-50">
                        <span className="block pv-serif text-[13px] leading-[1.35] text-foreground">{d.label}{d.opensPicker ? " →" : ""}</span>
                        <span className="block pv-serif text-[11.5px] leading-[1.35] text-[hsl(var(--pv-text-faint))]">{d.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Step two of the structure door — the method list. This is the one door that writes to the
                  tree before it speaks, so it names the choice and says what it will do. */}
              {showDoors && pickingStructure && (
                <div className="space-y-2 pt-1">
                  <p className="pv-serif text-[12.5px] leading-[1.55] text-[hsl(var(--pv-text-muted))]">{STRUCTURE_DOOR_LEAD}</p>
                  <div className="space-y-1.5">
                    {structureChoices.map((c) => (
                      <button key={c.key} type="button" disabled={busy}
                        onClick={() => void pickStructure(c.key, c.label)}
                        className="block w-full rounded-xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-2.5 py-1.5 text-left transition-colors hover:border-[hsl(var(--pv-accent))]/50 hover:bg-[hsl(var(--pv-accent))]/[0.06] disabled:opacity-50">
                        <span className="flex items-baseline gap-1.5">
                          <span className="pv-serif text-[13px] leading-[1.35] text-foreground">{c.label}</span>
                          {c.slots > 0 && (
                            <span className="pv-mono text-[9.5px] uppercase tracking-[0.08em] text-[hsl(var(--pv-text-faint))]">{c.slots} slots</span>
                          )}
                        </span>
                        <span className="block pv-serif text-[11.5px] leading-[1.4] text-[hsl(var(--pv-text-faint))]">{STRUCTURE_BLURB[c.key] ?? ""}</span>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setPickingStructure(false)} disabled={busy}
                    className="pv-serif text-[11.5px] text-[hsl(var(--pv-text-faint))] underline-offset-2 hover:underline disabled:opacity-50">
                    ← back to the other doors
                  </button>
                </div>
              )}
            </div>
          )}
          {steps.map((s, i) => <StepBubble key={i} step={s} nodes={nodes} onJump={onJump} />)}
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} nodes={nodes}
              applying={applyingId === p.id} onApply={() => void apply(p)} onDiscard={() => void discard(p)} onStop={stopApply} />
          ))}
          {/* Staged options (propose_options) — pickable right here, not only at the node's row in the tree. */}
          {optionNodes.map((n) => <OptionsCard key={n.id} node={n} nodes={nodes} onJump={onJump} />)}
          {optimistic && (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[hsl(var(--pv-surface-2))] px-3.5 py-2 pv-serif text-[14px] leading-[1.55] text-foreground whitespace-pre-wrap opacity-60">
                {optimistic}
              </div>
            </div>
          )}
          {isAdmin && liveCall && <AdminPromptPeek call={liveCall} />}
          {running && !stale && (
            <div className="flex items-center gap-2 pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-faint))]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…
            </div>
          )}
          {running && stale && (
            <p className="pv-serif text-[13px] leading-[1.55] text-amber-600 dark:text-amber-500">
              This turn stalled — it may have died. Stop it and try again.
            </p>
          )}
          {row?.status === "error" && row.error && <RunError msg={row.error} />}
        </div>
        {!atBottom && (
          <button type="button" onClick={() => scrollToBottom(true)}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--pv-border-soft))] bg-background/90 px-3 py-1 pv-serif text-[12px] text-[hsl(var(--pv-text-muted))] shadow-sm backdrop-blur-sm hover:text-foreground transition-colors">
            <ArrowDown className="h-3 w-3" /> latest
          </button>
        )}
      </div>

      {/* Context tray (slice 2) — the DNA nodes the author attached as anchors. Add by typing "@" in the
          composer (or from the node's row in the tree); remove here. The ids ride out-of-band on send. */}
      {attached.length > 0 && (
        <div className="mt-2.5 flex shrink-0 flex-wrap items-center gap-1.5">
          <span className="pv-mono text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">focus</span>
          {attached.map((n) => (
            <span key={n.id} title={nodeLabel(n)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--pv-accent))]/40 bg-[hsl(var(--pv-accent))]/[0.06] py-0.5 pl-2 pr-1.5 pv-serif text-[12px] text-foreground">
              <span className="pv-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--pv-accent))]">{n.kind}</span>
              <span className="max-w-[150px] truncate">{nodeLabel(n)}</span>
              <button type="button" onClick={() => onDetach?.(n.id)} title="remove from context"
                className="text-[hsl(var(--pv-text-faint))] transition-colors hover:text-foreground"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}

      {/* Composer — or the answer card when the agent has asked a question.
          A "Next step" card used to dock on top of this, offering "Continue <step>" whenever the agent was
          idle. REMOVED 2026-08-04: it re-armed every time a turn ended, which on a conversational rung is
          every time the agent asks you something — so it stood there offering to "continue" an interview
          that was mid-sentence, and clicking it re-sent the step's canned message and restarted the
          playbook. The three structured pending states it DID suppress on (a running turn, an open
          proposal, staged options) already carry their own resolve-in-place UI; the unstructured one (the
          agent ends its turn with a question in prose) has no server-side marker, so there was no honest
          condition left to show a generic CTA under. Cold start is the one moment a nudge genuinely helps,
          and the start doors above cover it. Everything else: the composer IS the next step. */}
      <div className="mt-3 shrink-0">
        <Composer
          awaiting={!!(awaiting && row?.pending)} pendingOptions={row?.pending?.options ?? []}
          onReply={(t) => void reply(t)} answer={answer} setAnswer={setAnswer}
          onStop={() => void stop()} stopDisabled={!!row?.cancel_requested} cancelRequested={!!row?.cancel_requested}
          draft={draft} setDraft={setDraft} onSend={(t) => void send(t)} running={running} active={active} busy={busy}
          menu={menu} taRef={taRef} stopping={stopping}
        />
      </div>
    </div>
  );
}
