import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clock, Infinity as InfinityIcon, MoreVertical, SquarePen, Zap } from "lucide-react";

// The header's button cluster: a kebab menu (mode + effort) plus past-chats badge and new-chat. Pulled
// out of AgentRail's render so the main component reads as orchestration, not markup. The close affordance
// was dropped — the tree's own PanelLeft toggle (DnaTreePage) already opens/closes this rail, so a second
// X here was a redundant exit.
//
// The kebab menu is hand-rolled (not shadcn's DropdownMenu) to match FocusChip's own popover: shadcn's
// menu portals into document.body, which escapes the local theme-paper/theme-terminal wrapper DnaTreePage
// forces around the studio (Console-on-Paper is scoped to that div, not to <html>) — the portal would
// pick up whichever theme is set site-wide instead, and can render with no matching --popover background
// at all. Rendering in place keeps it inside the same themed subtree the rest of the rail lives in.
export function AgentRailControls({
  auto, onToggleAuto, effort, onSetEffort, active,
  sessionCount, historyOpen, onToggleHistory,
  onNewChat, newChatDisabled,
}: {
  auto: boolean; onToggleAuto: () => void;
  effort: "low" | "high"; onSetEffort: (mode: "low" | "high") => void;
  active: boolean;
  sessionCount: number; historyOpen: boolean; onToggleHistory: () => void;
  onNewChat: () => void; newChatDisabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      <div ref={ref} className="relative shrink-0">
        <button type="button" onClick={() => setOpen((v) => !v)} title="Agent settings — mode & effort"
          className="relative inline-flex items-center justify-center rounded-full p-1.5 text-[hsl(var(--pv-text-faint))] transition-colors hover:text-foreground">
          <MoreVertical className="h-3.5 w-3.5" />
          {/* Autonomy is the most consequential toggle in the studio (#12) — collapsing it into the
              kebab must not make it invisible, so a lit dot survives as the at-a-glance signal. */}
          {auto && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--pv-accent))]" />}
        </button>
        {open && (
          <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))] p-2 shadow-lg">
            <p className="px-1 pv-mono text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">Mode</p>
            <div className="mt-1 inline-flex w-full items-center gap-0.5 rounded-full border border-[hsl(var(--pv-border-soft))] p-0.5">
              <button type="button" onClick={() => auto && onToggleAuto()} disabled={active}
                title="Manual — you review and apply each change."
                className={`flex-1 rounded-full px-2 py-1 pv-mono text-[10px] transition-colors disabled:opacity-50 ${
                  !auto ? "bg-[hsl(var(--pv-accent))] text-background" : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"
                }`}>
                manual
              </button>
              <button type="button" onClick={() => !auto && onToggleAuto()} disabled={active}
                title="Auto — the agent runs autonomously: it makes its own choices and applies them, no review."
                className={`inline-flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 pv-mono text-[10px] transition-colors disabled:opacity-50 ${
                  auto ? "bg-[hsl(var(--pv-accent))] text-background" : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"
                }`}>
                <InfinityIcon className="h-2.5 w-2.5" /> auto
              </button>
            </div>
            <div className="my-2 h-px bg-[hsl(var(--pv-border-soft))]" />
            <p className="px-1 pv-mono text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">Effort</p>
            <div className="mt-1 inline-flex w-full items-center gap-0.5 rounded-full border border-[hsl(var(--pv-border-soft))] p-0.5">
              <button type="button" onClick={() => onSetEffort("low")} disabled={active}
                title="Fast — proposes inline on first response."
                className={`flex-1 rounded-full px-2 py-1 pv-mono text-[10px] transition-colors disabled:opacity-50 ${
                  effort === "low" ? "bg-[hsl(var(--pv-accent))] text-background" : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"
                }`}>
                fast
              </button>
              <button type="button" onClick={() => onSetEffort("high")} disabled={active}
                title="Deep — full tool loop."
                className={`inline-flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 pv-mono text-[10px] transition-colors disabled:opacity-50 ${
                  effort === "high" ? "bg-[hsl(var(--pv-accent))] text-background" : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"
                }`}>
                <Zap className="h-2.5 w-2.5" /> deep
              </button>
            </div>
          </div>
        )}
      </div>
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
  );
}
