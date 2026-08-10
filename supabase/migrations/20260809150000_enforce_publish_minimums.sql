-- Publish gate: a book cannot go public (books.is_public: false -> true) unless it
-- has at least one non-archived text page and the manuscript has at least 100 words.
-- Word counting mirrors apps/web/src/utils/tiptapHelpers.ts (jsonToText + getWordCountFromContent)
-- so the DB check agrees with what the editor UI shows the author.

CREATE OR REPLACE FUNCTION "public"."tiptap_node_text"("node" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  result text := '';
  child jsonb;
BEGIN
  IF node IS NULL THEN
    RETURN '';
  END IF;
  IF node ->> 'type' = 'text' THEN
    RETURN COALESCE(node ->> 'text', '');
  END IF;
  IF jsonb_typeof(node -> 'content') = 'array' THEN
    FOR child IN SELECT * FROM jsonb_array_elements(node -> 'content') LOOP
      result := result || "public"."tiptap_node_text"(child);
    END LOOP;
  END IF;
  RETURN result;
END;
$$;

COMMENT ON FUNCTION "public"."tiptap_node_text"("jsonb") IS
  'Recursively extracts plain text from a tiptap/prosemirror JSON node. Mirrors the client''s jsonToText().';

CREATE OR REPLACE FUNCTION "public"."tiptap_word_count"("content" "jsonb") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE WHEN trim("public"."tiptap_node_text"("content")) = '' THEN 0
    ELSE array_length(regexp_split_to_array(trim("public"."tiptap_node_text"("content")), '\s+'), 1)
  END;
$$;

COMMENT ON FUNCTION "public"."tiptap_word_count"("jsonb") IS
  'Word count of a tiptap/prosemirror JSON page body. Mirrors the client''s getWordCountFromContent().';

CREATE OR REPLACE FUNCTION "public"."enforce_publish_minimums"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_page_count integer;
  v_word_count integer;
BEGIN
  IF NEW.is_public IS TRUE AND COALESCE(OLD.is_public, false) IS FALSE THEN
    SELECT count(*) INTO v_page_count
    FROM public.pages
    WHERE book_id = NEW.id AND archived = false;

    IF v_page_count = 0 THEN
      RAISE EXCEPTION 'Cannot publish book %: it has no pages', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(sum(public.tiptap_word_count(content)), 0) INTO v_word_count
    FROM public.pages
    WHERE book_id = NEW.id AND archived = false AND page_type = 'text';

    IF v_word_count < 100 THEN
      RAISE EXCEPTION 'Cannot publish book %: manuscript has only % words (minimum 100)', NEW.id, v_word_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."enforce_publish_minimums"() IS
  'Blocks books.is_public flipping false->true unless the book has >=1 page and >=100 words.';

DROP TRIGGER IF EXISTS "trg_enforce_publish_minimums" ON "public"."books";
CREATE TRIGGER "trg_enforce_publish_minimums"
  BEFORE UPDATE ON "public"."books"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."enforce_publish_minimums"();
