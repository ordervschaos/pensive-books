-- Add version control fields to books table

-- Add reference to last committed version
ALTER TABLE books
ADD COLUMN IF NOT EXISTS last_commit_version_id BIGINT
  REFERENCES book_versions(id) ON DELETE SET NULL;

-- Add reference to currently published version
ALTER TABLE books
ADD COLUMN IF NOT EXISTS published_version_id BIGINT
  REFERENCES book_versions(id) ON DELETE SET NULL;

-- Add draft status indicator
ALTER TABLE books
ADD COLUMN IF NOT EXISTS current_draft_status TEXT
  DEFAULT 'clean'
  CHECK (current_draft_status IN ('clean', 'modified'));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_books_last_commit_version ON books(last_commit_version_id);
CREATE INDEX IF NOT EXISTS idx_books_published_version ON books(published_version_id);
CREATE INDEX IF NOT EXISTS idx_books_draft_status ON books(current_draft_status) WHERE current_draft_status = 'modified';

-- Add comments for documentation
COMMENT ON COLUMN books.last_commit_version_id IS 'Points to the most recent committed version of this book';
COMMENT ON COLUMN books.published_version_id IS 'Points to the version currently published (visible to public)';
COMMENT ON COLUMN books.current_draft_status IS 'Indicates if workspace has uncommitted changes: clean or modified';

-- Function to automatically update draft status when pages are modified
CREATE OR REPLACE FUNCTION update_book_draft_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Mark book as modified when any page is updated
  UPDATE books
  SET current_draft_status = 'modified'
  WHERE id = NEW.book_id
    AND current_draft_status = 'clean';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update draft status on page updates
DROP TRIGGER IF EXISTS trigger_update_book_draft_status ON pages;
CREATE TRIGGER trigger_update_book_draft_status
  AFTER UPDATE OF content, title ON pages
  FOR EACH ROW
  WHEN (OLD.content IS DISTINCT FROM NEW.content OR OLD.title IS DISTINCT FROM NEW.title)
  EXECUTE FUNCTION update_book_draft_status();

-- Create trigger to update draft status on page inserts
DROP TRIGGER IF EXISTS trigger_update_book_draft_status_insert ON pages;
CREATE TRIGGER trigger_update_book_draft_status_insert
  AFTER INSERT ON pages
  FOR EACH ROW
  EXECUTE FUNCTION update_book_draft_status();

-- Create trigger to update draft status on page deletes
DROP TRIGGER IF EXISTS trigger_update_book_draft_status_delete ON pages;
CREATE TRIGGER trigger_update_book_draft_status_delete
  AFTER DELETE ON pages
  FOR EACH ROW
  EXECUTE FUNCTION update_book_draft_status();

COMMENT ON FUNCTION update_book_draft_status() IS 'Automatically marks book as modified when pages are changed';
COMMENT ON TRIGGER trigger_update_book_draft_status ON pages IS 'Updates book draft status when page content or title changes';
COMMENT ON TRIGGER trigger_update_book_draft_status_insert ON pages IS 'Updates book draft status when new page is added';
COMMENT ON TRIGGER trigger_update_book_draft_status_delete ON pages IS 'Updates book draft status when page is deleted';
