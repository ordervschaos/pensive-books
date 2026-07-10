-- node_scene_images — the per-scene "images map" for picture-book mode (docs/picture-book-mode.md).
-- Mirrors page_scene_images, but keyed to the SCENE NODE's stable id (book_nodes.id) instead of a page
-- row. Pages are a throwaway projection (reconcileDna archives/recreates them), so a page-keyed image
-- would orphan on every render; the scene node id is the only durable anchor. One scene node → many
-- candidate images (a gallery); the chosen one is written to book_nodes.content.image_url.
--
-- Same durable status machine as page_scene_images (composing → generating → ready/error), same
-- scene-images bucket, Realtime-published (the studio is a live projection).

CREATE TABLE IF NOT EXISTS node_scene_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES book_nodes(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  image_url TEXT,                     -- null while composing/generating
  prompt TEXT,                        -- the scene prompt used (node-native: scene plan + present cast), for re-runs/audit
  scene_spec JSONB,                   -- the structured spec snapshot that produced this image (null for legacy/uploads)
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('composing', 'generating', 'ready', 'error')),
  error TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_node_scene_images_node_id ON node_scene_images(node_id);
CREATE INDEX IF NOT EXISTS idx_node_scene_images_book_id ON node_scene_images(book_id);

ALTER TABLE node_scene_images ENABLE ROW LEVEL SECURITY;

-- Read mirrors page_scene_images (public, for published-book rendering); writes are authenticated.
CREATE POLICY "Anyone can view node scene images" ON node_scene_images
    FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert node scene images" ON node_scene_images
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update node scene images" ON node_scene_images
    FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete node scene images" ON node_scene_images
    FOR DELETE USING (auth.role() = 'authenticated');

-- Live projection (refresh = no-op): the studio subscribes to this table over Realtime.
ALTER PUBLICATION supabase_realtime ADD TABLE node_scene_images;
