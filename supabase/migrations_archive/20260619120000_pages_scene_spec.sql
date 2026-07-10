-- Structured per-page scene editor: the author edits a SCENE SPEC (per-character subjects with
-- build/clothing/expression/action, plus setting/action/composition/lighting/mood/exclude) in the
-- studio rail's "Scene" tab. The spec is serialized to the existing labelled image prompt at render
-- time, so the render pipeline is unchanged. Stored per page so it restores exactly on reopen.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS scene_spec JSONB;
