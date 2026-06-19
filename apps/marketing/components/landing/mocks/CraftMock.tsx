import { UIFrame } from "../UIFrame";

/**
 * The craft ladder — what Pensive settles before a word of prose:
 * Foundations (argument · ending · cast with want·wound·lie · tentpole moments)
 * → Spine (the one-paragraph throughline) → Beats (the page-by-page plan).
 *
 * Mirrors the foundations artifact in apps/web/src/lib/foundations.ts
 * (FNode / CastMember.{want,wound,lie} / Tentpole) and the spine + beat layers
 * surfaced in the studio's FoundationsStep / SpineStep / BeatsStep.
 *
 * Pure server component — a labelled vertical ladder, no client JS.
 */

const CAST = [
  { field: "want", text: "To leave the island for good" },
  { field: "wound", text: "She let the last ship founder" },
  { field: "lie", text: "Penance is the same as duty" },
];

const BEATS = [
  { page: "Salvage", beat: "Mara hauls a sea-chest from the rocks; inside, a journal in her own hand she never wrote." },
  { page: "Across the Water", beat: "The rival keeper’s lamp goes dark — and Mara realises someone is reading the same pages." },
];

function Tier({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative pl-6">
      {/* the connecting rail + node */}
      <span className="absolute left-[5px] top-2 h-2.5 w-2.5 rounded-full border-[2px] border-[hsl(var(--pv-accent))] bg-background" />
      <div className="pv-mono text-[9px] uppercase tracking-[0.16em] text-[hsl(var(--pv-accent))]">
        {kicker}
      </div>
      <div className="pv-serif mt-0.5 text-[14px] font-semibold text-foreground">{title}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function CraftMock() {
  return (
    <UIFrame crumb="Salt & Lamplight · foundations">
      <div className="relative space-y-5">
        {/* the continuous rail behind the nodes */}
        <span
          aria-hidden
          className="absolute left-[10px] top-2 bottom-2 w-px bg-[hsl(var(--pv-border-soft))]"
        />

        <Tier kicker="Foundations" title="The bedrock the AI must keep">
          <dl className="grid grid-cols-[58px_1fr] gap-x-3 gap-y-1">
            <dt className="pv-eyebrow pt-[2px]">Argument</dt>
            <dd className="pv-serif text-[12.5px] leading-snug text-foreground">
              Some truths are kinder left drowned.
            </dd>
            <dt className="pv-eyebrow pt-[2px]">Ending</dt>
            <dd className="pv-serif text-[12.5px] leading-snug text-foreground">
              Mara burns the journal, keeps the lamp lit.
            </dd>
          </dl>

          <div className="mt-2 rounded-lg border border-border bg-background px-3 py-2">
            <div className="pv-serif text-[12.5px] font-medium text-foreground">
              Mara Vane{" "}
              <span className="pv-mono text-[9px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">
                protagonist
              </span>
            </div>
            <div className="mt-1 space-y-0.5">
              {CAST.map((c) => (
                <div key={c.field} className="flex gap-2">
                  <span className="pv-mono w-12 shrink-0 text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">
                    {c.field}
                  </span>
                  <span className="pv-serif text-[12px] leading-snug text-[hsl(var(--pv-text-muted))]">
                    {c.text}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="pv-serif mt-2 text-[12px] leading-snug text-foreground">
            <span className="text-[hsl(var(--pv-accent))]">◆</span> Tentpole — the
            rival keeper&apos;s lamp goes dark.
          </p>
        </Tier>

        <Tier kicker="Spine" title="The one-paragraph throughline">
          <p className="pv-serif text-[12.5px] leading-snug text-[hsl(var(--pv-text-muted))]">
            A lighthouse keeper salvages a journal in her own handwriting and,
            page by page, must decide whether to live the life it predicts — or
            burn it before the wreck it foretells reaches her shore.
          </p>
        </Tier>

        <Tier kicker="Beats" title="The page-by-page plan, before any prose">
          <div className="space-y-1.5">
            {BEATS.map((b) => (
              <div key={b.page} className="rounded-lg border border-[hsl(var(--pv-border-soft))] px-3 py-2">
                <div className="pv-mono text-[9px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">
                  {b.page}
                </div>
                <p className="pv-serif mt-0.5 text-[12px] leading-snug text-foreground">
                  {b.beat}
                </p>
              </div>
            ))}
          </div>
        </Tier>
      </div>
    </UIFrame>
  );
}
