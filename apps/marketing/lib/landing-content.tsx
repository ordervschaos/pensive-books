import type { ComponentType } from "react";
import { GenerateMock } from "@/components/landing/mocks/GenerateMock";
import { EditorMock } from "@/components/landing/mocks/EditorMock";
import { EvaluationMock } from "@/components/landing/mocks/EvaluationMock";
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
    id: "generate",
    eyebrow: "Start from an idea",
    title: "Set a brief. Get a finished draft.",
    blurb:
      "Tell Pensive what you're writing — premise, genre, length — and it drafts the structure: chapters, each page with its own objective. Then it writes the prose for every page, tracking progress as the whole book fills in. You stay the author; it does the heavy lifting.",
    bullets: [
      "Start with a brief: premise, genre, length",
      "A scaffold of chapters, an objective per page",
      "Writes the entire book — with live progress",
    ],
    mock: GenerateMock,
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

export interface LandingExtra {
  title: string;
  blurb: string;
}

/** Smaller capabilities, shown as a compact grid below the spotlight sections. */
export const LANDING_EXTRAS: LandingExtra[] = [
  { title: "Send to Kindle", blurb: "Push any book to your Kindle, or export EPUB." },
  { title: "Version control", blurb: "Snapshot versions, work in drafts, revert anytime." },
  { title: "Collaborate", blurb: "Invite co-authors and readers — as many as you want." },
  { title: "Story bible", blurb: "Keep characters and world consistent as the book grows." },
  { title: "Themes", blurb: "Paper, coffee, or pumpkin — light or dark, your call." },
];
