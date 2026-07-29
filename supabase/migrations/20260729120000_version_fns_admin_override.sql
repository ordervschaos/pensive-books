-- Let platform admins commit and publish on books they don't own.
--
-- `create_book_version` and `publish_version` predate the admin-override model and
-- hand-roll a bare `owner_id = auth.uid()` guard. Everything else in the app
-- (check_book_access step 3, user_can_edit_book, the books/book_access RLS policies)
-- already treats a row in `admin_users` as full edit rights, so an admin could open
-- another user's book, edit it, flip is_public — and then hit
-- "Permission denied: You must be the book owner to create a version" at commit time.
-- That left books stuck at is_public = true with published_version_id = NULL, which
-- the marketing site correctly serves as a 404.
--
-- Widened to admins only, matching the inline `admin_users` idiom used elsewhere.
-- Deliberately NOT widened to `user_can_edit_book`, which would also grant invited
-- editors the right to publish a book publicly — a product decision, not a bug fix.
-- `rollback_to_version` keeps its owner-only guard for the same reason (and because
-- its page-restore loop stamps `owner_id = auth.uid()`, which would reassign page
-- ownership to the admin).
--
-- Bodies are otherwise byte-identical to the baseline dump; only the guard changed.

CREATE OR REPLACE FUNCTION "public"."create_book_version"("p_book_id" bigint, "p_commit_message" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_version_number INTEGER;
  v_book_version_id BIGINT;
  v_book RECORD;
BEGIN
  -- Verify user has permission (book owner, or a platform admin acting on their behalf)
  IF NOT EXISTS (
    SELECT 1 FROM books WHERE id = p_book_id AND owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = auth.uid()
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


CREATE OR REPLACE FUNCTION "public"."publish_version"("p_book_id" bigint, "p_version_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Verify user has permission (book owner, or a platform admin acting on their behalf)
  IF NOT EXISTS (
    SELECT 1 FROM books WHERE id = p_book_id AND owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = auth.uid()
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


COMMENT ON FUNCTION "public"."create_book_version"("p_book_id" bigint, "p_commit_message" "text") IS 'Snapshots the book into a new version. Callable by the book owner or a platform admin; committed_by records who actually ran it.';

COMMENT ON FUNCTION "public"."publish_version"("p_book_id" bigint, "p_version_id" bigint) IS 'Publishes a book version. Callable by the book owner or a platform admin. Does NOT update pages table to avoid false uncommitted changes.';
