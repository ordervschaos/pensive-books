-- Create book_versions table for version control
-- This stores complete snapshots of books at commit time

CREATE TABLE IF NOT EXISTS book_versions (
  id BIGSERIAL PRIMARY KEY,
  book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,

  -- Book metadata snapshot at commit time
  name TEXT NOT NULL,
  subtitle TEXT,
  author TEXT,
  cover_url TEXT,
  photographer TEXT,
  photographer_username TEXT,
  show_text_on_cover BOOLEAN DEFAULT true,

  -- Commit metadata
  commit_message TEXT,
  committed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  committed_by UUID REFERENCES auth.users(id),

  -- Publishing metadata
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,

  -- Additional metadata (flexible for future extensions)
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Ensure unique version numbers per book
  UNIQUE(book_id, version_number),

  -- Ensure version numbers are positive
  CHECK (version_number > 0)
);

-- Create indexes for performance
CREATE INDEX idx_book_versions_book_id ON book_versions(book_id);
CREATE INDEX idx_book_versions_published ON book_versions(book_id, is_published) WHERE is_published = true;
CREATE INDEX idx_book_versions_committed_at ON book_versions(book_id, committed_at DESC);

-- Add comments for documentation
COMMENT ON TABLE book_versions IS 'Stores immutable snapshots of books at commit time for version control';
COMMENT ON COLUMN book_versions.version_number IS 'Sequential version number starting from 1 for each book';
COMMENT ON COLUMN book_versions.commit_message IS 'User-provided description of changes in this version';
COMMENT ON COLUMN book_versions.is_published IS 'Whether this version is currently published to public';
COMMENT ON COLUMN book_versions.metadata IS 'Flexible JSONB field for future extensions (stats, tags, etc.)';

-- Enable Row Level Security
ALTER TABLE book_versions ENABLE ROW LEVEL SECURITY;

-- Policy: Public can view published versions of public books
CREATE POLICY book_versions_public_select ON book_versions
  FOR SELECT
  USING (
    is_published = true
    AND EXISTS (
      SELECT 1 FROM books
      WHERE books.id = book_versions.book_id
        AND books.is_public = true
    )
  );

-- Policy: Book owners can view all versions of their books
CREATE POLICY book_versions_owner_select ON book_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM books
      WHERE books.id = book_versions.book_id
        AND books.owner_id = auth.uid()
    )
  );

-- Policy: Users with edit access can view all versions
CREATE POLICY book_versions_editor_select ON book_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM book_access ba
      JOIN books b ON b.id = ba.book_id
      WHERE ba.book_id = book_versions.book_id
        AND ba.user_id = auth.uid()
        AND ba.access_level = 'edit'
    )
  );

-- Policy: Only book owners can create versions (via function)
CREATE POLICY book_versions_owner_insert ON book_versions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM books
      WHERE books.id = book_versions.book_id
        AND books.owner_id = auth.uid()
    )
  );

-- Policy: Only book owners can update versions (for publishing status)
CREATE POLICY book_versions_owner_update ON book_versions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM books
      WHERE books.id = book_versions.book_id
        AND books.owner_id = auth.uid()
    )
  );

-- Policy: Only book owners can delete versions (rarely used)
CREATE POLICY book_versions_owner_delete ON book_versions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM books
      WHERE books.id = book_versions.book_id
        AND books.owner_id = auth.uid()
    )
  );
