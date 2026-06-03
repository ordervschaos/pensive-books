import { useEffect, useRef, useState } from "react";

/**
 * A prominent "something is happening" indicator for long AI tasks.
 *
 * Two requirements drive the design:
 *  1. CONTEXTUAL — it narrates what the task is actually doing right now, so the
 *     caller passes a list of `phrases` (what an editor does, what a scan does,
 *     what a given revision does). We cycle through them with a soft crossfade.
 *  2. PROMINENT — earlier loading states were faint italic that dissolved into
 *     the page. This sits in an accent-tinted block with a sweeping bar and a
 *     pulsing dot, and the phrase itself is high-contrast `foreground` text.
 *
 * If the caller passes a single phrase (e.g. the build cascade's live phase),
 * it just shows that phrase — no cycling — but keeps the prominent chrome.
 */
export function WorkingIndicator({
  phrases,
  hint,
  intervalMs = 2600,
}: {
  phrases: readonly string[];
  /** Trailing aside, e.g. "~30–90s". Stays faint. */
  hint?: string;
  intervalMs?: number;
}) {
  const list = phrases.length ? phrases : ["Working"];
  const [i, setI] = useState(0);
  const [visible, setVisible] = useState(true);
  // Cycling is keyed on the joined list so a changing phrase set (e.g. the build
  // phase advancing) restarts cleanly rather than indexing into stale phrases.
  const key = list.join("|");
  const keyRef = useRef(key);
  if (keyRef.current !== key) {
    keyRef.current = key;
  }

  useEffect(() => {
    setI(0);
    setVisible(true);
    if (list.length < 2) return;
    const id = setInterval(() => {
      // fade out, swap, fade in
      setVisible(false);
      const t = setTimeout(() => {
        setI((n) => (n + 1) % list.length);
        setVisible(true);
      }, 280);
      return () => clearTimeout(t);
    }, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs]);

  return (
    <div
      className="mt-3 overflow-hidden rounded-xl border border-[hsl(var(--pv-accent))]/25 bg-[hsl(var(--pv-accent))]/[0.06]"
      role="status"
      aria-live="polite"
    >
      {/* sweeping bar — the unmistakable "running" signal */}
      <div className="relative h-[3px] w-full bg-[hsl(var(--pv-accent))]/10">
        <div className="animate-pv-sweep absolute inset-y-0 left-0 w-1/3 rounded-full bg-[hsl(var(--pv-accent))]/70" />
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[hsl(var(--pv-accent))]/60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[hsl(var(--pv-accent))]" />
        </span>
        <p className="min-w-0 flex-1">
          <span
            className={`pv-serif text-[15px] leading-snug text-foreground transition-opacity duration-300 ${
              visible ? "opacity-100" : "opacity-0"
            }`}
          >
            {list[i]}
          </span>
          {hint && (
            <span className="pv-serif ml-2 whitespace-nowrap text-[13px] italic text-[hsl(var(--pv-text-faint))]">
              {hint}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

/** Context-specific phrase sets — "what this task is doing right now". */
export const WORKING_PHRASES = {
  editor: [
    "Reading the opening pages",
    "Getting a feel for the voice",
    "Weighing the stakes",
    "Checking the genre contract",
    "Following the through-line",
    "Watching the pacing",
    "Testing where the tension slackens",
    "Marking the strongest passages",
    "Sorting the priorities",
    "Writing up the read",
  ],
  scan: [
    "Reading page by page",
    "Spotting promises and setups",
    "Noticing the foreshadowing",
    "Tracking the open loops",
    "Matching payoffs to their setups",
    "Measuring how far each thread runs",
    "Lining up the threads",
  ],
  planFromNotes: [
    "Taking in the editor's notes",
    "Mapping each note to a page",
    "Deciding what to rewrite",
    "Planning the new material",
    "Sequencing the changes",
    "Drafting the revision plan",
  ],
  planFromPrompt: [
    "Reading your instruction",
    "Studying the manuscript",
    "Finding the pages it touches",
    "Planning the changes",
    "Sequencing the work",
    "Drafting the revision plan",
  ],
} as const;
