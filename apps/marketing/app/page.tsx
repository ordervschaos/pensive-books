import type { Metadata } from "next";
import { getFeaturedBooks } from "@/lib/public-books";
import { getConfiguredAppOrigin } from "@/lib/pensive";
import { FeaturedBooksCarousel } from "@/components/FeaturedBooksCarousel";
import { FeatureSection } from "@/components/landing/FeatureSection";
import { JourneySection } from "@/components/landing/JourneySection";
import { LANDING_FEATURES, LANDING_EXTRAS } from "@/lib/landing-content";

export const metadata: Metadata = {
  title: "Pensive — an AI studio for writing whole books",
  description:
    "A calm studio for writing whole books with AI. Lay the foundations, structure, and scenes, draft the prose, then revise by conversation and publish to the public library in a click.",
  openGraph: {
    title: "Pensive — an AI studio for writing whole books",
    description:
      "Build a book the way a novelist would — foundations, structure, scenes, then prose — with an always-on AI agent. Revise by conversation and publish in a click.",
    images: ["/og-image.png"],
  },
};

const primaryCta =
  "pv-sans inline-flex items-center rounded-md bg-foreground px-6 py-3 text-[15px] font-medium text-[hsl(var(--pv-bg))] transition-opacity hover:opacity-90";
const textLink =
  "pv-serif border-b border-foreground pb-px text-[16px] text-foreground transition-opacity hover:opacity-70";

export default async function HomePage() {
  const appOrigin = getConfiguredAppOrigin();
  const featuredBooks = await getFeaturedBooks();

  return (
    <main className="mx-auto max-w-[1140px] overflow-x-hidden px-6 pb-28 md:px-12">
      {/* Hero */}
      <section className="pt-16 md:pt-24">
        <div className="pv-eyebrow">Foundations · Structure · Prose</div>
        <h1 className="pv-display mt-5 max-w-[15ch] text-[clamp(40px,9vw,84px)] font-normal leading-[0.98] tracking-tight text-foreground">
          Write a whole book, <em>start to shelf.</em>
        </h1>
        <p className="pv-serif mt-6 max-w-[54ch] text-[19px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
          Pensive is a calm studio for writing whole books with AI. Build it the
          way a novelist would — foundations, structure, scenes, then prose — with
          an always-on agent you talk to. Revise by conversation, then publish to
          the public library in a click.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
          <a href={`${appOrigin}/auth`} className={primaryCta}>
            Start writing — it&apos;s free
          </a>
          <a href="/library" className={textLink}>
            Browse the library →
          </a>
        </div>
      </section>

      {/* Featured books — real data from the library */}
      {featuredBooks.length > 0 && (
        <section className="mt-20 md:mt-28">
          <div className="mb-7 flex items-baseline justify-between">
            <h2 className="pv-display text-[28px] italic tracking-tight text-foreground md:text-[30px]">
              Lately, on Pensive
            </h2>
            <a href="/library" className="pv-eyebrow hover:text-foreground">
              the whole library →
            </a>
          </div>
          <FeaturedBooksCarousel books={featuredBooks} />
        </section>
      )}

      {/* How it works — the whole seven-step arc as a staircase */}
      <div className="mt-24 md:mt-32">
        <JourneySection />
      </div>

      {/* Spotlight features — driven entirely by LANDING_FEATURES */}
      <div className="mt-24 space-y-24 md:mt-32 md:space-y-32">
        {LANDING_FEATURES.map((feature, index) => (
          <FeatureSection key={feature.id} feature={feature} index={index} />
        ))}
      </div>

      {/* And more — the smaller capabilities */}
      <section className="mt-24 border-t border-border pt-14 md:mt-32">
        <div className="pv-eyebrow">And more</div>
        <h2 className="pv-display mt-4 max-w-[18ch] text-[32px] font-normal leading-[1.08] tracking-tight text-foreground md:text-[38px]">
          Everything a book needs after the first draft.
        </h2>
        <div className="mt-10 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
          {LANDING_EXTRAS.map((item) => (
            <div key={item.title}>
              <h3 className="pv-serif text-[17px] font-medium leading-snug text-foreground">
                {item.title}
              </h3>
              <p className="pv-serif mt-1.5 text-[14px] leading-snug text-[hsl(var(--pv-text-muted))]">
                {item.blurb}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* The manual */}
      <section className="mt-24 flex flex-col items-start justify-between gap-5 rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))] p-9 md:mt-32 md:flex-row md:items-center md:p-12">
        <div>
          <div className="pv-eyebrow">Want the full tour?</div>
          <h3 className="pv-display mt-2.5 text-[26px] italic leading-tight text-foreground md:text-[30px]">
            Read the Pensive manual — written on Pensive.
          </h3>
        </div>
        <a
          href="/library/books/658-the-pensive-manual"
          className="pv-serif whitespace-nowrap border-b border-foreground pb-px text-[16px] text-foreground transition-opacity hover:opacity-70"
        >
          Open the manual →
        </a>
      </section>

      {/* Closing CTA */}
      <section className="mt-24 text-center md:mt-32">
        <div className="pv-eyebrow">From a blank page to a finished book</div>
        <h2 className="pv-display mx-auto mt-4 max-w-[18ch] text-[36px] font-normal leading-[1.05] tracking-tight text-foreground md:text-[48px]">
          Your next book starts with a sentence.
        </h2>
        <p className="pv-serif mx-auto mt-5 max-w-[52ch] text-[17px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
          Lay the foundations, plan the beats, draft the prose — with an AI agent
          in the rail the whole way. Then publish when you&apos;re ready. No setup,
          no gatekeepers.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
          <a href={`${appOrigin}/auth`} className={primaryCta}>
            Start writing — it&apos;s free
          </a>
          <a href="/library" className={textLink}>
            Browse the library →
          </a>
        </div>
      </section>
    </main>
  );
}
