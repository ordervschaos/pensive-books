-- The delete-only trim pass (apps/digest/lib/digest/trim.ts) caches its result per post.
--
-- `body` is NEVER overwritten: keeping the untrimmed original is what makes the pass reversible and lets a
-- better trimmer re-run without re-fetching the article. `trim_version` is the guard against a cached bad
-- trim outliving its fix — the same trap `loadCorpus` already dodges by re-cleaning bodies on read.
-- `trim_drops` is the audit trail: which block was removed and under which tag.
alter table public.digest_posts
  add column if not exists body_clean   text,
  add column if not exists trim_version integer,
  add column if not exists trim_drops   jsonb;

comment on column public.digest_posts.body_clean is
  'Body with page furniture removed by the trim pass. Provably a subsequence of body — the model returns block indices, never text.';
comment on column public.digest_posts.trim_version is
  'TRIM_VERSION the cached body_clean was produced under. Raising the constant re-trims on next use.';
comment on column public.digest_posts.trim_drops is
  'Audit trail: [{i, why}] block indices dropped, against the block numbering of body.';
