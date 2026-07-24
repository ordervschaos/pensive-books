-- Per-book overrides of the structural/entity generation policy. The generic DNA expander (dna-expand,
-- the pass that turns a pillar into acts/cast/world/relationships/set-pieces/threads/games and an act into
-- beats/scenes) reads its per-target policy from the GLOBAL node_type_configs table: `role` (the craft
-- phrasing — what to generate and to what standard) and `count` (how many). This column lets an author
-- retune those two knobs PER BOOK from the studio's Craft Notes tab, without editing the shared table.
--
-- Shape: { [target]: { role?: text, count?: text } } — target = node_type_configs.target (cast, world,
-- movements, scenes, …). A missing key, or a blank field, means "use the global default" (the edge merges
-- the override OVER the config row). Kept separate from books.craft_overrides (the { craftKey: text } map
-- for the prose/plan craft notes) because the shape differs — a nested {role,count}, not a flat string.
alter table public.books
  add column if not exists expansion_overrides jsonb not null default '{}'::jsonb;

comment on column public.books.expansion_overrides is
  'Per-book overrides of node_type_configs generation policy. { target: { role?, count? } }. Blank/missing = global default.';
