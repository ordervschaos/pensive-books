import { useState } from "react";
import { ChevronDown, Pencil } from "lucide-react";
import { Brief, bandLabel, computeCompletion, scopeSummary } from "@/lib/brief";
import { cn } from "@/lib/utils";

interface BookBriefSummaryProps {
  brief: Brief | null;
  onEdit: () => void;
}

// Compact word-target for the one-line summary: 25,000 → "≈25k".
function approxWords(n?: number): string | null {
  if (!n) return null;
  return n >= 1000 ? `≈${Math.round(n / 1000)}k` : `≈${n}`;
}

export function BookBriefSummary({ brief, onEdit }: BookBriefSummaryProps) {
  const filled = computeCompletion(brief);
  const isEmpty = filled === 0;
  const [open, setOpen] = useState(false);

  // Unset → dashed strip that points at Edit Details (every AI tool plans from this).
  if (isEmpty) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-dashed border-[hsl(var(--pv-border))] bg-[hsl(var(--pv-surface))] px-5 py-3.5">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <span className="pv-eyebrow shrink-0">The brief</span>
          <span className="pv-serif max-w-[580px] text-[16px] leading-snug text-[hsl(var(--pv-text-muted))]">
            Not set yet — every AI tool plans from this: scaffold, drafts, and revisions all read it.
          </span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="pv-serif inline-flex shrink-0 items-center gap-2 rounded-full border border-[hsl(var(--pv-border))] bg-[hsl(var(--pv-surface))] px-4 py-2 text-[15px] text-foreground transition-colors hover:border-[hsl(var(--pv-accent))] hover:bg-[hsl(var(--pv-accent))]/5"
        >
          <Pencil className="h-3.5 w-3.5" /> Set the brief
        </button>
      </div>
    );
  }

  // One-line summary: scope band · ≈word-target · genre (e.g. "Novella · ≈25k · Poetry").
  const summary =
    [bandLabel(brief?.scope?.band), approxWords(brief?.scope?.word_target), brief?.genre]
      .filter(Boolean)
      .join(" · ") || "Your brief";
  const tones = brief?.tone?.length ? brief.tone.join(" · ") : null;

  const rows: { label: string; value: string; muted?: boolean; chips?: string[] }[] = [];
  if (brief) {
    const scope = scopeSummary(brief.scope ?? undefined);
    if (scope) rows.push({ label: "Scope", value: scope });
    if (brief.genre) rows.push({ label: "Genre", value: brief.genre });
    if (brief.audience) rows.push({ label: "Audience", value: brief.audience });
    if (brief.premise) rows.push({ label: "Premise", value: brief.premise, muted: true });
    if (brief.tone?.length) rows.push({ label: "Tone", value: "", chips: brief.tone });
    if (brief.success_criteria) rows.push({ label: "Success", value: brief.success_criteria });
  }

  return (
    <div className="rounded-[10px] border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface))] px-5 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <span className="pv-eyebrow shrink-0">The brief</span>
          <span className="pv-serif text-[20px] leading-tight tracking-tight text-foreground">
            {summary}
          </span>
          {tones && (
            <span className="pv-serif text-[16px] italic text-[hsl(var(--pv-text-muted))]">
              {tones}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span className="flex items-center gap-[3px]" aria-label={`${filled} of 6 filled`}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className={cn(
                  "inline-block h-[7px] w-[7px] rounded-full",
                  i < filled ? "bg-[hsl(var(--pv-text-muted))]" : "bg-[hsl(var(--pv-border))]"
                )}
              />
            ))}
          </span>
          <button
            type="button"
            onClick={onEdit}
            className="pv-serif group inline-flex items-center gap-1.5 text-[15px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
          >
            Edit
            <span className="not-italic transition-transform group-hover:translate-x-0.5">→</span>
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="pv-mono inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
          >
            {open ? "Hide" : "Details"}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[18px] border-t border-[hsl(var(--pv-border-soft))] pt-3.5">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-1">
              <span className="pv-eyebrow">{row.label}</span>
              {row.chips ? (
                <div className="flex flex-wrap gap-1.5">
                  {row.chips.map((c) => (
                    <span
                      key={c}
                      className="pv-serif rounded-full bg-[hsl(var(--pv-surface-2))] px-2.5 py-0.5 text-[14px] text-[hsl(var(--pv-text))]"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              ) : (
                <span
                  className={cn(
                    "pv-serif text-[16px] leading-snug",
                    row.muted ? "italic text-[hsl(var(--pv-text-muted))]" : "text-foreground"
                  )}
                >
                  {row.value}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
