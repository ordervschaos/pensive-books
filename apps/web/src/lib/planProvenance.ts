// Plan↔prose dirty-graph: provenance + staleness (Phase 1 of the multi-resolution outline).
// See docs/multiresolution-outline.md. A page's prose is "stale" when the objective it was
// generated from has since changed. We detect this with a content hash: when prose is written we
// stamp metadata.prose_src_hash = metaHash(objective); a page is stale iff that no longer matches
// the current objective's hash.
//
// metaHash MUST stay byte-for-byte identical to the edge copy in
// supabase/functions/_shared/plan-provenance.ts — the same page is hashed in both runtimes.
import { supabase } from "@/integrations/supabase/client";

// Normalize before hashing so whitespace/formatting noise doesn't flap the hash.
function normalize(text: string | null | undefined): string {
  return String(text ?? "").trim().replace(/\s+/g, " ");
}

// cyrb53 — a tiny, fast, non-crypto 53-bit hash. Pure JS (Math.imul is in every JS runtime), so
// browser and Deno produce the same digest. Hex string keeps it compact in JSONB.
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Stable hash of a plan text (objective/beat), used as provenance for what was generated from it. */
export function metaHash(text: string | null | undefined): string {
  return cyrb53(normalize(text)).toString(16);
}

// Per-edge reconcile snapshot: the hashes of BOTH endpoints the last time this edge was synced.
// An edge is stale when either side has changed since — which is what makes drift detectable in both
// directions (parent edited → regenerate child downward; child edited → re-distill parent upward).
export interface EdgeHash {
  p: string; // hash of the parent text at last reconcile
  c: string; // hash of the child text at last reconcile
}

// Edge names in the resolution ladder (stored under metadata.sync). Each names a parent→child pair.
export type EdgeName = "spine_objective" | "objective_beat" | "beat_prose";

// One character's state at a point in the story (the state axis). Mirrors CharacterState in the edge
// copy, supabase/functions/_shared/page-state.ts. want/wound are stable arc poles; the rest change.
export interface CharacterState {
  name: string;
  want?: string;
  wound?: string;
  believes?: string;
  knows?: string[];
  feels?: string;
  has?: string[];
}

// ── Deltas (pin-driven flow, docs/pinned_method.md §2) ───────────────────────
// Mirrors the edge copy in supabase/functions/_shared/page-state.ts — keep in sync.
export type DeltaType = "character" | "thread" | "value" | "world";
export interface Delta {
  type: DeltaType;
  subject: string; // character id/name, thread id, value name, world fact
  from?: string;
  to: string;
  note?: string;
}
export type DeltaSync = "planned_only" | "in_sync" | "drifted" | "stale";
export interface LintFlag { rule: string; severity: "warn" | "error"; message: string }

// F2: mutable per-page relationship charge (stable dyad definitions live in Foundations.relationships)
export interface RelationshipState { pair: string; charge: string; note?: string }

// The full shape of pages.metadata — author-only page-progression state, never shown to readers. This
// IS the object that dictates how the next page progresses (the next page reads the latest prior
// character_states). The canonical copy is supabase/functions/_shared/page-state.ts (PageState); keep
// the two in sync. Note: the page→generating-call link is a real column (pages.last_ai_call_id), NOT
// part of metadata.
export interface PageMeta {
  // The outline node this page renders (docs/structure-as-render.md). Set by reconcile(); a page with
  // no node_id is sovereign (legacy or author-created outside the outline) and reconcile never touches it.
  node_id?: string;
  objective?: string;
  beat?: string; // the page's beat (one-paragraph middle resolution between objective and prose)
  summary?: string;
  character_states?: CharacterState[]; // full character ledger as of this page (the state axis)
  prose_src_hash?: string; // legacy (Phase 1): parent-only hash for the objective→prose edge
  sync?: Partial<Record<EdgeName, EdgeHash>>; // both-endpoint snapshots, one per edge
  planned_delta?: Delta[]; // authored at Beats stage (the page's contract)
  extracted_delta?: Delta[] | null; // distilled from prose after it exists
  delta_sync?: DeltaSync;
  lint_flags?: LintFlag[];
  pinned?: boolean; // author touched objective+beat → regeneration must hold it
  // F2: mutable relationship charges as of this page (extracted post-prose, like character_states)
  relationship_states?: RelationshipState[];
  // F3c: story-time stamp (when in the story's chronology this page falls)
  time?: { when?: string; elapsed?: string };
  // F4a: POV character name for this page (overrides book default from foundations.narration)
  pov?: string;
}

/**
 * Fold the deltas of the given pages (reading order, 1..n-1) into the state ENTERING the next page:
 * per delta type, subject → latest `to`. Prefers extracted_delta (prose is truth once it exists).
 * `seed` extends the axis across books: a sequel's page 1 enters with the parent's final fold
 * (books.canon.final_state). Mirrors foldStateIn in the edge copy.
 */
