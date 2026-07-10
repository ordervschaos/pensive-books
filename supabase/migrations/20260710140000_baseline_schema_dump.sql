-- BASELINE SCHEMA — captured 2026-07-10 via `supabase db dump --linked --schema public` against the
-- linked hosted project, schema-only (no data rows). This REPLACES the 135 incremental migration files
-- previously in this directory, now moved to supabase/migrations_archive/ (kept for history, not deleted).
--
-- Why: `supabase start` could not bootstrap a fresh local database from those 135 files — the earliest one
-- (20250127000000_create_page_chats.sql) already assumed public.pages existed, but no migration anywhere in
-- the chain ever created it (or, it turned out, most other core tables). The base schema was established
-- directly on the hosted project (dashboard/manual SQL) before this repo adopted migration-file discipline,
-- and was never captured as a migration. Every later incremental migration replayed fine on the REMOTE
-- project (which already had the base tables) but never once on an empty local database.
--
-- This file is the fix: one authoritative dump of the schema AS IT ACTUALLY EXISTS on the hosted project
-- today, so `supabase start` / `supabase db reset` create a matching local database in one step.
--
-- ⚠️ CAUTION before ever running `supabase db push` again: the remote project's own migration-tracking
-- table (supabase_migrations.schema_migrations) still has all 135 old migration versions recorded as
-- applied. This new baseline file has a version the remote has never seen. Pushing it as-is would make the
-- CLI try to run this entire dump against the remote — which would fail (every object already exists) or
-- worse, partially apply. Before the next push, mark this version applied WITHOUT running it:
--   supabase migration repair <this file's timestamp> --status applied --linked
-- Not done as part of writing this file — deliberately left for whoever runs the next push to do
-- consciously, since it mutates the remote project's migration bookkeeping.
--
-- Not captured here: extensions (pg_net, pg_cron, pgsodium, vault, uuid-ossp, etc.) were enabled directly on
-- the hosted project outside migration tracking too (confirmed: zero CREATE EXTENSION statements in any of
-- the 135 archived files) and are excluded from a --schema public dump. supabase start's local Postgres
-- image ships most of these pre-installed but not all pre-ENABLED — a function that calls e.g. pg_net at
-- RUNTIME may still fail locally even though this file lets it bootstrap and CREATE cleanly (schema
-- validation does not check extension availability). A local-only, follow-on gap if/when it bites.



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";

