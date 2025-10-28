-- CRITICAL FIX: Remove UPDATE pages from publish_version function
-- The function currently updates pages.last_published_at which triggers
-- the update_page_modtime trigger, setting pages.updated_at = NOW()
-- This causes all pages to appear as "uncommitted changes" after publishing

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
  UPDATE books
  SET
    published_version_id = p_version_id,
    last_published_at = NOW(),
    updated_at = NOW()
  WHERE id = p_book_id;

  -- REMOVED: The following UPDATE was causing uncommitted changes
  -- UPDATE pages
  -- SET last_published_at = NOW()
  -- WHERE id IN (
  --   SELECT page_id
  --   FROM page_versions
  --   WHERE book_version_id = p_version_id AND page_id IS NOT NULL
  -- );

  -- We don't need to track last_published_at on pages because:
  -- 1. Published state is tracked in book_versions.is_published
  -- 2. Published timestamp is in book_versions.published_at
  -- 3. Page content at publish time is preserved in page_versions table
END;
$$;

COMMENT ON FUNCTION publish_version(BIGINT, BIGINT) IS 'Publishes a book version. Does NOT update pages table to avoid false uncommitted changes.';