export function foldStateIn(
  pages: Array<Pick<PageMeta, "planned_delta" | "extracted_delta">>,
  seed?: Record<DeltaType, Record<string, string>>,
): Record<DeltaType, Record<string, string>> {
  const out: Record<DeltaType, Record<string, string>> = {
    character: { ...(seed?.character ?? {}) },
    thread: { ...(seed?.thread ?? {}) },
    value: { ...(seed?.value ?? {}) },
    world: { ...(seed?.world ?? {}) },
  };
  for (const p of pages) {
    const deltas = (p.extracted_delta?.length ? p.extracted_delta : p.planned_delta) ?? [];
    for (const d of deltas) {
      if (!d?.type || !d.subject || !(d.type in out)) continue;
      out[d.type][d.subject] = d.to;
    }
  }
  return out;
}

/** Canonical name for the per-page state object; alias of PageMeta. */
export type PageState = PageMeta;

/**
 * Generic edge staleness from a recorded reconcile snapshot. The contract is "don't badge what we
 * didn't generate": with no recorded hash, or no child content, an edge is NOT stale. A snapshot can
 * be the new both-endpoint {p,c} form, or the legacy parent-only string (Phase 1's prose_src_hash) —
 * the latter only detects parent drift, which is all it ever could.
 */
export function isEdgeStale(
  parentText: string | null | undefined,
  childText: string | null | undefined,
  recorded: EdgeHash | string | null | undefined,
): boolean {
  if (!childText || !String(childText).trim()) return false; // no child → nothing to be stale
  if (!recorded) return false; // never reconciled (legacy / hand-authored) → not stale
  if (typeof recorded === "string") return recorded !== metaHash(parentText); // legacy parent-only
  return recorded.p !== metaHash(parentText) || recorded.c !== metaHash(childText);
}

/**
 * Is this page's prose out of sync with the layer it was actually written FROM? Checks PARENT drift
 * only (the source moved on) — the downward concern these callers care about; they pass a `hasProse`
 * boolean, not the prose text, so the child side isn't available here (child-edited "pull up" is
 * surfaced at the node cell, not as staleness).
 *
 * The parent is whichever layer the prose was generated from, recorded by which snapshot exists — NOT
 * "the beat if one exists": prose generated from the objective (before any beat-prose reroute) must
 * keep comparing against the OBJECTIVE, so merely adding a beat never falsely marks that prose stale.
 */
export function isProseStale(metadata: PageMeta | null | undefined, hasProse: boolean): boolean {
  if (!hasProse || !metadata) return false;
  const beatProse = metadata.sync?.beat_prose;
  if (beatProse) return beatProse.p !== metaHash(metadata.beat); // prose was written from the beat
  if (metadata.prose_src_hash) return metadata.prose_src_hash !== metaHash(metadata.objective); // from the objective
  return false; // never stamped → don't badge
}

/** Record an edge's reconcile snapshot into a metadata object (returns a new metadata). */
export function stampEdge(
  metadata: PageMeta | null | undefined,
  edge: EdgeName,
  parentText: string | null | undefined,
  childText: string | null | undefined,
): PageMeta {
  const meta = { ...(metadata ?? {}) };
  meta.sync = { ...(meta.sync ?? {}), [edge]: { p: metaHash(parentText), c: metaHash(childText) } };
  return meta;
}

/**
 * Stamp prose provenance after prose has been written to a page. Reads metadata fresh (so it doesn't
 * clobber a just-persisted summary), then records which layer the prose was written FROM:
 *  - beat present → the beat_prose edge {p: hash(beat), c: hash(prose)} (and drop the legacy hash)
 *  - no beat      → the legacy prose_src_hash = hash(objective)
 * Call AFTER the content update. Best-effort: a failure here only means a page might look stale.
 */
export async function stampProse(
  pageId: number,
  objective: string | null | undefined,
  proseText?: string | null,
): Promise<void> {
  const { data } = await supabase.from("pages").select("metadata").eq("id", pageId).maybeSingle();
  const metadata = { ...((data?.metadata as PageMeta | null) ?? {}) };
  const beat = metadata.beat?.trim();
  if (beat) {
    metadata.sync = { ...(metadata.sync ?? {}), beat_prose: { p: metaHash(beat), c: metaHash(proseText ?? "") } };
    delete metadata.prose_src_hash;
  } else {
    metadata.prose_src_hash = metaHash(objective);
    if (metadata.sync) delete metadata.sync.beat_prose;
  }
  await supabase.from("pages").update({ metadata }).eq("id", pageId);
}
