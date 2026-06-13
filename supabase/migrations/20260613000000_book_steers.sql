-- Author "steer" prompts per Build-Studio step.
--
-- books.steers — a small jsonb of free-text guidance the author types BEFORE generating, keyed by
-- step: { foundations?, spine?, outline?, beats?, prose? }. It is sticky (persists per book+step,
-- pre-filled on return, reused for re-generations until changed). The generation cores read the
-- relevant key and append it to their prompt as a strong-but-subordinate instruction — it never
-- overrides the brief, the spine, or any PINNED constraint. Default {} so every book has the bag.
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS steers jsonb;
ALTER TABLE public.books ALTER COLUMN steers SET DEFAULT '{}'::jsonb;
