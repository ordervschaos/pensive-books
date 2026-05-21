import { Brief, computeCompletion, scopeSummary } from "@/lib/brief";

interface BookBriefSummaryProps {
  brief: Brief | null;
  onEdit: () => void;
}

export function BookBriefSummary({ brief, onEdit }: BookBriefSummaryProps) {
  const filled = computeCompletion(brief);
  const isEmpty = filled === 0;

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
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-[120px_1fr]">
          {rows.map((row) => (
            <SummaryRow key={row.label} label={row.label} value={row.value} />
          ))}
        </dl>
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
