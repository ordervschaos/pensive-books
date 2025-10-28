-- Fix publish_version to NOT update pages table (v2)
-- Ensuring the function definitely doesn't touch the pages table
-- This is a second attempt to fix the uncommitted changes issue

CREATE OR REPLACE FUNCTION publish_version(
  p_book_id BIGINT,
  p_version_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify user has permission (must be book owner)
  IF NOT EXISTS (
    SELECT 1 FROM books WHERE id = p_book_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Permission denied: You must be the book owner to publish a version';
  END IF;

  -- Verify version belongs to this book
  IF NOT EXISTS (
    SELECT 1 FROM book_versions WHERE id = p_version_id AND book_id = p_book_id
  ) THEN
    RAISE EXCEPTION 'Version % does not belong to book %', p_version_id, p_book_id;
  END IF;

  -- Unpublish all other versions of this book
  UPDATE book_versions
  SET is_published = false, published_at = NULL
  WHERE book_id = p_book_id AND id != p_version_id;

  -- Publish the specified version
  UPDATE book_versions
  SET is_published = true, published_at = NOW()
  WHERE id = p_version_id;

  -- Update book's published_version_id pointer
  -- NOTE: We do NOT update the book's updated_at to avoid cascade effects
  UPDATE books
  SET
    published_version_id = p_version_id,
    last_published_at = NOW()
  WHERE id = p_book_id;

  -- CRITICAL: NO updates to pages table
  -- The original function had an UPDATE pages SET last_published_at = NOW()
  -- This was removed because:
  -- 1. It triggers the update_page_modtime trigger which sets updated_at = NOW()
  -- 2. This makes all pages appear as "uncommitted changes"
  -- 3. The published state is already tracked in book_versions.is_published
END;
$$;

COMMENT ON FUNCTION publish_version(BIGINT, BIGINT) IS 'Publishes a specific book version WITHOUT modifying pages table to prevent false uncommitted changes';
