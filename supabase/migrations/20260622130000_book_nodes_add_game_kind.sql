-- Add the `game` entity kind (the game pillar, docs/novel-dna-games.md) to book_nodes.
-- A game is a contest with a win-condition + a stake; its `couples` edge says what its outcome does to
-- another game (the stakes engine). Referenced by beats/scenes via plays/resolves.
ALTER TABLE public.book_nodes DROP CONSTRAINT IF EXISTS book_nodes_kind_chk;
ALTER TABLE public.book_nodes ADD CONSTRAINT book_nodes_kind_chk CHECK (kind IN (
  'seed','premise','pillar','movement','beat','scene',                          -- ladder
  'character','relationship','tentpole','world_fact','thread','game'));         -- entities (schema §4)
