// AgentRail — the studio's single conversational agent surface (docs/agent-rail.md, option B). One
// thread per book; you talk to the story editor's agent, which reads pages and discusses the book.
// Phase 1 is read + discuss; per-layer proposals (generate/revise/dna/scene) fold in next.
//
// The whole conversation lives in a book_agent_runs row (kind='thread'); this panel sends a message
// and projects the row live (refresh = no-op). Mirrors ReviseChat's shape but is driven by the
// agent's `steps` feed rather than a per-layer chat thread.
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Loader2, Square, Wand2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow } from "@/hooks/useLatestTaskRow";
import { stopRun } from "@/lib/stopRun";
import { AGENT_THREAD_SELECT, answerAgent, sendAgentMessage, type AgentStep, type AgentThreadRow } from "@/lib/agentThread";
import { useChatScroll } from "./useChatScroll";
import { Eyebrow, Panel, RunError } from "./studioUi";

export function AgentRail({ bookId }: { bookId: number }) {
  const { toast } = useToast();
  const { row, refetch, stale } = useLatestTaskRow<AgentThreadRow>({
    table: "book_agent_runs",
    bookId,
    select: AGENT_THREAD_SELECT,
    match: { kind: "thread" },
    activeStatuses: ["running"], // awaiting_input idles on the author; only 'running' arms the watchdog
    staleMs: 6 * 60 * 1000,
  });

  const steps = useMemo(() => (Array.isArray(row?.steps) ? row!.steps! : []) as AgentStep[], [row]);
  const running = row?.status === "running";
  const awaiting = row?.status === "awaiting_input";
  const active = running || awaiting;

  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  // Optimistic echo of the just-sent message until the row reflects it over Realtime.
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const { scrollRef, atBottom, scrollToBottom } = useChatScroll([steps.length, running, awaiting, !!optimistic] as const);

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
      await sendAgentMessage(bookId, t);
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
      </div>

      {/* Conversation */}
      <div className="relative mt-3 min-h-0 flex-1">
        <div ref={scrollRef} className="h-full space-y-3.5 overflow-y-auto pr-1">
          {steps.length === 0 && !optimistic && (
            <p className="pv-serif text-[12.5px] italic leading-[1.5] text-[hsl(var(--pv-text-faint))]">
              Talk to the editor's agent about the whole book — ask a question, get a summary, pressure-test the story. It reads the actual pages before it answers.
            </p>
          )}
          {steps.map((s, i) => <StepBubble key={i} step={s} />)}
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
          <div className="flex items-end gap-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
              rows={1} placeholder={running ? "the agent is working…" : "Ask the agent about the book…"} disabled={busy || active}
              className="pv-serif min-h-[42px] resize-none text-[14px] leading-[1.55]" />
            <button type="button" onClick={() => void send(draft)} disabled={busy || active || !draft.trim()}
              className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
              {busy || running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>
    </Panel>
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
