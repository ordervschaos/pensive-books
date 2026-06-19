// bible.ts — typed shape for books.bible (jsonb).
//
// The bible is the book-level cross-cutting store for defaults that span every page:
//   - voice_sample: already used by generate-unit-core (the author's prose exemplar)
//   - facts: F3b continuity fact ledger ("do not contradict" rolling list)
//   - narration: F4a default POV/tense settings for the book
//
// Mirror of the edge copy exported from supabase/functions/_shared/generate-unit-core.ts.
// Keep the two in sync: identical field names and types.

export interface BibleFact { fact: string; page_index: number }
export interface BibleNarration {
  person?: "first" | "close-third" | "omniscient";
  tense?: "past" | "present";
  distance?: string;
}
export interface Bible {
  voice_sample?: string;
  facts?: BibleFact[];
  narration?: BibleNarration;
}
