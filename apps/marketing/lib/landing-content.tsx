import type { ComponentType } from "react";
import { StudioMock } from "@/components/landing/mocks/StudioMock";
import { CraftMock } from "@/components/landing/mocks/CraftMock";
import { ImportMock } from "@/components/landing/mocks/ImportMock";
import { EditorMock } from "@/components/landing/mocks/EditorMock";
import { EvaluationMock } from "@/components/landing/mocks/EvaluationMock";
import { MetersMock } from "@/components/landing/mocks/MetersMock";
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
    title: "One tree for the whole book.",
    blurb:
      "The Studio is a single surface: your book as a living tree — idea, foundations, structure, scenes, prose — with a rung ladder tracking what holds and what's left, and one always-on Agent in the rail. You converse to build and revise; it proposes, applies, and auto-verifies each scene against its plan. Think of it as a code editor, but for a novel.",
    bullets: [
      "Your whole book as one tree — every layer in one view",
      "One Agent builds and revises; it proposes, you approve",
      "A rung ladder shows what's planned, drafted, and out of sync",
    ],
    mock: StudioMock,
  },
  {
    id: "craft",
    eyebrow: "The craft, layered",
    title: "It builds a book the way a novelist would.",
    blurb:
      "Not one giant prompt. Pensive settles the foundations first — the controlling idea, the ending, a cast with a want, a wound, and a lie, the tentpole moments — then the structure: acts and their causal beats, page by page, then a scene for each. Only once the bones hold does it write the prose, in your book's voice.",
    bullets: [
      "Foundations: controlling idea, ending, cast, tentpole moments, voice",
      "Structure: acts, causal beats, and a scene for each — before any prose",
      "Pin what matters; the AI has to keep it",
    ],
    mock: CraftMock,
  },
  {
    id: "import",
    eyebrow: "Already have a draft?",
    title: "Import a manuscript. Pensive infers the plan.",
    blurb:
      "Drop in an EPUB and Pensive reads the prose, then builds the whole plan above it — premise, cast, world, threads, and a beat for every page. Your words are locked as source of truth and never rewritten; you get the living plan you'd have gotten if you'd built it here, so you can revise structurally from day one.",
    bullets: [
      "Bring an existing book in as an EPUB",
      "The AI infers premise, cast, threads, and every beat from your prose",
      "Your words stay locked, word for word — only the plan is inferred",
    ],
    mock: ImportMock,
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
    id: "meters",
    eyebrow: "The shape of your story",
    title: "See the emotional shape of your book.",
    blurb:
      "Track the axes that matter — tension, heat, comedy, a game-score — as lines over the whole book. The solid line is the plan; run the editor's read and a dotted line shows what the prose actually delivers, so a slack middle or a climax that never lands is something you can see, not just feel.",
    bullets: [
      "Plot tension, heat, comedy, or any axis across every beat",
      "Solid line = the plan; dotted line = what the prose delivers",
      "Send the gaps straight to the AI editor to close",
    ],
    mock: MetersMock,
  },
  {
    id: "revise",
    eyebrow: "Revise by conversation",
    title: "Talk to the agent. It edits.",
    blurb:
      "The same Agent that builds your book also revises it — every node in the tree, from the premise down to a line of prose. Tell it what's wrong in plain language and it answers, then surfaces a reviewable proposal with a before-and-after diff. Apply it or discard it; you approve every change before it sticks.",
    bullets: [
      "One agent across every layer — no separate tools",
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
 * The whole arc, start to shelf — the DNA tree's build ladder. The five real
 * rungs (Idea → Foundations → Structure → Scenes → Prose) bracketed by the
 * brief that feeds them and the read/revise/publish that follows. Mirrors the
 * rung captions in apps/web/src/features/dna/lib/dnaJourney.ts.
 */
export const JOURNEY_STEPS: JourneyStep[] = [
  { title: "Create your book", blurb: "Start with a title and a blank shelf. That's all it takes to begin." },
  { title: "Brief the AI", blurb: "Tell Pensive what you're writing — premise, genre, length, tone, heat. Every layer below is drawn from this." },
  { title: "Idea", blurb: "A polished logline and the dramatic question the book answers, derived from your brief — the lowest-resolution contract." },
  { title: "Foundations", blurb: "The bedrock: the controlling idea, the ending, a cast with a want, wound, and lie, the world, the tentpole moments. What you pin, the AI must keep." },
  { title: "Structure", blurb: "The acts and their causal beats — the spine, page by page. Each beat earns the one before it." },
  { title: "Scenes", blurb: "Every beat broken into dramatized scenes — each one turns a value, no flat 'and-then'." },
  { title: "Prose", blurb: "Render each approved scene in the book's voice, with live progress — or write any scene yourself." },
  { title: "Read & revise", blurb: "The agent auto-verifies each scene against its plan; talk to it to revise any node. You approve every change." },
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
