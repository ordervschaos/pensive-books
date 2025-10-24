-- Create page_versions table for version control
-- This stores snapshots of page content linked to book versions

CREATE TABLE IF NOT EXISTS page_versions (
  id BIGSERIAL PRIMARY KEY,
  book_version_id BIGINT NOT NULL REFERENCES book_versions(id) ON DELETE CASCADE,
  page_id BIGINT REFERENCES pages(id) ON DELETE SET NULL,

  -- Page content snapshot at commit time
  title TEXT NOT NULL,
  content JSONB NOT NULL,
  page_index INTEGER NOT NULL,
  page_type TEXT DEFAULT 'text',

  -- Additional metadata (flexible for future extensions)
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Ensure page_index is positive
  CHECK (page_index >= 0)
);

-- Create indexes for performance
CREATE INDEX idx_page_versions_book_version ON page_versions(book_version_id);
CREATE INDEX idx_page_versions_page_id ON page_versions(page_id);
CREATE INDEX idx_page_versions_book_version_index ON page_versions(book_version_id, page_index);

-- Add comments for documentation
COMMENT ON TABLE page_versions IS 'Stores immutable snapshots of page content linked to book versions';
COMMENT ON COLUMN page_versions.page_id IS 'Reference to current page (null if page was deleted)';
COMMENT ON COLUMN page_versions.content IS 'TipTap JSON format content snapshot';
COMMENT ON COLUMN page_versions.page_index IS 'Position of page within book at commit time';
COMMENT ON COLUMN page_versions.metadata IS 'Flexible JSONB field for stats, word count, etc.';

-- Enable Row Level Security
ALTER TABLE page_versions ENABLE ROW LEVEL SECURITY;

-- Policy: Public can view page versions that belong to published book versions
CREATE POLICY page_versions_public_select ON page_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM book_versions bv
      JOIN books b ON b.id = bv.book_id
      WHERE bv.id = page_versions.book_version_id
        AND bv.is_published = true
        AND b.is_public = true
    )
  );

-- Policy: Book owners can view all page versions of their books
CREATE POLICY page_versions_owner_select ON page_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM book_versions bv
      JOIN books b ON b.id = bv.book_id
      WHERE bv.id = page_versions.book_version_id
        AND b.owner_id = auth.uid()
    )
  );

-- Policy: Users with edit access can view all page versions
CREATE POLICY page_versions_editor_select ON page_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM book_versions bv
      JOIN books b ON b.id = bv.book_id
      JOIN book_access ba ON ba.book_id = b.id
      WHERE bv.id = page_versions.book_version_id
        AND ba.user_id = auth.uid()
        AND ba.access_level = 'edit'
    )
  );

-- Policy: Only book owners can create page versions (via function)
CREATE POLICY page_versions_owner_insert ON page_versions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM book_versions bv
      JOIN books b ON b.id = bv.book_id
      WHERE bv.id = page_versions.book_version_id
        AND b.owner_id = auth.uid()
    )
  );

-- Policy: Prevent updates (versions should be immutable)
-- Only allow updates by book owner in case of emergency fixes
CREATE POLICY page_versions_owner_update ON page_versions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM book_versions bv
      JOIN books b ON b.id = bv.book_id
      WHERE bv.id = page_versions.book_version_id
        AND b.owner_id = auth.uid()
    )
  );

-- Policy: Only book owners can delete page versions (rarely used)
CREATE POLICY page_versions_owner_delete ON page_versions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM book_versions bv
      JOIN books b ON b.id = bv.book_id
      WHERE bv.id = page_versions.book_version_id
        AND b.owner_id = auth.uid()
    )
  );
