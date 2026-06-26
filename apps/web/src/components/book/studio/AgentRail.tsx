// AgentRail — the studio's single conversational agent surface (docs/agent-rail.md, option B). One
// thread per book; you talk to the story editor's agent, which reads pages and discusses the book.
// Phase 1 is read + discuss; per-layer proposals (generate/revise/dna/scene) fold in next.
//
// The whole conversation lives in a book_agent_runs row (kind='thread'); this panel sends a message
// and projects the row live (refresh = no-op). Mirrors ReviseChat's shape but is driven by the
// agent's `steps` feed rather than a per-layer chat thread.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Check, ChevronDown, Clock, CornerDownLeft, Loader2, Slash, Square, SquarePen, Wand2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow } from "@/hooks/useLatestTaskRow";
import { stopRun } from "@/lib/stopRun";
import {
  AGENT_THREAD_SELECT, answerAgent, applyAgentProposal, ASPECT_KINDS, ASPECT_LABELS, discardAgentProposal,
  resumeAgentSession, sendAgentMessage, startNewAgentSession,
  type AgentProposal, type AgentSession, type Aspect, type AgentStep, type AgentThreadRow,
} from "@/lib/agentThread";
import { availableCommands, matchCommands, type AgentCommand } from "@/lib/agentCommands";
import { describeOps } from "@/lib/dnaChat";
import { analysisText, type BookSettings, type DnaNode, type NodeKind } from "@/lib/novelDna";
import { useChatScroll } from "./useChatScroll";
import { ActionLink, Eyebrow, Panel, RunError } from "./studioUi";

