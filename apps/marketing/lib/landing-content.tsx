import type { ComponentType } from "react";
import { StudioMock } from "@/components/landing/mocks/StudioMock";
import { CraftMock } from "@/components/landing/mocks/CraftMock";
import { EditorMock } from "@/components/landing/mocks/EditorMock";
import { EvaluationMock } from "@/components/landing/mocks/EvaluationMock";
import { ReviseMock } from "@/components/landing/mocks/ReviseMock";
import { PublishMock } from "@/components/landing/mocks/PublishMock";

// ───────────────────────────────────────────────────────────────────────────
// THE LANDING MANIFEST
//
// The landing page (`app/page.tsx`) is data-driven: it maps over the arrays
// below. To update the page when a feature ships, you edit data here — you
// almost never touch page.tsx.
//
//   • Spotlight feature  → add a LandingFeature (gets its own section + mock).
//   • Smaller feature     → add a LandingExtra (one line in the "and more" grid).
//
// See apps/marketing/LANDING.md for the step-by-step.
// ───────────────────────────────────────────────────────────────────────────

export interface LandingFeature {
  /** Stable slug; also used as the section's anchor id. */
  id: string;
  /** Mono uppercase kicker above the title. */
  eyebrow: string;
  /** Display headline (Instrument Serif). */
  title: string;
  /** One paragraph of body copy. */
  blurb: string;
  /** Optional supporting points rendered as an arrow list. */
  bullets?: string[];
  /** The mini-UI mock — a pure component from components/landing/mocks/. */
  mock: ComponentType;
}

export const LANDING_FEATURES: LandingFeature[] = [
  {
    id: "studio",
    eyebrow: "Build with AI",
    title: "One workbench for the whole book.",
    blurb:
      "The Studio is a single, calm surface — a Navigator with the build ladder and a live map of every page, an editor in the middle, and an always-on AI in the rail. You converse to generate and revise; it proposes, you review and apply. Think of it as a code editor, but for a novel.",
    bullets: [
      "Navigator, editor, and an always-on AI — in one view",
      "The AI proposes; nothing changes until you apply",
      "A live map of what's planned, drafted, and out of sync",
    ],
    mock: StudioMock,
  },
  {
    id: "craft",
    eyebrow: "The craft, layered",
    title: "It builds a book the way a novelist would.",
    blurb:
      "Not one giant prompt. Pensive settles the foundations first — the argument, the ending, a cast with a want, a wound, and a lie, the tentpole moments — then a one-paragraph spine, then a beat for every page. Only once the bones hold does it write the prose, in your book's voice.",
    bullets: [
      "Foundations: argument, ending, cast, tentpole moments, voice",
      "A spine and a page-by-page beat sheet — before any prose",
      "Pin what matters; the AI has to keep it",
    ],
    mock: CraftMock,
  },
  {
    id: "write",
    eyebrow: "Write & edit",
    title: "A calm editor that gets out of the way.",
    blurb:
      "Rich text without the clutter. Structure your book into chapters and pages, and write on a clean, readable surface that looks the way the published page will.",
    bullets: [
      "Distraction-free rich-text editing",
      "Chapters, sections, and pages",
      "Autosaves as you write",
    ],
    mock: EditorMock,
  },
  {
    id: "evaluate",
    eyebrow: "The editor's read",
    title: "An expert editor reads your whole book.",
    blurb:
      "Pensive assesses the manuscript the way a publishing editor would — a genre verdict, a letter grade, and prioritised, page-anchored notes. Then it can revise the flagged pages for you, saved as drafts you review before keeping.",
    bullets: [
      "A verdict, a grade, and a 'fix these first' list",
      "Notes anchored to the exact page",
      "One click to apply the notes as a revision",
    ],
    mock: EvaluationMock,
  },
  {
    id: "revise",
    eyebrow: "Revise by conversation",
    title: "Talk to your editor. It edits.",
    blurb:
      "Every layer — foundations, spine, beats, prose — has the same AI editor in the rail. Tell it what's wrong in plain language and it answers, then surfaces a reviewable proposal with a before-and-after diff. Apply it or discard it; you approve every change before it sticks.",
    bullets: [
      "One conversational editor across every layer",
      "Proposals arrive as a clear before → after diff",
      "Nothing is saved until you apply it",
    ],
    mock: ReviseMock,
  },
  {
    id: "publish",
    eyebrow: "Publish",
    title: "Ready to share? Flip one switch.",
    blurb:
      "No gatekeepers, no approval queue. Make a book public and it is instantly live in the public library — beautifully readable on any device, and downloadable as EPUB.",
    bullets: [
      "One toggle to go public",
      "Instantly listed in the library",
      "Readers get EPUB and send-to-Kindle",
    ],
    mock: PublishMock,
  },
];

export interface JourneyStep {
  /** Marketing voice — the title of this stage. */
  title: string;
  /** One line on what happens here. */
  blurb: string;
}

/**
 * The whole arc, start to shelf — the Studio's build ladder
 * (brief → foundations → spine → outline → beats → draft → read → publish),
 * shown as an at-a-glance staircase before the spotlight deep-dives. Mirrors
 * the steps in apps/web/src/components/book/studio/studioModel.ts.
 */
export const JOURNEY_STEPS: JourneyStep[] = [
  { title: "Create your book", blurb: "Start with a title and a blank shelf. That's all it takes to begin." },
  { title: "Brief the AI", blurb: "Tell Pensive what you're writing — premise, genre, length. Everything downstream is drawn from this." },
  { title: "Lay the foundations", blurb: "The bedrock: the argument, the ending, a cast with a want, wound, and lie, the tentpole moments, the voice. What you pin, the AI must keep." },
  { title: "Write the spine", blurb: "A single paragraph the whole book realizes — the throughline everything else hangs from." },
  { title: "Outline the chapters", blurb: "The chapters and pages as objectives — review, edit, and create them. Still no prose." },
  { title: "Plan the beats", blurb: "Walk the book page by page and plan the beat for each, before a single word of prose." },
  { title: "Draft the prose", blurb: "Render every page from its approved beats, in the book's voice, with live progress — or write any page yourself." },
  { title: "Read & revise", blurb: "An expert AI editor reads the whole manuscript; revise any layer by conversation. You approve every change." },
  { title: "Publish", blurb: "Flip one switch and your book is live in the public library — readable anywhere, downloadable as EPUB." },
];

export interface LandingExtra {
  title: string;
  blurb: string;
}

/** Smaller capabilities, shown as a compact grid below the spotlight sections. */
export const LANDING_EXTRAS: LandingExtra[] = [
  { title: "Scene images", blurb: "Character portraits and AI scene art, generated from your prose." },
  { title: "The book map", blurb: "See the whole book at a glance — what's planned, drafted, and out of sync." },
  { title: "Send to Kindle", blurb: "Push any book to your Kindle, or export EPUB." },
  { title: "Version control", blurb: "Snapshot versions, work in drafts, revert anytime." },
  { title: "Collaborate", blurb: "Invite co-authors and readers — as many as you want." },
  { title: "Themes", blurb: "Paper, coffee, or pumpkin — light or dark, your call." },
];
