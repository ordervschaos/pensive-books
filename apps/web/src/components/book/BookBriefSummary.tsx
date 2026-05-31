import { Fragment, useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { Brief, bandLabel, computeCompletion, scopeSummary } from "@/lib/brief";
import { cn } from "@/lib/utils";

interface BookBriefSummaryProps {
  brief: Brief | null;
  onEdit: () => void;
}

export function BookBriefSummary({ brief, onEdit }: BookBriefSummaryProps) {
  const filled = computeCompletion(brief);
  const isEmpty = filled === 0;
  const [open, setOpen] = useState(false);

  if (isEmpty) {
    return (
      <div className="mt-8 border-t border-border pt-6">
        <div className="pv-eyebrow">The brief</div>
        <p className="pv-serif mt-3 text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-muted))]">
          Not set yet — it’s what every AI tool here plans from: scaffold, drafts, and
          revisions all read it. About 90 seconds.
        </p>
        <button
          type="button"
          onClick={onEdit}
          className="pv-serif mt-3 text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
        >
          Set the brief →
        </button>
      </div>
    );
  }

  // Short headline — scope band + genre (e.g. "Novella · Poetry"). The word target
  // now lives in the hero, so it's intentionally not repeated here.
  const summary =
    [bandLabel(brief?.scope?.band), brief?.genre].filter(Boolean).join(" · ") || "Your brief";

  const rows: { label: string; value: string }[] = [];
  if (brief) {
    const scope = scopeSummary(brief.scope ?? undefined);
    if (scope) rows.push({ label: "Scope", value: scope });
    if (brief.genre) rows.push({ label: "Genre", value: brief.genre });
    if (brief.audience) rows.push({ label: "Audience", value: brief.audience });
    if (brief.premise) rows.push({ label: "Premise", value: brief.premise });
    if (brief.tone?.length) rows.push({ label: "Tone", value: brief.tone.join(" · ") });
    if (brief.success_criteria) rows.push({ label: "Success", value: brief.success_criteria });
  }

  return (
    <div className="mt-8 border-t border-border pt-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div>
          <div className="pv-eyebrow">The brief</div>
          <div className="pv-serif mt-1 text-[20px] leading-tight text-foreground">{summary}</div>
        </div>
        <div className="flex items-center gap-3 pt-1.5">
          <span className="flex items-center gap-1" aria-label={`${filled} of 6 filled`}>
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
          <ChevronDown
            className={cn(
              "h-4 w-4 text-[hsl(var(--pv-text-muted))] transition-transform",
              open && "rotate-180"
            )}
          />
        </div>
      </button>

      {open && (
        <dl className="mt-4 grid grid-cols-[96px_1fr] gap-x-6 gap-y-2.5">
          {rows.map((row) => (
            <Fragment key={row.label}>
              <dt className="pv-eyebrow pt-[2px]">{row.label}</dt>
              <dd className="pv-serif text-[15px] leading-relaxed text-foreground">{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="pv-eyebrow inline-flex items-center gap-1.5">
          <Lock className="h-3 w-3" /> Author only · {filled} of 6
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
        >
          Edit brief →
        </button>
      </div>
    </div>
  );
}
