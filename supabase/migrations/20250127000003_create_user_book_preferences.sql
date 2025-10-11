-- Create user_book_preferences table
CREATE TABLE IF NOT EXISTS user_book_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  flashcards_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  -- Ensure one preference record per user-book combination
  UNIQUE(user_id, book_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_book_preferences_user_id ON user_book_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_book_preferences_book_id ON user_book_preferences(book_id);
CREATE INDEX IF NOT EXISTS idx_user_book_preferences_flashcards_enabled ON user_book_preferences(flashcards_enabled);

-- Create function to automatically update updated_at column
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_user_book_preferences_modtime 
    BEFORE UPDATE ON user_book_preferences 
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- Enable Row Level Security
ALTER TABLE user_book_preferences ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can only see their own preferences
CREATE POLICY "Users can view their own book preferences" ON user_book_preferences
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own preferences
CREATE POLICY "Users can insert their own book preferences" ON user_book_preferences
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own preferences
CREATE POLICY "Users can update their own book preferences" ON user_book_preferences
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own preferences
CREATE POLICY "Users can delete their own book preferences" ON user_book_preferences
    FOR DELETE USING (auth.uid() = user_id);
