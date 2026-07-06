// AgentRail — the studio's single conversational agent surface (docs/agent-rail.md, option B). One
// thread per book; you talk to the story editor's agent, which reads pages and discusses the book.
// Phase 1 is read + discuss; per-layer proposals (generate/revise/dna/scene) fold in next.
//
// The whole conversation lives in a book_agent_runs row (kind='thread'); this panel sends a message
// and projects the row live (refresh = no-op). Mirrors ReviseChat's shape but is driven by the
// agent's `steps` feed rather than a per-layer chat thread.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Check, ChevronDown, Clock, CornerDownLeft, Infinity as InfinityIcon, Loader2, Slash, Square, SquarePen, Wand2, X, Zap } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow } from "@/hooks/useLatestTaskRow";
import { stopRun } from "@/lib/stopRun";
import {
  AGENT_THREAD_SELECT, answerAgent, applyAgentProposal, ASPECT_KINDS, discardAgentProposal,
  fetchAgentSessionCount, fetchAgentSessions, resumeAgentSession, sendAgentMessage, startNewAgentSession,
  type AgentProposal, type AgentSession, type Aspect, type AgentStep, type AgentThreadRow,
} from "@/features/dna/lib/agentThread";
import { availableCommands, matchCommands, type AgentCommand } from "@/features/dna/lib/agentCommands";
import { describeOps, humanizeNodeRefs, nodeLabel, type NodeOp } from "@/features/dna/lib/dnaChat";
import { analysisText, byId, type BookSettings, type DnaNode, type NodeKind } from "@/features/dna/lib/novelDna";
import { currentObjective, currentObjectiveKey, nextDraftTarget } from "@/features/dna/lib/dnaJourney";
import { useChatScroll } from "@/components/book/shared/useChatScroll";
import { useAutoAccept } from "@/features/dna/hooks/useAutoAccept";
import { ActionLink, Eyebrow, Panel, RunError } from "@/components/book/shared/studioUi";
import { snapshotTree } from "@/features/dna/lib/treeVersions";

// What the "next step" nudge SAYS when clicked, keyed by dnaJourney's STEP_RECIPE substep — so the chat
// bubble names the actual action instead of a one-size-fits-all "let's work on the next step" that read as
// disconnected from whatever the button was visibly offering (e.g. "generate the logline").
const NEXT_STEP_MESSAGE: Record<string, string> = {
  seed: "Generate logline options for the seed.",
  premise: "Generate premise options for the central question.",
  pillar: "Set the pillar's controlling idea and ending.",
  contract: "Compile the contract from the brief.",
  cast: "Add the core cast.",
  acts: "Generate the acts.",
  beats: "Generate the beat sheet.",
  scenes: "Break the next beat into scenes.",
  promises: "Settle the next open promise.",
  prose: "Write the next scene.",
};

