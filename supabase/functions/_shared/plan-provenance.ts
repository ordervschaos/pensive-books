// Plan↔prose dirty-graph: provenance stamping (edge copy). See docs/multiresolution-outline.md.
//
// metaHash MUST stay byte-for-byte identical to the web copy in apps/web/src/lib/planProvenance.ts —
// the same page's objective is hashed in both runtimes, so the digests have to agree.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

function normalize(text: string | null | undefined): string {
  return String(text ?? "").trim().replace(/\s+/g, " ");
}

// cyrb53 — pure-JS 53-bit hash; identical output in Deno and the browser.
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

/** Stable hash of a plan text (objective/beat). */
export function metaHash(text: string | null | undefined): string {
  return cyrb53(normalize(text)).toString(16);
}

interface EdgeHash { p: string; c: string }

/**
 * Persist a freshly-generated BEAT to `pageId` and stamp the objective→beat edge {p: hash(objective),
 * c: hash(beat)}, mirroring the web stampEdge("objective_beat", …). Used by generate-book's beat
 * phase (server-side), where the client isn't in the loop to stamp it. Reads metadata fresh so it
 * preserves any sibling fields. Best-effort.
 */
export async function stampBeat(
  client: SupabaseClient,
  pageId: number,
  objective: string | null | undefined,
  beatText: string,
): Promise<void> {
  const { data } = await client.from("pages").select("metadata").eq("id", pageId).maybeSingle();
  const metadata = { ...((data?.metadata as Record<string, unknown> | null) ?? {}) } as Record<string, unknown>;
  metadata.beat = beatText;
  const sync = { ...((metadata.sync as Record<string, EdgeHash> | undefined) ?? {}) };
  sync.objective_beat = { p: metaHash(objective), c: metaHash(beatText) };
  metadata.sync = sync;
  await client.from("pages").update({ metadata }).eq("id", pageId);
}

/**
 * Stamp prose provenance after prose has been written to `pageId`. Reads metadata fresh (to preserve
 * a just-persisted summary), then records which layer the prose was written FROM:
 *  - beat present → the beat_prose edge {p: hash(beat), c: hash(prose)} (and drop the legacy hash)
 *  - no beat      → the legacy prose_src_hash = hash(objective)
 * This keeps the resolution-ladder dirty graph correct: prose goes stale against its real source.
 * Best-effort.
 */
export async function stampProse(
  client: SupabaseClient,
  pageId: number,
  objective: string | null | undefined,
  proseText?: string | null,
): Promise<void> {
  const { data } = await client.from("pages").select("metadata").eq("id", pageId).maybeSingle();
  const metadata = { ...((data?.metadata as Record<string, unknown> | null) ?? {}) } as Record<string, unknown>;
  const beat = typeof metadata.beat === "string" ? metadata.beat.trim() : "";
  if (beat) {
    const sync = { ...((metadata.sync as Record<string, EdgeHash> | undefined) ?? {}) };
    sync.beat_prose = { p: metaHash(beat), c: metaHash(proseText ?? "") };
    metadata.sync = sync;
    delete metadata.prose_src_hash;
  } else {
    metadata.prose_src_hash = metaHash(objective);
    if (metadata.sync && typeof metadata.sync === "object") delete (metadata.sync as Record<string, unknown>).beat_prose;
  }
  await client.from("pages").update({ metadata }).eq("id", pageId);
}
