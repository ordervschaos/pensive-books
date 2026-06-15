// foundations — the client for books.foundations (the pin-driven flow's stage-2 artifact) and the
// genre thread seeding. See docs/pinned_method.md. Types mirror the edge copy in
// supabase/functions/_shared/foundations-core.ts — keep the two in sync.
//
// The column doubles as the FLOW FLAG: null = old 9-step rail, non-null (even {}) = the new
// brief → foundations → spine-routes rail. New books get '{}' from the DB default.
//
// Pin semantics (§0/§4 rule 1): any EXPLICIT author gesture — editing text, tap-selecting a
// candidate, keeping a tentpole — pins the record (pinned: true + author_edited_at). The
// "skip — use AI default" path auto-selects without pinning, leaving the record fluid.
import { supabase } from "@/integrations/supabase/client";

export type FoundationsStepKey = "argument" | "ending" | "cast" | "tentpoles" | "voice";

export interface FCandidate { id: string; text: string; implied_ending?: string; label?: string }
export interface FNode { text?: string; pinned?: boolean; author_edited_at?: string; candidates?: FCandidate[] }
export interface CastMember {
  id: string; name: string;
  want?: string; wound?: string; lie?: string;
  pinned_fields?: string[];
  role?: "protagonist" | "major" | "minor";
  // "Design the look" (manual portrait step): the author-written visual description and a SET of
  // approved reference portraits (different angles/views — uploaded or AI-generated). Scene generation
  // feeds these back in so the character renders coherently across pages.
  appearance?: string;
  portraits?: string[];
}
export interface CastProposal { label: string; members: CastMember[] }
export interface Tentpole {
  id: string; text: string;
  source: "author" | "ai";
  status: "pinned" | "fluid" | "killed";
  placed_page_id?: number;
}
export interface Foundations {
  argument?: FNode;
  ending?: FNode;
  cast?: CastMember[];
  tentpoles?: Tentpole[];
  voice_exemplar?: FNode;
}

export interface SpineRoute { id: string; summary: string; tentpole_order: string[] }
/** books.spine in the new flow: the old {text, brief_hash} plus routes + pin. */
export interface SpineNode {
  text?: string;
  brief_hash?: string;
  pinned?: boolean;
  author_edited_at?: string;
  routes?: SpineRoute[];
  selected_route_id?: string;
}

/** Merge a patch into books.spine without dropping the other keys (routes, pin, …). */
export async function writeSpinePatch(bookId: number, patch: Partial<SpineNode>): Promise<void> {
  const { data, error: readErr } = await supabase.from("books").select("spine").eq("id", bookId).maybeSingle();
  if (readErr) throw readErr;
  const spine = { ...((data?.spine as SpineNode | null) ?? {}), ...patch };
  const { error } = await supabase.from("books").update({ spine }).eq("id", bookId);
  if (error) throw error;
}

export async function readSpineNode(bookId: number): Promise<SpineNode> {
  const { data, error } = await supabase.from("books").select("spine").eq("id", bookId).maybeSingle();
  if (error) throw error;
  return (data?.spine as SpineNode | null) ?? {};
}

/** null = book is on the old flow (pre-foundations). */
export async function readFoundations(bookId: number): Promise<Foundations | null> {
  const { data, error } = await supabase.from("books").select("foundations").eq("id", bookId).maybeSingle();
  if (error) throw error;
  return (data?.foundations as Foundations | null) ?? null;
}

export async function writeFoundations(bookId: number, f: Foundations): Promise<void> {
  const { error } = await supabase.from("books").update({ foundations: f }).eq("id", bookId);
  if (error) throw error;
}

/** Stamp a node with the author's touch (rule 1). */
export function pinNode(n: FNode | undefined, text: string): FNode {
  return { ...(n ?? {}), text, pinned: true, author_edited_at: new Date().toISOString() };
}

/** The sub-steps a Foundations object has completed (drives the progress strip + step readiness). */
export function foundationsProgress(f: Foundations | null | undefined): Record<FoundationsStepKey, boolean> {
  const live = (f?.tentpoles ?? []).filter((t) => t.status !== "killed");
  return {
    argument: !!f?.argument?.text?.trim(),
    ending: !!f?.ending?.text?.trim(),
    cast: (f?.cast?.length ?? 0) > 0,
    tentpoles: live.length >= 3,
    voice: !!f?.voice_exemplar?.text?.trim(),
  };
}

export function foundationsComplete(f: Foundations | null | undefined): boolean {
  const p = foundationsProgress(f);
  return p.argument && p.ending && p.cast && p.tentpoles && p.voice;
}

// ── Genre thread seeding (§3.1) ──────────────────────────────────────────────
// On Brief save with a genre set, seed the promise ledger from a template. Seeded threads are
// source 'genre_template', status 'planned', unpinned (author_locked false), freely deletable.
const GENRE_THREADS: Array<{ match: RegExp; threads: Array<{ name: string; description: string }> }> = [
  {
    match: /mystery|crime|detective|noir/i,
    threads: [
      { name: "Central question", description: "The question the whole book exists to answer — keep it open until the reveal." },
      { name: "False suspect", description: "Someone the reader is led to believe did it — must be planted and cleared." },
      { name: "The reveal", description: "The truth's payoff — every clue thread converges here." },
    ],
  },
  {
    match: /romance/i,
    threads: [
      { name: "Will-they", description: "The central pull between the leads — tension that opens early and resolves late." },
      { name: "The obstacle", description: "What credibly keeps them apart — must escalate before it breaks." },
    ],
  },
  {
    match: /thriller|suspense/i,
    threads: [
      { name: "The ticking clock", description: "The deadline that compresses every choice — set it early, tighten it." },
      { name: "The betrayal", description: "Trust placed where it shouldn't be — plant it before it turns." },
    ],
  },
  {
    match: /fantasy|sci-?fi|speculative/i,
    threads: [
      { name: "Rules of the world", description: "The promise of how this world works — establish before you exploit." },
      { name: "The price of power", description: "What the extraordinary costs — the bill must come due." },
    ],
  },
];

/** Idempotent: seeds only if the book has no genre_template threads yet. No-op for unknown genres. */
export async function seedGenreThreads(bookId: number, genre: string | null | undefined): Promise<void> {
  if (!genre?.trim()) return;
  const template = GENRE_THREADS.find((g) => g.match.test(genre));
  if (!template) return;
  const { data: existing } = await supabase
    .from("book_threads").select("id").eq("book_id", bookId).eq("source", "genre_template").limit(1);
  if (existing?.length) return;
  const { error } = await supabase.from("book_threads").insert(
    template.threads.map((t) => ({
      book_id: bookId,
      name: t.name,
      description: t.description,
      status: "planned",
      source: "genre_template",
    })),
  );
  if (error) throw error;
}
