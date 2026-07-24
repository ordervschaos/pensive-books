-- Per-book craft-note overrides. The tier-1 story craft (LOGLINE/PREMISE/CAUSALITY/POLARITY/SCENE
-- direction) lives in code (_shared/craft-kb.ts) as the DEFAULT. This column lets an author replace any
-- of those, per book, from the DNA studio's "Craft Notes" tab. Shape: { [craftKey]: text } — keys are
-- the stable CRAFT_NOTES[].key handles (logline, premise, causality, polarity, scene_direction). A blank
-- / missing key means "use the code default" (craftBody() falls back). Kept OFF books.craft_notes, which
-- is the distilled web-research map ({ topic: note }) — a different concern that must not collide.
alter table public.books
  add column if not exists craft_overrides jsonb not null default '{}'::jsonb;

comment on column public.books.craft_overrides is
  'Per-book overrides of the tier-1 craft notes (_shared/craft-kb.ts CRAFT_NOTES). { craftKey: text }. Blank/missing = code default.';
