// ManuscriptChat — the agent rail on the agent canvas. Sends messages to the book's manuscript thread,
// projects the run row live (the page shell owns the row; refresh = no-op), renders the feed's smart
// units (choices, staged changes, action buttons), and carries the per-thread model pick.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, History, Loader2, Plus, Square, WandSparkles, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { stopRun } from "@/lib/stopRun";
import { useChatScroll } from "@/components/book/shared/useChatScroll";
import { Eyebrow, RunError } from "@/components/book/shared/studioUi";
import { fetchAgentSessionCount, fetchAgentSessions, resumeAgentSession, startNewAgentSession } from "@/features/dna/lib/agentThread";
import { answerManuscriptAgent, sendManuscriptMessage, type ManuscriptChange, type ManuscriptPage, type ManuscriptRunRow, type ManuscriptStep } from "../../lib/manuscriptAgent";
import { MODEL_CHOICES, modelLabel } from "../../lib/models";
import { ChatStep } from "./ChatStep";
import { StagedCard } from "./StagedCard";
import { CanvasAnchor } from "./CanvasAnchor";
import { canvasSnapshot, type ManuscriptCanvas } from "../../lib/manuscriptContext";

interface Session { id: number; steps: ManuscriptStep[]; ended_at: string; title: string | null }

