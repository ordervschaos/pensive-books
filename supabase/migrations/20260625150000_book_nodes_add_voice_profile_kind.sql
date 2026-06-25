-- Add voice_profile to the book_nodes kind check constraint
ALTER TABLE public.book_nodes DROP CONSTRAINT IF EXISTS book_nodes_kind_chk;
ALTER TABLE public.book_nodes ADD CONSTRAINT book_nodes_kind_chk CHECK (kind IN (
  'seed','premise','pillar','movement','beat','scene',                                      -- ladder
  'character','relationship','tentpole','world_fact','thread','game','voice_profile'));     -- entities