-- Extensions this schema's types/functions depend on (vector column type, net.http_post calls). Not part
-- of the `--schema public` dump (extensions live outside it) and never captured by any archived migration
-- either — confirmed enabled directly on the hosted project outside migration tracking. Added here so the
-- baseline dump below can actually CREATE (the "vector" column type doesn't exist otherwise) and so the
-- pg_net-based triggers are usable locally, not just able to bootstrap.
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'Old page_history system removed. Using git-like version control (workspace + commit tables) instead.';



CREATE TYPE "public"."book_access_level" AS ENUM (
    'view',
    'edit'
);


ALTER TYPE "public"."book_access_level" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_associated_data"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$BEGIN
    -- Archive associated pages
    UPDATE pages
    SET archived = TRUE
    WHERE notebook_id = NEW.id;

    -- Archive associated reminders
    UPDATE reminders
    SET archived = TRUE
    WHERE notebook_id = NEW.id;

    -- Archive associated notifications
    UPDATE notifications
    SET archived = TRUE
    WHERE notebook_id = NEW.id;

    RETURN NEW;
END;$$;


ALTER FUNCTION "public"."archive_associated_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assert_book_read_access"("p_book_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."assert_book_read_access"("p_book_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_book_access"("p_book_id" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_owner_id uuid;
  v_access_level text;
  v_owner_label text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('has_access', false, 'can_edit', false, 'is_owner', false, 'via_admin', false);
  END IF;

  -- 1. Owner check
  SELECT owner_id INTO v_owner_id FROM books WHERE id = p_book_id;

  IF v_owner_id = v_user_id THEN
    RETURN jsonb_build_object('has_access', true, 'can_edit', true, 'is_owner', true, 'via_admin', false);
  END IF;

  -- 2. Collaborator check
  SELECT access_level INTO v_access_level
  FROM book_access
  WHERE book_id = p_book_id
    AND invited_email = (SELECT email FROM auth.users WHERE id = v_user_id)
  LIMIT 1;

  IF v_access_level IS NOT NULL THEN
    RETURN jsonb_build_object(
      'has_access', true,
      'can_edit',   v_access_level = 'edit',
      'is_owner',   false,
      'via_admin',  false
    );
  END IF;

  -- 3. Admin check → full owner view, flagged as an admin override.
  IF EXISTS (SELECT 1 FROM admin_users WHERE user_id = v_user_id) THEN
    SELECT COALESCE(ud.username, ud.email)
      INTO v_owner_label
      FROM user_data ud
     WHERE ud.user_id = v_owner_id;

    RETURN jsonb_build_object(
      'has_access',  true,
      'can_edit',    true,
      'is_owner',    true,
      'via_admin',   true,
      'owner_label', v_owner_label
    );
  END IF;

  RETURN jsonb_build_object('has_access', false, 'can_edit', false, 'is_owner', false, 'via_admin', false);
END;
$$;


ALTER FUNCTION "public"."check_book_access"("p_book_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_book_access"("book_id" integer, "user_email" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM book_access
    WHERE book_access.book_id = $1
    AND book_access.invited_email = $2
    AND book_access.status = 'accepted'
  );
END;
$_$;


ALTER FUNCTION "public"."check_book_access"("book_id" integer, "user_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."commit_from_workspace"("p_book_id" integer, "p_user_id" "uuid", "p_message" "text", "p_include_paths" "text"[] DEFAULT NULL::"text"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_workspace_id UUID;
  v_base_commit_id UUID;
  v_new_commit_id UUID;
  v_meta_hash TEXT;
  v_meta_content JSONB;
  v_page_record RECORD;
  v_page_id INTEGER;
  v_page_content JSONB;
BEGIN
  -- 1. Get workspace
  SELECT id, base_commit_id INTO v_workspace_id, v_base_commit_id
  FROM workspace
  WHERE user_id = p_user_id AND book_id = p_book_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'No workspace found for user % and book %', p_user_id, p_book_id;
  END IF;

  -- 2. Create metadata blob
  SELECT jsonb_build_object(
    'name', name,
    'subtitle', subtitle,
    'author', author,
    'cover_url', cover_url,
    'show_text_on_cover', show_text_on_cover
  )
  INTO v_meta_content
  FROM books
  WHERE id = p_book_id;

  -- Hash the metadata
  v_meta_hash := encode(sha256(convert_to(v_meta_content::text, 'UTF8')), 'hex');

  -- Insert metadata blob
  INSERT INTO blob_json (hash, content)
  VALUES (v_meta_hash, v_meta_content)
  ON CONFLICT (hash) DO NOTHING;

  -- 3. Create commit
  INSERT INTO commit (book_id, parent_id, message, meta_hash, created_by)
  VALUES (p_book_id, v_base_commit_id, p_message, v_meta_hash, p_user_id)
  RETURNING id INTO v_new_commit_id;

  -- 4. Build commit tree: carry forward pages from parent
  IF v_base_commit_id IS NOT NULL THEN
    INSERT INTO commit_entry (commit_id, page_path, blob_hash, page_index)
    SELECT v_new_commit_id, page_path, blob_hash, page_index
    FROM commit_entry
    WHERE commit_id = v_base_commit_id
    ON CONFLICT (commit_id, page_path) DO NOTHING;
  END IF;

  -- 5. Override with workspace changes AND sync to pages table
  FOR v_page_record IN
    SELECT page_path, blob_hash
    FROM workspace_page
    WHERE workspace_id = v_workspace_id
      AND (p_include_paths IS NULL OR page_path = ANY(p_include_paths))
  LOOP
    -- Upsert into commit_entry
    INSERT INTO commit_entry (commit_id, page_path, blob_hash)
    VALUES (v_new_commit_id, v_page_record.page_path, v_page_record.blob_hash)
    ON CONFLICT (commit_id, page_path) DO UPDATE
    SET blob_hash = EXCLUDED.blob_hash;

    -- SYNC TO PAGES TABLE (so commits update the working copy)
    -- Extract page ID from path (e.g., "page-123" -> 123)
    v_page_id := NULLIF(regexp_replace(v_page_record.page_path, '[^0-9]', '', 'g'), '')::INTEGER;

    IF v_page_id IS NOT NULL THEN
      -- Get content from blob
      SELECT content INTO v_page_content
      FROM blob_json
      WHERE hash = v_page_record.blob_hash;

      -- Update pages table
      UPDATE pages
      SET
        content = v_page_content,
        updated_at = NOW()
      WHERE id = v_page_id AND book_id = p_book_id;
    END IF;
  END LOOP;

  -- 6. Update workspace base commit
  UPDATE workspace
  SET base_commit_id = v_new_commit_id, updated_at = NOW()
  WHERE id = v_workspace_id;

  -- 7. Clear committed pages from workspace
  DELETE FROM workspace_page
  WHERE workspace_id = v_workspace_id
    AND (p_include_paths IS NULL OR page_path = ANY(p_include_paths));

  RETURN v_new_commit_id;
END;
$$;


ALTER FUNCTION "public"."commit_from_workspace"("p_book_id" integer, "p_user_id" "uuid", "p_message" "text", "p_include_paths" "text"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."commit_from_workspace"("p_book_id" integer, "p_user_id" "uuid", "p_message" "text", "p_include_paths" "text"[]) IS 'Create commit from workspace and sync to pages table (working copy)';



CREATE OR REPLACE FUNCTION "public"."create_book_version"("p_book_id" bigint, "p_commit_message" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."create_book_version"("p_book_id" bigint, "p_commit_message" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_book_version"("p_book_id" bigint, "p_commit_message" "text") IS 'Creates an immutable snapshot of a book and all its pages. Returns version ID.';



CREATE OR REPLACE FUNCTION "public"."create_next_page"("p_book_id" integer) RETURNS TABLE("id" integer, "book_id" integer, "page_index" integer, "content" "jsonb", "html_content" "text", "page_type" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  next_index INTEGER;
BEGIN
  -- Get the maximum page_index for non-archived pages only
  -- This prevents gaps when archived pages have higher indices
  SELECT COALESCE(MAX(pages.page_index), -1) INTO next_index
  FROM pages
  WHERE pages.book_id = p_book_id
    AND (pages.archived = false OR pages.archived IS NULL);

  -- Insert the new page with the next index
  RETURN QUERY
  INSERT INTO pages (
    book_id,
    page_index,
    content,
    html_content,
    page_type,
    archived
  )
  VALUES (
    p_book_id,
    next_index + 1,
    '{}'::JSONB,
    '',
    'text',
    false
  )
  RETURNING
    pages.id,
    pages.book_id,
    pages.page_index,
    pages.content,
    pages.html_content,
    pages.page_type,
    pages.created_at,
    pages.updated_at;
END;
$$;


ALTER FUNCTION "public"."create_next_page"("p_book_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dna_jsonb_replace_text"("data" "jsonb", "find_word" "text", "replace_word" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  pattern text := '\m' || public.dna_regex_escape(find_word) || '\M';
  result jsonb;
  entry_key text;
  entry_val jsonb;
  elem jsonb;
begin
  if data is null then
    return null;
  end if;

  case jsonb_typeof(data)
    when 'string' then
      return to_jsonb(regexp_replace(data #>> '{}', pattern, replace_word, 'g'));
    when 'object' then
      result := '{}'::jsonb;
      for entry_key, entry_val in select o.key, o.value from jsonb_each(data) o loop
        result := result || jsonb_build_object(entry_key, public.dna_jsonb_replace_text(entry_val, find_word, replace_word));
      end loop;
      return result;
    when 'array' then
      result := '[]'::jsonb;
      for elem in select * from jsonb_array_elements(data) loop
        result := result || jsonb_build_array(public.dna_jsonb_replace_text(elem, find_word, replace_word));
      end loop;
      return result;
    else
      return data;
  end case;
end;
$$;


ALTER FUNCTION "public"."dna_jsonb_replace_text"("data" "jsonb", "find_word" "text", "replace_word" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."dna_jsonb_replace_text"("data" "jsonb", "find_word" "text", "replace_word" "text") IS 'Recursively replaces whole-word occurrences of find_word with replace_word in every string value of a jsonb tree.';



CREATE OR REPLACE FUNCTION "public"."dna_regex_escape"("input" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  select regexp_replace(input, '([\\.^$|()\[\]{}*+?])', '\\\1', 'g');
$_$;


ALTER FUNCTION "public"."dna_regex_escape"("input" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."dna_regex_escape"("input" "text") IS 'Escapes POSIX regex metacharacters so a literal string can be dropped into a regexp_replace pattern.';



CREATE OR REPLACE FUNCTION "public"."expire_stalled_ai_calls"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.ai_calls
  set
    status = 'error',
    error  = 'timed out — worker exited before logging a result',
    latency_ms = extract(epoch from (now() - created_at))::int * 1000
  where status = 'running'
    and created_at < now() - interval '10 minutes';
end;
$$;


ALTER FUNCTION "public"."expire_stalled_ai_calls"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."expire_stalled_ai_calls"() IS 'Every 5 minutes: mark ai_calls rows stuck in ''running'' for >10 min as error (worker died before logging).';



CREATE OR REPLACE FUNCTION "public"."generate_slug"("input_text" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN lower(regexp_replace(
        regexp_replace(
            coalesce(input_text, 'untitled'),
            '[^a-zA-Z0-9\s-]',
            '',
            'g'
        ),
        '\s+',
        '-',
        'g'
    ));
END;
$$;


ALTER FUNCTION "public"."generate_slug"("input_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'total_books',  (SELECT count(*) FROM books WHERE NOT is_archived),
    'total_pages',  (SELECT count(*) FROM pages WHERE archived = false OR archived IS NULL),
    'total_users',  (SELECT count(*) FROM user_data),
    'books', (
      SELECT COALESCE(jsonb_agg(b ORDER BY b.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT
          bk.id,
          bk.name,
          bk.slug,
          bk.owner_id,
          bk.created_at,
          bk.is_public,
          bk.published_at,
          bk.is_archived,
          ud.email        AS owner_email,
          ud.username     AS owner_username,
          (SELECT count(*) FROM pages p WHERE p.book_id = bk.id AND (p.archived = false OR p.archived IS NULL))::int AS page_count
        FROM books bk
        LEFT JOIN user_data ud ON ud.user_id = bk.owner_id
        WHERE NOT bk.is_archived
      ) b
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_admin_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_draft_changes"("p_book_id" bigint) RETURNS TABLE("page_id" bigint, "title" "text", "page_index" integer, "status" "text", "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."get_draft_changes"("p_book_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_draft_changes"("p_book_id" bigint) IS 'Returns pages that differ from the last committed version (added/deleted/modified) using JSON content hashes. No content transferred.';



CREATE OR REPLACE FUNCTION "public"."get_uncommitted_changes_count"("p_book_id" bigint) RETURNS TABLE("changed_pages" integer, "last_commit_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."get_uncommitted_changes_count"("p_book_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_uncommitted_changes_count"("p_book_id" bigint) IS 'Returns accurate count of pages differing from the last commit, by JSON content hash.';



CREATE OR REPLACE FUNCTION "public"."get_version_details"("p_version_id" bigint) RETURNS TABLE("version_id" bigint, "book_id" bigint, "version_number" integer, "book_name" "text", "commit_message" "text", "committed_at" timestamp with time zone, "committed_by" "uuid", "is_published" boolean, "published_at" timestamp with time zone, "page_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."get_version_details"("p_version_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_version_details"("p_version_id" bigint) IS 'Returns detailed information about a specific book version';



CREATE OR REPLACE FUNCTION "public"."get_version_history"("p_book_id" bigint) RETURNS TABLE("version_id" bigint, "version_number" integer, "commit_message" "text", "committed_at" timestamp with time zone, "committed_by" "uuid", "committer_email" "text", "is_published" boolean, "published_at" timestamp with time zone, "page_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."get_version_history"("p_book_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_version_history"("p_book_id" bigint) IS 'Returns chronological list of all versions for a book';



CREATE OR REPLACE FUNCTION "public"."highlight_search_results_in_page"("search_query" "text") RETURNS TABLE("page_id" integer, "highlighted_content" "text", "notebook_id" integer)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    pages.id AS page_id,
    ts_headline(
      'english',
      pages.html_content::text,
      to_tsquery('english', search_query),
      'StartSel = "<span class=''highlighted_words''>", StopSel = "</span>", MaxWords = 55, MinWords = 10, ShortWord = 3, FragmentDelimiter = "... ", MaxFragments = 3'
    ) AS highlighted_content,
    pages.book_id AS notebook_id
  FROM
    pages
  WHERE
    to_tsvector('english', pages.html_content::text) @@ to_tsquery('english', search_query)
    AND pages.archived = false;
END;
$$;


ALTER FUNCTION "public"."highlight_search_results_in_page"("search_query" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."pages" (
    "id" integer NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"(),
    "book_id" integer,
    "old_content" "text",
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "archived" boolean DEFAULT false,
    "last_published_at" timestamp without time zone,
    "page_index" integer,
    "embedding" "extensions"."vector",
    "content" "jsonb" DEFAULT '{}'::"jsonb",
    "html_content" "text",
    "title" "text" DEFAULT ''::"text",
    "page_type" "text" DEFAULT 'text'::"text" NOT NULL,
    "slug" "text",
    "git_status" "text" DEFAULT 'clean'::"text",
    "last_committed_at" timestamp with time zone,
    "is_draft" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb",
    "last_ai_call_id" bigint,
    "scene_spec" "jsonb",
    CONSTRAINT "pages_git_status_check" CHECK (("git_status" = ANY (ARRAY['untracked'::"text", 'modified'::"text", 'deleted'::"text", 'clean'::"text"])))
);


ALTER TABLE "public"."pages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pages"."is_draft" IS 'Always true - pages table represents the working draft/workspace';



COMMENT ON COLUMN "public"."pages"."metadata" IS 'Author-only page metadata (objective, …). Never shown to readers.';



COMMENT ON COLUMN "public"."pages"."last_ai_call_id" IS 'ai_calls row whose prose generation last wrote this page''s body (admin lineage; null for hand-written or pre-feature pages).';



CREATE OR REPLACE FUNCTION "public"."match_documents"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "min_content_length" integer, "owner_id" "uuid") RETURNS SETOF "public"."pages"
    LANGUAGE "plpgsql"
    AS $$BEGIN
  RETURN QUERY
  SELECT *
  FROM pages
  WHERE (pages.embedding <#> query_embedding) < match_threshold
    AND LENGTH(pages.content) >= min_content_length
    AND pages.owner_id = match_documents.owner_id
  ORDER BY pages.embedding <#> query_embedding
  LIMIT match_count;
END;$$;


ALTER FUNCTION "public"."match_documents"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "min_content_length" integer, "owner_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_book_page_indices"("p_book_id" integer) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  page_record RECORD;
  new_index INTEGER := 0;
BEGIN
  -- Step 1: Move all pages to temporary negative indices to avoid unique constraint conflicts
  -- This is necessary because we have a unique constraint on (book_id, page_index)
  FOR page_record IN
    SELECT id, page_index
    FROM pages
    WHERE book_id = p_book_id
      AND (archived = false OR archived IS NULL)
    ORDER BY page_index ASC, id ASC
  LOOP
    UPDATE pages
    SET page_index = -(page_record.id + 10000) -- Use negative ID-based temp index
    WHERE id = page_record.id;
  END LOOP;

  -- Step 2: Now update to final sequential indices
  FOR page_record IN
    SELECT id
    FROM pages
    WHERE book_id = p_book_id
      AND (archived = false OR archived IS NULL)
    ORDER BY page_index DESC, id ASC -- DESC because indices are negative now
  LOOP
    UPDATE pages
    SET page_index = new_index,
        updated_at = NOW()
    WHERE id = page_record.id;

    new_index := new_index + 1;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."normalize_book_page_indices"("p_book_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_revalidate_book"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_secret text;
  -- Marketing (public) site origin. Matches PROD_APP_ORIGIN's sibling in
  -- apps/marketing/lib/pensive.ts (the app lives at app.pensive.me).
  v_url text := 'https://pensive.me/api/revalidate';
begin
  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'revalidate_secret'
  limit 1;

  -- Fire-and-forget. pg_net queues the request and returns immediately, so the
  -- publish transaction is never blocked or rolled back by revalidation.
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('bookId', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-revalidate-secret', coalesce(v_secret, '')
    )
  );

  return new;
exception
  when others then
    -- Never let a revalidation problem break publishing / visibility changes.
    raise warning 'notify_revalidate_book failed: %', sqlerrm;
    return new;
end;
$$;


ALTER FUNCTION "public"."notify_revalidate_book"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."notify_revalidate_book"() IS 'Pings the marketing /api/revalidate endpoint (via pg_net) when a public book changes, so the Next.js cache refreshes immediately.';



CREATE OR REPLACE FUNCTION "public"."notify_task_done"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_secret text;
  v_url text := 'https://qiqeyirtpstdjkkeyfss.supabase.co/functions/v1/notify-task-done';
begin
  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'notify_task_secret'
  limit 1;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('table', tg_table_name, 'id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', coalesce(v_secret, '')
    ),
    timeout_milliseconds := 15000
  );

  return new;
exception
  when others then
    raise warning 'notify_task_done failed: %', sqlerrm;
    return new;
end;
$$;


ALTER FUNCTION "public"."notify_task_done"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."notify_task_done"() IS 'Pings notify-task-done (via pg_net) when an opted-in AI task reaches a terminal state, so the author gets an email.';



CREATE OR REPLACE FUNCTION "public"."propagate_character_rename"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  old_name text := old.content ->> 'name';
  new_name text := new.content ->> 'name';
  match_pattern text;
begin
  if old_name is null or old_name = '' or new_name is null or new_name = '' then
    return new;
  end if;

  match_pattern := '\m' || public.dna_regex_escape(old_name) || '\M';

  begin
    update public.book_nodes n
    set content = case
          when n.content ? 'name'
            then jsonb_set(
                   public.dna_jsonb_replace_text(n.content, old_name, new_name),
                   '{name}', n.content -> 'name'
                 )
          else public.dna_jsonb_replace_text(n.content, old_name, new_name)
        end,
        authoring = public.dna_jsonb_replace_text(n.authoring, old_name, new_name)
    where n.book_id = new.book_id
      and n.id <> new.id
      and (n.content::text ~ match_pattern or n.authoring::text ~ match_pattern);
  exception
    when others then
      -- Never let the rename fan-out break the author's actual edit.
      raise warning 'propagate_character_rename failed for book_node %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;


ALTER FUNCTION "public"."propagate_character_rename"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."propagate_character_rename"() IS 'On book_nodes.content->>name change, propagates the rename into every other prose/free-text mention across the same book.';



CREATE OR REPLACE FUNCTION "public"."publish_version"("p_book_id" bigint, "p_version_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."publish_version"("p_book_id" bigint, "p_version_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."publish_version"("p_book_id" bigint, "p_version_id" bigint) IS 'Publishes a book version. Does NOT update pages table to avoid false uncommitted changes.';



CREATE OR REPLACE FUNCTION "public"."revert_page"("p_book_id" bigint, "p_page_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."revert_page"("p_book_id" bigint, "p_page_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."revert_page"("p_book_id" bigint, "p_page_id" bigint) IS 'Reverts one page to the last committed snapshot, or archives it if it was added after the last commit.';



CREATE OR REPLACE FUNCTION "public"."revive_stalled_chains"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_secret text;
  v_base   text := 'https://qiqeyirtpstdjkkeyfss.supabase.co/functions/v1';
  v_stale  interval := interval '5 minutes';
  r        record;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'chain_secret' limit 1;
  if v_secret is null then
    raise warning 'revive_stalled_chains: no chain_secret in vault; skipping';
    return;
  end if;

  -- write_all cascades stuck in 'running'
  for r in
    select id from public.book_generations
    where kind = 'write_all' and status = 'running' and updated_at < now() - v_stale
  loop
    perform net.http_post(
      url := v_base || '/generate-book',
      body := jsonb_build_object('generationId', r.id, 'chain', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-chain', v_secret)
    );
  end loop;

  -- revise builds stuck in 'building'
  for r in
    select id from public.book_revisions
    where status = 'building' and not cancel_requested and updated_at < now() - v_stale
  loop
    perform net.http_post(
      url := v_base || '/build-revision',
      body := jsonb_build_object('revisionId', r.id, 'chain', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-chain', v_secret)
    );
  end loop;

  -- editor's-agent runs stuck in 'running' (never awaiting_input — that waits on the author)
  for r in
    select id from public.book_agent_runs
    where status = 'running' and not cancel_requested and updated_at < now() - v_stale
  loop
    perform net.http_post(
      url := v_base || '/book-agent',
      body := jsonb_build_object('runId', r.id, 'chain', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-chain', v_secret)
    );
  end loop;

  -- imported-draft decompositions stuck in 'running' (cancel is a status, not a flag, here —
  -- stopRun sets status='cancelled' directly, so the 'running' filter already excludes it)
  for r in
    select id from public.book_decompositions
    where status = 'running' and updated_at < now() - v_stale
  loop
    perform net.http_post(
      url := v_base || '/dna-decompose',
      body := jsonb_build_object('id', r.id, 'chain', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-chain', v_secret)
    );
  end loop;
end;
$$;


ALTER FUNCTION "public"."revive_stalled_chains"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."revive_stalled_chains"() IS 'Once-a-minute pg_cron job: re-invokes the continue call of any generate-book / build-revision / book-agent / dna-decompose job whose self-chain stalled (no progress for 5 min).';



CREATE OR REPLACE FUNCTION "public"."rollback_to_version"("p_book_id" bigint, "p_version_id" bigint) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."rollback_to_version"("p_book_id" bigint, "p_version_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rollback_to_version"("p_book_id" bigint, "p_version_id" bigint) IS 'Restores workspace to a previous version and creates a rollback commit';



CREATE OR REPLACE FUNCTION "public"."search_book_contents"("search_query" "text", "book_id" integer) RETURNS TABLE("page_id" integer, "highlighted_content" "text", "notebook_id" integer, "title" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    pages.id AS page_id,
    ts_headline(
      'english',
      pages.html_content::text,
      plainto_tsquery('english', search_query),
      'StartSel = "<span class=""highlighted_words"">"' || 
      ', StopSel = "</span>"' || 
      ', MaxWords = 55' || 
      ', MinWords = 10' || 
      ', ShortWord = 3' || 
      ', FragmentDelimiter = " ... "' || 
      ', MaxFragments = 3'
    ) AS highlighted_content,
    pages.book_id AS notebook_id,
    pages.title AS title
  FROM
    pages
  WHERE
    (
      to_tsvector('english', pages.html_content::text) @@ plainto_tsquery('english', search_query)
      OR
      to_tsvector('english', pages.title::text) @@ plainto_tsquery('english', search_query)
    )
    AND pages.archived = false
    AND pages.book_id = search_book_contents.book_id;
END;
$$;


ALTER FUNCTION "public"."search_book_contents"("search_query" "text", "book_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."similarity_search"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "min_content_length" integer) RETURNS TABLE("id" integer, "content" "jsonb", "html_content" "text", "embedding" "extensions"."vector", "distance" double precision)
    LANGUAGE "plpgsql"
    AS $$begin
    return query
    select 
      pages.id,
      pages.content,
      pages.html_content,
      pages.embedding,
      (pages.embedding <#> query_embedding) as distance,
      length(pages.content) as content_length
    from 
      pages
    where 
      (pages.embedding <#> query_embedding) < match_threshold
      and pages.archived = false
      and length(pages.content) >= min_content_length
    order by 
      distance asc,
      content_length desc
    limit match_count;
end;$$;


ALTER FUNCTION "public"."similarity_search"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "min_content_length" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snapshot_book_tree"("p_book_id" integer, "p_label" "text" DEFAULT NULL::"text", "p_keep_auto" integer DEFAULT 30) RETURNS bigint
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_id bigint;
  v_nodes jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(n) - 'created_at' - 'updated_at' ORDER BY n.position), '[]'::jsonb)
    INTO v_nodes
  FROM public.book_nodes n
  WHERE n.book_id = p_book_id;

  INSERT INTO public.book_tree_versions (book_id, label, nodes)
  VALUES (p_book_id, p_label, v_nodes)
  RETURNING id INTO v_id;

  DELETE FROM public.book_tree_versions
  WHERE book_id = p_book_id
    AND label IS NULL
    AND id NOT IN (
      SELECT id FROM public.book_tree_versions
      WHERE book_id = p_book_id AND label IS NULL
      ORDER BY created_at DESC
      LIMIT p_keep_auto
    );

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."snapshot_book_tree"("p_book_id" integer, "p_label" "text", "p_keep_auto" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_commit_to_pages"("p_commit_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_book_id INTEGER;
  v_page_record RECORD;
  v_page_id INTEGER;
  v_page_content JSONB;
BEGIN
  -- Get book ID from commit
  SELECT book_id INTO v_book_id
  FROM commit
  WHERE id = p_commit_id;

  IF v_book_id IS NULL THEN
    RAISE EXCEPTION 'Commit % not found', p_commit_id;
  END IF;

  -- Update all pages from this commit
  FOR v_page_record IN
    SELECT page_path, blob_hash
    FROM commit_entry
    WHERE commit_id = p_commit_id
  LOOP
    -- Extract page ID from path
    v_page_id := NULLIF(regexp_replace(v_page_record.page_path, '[^0-9]', '', 'g'), '')::INTEGER;

    IF v_page_id IS NOT NULL THEN
      -- Get content from blob
      SELECT content INTO v_page_content
      FROM blob_json
      WHERE hash = v_page_record.blob_hash;

      -- Update pages table (what readers see)
      UPDATE pages
      SET
        content = v_page_content,
        updated_at = NOW(),
        last_published_at = NOW()
      WHERE id = v_page_id AND book_id = v_book_id;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."sync_commit_to_pages"("p_commit_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sync_commit_to_pages"("p_commit_id" "uuid") IS 'Sync a commit to the pages table (used when publishing)';



CREATE OR REPLACE FUNCTION "public"."touch_beat_chats_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_beat_chats_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_book_agent_runs_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_book_agent_runs_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_book_decompositions_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_book_decompositions_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_book_generations_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_book_generations_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_book_nodes_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."touch_book_nodes_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_book_revisions_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_book_revisions_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_book_threads_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_book_threads_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_dna_chats_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."touch_dna_chats_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_revision_chats_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_revision_chats_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_book_draft_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Mark book as modified when any page is updated
  UPDATE books
  SET current_draft_status = 'modified'
  WHERE id = NEW.book_id
    AND current_draft_status = 'clean';

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_book_draft_status"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_book_draft_status"() IS 'Automatically marks book as modified when pages are changed';



CREATE OR REPLACE FUNCTION "public"."update_book_git_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Update the book's has_uncommitted_changes flag
    UPDATE books
    SET has_uncommitted_changes = TRUE
    WHERE id = COALESCE(NEW.book_id, OLD.book_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."update_book_git_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_habit_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_habit_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_modified_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_modified_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_notebook_on_page_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Check if this is an INSERT or UPDATE operation
    IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE') THEN
        -- Update the 'updated_at' column in the 'books' table (changed from notebooks)
        UPDATE books
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.book_id;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_notebook_on_page_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_page_audio_blocks_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_page_audio_blocks_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_slug"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- For books table, use name field
    IF TG_TABLE_NAME = 'books' THEN
        NEW.slug := generate_slug(COALESCE(NEW.name, 'untitled'));
    -- For pages table, use title field
    ELSIF TG_TABLE_NAME = 'pages' THEN
        NEW.slug := generate_slug(COALESCE(NEW.title, 'untitled'));
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_slug"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_can_edit_book"("_book_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.books
    WHERE books.id = _book_id
      AND books.owner_id = auth.uid()
  )
  OR public.user_is_book_editor(_book_id)
  OR EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE admin_users.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."user_can_edit_book"("_book_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_has_book_access_accepted"("_book_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.book_access
    WHERE book_access.book_id = _book_id
      AND book_access.invited_email = (auth.jwt() ->> 'email')
      AND book_access.status = 'accepted'
  );
$$;


ALTER FUNCTION "public"."user_has_book_access_accepted"("_book_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_has_book_access_any_status"("_book_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.book_access
    WHERE book_access.book_id = _book_id
      AND book_access.invited_email = (auth.jwt() ->> 'email')
  );
$$;


ALTER FUNCTION "public"."user_has_book_access_any_status"("_book_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_is_book_editor"("_book_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.book_access
    WHERE book_access.book_id = _book_id
      AND book_access.invited_email = (auth.jwt() ->> 'email')
      AND book_access.access_level = 'edit'
      AND book_access.status = 'accepted'
  );
$$;


ALTER FUNCTION "public"."user_is_book_editor"("_book_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vector_page_search"("query_embedding" "extensions"."vector", "match_threshold" double precision, "min_content_length" integer, "match_count" integer) RETURNS TABLE("id" integer, "content" "text", "embedding" "extensions"."vector")
    LANGUAGE "plpgsql"
    AS $$begin
  return query
  select 
    pages.id,
    pages.content,
    pages.embedding
  from 
    pages
  where 
    (pages.embedding <#> query_embedding) < match_threshold
    and length(pages.content) >= min_content_length
    and pages.archived = false
  order by 
    pages.embedding <#> query_embedding
  limit match_count;
end;$$;


ALTER FUNCTION "public"."vector_page_search"("query_embedding" "extensions"."vector", "match_threshold" double precision, "min_content_length" integer, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."workspace_page_upsert"("p_workspace_id" "uuid", "p_page_path" "text", "p_blob_hash" "text", "p_expected_version" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_new_version INTEGER;
BEGIN
  -- Try to update existing row
  UPDATE workspace_page
  SET
    blob_hash = p_blob_hash,
    version = version + 1,
    updated_at = NOW()
  WHERE
    workspace_id = p_workspace_id
    AND page_path = p_page_path
    AND version = p_expected_version
  RETURNING version INTO v_new_version;

  -- If no rows updated, version conflict or new page
  IF NOT FOUND THEN
    -- Check if page exists
    IF EXISTS (
      SELECT 1 FROM workspace_page
      WHERE workspace_id = p_workspace_id AND page_path = p_page_path
    ) THEN
      -- Version conflict
      RAISE EXCEPTION 'version conflict: expected % but got different version', p_expected_version;
    ELSE
      -- New page
      INSERT INTO workspace_page (workspace_id, page_path, blob_hash, version)
      VALUES (p_workspace_id, p_page_path, p_blob_hash, 0)
      RETURNING version INTO v_new_version;
    END IF;
  END IF;

  RETURN v_new_version;
END;
$$;


ALTER FUNCTION "public"."workspace_page_upsert"("p_workspace_id" "uuid", "p_page_path" "text", "p_blob_hash" "text", "p_expected_version" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_users" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_call_evals" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ai_call_id" bigint NOT NULL,
    "book_id" integer,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "judge_model" "text",
    "scores" "jsonb",
    "verdict" "text",
    "findings" "jsonb",
    "amendments" "jsonb",
    "error" "text",
    CONSTRAINT "ai_call_evals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."ai_call_evals" OWNER TO "postgres";


ALTER TABLE "public"."ai_call_evals" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_call_evals_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ai_calls" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "book_id" integer,
    "task_table" "text",
    "task_id" bigint,
    "fn" "text" NOT NULL,
    "source" "text" DEFAULT 'edge'::"text" NOT NULL,
    "model" "text",
    "system" "text",
    "input" "jsonb",
    "output" "text",
    "input_tokens" integer,
    "output_tokens" integer,
    "latency_ms" integer,
    "stop_reason" "text",
    "error" "text",
    "status" "text" DEFAULT 'done'::"text" NOT NULL,
    "user_id" "uuid",
    "artifacts" "jsonb",
    "node_id" "text",
    "operation" "text",
    "provider" "text",
    CONSTRAINT "ai_calls_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'done'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."ai_calls" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ai_calls"."artifacts" IS 'Labeled inputs that composed this call''s prompt (brief, objective, beat, character_states, open_loops, story_so_far, preceding_prose refs). Provenance for admin transparency; the full merged prompt is still in `input`.';



COMMENT ON COLUMN "public"."ai_calls"."provider" IS 'Host that served the call (anthropic | openrouter | deepseek | mulerouter), as resolved by resolveRoute from the model id and the ai_provider admin setting. Null for rows logged before 2026-07-10.';



ALTER TABLE "public"."ai_calls" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_calls_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."beat_chats" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'idle'::"text" NOT NULL,
    "messages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "pending_plan" "jsonb",
    "error" "text"
);


ALTER TABLE "public"."beat_chats" OWNER TO "postgres";


ALTER TABLE "public"."beat_chats" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."beat_chats_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."blob_json" (
    "hash" "text" NOT NULL,
    "content" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."blob_json" OWNER TO "postgres";


COMMENT ON TABLE "public"."blob_json" IS 'Content-addressable storage for page content (deduplication via SHA-256)';



CREATE TABLE IF NOT EXISTS "public"."book_access" (
    "id" bigint NOT NULL,
    "book_id" integer,
    "user_id" "uuid",
    "access_level" "public"."book_access_level" NOT NULL,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "status" "text" DEFAULT '''accepted''::text'::"text",
    "invited_email" "text",
    "invitation_token" "uuid"
);


ALTER TABLE "public"."book_access" OWNER TO "postgres";


ALTER TABLE "public"."book_access" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."book_access_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_agent_runs" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "evaluation" "jsonb",
    "transcript" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "steps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "pending" "jsonb",
    "turns" integer DEFAULT 0 NOT NULL,
    "revision_id" bigint,
    "report" "text",
    "cancel_requested" boolean DEFAULT false NOT NULL,
    "error" "text",
    "target_page_id" integer,
    "kind" "text" DEFAULT 'eval'::"text" NOT NULL,
    "proposals" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "context_scope" "jsonb",
    "context_analysis" "text",
    "context_effort" "text",
    "context_auto" boolean DEFAULT false NOT NULL,
    "context_objective" "text",
    "context_attached_ids" "jsonb",
    "title" "text",
    CONSTRAINT "book_agent_runs_context_effort_check" CHECK (("context_effort" = ANY (ARRAY['low'::"text", 'high'::"text"])))
);

ALTER TABLE ONLY "public"."book_agent_runs" REPLICA IDENTITY FULL;


ALTER TABLE "public"."book_agent_runs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."book_agent_runs"."kind" IS 'eval = per-run editor agent / prose chat (terminal done); thread = the persistent omni-rail conversation (turns end idle).';



COMMENT ON COLUMN "public"."book_agent_runs"."context_scope" IS 'Thread scope: which book aspects (promise/characters/beats/scenes/prose) the agent sees + can edit. NULL = all.';



COMMENT ON COLUMN "public"."book_agent_runs"."context_analysis" IS 'Latest client-computed story analysis (pacing/promises/topography lints) for the thread; refreshed each message, fed to the agent as a backstop.';



COMMENT ON COLUMN "public"."book_agent_runs"."context_objective" IS 'Latest client-computed current journey objective (the now stage/sub-step + its recipe) for the thread; refreshed each message, injected into the agent prompt as a guided-flow anchor.';



COMMENT ON COLUMN "public"."book_agent_runs"."context_attached_ids" IS 'Latest author-attached DNA node ids (the context tray) for the thread; refreshed each message, hydrated into the agent prompt as a live <focus> block.';



ALTER TABLE "public"."book_agent_runs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."book_agent_runs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_agent_sessions" (
    "id" bigint NOT NULL,
    "thread_id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "steps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "transcript" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "proposals" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "ended_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" "text"
);


ALTER TABLE "public"."book_agent_sessions" OWNER TO "postgres";


ALTER TABLE "public"."book_agent_sessions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."book_agent_sessions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_chats" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "messages" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."book_chats" OWNER TO "postgres";


ALTER TABLE "public"."book_chats" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."book_chats_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_commits" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "commit_sha" "text" NOT NULL,
    "message" "text" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "parent_sha" "text"
);


ALTER TABLE "public"."book_commits" OWNER TO "postgres";


ALTER TABLE "public"."book_commits" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."book_commits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_decompositions" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "phase" "text" DEFAULT 'chapters'::"text" NOT NULL,
    "done" integer DEFAULT 0 NOT NULL,
    "total" integer DEFAULT 0 NOT NULL,
    "digests" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "skipped" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "error" "text",
    "attempts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "book_decompositions_phase_chk" CHECK (("phase" = ANY (ARRAY['chapters'::"text", 'top'::"text", 'acts'::"text", 'entities'::"text", 'systems'::"text", 'seal'::"text"]))),
    CONSTRAINT "book_decompositions_status_chk" CHECK (("status" = ANY (ARRAY['running'::"text", 'done'::"text", 'cancelled'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."book_decompositions" OWNER TO "postgres";


ALTER TABLE "public"."book_decompositions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."book_decompositions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_evaluations" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" DEFAULT 'fiction'::"text" NOT NULL,
    "model" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "word_count" integer,
    "brief_snapshot" "jsonb",
    "result" "jsonb",
    "error" "text",
    "notify_email" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."book_evaluations" OWNER TO "postgres";


ALTER TABLE "public"."book_evaluations" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."book_evaluations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_generations" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" NOT NULL,
    "scope" "text" DEFAULT 'book'::"text" NOT NULL,
    "target_page_id" bigint,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "input" "jsonb",
    "result" "jsonb",
    "progress" "jsonb",
    "error" "text",
    "notify_email" boolean DEFAULT false NOT NULL,
    "target_key" "text",
    CONSTRAINT "book_generations_kind_chk" CHECK (("kind" = ANY (ARRAY['page_write'::"text", 'page_revise'::"text", 'write_all'::"text", 'rerender_stale'::"text", 'scaffold'::"text", 'bible'::"text", 'voice'::"text", 'auto_revise'::"text", 'spine'::"text", 'spine_options'::"text", 'objective_options'::"text", 'node_revise'::"text", 'beat_candidates'::"text", 'foundations_options'::"text", 'spine_routes'::"text", 'autopilot'::"text"]))),
    CONSTRAINT "book_generations_status_chk" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'ready'::"text", 'applied'::"text", 'dismissed'::"text", 'cancelled'::"text", 'done'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."book_generations" OWNER TO "postgres";


ALTER TABLE "public"."book_generations" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."book_generations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_nodes" (
    "id" "text" NOT NULL,
    "book_id" integer NOT NULL,
    "parent_id" "text",
    "level" smallint NOT NULL,
    "kind" "text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "content" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "authoring" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "proposals" "jsonb",
    "chosen" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_ai_call_id" bigint,
    CONSTRAINT "book_nodes_kind_chk" CHECK (("kind" = ANY (ARRAY['seed'::"text", 'premise'::"text", 'pillar'::"text", 'act'::"text", 'beat'::"text", 'scene'::"text", 'character'::"text", 'relationship'::"text", 'tentpole'::"text", 'world_fact'::"text", 'location'::"text", 'thread'::"text", 'game'::"text", 'meter'::"text", 'voice_profile'::"text"])))
);

ALTER TABLE ONLY "public"."book_nodes" REPLICA IDENTITY FULL;


ALTER TABLE "public"."book_nodes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."book_nodes"."last_ai_call_id" IS 'ai_calls row whose generation last wrote this node''s content (author transparency via the tree''s view-details panel); null for hand-written nodes.';



CREATE TABLE IF NOT EXISTS "public"."book_publish_pointer" (
    "book_id" integer NOT NULL,
    "published_commit_id" "uuid",
    "published_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."book_publish_pointer" OWNER TO "postgres";


COMMENT ON TABLE "public"."book_publish_pointer" IS 'Points to the currently published commit (mutable)';



CREATE TABLE IF NOT EXISTS "public"."book_revisions" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'planning'::"text" NOT NULL,
    "source" "text" DEFAULT 'prompt'::"text" NOT NULL,
    "instruction" "text",
    "evaluation_id" bigint,
    "evaluation" "jsonb",
    "plan" "jsonb",
    "progress" "jsonb",
    "version_id" bigint,
    "cancel_requested" boolean DEFAULT false NOT NULL,
    "error" "text",
    "notify_email" boolean DEFAULT false NOT NULL,
    "plan_only" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."book_revisions" OWNER TO "postgres";


ALTER TABLE "public"."book_revisions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."book_revisions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_thread_anchors" (
    "id" bigint NOT NULL,
    "thread_id" bigint NOT NULL,
    "page_id" integer,
    "role" "text" NOT NULL,
    "sequence" smallint DEFAULT 0 NOT NULL,
    "note" "text",
    "word_offset" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "book_thread_anchors_role_chk" CHECK (("role" = ANY (ARRAY['promise'::"text", 'resolution'::"text"])))
);


ALTER TABLE "public"."book_thread_anchors" OWNER TO "postgres";


ALTER TABLE "public"."book_thread_anchors" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."book_thread_anchors_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_thread_scans" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending_review'::"text" NOT NULL,
    "summary" "text",
    "changes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "model" "text",
    "notify_email" boolean DEFAULT false NOT NULL,
    CONSTRAINT "book_thread_scans_status_chk" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'pending_review'::"text", 'applied'::"text", 'dismissed'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."book_thread_scans" OWNER TO "postgres";


ALTER TABLE "public"."book_thread_scans" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."book_thread_scans_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_threads" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "target_distance" integer,
    "source" "text" DEFAULT 'ai'::"text" NOT NULL,
    "author_locked" boolean DEFAULT false NOT NULL,
    "setup_node_id" "text",
    "payoff_node_id" "text",
    "plan_thread_id" "text",
    CONSTRAINT "book_threads_source_chk" CHECK (("source" = ANY (ARRAY['ai'::"text", 'author'::"text", 'genre_template'::"text", 'carryover'::"text"]))),
    CONSTRAINT "book_threads_status_chk" CHECK (("status" = ANY (ARRAY['planned'::"text", 'open'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."book_threads" OWNER TO "postgres";


ALTER TABLE "public"."book_threads" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."book_threads_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_tree_versions" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "label" "text",
    "nodes" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."book_tree_versions" OWNER TO "postgres";


ALTER TABLE "public"."book_tree_versions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."book_tree_versions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."book_versions" (
    "id" bigint NOT NULL,
    "book_id" bigint NOT NULL,
    "version_number" integer NOT NULL,
    "name" "text" NOT NULL,
    "subtitle" "text",
    "author" "text",
    "cover_url" "text",
    "photographer" "text",
    "photographer_username" "text",
    "show_text_on_cover" boolean DEFAULT true,
    "commit_message" "text",
    "committed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "committed_by" "uuid",
    "is_published" boolean DEFAULT false,
    "published_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "book_versions_version_number_check" CHECK (("version_number" > 0))
);


ALTER TABLE "public"."book_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."book_versions" IS 'Version control system for books. All public books should have at least one published version.';



COMMENT ON COLUMN "public"."book_versions"."version_number" IS 'Sequential version number starting from 1 for each book';



COMMENT ON COLUMN "public"."book_versions"."commit_message" IS 'User-provided description of changes in this version';



COMMENT ON COLUMN "public"."book_versions"."is_published" IS 'Whether this version is currently published to public';



COMMENT ON COLUMN "public"."book_versions"."metadata" IS 'Flexible JSONB field for future extensions (stats, tags, etc.)';



CREATE SEQUENCE IF NOT EXISTS "public"."book_versions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."book_versions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."book_versions_id_seq" OWNED BY "public"."book_versions"."id";



CREATE TABLE IF NOT EXISTS "public"."books" (
    "id" integer NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"(),
    "name" "text" DEFAULT 'Untitled'::"text",
    "bookmarked_page_index" integer,
    "pinned" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "is_archived" boolean DEFAULT false,
    "page_ids" "jsonb" DEFAULT '[]'::"jsonb",
    "last_published_at" timestamp without time zone,
    "book_id" integer,
    "digest_bookmarked_page_index" integer DEFAULT 0,
    "is_public" boolean DEFAULT false,
    "published_at" timestamp with time zone,
    "cover_url" "text",
    "subtitle" "text",
    "author" "text",
    "slug" "text",
    "show_text_on_cover" boolean DEFAULT true,
    "view_invitation_token" "uuid" DEFAULT "gen_random_uuid"(),
    "edit_invitation_token" "uuid" DEFAULT "gen_random_uuid"(),
    "photographer" "text",
    "photographer_username" "text",
    "repo_initialized" boolean DEFAULT false,
    "last_commit_sha" "text",
    "has_uncommitted_changes" boolean DEFAULT false,
    "last_commit_version_id" bigint,
    "published_version_id" bigint,
    "current_draft_status" "text" DEFAULT 'clean'::"text",
    "content_tags" "text"[] DEFAULT '{}'::"text"[],
    "brief" "jsonb",
    "objectives_enabled" boolean DEFAULT false NOT NULL,
    "bible" "jsonb",
    "spine" "jsonb",
    "journey" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "foundations" "jsonb" DEFAULT '{}'::"jsonb",
    "parent_book_id" integer,
    "canon" "jsonb",
    "steers" "jsonb" DEFAULT '{}'::"jsonb",
    "craft_notes" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "outline" "jsonb",
    "mode" "text" DEFAULT 'prose'::"text" NOT NULL,
    CONSTRAINT "books_current_draft_status_check" CHECK (("current_draft_status" = ANY (ARRAY['clean'::"text", 'modified'::"text"]))),
    CONSTRAINT "books_mode_check" CHECK (("mode" = ANY (ARRAY['prose'::"text", 'picture'::"text"])))
);


ALTER TABLE "public"."books" OWNER TO "postgres";


COMMENT ON COLUMN "public"."books"."page_ids" IS 'DEPRECATED: Use pages.page_index instead';



COMMENT ON COLUMN "public"."books"."last_commit_version_id" IS 'Points to the most recent committed version of this book';



COMMENT ON COLUMN "public"."books"."published_version_id" IS 'Points to the currently published version visible to public readers. Required for public books.';



COMMENT ON COLUMN "public"."books"."current_draft_status" IS 'Indicates if workspace has uncommitted changes: clean or modified';



COMMENT ON COLUMN "public"."books"."brief" IS 'Author-only creative brief (scope, genre, audience, premise, tone, success_criteria). Never shown to readers.';



COMMENT ON COLUMN "public"."books"."objectives_enabled" IS 'When true, the page/paragraph objective UI is shown to editors. Off by default.';



COMMENT ON COLUMN "public"."books"."bible" IS 'Author-only book bible (established facts: characters, world, style). Shape { text }. Never shown to readers.';



COMMENT ON COLUMN "public"."books"."craft_notes" IS 'Per-layer author-editable craft notes { foundations|spine|outline|beats: text } (tier 2), stacked atop the immutable system craft in the edge revision lenses (tier 1).';



COMMENT ON COLUMN "public"."books"."outline" IS 'Durable plan layer (docs/structure-as-render.md): { structure, nodes[], threads[], spine_hash, rev, compiled_rev }. NULL = legacy page-native book. Pages are reconcile()d from this; pages.metadata.node_id links a page back to its node.';



COMMENT ON COLUMN "public"."books"."mode" IS 'prose | picture — gates the DNA Draft step (write prose vs illustrate) and the render projection (text pages vs image pages).';



CREATE TABLE IF NOT EXISTS "public"."commit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "book_id" integer NOT NULL,
    "parent_id" "uuid",
    "message" "text" NOT NULL,
    "meta_hash" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."commit" OWNER TO "postgres";


COMMENT ON TABLE "public"."commit" IS 'Immutable commit records (git-like)';



CREATE TABLE IF NOT EXISTS "public"."commit_entry" (
    "commit_id" "uuid" NOT NULL,
    "page_path" "text" NOT NULL,
    "blob_hash" "text" NOT NULL,
    "page_index" integer
);


ALTER TABLE "public"."commit_entry" OWNER TO "postgres";


COMMENT ON TABLE "public"."commit_entry" IS 'Maps page paths to content blobs within a commit';



CREATE TABLE IF NOT EXISTS "public"."dna_chats" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "stage" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'idle'::"text" NOT NULL,
    "messages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "pending_proposal" "jsonb",
    "error" "text",
    "sessions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "dna_chats_stage_check" CHECK (("stage" = ANY (ARRAY['premise'::"text", 'foundations'::"text", 'structure'::"text", 'scenes'::"text", 'draft'::"text"])))
);


ALTER TABLE "public"."dna_chats" OWNER TO "postgres";


ALTER TABLE "public"."dna_chats" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."dna_chats_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."flashcards" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "front" "text" NOT NULL,
    "back" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."flashcards" OWNER TO "postgres";


ALTER TABLE "public"."flashcards" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."flashcards_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."journal_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."journal_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."journal_id_seq" OWNED BY "public"."books"."id";



CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text" NOT NULL,
    "name" "text",
    "source" "text",
    CONSTRAINT "leads_email_check" CHECK (("length"("email") > 3))
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


ALTER TABLE "public"."leads" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."leads_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."node_scene_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "node_id" "text" NOT NULL,
    "book_id" integer NOT NULL,
    "image_url" "text",
    "prompt" "text",
    "scene_spec" "jsonb",
    "status" "text" DEFAULT 'ready'::"text" NOT NULL,
    "error" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "node_scene_images_status_check" CHECK (("status" = ANY (ARRAY['composing'::"text", 'generating'::"text", 'ready'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."node_scene_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."node_type_configs" (
    "id" integer NOT NULL,
    "target" "text" NOT NULL,
    "child_kind" "text" NOT NULL,
    "child_level" integer NOT NULL,
    "parent_kind" "text" NOT NULL,
    "role" "text" NOT NULL,
    "count" "text" NOT NULL,
    "schema_json" "text" NOT NULL,
    "slots" "jsonb" DEFAULT '{"arc": false, "games": false, "voice": false, "threads": false, "entities": false, "tentpoles": false, "worldRules": false, "preconditions": false}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."node_type_configs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."node_type_configs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."node_type_configs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."node_type_configs_id_seq" OWNED BY "public"."node_type_configs"."id";



CREATE TABLE IF NOT EXISTS "public"."reminders" (
    "id" integer NOT NULL,
    "owner_id" "uuid",
    "book_id" integer,
    "time" time without time zone,
    "repeat_type" "text",
    "repeat_config" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "reminder_type" "text" DEFAULT 'read'::"text",
    "read_option" "text" DEFAULT 'newPage'::"text",
    "page_id" integer,
    "archived" boolean DEFAULT false
);


ALTER TABLE "public"."reminders" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."notification_schedules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."notification_schedules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."notification_schedules_id_seq" OWNED BY "public"."reminders"."id";



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" integer NOT NULL,
    "notebook_id" integer,
    "status" "text" DEFAULT 'upcoming'::"text",
    "due_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "repeat_description" "text",
    "unique_id" "text",
    "reminder_id" integer,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "page_id" integer,
    "archived" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."notifications_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."notifications_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."notifications_id_seq" OWNED BY "public"."notifications"."id";



CREATE TABLE IF NOT EXISTS "public"."page_audio" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_id" integer NOT NULL,
    "audio_url" "text" NOT NULL,
    "audio_duration" integer,
    "character_count" integer NOT NULL,
    "voice_id" "text" DEFAULT 'JBFqnCBsd6RMkjVDRZzb'::"text" NOT NULL,
    "content_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."page_audio" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."page_audio_blocks" (
    "id" bigint NOT NULL,
    "page_id" integer NOT NULL,
    "block_index" integer NOT NULL,
    "block_type" "text" NOT NULL,
    "text_content" "text" NOT NULL,
    "content_hash" "text" NOT NULL,
    "audio_url" "text",
    "duration" real,
    "start_time" real,
    "end_time" real,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."page_audio_blocks" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."page_audio_blocks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."page_audio_blocks_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."page_audio_blocks_id_seq" OWNED BY "public"."page_audio_blocks"."id";



CREATE TABLE IF NOT EXISTS "public"."page_chats" (
    "id" bigint NOT NULL,
    "page_id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "messages" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."page_chats" OWNER TO "postgres";


ALTER TABLE "public"."page_chats" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."page_chats_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."page_comments" (
    "id" bigint NOT NULL,
    "page_id" integer NOT NULL,
    "book_id" integer NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "comment_text" "text" NOT NULL,
    "selection_from" integer NOT NULL,
    "selection_to" integer NOT NULL,
    "selected_text" "text" NOT NULL,
    "content_path" "jsonb",
    "resolved" boolean DEFAULT false NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "archived" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."page_comments" OWNER TO "postgres";


COMMENT ON TABLE "public"."page_comments" IS 'Stores comments/annotations on selected text within pages, similar to Google Docs';



COMMENT ON COLUMN "public"."page_comments"."selection_from" IS 'Start position of selected text in TipTap document';



COMMENT ON COLUMN "public"."page_comments"."selection_to" IS 'End position of selected text in TipTap document';



COMMENT ON COLUMN "public"."page_comments"."selected_text" IS 'The actual text that was selected when comment was created';



COMMENT ON COLUMN "public"."page_comments"."content_path" IS 'JSON path to identify comment location in TipTap document structure';



COMMENT ON COLUMN "public"."page_comments"."resolved" IS 'Whether the comment has been resolved/addressed';



ALTER TABLE "public"."page_comments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."page_comments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."page_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."page_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."page_id_seq" OWNED BY "public"."pages"."id";



CREATE TABLE IF NOT EXISTS "public"."page_scene_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_id" integer NOT NULL,
    "book_id" integer NOT NULL,
    "image_url" "text",
    "prompt" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "status" "text" DEFAULT 'ready'::"text" NOT NULL,
    "error" "text",
    "scene_spec" "jsonb"
);


ALTER TABLE "public"."page_scene_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."page_versions" (
    "id" bigint NOT NULL,
    "book_version_id" bigint NOT NULL,
    "page_id" bigint,
    "title" "text",
    "content" "jsonb",
    "page_index" integer NOT NULL,
    "page_type" "text" DEFAULT 'text'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "page_versions_page_index_check" CHECK (("page_index" >= 0))
);


ALTER TABLE "public"."page_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."page_versions" IS 'Stores immutable snapshots of page content linked to book versions';



COMMENT ON COLUMN "public"."page_versions"."page_id" IS 'Reference to current page (null if page was deleted)';



COMMENT ON COLUMN "public"."page_versions"."content" IS 'TipTap JSON format content snapshot';



COMMENT ON COLUMN "public"."page_versions"."page_index" IS 'Position of page within book at commit time';



COMMENT ON COLUMN "public"."page_versions"."metadata" IS 'Flexible JSONB field for stats, word count, etc.';



CREATE SEQUENCE IF NOT EXISTS "public"."page_versions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."page_versions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."page_versions_id_seq" OWNED BY "public"."page_versions"."id";



CREATE TABLE IF NOT EXISTS "public"."user_data" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "default_notebook" integer,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "email" "text",
    "timezone" "text",
    "one_time_events" "jsonb" DEFAULT '[]'::"jsonb",
    "username" "text",
    "kindle_email" "text",
    "kindle_configured" boolean DEFAULT false,
    "kindle_verification_otp" "text",
    "kindle_verification_expires" timestamp with time zone,
    "bookmarked_pages" "jsonb" DEFAULT '{}'::"jsonb",
    "profile_pic" "text",
    "intro" "text",
    "name" "text",
    "book_last_read" "jsonb" DEFAULT '{}'::"jsonb",
    "mature_content_enabled" boolean
);


ALTER TABLE "public"."user_data" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_data"."kindle_email" IS 'Email address for sending books to Kindle device';



COMMENT ON COLUMN "public"."user_data"."kindle_configured" IS 'Whether the Kindle email has been verified';



COMMENT ON COLUMN "public"."user_data"."kindle_verification_otp" IS 'OTP for verifying Kindle email';



COMMENT ON COLUMN "public"."user_data"."kindle_verification_expires" IS 'Expiration time for the Kindle verification OTP';



COMMENT ON COLUMN "public"."user_data"."book_last_read" IS 'JSON object storing last read timestamps per book: { "bookId": "timestamp" }';



CREATE OR REPLACE VIEW "public"."public_user_profiles" AS
 SELECT "user_data"."user_id",
    "user_data"."name",
    "user_data"."username",
    "user_data"."profile_pic",
    "user_data"."intro",
    "user_data"."created_at"
   FROM "public"."user_data"
  WHERE ("user_data"."username" IS NOT NULL);


ALTER TABLE "public"."public_user_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."revision_chats" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "layer" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'idle'::"text" NOT NULL,
    "messages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "pending_proposal" "jsonb",
    "error" "text",
    "sessions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "revision_chats_layer_check" CHECK (("layer" = ANY (ARRAY['foundations'::"text", 'spine'::"text", 'beats'::"text", 'outline'::"text"])))
);


ALTER TABLE "public"."revision_chats" OWNER TO "postgres";


ALTER TABLE "public"."revision_chats" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."revision_chats_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_book_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "book_id" integer NOT NULL,
    "flashcards_enabled" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."user_book_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "book_id" integer NOT NULL,
    "base_commit_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workspace" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace" IS 'Per-user, per-book staging area for uncommitted changes';



CREATE TABLE IF NOT EXISTS "public"."workspace_page" (
    "workspace_id" "uuid" NOT NULL,
    "page_path" "text" NOT NULL,
    "blob_hash" "text" NOT NULL,
    "version" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workspace_page" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace_page" IS 'Staged page changes in workspace';



ALTER TABLE ONLY "public"."book_versions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."book_versions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."books" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."journal_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."node_type_configs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."node_type_configs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."notifications" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."notifications_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."page_audio_blocks" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."page_audio_blocks_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."page_versions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."page_versions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."page_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."reminders" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."notification_schedules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."admin_settings"
    ADD CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."ai_call_evals"
    ADD CONSTRAINT "ai_call_evals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_calls"
    ADD CONSTRAINT "ai_calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beat_chats"
    ADD CONSTRAINT "beat_chats_book_id_key" UNIQUE ("book_id");



ALTER TABLE ONLY "public"."beat_chats"
    ADD CONSTRAINT "beat_chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blob_json"
    ADD CONSTRAINT "blob_json_pkey" PRIMARY KEY ("hash");



ALTER TABLE ONLY "public"."book_access"
    ADD CONSTRAINT "book_access_book_id_user_id_key" UNIQUE ("book_id", "user_id");



ALTER TABLE ONLY "public"."book_access"
    ADD CONSTRAINT "book_access_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_agent_runs"
    ADD CONSTRAINT "book_agent_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_agent_sessions"
    ADD CONSTRAINT "book_agent_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_chats"
    ADD CONSTRAINT "book_chats_book_user_unique" UNIQUE ("book_id", "user_id");



ALTER TABLE ONLY "public"."book_chats"
    ADD CONSTRAINT "book_chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_commits"
    ADD CONSTRAINT "book_commits_commit_sha_key" UNIQUE ("commit_sha");



ALTER TABLE ONLY "public"."book_commits"
    ADD CONSTRAINT "book_commits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_decompositions"
    ADD CONSTRAINT "book_decompositions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_evaluations"
    ADD CONSTRAINT "book_evaluations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_generations"
    ADD CONSTRAINT "book_generations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_nodes"
    ADD CONSTRAINT "book_nodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_publish_pointer"
    ADD CONSTRAINT "book_publish_pointer_pkey" PRIMARY KEY ("book_id");



ALTER TABLE ONLY "public"."book_revisions"
    ADD CONSTRAINT "book_revisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_thread_anchors"
    ADD CONSTRAINT "book_thread_anchors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_thread_scans"
    ADD CONSTRAINT "book_thread_scans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_threads"
    ADD CONSTRAINT "book_threads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_tree_versions"
    ADD CONSTRAINT "book_tree_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."book_versions"
    ADD CONSTRAINT "book_versions_book_id_version_number_key" UNIQUE ("book_id", "version_number");



ALTER TABLE ONLY "public"."book_versions"
    ADD CONSTRAINT "book_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commit_entry"
    ADD CONSTRAINT "commit_entry_pkey" PRIMARY KEY ("commit_id", "page_path");



ALTER TABLE ONLY "public"."commit"
    ADD CONSTRAINT "commit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dna_chats"
    ADD CONSTRAINT "dna_chats_book_id_stage_key" UNIQUE ("book_id", "stage");



ALTER TABLE ONLY "public"."dna_chats"
    ADD CONSTRAINT "dna_chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flashcards"
    ADD CONSTRAINT "flashcards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."books"
    ADD CONSTRAINT "journal_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."node_scene_images"
    ADD CONSTRAINT "node_scene_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."node_type_configs"
    ADD CONSTRAINT "node_type_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."node_type_configs"
    ADD CONSTRAINT "node_type_configs_target_key" UNIQUE ("target");



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "notification_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_unique_id_key" UNIQUE ("unique_id");



ALTER TABLE ONLY "public"."page_audio_blocks"
    ADD CONSTRAINT "page_audio_blocks_page_id_block_index_key" UNIQUE ("page_id", "block_index");



ALTER TABLE ONLY "public"."page_audio_blocks"
    ADD CONSTRAINT "page_audio_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_audio"
    ADD CONSTRAINT "page_audio_page_id_key" UNIQUE ("page_id");



ALTER TABLE ONLY "public"."page_audio"
    ADD CONSTRAINT "page_audio_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_chats"
    ADD CONSTRAINT "page_chats_page_user_unique" UNIQUE ("page_id", "user_id");



ALTER TABLE ONLY "public"."page_chats"
    ADD CONSTRAINT "page_chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_comments"
    ADD CONSTRAINT "page_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "page_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_scene_images"
    ADD CONSTRAINT "page_scene_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_versions"
    ADD CONSTRAINT "page_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."revision_chats"
    ADD CONSTRAINT "revision_chats_book_id_layer_key" UNIQUE ("book_id", "layer");



ALTER TABLE ONLY "public"."revision_chats"
    ADD CONSTRAINT "revision_chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_book_preferences"
    ADD CONSTRAINT "user_book_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_book_preferences"
    ADD CONSTRAINT "user_book_preferences_user_id_book_id_key" UNIQUE ("user_id", "book_id");



ALTER TABLE ONLY "public"."user_data"
    ADD CONSTRAINT "user_data_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."workspace_page"
    ADD CONSTRAINT "workspace_page_pkey" PRIMARY KEY ("workspace_id", "page_path");



ALTER TABLE ONLY "public"."workspace"
    ADD CONSTRAINT "workspace_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace"
    ADD CONSTRAINT "workspace_user_id_book_id_key" UNIQUE ("user_id", "book_id");



CREATE INDEX "ai_call_evals_book_created_idx" ON "public"."ai_call_evals" USING "btree" ("book_id", "created_at" DESC);



CREATE INDEX "ai_call_evals_call_idx" ON "public"."ai_call_evals" USING "btree" ("ai_call_id");



CREATE INDEX "ai_calls_book_created_idx" ON "public"."ai_calls" USING "btree" ("book_id", "created_at" DESC);



CREATE INDEX "ai_calls_fn_created_idx" ON "public"."ai_calls" USING "btree" ("fn", "created_at" DESC);



CREATE INDEX "ai_calls_node_idx" ON "public"."ai_calls" USING "btree" ("node_id");



CREATE INDEX "ai_calls_status_running_idx" ON "public"."ai_calls" USING "btree" ("created_at" DESC) WHERE ("status" = 'running'::"text");



CREATE INDEX "ai_calls_task_idx" ON "public"."ai_calls" USING "btree" ("task_table", "task_id");



CREATE INDEX "ai_calls_user_idx" ON "public"."ai_calls" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "book_agent_runs_book_id_created_at_idx" ON "public"."book_agent_runs" USING "btree" ("book_id", "created_at" DESC);



CREATE UNIQUE INDEX "book_agent_runs_one_thread_per_book" ON "public"."book_agent_runs" USING "btree" ("book_id") WHERE ("kind" = 'thread'::"text");



CREATE INDEX "book_agent_runs_page_idx" ON "public"."book_agent_runs" USING "btree" ("book_id", "target_page_id", "created_at" DESC);



CREATE INDEX "book_agent_sessions_thread_id_ended_at_idx" ON "public"."book_agent_sessions" USING "btree" ("thread_id", "ended_at" DESC);



CREATE INDEX "book_decompositions_book_id_created_idx" ON "public"."book_decompositions" USING "btree" ("book_id", "created_at" DESC);



CREATE INDEX "book_evaluations_book_id_created_at_idx" ON "public"."book_evaluations" USING "btree" ("book_id", "created_at" DESC);



CREATE INDEX "book_generations_book_id_created_idx" ON "public"."book_generations" USING "btree" ("book_id", "created_at" DESC);



CREATE INDEX "book_generations_page_created_idx" ON "public"."book_generations" USING "btree" ("target_page_id", "created_at" DESC) WHERE ("target_page_id" IS NOT NULL);



CREATE INDEX "book_generations_target_key_created_idx" ON "public"."book_generations" USING "btree" ("book_id", "kind", "target_key", "created_at" DESC) WHERE ("target_key" IS NOT NULL);



CREATE INDEX "book_nodes_book_idx" ON "public"."book_nodes" USING "btree" ("book_id");



CREATE UNIQUE INDEX "book_nodes_one_root_per_book" ON "public"."book_nodes" USING "btree" ("book_id") WHERE ("parent_id" IS NULL);



CREATE INDEX "book_nodes_parent_idx" ON "public"."book_nodes" USING "btree" ("book_id", "parent_id", "position");



CREATE INDEX "book_revisions_book_id_created_at_idx" ON "public"."book_revisions" USING "btree" ("book_id", "created_at" DESC);



CREATE INDEX "book_thread_anchors_page_id_idx" ON "public"."book_thread_anchors" USING "btree" ("page_id") WHERE ("page_id" IS NOT NULL);



CREATE INDEX "book_thread_anchors_thread_role_seq_idx" ON "public"."book_thread_anchors" USING "btree" ("thread_id", "role", "sequence");



CREATE INDEX "book_thread_scans_book_id_created_idx" ON "public"."book_thread_scans" USING "btree" ("book_id", "created_at" DESC);



CREATE INDEX "book_threads_book_id_idx" ON "public"."book_threads" USING "btree" ("book_id", "status");



CREATE INDEX "book_threads_plan_thread_id_idx" ON "public"."book_threads" USING "btree" ("book_id", "plan_thread_id");



CREATE INDEX "book_tree_versions_book_idx" ON "public"."book_tree_versions" USING "btree" ("book_id", "created_at" DESC);



CREATE INDEX "books_parent_book_id_idx" ON "public"."books" USING "btree" ("parent_book_id") WHERE ("parent_book_id" IS NOT NULL);



CREATE INDEX "idx_blob_json_created_at" ON "public"."blob_json" USING "btree" ("created_at");



CREATE INDEX "idx_book_access_book_id" ON "public"."book_access" USING "btree" ("book_id");



CREATE INDEX "idx_book_access_user_status" ON "public"."book_access" USING "btree" ("user_id", "status");



CREATE INDEX "idx_book_chats_book_id" ON "public"."book_chats" USING "btree" ("book_id");



CREATE INDEX "idx_book_chats_updated_at" ON "public"."book_chats" USING "btree" ("updated_at");



CREATE INDEX "idx_book_chats_user_id" ON "public"."book_chats" USING "btree" ("user_id");



CREATE INDEX "idx_book_commits_book_id" ON "public"."book_commits" USING "btree" ("book_id");



CREATE INDEX "idx_book_commits_created_at" ON "public"."book_commits" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_book_publish_pointer_commit" ON "public"."book_publish_pointer" USING "btree" ("published_commit_id");



CREATE INDEX "idx_book_versions_book_id" ON "public"."book_versions" USING "btree" ("book_id");



CREATE INDEX "idx_book_versions_committed_at" ON "public"."book_versions" USING "btree" ("book_id", "committed_at" DESC);



CREATE INDEX "idx_book_versions_published" ON "public"."book_versions" USING "btree" ("book_id", "is_published") WHERE ("is_published" = true);



CREATE INDEX "idx_books_content_tags" ON "public"."books" USING "gin" ("content_tags");



CREATE INDEX "idx_books_draft_status" ON "public"."books" USING "btree" ("current_draft_status") WHERE ("current_draft_status" = 'modified'::"text");



CREATE INDEX "idx_books_edit_token" ON "public"."books" USING "btree" ("edit_invitation_token");



CREATE INDEX "idx_books_is_public" ON "public"."books" USING "btree" ("is_public");



CREATE INDEX "idx_books_last_commit_version" ON "public"."books" USING "btree" ("last_commit_version_id");



CREATE INDEX "idx_books_published_version" ON "public"."books" USING "btree" ("published_version_id");



CREATE INDEX "idx_books_view_token" ON "public"."books" USING "btree" ("view_invitation_token");



CREATE INDEX "idx_commit_book_id" ON "public"."commit" USING "btree" ("book_id");



CREATE INDEX "idx_commit_created_at" ON "public"."commit" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_commit_created_by" ON "public"."commit" USING "btree" ("created_by");



CREATE INDEX "idx_commit_entry_blob_hash" ON "public"."commit_entry" USING "btree" ("blob_hash");



CREATE INDEX "idx_commit_entry_commit_id" ON "public"."commit_entry" USING "btree" ("commit_id");



CREATE INDEX "idx_commit_parent_id" ON "public"."commit" USING "btree" ("parent_id");



CREATE INDEX "idx_flashcards_book_id" ON "public"."flashcards" USING "btree" ("book_id");



CREATE INDEX "idx_flashcards_updated_at" ON "public"."flashcards" USING "btree" ("updated_at");



CREATE INDEX "idx_flashcards_user_id" ON "public"."flashcards" USING "btree" ("user_id");



CREATE INDEX "idx_node_scene_images_book_id" ON "public"."node_scene_images" USING "btree" ("book_id");



CREATE INDEX "idx_node_scene_images_node_id" ON "public"."node_scene_images" USING "btree" ("node_id");



CREATE INDEX "idx_page_audio_blocks_content_hash" ON "public"."page_audio_blocks" USING "btree" ("content_hash");



CREATE INDEX "idx_page_audio_blocks_page_id" ON "public"."page_audio_blocks" USING "btree" ("page_id");



CREATE INDEX "idx_page_audio_content_hash" ON "public"."page_audio" USING "btree" ("content_hash");



CREATE INDEX "idx_page_audio_page_id" ON "public"."page_audio" USING "btree" ("page_id");



CREATE INDEX "idx_page_audio_voice_id" ON "public"."page_audio" USING "btree" ("voice_id");



CREATE INDEX "idx_page_chats_page_id" ON "public"."page_chats" USING "btree" ("page_id");



CREATE INDEX "idx_page_chats_updated_at" ON "public"."page_chats" USING "btree" ("updated_at");



CREATE INDEX "idx_page_chats_user_id" ON "public"."page_chats" USING "btree" ("user_id");



CREATE INDEX "idx_page_comments_book_id" ON "public"."page_comments" USING "btree" ("book_id");



CREATE INDEX "idx_page_comments_created_at" ON "public"."page_comments" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_page_comments_page_id" ON "public"."page_comments" USING "btree" ("page_id");



CREATE INDEX "idx_page_comments_resolved" ON "public"."page_comments" USING "btree" ("resolved", "archived");



CREATE INDEX "idx_page_comments_user_id" ON "public"."page_comments" USING "btree" ("user_id");



CREATE INDEX "idx_page_scene_images_book_id" ON "public"."page_scene_images" USING "btree" ("book_id");



CREATE INDEX "idx_page_scene_images_page_id" ON "public"."page_scene_images" USING "btree" ("page_id");



CREATE INDEX "idx_page_versions_book_version" ON "public"."page_versions" USING "btree" ("book_version_id");



CREATE INDEX "idx_page_versions_book_version_index" ON "public"."page_versions" USING "btree" ("book_version_id", "page_index");



CREATE INDEX "idx_page_versions_page_id" ON "public"."page_versions" USING "btree" ("page_id");



CREATE INDEX "idx_pages_git_status" ON "public"."pages" USING "btree" ("git_status") WHERE ("git_status" <> 'clean'::"text");



CREATE INDEX "idx_pages_is_draft" ON "public"."pages" USING "btree" ("is_draft") WHERE ("is_draft" = true);



CREATE INDEX "idx_user_book_preferences_book_id" ON "public"."user_book_preferences" USING "btree" ("book_id");



CREATE INDEX "idx_user_book_preferences_flashcards_enabled" ON "public"."user_book_preferences" USING "btree" ("flashcards_enabled");



CREATE INDEX "idx_user_book_preferences_user_id" ON "public"."user_book_preferences" USING "btree" ("user_id");



CREATE INDEX "idx_user_data_book_last_read" ON "public"."user_data" USING "gin" ("book_last_read");



CREATE INDEX "idx_workspace_base_commit" ON "public"."workspace" USING "btree" ("base_commit_id");



CREATE INDEX "idx_workspace_page_blob_hash" ON "public"."workspace_page" USING "btree" ("blob_hash");



CREATE INDEX "idx_workspace_page_workspace_id" ON "public"."workspace_page" USING "btree" ("workspace_id");



CREATE INDEX "idx_workspace_user_book" ON "public"."workspace" USING "btree" ("user_id", "book_id");



CREATE UNIQUE INDEX "unique_book_page_index" ON "public"."pages" USING "btree" ("book_id", "page_index") WHERE ("archived" = false);



CREATE OR REPLACE TRIGGER "beat_chats_touch_updated_at" BEFORE UPDATE ON "public"."beat_chats" FOR EACH ROW EXECUTE FUNCTION "public"."touch_beat_chats_updated_at"();



CREATE OR REPLACE TRIGGER "book_agent_runs_touch_updated_at" BEFORE UPDATE ON "public"."book_agent_runs" FOR EACH ROW EXECUTE FUNCTION "public"."touch_book_agent_runs_updated_at"();



CREATE OR REPLACE TRIGGER "book_decompositions_touch_updated_at" BEFORE UPDATE ON "public"."book_decompositions" FOR EACH ROW EXECUTE FUNCTION "public"."touch_book_decompositions_updated_at"();



CREATE OR REPLACE TRIGGER "book_generations_touch_updated_at" BEFORE UPDATE ON "public"."book_generations" FOR EACH ROW EXECUTE FUNCTION "public"."touch_book_generations_updated_at"();



CREATE OR REPLACE TRIGGER "book_nodes_touch_updated_at" BEFORE UPDATE ON "public"."book_nodes" FOR EACH ROW EXECUTE FUNCTION "public"."touch_book_nodes_updated_at"();



CREATE OR REPLACE TRIGGER "book_revisions_touch_updated_at" BEFORE UPDATE ON "public"."book_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."touch_book_revisions_updated_at"();



CREATE OR REPLACE TRIGGER "book_threads_touch_updated_at" BEFORE UPDATE ON "public"."book_threads" FOR EACH ROW EXECUTE FUNCTION "public"."touch_book_threads_updated_at"();



CREATE OR REPLACE TRIGGER "dna_chats_touch_updated_at" BEFORE UPDATE ON "public"."dna_chats" FOR EACH ROW EXECUTE FUNCTION "public"."touch_dna_chats_updated_at"();



CREATE OR REPLACE TRIGGER "revision_chats_touch_updated_at" BEFORE UPDATE ON "public"."revision_chats" FOR EACH ROW EXECUTE FUNCTION "public"."touch_revision_chats_updated_at"();



CREATE OR REPLACE TRIGGER "trg_notify_evaluation_done" AFTER UPDATE ON "public"."book_evaluations" FOR EACH ROW WHEN (("new"."notify_email" AND ("new"."status" = ANY (ARRAY['done'::"text", 'error'::"text"])) AND ("old"."status" IS DISTINCT FROM "new"."status") AND ("old"."status" <> ALL (ARRAY['done'::"text", 'error'::"text"])))) EXECUTE FUNCTION "public"."notify_task_done"();



CREATE OR REPLACE TRIGGER "trg_notify_generation_done" AFTER UPDATE ON "public"."book_generations" FOR EACH ROW WHEN (("new"."notify_email" AND ("new"."status" = ANY (ARRAY['ready'::"text", 'done'::"text", 'error'::"text"])) AND ("old"."status" IS DISTINCT FROM "new"."status") AND ("old"."status" <> ALL (ARRAY['ready'::"text", 'done'::"text", 'error'::"text"])))) EXECUTE FUNCTION "public"."notify_task_done"();



CREATE OR REPLACE TRIGGER "trg_notify_revalidate_book" AFTER UPDATE ON "public"."books" FOR EACH ROW WHEN (((("new"."is_public" IS TRUE) OR ("old"."is_public" IS TRUE)) AND (("new"."published_version_id" IS DISTINCT FROM "old"."published_version_id") OR ("new"."is_public" IS DISTINCT FROM "old"."is_public") OR ("new"."is_archived" IS DISTINCT FROM "old"."is_archived") OR ("new"."name" IS DISTINCT FROM "old"."name") OR ("new"."subtitle" IS DISTINCT FROM "old"."subtitle") OR ("new"."author" IS DISTINCT FROM "old"."author") OR ("new"."cover_url" IS DISTINCT FROM "old"."cover_url") OR ("new"."show_text_on_cover" IS DISTINCT FROM "old"."show_text_on_cover") OR ("new"."content_tags" IS DISTINCT FROM "old"."content_tags")))) EXECUTE FUNCTION "public"."notify_revalidate_book"();



CREATE OR REPLACE TRIGGER "trg_notify_revision_done" AFTER UPDATE ON "public"."book_revisions" FOR EACH ROW WHEN (("new"."notify_email" AND ("new"."status" = ANY (ARRAY['done'::"text", 'error'::"text"])) AND ("old"."status" IS DISTINCT FROM "new"."status") AND ("old"."status" <> ALL (ARRAY['done'::"text", 'error'::"text"])))) EXECUTE FUNCTION "public"."notify_task_done"();



CREATE OR REPLACE TRIGGER "trg_notify_scan_done" AFTER UPDATE ON "public"."book_thread_scans" FOR EACH ROW WHEN (("new"."notify_email" AND ("new"."status" = ANY (ARRAY['pending_review'::"text", 'error'::"text"])) AND ("old"."status" IS DISTINCT FROM "new"."status") AND ("old"."status" <> ALL (ARRAY['pending_review'::"text", 'error'::"text"])))) EXECUTE FUNCTION "public"."notify_task_done"();



CREATE OR REPLACE TRIGGER "trg_propagate_character_rename" AFTER UPDATE ON "public"."book_nodes" FOR EACH ROW WHEN ((("old"."content" ->> 'name'::"text") IS DISTINCT FROM ("new"."content" ->> 'name'::"text"))) EXECUTE FUNCTION "public"."propagate_character_rename"();



CREATE OR REPLACE TRIGGER "trigger_update_book_draft_status" AFTER UPDATE OF "content", "title" ON "public"."pages" FOR EACH ROW WHEN ((("old"."content" IS DISTINCT FROM "new"."content") OR ("old"."title" IS DISTINCT FROM "new"."title"))) EXECUTE FUNCTION "public"."update_book_draft_status"();



COMMENT ON TRIGGER "trigger_update_book_draft_status" ON "public"."pages" IS 'Updates book draft status when page content or title changes';



CREATE OR REPLACE TRIGGER "trigger_update_book_draft_status_delete" AFTER DELETE ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_book_draft_status"();



COMMENT ON TRIGGER "trigger_update_book_draft_status_delete" ON "public"."pages" IS 'Updates book draft status when page is deleted';



CREATE OR REPLACE TRIGGER "trigger_update_book_draft_status_insert" AFTER INSERT ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_book_draft_status"();



COMMENT ON TRIGGER "trigger_update_book_draft_status_insert" ON "public"."pages" IS 'Updates book draft status when new page is added';



CREATE OR REPLACE TRIGGER "trigger_update_book_git_status" AFTER INSERT OR DELETE OR UPDATE ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_book_git_status"();



CREATE OR REPLACE TRIGGER "trigger_update_notebook_on_page_change" AFTER INSERT OR UPDATE ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_notebook_on_page_change"();



CREATE OR REPLACE TRIGGER "trigger_update_notebook_on_page_change" AFTER INSERT OR UPDATE ON "public"."reminders" FOR EACH ROW EXECUTE FUNCTION "public"."update_notebook_on_page_change"();



CREATE OR REPLACE TRIGGER "update_book_chats_modtime" BEFORE UPDATE ON "public"."book_chats" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_book_slug" BEFORE INSERT OR UPDATE OF "name" ON "public"."books" FOR EACH ROW EXECUTE FUNCTION "public"."update_slug"();



CREATE OR REPLACE TRIGGER "update_flashcards_modtime" BEFORE UPDATE ON "public"."flashcards" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_notebook_modtime" BEFORE UPDATE ON "public"."books" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_notification_schedules_modtime" BEFORE UPDATE ON "public"."reminders" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_notifications_modtime" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_page_audio_blocks_updated_at" BEFORE UPDATE ON "public"."page_audio_blocks" FOR EACH ROW EXECUTE FUNCTION "public"."update_page_audio_blocks_updated_at"();



CREATE OR REPLACE TRIGGER "update_page_audio_modtime" BEFORE UPDATE ON "public"."page_audio" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_page_chats_modtime" BEFORE UPDATE ON "public"."page_chats" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_page_comments_modtime" BEFORE UPDATE ON "public"."page_comments" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_page_modtime" BEFORE UPDATE ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_page_slug" BEFORE INSERT OR UPDATE OF "title" ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_slug"();



CREATE OR REPLACE TRIGGER "update_user_book_preferences_modtime" BEFORE UPDATE ON "public"."user_book_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_user_data_modtime" BEFORE UPDATE ON "public"."user_data" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_call_evals"
    ADD CONSTRAINT "ai_call_evals_ai_call_id_fkey" FOREIGN KEY ("ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_call_evals"
    ADD CONSTRAINT "ai_call_evals_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_calls"
    ADD CONSTRAINT "ai_calls_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_calls"
    ADD CONSTRAINT "ai_calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beat_chats"
    ADD CONSTRAINT "beat_chats_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_access"
    ADD CONSTRAINT "book_access_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_access"
    ADD CONSTRAINT "book_access_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."book_access"
    ADD CONSTRAINT "book_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_agent_runs"
    ADD CONSTRAINT "book_agent_runs_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_agent_runs"
    ADD CONSTRAINT "book_agent_runs_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."book_revisions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."book_agent_runs"
    ADD CONSTRAINT "book_agent_runs_target_page_id_fkey" FOREIGN KEY ("target_page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_agent_sessions"
    ADD CONSTRAINT "book_agent_sessions_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_agent_sessions"
    ADD CONSTRAINT "book_agent_sessions_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."book_agent_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_chats"
    ADD CONSTRAINT "book_chats_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_chats"
    ADD CONSTRAINT "book_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_commits"
    ADD CONSTRAINT "book_commits_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_commits"
    ADD CONSTRAINT "book_commits_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_decompositions"
    ADD CONSTRAINT "book_decompositions_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_evaluations"
    ADD CONSTRAINT "book_evaluations_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_generations"
    ADD CONSTRAINT "book_generations_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_nodes"
    ADD CONSTRAINT "book_nodes_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_nodes"
    ADD CONSTRAINT "book_nodes_last_ai_call_id_fkey" FOREIGN KEY ("last_ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."book_nodes"
    ADD CONSTRAINT "book_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."book_nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_publish_pointer"
    ADD CONSTRAINT "book_publish_pointer_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_publish_pointer"
    ADD CONSTRAINT "book_publish_pointer_published_commit_id_fkey" FOREIGN KEY ("published_commit_id") REFERENCES "public"."commit"("id");



ALTER TABLE ONLY "public"."book_revisions"
    ADD CONSTRAINT "book_revisions_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_revisions"
    ADD CONSTRAINT "book_revisions_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "public"."book_evaluations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."book_thread_anchors"
    ADD CONSTRAINT "book_thread_anchors_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."book_thread_anchors"
    ADD CONSTRAINT "book_thread_anchors_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."book_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_thread_scans"
    ADD CONSTRAINT "book_thread_scans_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_threads"
    ADD CONSTRAINT "book_threads_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_tree_versions"
    ADD CONSTRAINT "book_tree_versions_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_versions"
    ADD CONSTRAINT "book_versions_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."book_versions"
    ADD CONSTRAINT "book_versions_committed_by_fkey" FOREIGN KEY ("committed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."books"
    ADD CONSTRAINT "books_last_commit_version_id_fkey" FOREIGN KEY ("last_commit_version_id") REFERENCES "public"."book_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."books"
    ADD CONSTRAINT "books_parent_book_id_fkey" FOREIGN KEY ("parent_book_id") REFERENCES "public"."books"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."books"
    ADD CONSTRAINT "books_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "public"."book_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."commit"
    ADD CONSTRAINT "commit_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commit_entry"
    ADD CONSTRAINT "commit_entry_blob_hash_fkey" FOREIGN KEY ("blob_hash") REFERENCES "public"."blob_json"("hash");



ALTER TABLE ONLY "public"."commit_entry"
    ADD CONSTRAINT "commit_entry_commit_id_fkey" FOREIGN KEY ("commit_id") REFERENCES "public"."commit"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commit"
    ADD CONSTRAINT "commit_meta_hash_fkey" FOREIGN KEY ("meta_hash") REFERENCES "public"."blob_json"("hash");



ALTER TABLE ONLY "public"."commit"
    ADD CONSTRAINT "commit_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."commit"("id");



ALTER TABLE ONLY "public"."dna_chats"
    ADD CONSTRAINT "dna_chats_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flashcards"
    ADD CONSTRAINT "flashcards_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flashcards"
    ADD CONSTRAINT "flashcards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."node_scene_images"
    ADD CONSTRAINT "node_scene_images_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."node_scene_images"
    ADD CONSTRAINT "node_scene_images_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."node_scene_images"
    ADD CONSTRAINT "node_scene_images_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."book_nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "notification_schedules_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."user_data"("user_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_journal_id_fkey" FOREIGN KEY ("notebook_id") REFERENCES "public"."books"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id");



ALTER TABLE ONLY "public"."page_audio_blocks"
    ADD CONSTRAINT "page_audio_blocks_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_audio"
    ADD CONSTRAINT "page_audio_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_chats"
    ADD CONSTRAINT "page_chats_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_chats"
    ADD CONSTRAINT "page_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_comments"
    ADD CONSTRAINT "page_comments_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_comments"
    ADD CONSTRAINT "page_comments_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_comments"
    ADD CONSTRAINT "page_comments_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."page_comments"
    ADD CONSTRAINT "page_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_scene_images"
    ADD CONSTRAINT "page_scene_images_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_scene_images"
    ADD CONSTRAINT "page_scene_images_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."page_scene_images"
    ADD CONSTRAINT "page_scene_images_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_versions"
    ADD CONSTRAINT "page_versions_book_version_id_fkey" FOREIGN KEY ("book_version_id") REFERENCES "public"."book_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_versions"
    ADD CONSTRAINT "page_versions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_last_ai_call_id_fkey" FOREIGN KEY ("last_ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "public_notification_schedules_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "public_notifications_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id");



ALTER TABLE ONLY "public"."revision_chats"
    ADD CONSTRAINT "revision_chats_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_book_preferences"
    ADD CONSTRAINT "user_book_preferences_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_book_preferences"
    ADD CONSTRAINT "user_book_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_data"
    ADD CONSTRAINT "user_data_default_journal_fkey" FOREIGN KEY ("default_notebook") REFERENCES "public"."books"("id");



ALTER TABLE ONLY "public"."workspace"
    ADD CONSTRAINT "workspace_base_commit_id_fkey" FOREIGN KEY ("base_commit_id") REFERENCES "public"."commit"("id");



ALTER TABLE ONLY "public"."workspace"
    ADD CONSTRAINT "workspace_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_page"
    ADD CONSTRAINT "workspace_page_blob_hash_fkey" FOREIGN KEY ("blob_hash") REFERENCES "public"."blob_json"("hash");



ALTER TABLE ONLY "public"."workspace_page"
    ADD CONSTRAINT "workspace_page_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can view node scene images" ON "public"."node_scene_images" FOR SELECT USING (true);



CREATE POLICY "Anyone can view page audio" ON "public"."page_audio" FOR SELECT USING (true);



CREATE POLICY "Anyone can view scene images" ON "public"."page_scene_images" FOR SELECT USING (true);



CREATE POLICY "Authenticated users can delete node scene images" ON "public"."node_scene_images" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can delete page audio" ON "public"."page_audio" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can delete scene images" ON "public"."page_scene_images" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can insert node scene images" ON "public"."node_scene_images" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can insert page audio" ON "public"."page_audio" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can insert scene images" ON "public"."page_scene_images" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can update node scene images" ON "public"."node_scene_images" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can update page audio" ON "public"."page_audio" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Book owners can manage access" ON "public"."book_access" USING ((EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "books"."book_id") AND ("books"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Book owners can view all their book versions" ON "public"."book_versions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."books" "b"
  WHERE (("b"."id" = "book_versions"."book_id") AND ("b"."owner_id" = "auth"."uid"())))));



COMMENT ON POLICY "Book owners can view all their book versions" ON "public"."book_versions" IS 'Book owners can see all versions (published and unpublished) of their books';



CREATE POLICY "Book owners can view all their page versions" ON "public"."page_versions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."book_versions" "bv"
     JOIN "public"."books" "b" ON (("b"."id" = "bv"."book_id")))
  WHERE (("bv"."id" = "page_versions"."book_version_id") AND ("b"."owner_id" = "auth"."uid"())))));



COMMENT ON POLICY "Book owners can view all their page versions" ON "public"."page_versions" IS 'Book owners can see all page versions in their books';



CREATE POLICY "Editors can view book versions" ON "public"."book_versions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."book_access" "ba"
     JOIN "public"."books" "b" ON (("b"."id" = "ba"."book_id")))
  WHERE (("b"."id" = "book_versions"."book_id") AND ("ba"."user_id" = "auth"."uid"()) AND ("ba"."access_level" = ANY (ARRAY['edit'::"public"."book_access_level", 'view'::"public"."book_access_level"]))))));



CREATE POLICY "Editors can view page versions" ON "public"."page_versions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."book_versions" "bv"
     JOIN "public"."books" "b" ON (("b"."id" = "bv"."book_id")))
     JOIN "public"."book_access" "ba" ON (("ba"."book_id" = "b"."id")))
  WHERE (("bv"."id" = "page_versions"."book_version_id") AND ("ba"."user_id" = "auth"."uid"()) AND ("ba"."access_level" = ANY (ARRAY['edit'::"public"."book_access_level", 'view'::"public"."book_access_level"]))))));



CREATE POLICY "Enable insert for authenticated users only" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable insert for users based on user_id" ON "public"."leads" FOR INSERT WITH CHECK (true);



CREATE POLICY "Public users can view published book versions" ON "public"."book_versions" FOR SELECT USING ((("is_published" = true) AND (EXISTS ( SELECT 1
   FROM "public"."books" "b"
  WHERE (("b"."id" = "book_versions"."book_id") AND ("b"."is_public" = true) AND ("b"."is_archived" = false))))));



COMMENT ON POLICY "Public users can view published book versions" ON "public"."book_versions" IS 'Allows anyone to view published versions of public books';



CREATE POLICY "Public users can view published page versions" ON "public"."page_versions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."book_versions" "bv"
     JOIN "public"."books" "b" ON (("b"."id" = "bv"."book_id")))
  WHERE (("bv"."id" = "page_versions"."book_version_id") AND ("bv"."is_published" = true) AND ("b"."is_public" = true) AND ("b"."is_archived" = false)))));



COMMENT ON POLICY "Public users can view published page versions" ON "public"."page_versions" IS 'Allows anyone to view published page content from public books';



CREATE POLICY "Users can create commits for books they can edit" ON "public"."book_commits" FOR INSERT TO "authenticated" WITH CHECK ((("author_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "book_commits"."book_id") AND (("books"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."book_access"
          WHERE (("book_access"."book_id" = "books"."id") AND ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text")) AND ("book_access"."access_level" = 'edit'::"public"."book_access_level"))))))))));



CREATE POLICY "Users can delete audio blocks for editable pages" ON "public"."page_audio_blocks" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (("public"."pages" "p"
     LEFT JOIN "public"."books" "b" ON (("p"."book_id" = "b"."id")))
     LEFT JOIN "public"."book_access" "ba" ON (("b"."id" = "ba"."book_id")))
  WHERE (("p"."id" = "page_audio_blocks"."page_id") AND (("b"."owner_id" = "auth"."uid"()) OR (("ba"."user_id" = "auth"."uid"()) AND ("ba"."access_level" = 'edit'::"public"."book_access_level")))))));



CREATE POLICY "Users can delete own books" ON "public"."books" FOR DELETE TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own book access records" ON "public"."book_access" FOR DELETE USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Users can delete their own book preferences" ON "public"."user_book_preferences" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert audio blocks for editable pages" ON "public"."page_audio_blocks" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."pages" "p"
     LEFT JOIN "public"."books" "b" ON (("p"."book_id" = "b"."id")))
     LEFT JOIN "public"."book_access" "ba" ON (("b"."id" = "ba"."book_id")))
  WHERE (("p"."id" = "page_audio_blocks"."page_id") AND (("b"."owner_id" = "auth"."uid"()) OR (("ba"."user_id" = "auth"."uid"()) AND ("ba"."access_level" = 'edit'::"public"."book_access_level")))))));



CREATE POLICY "Users can insert their own book preferences" ON "public"."user_book_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read audio blocks for accessible pages" ON "public"."page_audio_blocks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."pages" "p"
     LEFT JOIN "public"."books" "b" ON (("p"."book_id" = "b"."id")))
     LEFT JOIN "public"."book_access" "ba" ON (("b"."id" = "ba"."book_id")))
  WHERE (("p"."id" = "page_audio_blocks"."page_id") AND (("b"."is_public" = true) OR ("b"."owner_id" = "auth"."uid"()) OR ("ba"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update audio blocks for editable pages" ON "public"."page_audio_blocks" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (("public"."pages" "p"
     LEFT JOIN "public"."books" "b" ON (("p"."book_id" = "b"."id")))
     LEFT JOIN "public"."book_access" "ba" ON (("b"."id" = "ba"."book_id")))
  WHERE (("p"."id" = "page_audio_blocks"."page_id") AND (("b"."owner_id" = "auth"."uid"()) OR (("ba"."user_id" = "auth"."uid"()) AND ("ba"."access_level" = 'edit'::"public"."book_access_level")))))));



CREATE POLICY "Users can update own books" ON "public"."books" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own book access records" ON "public"."book_access" FOR UPDATE USING (("auth"."uid"() = "created_by")) WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "Users can update their own book preferences" ON "public"."user_book_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own books" ON "public"."books" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own data" ON "public"."user_data" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view commits for their books" ON "public"."book_commits" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "book_commits"."book_id") AND (("books"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."book_access"
          WHERE (("book_access"."book_id" = "books"."id") AND ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text"))))))))));



CREATE POLICY "Users can view their own access" ON "public"."book_access" FOR SELECT TO "authenticated" USING ((("invited_email" = ("auth"."jwt"() ->> 'email'::"text")) OR ("user_id" = "auth"."uid"())));



CREATE POLICY "Users can view their own book preferences" ON "public"."user_book_preferences" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own books and shared books" ON "public"."books" FOR SELECT TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR ("is_public" = true) OR "public"."user_has_book_access_accepted"("id")));



ALTER TABLE "public"."admin_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_users_readable" ON "public"."admin_users" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "admins_can_abort_ai_calls" ON "public"."ai_calls" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"()))));



CREATE POLICY "admins_can_manage_any_book_access" ON "public"."book_access" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"()))));



CREATE POLICY "admins_can_read_any_book" ON "public"."books" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"()))));



CREATE POLICY "admins_can_read_any_book_chat" ON "public"."book_chats" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"()))));



CREATE POLICY "admins_can_read_any_page" ON "public"."pages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"()))));



CREATE POLICY "admins_can_update_any_book" ON "public"."books" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"()))));



CREATE POLICY "admins_can_write_any_page" ON "public"."pages" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"()))));



CREATE POLICY "admins_insert_admin_settings" ON "public"."admin_settings" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"()))));



CREATE POLICY "admins_read_admin_settings" ON "public"."admin_settings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"()))));



CREATE POLICY "admins_write_admin_settings" ON "public"."admin_settings" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."ai_call_evals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_calls" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "authenticated read" ON "public"."node_type_configs" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."beat_chats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blob_json" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "blob_json_insert_policy" ON "public"."blob_json" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "blob_json_select_policy" ON "public"."blob_json" FOR SELECT USING (true);



ALTER TABLE "public"."book_access" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_agent_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_agent_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_chats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "book_chats_delete_policy" ON "public"."book_chats" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "book_chats_insert_policy" ON "public"."book_chats" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "book_chats_select_policy" ON "public"."book_chats" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "book_chats_update_policy" ON "public"."book_chats" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."book_commits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_decompositions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_evaluations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_generations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_nodes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_publish_pointer" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "book_publish_pointer_select_policy" ON "public"."book_publish_pointer" FOR SELECT USING (("book_id" IN ( SELECT "books"."id"
   FROM "public"."books"
  WHERE (("books"."is_public" = true) OR ("books"."owner_id" = "auth"."uid"()))
UNION
 SELECT "book_access"."book_id"
   FROM "public"."book_access"
  WHERE ("book_access"."user_id" = "auth"."uid"()))));



CREATE POLICY "book_publish_pointer_update_policy" ON "public"."book_publish_pointer" USING (("book_id" IN ( SELECT "books"."id"
   FROM "public"."books"
  WHERE ("books"."owner_id" = "auth"."uid"())))) WITH CHECK (("book_id" IN ( SELECT "books"."id"
   FROM "public"."books"
  WHERE ("books"."owner_id" = "auth"."uid"()))));



ALTER TABLE "public"."book_revisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_thread_anchors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_thread_scans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_threads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_tree_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "book_versions_editor_select" ON "public"."book_versions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."book_access" "ba"
     JOIN "public"."books" "b" ON (("b"."id" = "ba"."book_id")))
  WHERE (("ba"."book_id" = "book_versions"."book_id") AND ("ba"."user_id" = "auth"."uid"()) AND ("ba"."access_level" = 'edit'::"public"."book_access_level")))));



CREATE POLICY "book_versions_owner_delete" ON "public"."book_versions" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "book_versions"."book_id") AND ("books"."owner_id" = "auth"."uid"())))));



CREATE POLICY "book_versions_owner_insert" ON "public"."book_versions" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "book_versions"."book_id") AND ("books"."owner_id" = "auth"."uid"())))));



CREATE POLICY "book_versions_owner_select" ON "public"."book_versions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "book_versions"."book_id") AND ("books"."owner_id" = "auth"."uid"())))));



CREATE POLICY "book_versions_owner_update" ON "public"."book_versions" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "book_versions"."book_id") AND ("books"."owner_id" = "auth"."uid"())))));



CREATE POLICY "book_versions_public_select" ON "public"."book_versions" FOR SELECT USING ((("is_published" = true) AND (EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "book_versions"."book_id") AND ("books"."is_public" = true))))));



ALTER TABLE "public"."books" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commit_entry" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "commit_entry_insert_policy" ON "public"."commit_entry" FOR INSERT WITH CHECK (("commit_id" IN ( SELECT "commit"."id"
   FROM "public"."commit"
  WHERE ("commit"."book_id" IN ( SELECT "books"."id"
           FROM "public"."books"
          WHERE ("books"."owner_id" = "auth"."uid"())
        UNION
         SELECT "book_access"."book_id"
           FROM "public"."book_access"
          WHERE (("book_access"."user_id" = "auth"."uid"()) AND ("book_access"."access_level" = 'edit'::"public"."book_access_level")))))));



CREATE POLICY "commit_entry_select_policy" ON "public"."commit_entry" FOR SELECT USING (("commit_id" IN ( SELECT "commit"."id"
   FROM "public"."commit"
  WHERE ("commit"."book_id" IN ( SELECT "books"."id"
           FROM "public"."books"
          WHERE ("books"."owner_id" = "auth"."uid"())
        UNION
         SELECT "book_access"."book_id"
           FROM "public"."book_access"
          WHERE ("book_access"."user_id" = "auth"."uid"()))))));



CREATE POLICY "commit_insert_policy" ON "public"."commit" FOR INSERT WITH CHECK (("book_id" IN ( SELECT "books"."id"
   FROM "public"."books"
  WHERE ("books"."owner_id" = "auth"."uid"())
UNION
 SELECT "book_access"."book_id"
   FROM "public"."book_access"
  WHERE (("book_access"."user_id" = "auth"."uid"()) AND ("book_access"."access_level" = 'edit'::"public"."book_access_level")))));



CREATE POLICY "commit_select_policy" ON "public"."commit" FOR SELECT USING (("book_id" IN ( SELECT "books"."id"
   FROM "public"."books"
  WHERE ("books"."owner_id" = "auth"."uid"())
UNION
 SELECT "book_access"."book_id"
   FROM "public"."book_access"
  WHERE ("book_access"."user_id" = "auth"."uid"()))));



CREATE POLICY "delete_books" ON "public"."books" FOR DELETE TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "delete_notification_schedules" ON "public"."reminders" FOR DELETE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "delete_notifications" ON "public"."notifications" FOR DELETE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "delete_user_data" ON "public"."user_data" FOR DELETE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."dna_chats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "editors delete agent sessions" ON "public"."book_agent_sessions" FOR DELETE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors delete generations" ON "public"."book_generations" FOR DELETE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors delete nodes" ON "public"."book_nodes" FOR DELETE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors delete thread anchors" ON "public"."book_thread_anchors" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."book_threads" "bt"
  WHERE (("bt"."id" = "book_thread_anchors"."thread_id") AND "public"."user_can_edit_book"("bt"."book_id")))));



CREATE POLICY "editors delete thread scans" ON "public"."book_thread_scans" FOR DELETE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors delete threads" ON "public"."book_threads" FOR DELETE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors delete tree versions" ON "public"."book_tree_versions" FOR DELETE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert agent runs" ON "public"."book_agent_runs" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert agent sessions" ON "public"."book_agent_sessions" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert beat chats" ON "public"."beat_chats" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert decompositions" ON "public"."book_decompositions" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert dna_chats" ON "public"."dna_chats" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert evaluations" ON "public"."book_evaluations" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert generations" ON "public"."book_generations" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert nodes" ON "public"."book_nodes" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert revision chats" ON "public"."revision_chats" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert revisions" ON "public"."book_revisions" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert thread anchors" ON "public"."book_thread_anchors" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."book_threads" "bt"
  WHERE (("bt"."id" = "book_thread_anchors"."thread_id") AND "public"."user_can_edit_book"("bt"."book_id")))));



CREATE POLICY "editors insert thread scans" ON "public"."book_thread_scans" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert threads" ON "public"."book_threads" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors insert tree versions" ON "public"."book_tree_versions" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read agent runs" ON "public"."book_agent_runs" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read agent sessions" ON "public"."book_agent_sessions" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read beat chats" ON "public"."beat_chats" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read decompositions" ON "public"."book_decompositions" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read dna_chats" ON "public"."dna_chats" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read evaluations" ON "public"."book_evaluations" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read generations" ON "public"."book_generations" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read nodes" ON "public"."book_nodes" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read revision chats" ON "public"."revision_chats" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read revisions" ON "public"."book_revisions" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read thread anchors" ON "public"."book_thread_anchors" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."book_threads" "bt"
  WHERE (("bt"."id" = "book_thread_anchors"."thread_id") AND "public"."user_can_edit_book"("bt"."book_id")))));



CREATE POLICY "editors read thread scans" ON "public"."book_thread_scans" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read threads" ON "public"."book_threads" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors read tree versions" ON "public"."book_tree_versions" FOR SELECT TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors update agent runs" ON "public"."book_agent_runs" FOR UPDATE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors update beat chats" ON "public"."beat_chats" FOR UPDATE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors update decompositions" ON "public"."book_decompositions" FOR UPDATE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors update dna_chats" ON "public"."dna_chats" FOR UPDATE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors update evaluations" ON "public"."book_evaluations" FOR UPDATE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors update generations" ON "public"."book_generations" FOR UPDATE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors update nodes" ON "public"."book_nodes" FOR UPDATE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors update revision chats" ON "public"."revision_chats" FOR UPDATE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors update revisions" ON "public"."book_revisions" FOR UPDATE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors update thread anchors" ON "public"."book_thread_anchors" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."book_threads" "bt"
  WHERE (("bt"."id" = "book_thread_anchors"."thread_id") AND "public"."user_can_edit_book"("bt"."book_id")))));



CREATE POLICY "editors update thread scans" ON "public"."book_thread_scans" FOR UPDATE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors update threads" ON "public"."book_threads" FOR UPDATE TO "authenticated" USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors_and_admins_read_ai_call_evals" ON "public"."ai_call_evals" FOR SELECT USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "editors_and_admins_read_ai_calls" ON "public"."ai_calls" FOR SELECT USING ("public"."user_can_edit_book"("book_id"));



CREATE POLICY "enable_insert_with_valid_view_token" ON "public"."book_access" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "book_access"."book_id") AND (("books"."view_invitation_token")::"text" = ("book_access"."invitation_token")::"text")))) AND ("access_level" = 'view'::"public"."book_access_level")));



CREATE POLICY "enable_read_access_for_books_and_collaborators" ON "public"."books" FOR SELECT USING ((("owner_id" = "auth"."uid"()) OR ("is_public" = true) OR "public"."user_has_book_access_any_status"("id")));



CREATE POLICY "enable_update_for_owners_and_editors" ON "public"."books" FOR UPDATE TO "authenticated" USING ("public"."user_is_book_editor"("id"));



ALTER TABLE "public"."flashcards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "flashcards_delete_policy" ON "public"."flashcards" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "flashcards_insert_policy" ON "public"."flashcards" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "flashcards_select_policy" ON "public"."flashcards" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "flashcards_update_policy" ON "public"."flashcards" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "insert_book_access" ON "public"."book_access" FOR INSERT WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "insert_books" ON "public"."books" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "insert_notification_schedules" ON "public"."reminders" FOR INSERT WITH CHECK (("auth"."uid"() = "owner_id"));



CREATE POLICY "insert_user_data" ON "public"."user_data" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."node_scene_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."node_type_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_audio" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_audio_blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_chats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "page_chats_delete_policy" ON "public"."page_chats" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "page_chats_insert_policy" ON "public"."page_chats" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "page_chats_select_policy" ON "public"."page_chats" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "page_chats_update_policy" ON "public"."page_chats" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."page_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "page_comments_delete_policy" ON "public"."page_comments" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "page_comments"."book_id") AND (("books"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."book_access"
          WHERE (("book_access"."book_id" = "books"."id") AND (("book_access"."user_id" = "auth"."uid"()) OR ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text"))) AND ("book_access"."access_level" = 'edit'::"public"."book_access_level") AND ("book_access"."status" = 'accepted'::"text"))))))))));



CREATE POLICY "page_comments_insert_policy" ON "public"."page_comments" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "page_comments"."book_id") AND (("books"."owner_id" = "auth"."uid"()) OR ("books"."is_public" = true) OR (EXISTS ( SELECT 1
           FROM "public"."book_access"
          WHERE (("book_access"."book_id" = "books"."id") AND (("book_access"."user_id" = "auth"."uid"()) OR ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text"))) AND ("book_access"."status" = 'accepted'::"text"))))))))));



CREATE POLICY "page_comments_select_policy" ON "public"."page_comments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "page_comments"."book_id") AND (("books"."owner_id" = "auth"."uid"()) OR ("books"."is_public" = true) OR (EXISTS ( SELECT 1
           FROM "public"."book_access"
          WHERE (("book_access"."book_id" = "books"."id") AND (("book_access"."user_id" = "auth"."uid"()) OR ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text"))) AND ("book_access"."status" = 'accepted'::"text")))))))));



CREATE POLICY "page_comments_update_policy" ON "public"."page_comments" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "page_comments"."book_id") AND (("books"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."book_access"
          WHERE (("book_access"."book_id" = "books"."id") AND (("book_access"."user_id" = "auth"."uid"()) OR ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text"))) AND ("book_access"."access_level" = 'edit'::"public"."book_access_level") AND ("book_access"."status" = 'accepted'::"text")))))))))) WITH CHECK ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "page_comments"."book_id") AND (("books"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."book_access"
          WHERE (("book_access"."book_id" = "books"."id") AND (("book_access"."user_id" = "auth"."uid"()) OR ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text"))) AND ("book_access"."access_level" = 'edit'::"public"."book_access_level") AND ("book_access"."status" = 'accepted'::"text"))))))))));



ALTER TABLE "public"."page_scene_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "page_versions_editor_select" ON "public"."page_versions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."book_versions" "bv"
     JOIN "public"."books" "b" ON (("b"."id" = "bv"."book_id")))
     JOIN "public"."book_access" "ba" ON (("ba"."book_id" = "b"."id")))
  WHERE (("bv"."id" = "page_versions"."book_version_id") AND ("ba"."user_id" = "auth"."uid"()) AND ("ba"."access_level" = 'edit'::"public"."book_access_level")))));



CREATE POLICY "page_versions_owner_delete" ON "public"."page_versions" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."book_versions" "bv"
     JOIN "public"."books" "b" ON (("b"."id" = "bv"."book_id")))
  WHERE (("bv"."id" = "page_versions"."book_version_id") AND ("b"."owner_id" = "auth"."uid"())))));



CREATE POLICY "page_versions_owner_insert" ON "public"."page_versions" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."book_versions" "bv"
     JOIN "public"."books" "b" ON (("b"."id" = "bv"."book_id")))
  WHERE (("bv"."id" = "page_versions"."book_version_id") AND ("b"."owner_id" = "auth"."uid"())))));



CREATE POLICY "page_versions_owner_select" ON "public"."page_versions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."book_versions" "bv"
     JOIN "public"."books" "b" ON (("b"."id" = "bv"."book_id")))
  WHERE (("bv"."id" = "page_versions"."book_version_id") AND ("b"."owner_id" = "auth"."uid"())))));



CREATE POLICY "page_versions_owner_update" ON "public"."page_versions" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."book_versions" "bv"
     JOIN "public"."books" "b" ON (("b"."id" = "bv"."book_id")))
  WHERE (("bv"."id" = "page_versions"."book_version_id") AND ("b"."owner_id" = "auth"."uid"())))));



CREATE POLICY "page_versions_public_select" ON "public"."page_versions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."book_versions" "bv"
     JOIN "public"."books" "b" ON (("b"."id" = "bv"."book_id")))
  WHERE (("bv"."id" = "page_versions"."book_version_id") AND ("bv"."is_published" = true) AND ("b"."is_public" = true)))));



ALTER TABLE "public"."pages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pages_insert_policy" ON "public"."pages" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "pages"."book_id") AND (("books"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."book_access"
          WHERE (("book_access"."book_id" = "books"."id") AND ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text")) AND ("book_access"."access_level" = 'edit'::"public"."book_access_level")))))))));



CREATE POLICY "pages_select_policy" ON "public"."pages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "pages"."book_id") AND (("books"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."book_access"
          WHERE (("book_access"."book_id" = "books"."id") AND ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text"))))) OR ((NOT "books"."is_archived") AND ("books"."is_public" = true)))))));



CREATE POLICY "pages_update_policy" ON "public"."pages" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "pages"."book_id") AND (("books"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."book_access"
          WHERE (("book_access"."book_id" = "books"."id") AND ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text")) AND ("book_access"."access_level" = 'edit'::"public"."book_access_level"))))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."books"
  WHERE (("books"."id" = "pages"."book_id") AND (("books"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."book_access"
          WHERE (("book_access"."book_id" = "books"."id") AND ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text")) AND ("book_access"."access_level" = 'edit'::"public"."book_access_level")))))))));



ALTER TABLE "public"."reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."revision_chats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "select_book_access" ON "public"."book_access" FOR SELECT USING ((("invited_email" = ("auth"."jwt"() ->> 'email'::"text")) OR ("user_id" = "auth"."uid"()) OR ("created_by" = "auth"."uid"())));



CREATE POLICY "select_books" ON "public"."books" FOR SELECT USING ((("is_public" = true) OR ("owner_id" = "auth"."uid"()) OR "public"."check_book_access"("id", ("auth"."jwt"() ->> 'email'::"text"))));



CREATE POLICY "select_notification_schedules" ON "public"."reminders" FOR SELECT USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "select_notifications" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "select_user_data" ON "public"."user_data" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "update_book_access" ON "public"."book_access" FOR UPDATE USING ((("created_by" = "auth"."uid"()) OR (("invited_email" = ("auth"."jwt"() ->> 'email'::"text")) AND ("user_id" IS NULL) AND ("status" = 'pending'::"text"))));



CREATE POLICY "update_notification_schedules" ON "public"."reminders" FOR UPDATE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "update_notifications" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "update_user_data" ON "public"."user_data" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_book_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_data" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_can_view_their_invites" ON "public"."book_access" FOR SELECT USING (("invited_email" = ("auth"."jwt"() ->> 'email'::"text")));



ALTER TABLE "public"."workspace" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_page" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspace_page_policy" ON "public"."workspace_page" USING (("workspace_id" IN ( SELECT "workspace"."id"
   FROM "public"."workspace"
  WHERE ("workspace"."user_id" = "auth"."uid"())))) WITH CHECK (("workspace_id" IN ( SELECT "workspace"."id"
   FROM "public"."workspace"
  WHERE ("workspace"."user_id" = "auth"."uid"()))));



CREATE POLICY "workspace_page_update_policy" ON "public"."workspace_page" FOR UPDATE TO "authenticated" USING (("workspace_id" IN ( SELECT "workspace"."id"
   FROM "public"."workspace"
  WHERE ("workspace"."user_id" = "auth"."uid"())))) WITH CHECK (("workspace_id" IN ( SELECT "workspace"."id"
   FROM "public"."workspace"
  WHERE ("workspace"."user_id" = "auth"."uid"()))));



CREATE POLICY "workspace_policy" ON "public"."workspace" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."archive_associated_data"() TO "anon";
GRANT ALL ON FUNCTION "public"."archive_associated_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_associated_data"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assert_book_read_access"("p_book_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."assert_book_read_access"("p_book_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_book_read_access"("p_book_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_book_access"("p_book_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_book_access"("p_book_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_book_access"("p_book_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_book_access"("book_id" integer, "user_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_book_access"("book_id" integer, "user_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_book_access"("book_id" integer, "user_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."commit_from_workspace"("p_book_id" integer, "p_user_id" "uuid", "p_message" "text", "p_include_paths" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."commit_from_workspace"("p_book_id" integer, "p_user_id" "uuid", "p_message" "text", "p_include_paths" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."commit_from_workspace"("p_book_id" integer, "p_user_id" "uuid", "p_message" "text", "p_include_paths" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_book_version"("p_book_id" bigint, "p_commit_message" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_book_version"("p_book_id" bigint, "p_commit_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_book_version"("p_book_id" bigint, "p_commit_message" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_next_page"("p_book_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."create_next_page"("p_book_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_next_page"("p_book_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."dna_jsonb_replace_text"("data" "jsonb", "find_word" "text", "replace_word" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."dna_jsonb_replace_text"("data" "jsonb", "find_word" "text", "replace_word" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dna_jsonb_replace_text"("data" "jsonb", "find_word" "text", "replace_word" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."dna_regex_escape"("input" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."dna_regex_escape"("input" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dna_regex_escape"("input" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_stalled_ai_calls"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_stalled_ai_calls"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_stalled_ai_calls"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_slug"("input_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_slug"("input_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_slug"("input_text" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_admin_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_admin_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_draft_changes"("p_book_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_draft_changes"("p_book_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_draft_changes"("p_book_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_uncommitted_changes_count"("p_book_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_uncommitted_changes_count"("p_book_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_uncommitted_changes_count"("p_book_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_version_details"("p_version_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_version_details"("p_version_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_version_details"("p_version_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_version_history"("p_book_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_version_history"("p_book_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_version_history"("p_book_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."highlight_search_results_in_page"("search_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."highlight_search_results_in_page"("search_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."highlight_search_results_in_page"("search_query" "text") TO "service_role";



GRANT ALL ON TABLE "public"."pages" TO "anon";
GRANT ALL ON TABLE "public"."pages" TO "authenticated";
GRANT ALL ON TABLE "public"."pages" TO "service_role";



GRANT ALL ON FUNCTION "public"."match_documents"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "min_content_length" integer, "owner_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."match_documents"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "min_content_length" integer, "owner_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_documents"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "min_content_length" integer, "owner_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_book_page_indices"("p_book_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_book_page_indices"("p_book_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_book_page_indices"("p_book_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_revalidate_book"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_revalidate_book"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_revalidate_book"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_task_done"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_task_done"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_task_done"() TO "service_role";



GRANT ALL ON FUNCTION "public"."propagate_character_rename"() TO "anon";
GRANT ALL ON FUNCTION "public"."propagate_character_rename"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."propagate_character_rename"() TO "service_role";



GRANT ALL ON FUNCTION "public"."publish_version"("p_book_id" bigint, "p_version_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."publish_version"("p_book_id" bigint, "p_version_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."publish_version"("p_book_id" bigint, "p_version_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."revert_page"("p_book_id" bigint, "p_page_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."revert_page"("p_book_id" bigint, "p_page_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."revert_page"("p_book_id" bigint, "p_page_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."revive_stalled_chains"() TO "anon";
GRANT ALL ON FUNCTION "public"."revive_stalled_chains"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."revive_stalled_chains"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rollback_to_version"("p_book_id" bigint, "p_version_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."rollback_to_version"("p_book_id" bigint, "p_version_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rollback_to_version"("p_book_id" bigint, "p_version_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_book_contents"("search_query" "text", "book_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_book_contents"("search_query" "text", "book_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_book_contents"("search_query" "text", "book_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_search"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "min_content_length" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_search"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "min_content_length" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_search"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer, "min_content_length" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."snapshot_book_tree"("p_book_id" integer, "p_label" "text", "p_keep_auto" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."snapshot_book_tree"("p_book_id" integer, "p_label" "text", "p_keep_auto" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."snapshot_book_tree"("p_book_id" integer, "p_label" "text", "p_keep_auto" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_commit_to_pages"("p_commit_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_commit_to_pages"("p_commit_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_commit_to_pages"("p_commit_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_beat_chats_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_beat_chats_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_beat_chats_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_book_agent_runs_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_book_agent_runs_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_book_agent_runs_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_book_decompositions_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_book_decompositions_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_book_decompositions_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_book_generations_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_book_generations_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_book_generations_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_book_nodes_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_book_nodes_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_book_nodes_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_book_revisions_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_book_revisions_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_book_revisions_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_book_threads_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_book_threads_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_book_threads_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_dna_chats_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_dna_chats_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_dna_chats_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_revision_chats_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_revision_chats_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_revision_chats_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_book_draft_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_book_draft_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_book_draft_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_book_git_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_book_git_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_book_git_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_habit_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_habit_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_habit_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_notebook_on_page_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_notebook_on_page_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_notebook_on_page_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_page_audio_blocks_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_page_audio_blocks_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_page_audio_blocks_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_slug"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_slug"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_slug"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_can_edit_book"("_book_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."user_can_edit_book"("_book_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_can_edit_book"("_book_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."user_has_book_access_accepted"("_book_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_book_access_accepted"("_book_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_book_access_accepted"("_book_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."user_has_book_access_any_status"("_book_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_book_access_any_status"("_book_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_book_access_any_status"("_book_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."user_is_book_editor"("_book_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."user_is_book_editor"("_book_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_is_book_editor"("_book_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_page_search"("query_embedding" "extensions"."vector", "match_threshold" double precision, "min_content_length" integer, "match_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_page_search"("query_embedding" "extensions"."vector", "match_threshold" double precision, "min_content_length" integer, "match_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_page_search"("query_embedding" "extensions"."vector", "match_threshold" double precision, "min_content_length" integer, "match_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."workspace_page_upsert"("p_workspace_id" "uuid", "p_page_path" "text", "p_blob_hash" "text", "p_expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."workspace_page_upsert"("p_workspace_id" "uuid", "p_page_path" "text", "p_blob_hash" "text", "p_expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."workspace_page_upsert"("p_workspace_id" "uuid", "p_page_path" "text", "p_blob_hash" "text", "p_expected_version" integer) TO "service_role";



GRANT ALL ON TABLE "public"."admin_settings" TO "anon";
GRANT ALL ON TABLE "public"."admin_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_settings" TO "service_role";



GRANT ALL ON TABLE "public"."admin_users" TO "anon";
GRANT ALL ON TABLE "public"."admin_users" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_users" TO "service_role";



GRANT ALL ON TABLE "public"."ai_call_evals" TO "anon";
GRANT ALL ON TABLE "public"."ai_call_evals" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_call_evals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_call_evals_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_call_evals_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_call_evals_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ai_calls" TO "anon";
GRANT ALL ON TABLE "public"."ai_calls" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_calls" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_calls_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_calls_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_calls_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."beat_chats" TO "anon";
GRANT ALL ON TABLE "public"."beat_chats" TO "authenticated";
GRANT ALL ON TABLE "public"."beat_chats" TO "service_role";



GRANT ALL ON SEQUENCE "public"."beat_chats_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."beat_chats_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."beat_chats_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."blob_json" TO "anon";
GRANT ALL ON TABLE "public"."blob_json" TO "authenticated";
GRANT ALL ON TABLE "public"."blob_json" TO "service_role";



GRANT ALL ON TABLE "public"."book_access" TO "anon";
GRANT ALL ON TABLE "public"."book_access" TO "authenticated";
GRANT ALL ON TABLE "public"."book_access" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_access_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_access_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_access_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_agent_runs" TO "anon";
GRANT ALL ON TABLE "public"."book_agent_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."book_agent_runs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_agent_runs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_agent_runs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_agent_runs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_agent_sessions" TO "anon";
GRANT ALL ON TABLE "public"."book_agent_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."book_agent_sessions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_agent_sessions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_agent_sessions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_agent_sessions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_chats" TO "anon";
GRANT ALL ON TABLE "public"."book_chats" TO "authenticated";
GRANT ALL ON TABLE "public"."book_chats" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_chats_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_chats_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_chats_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_commits" TO "anon";
GRANT ALL ON TABLE "public"."book_commits" TO "authenticated";
GRANT ALL ON TABLE "public"."book_commits" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_commits_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_commits_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_commits_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_decompositions" TO "anon";
GRANT ALL ON TABLE "public"."book_decompositions" TO "authenticated";
GRANT ALL ON TABLE "public"."book_decompositions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_decompositions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_decompositions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_decompositions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_evaluations" TO "anon";
GRANT ALL ON TABLE "public"."book_evaluations" TO "authenticated";
GRANT ALL ON TABLE "public"."book_evaluations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_evaluations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_evaluations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_evaluations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_generations" TO "anon";
GRANT ALL ON TABLE "public"."book_generations" TO "authenticated";
GRANT ALL ON TABLE "public"."book_generations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_generations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_generations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_generations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_nodes" TO "anon";
GRANT ALL ON TABLE "public"."book_nodes" TO "authenticated";
GRANT ALL ON TABLE "public"."book_nodes" TO "service_role";



GRANT ALL ON TABLE "public"."book_publish_pointer" TO "anon";
GRANT ALL ON TABLE "public"."book_publish_pointer" TO "authenticated";
GRANT ALL ON TABLE "public"."book_publish_pointer" TO "service_role";



GRANT ALL ON TABLE "public"."book_revisions" TO "anon";
GRANT ALL ON TABLE "public"."book_revisions" TO "authenticated";
GRANT ALL ON TABLE "public"."book_revisions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_revisions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_revisions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_revisions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_thread_anchors" TO "anon";
GRANT ALL ON TABLE "public"."book_thread_anchors" TO "authenticated";
GRANT ALL ON TABLE "public"."book_thread_anchors" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_thread_anchors_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_thread_anchors_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_thread_anchors_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_thread_scans" TO "anon";
GRANT ALL ON TABLE "public"."book_thread_scans" TO "authenticated";
GRANT ALL ON TABLE "public"."book_thread_scans" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_thread_scans_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_thread_scans_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_thread_scans_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_threads" TO "anon";
GRANT ALL ON TABLE "public"."book_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."book_threads" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_threads_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_threads_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_threads_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_tree_versions" TO "anon";
GRANT ALL ON TABLE "public"."book_tree_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."book_tree_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_tree_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_tree_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_tree_versions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."book_versions" TO "anon";
GRANT ALL ON TABLE "public"."book_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."book_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."book_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_versions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."books" TO "anon";
GRANT ALL ON TABLE "public"."books" TO "authenticated";
GRANT ALL ON TABLE "public"."books" TO "service_role";



GRANT ALL ON TABLE "public"."commit" TO "anon";
GRANT ALL ON TABLE "public"."commit" TO "authenticated";
GRANT ALL ON TABLE "public"."commit" TO "service_role";



GRANT ALL ON TABLE "public"."commit_entry" TO "anon";
GRANT ALL ON TABLE "public"."commit_entry" TO "authenticated";
GRANT ALL ON TABLE "public"."commit_entry" TO "service_role";



GRANT ALL ON TABLE "public"."dna_chats" TO "anon";
GRANT ALL ON TABLE "public"."dna_chats" TO "authenticated";
GRANT ALL ON TABLE "public"."dna_chats" TO "service_role";



GRANT ALL ON SEQUENCE "public"."dna_chats_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."dna_chats_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."dna_chats_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."flashcards" TO "anon";
GRANT ALL ON TABLE "public"."flashcards" TO "authenticated";
GRANT ALL ON TABLE "public"."flashcards" TO "service_role";



GRANT ALL ON SEQUENCE "public"."flashcards_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."flashcards_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."flashcards_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."journal_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."journal_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."journal_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON SEQUENCE "public"."leads_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."leads_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."leads_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."node_scene_images" TO "anon";
GRANT ALL ON TABLE "public"."node_scene_images" TO "authenticated";
GRANT ALL ON TABLE "public"."node_scene_images" TO "service_role";



GRANT ALL ON TABLE "public"."node_type_configs" TO "anon";
GRANT ALL ON TABLE "public"."node_type_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."node_type_configs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."node_type_configs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."node_type_configs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."node_type_configs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."reminders" TO "anon";
GRANT ALL ON TABLE "public"."reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."reminders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."notification_schedules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."notification_schedules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notification_schedules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."page_audio" TO "anon";
GRANT ALL ON TABLE "public"."page_audio" TO "authenticated";
GRANT ALL ON TABLE "public"."page_audio" TO "service_role";



GRANT ALL ON TABLE "public"."page_audio_blocks" TO "anon";
GRANT ALL ON TABLE "public"."page_audio_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."page_audio_blocks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."page_audio_blocks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."page_audio_blocks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."page_audio_blocks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."page_chats" TO "anon";
GRANT ALL ON TABLE "public"."page_chats" TO "authenticated";
GRANT ALL ON TABLE "public"."page_chats" TO "service_role";



GRANT ALL ON SEQUENCE "public"."page_chats_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."page_chats_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."page_chats_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."page_comments" TO "anon";
GRANT ALL ON TABLE "public"."page_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."page_comments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."page_comments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."page_comments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."page_comments_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."page_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."page_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."page_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."page_scene_images" TO "anon";
GRANT ALL ON TABLE "public"."page_scene_images" TO "authenticated";
GRANT ALL ON TABLE "public"."page_scene_images" TO "service_role";



GRANT ALL ON TABLE "public"."page_versions" TO "anon";
GRANT ALL ON TABLE "public"."page_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."page_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."page_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."page_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."page_versions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_data" TO "anon";
GRANT ALL ON TABLE "public"."user_data" TO "authenticated";
GRANT ALL ON TABLE "public"."user_data" TO "service_role";



GRANT ALL ON TABLE "public"."public_user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."public_user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."public_user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."revision_chats" TO "anon";
GRANT ALL ON TABLE "public"."revision_chats" TO "authenticated";
GRANT ALL ON TABLE "public"."revision_chats" TO "service_role";



GRANT ALL ON SEQUENCE "public"."revision_chats_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."revision_chats_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."revision_chats_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_book_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_book_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_book_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."workspace" TO "anon";
GRANT ALL ON TABLE "public"."workspace" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace" TO "service_role";



GRANT ALL ON TABLE "public"."workspace_page" TO "anon";
GRANT ALL ON TABLE "public"."workspace_page" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_page" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






