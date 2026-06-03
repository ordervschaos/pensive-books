-- Hash-based draft change detection
--
-- Replaces the old client-side approach (fetch full content of every modified
-- page twice, convert to text in the browser, string-compare) with a single
-- server-side RPC that compares JSON content hashes. No content leaves the DB.
--
-- jsonb::text is canonical (normalized key order / whitespace), so equal content
-- hashes equal regardless of how the client serialized it. md5 + ::text casts are
-- immutable, so this is safe to compute inline with no stored column / table lock.

-- Helper: assert the current user may read draft state for this book.
-- Mirrors the read access used elsewhere (owner or any book_access grant).
CREATE OR REPLACE FUNCTION assert_book_read_access(p_book_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM books b WHERE b.id = p_book_id AND b.owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM book_access ba
    WHERE ba.book_id = p_book_id AND ba.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Permission denied: no access to book %', p_book_id;
  END IF;
END;
$$;

-- Function: get_draft_changes
-- Returns one row per page that actually differs from the last committed version,
-- with its status (added / deleted / modified). Compares content by hash.
CREATE OR REPLACE FUNCTION get_draft_changes(p_book_id BIGINT)
RETURNS TABLE (
  page_id BIGINT,
  title TEXT,
  page_index INTEGER,
  status TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_version_id BIGINT;
BEGIN
  PERFORM assert_book_read_access(p_book_id);

  SELECT b.last_commit_version_id INTO v_last_version_id
  FROM books b WHERE b.id = p_book_id;

  -- No commits yet: every current page is "added".
  IF v_last_version_id IS NULL THEN
    RETURN QUERY
    SELECT p.id, p.title, p.page_index, 'added'::TEXT, p.updated_at
    FROM pages p
    WHERE p.book_id = p_book_id AND p.archived = false
    ORDER BY p.page_index;
    RETURN;
  END IF;

  RETURN QUERY
  WITH cur AS (
    SELECT
      p.id,
      p.title,
      p.page_index,
      p.updated_at,
      md5(coalesce(p.content::text, '') || '|' || coalesce(p.title, '')) AS hash
    FROM pages p
    WHERE p.book_id = p_book_id AND p.archived = false
  ),
  ver AS (
    SELECT
      pv.page_id,
      pv.title,
      pv.page_index,
      md5(coalesce(pv.content::text, '') || '|' || coalesce(pv.title, '')) AS hash
    FROM page_versions pv
    WHERE pv.book_version_id = v_last_version_id AND pv.page_id IS NOT NULL
  )
  SELECT
    COALESCE(c.id, v.page_id)                 AS page_id,
    COALESCE(c.title, v.title)                AS title,
    COALESCE(c.page_index, v.page_index)      AS page_index,
    CASE
      WHEN v.page_id IS NULL THEN 'added'
      WHEN c.id IS NULL       THEN 'deleted'
      ELSE 'modified'
    END::TEXT                                 AS status,
    c.updated_at                              AS updated_at
  FROM cur c
  FULL OUTER JOIN ver v ON v.page_id = c.id
  WHERE v.page_id IS NULL          -- added (not in last version)
     OR c.id IS NULL               -- deleted (gone from workspace)
     OR c.hash <> v.hash           -- modified (content/title differs)
  ORDER BY COALESCE(c.page_index, v.page_index);
END;
$$;

COMMENT ON FUNCTION get_draft_changes(BIGINT) IS 'Returns pages that differ from the last committed version (added/deleted/modified) using JSON content hashes. No content transferred.';

-- Function: get_uncommitted_changes_count (rewrite)
-- Was: timestamp-based count that over-reported, then corrected client-side by
-- fetching+diffing all content. Now: accurate hash-based count, single query.
CREATE OR REPLACE FUNCTION get_uncommitted_changes_count(p_book_id BIGINT)
RETURNS TABLE (
  changed_pages INTEGER,
  last_commit_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_version_id BIGINT;
  v_last_commit_at TIMESTAMPTZ;
BEGIN
  SELECT b.last_commit_version_id, bv.committed_at
  INTO v_last_version_id, v_last_commit_at
  FROM books b
  LEFT JOIN book_versions bv ON bv.id = b.last_commit_version_id
  WHERE b.id = p_book_id;

  -- No commits yet: every current page counts as changed.
  IF v_last_version_id IS NULL THEN
    RETURN QUERY
    SELECT COUNT(*)::INTEGER, v_last_commit_at
    FROM pages p
    WHERE p.book_id = p_book_id AND p.archived = false;
    RETURN;
  END IF;

  RETURN QUERY
  WITH cur AS (
    SELECT
      p.id,
      md5(coalesce(p.content::text, '') || '|' || coalesce(p.title, '')) AS hash
    FROM pages p
    WHERE p.book_id = p_book_id AND p.archived = false
  ),
  ver AS (
    SELECT
      pv.page_id,
      md5(coalesce(pv.content::text, '') || '|' || coalesce(pv.title, '')) AS hash
    FROM page_versions pv
    WHERE pv.book_version_id = v_last_version_id AND pv.page_id IS NOT NULL
  )
  SELECT
    COUNT(*)::INTEGER,
    v_last_commit_at
  FROM cur c
  FULL OUTER JOIN ver v ON v.page_id = c.id
  WHERE v.page_id IS NULL
     OR c.id IS NULL
     OR c.hash <> v.hash;
END;
$$;

COMMENT ON FUNCTION get_uncommitted_changes_count(BIGINT) IS 'Returns accurate count of pages differing from the last commit, by JSON content hash.';
