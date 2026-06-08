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

export interface PageMeta {
  objective?: string;
  summary?: string;
  prose_src_hash?: string;
}

/**
 * Is this page's prose out of sync with its objective?
 * True only when the page HAS prose, was AI-stamped (prose_src_hash present), and the objective has
 * since changed. Legacy/hand-written prose (no stamp) is treated as NOT stale — we don't badge what
 * we never generated. `hasProse` is the host's own "does this page have real body text" decision.
 */
export function isProseStale(metadata: PageMeta | null | undefined, hasProse: boolean): boolean {
  if (!hasProse || !metadata) return false;
  const src = metadata.prose_src_hash;
  if (!src) return false;
  return src !== metaHash(metadata.objective);
}

/**
 * Stamp prose provenance after prose has been written to a page. Reads the current metadata fresh
 * (so it doesn't clobber a summary the generator just persisted), merges prose_src_hash, writes back.
 * Call AFTER the content update. Best-effort: a failure here only means a page might look stale.
 */
export async function stampProse(pageId: number, objective: string | null | undefined): Promise<void> {
  const { data } = await supabase.from("pages").select("metadata").eq("id", pageId).maybeSingle();
  const metadata = { ...(((data?.metadata as PageMeta | null) ?? {})), prose_src_hash: metaHash(objective) };
  await supabase.from("pages").update({ metadata }).eq("id", pageId);
}
