-- Database functions for version control operations

-- Function: create_book_version
-- Creates a complete snapshot of a book and all its pages
-- Returns the new version ID

CREATE OR REPLACE FUNCTION create_book_version(
  p_book_id BIGINT,
  p_commit_message TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_version_number INTEGER;
  v_book_version_id BIGINT;
  v_book RECORD;
BEGIN
  -- Verify user has permission (must be book owner)
  IF NOT EXISTS (
    SELECT 1 FROM books WHERE id = p_book_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Permission denied: You must be the book owner to create a version';
  END IF;

  -- Get book details
  SELECT * INTO v_book FROM books WHERE id = p_book_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Book not found with id: %', p_book_id;
  END IF;

  -- Calculate next version number
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_version_number
  FROM book_versions
  WHERE book_id = p_book_id;

  -- Create book version snapshot
  INSERT INTO book_versions (
    book_id,
    version_number,
    name,
    subtitle,
    author,
    cover_url,
    photographer,
    photographer_username,
    show_text_on_cover,
    commit_message,
    committed_by,
    committed_at,
    is_published,
    metadata
  ) VALUES (
    p_book_id,
    v_version_number,
    v_book.name,
    v_book.subtitle,
    v_book.author,
    v_book.cover_url,
    v_book.photographer,
    v_book.photographer_username,
    v_book.show_text_on_cover,
    p_commit_message,
    auth.uid(),
    NOW(),
    false,
    jsonb_build_object(
      'page_count', (SELECT COUNT(*) FROM pages WHERE book_id = p_book_id AND archived = false)
    )
  )
  RETURNING id INTO v_book_version_id;

  -- Create page version snapshots for all pages in the book
  INSERT INTO page_versions (
    book_version_id,
    page_id,
    title,
    content,
    page_index,
    page_type,
    metadata
  )
  SELECT
    v_book_version_id,
    p.id,
    p.title,
    p.content,
    p.page_index,
    p.page_type,
    jsonb_build_object(
      'word_count', COALESCE(LENGTH(p.content::text), 0)
    )
  FROM pages p
  WHERE p.book_id = p_book_id
    AND p.archived = false
  ORDER BY p.page_index;

  -- Update book's last_commit_version_id and reset draft status
  UPDATE books
  SET
    last_commit_version_id = v_book_version_id,
    current_draft_status = 'clean',
    updated_at = NOW()
  WHERE id = p_book_id;

  -- Return the new version ID
  RETURN v_book_version_id;
END;
$$;

COMMENT ON FUNCTION create_book_version(BIGINT, TEXT) IS 'Creates an immutable snapshot of a book and all its pages. Returns version ID.';


-- Function: publish_version
-- Publishes a specific version of a book (makes it visible to public if book is public)

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

  -- Update last_published_at for all pages in this version
  UPDATE pages
  SET last_published_at = NOW()
  WHERE id IN (
    SELECT page_id
    FROM page_versions
    WHERE book_version_id = p_version_id AND page_id IS NOT NULL
  );
END;
$$;

COMMENT ON FUNCTION publish_version(BIGINT, BIGINT) IS 'Publishes a specific book version, making it visible to public viewers';


-- Function: get_uncommitted_changes_count
-- Returns count of pages modified since last commit

CREATE OR REPLACE FUNCTION get_uncommitted_changes_count(p_book_id BIGINT)
RETURNS TABLE (
  changed_pages INTEGER,
  last_commit_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_commit_at TIMESTAMPTZ;
BEGIN
  -- Get last commit timestamp
  SELECT bv.committed_at INTO v_last_commit_at
  FROM books b
  LEFT JOIN book_versions bv ON bv.id = b.last_commit_version_id
  WHERE b.id = p_book_id;

  -- Count pages modified after last commit
  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER AS changed_pages,
    v_last_commit_at AS last_commit_at
  FROM pages p
  WHERE p.book_id = p_book_id
    AND p.archived = false
    AND (
      v_last_commit_at IS NULL
      OR p.updated_at > v_last_commit_at
      OR p.created_at > v_last_commit_at
    );
END;
$$;

COMMENT ON FUNCTION get_uncommitted_changes_count(BIGINT) IS 'Returns count of pages modified since last commit';


-- Function: get_version_details
-- Returns detailed information about a specific version

CREATE OR REPLACE FUNCTION get_version_details(p_version_id BIGINT)
RETURNS TABLE (
  version_id BIGINT,
  book_id BIGINT,
  version_number INTEGER,
  book_name TEXT,
  commit_message TEXT,
  committed_at TIMESTAMPTZ,
  committed_by UUID,
  is_published BOOLEAN,
  published_at TIMESTAMPTZ,
  page_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bv.id AS version_id,
    bv.book_id,
    bv.version_number,
    bv.name AS book_name,
    bv.commit_message,
    bv.committed_at,
    bv.committed_by,
    bv.is_published,
    bv.published_at,
    (SELECT COUNT(*)::INTEGER FROM page_versions WHERE book_version_id = bv.id) AS page_count
  FROM book_versions bv
  WHERE bv.id = p_version_id;
END;
$$;

COMMENT ON FUNCTION get_version_details(BIGINT) IS 'Returns detailed information about a specific book version';


-- Function: get_version_history
-- Returns list of all versions for a book

CREATE OR REPLACE FUNCTION get_version_history(p_book_id BIGINT)
RETURNS TABLE (
  version_id BIGINT,
  version_number INTEGER,
  commit_message TEXT,
  committed_at TIMESTAMPTZ,
  committed_by UUID,
  committer_email TEXT,
  is_published BOOLEAN,
  published_at TIMESTAMPTZ,
  page_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bv.id AS version_id,
    bv.version_number,
    bv.commit_message,
    bv.committed_at,
    bv.committed_by,
    ud.email AS committer_email,
    bv.is_published,
    bv.published_at,
    (SELECT COUNT(*)::INTEGER FROM page_versions WHERE book_version_id = bv.id) AS page_count
  FROM book_versions bv
  LEFT JOIN user_data ud ON ud.user_id = bv.committed_by
  WHERE bv.book_id = p_book_id
  ORDER BY bv.version_number DESC;
END;
$$;

COMMENT ON FUNCTION get_version_history(BIGINT) IS 'Returns chronological list of all versions for a book';
