// FocusChip — the DECLARED focus, made visible and one click to clear (docs/agent-focus.md slice 1).
//
// Why this exists: the agent has ALWAYS had a mode (derived from the journey stage, branching its
// behaviour through the `discovering` / `inInterview` / three-state-objective predicates). It was just
// invisible and unoverridable — the worst configuration a modal system can have. The HCI antidote to a
// mode error is exactly two things: make the mode VISIBLE, and make exiting CHEAP. That is this file.
//
// It is an ANCHOR, not a fence: the agent still sees the whole tree and may still edit any unlocked node
// in any mode. The chip changes DEFAULTS (which playbooks load, where to start), never permissions.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Crosshair, X } from "lucide-react";
import MODES from "../../lib/agentFocusModes.json";

export interface FocusModeMeta { key: string; label: string; blurb: string; target: string }

const ALL = MODES as FocusModeMeta[];
export const focusModeMeta = (key: string | null | undefined): FocusModeMeta | undefined =>
  ALL.find((m) => m.key === key);

// The journey rung → mode mapping behind the SUGGESTION (derived proposes, author disposes). Keyed by
// lib/dnaJourney.currentObjectiveKey, which returns a substep key ("interview", "cast", "beats", …) or
// the stage key when a stage has no substep in progress. Unknown keys simply yield no suggestion — a
// missing nudge is a non-event, so this deliberately does not need to be exhaustive.
const RUNG_TO_MODE: Record<string, string> = {
  interview: "interview",
  seed: "logline", premise: "logline",
  foundations: "foundations", pillar: "foundations", contract: "foundations", cast: "foundations",
  world: "foundations", games: "foundations", tentpole: "foundations", relationship: "foundations",
  structure: "structure", acts: "structure", beats: "structure", threads: "structure",
  scenes: "scenes",
  draft: "draft-scene", prose: "draft-scene", promises: "draft-scene",
};

export const suggestFocusMode = (objectiveKey: string | undefined): string | undefined =>
  objectiveKey ? RUNG_TO_MODE[objectiveKey] : undefined;

export function FocusChip({ mode, targetLabel, suggested, suggestedTarget, onSet, disabled }: {
  /** The DECLARED mode off the run row — the row is the source of truth, never local state, because the
   *  server self-clears a focus whose done() predicate fires and the chip must follow that. */
  mode: string | null;
  /** Handle of the target node, when the focus has one. */
  targetLabel?: string;
  /** What the journey's derived stage would suggest — offered, never auto-applied ("derived proposes,
   *  author disposes"). Shown only while nothing is declared. */
  suggested?: string;
  /** The node a suggested `draft-scene` would target (the next undrafted scene). */
  suggestedTarget?: string;
  /** `target` is the node the mode operates ON — distinct from the pinned tray, which the author owns
   *  and which survives every mode change (docs/agent-focus.md §3). */
  onSet: (mode: string | null, target?: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = focusModeMeta(mode);
  const hint = !active && suggested ? focusModeMeta(suggested) : undefined;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    // inline-flex (not block div): the chip pill below is itself a block-level flex box, so a plain
    // block wrapper forces the suggestion hint (rendered as its sibling further down) onto its own line
    // underneath instead of beside it.
    <div ref={ref} className="relative inline-flex shrink-0 items-center gap-1">
      <div
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
          active
            ? "border-[hsl(var(--pv-accent))]/40 bg-[hsl(var(--pv-accent))]/10 text-[hsl(var(--pv-accent))]"
            : "border-[hsl(var(--pv-border-soft))] text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-text-muted))]"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          className="flex items-center gap-1 disabled:opacity-50"
          title={active ? `Focus: ${active.label} — ${active.blurb}` : "Set what the agent should focus on"}
        >
          <Crosshair className="h-3 w-3" />
          <span className="max-w-[13ch] truncate">{active ? active.label : "Focus"}</span>
          {active && targetLabel && <span className="max-w-[14ch] truncate opacity-70">· {targetLabel}</span>}
          {!active && <ChevronDown className="h-3 w-3 opacity-60" />}
        </button>
        {/* Clearing is ALWAYS available — never disabled, even mid-turn. The author must be able to exit
            while the agent is running or wedged; the write lands on the next chain link and can't corrupt
            the turn in flight (docs/agent-focus.md §6). */}
        {active && (
          <button
            type="button"
            onClick={() => { onSet(null); setOpen(false); }}
            className="-mr-0.5 rounded-full p-0.5 hover:bg-[hsl(var(--pv-accent))]/20"
            title="Clear the focus (always available, even mid-turn)"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface))] p-1 shadow-lg">
          <p className="px-2 py-1.5 text-[10px] leading-snug text-[hsl(var(--pv-text-faint))]">
            What we're working on. An anchor for where the agent starts — it can still see and edit the whole book.
          </p>
          {ALL.map((m) => {
            const isActive = m.key === (mode ?? "wide");
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => { onSet(m.key === "wide" ? null : m.key); setOpen(false); }}
                className={`flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[hsl(var(--pv-surface-2))] ${
                  isActive ? "bg-[hsl(var(--pv-surface-2))]" : ""
                }`}
              >
                <Check className={`mt-0.5 h-3 w-3 shrink-0 ${isActive ? "text-[hsl(var(--pv-accent))]" : "opacity-0"}`} />
                <span className="min-w-0">
                  <span className="block text-[12px] text-[hsl(var(--pv-text))]">{m.label}</span>
                  <span className="block text-[10px] leading-snug text-[hsl(var(--pv-text-faint))]">{m.blurb}</span>
                  {m.target === "required" && (
                    <span className="block text-[10px] italic text-[hsl(var(--pv-text-faint))]">Pick this from a scene's row to set its target.</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* The derived suggestion — offered as a nudge while nothing is declared, never auto-applied.
          Reads as "Focus: Interview?" beside the chip, not a caption underneath it. */}
      {hint && !open && (
        <span className="flex items-center gap-1 text-[10px] text-[hsl(var(--pv-text-faint))]">
          :
          <button
            type="button"
            onClick={() => onSet(hint.key, hint.target === "none" ? null : suggestedTarget ?? null)}
            disabled={disabled}
            className="underline decoration-dotted underline-offset-2 hover:text-[hsl(var(--pv-accent))] disabled:opacity-50"
            title={hint.blurb}
          >
            {hint.label}?
          </button>
        </span>
      )}
    </div>
  );
}
