import { Check, Sparkles, BookOpen, Infinity as InfinityIcon } from "lucide-react";
import { UIFrame } from "../UIFrame";

/**
 * The Studio — the DNA tree, the ONE build/revise surface. Mirrors
 * apps/web/src/features/dna/pages/DnaTreePage.tsx + components/AgentRail.tsx:
 * a horizontal rung ladder (Idea → Foundations → Structure → Scenes → Prose,
 * from lib/dnaJourney.ts) as a full-width band, the book's spine/beats on the
 * left, and one always-on Agent thread on the right that proposes changes,
 * applies them, and auto-verifies each rendered scene against its plan.
 *
 * Paper-token translation of the real (dark) tree — faithful to the structure
 * and vocabulary, not a pixel copy. Pure server component — no client JS.
 */

type Rung = { label: string; frac: string; state: "done" | "active" };
const RUNGS: Rung[] = [
  { label: "Idea", frac: "2/2", state: "done" },
  { label: "Foundations", frac: "2/2", state: "done" },
  { label: "Structure", frac: "5/5", state: "done" },
  { label: "Scenes", frac: "24/24", state: "done" },
  { label: "Prose", frac: "11/24", state: "active" },
];

// A beat with its scene chips: filled = written, ring = planned, amber = stale.
const BEATS: Array<{ n: string; title: string; scenes: Array<"written" | "planned" | "stale"> }> = [
  { n: "B1", title: "The Lighthouse Keeper", scenes: ["written"] },
  { n: "B2", title: "Salvage", scenes: ["written", "stale"] },
  { n: "B3", title: "Across the Water", scenes: ["planned"] },
];

function Chip({ kind }: { kind: "written" | "planned" | "stale" }) {
  const base = "flex h-4 w-4 items-center justify-center rounded-[3px] text-[8px]";
  if (kind === "written")
    return <span className={`${base} bg-[hsl(var(--pv-accent))] text-[hsl(var(--pv-bg))]`}>✓</span>;
  if (kind === "stale")
    return <span className={`${base} bg-amber-500/85 text-[hsl(var(--pv-bg))]`}>●</span>;
  return <span className={`${base} border border-[hsl(var(--pv-text-faint))] text-[hsl(var(--pv-text-faint))]`} />;
}

function Rungs() {
  return (
    <div className="flex items-center gap-1.5 border-b border-[hsl(var(--pv-border-soft))] px-4 py-2.5">
      {RUNGS.map((r, i) => (
        <div key={r.label} className="flex min-w-0 items-center gap-1.5">
          <span className="flex items-center gap-1 whitespace-nowrap">
            {r.state === "done" ? (
              <Check className="h-2.5 w-2.5 shrink-0 text-[hsl(var(--pv-accent))]" />
            ) : (
              <span className="h-2 w-2 shrink-0 rounded-full border-[1.5px] border-amber-500" />
            )}
            <span
              className={`pv-mono text-[8.5px] uppercase tracking-[0.08em] ${
                r.state === "active" ? "text-amber-500" : "text-foreground"
              }`}
            >
              {r.label}
            </span>
            <span
              className={`pv-mono text-[8px] ${
                r.state === "active" ? "text-amber-500" : "text-[hsl(var(--pv-text-faint))]"
              }`}
            >
              {r.frac}
            </span>
          </span>
          {i < RUNGS.length - 1 && (
            <span className="h-px flex-1 bg-[hsl(var(--pv-border-soft))]" />
          )}
        </div>
      ))}
    </div>
  );
}

