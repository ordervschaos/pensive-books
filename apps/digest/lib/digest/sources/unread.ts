import type { Adapter, Item, RunCtx, UnreadSection } from "../types";
import { createServiceClient } from "@/lib/supabase/server";
import { truncateAtBoundary } from "../entities";

// unread — the corpus's own leftovers.
//
// digest_posts already keeps EVERY post any section pulled, used or not, with the extracted body. That is
// data already fetched and already paid for; roughly nine tenths of it has never been shown to anyone. This
// section reads it back. Zero network, zero model at gather time, and it turns the corpus from an admin
// table into something the reader can feel.
//
// TWO WINDOWS, and both matter:
//   min_age — skip the last few days, so this can't race the ordinary sections that are still considering
//             those posts. Without it the digest would show the same story twice in a week from two angles.
//   max_age — beyond a month a leftover is not "something you missed", it's stale news wearing a hat.
//
// Ordering is oldest-first inside that window: the point is the tail, not another pass at the recent stuff.

const DEFAULT_MIN_AGE = 3;
const DEFAULT_MAX_AGE = 30;
const BODY_FLOOR = 400; // characters — below this the extraction failed and there is nothing to write from

interface Row {
  url: string | null;
  title: string | null;
  source: string | null;
  body: string | null;
  image_url: string | null;
  published_at: string | null;
  fetched_at: string;
}

export const unreadAdapter: Adapter = async (section, ctx: RunCtx) => {
  const s = section as UnreadSection;
  const max = s.max_items ?? 3;
  const minAge = s.min_age_days ?? DEFAULT_MIN_AGE;
  const maxAge = Math.max(s.max_age_days ?? DEFAULT_MAX_AGE, minAge + 1);

  const newest = new Date(Date.now() - minAge * 86_400_000).toISOString();
  const oldest = new Date(Date.now() - maxAge * 86_400_000).toISOString();

  const { data, error } = await createServiceClient()
    .from("digest_posts")
    .select("url, title, source, body, image_url, published_at, fetched_at")
    .eq("digest_id", ctx.digest.id)
    .is("used_at", null) // never delivered — that, and only that, is what "unread" means here
    .not("body", "is", null)
    .lte("fetched_at", newest)
    .gte("fetched_at", oldest)
    .order("fetched_at", { ascending: true })
    .limit(60);

  if (error) {
    console.error(`unread ${s.id}: read failed:`, error.message);
    return [];
  }

  return ((data ?? []) as Row[])
    .filter((r) => r.url && (r.body ?? "").length >= BODY_FLOOR)
    .slice(0, max)
    .map(
      (r): Item => ({
        title: r.title ?? "Untitled",
        text: truncateAtBoundary(r.body!, 12_000),
        url: r.url!,
        source: r.source ?? undefined,
        image_url: r.image_url ?? undefined,
        published_at: r.published_at ?? r.fetched_at,
      }),
    );
};
