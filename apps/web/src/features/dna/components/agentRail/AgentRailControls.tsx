import { ChevronDown, Clock, Infinity as InfinityIcon, SquarePen, X, Zap } from "lucide-react";

// The header's button cluster: manual/auto + fast/deep segmented toggles, past-chats badge, new-chat, and
// (optionally) close. Pulled out of AgentRail's render so the main component reads as orchestration, not markup.
export function AgentRailControls({
  auto, onToggleAuto, effort, onSetEffort, active,
  sessionCount, historyOpen, onToggleHistory,
  onNewChat, newChatDisabled,
  onClose,
}: {
  auto: boolean; onToggleAuto: () => void;
  effort: "low" | "high"; onSetEffort: (mode: "low" | "high") => void;
  active: boolean;
  sessionCount: number; historyOpen: boolean; onToggleHistory: () => void;
  onNewChat: () => void; newChatDisabled: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {/* #12 — a labeled two-position segment (manual/auto), not a single unlabeled icon pill: autonomy
          is the most consequential behavior in the studio, so both states should read at a glance. */}
      <div className="inline-flex items-center gap-0.5 rounded-full border border-[hsl(var(--pv-border-soft))] p-0.5">
        <button type="button" onClick={() => auto && onToggleAuto()} disabled={active}
          title="Manual — you review and apply each change."
          className={`rounded-full px-2 py-0.5 pv-mono text-[10px] transition-colors disabled:opacity-50 ${
            !auto ? "bg-[hsl(var(--pv-accent))] text-background" : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"
          }`}>
          manual
        </button>
        <button type="button" onClick={() => !auto && onToggleAuto()} disabled={active}
          title="Auto — the agent runs autonomously: it makes its own choices and applies them, no review."
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 pv-mono text-[10px] transition-colors disabled:opacity-50 ${
            auto
              ? "bg-[hsl(var(--pv-accent))] text-background"
              : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"
          }`}>
          <InfinityIcon className="h-2.5 w-2.5" /> auto
        </button>
      </div>
      <div className="inline-flex items-center gap-0.5 rounded-full border border-[hsl(var(--pv-border-soft))] p-0.5">
        <button type="button" onClick={() => onSetEffort("low")} disabled={active}
          title="Fast — proposes inline on first response."
          className={`rounded-full px-2 py-0.5 pv-mono text-[10px] transition-colors disabled:opacity-50 ${
            effort === "low"
              ? "bg-[hsl(var(--pv-accent))] text-background"
              : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"
          }`}>
          fast
        </button>
        <button type="button" onClick={() => onSetEffort("high")} disabled={active}
          title="Deep — full tool loop."
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 pv-mono text-[10px] transition-colors disabled:opacity-50 ${
            effort === "high"
              ? "bg-[hsl(var(--pv-accent))] text-background"
              : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"
          }`}>
          <Zap className="h-2.5 w-2.5" /> deep
        </button>
      </div>
      <div className="flex items-center gap-0.5">
        {sessionCount > 0 && (
          <button type="button" onClick={onToggleHistory} title="Past chats"
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 pv-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${historyOpen ? "text-[hsl(var(--pv-accent))]" : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"}`}>
            <Clock className="h-3 w-3" /> {sessionCount}
            <ChevronDown className={`h-3 w-3 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
          </button>
        )}
        <button type="button" onClick={onNewChat} disabled={newChatDisabled} title="New chat — archives the current one"
          className="inline-flex items-center justify-center rounded-full p-1.5 text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-accent))] disabled:opacity-40">
          <SquarePen className="h-3.5 w-3.5" />
        </button>
      </div>
      {onClose && (
        <>
          <div className="h-4 w-px shrink-0 bg-[hsl(var(--pv-border-soft))]" />
          <button type="button" onClick={onClose} title="Close"
            className="inline-flex items-center justify-center rounded-full p-1.5 text-[hsl(var(--pv-text-faint))] transition-colors hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
