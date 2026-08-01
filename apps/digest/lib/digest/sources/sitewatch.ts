import type { Adapter, Item, RunCtx, SitewatchSection } from "../types";
import { createServiceClient } from "@/lib/supabase/server";
import { articleText } from "../fetch";
import { createHash } from "crypto";

// sitewatch — watch any page that has no feed.
//
// A syllabus, a status page, a pricing page, a friend's site that never got around to RSS. Fetch, extract,
// hash; emit an item ONLY when the text changed since the last run.
//
// THE IDENTITY PROBLEM, and why the version lives in the url. Every stage downstream keys on
// sha256(canonical url), and "already delivered" is exactly what that key means. A watched page keeps its
// url forever, so the second time it changed, the dedupe layer would suppress it as old news — the layer
// working perfectly in the one case you don't want it to (the same shape of bug as regenerating a delivered
// day). So each version gets its own identity: `?v=<hash8>` appended. canonicalUrl strips tracking params,
// not unknown ones, so the version survives normalization and every version is its own post in the corpus.
//
// The previous text is read out of digest_posts — the corpus IS the memory here, so this kind adds no table.

const HASH_PARAM = "v";

function contentHash(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 8);
}

/** Strip our own version param back off, to recover the page's stable identity. */
function baseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.searchParams.delete(HASH_PARAM);
    return u.toString();
  } catch {
    return raw;
  }
}

function versioned(url: string, hash: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(HASH_PARAM, hash);
    return u.toString();
  } catch {
    return url;
  }
}

export const sitewatchAdapter: Adapter = async (section, ctx: RunCtx) => {
  const s = section as SitewatchSection;
  const urls = (s.urls ?? []).filter((u) => u.startsWith("http")).slice(0, 8);
  if (!urls.length) return [];

  // What we last saw for each watched page, drawn from this section's own rows only. Scoping by section_id
  // matters: another section may have fetched the same url for a different reason, and its body is not this
  // section's baseline.
  const { data } = await createServiceClient()
    .from("digest_posts")
    .select("url, body, fetched_at")
    .eq("digest_id", ctx.digest.id)
    .eq("section_id", s.id)
    .order("fetched_at", { ascending: false })
    .limit(200);

  const previous = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ url: string | null; body: string | null }>) {
    if (!r.url || !r.body) continue;
    const key = baseUrl(r.url);
    if (!previous.has(key)) previous.set(key, r.body); // newest wins — the list is already sorted
  }

  const results = await Promise.all(
    urls.map(async (url): Promise<Item | null> => {
      const { text, publishedAt } = await articleText(url, ctx.signal);
      if (!text.trim()) return null; // a fetch failure is not a change

      const before = previous.get(baseUrl(url));
      // First sighting is a change by definition — otherwise adding a page to watch would produce nothing
      // until it happened to update, which reads as a broken section.
      if (before && contentHash(before) === contentHash(text)) return null;

      let host = url;
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        /* keep the raw url as the label */
      }

      return {
        title: `${host} — ${before ? "updated" : "now watching"}`,
        text,
        url: versioned(url, contentHash(text)),
        source: host,
        published_at: publishedAt,
      };
    }),
  );

  return results.filter((i): i is Item => !!i).slice(0, s.max_items ?? 5);
};
