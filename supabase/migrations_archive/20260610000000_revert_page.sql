-- Function: revert_page
-- Reverts a single page to its state in the last committed version.
-- If the page was added since the last commit (no snapshot), archives it.
-- If the page was modified or deleted (archived), restores the snapshot.

CREATE OR REPLACE FUNCTION revert_page(
  p_book_id BIGINT,
  p_page_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_version_id BIGINT;
  v_pv              RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM books WHERE id = p_book_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Permission denied: you must own this book to revert pages';
  END IF;

  SELECT last_commit_version_id INTO v_last_version_id
  FROM books WHERE id = p_book_id;

  IF v_last_version_id IS NULL THEN
    -- No commits at all: every page is "added", so discard by archiving.
    UPDATE pages SET archived = true, updated_at = NOW()
    WHERE id = p_page_id AND book_id = p_book_id;
    RETURN;
  END IF;

  SELECT * INTO v_pv
  FROM page_versions
  WHERE book_version_id = v_last_version_id AND page_id = p_page_id;

  IF NOT FOUND THEN
    -- Added since last commit: discard by archiving.
    UPDATE pages SET archived = true, updated_at = NOW()
    WHERE id = p_page_id AND book_id = p_book_id;
  ELSE
    -- Modified or deleted (archived): restore the committed snapshot.
    UPDATE pages
    SET
      title      = v_pv.title,
      content    = v_pv.content,
      page_index = v_pv.page_index,
      page_type  = COALESCE(v_pv.page_type, page_type),
      archived   = false,
      updated_at = NOW()
    WHERE id = p_page_id AND book_id = p_book_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION revert_page(BIGINT, BIGINT) IS
  'Reverts one page to the last committed snapshot, or archives it if it was added after the last commit.';
