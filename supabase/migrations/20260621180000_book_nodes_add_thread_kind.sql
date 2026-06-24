-- Add the `thread` entity kind (the promise registry, schema §4.5) to book_nodes.
-- A thread is one promise node both ends point at: a setup scene and a payoff scene reference the same
-- thread, so a payoff at a distance is a reference edge reaching forward in reading order — never a
-- reordered beat. Generated at step 5 (after movements). See docs/novel-dna-flow.md.
ALTER TABLE public.book_nodes DROP CONSTRAINT IF EXISTS book_nodes_kind_chk;
ALTER TABLE public.book_nodes ADD CONSTRAINT book_nodes_kind_chk CHECK (kind IN (
  'seed','premise','pillar','movement','beat','scene',                  -- ladder
  'character','relationship','tentpole','world_fact','thread'));        -- entities (schema §4)
