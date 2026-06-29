-- Add meter to the book_nodes kind check constraint (docs/novel-dna-meters.md).
-- meter = a named bounded axis (comedy/heat/freedom/game-score) defined once on the pillar; beats/scenes
-- carry numeric `readings` on it. The engine (novelDna.ts) plots the series + lints its shape.
ALTER TABLE public.book_nodes DROP CONSTRAINT IF EXISTS book_nodes_kind_chk;
ALTER TABLE public.book_nodes ADD CONSTRAINT book_nodes_kind_chk CHECK (kind IN (
  'seed','premise','pillar','movement','beat','scene',                                                          -- ladder
  'character','relationship','tentpole','world_fact','location','thread','game','meter','voice_profile'));       -- entities
