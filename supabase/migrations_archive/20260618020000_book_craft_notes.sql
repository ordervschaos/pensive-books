-- Per-book CRAFT NOTES — the author-editable TIER 2 of each revision layer's craft knowledge.
--
-- A jsonb map { foundations | spine | outline | beats : text }. Empty by default → that layer's
-- reviser uses only its immutable TIER 1 system craft (distilled KB, e.g. _shared/story-shapes.ts for
-- the spine). The author's note is their house style for THIS book; the lens context stacks it atop the
-- system craft (system = floor, author's note = taste that wins on style). Rides the existing books row
-- (and its Realtime stream) — no new table.
alter table public.books
  add column if not exists craft_notes jsonb not null default '{}'::jsonb;

comment on column public.books.craft_notes is
  'Per-layer author-editable craft notes { foundations|spine|outline|beats: text } (tier 2), stacked atop the immutable system craft in the edge revision lenses (tier 1).';
