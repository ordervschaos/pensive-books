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

// The full shape of pages.metadata — author-only planning state, never shown to readers.
export interface PageState {
  objective?: string;                          // what this page must achieve
  beat?: string;                               // the page's one-paragraph plan (objective→beat rung)
  summary?: string;                            // 1-2 sentence "story so far" for later continuity
  character_states?: CharacterState[];         // full character ledger as of this page (the state axis)
  prose_src_hash?: string;                     // legacy: parent-only hash for the objective→prose edge
  sync?: Partial<Record<EdgeName, EdgeHash>>;  // both-endpoint reconcile snapshots, one per edge
}
