-- Scene images: AI-generated illustrations of a page's scene, with character coherence.
-- Mirrors page_audio (per-page generated media), but allows MANY images per page (a gallery of
-- moments). Character portraits live in books.foundations.cast[].ref_image_url (no table) and are
-- fed back into scene generation so the same character renders consistently across pages.

CREATE TABLE IF NOT EXISTS page_scene_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  prompt TEXT,                        -- the scene prompt used (beat + author note), for re-runs/audit
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_scene_images_page_id ON page_scene_images(page_id);
CREATE INDEX IF NOT EXISTS idx_page_scene_images_book_id ON page_scene_images(book_id);

ALTER TABLE page_scene_images ENABLE ROW LEVEL SECURITY;

-- Read mirrors page_audio (public, for published-book rendering); writes are authenticated.
CREATE POLICY "Anyone can view scene images" ON page_scene_images
    FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert scene images" ON page_scene_images
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete scene images" ON page_scene_images
    FOR DELETE USING (auth.role() = 'authenticated');

-- Live projection (refresh = no-op): the studio subscribes to this table over Realtime.
ALTER PUBLICATION supabase_realtime ADD TABLE page_scene_images;

-- Storage bucket for both scene art (scenes/<pageId>/…) and character portraits (portraits/<bookId>/…).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'scene-images',
  'scene-images',
  true,
  10485760, -- 10MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can view scene image files" ON storage.objects
    FOR SELECT USING (bucket_id = 'scene-images');
CREATE POLICY "Authenticated users can upload scene image files" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'scene-images' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update scene image files" ON storage.objects
    FOR UPDATE USING (bucket_id = 'scene-images' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete scene image files" ON storage.objects
    FOR DELETE USING (bucket_id = 'scene-images' AND auth.role() = 'authenticated');
