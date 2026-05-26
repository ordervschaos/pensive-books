import { Brief, computeCompletion, scopeSummary } from "@/lib/brief";

interface BookBriefSummaryProps {
  brief: Brief | null;
  wordCount: number;
  onEdit: () => void;
}

export function BookBriefSummary({ brief, wordCount, onEdit }: BookBriefSummaryProps) {
  const filled = computeCompletion(brief);
  const isEmpty = filled === 0;

  const target = brief?.scope?.word_target ?? 0;
  const pct = target > 0 ? Math.round((wordCount / target) * 100) : 0;

  const rows: { label: string; value: string }[] = [];
  if (brief) {
    const scope = scopeSummary(brief.scope ?? undefined);
    if (scope) rows.push({ label: "Scope", value: scope });
    if (brief.genre) rows.push({ label: "Genre", value: brief.genre });
    if (brief.audience) rows.push({ label: "Audience", value: brief.audience });
    if (brief.premise) rows.push({ label: "Premise", value: brief.premise });
    if (brief.tone?.length) rows.push({ label: "Tone", value: brief.tone.join(" · ") });
    if (brief.success_criteria)
      rows.push({ label: "Success", value: brief.success_criteria });
  }

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="flex items-baseline justify-between gap-3">
        <div className="pv-eyebrow">
          The brief ·{" "}
          <span className="pv-serif text-[13px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-muted))]">
            {isEmpty ? "not set yet" : `${filled} of 6 filled`} · author only
          </span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
        >
          {isEmpty ? "Set it →" : "Edit →"}
        </button>
      </div>

      {isEmpty ? (
        <p className="pv-serif mt-3 max-w-[640px] text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-muted))]">
          A short scaffolding for yourself — genre, premise, tone, what done looks
          like. Never shown to readers. About 90 seconds.
        </p>
      ) : (
        <>
          {target > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="pv-eyebrow">Word target</span>
                <span className="pv-serif text-[13px] not-italic text-[hsl(var(--pv-text-muted))]">
                  {wordCount.toLocaleString()} / {target.toLocaleString()} · {pct}%
                </span>
              </div>
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--pv-border))]"
                role="progressbar"
                aria-valuenow={Math.min(100, pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress toward word target"
              >
                <div
                  className="h-full rounded-full bg-[hsl(var(--pv-accent))] transition-all"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>
          )}
          <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-[120px_1fr]">
            {rows.map((row) => (
              <SummaryRow key={row.label} label={row.label} value={row.value} />
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="pv-eyebrow pt-[2px]">{label}</dt>
      <dd className="pv-serif text-[15px] leading-relaxed text-foreground">
        {value}
      </dd>
    </>
  );
}
