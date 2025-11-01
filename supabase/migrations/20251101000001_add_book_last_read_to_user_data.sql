-- Update bookmarked_pages structure to include timestamps
-- Change from: { "bookId": pageIndex }
-- To: { "bookId": { "pageIndex": number, "timestamp": "ISO string" } }

-- Note: No schema changes needed - bookmarked_pages is already JSONB
-- This is just documentation of the new structure

-- Remove last_read from books table if it exists (since it should be per-user)
ALTER TABLE books DROP COLUMN IF EXISTS last_read;

-- Add comment to document the new structure
COMMENT ON COLUMN user_data.bookmarked_pages IS 'JSON object storing bookmarked pages with timestamps: { "bookId": { "pageIndex": number, "timestamp": "ISO string" } }';

