-- Add RLS policies for public access to published book and page versions

-- Enable RLS on book_versions and page_versions (if not already enabled)
ALTER TABLE book_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_versions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Public users can view published book versions" ON book_versions;
DROP POLICY IF EXISTS "Public users can view published page versions" ON page_versions;
DROP POLICY IF EXISTS "Book owners can view all their book versions" ON book_versions;
DROP POLICY IF EXISTS "Book owners can view all their page versions" ON page_versions;
DROP POLICY IF EXISTS "Editors can view book versions" ON book_versions;
DROP POLICY IF EXISTS "Editors can view page versions" ON page_versions;

-- 1. Public users can view published book versions (for public books)
CREATE POLICY "Public users can view published book versions"
  ON book_versions FOR SELECT
  USING (
    is_published = true
    AND EXISTS (
      SELECT 1 FROM books b
      WHERE b.id = book_versions.book_id
        AND b.is_public = true
        AND b.is_archived = false
    )
  );

-- 2. Public users can view published page versions (for public books)
CREATE POLICY "Public users can view published page versions"
  ON page_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM book_versions bv
      JOIN books b ON b.id = bv.book_id
      WHERE bv.id = page_versions.book_version_id
        AND bv.is_published = true
        AND b.is_public = true
        AND b.is_archived = false
    )
  );

-- 3. Book owners can view ALL their book versions (published and unpublished)
CREATE POLICY "Book owners can view all their book versions"
  ON book_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM books b
      WHERE b.id = book_versions.book_id
        AND b.owner_id = auth.uid()
    )
  );

-- 4. Book owners can view ALL their page versions
CREATE POLICY "Book owners can view all their page versions"
  ON page_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM book_versions bv
      JOIN books b ON b.id = bv.book_id
      WHERE bv.id = page_versions.book_version_id
        AND b.owner_id = auth.uid()
    )
  );

-- 5. Editors with access can view book versions
CREATE POLICY "Editors can view book versions"
  ON book_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM book_access ba
      JOIN books b ON b.id = ba.book_id
      WHERE b.id = book_versions.book_id
        AND ba.user_id = auth.uid()
        AND ba.access_level IN ('edit', 'view')
    )
  );

-- 6. Editors with access can view page versions
CREATE POLICY "Editors can view page versions"
  ON page_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM book_versions bv
      JOIN books b ON b.id = bv.book_id
      JOIN book_access ba ON ba.book_id = b.id
      WHERE bv.id = page_versions.book_version_id
        AND ba.user_id = auth.uid()
        AND ba.access_level IN ('edit', 'view')
    )
  );

-- Add helpful comments
COMMENT ON POLICY "Public users can view published book versions" ON book_versions IS
  'Allows anyone to view published versions of public books';

COMMENT ON POLICY "Public users can view published page versions" ON page_versions IS
  'Allows anyone to view published page content from public books';

COMMENT ON POLICY "Book owners can view all their book versions" ON book_versions IS
  'Book owners can see all versions (published and unpublished) of their books';

COMMENT ON POLICY "Book owners can view all their page versions" ON page_versions IS
  'Book owners can see all page versions in their books';
