// planGraph — the read-model behind the Resolution Map (the multi-resolution outline's completeness
// chart). See docs/multiresolution-outline.md.
//
// The book is a ladder of resolution layers, top owned by the author, the rest co-drafted with AI:
//
//   brief → book spine → page objective → beat → prose
//
// A node at any layer is in one of three states:
//   gap     — empty (no content)
//   drift   — has content, but out of sync with its parent (the parent changed since they last
//             reconciled) — detected with content hashes (see planProvenance.isProseStale)
//   synced  — has content and agrees with its parent
//
// The book is "complete" only when every node is filled and every edge is in sync — no gaps, no
// drift, top to bottom. This module turns the raw book + pages into that grid; the Map only renders.
//
// NOTE (Step 1 — model + read-only map): only the prose↔objective edge has hash provenance today
// (Phase 1's prose_src_hash). The spine and beat layers exist but nothing generates them yet, so they
// read as gaps; the other edges have no recorded hashes so they default to "synced" (we never badge
// what we didn't generate). Drift on those edges lights up as each transform lands and starts
// stamping both-endpoint hashes.
import { isEdgeStale, isProseStale, type PageMeta } from "@/lib/planProvenance";

export type CellState = "gap" | "drift" | "synced";

export type Layer = "objective" | "beat" | "prose";

export interface MapPage {
  id: number;
  title: string | null;
  pageType: "text" | "section";
  objective: CellState;
  beat: CellState;
  prose: CellState;
}

export interface MapModel {
  brief: CellState;
  spine: CellState;
  pages: MapPage[]; // section pages included, as group headers (their cells aren't counted)
  totals: { gaps: number; drift: number; cells: number; filled: number };
  complete: boolean;
}

function filled(text: string | null | undefined): boolean {
  return !!(text && String(text).trim());
}

export interface RawPage {
  id: number;
  title: string | null;
  pageType: "text" | "section";
  metadata: PageMeta | null;
  proseText: string; // body text excluding the title heading ("" = no prose)
}

/** Build the Resolution Map read-model from the book's layers. Pure — caller fetches, this derives. */
export function buildMap(input: {
  briefFilled: boolean;
  spineText: string | null | undefined;
  spineStale?: boolean; // spine present but its source brief has changed since
  pages: RawPage[];
}): MapModel {
  const brief: CellState = input.briefFilled ? "synced" : "gap";
  const spine: CellState = !filled(input.spineText) ? "gap" : input.spineStale ? "drift" : "synced";

  // A filled node is "drift" when its incoming (parent→me) edge is stale, else "synced".
  const cell = (text: string | null | undefined, stale: boolean): CellState =>
    !filled(text) ? "gap" : stale ? "drift" : "synced";

  const pages: MapPage[] = input.pages.map((p) => {
    // Section pages are structural dividers (under the single-spine model they carry no objective of
    // their own); they head a group of text pages and contribute no countable cells.
    if (p.pageType === "section") {
      return { id: p.id, title: p.title, pageType: "section", objective: "synced", beat: "synced", prose: "synced" };
    }
    const m = p.metadata;
    const objective = cell(m?.objective, isEdgeStale(input.spineText, m?.objective, m?.sync?.spine_objective));
    const beat = cell(m?.beat, isEdgeStale(m?.objective, m?.beat, m?.sync?.objective_beat));
    const prose = cell(p.proseText, isProseStale(m, true));
    return { id: p.id, title: p.title, pageType: "text", objective, beat, prose };
  });

  let gaps = 0, drift = 0, cells = 0, filledCount = 0;
  const tally = (s: CellState) => {
    cells++;
    if (s === "gap") gaps++;
    else { filledCount++; if (s === "drift") drift++; }
  };
  tally(brief);
  tally(spine);
  for (const p of pages) {
    if (p.pageType !== "text") continue;
    tally(p.objective);
    tally(p.beat);
    tally(p.prose);
  }

  return { brief, spine, pages, totals: { gaps, drift, cells, filled: filledCount }, complete: gaps === 0 && drift === 0 };
}
