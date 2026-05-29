import type { LandingFeature } from "@/lib/landing-content";

/** Renders one spotlight feature: copy on one side, mini-UI mock on the other,
 *  alternating sides on each successive section. */
export function FeatureSection({
  feature,
  index,
}: {
  feature: LandingFeature;
  index: number;
}) {
  const Mock = feature.mock;
  const flip = index % 2 === 1;

  return (
    <section
      id={feature.id}
      className="grid scroll-mt-24 items-center gap-10 md:grid-cols-2 md:gap-16"
    >
      <div className={flip ? "md:order-2" : undefined}>
        <div className="pv-eyebrow">{feature.eyebrow}</div>
        <h2 className="pv-display mt-4 text-[34px] font-normal leading-[1.08] tracking-tight text-foreground md:text-[40px]">
          {feature.title}
        </h2>
        <p className="pv-serif mt-4 max-w-[46ch] text-[17px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
          {feature.blurb}
        </p>
        {feature.bullets && (
          <ul className="mt-6 space-y-2.5">
            {feature.bullets.map((b) => (
              <li key={b} className="flex gap-3">
                <span className="pv-mono mt-1 text-[13px] text-[hsl(var(--pv-text-faint))]">
                  →
                </span>
                <span className="pv-serif text-[15px] leading-snug text-foreground">
                  {b}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={flip ? "md:order-1" : undefined}>
        <Mock />
      </div>
    </section>
  );
}
