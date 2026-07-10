-- Rename the `movement` node kind to `act`, end-to-end (DnaTree vocabulary unification).
-- The story-act rung was historically stored as kind='movement' while the UI said "act"; the two
-- words were used interchangeably. This collapses everything onto "act". It converts existing
-- book_nodes rows + the node_type_configs seed (the expand target key, the kind it produces, the
-- beats row's parent_kind, and the prompt `role`/`schema_json` text the edge fn + bridge read live).

-- 1. book_nodes.kind: drop the CHECK, convert data, re-add with 'act' replacing 'movement'.
ALTER TABLE public.book_nodes DROP CONSTRAINT IF EXISTS book_nodes_kind_chk;
UPDATE public.book_nodes SET kind = 'act' WHERE kind = 'movement';
ALTER TABLE public.book_nodes ADD CONSTRAINT book_nodes_kind_chk CHECK (kind IN (
  'seed','premise','pillar','act','beat','scene',                                                              -- ladder
  'character','relationship','tentpole','world_fact','location','thread','game','meter','voice_profile'));     -- entities

-- 2. node_type_configs structural columns: the expand target key, the kind produced, and the
--    beats row's expected parent kind.
UPDATE public.node_type_configs SET target      = 'acts' WHERE target      = 'movements';
UPDATE public.node_type_configs SET child_kind  = 'act'  WHERE child_kind  = 'movement';
UPDATE public.node_type_configs SET parent_kind = 'act'  WHERE parent_kind = 'movement';

-- 3. node_type_configs prompt text: role/schema_json are read at generation time (dna-expand +
--    eval-bridge), so "four movements" / "the movements" must become acts too. Plural first.
UPDATE public.node_type_configs
   SET role        = replace(role, 'movements', 'acts'),
       schema_json = replace(schema_json, 'movements', 'acts')
 WHERE role LIKE '%movement%' OR schema_json LIKE '%movement%';
UPDATE public.node_type_configs
   SET role        = replace(role, 'movement', 'act'),
       schema_json = replace(schema_json, 'movement', 'act')
 WHERE role LIKE '%movement%' OR schema_json LIKE '%movement%';
