-- Create page_audio_blocks table for block-based audio generation
CREATE TABLE IF NOT EXISTS public.page_audio_blocks (
  id BIGSERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  block_index INTEGER NOT NULL,
  block_type TEXT NOT NULL, -- 'paragraph', 'heading', 'listItem', 'blockquote', etc.
  text_content TEXT NOT NULL,
  content_hash TEXT NOT NULL, -- hash of text_content for change detection
  audio_url TEXT,
  duration REAL,
  start_time REAL, -- cumulative start time in full audio sequence
  end_time REAL,   -- cumulative end time in full audio sequence
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(page_id, block_index)
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_page_audio_blocks_page_id ON public.page_audio_blocks(page_id);
CREATE INDEX IF NOT EXISTS idx_page_audio_blocks_content_hash ON public.page_audio_blocks(content_hash);

-- Enable RLS
ALTER TABLE public.page_audio_blocks ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read audio blocks for pages they have access to
CREATE POLICY "Users can read audio blocks for accessible pages"
  ON public.page_audio_blocks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pages p
      LEFT JOIN public.books b ON p.book_id = b.id
      LEFT JOIN public.book_access ba ON b.id = ba.book_id
      WHERE p.id = page_audio_blocks.page_id
      AND (
        b.is_public = true 
        OR b.owner_id = auth.uid()
        OR ba.user_id = auth.uid()
      )
    )
  );

-- Policy: Users can insert audio blocks for pages they can edit
CREATE POLICY "Users can insert audio blocks for editable pages"
  ON public.page_audio_blocks
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pages p
      LEFT JOIN public.books b ON p.book_id = b.id
      LEFT JOIN public.book_access ba ON b.id = ba.book_id
      WHERE p.id = page_audio_blocks.page_id
      AND (
        b.owner_id = auth.uid()
        OR (ba.user_id = auth.uid() AND ba.access_level = 'edit')
      )
    )
  );

-- Policy: Users can update audio blocks for pages they can edit
CREATE POLICY "Users can update audio blocks for editable pages"
  ON public.page_audio_blocks
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.pages p
      LEFT JOIN public.books b ON p.book_id = b.id
      LEFT JOIN public.book_access ba ON b.id = ba.book_id
      WHERE p.id = page_audio_blocks.page_id
      AND (
        b.owner_id = auth.uid()
        OR (ba.user_id = auth.uid() AND ba.access_level = 'edit')
      )
    )
  );

-- Policy: Users can delete audio blocks for pages they can edit
CREATE POLICY "Users can delete audio blocks for editable pages"
  ON public.page_audio_blocks
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.pages p
      LEFT JOIN public.books b ON p.book_id = b.id
      LEFT JOIN public.book_access ba ON b.id = ba.book_id
      WHERE p.id = page_audio_blocks.page_id
      AND (
        b.owner_id = auth.uid()
        OR (ba.user_id = auth.uid() AND ba.access_level = 'edit')
      )
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_page_audio_blocks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_page_audio_blocks_updated_at
  BEFORE UPDATE ON public.page_audio_blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_page_audio_blocks_updated_at();