export function AgentRail({ bookId, nodes, settings, bookSlug, attachedIds = [], onDetach }: {
  bookId: number; nodes: DnaNode[]; settings: BookSettings; bookSlug?: string; // bookSlug feeds the reader URL into the final render/publish hand-off
  attachedIds?: string[]; onDetach?: (id: string) => void; // slice 2 — the context tray (anchors); omitted = no tray
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
  const objective = useMemo(
    () => currentObjective(nodes, { bookSlug }),
    [nodes, bookSlug],
  );
  // The one-line headline of the objective (the "▸ Step n/5 · …" line), for the idle nudge chip.
  const objectiveHeadline = useMemo(() => objective.split("\n").find((l) => l.startsWith("▸"))?.replace(/^▸\s*/, "") ?? "", [objective]);
  // The substep key behind that headline (e.g. "seed", "beats") — so the nudge's chat message can name the
  // actual action instead of the generic "let's work on the next step" that used to ride under every headline.
  const objectiveKey = useMemo(() => currentObjectiveKey(nodes), [nodes]);
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
  const toggleEffort = () => setEffort((e) => {
    const next = e === "high" ? "low" : "high";
    try { localStorage.setItem(effortKey, next); } catch { /* ignore */ }
    return next;
  });

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

  // Auto-accept watcher — when armed, performs the author's gestures (apply / pick / answer) automatically.
  useAutoAccept({ enabled: auto, bookId, row, nodes, refetch });

  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
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

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy || active) return;
    setBusy(true);
    setDraft("");
    // The message is just the author's text now — the attached anchors ride out-of-band (attachedLiveIds)
    // and the edge fn hydrates them into a live <focus> block each turn. optimistic = the sent text so the
    // echo matches the stored 'user' step and clears cleanly.
    setOptimistic(t);
    try {
      await sendAgentMessage(bookId, t, analysis, effort, auto, objective, attachedLiveIds);
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

  const stop = async () => {
    if (!row || !active) return;
    try { await stopRun("book_agent_runs", row.id, row.status); refetch(); }
    catch (e) { toast({ title: "Couldn't stop", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
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
    try {
      const { rejected } = await applyAgentProposal(bookId, row.id, p, proposals, nodes);
      refetch();
      if (rejected.length) {
        const reasons = rejected.map((r) => r.reasons[0]).filter(Boolean).slice(0, 3).join("; ");
        toast({ title: `Applied with ${rejected.length} skipped`, description: `Some changes didn't fit the schema and weren't saved: ${reasons}`, variant: "destructive" });
      } else {
        toast({ title: p.layer === "prose-render" ? "Prose rendered" : "Applied", description: p.summary || "Change applied to the DNA tree." });
      }
    } catch (e) {
      toast({ title: "Couldn't apply", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setApplyingId(null); }
  };

  const discard = async (p: AgentProposal) => {
    if (!row) return;
    try { await discardAgentProposal(row.id, p.id, proposals); refetch(); }
    catch (e) { toast({ title: "Couldn't discard", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  return (
    <Panel variant="soft" className="flex h-full flex-col px-4 py-3.5">
      <div className="flex shrink-0 items-center gap-2">
        <Wand2 className="h-4 w-4 text-[hsl(var(--pv-accent))]" />
        <Eyebrow tone="accent">Agent</Eyebrow>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={toggleAuto} disabled={active}
            title={auto ? "Auto-accept ON — the agent runs autonomously: it makes its own choices and applies them, no review. Click to turn off." : "Auto-accept OFF — you review and apply each change. Click to let the agent run autonomously."}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 pv-mono text-[10px] transition-colors disabled:opacity-50 ${
              auto
                ? "border-[hsl(var(--pv-accent))]/50 bg-[hsl(var(--pv-accent))]/[0.08] text-[hsl(var(--pv-accent))]"
                : "border-[hsl(var(--pv-border-soft))] text-[hsl(var(--pv-text-faint))] hover:text-foreground"
            }`}>
            <InfinityIcon className="h-2.5 w-2.5" /> auto
          </button>
          <button type="button" onClick={toggleEffort} disabled={active}
            title={effort === "low" ? "Fast mode — proposes inline on first response. Click for deep." : "Deep mode — full tool loop. Click for fast."}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 pv-mono text-[10px] transition-colors disabled:opacity-50 ${
              effort === "low"
                ? "border-[hsl(var(--pv-accent))]/50 bg-[hsl(var(--pv-accent))]/[0.08] text-[hsl(var(--pv-accent))]"
                : "border-[hsl(var(--pv-border-soft))] text-[hsl(var(--pv-text-faint))] hover:text-foreground"
            }`}>
            <Zap className="h-2.5 w-2.5" /> {effort === "low" ? "fast" : "deep"}
          </button>
          {sessionCount > 0 && (
            <button type="button" onClick={() => setHistoryOpen((v) => !v)} title="Past chats"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 pv-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${historyOpen ? "text-[hsl(var(--pv-accent))]" : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"}`}>
              <Clock className="h-3 w-3" /> {sessionCount}
              <ChevronDown className={`h-3 w-3 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
            </button>
          )}
          <button type="button" onClick={() => void newChat()} disabled={busy || active || steps.length === 0} title="New chat — archives the current one"
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-accent))] disabled:opacity-40">
            <SquarePen className="h-3.5 w-3.5" />
          </button>
        </div>
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
          {steps.length === 0 && !optimistic && (
            <p className="pv-serif text-[12.5px] italic leading-[1.5] text-[hsl(var(--pv-text-faint))]">
              Talk to the editor's agent about the whole book — ask a question, get a summary, pressure-test the story. It reads the actual pages before it answers.
            </p>
          )}
          {steps.map((s, i) => <StepBubble key={i} step={s} nodes={nodes} />)}
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} nodes={nodes}
              applying={applyingId === p.id} onApply={() => void apply(p)} onDiscard={() => void discard(p)} />
          ))}
          {/* Guided-flow nudge (lib/dnaJourney.currentObjective) — appears in the feed as the LAST item
              only when the agent's work is settled: idle, nothing running/awaiting, no proposal to review,
              no error. So it reads as "here's what's next", not a pinned CTA. One click hands the step to
              the agent (the objective itself already rides every message's context). */}
          {!active && !optimistic && proposals.length === 0 && row?.status !== "error" && objectiveHeadline && (
            <button type="button" onClick={() => void send(draftTarget
              ? `Write "${nodeLabel(draftTarget.scene)}".`
              : (objectiveKey && NEXT_STEP_MESSAGE[objectiveKey]) || objectiveHeadline || "Let's work on the next step.")} disabled={busy}
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
                  <span className="block pv-serif text-[13px] leading-snug text-foreground">{objectiveHeadline}</span>
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
        {awaiting && row?.pending ? (
          <div className="space-y-2.5 rounded-xl border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/[0.07] p-3.5">
            <div className="flex justify-end">
              <button type="button" onClick={() => void stop()} disabled={row?.cancel_requested}
                title="Cancel this question and stop the agent"
                className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--pv-border-soft))] px-2 py-0.5 text-[11px] text-[hsl(var(--pv-text-faint))] transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-50">
                <X className="h-2.5 w-2.5" /> {row?.cancel_requested ? "stopping…" : "cancel"}
              </button>
            </div>
            {(row.pending.options ?? []).length > 0 && (
              <div className="flex flex-col items-start gap-1.5">
                {row.pending.options!.map((opt, i) => (
                  <button key={i} type="button" disabled={busy} onClick={() => void reply(opt)}
                    className="pv-serif rounded-lg border border-[hsl(var(--pv-border-soft))] bg-background px-3 py-1.5 text-left text-[13.5px] leading-snug text-foreground transition-colors hover:border-[hsl(var(--pv-accent))]/50 disabled:opacity-50">
                    {opt}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void reply(answer); } }}
                rows={1} placeholder="…or answer in your own words" disabled={busy}
                className="pv-serif min-h-[42px] resize-none text-[14px] leading-[1.55]" />
              <button type="button" onClick={() => void reply(answer)} disabled={busy || !answer.trim()}
                className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
          </div>
        ) : (
          <div className="relative">
            {/* Slash-command menu — opens above the composer when the draft starts with "/". */}
            {showMenu && (
              <div className="absolute bottom-[calc(100%+6px)] left-0 right-0 z-10 overflow-hidden rounded-xl border border-[hsl(var(--pv-border-soft))] bg-background shadow-lg">
                {cmds.map((c, i) => (
                  <button key={c.id} type="button"
                    onMouseEnter={() => setHi(i)} onClick={() => pickCommand(c)}
                    className={`flex w-full items-baseline gap-2 px-3 py-2 text-left transition-colors ${i === hi ? "bg-[hsl(var(--pv-surface-2))]" : ""}`}>
                    <span className="pv-mono text-[11px] text-[hsl(var(--pv-accent))]">/{c.trigger}</span>
                    <span className="pv-serif truncate text-[12.5px] text-[hsl(var(--pv-text-muted))]">{c.hint}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <Textarea ref={taRef} value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (showMenu) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % cmds.length); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + cmds.length) % cmds.length); return; }
                    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickCommand(cmds[hi]); return; }
                    if (e.key === "Escape") { e.preventDefault(); setDraft(""); return; }
                  }
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); }
                }}
                rows={1} placeholder={running ? "the agent is working…" : "Ask the agent, or / for commands…"} disabled={busy || active}
                className="pv-serif min-h-[42px] resize-none text-[14px] leading-[1.55]" />
              <button type="button" onClick={() => (running ? void stop() : void send(draft))}
                disabled={running ? row?.cancel_requested : busy || active || !draft.trim()}
                title={running ? (row?.cancel_requested ? "stopping…" : "Stop") : undefined}
                className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
                {running
                  ? (row?.cancel_requested ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5" />)
                  : busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
            {draft === "" && !active && (
              <p className="mt-1.5 inline-flex items-center gap-1 pv-mono text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">
                <Slash className="h-2.5 w-2.5" /> for commands
              </p>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

// Past archived conversations (book_agent_sessions, one row per chat), newest first — each expands to
// review its step feed; "Continue this chat" restores it as the live thread (symmetric with new chat).
function SessionHistory({ sessions, onResume, busy, nodes }: { sessions: AgentSession[]; onResume: (sessionId: number) => void; busy: boolean; nodes: DnaNode[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const when = (iso: string) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; } };
  return (
    <div className="space-y-1">
      {sessions.map((s) => {
        const msgs = s.steps.filter((st) => st.t === "user").length;
        return (
          <div key={s.id}>
            <button type="button" onClick={() => setOpenId(openId === s.id ? null : s.id)}
              className="flex w-full items-center gap-2 py-1 text-left pv-serif text-[12px] text-[hsl(var(--pv-text-muted))] hover:text-foreground">
              <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${openId === s.id ? "rotate-180" : ""}`} />
              <span className="flex-1 truncate italic">{when(s.ended_at)} · {msgs} message{msgs === 1 ? "" : "s"}</span>
            </button>
            {openId === s.id && (
              <div className="space-y-2 border-l border-[hsl(var(--pv-border-soft))]/60 pl-3 pb-2">
                {s.steps.map((st, j) => <StepBubble key={j} step={st} nodes={nodes} />)}
                <div className="flex justify-end pt-1">
                  <button type="button" onClick={() => onResume(s.id)} disabled={busy}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 pv-serif text-[11.5px] text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-accent))] disabled:opacity-40">
                    <CornerDownLeft className="h-3 w-3" /> Continue this chat
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// One step rendered as a chat element: author messages/answers → right bubble; the agent's reply and
// questions → prose; a page-read → a muted activity line.
function StepBubble({ step, nodes }: { step: AgentStep; nodes: DnaNode[] }) {
  const index = useMemo(() => byId(nodes), [nodes]);
  if (step.t === "user" || step.t === "answer") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[hsl(var(--pv-surface-2))] px-3.5 py-2 pv-serif text-[14px] leading-[1.55] text-foreground whitespace-pre-wrap">
          {step.label}
        </div>
      </div>
    );
  }
  if (step.t === "read") {
    return (
      <p className="inline-flex items-center gap-1.5 pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
        <BookOpen className="h-3 w-3" /> {step.label}
      </p>
    );
  }
  if (step.t === "applied" || step.t === "discarded") return <ResolvedCard step={step} nodes={nodes} />;
  // decision — an auto-mode creative fork the agent journaled via ask_author (question + the options it
  // weighed; its pick is stated in the question text). Kept in the feed so the author can revisit every
  // fork after an autonomous run, in order.
  if (step.t === "decision") {
    return (
      <div className="rounded-xl border border-[hsl(var(--pv-accent))]/25 bg-[hsl(var(--pv-accent))]/[0.04] px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="pv-mono shrink-0 text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">⑂ fork</span>
          <span className="pv-serif text-[12.5px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">{humanizeNodeRefs(step.label, index)}</span>
        </div>
        {(step.options ?? []).length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1 pl-1">
            {step.options!.map((opt, i) => (
              <p key={i} className="pv-serif text-[11.5px] leading-[1.45] text-[hsl(var(--pv-text-faint))]">· {opt}</p>
            ))}
          </div>
        )}
      </div>
    );
  }
  // note / ask / done — the agent speaking. Rehydrate any bare node-id references into human labels first.
  return (
    <div className="max-w-[92%] pv-serif text-[14.5px] leading-[1.62] text-[hsl(var(--pv-text-muted))] prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-headings:text-foreground prose-strong:text-foreground prose-strong:font-semibold">
      <ReactMarkdown>{humanizeNodeRefs(step.label, index)}</ReactMarkdown>
    </div>
  );
}

// A short human handle for an op's content (its first meaningful field) — used by the collapsed resolved card.
function opHandle(content: unknown): string {
  const c = (content ?? {}) as Record<string, unknown>;
  const h = c.logline ?? c.name ?? c.title ?? c.controlling_idea ?? c.dramatic_question ?? c.summary ?? c.goal ?? c.text;
  return typeof h === "string" && h.trim() ? h.trim().slice(0, 80) : "";
}

// One line per op for a resolved (applied/discarded) proposal — self-contained from the stored ops, so it
// reads the same in the live feed and in archived sessions (no live-tree lookup, no stale before/after).
function opLine(op: NodeOp): string {
  if (op.op === "edit") { const h = opHandle((op as { content?: unknown }).content); return h ? `edit · ${h}` : "edit a node"; }
  if (op.op === "add") { const h = opHandle((op as { content?: unknown }).content); return `add ${(op as { kind?: string }).kind ?? "node"}${h ? ` · ${h}` : ""}`; }
  if (op.op === "delete") return "remove a node";
  if (op.op === "replace_children") { const o = op as { childKind?: string; children?: unknown[] }; return `rebuild ${o.childKind ?? "children"} · ${o.children?.length ?? 0} new`; }
  return "change";
}

// A resolved proposal kept in the chat for context: a collapsed one-line summary (✓ applied / ✕ discarded)
// that expands to the list of changes. Mirrors ProposalCard's look but read-only — the change already landed.
function ResolvedCard({ step, nodes }: { step: AgentStep; nodes: DnaNode[] }) {
  const [open, setOpen] = useState(false);
  const applied = step.t === "applied";
  const ops = step.ops ?? [];
  // A prose-render step never carries ops (the change is a browser-streamed render, not a node op) — its
  // detail is which scene(s) + the brief that rode into that render, so the card has something to show.
  const isProseRender = !!step.sceneIds?.length;
  const index = byId(nodes);
  const scenes = isProseRender ? step.sceneIds!.map((id) => index.get(id)).filter((n): n is DnaNode => !!n) : [];
  const hasDetail = isProseRender ? scenes.length > 0 || !!step.brief || !!step.renderedProse : ops.length > 0;
  return (
    <div className={`rounded-xl border px-3 py-2 ${applied ? "border-emerald-600/30 bg-emerald-600/[0.04]" : "border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30"}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        {applied
          ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          : <X className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-faint))]" />}
        <span className="pv-mono text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">{applied ? "applied" : "discarded"}</span>
        <span className="flex-1 truncate pv-serif text-[12.5px] text-[hsl(var(--pv-text-muted))]">{humanizeNodeRefs(step.label, index)}</span>
        {hasDetail && <ChevronDown className={`h-3 w-3 shrink-0 text-[hsl(var(--pv-text-faint))] transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && isProseRender && (
        <div className="mt-2 space-y-1.5 border-t border-[hsl(var(--pv-border-soft))]/50 pt-2">
          {scenes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {scenes.map((n) => (
                <span key={n.id} className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--pv-border-soft))] bg-background px-2 py-0.5 pv-serif text-[11.5px] text-foreground">
                  <span className="pv-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--pv-accent))]">scene</span>
                  <span className="max-w-[170px] truncate">{nodeLabel(n)}</span>
                </span>
              ))}
            </div>
          )}
          {step.renderedProse && Object.entries(step.renderedProse).map(([id, text]) => (
            <div key={id} className="rounded-md border border-emerald-600/25 bg-emerald-600/[0.04] px-2.5 py-2">
              <p className="pv-mono text-[9px] uppercase tracking-[0.08em] text-emerald-600">what got written{scenes.length > 1 && index.get(id) ? ` — ${nodeLabel(index.get(id)!)}` : ""}</p>
              <p className="pv-serif mt-1 text-[12.5px] leading-[1.55] text-foreground whitespace-pre-wrap">{text}</p>
            </div>
          ))}
          {step.brief?.focus && <p className="pv-serif text-[11.5px] leading-[1.45] text-[hsl(var(--pv-text-muted))]">{step.brief.focus}</p>}
          {step.brief?.mustHonor?.map((x, i) => (
            <p key={`h${i}`} className="pv-serif text-[11px] leading-[1.45] text-[hsl(var(--pv-text-faint))]">↳ {x}</p>
          ))}
          {step.brief?.avoid?.map((x, i) => (
            <p key={`a${i}`} className="pv-serif text-[11px] leading-[1.45] text-[hsl(var(--pv-text-faint))]">✕ {x}</p>
          ))}
          {!step.brief && scenes.length === 0 && !step.renderedProse && (
            <p className="pv-serif text-[11px] italic leading-[1.45] text-[hsl(var(--pv-text-faint))]">No brief was attached to this render.</p>
          )}
        </div>
      )}
      {open && !isProseRender && ops.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-[hsl(var(--pv-border-soft))]/50 pt-2">
          {ops.map((op, i) => (
            <li key={i} className="pv-mono text-[10.5px] leading-snug text-[hsl(var(--pv-text-faint))]">· {opLine(op)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A reviewable proposal the agent made — the verify step. Renders the DNA node-op diff (describeOps,
// shared with the per-stage chat) and Apply/Discard; Apply runs the ops against book_nodes.
function ProposalCard({ proposal, nodes, applying, onApply, onDiscard }: {
  proposal: AgentProposal; nodes: DnaNode[]; applying: boolean; onApply: () => void; onDiscard: () => void;
}) {
  const isProseRender = proposal.layer === "prose-render";
  const isExpansion = proposal.layer === "expansion";
  const index = byId(nodes);
  const scenes = isProseRender ? (proposal.sceneIds ?? []).map((id) => index.get(id)).filter((n): n is DnaNode => !!n) : [];
  const rows = isProseRender || isExpansion ? [] : describeOps(proposal.ops, nodes);
  const hasBrief = !!proposal.brief && (!!proposal.brief.focus || !!proposal.brief.mustHonor?.length || !!proposal.brief.avoid?.length);
  const briefBlock = hasBrief && (
    <div className="rounded-md border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30 px-2.5 py-2 space-y-1">
      <p className="pv-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--pv-accent))]">{isExpansion ? "your steering" : "agent's brief"}</p>
      {proposal.brief?.focus && <p className="pv-serif text-[12px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">{proposal.brief.focus}</p>}
      {proposal.brief?.mustHonor?.map((x, i) => (
        <p key={`h${i}`} className="pv-serif text-[12px] leading-[1.5] text-[hsl(var(--pv-text-faint))]">↳ {x}</p>
      ))}
      {proposal.brief?.avoid?.map((x, i) => (
        <p key={`a${i}`} className="pv-serif text-[12px] leading-[1.5] text-[hsl(var(--pv-text-faint))]">✕ {x}</p>
      ))}
    </div>
  );
  return (
    <Panel className="border-[hsl(var(--pv-accent))]/45 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <Eyebrow tone="accent">{isProseRender ? "Render prose" : isExpansion ? "Run the engine" : "Proposed change"}</Eyebrow>
        <button type="button" onClick={onDiscard} title="Discard" className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      {proposal.summary && <p className="pv-serif mt-1.5 text-[13.5px] leading-[1.55] text-[hsl(var(--pv-text-muted))]">{humanizeNodeRefs(proposal.summary, index)}</p>}
      {isProseRender ? (
        <div className="mt-3 space-y-2">
          <p className="pv-serif text-[12px] italic leading-[1.5] text-[hsl(var(--pv-text-faint))]">
            Applying streams fresh prose for {scenes.length} scene{scenes.length === 1 ? "" : "s"} in your browser — in the book's voice, with full continuity. This can take a minute per scene.
          </p>
          {briefBlock}
          <div className="flex flex-wrap gap-1.5">
            {scenes.map((n) => (
              <span key={n.id} className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-2 py-0.5 pv-serif text-[12px] text-foreground">
                <span className="pv-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--pv-accent))]">scene</span>
                <span className="max-w-[170px] truncate">{nodeLabel(n)}</span>
              </span>
            ))}
          </div>
        </div>
      ) : isExpansion ? (
        <div className="mt-3 space-y-2">
          <p className="pv-serif text-[12px] italic leading-[1.5] text-[hsl(var(--pv-text-faint))]">
            Applying runs the engine now in your browser and writes the result into the tree — this can take a moment.
          </p>
          {briefBlock}
        </div>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((row, i) => (
            <li key={i} className="border-l-2 border-[hsl(var(--pv-border-soft))] pl-2.5">
              <div className="flex items-baseline gap-2">
                <span className={`pv-mono text-[9.5px] uppercase tracking-[0.12em] ${row.verb === "delete" ? "text-red-600" : row.verb === "add" ? "text-emerald-600" : "text-amber-600"}`}>{row.verb}</span>
                <span className="pv-serif text-[13px] text-foreground">{row.kind} · {row.label}</span>
                {row.parentLabel && <span className="pv-serif text-[11.5px] italic text-[hsl(var(--pv-text-faint))]">in {row.parentLabel}</span>}
                {!!row.restales && <span className="pv-mono text-[9px] text-[hsl(var(--pv-text-faint))]">±{row.restales}</span>}
              </div>
              {row.fields.map((f) => (
                <div key={f.key} className="mt-0.5">
                  <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">{f.key}</span>
                  {f.old && <p className="pv-serif text-[12px] leading-[1.45] text-[hsl(var(--pv-text-faint))] line-through decoration-[hsl(var(--pv-text-faint))]/40">{f.old}</p>}
                  <p className="pv-serif text-[12.5px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">{f.next}</p>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3.5 flex items-center gap-4">
        <button type="button" onClick={onApply} disabled={applying}
          className="pv-serif inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13.5px] text-primary-foreground disabled:opacity-50">
          {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {isProseRender ? (applying ? "Rendering…" : "Render") : isExpansion ? (applying ? "Running…" : "Run") : "Apply"}
        </button>
        <ActionLink tone="faint" onClick={onDiscard}>discard</ActionLink>
      </div>
    </Panel>
  );
}
