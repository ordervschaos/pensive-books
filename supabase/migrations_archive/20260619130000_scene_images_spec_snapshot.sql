-- Snapshot the SceneSpec that produced each generated image, so the author can "revise this image" —
-- load its exact inputs (subjects, setting, light, …) back into the Scene editor, tweak, regenerate.
-- The page-level pages.scene_spec is the live working draft; this is the per-image record of what ran.
ALTER TABLE page_scene_images ADD COLUMN IF NOT EXISTS scene_spec JSONB;
