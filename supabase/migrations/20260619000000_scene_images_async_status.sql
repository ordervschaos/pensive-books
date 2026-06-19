-- Durable, resumable scene-image generation.
--
-- Before: the edge fn rendered synchronously and inserted the finished row — so navigating away mid-render
-- killed the (serverless) work and lost the generation, and the loading state was client-only (gone on
-- revisit). Now a placeholder row is inserted in 'generating' status, the render runs in the background
-- (EdgeRuntime.waitUntil), then the SAME row flips to 'ready' (with image_url) or 'error'. The gallery is a
-- live projection of these rows, so progress survives navigation and shows per page across many pages.

ALTER TABLE page_scene_images
  ALTER COLUMN image_url DROP NOT NULL,                            -- null while generating
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready',   -- 'generating' | 'ready' | 'error'
  ADD COLUMN IF NOT EXISTS error TEXT;

-- Background row updates run as the service role (bypasses RLS), so no UPDATE policy is needed. The
-- table is already in supabase_realtime; UPDATE events carry the full new row (default replica identity).
