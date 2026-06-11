// page-state.ts — the canonical per-page state object (edge / Deno copy).
//
// `pages.metadata` IS the state that dictates how the next page progresses: each page is a time-slice
// carrying the page's plan (objective, beat) plus the character ledger AS OF this page. The next
// page's prose context reads the most recent prior snapshot (buildUnitContext) so characters accrete
// what they know/feel/have/believe instead of resetting each chapter. The one axis that does NOT live
// here is the cross-page promise/payoff ledger — threads span many pages, so they live in their own
// table (book_threads), keyed by setup_page_id/payoff_page_id.
//
// The browser mirrors this shape in apps/web/src/lib/planProvenance.ts (PageMeta, aliased PageState):
// both runtimes hash and read the same metadata, so keep the two in sync.

// One character's state at a point in the story. want/wound are the stable arc poles; the rest change
// page-to-page. A full snapshot of every character is stamped onto each prose page after it's written.
export interface CharacterState {
  name: string;
  want?: string;       // external goal (stable across the book)
  wound?: string;      // internal flaw the arc resolves (stable)
  believes?: string;   // current conviction (changes)
  knows?: string[];    // facts currently held (changes)
  feels?: string;      // emotional state right now (changes)
  has?: string[];      // objects/resources/relationships (changes)
}

// Per-edge reconcile snapshot in the resolution ladder: hashes of both endpoints at last sync.
export interface EdgeHash { p: string; c: string }
export type EdgeName = "spine_objective" | "objective_beat" | "beat_prose";

// ── Deltas (pin-driven flow, docs/pinned_method.md §2) ───────────────────────
// A delta is what this page CHANGES in the narrative state. State-in for page n is never stored —
// it's the fold of deltas 1..n-1 (foldStateIn below). The character_ledger snapshot above remains
// one source among four delta types; deltas are the forward-looking contract authored at Beats time.
export type DeltaType = "character" | "thread" | "value" | "world";
export interface Delta {
  type: DeltaType;
  subject: string;       // character id/name, thread id, value name, world fact
  from?: string;         // human-readable state before (lintable against the fold)
  to: string;            // human-readable state after
  note?: string;
}
// planned_only = no prose yet · in_sync = extraction matches plan · drifted = prose diverged ·
// stale = upstream deltas changed since extraction.
export type DeltaSync = "planned_only" | "in_sync" | "drifted" | "stale";
export interface LintFlag { rule: string; severity: "warn" | "error"; message: string }

// The full shape of pages.metadata — author-only planning state, never shown to readers.
export interface PageState {
  objective?: string;                          // what this page must achieve
  beat?: string;                               // the page's one-paragraph plan (objective→beat rung)
  summary?: string;                            // 1-2 sentence "story so far" for later continuity
  character_states?: CharacterState[];         // full character ledger as of this page (the state axis)
  prose_src_hash?: string;                     // legacy: parent-only hash for the objective→prose edge
  sync?: Partial<Record<EdgeName, EdgeHash>>;  // both-endpoint reconcile snapshots, one per edge
  planned_delta?: Delta[];                     // authored at Beats stage (the page's contract)
  extracted_delta?: Delta[] | null;            // distilled from prose after it exists
  delta_sync?: DeltaSync;
  lint_flags?: LintFlag[];                     // server-side invariant check results
  pinned?: boolean;                            // author touched objective+beat → regeneration must hold it
}

// Fold the deltas of the given pages (reading order, pages 1..n-1) into the state ENTERING the next
// page: per delta type, subject → latest `to`. Prefers a page's extracted_delta (prose is truth once
// it exists) over its planned_delta. Pure + cheap (O(pages·deltas)); callers may memo by upstream
// delta hash if it ever shows up in a profile.
export function foldStateIn(
  pages: Array<Pick<PageState, "planned_delta" | "extracted_delta">>,
): Record<DeltaType, Record<string, string>> {
  const out: Record<DeltaType, Record<string, string>> = { character: {}, thread: {}, value: {}, world: {} };
  for (const p of pages) {
    const deltas = (p.extracted_delta?.length ? p.extracted_delta : p.planned_delta) ?? [];
    for (const d of deltas) {
      if (!d?.type || !d.subject || !(d.type in out)) continue;
      out[d.type][d.subject] = d.to;
    }
  }
  return out;
}
