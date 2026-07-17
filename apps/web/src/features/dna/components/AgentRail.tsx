// AgentRail — the studio's single conversational agent surface (docs/agent-rail.md, option B). One
// thread per book; you talk to the story editor's agent, which reads pages and discusses the book.
// Phase 1 is read + discuss; per-layer proposals (generate/revise/dna/scene) fold in next.
//
// The whole conversation lives in a book_agent_runs row (kind='thread'); this panel sends a message
// and projects the row live (refresh = no-op). Mirrors ReviseChat's shape but is driven by the
// agent's `steps` feed rather than a per-layer chat thread.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Wand2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow } from "@/hooks/useLatestTaskRow";
import { stopRun } from "@/lib/stopRun";
import {
  AGENT_THREAD_SELECT, answerAgent, applyAgentProposal, ASPECT_KINDS, discardAgentProposal,
  fetchAgentSessionCount, fetchAgentSessions, resumeAgentSession, sendAgentMessage, startNewAgentSession,
  type AgentProposal, type AgentSession, type Aspect, type AgentStep, type AgentThreadRow,
} from "@/features/dna/lib/agentThread";
import { availableCommands, matchCommands, type AgentCommand } from "@/features/dna/lib/agentCommands";
import { nodeLabel } from "@/features/dna/lib/dnaChat";
import { analysisText, byId, type BookSettings, type DnaNode, type NodeKind } from "@/features/dna/lib/novelDna";
import { currentObjective, currentObjectiveKey, nextDraftTarget } from "@/features/dna/lib/dnaJourney";
import { useChatScroll } from "@/components/book/shared/useChatScroll";
import { useAutoAccept } from "@/features/dna/hooks/useAutoAccept";
import { useAdmin } from "@/hooks/use-admin";
import { useLatestAiCall } from "@/features/dna/hooks/useLatestAiCall";
import { ActionLink, Eyebrow, Panel, RunError } from "@/components/book/shared/studioUi";
import { snapshotTree } from "@/features/dna/lib/treeVersions";
import { briefIdea, type Brief } from "@/lib/brief";
import { NEXT_STEP_MESSAGE, STEP_TEACH, IDEA_TEACH, IDEA_MESSAGE } from "./agentRail/journeyContent";
import { AgentRailControls } from "./agentRail/AgentRailControls";
import { StepBubble } from "./agentRail/StepBubble";
import { ProposalCard } from "./agentRail/ProposalCard";
import { SessionHistory } from "./agentRail/SessionHistory";
import { Composer } from "./agentRail/Composer";
import { AdminPromptPeek } from "./agentRail/AdminPromptPeek";