export function ManuscriptChat({ bookId, run, refetchRun, stale, pages, staged, canvas, onSelectCanvas, busyId, onAccept, onReject, onJumpToChange, onJumpToPage, onAction }: {
  bookId: number; run: ManuscriptRunRow | null; refetchRun: () => void; stale: boolean; pages: ManuscriptPage[];
  staged: ManuscriptChange[]; busyId: string | null;
  canvas: ManuscriptCanvas; onSelectCanvas: (canvas: ManuscriptCanvas) => void;
  onAccept: (c: ManuscriptChange) => void; onReject: (c: ManuscriptChange) => void; onJumpToChange: (c: ManuscriptChange) => void;
  onJumpToPage: (pageId: number) => void; onAction: (step: ManuscriptStep) => void;
}) {
  const { toast } = useToast();
  const steps = useMemo(() => (Array.isArray(run?.steps) ? run!.steps! : []), [run]);
  const running = run?.status === "running";
  const awaiting = run?.status === "awaiting_input";
  const active = running || awaiting;
  const context = canvasSnapshot(canvas, pages, staged);
  const canOpenCanvas = (target: ManuscriptCanvas) => !!canvasSnapshot(target, pages, staged);

  // The model pick — per book, remembered; sent with every message.
  const modelKey = `manuscript-model-${bookId}`;
  const [model, setModel] = useState<string>(() => { try { return localStorage.getItem(modelKey) || "default"; } catch { return "default"; } });
  useEffect(() => { try { localStorage.setItem(modelKey, model); } catch { /* ignore */ } }, [modelKey, model]);

  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<ManuscriptStep | null>(null);
  const optimisticAt = useRef(0);
  const [stopping, setStopping] = useState(false);
  useEffect(() => { if (!running) setStopping(false); }, [running]);
  useEffect(() => {
    if (optimistic != null && steps.some((s, i) => i >= optimisticAt.current && s.t === optimistic.t && s.label === optimistic.label)) setOptimistic(null);
  }, [steps, optimistic]);

  const { scrollRef, atBottom, scrollToBottom } = useChatScroll([steps.length, staged.length, running, awaiting, !!optimistic] as const);
  useEffect(() => { if (optimistic != null) scrollToBottom(false); }, [optimistic, scrollToBottom]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy || active || busyId) return;
    optimisticAt.current = steps.length;
    setBusy(true); setDraft(""); setOptimistic({ t: "user", label: t, ...(context ? { canvas: context } : {}) });
    try { await sendManuscriptMessage(bookId, t, model, context?.target); refetchRun(); }
    catch (e) { setOptimistic(null); setDraft(t); toast({ title: "The agent couldn't respond", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const reply = async (text: string) => {
    const t = text.trim();
    if (!t || busy || !run || !awaiting) return;
    optimisticAt.current = steps.length;
    setBusy(true); setAnswer(""); setOptimistic({ t: "answer", label: t, ...(context ? { canvas: context } : {}) });
    try { await answerManuscriptAgent(run.id, t, context?.target); refetchRun(); }
    catch (e) { setOptimistic(null); setAnswer(t); toast({ title: "Couldn't send your answer", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const stop = async () => {
    if (!run || !active) return;
    setStopping(true);
    try { await stopRun("book_agent_runs", run.id, run.status); refetchRun(); }
    catch (e) { setStopping(false); toast({ title: "Couldn't stop", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  // Past chats — archived in book_agent_sessions by the same RPCs the Studio thread uses.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const threadId = run?.id;
  useEffect(() => { if (threadId) void fetchAgentSessionCount(threadId).then(setSessionCount); else setSessionCount(0); }, [threadId, steps.length]);
  useEffect(() => { if (historyOpen && threadId) void fetchAgentSessions(threadId).then((rows) => setSessions(rows as unknown as Session[])); }, [historyOpen, threadId]);
  const newChat = async () => {
    if (!run || active || busy || !steps.length) return;
    try { await startNewAgentSession(run.id); setHistoryOpen(false); refetchRun(); }
    catch (e) { toast({ title: "Couldn't start a new chat", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };
  const resume = async (sessionId: number) => {
    if (!run || active || busy) return;
    try { await resumeAgentSession(run.id, sessionId); setHistoryOpen(false); refetchRun(); }
    catch (e) { toast({ title: "Couldn't continue that chat", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = taRef.current;
    if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }
  }, [draft, awaiting]);
  const pendingOptions = run?.pending?.options ?? [];
  const currentPage = canvas.kind === "page" ? pages.find((p) => p.id === canvas.pageId) : undefined;
  const starters = currentPage ? [
    { label: "Read this page", prompt: "Read this page and tell me what is working and what needs attention. Don't propose changes yet." },
    ...(currentPage.page_type === "text" ? [
      { label: "Tighten the prose", prompt: "Tighten this page while preserving my voice and meaning. Propose focused edits and explain the main changes." },
      { label: "Continue from here", prompt: "Read this page and the surrounding pages, then propose a new page immediately after this one that continues naturally in the same voice." },
    ] : []),
  ] : canvas.kind === "add" ? [] : pages.length ? [
    { label: "Review the manuscript", prompt: "Read the manuscript and identify the three most useful revisions. Explain why each matters before proposing any changes." },
    { label: "Work on the title", prompt: "Read enough of the manuscript to suggest a stronger title and subtitle. Give me a few directions to choose from before proposing a change." },
  ] : [
    { label: "Start the first page", prompt: "Help me write the first page of this book. Ask me what you need to know about the idea, voice, and reader before proposing a draft." },
  ];

  return (
    <div className="flex h-full flex-col px-3.5 pb-3">
      <div className="box-border flex h-11 shrink-0 items-center gap-2 border-b border-[hsl(var(--pv-border-soft))]">
        <WandSparkles className="h-4 w-4 shrink-0 text-[hsl(var(--pv-accent))]" />
        <Eyebrow tone="accent" className="shrink-0">Agent</Eyebrow>
        <span className="pv-serif min-w-0 flex-1 truncate text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">{run?.title ?? ""}</span>
        <button type="button" onClick={() => setHistoryOpen((v) => !v)} disabled={!sessionCount} title="Past chats"
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 pv-mono text-[10px] text-[hsl(var(--pv-text-faint))] hover:text-foreground disabled:opacity-40">
          <History className="h-3.5 w-3.5" />{sessionCount || ""}
        </button>
        <button type="button" onClick={() => void newChat()} disabled={active || busy || !steps.length} title="New chat"
          className="inline-flex items-center rounded-full p-1 text-[hsl(var(--pv-text-faint))] hover:text-foreground disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {historyOpen && sessions.length > 0 && (
        <div className="sidebar-scroll mt-2 max-h-[40%] shrink-0 overflow-y-auto rounded-xl border border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/30 px-3 py-2">
          <div className="mb-1 flex items-center justify-between"><Eyebrow>Past chats</Eyebrow><button type="button" onClick={() => setHistoryOpen(false)}><X className="h-3 w-3 text-[hsl(var(--pv-text-faint))]" /></button></div>
          {sessions.map((s) => (
            <button key={s.id} type="button" disabled={active || busy} onClick={() => void resume(s.id)}
              className="block w-full truncate py-1 text-left pv-serif text-[12.5px] text-[hsl(var(--pv-text-muted))] hover:text-foreground disabled:opacity-50">
              {s.title ?? s.steps.find((x) => x.t === "user")?.label ?? "Untitled chat"}
              <span className="ml-1.5 pv-mono text-[9.5px] text-[hsl(var(--pv-text-faint))]">{new Date(s.ended_at).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative mt-3 -mr-3.5 min-h-0 flex-1">
        <div ref={scrollRef} className="sidebar-scroll h-full space-y-3.5 overflow-y-auto pr-3.5">
          {steps.length === 0 && !optimistic && (
            <div className="space-y-4">
              <p className="pv-serif text-[13.5px] leading-[1.6] text-[hsl(var(--pv-text-muted))]">
                Let's work on your manuscript. I can see which page you have open, so you can say “tighten this page” or “continue from here.” I'll read the text before making suggestions. Proposed edits appear beside our conversation for you to review, down to a single word.
              </p>
              {starters.length > 0 && <div className="flex flex-col items-start gap-2">
                {starters.map((s) => <button key={s.label} type="button" disabled={busy || active} onClick={() => { setDraft(s.prompt); taRef.current?.focus(); }}
                  className="rounded-xl border border-[hsl(var(--pv-border-soft))] bg-background px-3 py-2 text-left pv-serif text-[13px] text-[hsl(var(--pv-text-muted))] transition-colors hover:border-[hsl(var(--pv-accent))]/50 hover:text-foreground disabled:opacity-40">{s.label} <ArrowUp className="ml-1 inline h-3 w-3 rotate-45" /></button>)}
              </div>}
            </div>
          )}
          {steps.map((s, i) => <ChatStep key={i} step={s} pages={pages} canvas={canvas} onSelectCanvas={onSelectCanvas} canOpenCanvas={canOpenCanvas} onAction={onAction} onJumpToPage={onJumpToPage} />)}
          <StagedCard changes={staged} pages={pages} busyId={busyId} onAccept={onAccept} onReject={onReject} onJump={onJumpToChange} />
          {optimistic && (
            <div className="opacity-60"><ChatStep step={optimistic} /></div>
          )}
          {running && !stale && <div className="flex items-center gap-2 pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-faint))]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…</div>}
          {running && stale && <p className="pv-serif text-[13px] leading-[1.55] text-amber-600 dark:text-amber-500">This turn stalled — it may have died. Stop it and try again.</p>}
          {run?.status === "error" && run.error && <RunError msg={run.error} />}
        </div>
        {!atBottom && (
          <button type="button" onClick={() => scrollToBottom(true)}
            className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[hsl(var(--pv-border-soft))] bg-background/90 px-3 py-1 pv-serif text-[12px] text-[hsl(var(--pv-text-muted))] shadow-sm backdrop-blur-sm hover:text-foreground">
            <ArrowDown className="h-3 w-3" /> latest
          </button>
        )}
      </div>

      <div className="mt-3 shrink-0">
        {context && <div className="mb-2 flex min-w-0 items-center gap-2">
          <span className="shrink-0 pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">Open beside chat</span>
          <CanvasAnchor snapshot={context} />
        </div>}
        {awaiting && run?.pending ? (
          <div className="space-y-2.5 rounded-xl border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/[0.07] p-3.5">
            {pendingOptions.length > 0 && (
              <div className="flex flex-col items-start gap-1.5">
                {pendingOptions.map((opt, i) => (
                  <button key={i} type="button" disabled={busy} onClick={() => void reply(opt)}
                    className="pv-serif rounded-lg border border-[hsl(var(--pv-border-soft))] bg-background px-3 py-1.5 text-left text-[13.5px] leading-snug text-foreground transition-colors hover:border-[hsl(var(--pv-accent))]/50 disabled:opacity-50">{opt}</button>
                ))}
              </div>
            )}
            <div className="overflow-hidden rounded-2xl border border-input bg-background">
              <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={1} aria-label="Your answer" placeholder="…or answer in your own words" disabled={busy}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void reply(answer); } }}
                className="pv-serif min-h-[38px] resize-none border-0 bg-transparent px-3.5 pb-1 pt-2.5 text-[14px] leading-[1.55] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
              <div className="flex items-center justify-between px-2 pb-2">
                <button type="button" onClick={() => void stop()} className="pv-serif px-1.5 text-[11.5px] text-[hsl(var(--pv-text-faint))] hover:text-destructive">cancel</button>
                <button type="button" onClick={() => void reply(answer)} disabled={busy || !answer.trim()} aria-label="Send answer" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-input bg-background">
            <Textarea ref={taRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} disabled={busy || active} aria-label="Message the manuscript agent"
              placeholder={running ? "the agent is working…" : "Ask about the book, or tell me what to change…"}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); } }}
              className="pv-serif min-h-[38px] resize-none border-0 bg-transparent px-3.5 pb-1 pt-2.5 text-[14px] leading-[1.55] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              {/* Model picker — every selectable tier; the server re-validates the key. */}
              <label className="relative inline-flex items-center gap-1 rounded-full border border-[hsl(var(--pv-border-soft))] px-2 py-0.5 pv-mono text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--pv-text-muted))] hover:text-foreground" title="Model for this chat">
                {modelLabel(model)} <ChevronDown className="h-3 w-3" />
                <select value={model} onChange={(e) => setModel(e.target.value)} disabled={active} className="absolute inset-0 cursor-pointer opacity-0">
                  {MODEL_CHOICES.map((m) => <option key={m.key} value={m.key}>{m.label} — {m.hint}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => (running ? void stop() : void send(draft))}
                disabled={running ? (stopping || !!run?.cancel_requested) : busy || active || !!busyId || !draft.trim()}
                title={running ? "Stop" : "Send"}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
                {running ? ((stopping || run?.cancel_requested) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3" />) : busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
