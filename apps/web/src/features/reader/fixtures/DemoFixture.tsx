// DemoFixture — the pre-filled run behind /reader's "Load the pre-filled run" button.
//
// Lazy-loaded so both fixtures are their own chunk and never weigh on the main bundle.
//
// Two artifacts, produced by the two passes:
//   fourth-wing-ch1.json        P0 — segmentation + computed lenses (free)
//   fourth-wing-ch1-trace.json  P1 — the causal forward pass (one model call per window)
//
// Both are MEASUREMENTS, not the manuscript. P0's text is kept for the first 12 units only, ~5% of
// the chapter — per-unit truncation was tried and does not bound a corpus, because units are short
// so a 160-char clip left 76% of the chapter in the bundle. Retention scales with unit COUNT, not
// unit length, so the cap has to be structural. Regenerate both with:
//
//   npx tsx scripts/reader-machine.mts --epub sample-books/Fourth-Wing.epub --chapter 1 \
//     --fixture apps/web/src/features/reader/fixtures/fourth-wing-ch1.json
//   npx tsx scripts/reader-forward.mts --epub sample-books/Fourth-Wing.epub --chapter 1 \
//     --out apps/web/src/features/reader/fixtures/fourth-wing-ch1-trace.json
//
// The epub itself stays untracked (sample-books/ tracks only public-domain titles).
import raw from "./fourth-wing-ch1.json";
import trace from "./fourth-wing-ch1-trace.json";
import type { ChapterAnalysis } from "../lib/readerMachine";
import type { UnitDelta } from "../lib/brain";

interface Analysis extends ChapterAnalysis {
  title: string;
  author: string | null;
  chapterCount: number;
}

const fixture = raw as unknown as Omit<Analysis, "chapterCount"> & { chapters: number };
const deltas = (trace as unknown as { deltas?: UnitDelta[] }).deltas ?? [];

export default function DemoFixture({ render }: { render: (a: Analysis, d: UnitDelta[]) => JSX.Element }) {
  const { chapters, ...rest } = fixture;
  return render({ ...rest, chapterCount: chapters }, deltas);
}
