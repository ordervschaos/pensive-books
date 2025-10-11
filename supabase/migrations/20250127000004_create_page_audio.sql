-- Create page_audio table
CREATE TABLE IF NOT EXISTS page_audio (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  audio_url TEXT NOT NULL,
  audio_duration INTEGER, -- duration in seconds
  character_count INTEGER NOT NULL, -- for cost tracking
  voice_id TEXT NOT NULL DEFAULT 'JBFqnCBsd6RMkjVDRZzb', -- ElevenLabs voice ID
  content_hash TEXT NOT NULL, -- MD5 hash of page content to detect changes
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  -- Ensure one audio record per page
  UNIQUE(page_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_page_audio_page_id ON page_audio(page_id);
CREATE INDEX IF NOT EXISTS idx_page_audio_content_hash ON page_audio(content_hash);
CREATE INDEX IF NOT EXISTS idx_page_audio_voice_id ON page_audio(voice_id);

-- Create function to automatically update updated_at column
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_page_audio_modtime 
    BEFORE UPDATE ON page_audio 
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- Enable Row Level Security
ALTER TABLE page_audio ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Anyone can read page audio (public access for playback)
CREATE POLICY "Anyone can view page audio" ON page_audio
    FOR SELECT USING (true);

-- Authenticated users can insert page audio
CREATE POLICY "Authenticated users can insert page audio" ON page_audio
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Authenticated users can update page audio
CREATE POLICY "Authenticated users can update page audio" ON page_audio
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Authenticated users can delete page audio
CREATE POLICY "Authenticated users can delete page audio" ON page_audio
    FOR DELETE USING (auth.role() = 'authenticated');

-- Create storage bucket for page audio files
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'page-audio',
  'page-audio',
  true,
  52428800, -- 50MB limit
  ARRAY['audio/mpeg', 'audio/mp3']
) ON CONFLICT (id) DO NOTHING;

-- Storage policies for page-audio bucket
CREATE POLICY "Anyone can view page audio files" ON storage.objects
    FOR SELECT USING (bucket_id = 'page-audio');

CREATE POLICY "Authenticated users can upload page audio files" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'page-audio' 
        AND auth.role() = 'authenticated'
    );

CREATE POLICY "Authenticated users can update page audio files" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'page-audio' 
        AND auth.role() = 'authenticated'
    );

CREATE POLICY "Authenticated users can delete page audio files" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'page-audio' 
        AND auth.role() = 'authenticated'
    );
