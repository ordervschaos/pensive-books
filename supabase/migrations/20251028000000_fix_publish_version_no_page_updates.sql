-- Fix publish_version to NOT update pages table
-- This prevents uncommitted changes when publishing a book

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

  -- REMOVED: No longer updating pages table
  -- This was causing uncommitted changes because updated_at would also change
END;
$$;

COMMENT ON FUNCTION publish_version(BIGINT, BIGINT) IS 'Publishes a specific book version without modifying pages table';