export function StudioMock() {
  return (
    <UIFrame crumb="Salt & Lamplight · DNA" bodyClassName="p-0">
      {/* the six-tab bar */}
      <div className="flex items-center gap-4 overflow-hidden border-b border-[hsl(var(--pv-border-soft))] px-4 py-2">
        {["Overview", "Tree", "Voice", "Analytics", "Characters", "Story"].map((t, i) => (
          <span
            key={t}
            className={`pv-mono whitespace-nowrap text-[9px] uppercase tracking-[0.12em] ${
              i === 1 ? "text-[hsl(var(--pv-accent))]" : "text-[hsl(var(--pv-text-faint))]"
            }`}
          >
            {t}
          </span>
        ))}
      </div>

      {/* the full-width rung ladder */}
      <Rungs />

      <div className="grid grid-cols-2">
        {/* ── The tree: the book's spine, act ▸ beat ▸ scene ── */}
        <div className="min-w-0 border-r border-border px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="pv-mono whitespace-nowrap text-[8px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-muted))]">
              Spine · Act ▸ Beat ▸ Scene
            </span>
          </div>
          <div className="pv-serif mt-0.5 text-[9px] italic text-[hsl(var(--pv-text-faint))]">
            90% complete · 13 need prose
          </div>
          <div className="pv-mono mt-2.5 pb-1.5 text-[8px] uppercase tracking-[0.1em] text-[hsl(var(--pv-accent))]">
            Act I · The Strait
          </div>

          <div className="space-y-1.5">
            {BEATS.map((b) => (
              <div
                key={b.n}
                className="rounded-md border border-[hsl(var(--pv-border-soft))] px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span className="pv-mono shrink-0 text-[8px] text-[hsl(var(--pv-text-faint))]">
                    {b.n}
                  </span>
                  <span className="min-w-0 truncate pv-serif text-[11px] text-foreground">
                    {b.title}
                  </span>
                  <span className="ml-auto flex shrink-0 gap-1">
                    {b.scenes.map((s, i) => (
                      <Chip key={i} kind={s} />
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── The Agent rail: one thread that builds and revises ── */}
        <div className="flex min-w-0 flex-col px-3.5 py-3">
          <div className="flex items-center gap-2 pb-2">
            <Sparkles className="h-3 w-3 shrink-0 text-[hsl(var(--pv-accent))]" />
            <span className="pv-mono text-[9px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-muted))]">
              Agent
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <span className="pv-mono inline-flex items-center gap-1 rounded-full border border-[hsl(var(--pv-accent))]/50 px-1.5 py-[1px] text-[8px] uppercase tracking-[0.08em] text-[hsl(var(--pv-accent))]">
                <InfinityIcon className="h-2.5 w-2.5" /> auto
              </span>
              <span className="pv-mono rounded-full bg-[hsl(var(--pv-surface-2))] px-1.5 py-[1px] text-[8px] uppercase tracking-[0.08em] text-[hsl(var(--pv-text-muted))]">
                deep
              </span>
            </span>
          </div>

          {/* an applied proposal */}
          <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/50 px-2.5 py-1.5">
            <Check className="h-3 w-3 shrink-0 text-[hsl(var(--pv-accent))]" />
            <span className="pv-mono shrink-0 text-[8px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-muted))]">
              Applied
            </span>
            <span className="min-w-0 truncate pv-serif text-[11px] text-foreground">
              Rewrite “Salvage” from scratch
            </span>
          </div>

          {/* the auto-verify line */}
          <div className="mt-2 flex items-start gap-1.5">
            <BookOpen className="mt-[1px] h-3 w-3 shrink-0 text-[hsl(var(--pv-text-faint))]" />
            <span className="pv-serif text-[11px] italic leading-snug text-[hsl(var(--pv-text-muted))]">
              Auto-verified the rendered scene against its plan.
            </span>
          </div>
          <p className="pv-serif mt-2 text-[11.5px] leading-snug text-foreground">
            Done — every axis passes: goal, outcome, value-shift, and Mara&apos;s
            vow all hold. The split across the beat&apos;s two scenes is correct.
          </p>

          {/* the next-step nudge */}
          <div className="mt-2.5 rounded-lg border border-[hsl(var(--pv-accent))]/40 bg-[hsl(var(--pv-accent))]/[0.05] px-3 py-2">
            <div className="pv-mono pb-0.5 text-[8px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">
              Next step · scene 12 of 24
            </div>
            <p className="pv-serif text-[11px] leading-snug text-foreground">
              Write “The rival keeper&apos;s lamp goes dark.”
            </p>
          </div>

          {/* the composer */}
          <div className="mt-2.5 flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
            <span className="min-w-0 truncate pv-serif text-[11px] italic text-[hsl(var(--pv-text-faint))]">
              Ask the agent, or / for commands…
            </span>
          </div>
        </div>
      </div>
    </UIFrame>
  );
}