export function AgentRail({ bookId, nodes, settings, bookSlug, brief, attachedIds = [], onDetach, onClose, onJump }: {
  bookId: number; nodes: DnaNode[]; settings: BookSettings; bookSlug?: string; // bookSlug feeds the reader URL into the final render/publish hand-off
  brief?: Brief | null; // the books.brief — lets the greeting tell "no idea yet" (ideate) from "idea set, no logline" (teach the logline)
  attachedIds?: string[]; onDetach?: (id: string) => void; // slice 2 — the context tray (anchors); omitted = no tray
  onClose?: () => void; // folds the rail's own close affordance into its header row instead of a floating sibling
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
  // next, derived live from the tree. Sent with each message so the agent leads with it; also surfaced as
  // the idle "Next" nudge below.
  // `brief` rides along because the journey's FIRST rung — the discovery interview — is gated outside the
  // tree, on brief.vision (docs/agent-guidance-system.md D3).
  const objective = useMemo(
    () => currentObjective(nodes, { bookSlug, brief }),
    [nodes, bookSlug, brief],
  );
  // The one-line headline of the objective (the "▸ Step n/5 · …" line), for the idle nudge chip.
  const objectiveHeadline = useMemo(() => objective.split("\n").find((l) => l.startsWith("▸"))?.replace(/^▸\s*/, "") ?? "", [objective]);
  // The substep key behind that headline (e.g. "seed", "beats") — so the nudge's chat message can name the
  // actual action instead of the generic "let's work on the next step" that used to ride under every headline.
  const objectiveKey = useMemo(() => currentObjectiveKey(nodes, brief), [nodes, brief]);
  // The rung BEFORE the first rung: on the SEED step with no idea in the brief, the guide's job is ideation,
  // not loglines — the greeting and the nudge below both switch stance on this flag. It sits AFTER the
  // interview deliberately: a blank author is ideated with INSIDE the interview (STEP_RECIPE.interview says
  // so), so a fresh book gets the interview card, and this fires only for the odd book that reached the seed
  // (interview compiled or skipped) still carrying no idea.
  const needsIdea = objectiveKey === "seed" && !briefIdea(brief)?.trim();
  // When the objective is the draft step, the concrete scene it targets — so the "next step" nudge can NAME
  // which scene ("Write 'Bram's door'") instead of a bare ordinal, and can't diverge from what the agent
  // does: we only surface it when the live objective actually points at this scene's id (same source of
  // truth the agent receives), so the card ↔ action stay in lockstep.
  const draftTarget = useMemo(() => {
    const t = nextDraftTarget(nodes);
    return t && objective.includes(`[${t.scene.id}]`) ? t : undefined;
  }, [nodes, objective]);

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

  const steps = useMemo(() => (Array.isArray(row?.steps) ? row!.steps! : []) as AgentStep[], [row]);
  const proposals = useMemo(() => (Array.isArray(row?.proposals) ? row!.proposals! : []) as AgentProposal[], [row]);
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
  const { scrollRef, atBottom, scrollToBottom } = useChatScroll([steps.length, proposals.length, running, awaiting, !!optimistic] as const);

  // ── Slash-command menu ── Type "/" to open a filtered command list; picking one drops its editable
  // prompt into the composer and focuses the context filter to the command's aspects.
  const taRef = useRef<HTMLTextAreaElement>(null);
  const slashQuery = draft.startsWith("/") ? draft.slice(1) : null;
  const cmds = useMemo(
    () => (slashQuery === null ? [] : matchCommands(availableCommands(available), slashQuery)),
    [slashQuery, available],
  );
  const showMenu = slashQuery !== null && cmds.length > 0 && !active;
  const [hi, setHi] = useState(0);
  useEffect(() => { setHi(0); }, [slashQuery]);

  const pickCommand = (c: AgentCommand) => {
    setDraft(c.prompt);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  };

  useEffect(() => {
    // Clear the echo once the row reflects it — a free message lands as a 'user' step, an answer to a
    // question as an 'answer' step.
    if (optimistic != null && steps.some((s) => (s.t === "user" || s.t === "answer") && s.label === optimistic)) setOptimistic(null);
  }, [steps, optimistic]);
  useEffect(() => { if (optimistic != null) scrollToBottom(false); }, [optimistic, scrollToBottom]);

  // `isNextStep` must be true ONLY for the explicit "Next" nudge click below — it's the signal that lets
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

  const newChat = async () => {
    if (!row || busy || active) return;
    try { await startNewAgentSession(row.id); setHistoryOpen(false); invalidateSessions(); refetch(); }
    catch (e) { toast({ title: "Couldn't start a new chat", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  const resume = async (sessionId: number) => {
    if (!row || busy || active) return;
    try { await resumeAgentSession(row.id, sessionId); setHistoryOpen(false); invalidateSessions(); refetch(); }
    catch (e) { toast({ title: "Couldn't continue that chat", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  const apply = async (p: AgentProposal) => {
    if (!row || applyingId) return;
    setApplyingId(p.id);
    const isAbortable = p.layer === "expansion" || p.layer === "prose-render";
    const controller = isAbortable ? new AbortController() : null;
    applyingAbortRef.current = controller;
    try {
      const { rejected } = await applyAgentProposal(bookId, row.id, p, proposals, nodes, controller?.signal);
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
    try { await discardAgentProposal(row.id, p.id, proposals); refetch(); }
    catch (e) { toast({ title: "Couldn't discard", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  const nextStepMessage = needsIdea
    ? IDEA_MESSAGE
    : draftTarget
    ? `Write "${nodeLabel(draftTarget.scene)}".`
    : (objectiveKey && NEXT_STEP_MESSAGE[objectiveKey]) || objectiveHeadline || "Let's work on the next step.";

  return (
    <Panel variant="soft" className="flex h-full flex-col rounded-none px-4 py-3.5">
      <div className="flex shrink-0 items-center gap-2">
        <Wand2 className="h-4 w-4 text-[hsl(var(--pv-accent))]" />
        <Eyebrow tone="accent">Agent</Eyebrow>
        <AgentRailControls
          auto={auto} onToggleAuto={toggleAuto}
          effort={effort} onSetEffort={setEffortMode}
          active={active}
          sessionCount={sessionCount} historyOpen={historyOpen} onToggleHistory={() => setHistoryOpen((v) => !v)}
          onNewChat={() => void newChat()} newChatDisabled={busy || active || steps.length === 0}
          onClose={onClose}
        />
      </div>

      {/* Past chats — archived conversations, read-only until resumed. */}
      {historyOpen && sessions.length > 0 && (
        <div className="mt-2 shrink-0 max-h-[40%] overflow-y-auto rounded-xl border border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/30 px-3 py-2">
          <SessionHistory sessions={sessions} onResume={resume} busy={busy || active} nodes={nodes} />
        </div>
      )}

      {/* Conversation */}
      <div className="relative mt-3 min-h-0 flex-1">
        <div ref={scrollRef} className="h-full space-y-3.5 overflow-y-auto pr-1">
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
            </div>
          )}
          {steps.map((s, i) => <StepBubble key={i} step={s} nodes={nodes} onJump={onJump} />)}
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} nodes={nodes}
              applying={applyingId === p.id} onApply={() => void apply(p)} onDiscard={() => void discard(p)} onStop={stopApply} />
          ))}
          {/* Guided-flow nudge (lib/dnaJourney.currentObjective) — appears in the feed as the LAST item
              only when the agent's work is settled: idle, nothing running/awaiting, no proposal to review,
              no error. So it reads as "here's what's next", not a pinned CTA. One click hands the step to
              the agent (the objective itself already rides every message's context). */}
          {!active && !optimistic && proposals.length === 0 && row?.status !== "error" && objectiveHeadline && (
            <button type="button" onClick={() => void send(nextStepMessage, { isNextStep: true })} disabled={busy}
              title="Let the agent lead you through this step"
              className="flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-[hsl(var(--pv-accent))]/35 bg-[hsl(var(--pv-accent))]/[0.05] px-3.5 py-2.5 text-left transition-colors hover:border-[hsl(var(--pv-accent))]/60 hover:bg-[hsl(var(--pv-accent))]/[0.08] disabled:opacity-50">
              <Wand2 className="h-4 w-4 shrink-0 text-[hsl(var(--pv-accent))]" />
              <span className="min-w-0 flex-1">
                <span className="block pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">next step</span>
                {draftTarget ? (
                  <>
                    <span className="block truncate pv-serif text-[13px] leading-snug text-foreground">
                      Write “{nodeLabel(draftTarget.scene)}”
                    </span>
                    <span className="block pv-mono text-[9.5px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">
                      Scene {draftTarget.orderIndex} of {draftTarget.total}
                    </span>
                  </>
                ) : (
                  <span className="block pv-serif text-[13px] leading-snug text-foreground">{needsIdea ? "Find the story idea — pitch me a few directions" : objectiveHeadline}</span>
                )}
              </span>
              <ArrowUp className="h-3.5 w-3.5 shrink-0 rotate-90 text-[hsl(var(--pv-text-faint))]" />
            </button>
          )}
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

      {/* Context tray (slice 2) — the DNA nodes the author attached as anchors. Add from a node's kebab in
          the tree; remove here. On send they become a "Focus" prefix on the message. */}
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

      {/* Composer — or the answer card when the agent has asked a question */}
      <div className="mt-3 shrink-0">
        <Composer
          awaiting={!!(awaiting && row?.pending)} pendingOptions={row?.pending?.options ?? []}
          onReply={(t) => void reply(t)} answer={answer} setAnswer={setAnswer}
          onStop={() => void stop()} stopDisabled={!!row?.cancel_requested} cancelRequested={!!row?.cancel_requested}
          draft={draft} setDraft={setDraft} onSend={(t) => void send(t)} running={running} active={active} busy={busy}
          showMenu={showMenu} cmds={cmds} hi={hi} setHi={setHi} onPickCommand={pickCommand}
          taRef={taRef} stopping={stopping}
        />
      </div>
    </Panel>
  );
}
