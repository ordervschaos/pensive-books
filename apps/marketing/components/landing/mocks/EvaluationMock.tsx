import { UIFrame } from "../UIFrame";

/**
 * The editor's read — reproduces the real evaluation Report: an editorial
 * letter, the Genre/Stance definition list, a numbered "Fix these first" list,
 * the Apply / Revise action buttons, and section cards (one expanded with a
 * severity-coded issue, evidence, and a page link).
 * Mirrors apps/web/src/components/book/BookEvaluationSection.tsx.
 */
export function EvaluationMock() {
  return (
    <UIFrame crumb="Salt & Lamplight · the editor's read">
      {/* Eyebrow line, as in the app */}
      <div className="pv-eyebrow">
        The editor&apos;s read ·{" "}
        <span className="pv-serif text-[12px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-muted))]">
          AI feedback · author only
        </span>
      </div>

      {/* Editorial letter */}
      <p className="pv-serif mt-3 text-[14px] leading-relaxed text-foreground">
        Atmospheric and assured — the prose earns its quiet. The mystery&apos;s
        engine stalls in the middle third, where the stakes go soft and Mara
        watches more than she wants.
      </p>

      {/* Genre / Stance */}
      <dl className="mt-3 grid grid-cols-[64px_1fr] gap-x-5 gap-y-1.5">
        <dt className="pv-eyebrow pt-[2px]">Genre</dt>
        <dd className="pv-serif text-[13.5px] text-foreground">Literary mystery</dd>
        <dt className="pv-eyebrow pt-[2px]">Grade</dt>
        <dd className="pv-serif text-[13.5px] text-foreground">
          B+ · solid, publishable with revision
        </dd>
      </dl>

      {/* Fix these first */}
      <div className="mt-3.5">
        <div className="pv-eyebrow">Fix these first</div>
        <ol className="mt-1.5 list-decimal space-y-1 pl-5">
          <li className="pv-serif text-[13.5px] leading-snug text-foreground">
            Don&apos;t resolve the wreck in Chapter 5 — the mystery deflates.
          </li>
          <li className="pv-serif text-[13.5px] leading-snug text-foreground">
            Dramatise Mara&apos;s reason for staying; right now it&apos;s asserted.
          </li>
        </ol>
      </div>

      {/* Act on the notes */}
      <div className="mt-3.5 flex flex-wrap gap-2">
        <span className="pv-sans inline-flex items-center rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background">
          Apply the editor&apos;s notes
        </span>
        <span className="pv-sans inline-flex items-center rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-foreground">
          Revise structure
        </span>
      </div>

      {/* Section cards */}
      <div className="mt-3.5 space-y-1.5">
        <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--pv-border-soft))] px-3.5 py-2.5">
          <span className="pv-serif text-[14px] text-foreground">
            Opening &amp; hook
          </span>
          <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-accent))]">
            strong
          </span>
        </div>
        <div className="rounded-xl border border-[hsl(var(--pv-border-soft))]">
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="pv-serif text-[14px] text-foreground">
              Middle &amp; momentum
            </span>
            <span className="flex items-center gap-3">
              <span className="pv-mono text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-faint))]">
                2 notes
              </span>
              <span className="pv-serif text-[12px] italic text-amber-600 dark:text-amber-500">
                needs work
              </span>
            </span>
          </div>
          <div className="space-y-1.5 border-t border-[hsl(var(--pv-border-soft))] px-3.5 py-2.5">
            <p className="pv-serif text-[13px] leading-snug text-foreground">
              <span className="font-medium text-red-600 dark:text-red-400">
                ⚠ high
              </span>{" "}
              — Chapter 5 answers the central question 60 pages early.
            </p>
            <p className="pv-serif text-[12.5px] italic leading-snug text-[hsl(var(--pv-text-muted))]">
              “So the ship had never sailed at all,” she said, and that was that.
            </p>
            <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))] underline underline-offset-2">
              ↪ Chapter 5 · The Confession
            </span>
          </div>
        </div>
      </div>
    </UIFrame>
  );
}
