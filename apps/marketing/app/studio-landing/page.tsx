import type { Metadata } from "next";
import { getConfiguredAppOrigin } from "@/lib/pensive";
import { FeatureSection } from "@/components/landing/FeatureSection";
import { JourneySection } from "@/components/landing/JourneySection";
import { StudioMock } from "@/components/landing/mocks/StudioMock";
import { LANDING_FEATURES } from "@/lib/landing-content";

export const metadata: Metadata = {
  title: "Pensive Studio — direct a whole book with AI",
  description:
    "Give the AI a DNA to grow from — foundations, structure, scenes, prose — and direct the generation. One tree, one always-on agent, every change reviewable before it sticks.",
  openGraph: {
    title: "Pensive Studio — direct a whole book with AI",
    description:
      "Give the AI a DNA to grow from and direct the generation. One tree, one always-on agent, every change reviewable before it sticks.",
    images: ["/og-image.png"],
  },
};

const primaryCta =
  "pv-sans inline-flex items-center rounded-md bg-foreground px-6 py-3 text-[15px] font-medium text-[hsl(var(--pv-bg))] transition-opacity hover:opacity-90";
const textLink =
  "pv-serif border-b border-foreground pb-px text-[16px] text-foreground transition-opacity hover:opacity-70";

// The AI-writing path, not the whole Pensive product: skip "write" (the manual
// editor is Writing-pillar, not Studio) and keep everything Studio-relevant.
const STUDIO_FEATURE_IDS = ["studio", "craft", "import", "meters", "revise", "publish"];
const studioFeatures = LANDING_FEATURES.filter((f) => STUDIO_FEATURE_IDS.includes(f.id));

export default function StudioLandingPage() {
  const appOrigin = getConfiguredAppOrigin();

  return (
    <main className="mx-auto max-w-[1140px] overflow-x-hidden px-6 pb-28 md:px-12">
      {/* Hero */}
      <section className="grid items-center gap-10 pt-16 md:grid-cols-2 md:gap-16 md:pt-24">
        <div>
          <div className="pv-eyebrow">Pensive Studio</div>
          <h1 className="pv-display mt-5 max-w-[14ch] text-[clamp(38px,7.5vw,68px)] font-normal leading-[1.02] tracking-tight text-foreground">
            Direct a whole book with AI.
          </h1>
          <p className="pv-serif mt-6 max-w-[46ch] text-[18px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
            Give it a DNA — a controlling idea, a cast, a spine of causal
            beats — and Studio grows the book from that tree, rung by rung, to
            finished prose. You work four verbs: expand, choose, edit, lock.
            The AI does the heavy lifting, and nothing sticks without your say.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
            <a href={`${appOrigin}/auth?returnTo=/studio/new`} className={primaryCta}>
              Start your Studio book — it&apos;s free
            </a>
            <a href="/library" className={textLink}>
              Read what it&apos;s made →
            </a>
          </div>
        </div>
        <div>
          <StudioMock />
        </div>
      </section>

      {/* How it works — the build ladder */}
      <div className="mt-24 md:mt-32">
        <JourneySection />
      </div>

      {/* Spotlight features — the Studio-relevant subset of the main manifest */}
      <div className="mt-24 space-y-24 md:mt-32 md:space-y-32">
        {studioFeatures.map((feature, index) => (
          <FeatureSection key={feature.id} feature={feature} index={index} />
        ))}
      </div>

      {/* Closing CTA */}
      <section className="mt-24 text-center md:mt-32">
        <div className="pv-eyebrow">One tree. One agent. Your call, always.</div>
        <h2 className="pv-display mx-auto mt-4 max-w-[18ch] text-[36px] font-normal leading-[1.05] tracking-tight text-foreground md:text-[48px]">
          Grow your next book from a DNA.
        </h2>
        <p className="pv-serif mx-auto mt-5 max-w-[52ch] text-[17px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
          Start with a premise. Studio builds the foundations, the structure,
          the scenes, then the prose — always in reviewable steps, never a
          giant unaccountable dump of text.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
          <a href={`${appOrigin}/auth?returnTo=/studio/new`} className={primaryCta}>
            Start your Studio book — it&apos;s free
          </a>
          <a href="/library" className={textLink}>
            Browse the library →
          </a>
        </div>
      </section>
    </main>
  );
}
