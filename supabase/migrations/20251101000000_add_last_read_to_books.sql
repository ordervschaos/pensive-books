-- Add last_read column to books table
ALTER TABLE books ADD COLUMN IF NOT EXISTS last_read TIMESTAMP WITH TIME ZONE;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_books_last_read ON books(last_read);

-- Add comment
COMMENT ON COLUMN books.last_read IS 'Timestamp of when the book was last read by the user';

