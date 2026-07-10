-- Function: rollback_to_version
-- Restores workspace (pages table) to the state of a specific version
-- Then creates a new commit documenting the rollback

CREATE OR REPLACE FUNCTION rollback_to_version(
  p_book_id BIGINT,
  p_version_id BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_version_number INTEGER;
  v_new_version_id BIGINT;
  v_page_version RECORD;
BEGIN
  -- Verify user has permission (must be book owner)
  IF NOT EXISTS (
    SELECT 1 FROM books WHERE id = p_book_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Permission denied: You must be the book owner to rollback';
  END IF;

  -- Get the version number we're rolling back to
  SELECT version_number INTO v_version_number
  FROM book_versions
  WHERE id = p_version_id AND book_id = p_book_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version % not found for book %', p_version_id, p_book_id;
  END IF;

  -- Delete all current pages for this book
  DELETE FROM pages WHERE book_id = p_book_id;

  -- Restore pages from the target version
  FOR v_page_version IN
    SELECT * FROM page_versions WHERE book_version_id = p_version_id ORDER BY page_index
  LOOP
    INSERT INTO pages (
      book_id,
      title,
      content,
      page_index,
      page_type,
      owner_id,
      is_draft,
      created_at,
      updated_at
    )
    VALUES (
      p_book_id,
      v_page_version.title,
      v_page_version.content,
      v_page_version.page_index,
      v_page_version.page_type,
      auth.uid(),
      true,
      NOW(),
      NOW()
    );
  END LOOP;

  -- Create a new commit documenting the rollback
  SELECT create_book_version(
    p_book_id,
    'Rollback to v' || v_version_number::text
  ) INTO v_new_version_id;

  RETURN v_new_version_id;
END;
$$;

COMMENT ON FUNCTION rollback_to_version(BIGINT, BIGINT) IS 'Restores workspace to a previous version and creates a rollback commit';