export function AgentRail({ bookId, nodes, settings }: { bookId: number; nodes: DnaNode[]; settings: BookSettings }) {
  const { toast } = useToast();

  // The structural backstop (pacing / dangling-promise / sagging-run lints), computed from the live
  // tree — sent with each message so the agent acts on drift/sag. Only meaningful once structure exists.
  const analysis = useMemo(() => {
    const hasStructure = nodes.some((n) => n.kind === "beat" || n.kind === "scene");
    return hasStructure ? analysisText(nodes, settings) : undefined;
  }, [nodes, settings]);

  // Which stages EXIST (have nodes of their kinds) — the default scope is all of these. 'draft' needs
  // a scene with written prose; the others just need a node of one of their kinds.
  const available = useMemo<Aspect[]>(() => {
    const kinds = new Set<NodeKind>(nodes.map((n) => n.kind));
    const hasProse = nodes.some((n) => n.kind === "scene" && !!(n.content as { prose?: { text?: string } })?.prose?.text?.trim());
    return (Object.keys(ASPECT_KINDS) as Aspect[]).filter((a) =>
      a === "draft" ? hasProse : ASPECT_KINDS[a].some((k) => kinds.has(k)),
    );
  }, [nodes]);
  // The context filter. null = the default ("whole book" — every existing aspect, auto-following
  // `available`); a non-null array = the author narrowed it by hand. Sent with each message.
  const [custom, setCustom] = useState<Aspect[] | null>(null);
  const scope = custom ?? available;
  const toggleAspect = (a: Aspect) =>
    setCustom((c) => { const base = c ?? available; return base.includes(a) ? base.filter((x) => x !== a) : [...base, a]; });
  // When the filter is the full set (or empty), send nothing → the edge treats it as the whole book.
  const sentScope = custom && custom.length && custom.length < available.length ? custom : undefined;
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
  const sessions = useMemo(() => (Array.isArray(row?.sessions) ? row!.sessions! : []) as AgentSession[], [row]);
  const running = row?.status === "running";
  const awaiting = row?.status === "awaiting_input";
  const active = running || awaiting;

  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
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
    if (c.scope) { const next = c.scope.filter((a) => available.includes(a)); if (next.length) setCustom(next); }
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
    setOptimistic(t);
    try {
      await sendAgentMessage(bookId, t, sentScope, analysis);
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

  const newChat = async () => {
    if (!row || busy || active) return;
    try { await startNewAgentSession(row.id); setHistoryOpen(false); refetch(); }
    catch (e) { toast({ title: "Couldn't start a new chat", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  const resume = async (index: number) => {
    if (!row || busy || active) return;
    try { await resumeAgentSession(row.id, index); setHistoryOpen(false); refetch(); }
    catch (e) { toast({ title: "Couldn't continue that chat", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  const apply = async (p: AgentProposal) => {
    if (!row || applyingId) return;
    setApplyingId(p.id);
    try {
      const { rejected } = await applyAgentProposal(bookId, row.id, p, proposals);
      refetch();
      if (rejected.length) {
        const reasons = rejected.map((r) => r.reasons[0]).filter(Boolean).slice(0, 3).join("; ");
        toast({ title: `Applied with ${rejected.length} skipped`, description: `Some changes didn't fit the schema and weren't saved: ${reasons}`, variant: "destructive" });
      } else {
        toast({ title: "Applied", description: p.summary || "Change applied to the DNA tree." });
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
        {active && (
          <button type="button" onClick={() => void stop()} disabled={row?.cancel_requested}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-[hsl(var(--pv-border-soft))] px-2 py-0.5 text-[11px] text-[hsl(var(--pv-text-faint))] transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-50">
            <Square className="h-2.5 w-2.5" /> {row?.cancel_requested ? "stopping…" : "stop"}
          </button>
        )}
        <div className={`flex items-center gap-1 ${active ? "" : "ml-auto"}`}>
          {sessions.length > 0 && (
            <button type="button" onClick={() => setHistoryOpen((v) => !v)} title="Past chats"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 pv-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${historyOpen ? "text-[hsl(var(--pv-accent))]" : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"}`}>
              <Clock className="h-3 w-3" /> {sessions.length}
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
          <SessionHistory sessions={sessions} onResume={resume} busy={busy || active} />
        </div>
      )}

      {/* Context filter — which book aspects the agent sees + can touch. Defaults to all created. */}
      {available.length > 0 && (
        <div className="mt-2.5 flex shrink-0 flex-wrap items-center gap-1.5">
          <span className="pv-mono text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">context</span>
          {available.map((a) => {
            const on = scope.includes(a);
            return (
              <button key={a} type="button" onClick={() => toggleAspect(a)} disabled={active}
                title={on ? `${ASPECT_LABELS[a]} in scope — tap to exclude` : `${ASPECT_LABELS[a]} excluded — tap to include`}
                className={`rounded-full border px-2.5 py-0.5 pv-serif text-[12px] transition-colors disabled:opacity-50 ${
                  on
                    ? "border-[hsl(var(--pv-accent))]/50 bg-[hsl(var(--pv-accent))]/[0.08] text-[hsl(var(--pv-accent))]"
                    : "border-[hsl(var(--pv-border-soft))] text-[hsl(var(--pv-text-faint))] hover:text-foreground"
                }`}>
                {ASPECT_LABELS[a]}
              </button>
            );
          })}
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
          {steps.map((s, i) => <StepBubble key={i} step={s} />)}
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} nodes={nodes}
              applying={applyingId === p.id} onApply={() => void apply(p)} onDiscard={() => void discard(p)} />
          ))}
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

      {/* Composer — or the answer card when the agent has asked a question */}
      <div className="mt-3 shrink-0">
        {awaiting && row?.pending ? (
          <div className="space-y-2.5 rounded-xl border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/[0.07] p-3.5">
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
              <button type="button" onClick={() => void send(draft)} disabled={busy || active || !draft.trim()}
                className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
                {busy || running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
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

// Past archived conversations (book_agent_runs.sessions), newest first — each expands to review its
// step feed; "Continue this chat" restores it as the live thread (symmetric with new chat).
function SessionHistory({ sessions, onResume, busy }: { sessions: AgentSession[]; onResume: (index: number) => void; busy: boolean }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const when = (iso: string) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; } };
  return (
    <div className="space-y-1">
      {sessions.map((s, i) => {
        const msgs = s.steps.filter((st) => st.t === "user").length;
        return (
          <div key={i}>
            <button type="button" onClick={() => setOpenIdx(openIdx === i ? null : i)}
              className="flex w-full items-center gap-2 py-1 text-left pv-serif text-[12px] text-[hsl(var(--pv-text-muted))] hover:text-foreground">
              <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${openIdx === i ? "rotate-180" : ""}`} />
              <span className="flex-1 truncate italic">{when(s.ended_at)} · {msgs} message{msgs === 1 ? "" : "s"}</span>
            </button>
            {openIdx === i && (
              <div className="space-y-2 border-l border-[hsl(var(--pv-border-soft))]/60 pl-3 pb-2">
                {s.steps.map((st, j) => <StepBubble key={j} step={st} />)}
                <div className="flex justify-end pt-1">
                  <button type="button" onClick={() => onResume(i)} disabled={busy}
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
function StepBubble({ step }: { step: AgentStep }) {
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
  // note / ask / done — the agent speaking
  return (
    <div className="max-w-[92%] pv-serif text-[14.5px] leading-[1.62] text-[hsl(var(--pv-text-muted))] prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-headings:text-foreground prose-strong:text-foreground prose-strong:font-semibold">
      <ReactMarkdown>{step.label}</ReactMarkdown>
    </div>
  );
}

// A reviewable proposal the agent made — the verify step. Renders the DNA node-op diff (describeOps,
// shared with the per-stage chat) and Apply/Discard; Apply runs the ops against book_nodes.
function ProposalCard({ proposal, nodes, applying, onApply, onDiscard }: {
  proposal: AgentProposal; nodes: DnaNode[]; applying: boolean; onApply: () => void; onDiscard: () => void;
}) {
  const rows = describeOps(proposal.ops, nodes);
  return (
    <Panel className="border-[hsl(var(--pv-accent))]/45 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <Eyebrow tone="accent">Proposed change</Eyebrow>
        <button type="button" onClick={onDiscard} title="Discard" className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      {proposal.summary && <p className="pv-serif mt-1.5 text-[13.5px] leading-[1.55] text-[hsl(var(--pv-text-muted))]">{proposal.summary}</p>}
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
      <div className="mt-3.5 flex items-center gap-4">
        <button type="button" onClick={onApply} disabled={applying}
          className="pv-serif inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13.5px] text-primary-foreground disabled:opacity-50">
          {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Apply
        </button>
        <ActionLink tone="faint" onClick={onDiscard}>discard</ActionLink>
      </div>
    </Panel>
  );
}
