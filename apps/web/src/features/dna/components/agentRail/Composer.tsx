import { type RefObject } from "react";
import { ArrowUp, Loader2, Square, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type { AgentCommand } from "@/features/dna/lib/agentCommands";

// The composer — or the answer card when the agent has asked a question. Owns no state of its own; the
// draft/answer/slash-menu state lives in AgentRail so it can be shared with the "next step" nudge and the
// optimistic-echo logic above the feed.
export function Composer({
  awaiting, pendingOptions, onReply, answer, setAnswer,
  onStop, stopDisabled, cancelRequested,
  draft, setDraft, onSend, running, active, busy,
  showMenu, cmds, hi, setHi, onPickCommand,
  taRef, stopping,
}: {
  awaiting: boolean; pendingOptions: string[]; onReply: (text: string) => void; answer: string; setAnswer: (v: string) => void;
  onStop: () => void; stopDisabled: boolean; cancelRequested: boolean;
  draft: string; setDraft: (v: string) => void; onSend: (text: string) => void; running: boolean; active: boolean; busy: boolean;
  showMenu: boolean; cmds: AgentCommand[]; hi: number; setHi: (fn: (h: number) => number) => void; onPickCommand: (c: AgentCommand) => void;
  taRef: RefObject<HTMLTextAreaElement>; stopping: boolean;
}) {
  if (awaiting) {
    return (
      <div className="space-y-2.5 rounded-xl border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/[0.07] p-3.5">
        <div className="flex justify-end">
          <button type="button" onClick={onStop} disabled={stopDisabled}
            title="Cancel this question and stop the agent"
            className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--pv-border-soft))] px-2 py-0.5 text-[11px] text-[hsl(var(--pv-text-faint))] transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-50">
            <X className="h-2.5 w-2.5" /> {cancelRequested ? "stopping…" : "cancel"}
          </button>
        </div>
        {pendingOptions.length > 0 && (
          <div className="flex flex-col items-start gap-1.5">
            {pendingOptions.map((opt, i) => (
              <button key={i} type="button" disabled={busy} onClick={() => onReply(opt)}
                className="pv-serif rounded-lg border border-[hsl(var(--pv-border-soft))] bg-background px-3 py-1.5 text-left text-[13.5px] leading-snug text-foreground transition-colors hover:border-[hsl(var(--pv-accent))]/50 disabled:opacity-50">
                {opt}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onReply(answer); } }}
            rows={1} placeholder="…or answer in your own words" disabled={busy}
            className="pv-serif min-h-[42px] resize-none text-[14px] leading-[1.55]" />
          <button type="button" onClick={() => onReply(answer)} disabled={busy || !answer.trim()}
            className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="relative">
      {/* Slash-command menu — opens above the composer when the draft starts with "/". */}
      {showMenu && (
        <div className="absolute bottom-[calc(100%+6px)] left-0 right-0 z-10 overflow-hidden rounded-xl border border-[hsl(var(--pv-border-soft))] bg-background shadow-lg">
          {cmds.map((c, i) => (
            <button key={c.id} type="button"
              onMouseEnter={() => setHi(() => i)} onClick={() => onPickCommand(c)}
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
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); onPickCommand(cmds[hi]); return; }
              if (e.key === "Escape") { e.preventDefault(); setDraft(""); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(draft); }
          }}
          rows={1} placeholder={running ? "the agent is working…" : "Ask the agent, or / for commands…"} disabled={busy || active}
          className="pv-serif min-h-[42px] resize-none text-[14px] leading-[1.55]" />
        <button type="button" onClick={() => (running ? onStop() : onSend(draft))}
          disabled={running ? (stopping || cancelRequested) : busy || active || !draft.trim()}
          title={running ? ((stopping || cancelRequested) ? "stopping…" : "Stop") : undefined}
          className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
          {running
            ? ((stopping || cancelRequested) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5" />)
            : busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
