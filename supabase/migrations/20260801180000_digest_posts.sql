-- digest_posts — every post the pipeline has ever pulled, kept.
--
-- Until now a fetched item was ephemeral: the ones that made it into a section survived inside
-- digest_issues.content, and everything else evaporated. Three things were impossible as a result —
--   * VISIBILITY: no way to see what was fetched and NOT used, which is exactly what you need to judge
--     whether a feed is earning its place.
--   * REUSE: article bodies were re-extracted from scratch on every run, paying r.jina.ai for text we'd
--     already had.
--   * RANKING: the "pick 3 of 40" editorial step is unimplementable without a corpus to rank over.
--
-- This table SUBSUMES digest_items_seen rather than sitting beside it. That table was already keyed
-- (digest_id, url_hash) — the same grain — and held a strict subset of these columns; two tables at one
-- grain is drift waiting to happen. "Seen" is now a property of a post (`used_at is not null`) instead of a
-- separate fact about it.
--
-- THE INVARIANT THAT MUST NOT SLIP: dedupe keys on DELIVERED, never on FETCHED. If merely fetching a post
-- suppressed it, an item pulled today and passed over would be blacklisted forever and could never be
-- reconsidered — the opposite of what a corpus is for.

CREATE TABLE IF NOT EXISTS public.digest_posts (
  id          bigint generated always as identity primary key,
  digest_id   bigint not null references public.digests(id) on delete cascade,

  -- sha256 of the canonicalized url — same content-addressing the dedupe layer always used.
  url_hash    text not null,
  url         text,
  title       text,
  source      text,
  -- The extracted article body. The expensive thing to obtain, hence the thing most worth keeping.
  body        text,
  image_url   text,
  published_at timestamptz,

  -- Which section pulled it, for "is this feed earning its place?"
  section_id  text,
  fetched_at  timestamptz not null default now(),

  -- Delivery. NULL = fetched but never sent; these two are what "seen" means now.
  used_in_issue_id bigint references public.digest_issues(id) on delete set null,
  used_at     timestamptz,

  CONSTRAINT digest_posts_unique_url UNIQUE (digest_id, url_hash)
);

-- The dedupe read on every build: delivered posts for one digest inside the horizon.
CREATE INDEX IF NOT EXISTS digest_posts_used_idx
  ON public.digest_posts (digest_id, used_at DESC) WHERE used_at IS NOT NULL;
-- The visibility read: everything recently fetched, newest first.
CREATE INDEX IF NOT EXISTS digest_posts_fetched_idx
  ON public.digest_posts (digest_id, fetched_at DESC);
-- Regenerate un-uses exactly one issue's posts.
CREATE INDEX IF NOT EXISTS digest_posts_issue_idx
  ON public.digest_posts (used_in_issue_id) WHERE used_in_issue_id IS NOT NULL;

COMMENT ON TABLE public.digest_posts IS
  'Every post pulled by any section, kept for visibility, text reuse, and future ranking. used_at IS NOT NULL means delivered — that, not fetched_at, is what the dedupe layer reads.';
COMMENT ON COLUMN public.digest_posts.body IS
  'Extracted article text. Reused on later runs instead of re-fetching the page.';

-- Carry the existing dedupe memory across. These rows have no body/source (that data was never kept), but
-- their delivered-ness is the part that matters and must not be lost — dropping it would re-deliver
-- everything already sent.
INSERT INTO public.digest_posts (digest_id, url_hash, url, title, fetched_at, used_at, used_in_issue_id)
SELECT digest_id, url_hash, url, title, first_seen_at, first_seen_at, issue_id
FROM public.digest_items_seen
ON CONFLICT (digest_id, url_hash) DO NOTHING;

DROP TABLE IF EXISTS public.digest_items_seen;

-- RLS: owner-only, read-only to the user. Posts are produced by the pipeline (service role), never written
-- from a browser. DELETE is allowed so "let this story back in" / "forget this" stays possible.
ALTER TABLE public.digest_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners read their posts" ON public.digest_posts;
CREATE POLICY "owners read their posts"
  ON public.digest_posts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.digests d WHERE d.id = digest_id AND d.owner_id = auth.uid()));

DROP POLICY IF EXISTS "owners forget their posts" ON public.digest_posts;
CREATE POLICY "owners forget their posts"
  ON public.digest_posts FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.digests d WHERE d.id = digest_id AND d.owner_id = auth.uid()));
