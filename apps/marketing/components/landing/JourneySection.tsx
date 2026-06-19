import { JOURNEY_STEPS } from "@/lib/landing-content";

/**
 * The whole arc as a numbered staircase — mirrors the in-app "Build with AI" journey.
 * Pure static markup (a semantic ordered list) so it stays SSG and SEO-friendly.
 */
export function JourneySection() {
  return (
    <section id="how-it-works" className="scroll-mt-24 border-t border-border pt-14">
      <div className="pv-eyebrow">How it works</div>
      <h2 className="pv-display mt-4 max-w-[20ch] text-[32px] font-normal leading-[1.08] tracking-tight text-foreground md:text-[38px]">
        From an idea to a published book — the way a novelist works.
      </h2>
      <p className="pv-serif mt-4 max-w-[52ch] text-[17px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
        The Studio walks you down a build ladder — foundations, spine, beats,
        then prose — and each step only unlocks once the one above it holds. You
        stay the author the entire way.
      </p>

      <ol className="mt-12 max-w-[44rem]">
        {JOURNEY_STEPS.map((step, i) => (
          <li key={step.title} className="relative flex gap-5 pb-8 last:pb-0">
            {/* Connecting rail between the numbered nodes. */}
            {i < JOURNEY_STEPS.length - 1 && (
              <span
                aria-hidden
                className="absolute left-[17px] top-9 bottom-0 w-px bg-border"
              />
            )}
            <span
              className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold tabular-nums"
              style={{ boxShadow: "inset 0 0 0 1.5px hsl(var(--pv-accent))", color: "hsl(var(--pv-accent))" }}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <h3 className="pv-serif text-[19px] leading-snug text-foreground">{step.title}</h3>
              <p className="pv-serif mt-1 text-[15px] leading-snug text-[hsl(var(--pv-text-muted))]">
                {step.blurb}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
