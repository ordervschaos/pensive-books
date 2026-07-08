import { Lock, Sparkles, Check } from "lucide-react";
import { UIFrame } from "../UIFrame";

/**
 * Import an existing manuscript — the semantic ascent. Drop in an EPUB and
 * Pensive reads the prose and *infers the plan above it*: premise, cast, world,
 * threads, a beat for every page. Your words are locked as user-truth and never
 * rewritten; only the plan rungs get filled in.
 *
 * Mirrors the "infer plan →" affordance in
 * apps/web/src/features/dna/components/tree/DecomposeButton.tsx and the
 * dnaDecompose run (premise → cast/world → chapter beats), landing live in the
 * DNA tree via its Realtime subscription.
 *
 * Pure server component — no client JS (the pulse is CSS-only).
 */

const INFERRED = [
  {
    kicker: "Premise",
    body: "A lighthouse keeper salvages a journal in her own hand whose pages keep coming true.",
    done: true,
  },
  {
    kicker: "Cast",
    body: "Mara Vane — wants to leave the island; let the last ship founder.",
    done: true,
  },
  {
    kicker: "Threads",
    body: "The rival keeper's dark lamp · the wreck the journal foretells",
    done: false,
  },
];

const PROSE = [
  "1 · The Lighthouse Keeper",
  "2 · Salvage",
  "3 · Across the Water",
];

export function ImportMock() {
  return (
    <UIFrame crumb="Salt & Lamplight · imported" bodyClassName="p-4">
      {/* the infer control + live progress, as in the tree chrome */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-[hsl(var(--pv-surface-2))] px-3 py-2">
        <span className="pv-serif text-[12px] text-[hsl(var(--pv-text-muted))]">
          Imported from EPUB · 9 chapters
        </span>
        <span className="flex items-center gap-2.5">
          <span className="pv-mono text-[10px] tracking-wide text-[hsl(var(--pv-accent))]">
            reading ch 3/9…
          </span>
          <span className="pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-accent))]">
            infer plan →
          </span>
        </span>
      </div>

      {/* THE PLAN — inferred above the prose */}
      <div className="mt-3.5 flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-[hsl(var(--pv-accent))]" />
        <span className="pv-mono text-[9px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-muted))]">
          The plan · inferred from your prose
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {INFERRED.map((r) => (
          <div
            key={r.kicker}
            className={`rounded-lg border px-3 py-2 ${
              r.done
                ? "border-[hsl(var(--pv-border-soft))]"
                : "animate-pulse border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-accent))]/[0.05]"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="pv-mono text-[9px] uppercase tracking-[0.14em] text-[hsl(var(--pv-accent))]">
                {r.kicker}
              </span>
              {r.done ? (
                <Check className="h-3 w-3 text-[hsl(var(--pv-accent))]" />
              ) : (
                <span className="pv-serif text-[10px] italic text-[hsl(var(--pv-text-faint))]">
                  inferring…
                </span>
              )}
            </div>
            <p className="pv-serif mt-0.5 text-[12.5px] leading-snug text-foreground">
              {r.body}
            </p>
          </div>
        ))}
      </div>

      {/* YOUR MANUSCRIPT — locked, never rewritten */}
      <div className="mt-3.5 flex items-center gap-1.5">
        <Lock className="h-3 w-3 text-[hsl(var(--pv-text-faint))]" />
        <span className="pv-mono text-[9px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-muted))]">
          Your manuscript · locked, word for word
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {PROSE.map((p) => (
          <div
            key={p}
            className="flex items-center gap-2 rounded-md border border-dashed border-[hsl(var(--pv-border-soft))] px-3 py-1.5"
          >
            <Lock className="h-3 w-3 shrink-0 text-[hsl(var(--pv-text-faint))]" />
            <span className="pv-serif truncate text-[12.5px] text-[hsl(var(--pv-text-muted))]">
              {p}
            </span>
          </div>
        ))}
      </div>
    </UIFrame>
  );
}
