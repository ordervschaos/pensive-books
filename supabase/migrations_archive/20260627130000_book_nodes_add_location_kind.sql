-- Add location to the book_nodes kind check constraint.
-- location = a PLACE with a persistent sensory palette (a scene points at one via scene.loc, like
-- scene.pov → character), so a setting reads consistently across every scene set there.
ALTER TABLE public.book_nodes DROP CONSTRAINT IF EXISTS book_nodes_kind_chk;
ALTER TABLE public.book_nodes ADD CONSTRAINT book_nodes_kind_chk CHECK (kind IN (
  'seed','premise','pillar','movement','beat','scene',                                                  -- ladder
  'character','relationship','tentpole','world_fact','location','thread','game','voice_profile'));       -- entities
