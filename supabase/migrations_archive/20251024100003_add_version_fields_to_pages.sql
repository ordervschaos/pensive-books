-- Add version control fields to pages table

-- Add draft indicator (pages table is always the working draft)
ALTER TABLE pages
ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT true NOT NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_pages_is_draft ON pages(is_draft) WHERE is_draft = true;

-- Add comment for documentation
COMMENT ON COLUMN pages.is_draft IS 'Always true - pages table represents the working draft/workspace';

-- Note: We're keeping the existing fields as they are still useful:
-- - updated_at: tracks when workspace was last modified
-- - last_published_at: can be used to track when this page was last included in a published version
