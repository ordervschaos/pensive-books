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
  // The book's "house look" — a single visual-style direction every scene/portrait STYLE line inherits,
  // so illustrations stay coherent across the whole book. Author-set; folded into the image composers.
  // `art_theme` records which preset was chosen (or "custom") for UI highlight only — the composers read
  // `art_direction`. `image_model` is the chosen render-model key (see IMAGE_MODEL_OPTIONS).
  art_direction?: string;
  art_theme?: string;
  image_model?: string;
}

// ── Book-level image look: theme presets + render-model choice ───────────────
// A theme just fills `art_direction` with a style string the composers fold into every STYLE line — so
// every illustration in the book shares one look. `id` is stored in `art_theme` for highlight; `prompt`
// is the actual text written to `art_direction`. "Custom" = author free-text (no preset).
export interface ArtTheme { id: string; label: string; hint: string; prompt: string }
export const ART_THEMES: ArtTheme[] = [
  { id: "hyperreal", label: "Hyper-real", hint: "true-to-life photography",
    prompt: "Photorealistic photography with true-to-life detail — natural skin texture, fabric weave, and physically accurate materials, shallow depth of field holding crisp focus on the subject, soft directional key light with a gentle fill, neutral cinematic colour grade, shot as if on a full-frame camera with a fast prime lens." },
  { id: "cinematic", label: "Cinematic", hint: "painterly film still",
    prompt: "Cinematic painterly digital illustration with rich atmospheric, volumetric lighting, a naturalistic yet heightened palette of deep teals and warm amber accents, soft film-grain texture and shallow focus, composed and graded like a prestige-drama key frame." },
  { id: "watercolour", label: "Watercolour", hint: "soft washes, paper grain",
    prompt: "Soft watercolour painting on cold-press paper — visible grain and granulation, bleeding wet-on-wet washes and translucent layered glazes in muted earth tones, delicate hand-inked contour lines, gentle and airy with generous breathing negative space." },
  { id: "lofi", label: "Lo-fi", hint: "warm, grainy, cozy",
    prompt: "Lo-fi illustration with a warm muted palette, soft analog film grain and noise, cozy nostalgic flatness, gentle cel gradients and a faint VHS-era haze, the unhurried mood of a quiet late-afternoon." },
  { id: "comic", label: "Comic", hint: "ink lines, flat colour",
    prompt: "Bold comic-book illustration — clean confident ink outlines of varying weight, flat cel shading with crisp shadow shapes, halftone Ben-Day dot texture, dynamic high-contrast saturated colours, rendered like a modern graphic-novel panel." },
  { id: "sketch", label: "Ink sketch", hint: "pencil & hatching",
    prompt: "Loose pencil-and-ink sketch — expressive hatching and cross-hatching, energetic gesture lines, smudged graphite tones over subtle ink washes, monochrome on warm sketchbook paper, the immediacy of a life-drawing study." },
  { id: "anime", label: "Anime", hint: "cel-shaded, vibrant",
    prompt: "Modern anime illustration — clean precise linework, soft cel shading with crisp highlights, expressive faces and luminous eyes, a vibrant yet harmonious palette with delicate gradient skies, rendered like a high-budget production still." },
  { id: "storybook", label: "Storybook", hint: "warm, whimsical gouache",
    prompt: "Classic children's storybook illustration — soft textured gouache and coloured-pencil grain, a warm whimsical palette, rounded gentle forms and cozy hand-painted detail, tender storybook lighting in the manner of golden-age picture books." },
  { id: "noir", label: "Noir", hint: "high-contrast shadow",
    prompt: "High-contrast film-noir rendering — deep crushed shadows and stark rim highlights, desaturated near-monochrome with a single selective colour accent, moody chiaroscuro and venetian-blind light, the smoke-and-rain mood of 1940s crime cinema." },
  { id: "oil", label: "Oil painting", hint: "brushwork, old-master",
    prompt: "Rich oil painting with visible brushwork and impasto texture throughout, classical old-master lighting, a deep saturated palette of warm siennas, ochres, and umbers with cool shadow-tones, rendered in the manner of golden-age portraiture." },
];

// Render models the author can switch between. Mirror of IMAGE_MODELS keys in _shared/image.ts; the
// edge resolves the key to a slug, so adding one here means adding it there too.
export interface ImageModelOption { id: string; label: string; hint: string }
export const IMAGE_MODEL_OPTIONS: ImageModelOption[] = [
  { id: "gemini-3", label: "Gemini 3 Pro", hint: "best likeness across scenes" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "faster, looser likeness" },
];
export const DEFAULT_IMAGE_MODEL = "gemini-3";

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

/** Merge a patch into books.foundations without dropping the other keys — for surfaces (e.g. the scene
 *  look bar) that only own a slice and must not clobber cast/argument/etc. Read-merge-write. */
export async function writeFoundationsPatch(bookId: number, patch: Partial<Foundations>): Promise<void> {
  const { data, error: readErr } = await supabase.from("books").select("foundations").eq("id", bookId).maybeSingle();
  if (readErr) throw readErr;
  const foundations = { ...((data?.foundations as Foundations | null) ?? {}), ...patch };
  const { error } = await supabase.from("books").update({ foundations }).eq("id", bookId);
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

/**
 * A stable, content-only fingerprint of the pinned bedrock — hashed (studioModel.rootFingerprints)
 * into each downstream step's approval so we can detect when foundations have MOVED since that step
 * was signed off. Order-stable; ignores transient fields (candidates, pin metadata, killed tentpoles)
 * so only changes that should re-open downstream work flag it.
 */
export function foundationsFingerprint(f: Foundations | null | undefined): string {
  if (!f) return "";
  const parts: string[] = [
    f.argument?.text ?? "",
    f.ending?.text ?? "",
    f.voice_exemplar?.text ?? "",
    ...(f.cast ?? []).map((c) => `${c.name}|${c.want ?? ""}|${c.wound ?? ""}|${c.lie ?? ""}|${c.role ?? ""}`),
    ...(f.tentpoles ?? []).filter((t) => t.status !== "killed").map((t) => `${t.text}|${t.placed_page_id ?? ""}`),
  ];
  return parts.join("␟");
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
