
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

CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgsodium" WITH SCHEMA "pgsodium";

COMMENT ON SCHEMA "public" IS 'standard public schema';

CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";

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

CREATE OR REPLACE FUNCTION "public"."extract_title_from_content"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Only proceed if title is null, empty, or 'Untitled'
    IF (NEW.title IS NULL OR NEW.title = '' OR NEW.title = 'Untitled') THEN
        IF NEW.html_content IS NULL OR NEW.html_content = '' THEN
            -- If content is empty, set title to 'Untitled'
            NEW.title := 'Untitled';
        ELSE
            -- Extract text from first heading if it exists
            WITH first_heading AS (
                SELECT (regexp_matches(NEW.html_content, '<h[1-6][^>]*>(.*?)</h[1-6]>', 'i'))[1] AS heading_text
                LIMIT 1
            )
            SELECT 
                CASE 
                    WHEN heading_text IS NOT NULL THEN heading_text
                    ELSE 
                        -- If no heading, get first 50 characters of text content
                        substring(
                            regexp_replace(
                                regexp_replace(NEW.html_content, '<[^>]*>', '', 'g'), -- Remove HTML tags
                                '^\s+', -- Remove leading whitespace
                                ''
                            ),
                            1, 
                            50
                        )
                END
            INTO NEW.title
            FROM first_heading;

            -- Clean up the title
            NEW.title := regexp_replace(NEW.title, '\s+', ' ', 'g'); -- Replace multiple spaces with single space
            NEW.title := trim(NEW.title); -- Remove leading/trailing whitespace
            
            -- If title is empty after cleanup, set to 'Untitled'
            IF NEW.title = '' THEN
                NEW.title := 'Untitled';
            -- If title is too long, truncate and add ellipsis
            ELSIF length(NEW.title) > 50 THEN
                -- Try to cut at the last space to avoid cutting words
                NEW.title := substring(NEW.title, 1, 50 - position(' ' in reverse(substring(NEW.title, 1, 50)))) || '...';
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."extract_title_from_content"() OWNER TO "postgres";

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
    "slug" "text"
);

ALTER TABLE "public"."pages" OWNER TO "postgres";

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
    NEW.updated_at = CURRENT_TIMESTAMP;
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

CREATE TABLE IF NOT EXISTS "public"."book_access" (
    "id" bigint NOT NULL,
    "book_id" integer,
    "user_id" "uuid",
    "access_level" "public"."book_access_level" NOT NULL,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "created_by" "uuid",
    "status" "text" DEFAULT 'pending'::"text",
    "invited_email" "text"
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

CREATE TABLE IF NOT EXISTS "public"."books" (
    "id" integer NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"(),
    "name" "text" DEFAULT 'Untitled'::"text",
    "bookmarked_page_index" integer,
    "pinned" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "archived" boolean DEFAULT false,
    "page_ids" "jsonb" DEFAULT '[]'::"jsonb",
    "last_published_at" timestamp without time zone,
    "book_id" integer,
    "digest_bookmarked_page_index" integer DEFAULT 0,
    "last_read" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "is_public" boolean DEFAULT false,
    "published_at" timestamp with time zone,
    "cover_url" "text",
    "subtitle" "text",
    "author" "text",
    "slug" "text",
    "show_text_on_cover" boolean DEFAULT true
);

ALTER TABLE "public"."books" OWNER TO "postgres";

COMMENT ON COLUMN "public"."books"."page_ids" IS 'DEPRECATED: Use pages.page_index instead';

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

CREATE SEQUENCE IF NOT EXISTS "public"."page_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER TABLE "public"."page_id_seq" OWNER TO "postgres";

ALTER SEQUENCE "public"."page_id_seq" OWNED BY "public"."pages"."id";

CREATE TABLE IF NOT EXISTS "public"."user_data" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "default_notebook" integer,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "email" "text",
    "timezone" "text",
    "one_time_events" "jsonb" DEFAULT '[]'::"jsonb",
    "username" "text"
);

ALTER TABLE "public"."user_data" OWNER TO "postgres";

ALTER TABLE ONLY "public"."books" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."journal_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."notifications" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."notifications_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."pages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."page_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."reminders" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."notification_schedules_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."book_access"
    ADD CONSTRAINT "book_access_book_id_user_id_key" UNIQUE ("book_id", "user_id");

ALTER TABLE ONLY "public"."book_access"
    ADD CONSTRAINT "book_access_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."books"
    ADD CONSTRAINT "journal_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_email_key" UNIQUE ("email");

ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "notification_schedules_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_unique_id_key" UNIQUE ("unique_id");

ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "page_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."user_data"
    ADD CONSTRAINT "user_data_pkey" PRIMARY KEY ("user_id");

CREATE INDEX "idx_book_access_book_id" ON "public"."book_access" USING "btree" ("book_id");

CREATE INDEX "idx_book_access_user_status" ON "public"."book_access" USING "btree" ("user_id", "status");

CREATE INDEX "idx_books_is_public" ON "public"."books" USING "btree" ("is_public");

CREATE UNIQUE INDEX "unique_book_page_index" ON "public"."pages" USING "btree" ("book_id", "page_index") WHERE ("archived" = false);

CREATE OR REPLACE TRIGGER "archive_notebook_data" AFTER UPDATE OF "archived" ON "public"."books" FOR EACH ROW WHEN ((("new"."archived" = true) AND ("old"."archived" IS DISTINCT FROM "new"."archived"))) EXECUTE FUNCTION "public"."archive_associated_data"();

CREATE OR REPLACE TRIGGER "generate_embeddings_on_page_update_or_insert" AFTER INSERT OR UPDATE ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "supabase_functions"."http_request"('https://qiqeyirtpstdjkkeyfss.supabase.co/functions/v1/generate_embeddings', 'POST', '{"Content-type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcWV5aXJ0cHN0ZGpra2V5ZnNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwMTkxOTc3MSwiZXhwIjoyMDE3NDk1NzcxfQ.oVHh4fcB9hiLw8pn2iIGsq5PN8_-kdwpf5GnOH6eBMU"}', '{}', '1000');

CREATE OR REPLACE TRIGGER "trigger_update_notebook_on_page_change" AFTER INSERT OR UPDATE ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_notebook_on_page_change"();

CREATE OR REPLACE TRIGGER "trigger_update_notebook_on_page_change" AFTER INSERT OR UPDATE ON "public"."reminders" FOR EACH ROW EXECUTE FUNCTION "public"."update_notebook_on_page_change"();

CREATE OR REPLACE TRIGGER "update_book_slug" BEFORE INSERT OR UPDATE OF "name" ON "public"."books" FOR EACH ROW EXECUTE FUNCTION "public"."update_slug"();

CREATE OR REPLACE TRIGGER "update_notebook_modtime" BEFORE UPDATE ON "public"."books" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();

CREATE OR REPLACE TRIGGER "update_notification_schedules_modtime" BEFORE UPDATE ON "public"."reminders" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();

CREATE OR REPLACE TRIGGER "update_notifications_modtime" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();

CREATE OR REPLACE TRIGGER "update_page_modtime" BEFORE UPDATE ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();

CREATE OR REPLACE TRIGGER "update_page_slug" BEFORE INSERT OR UPDATE OF "title" ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_slug"();

CREATE OR REPLACE TRIGGER "update_title_from_content" BEFORE INSERT OR UPDATE OF "html_content" ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."extract_title_from_content"();

CREATE OR REPLACE TRIGGER "update_user_data_modtime" BEFORE UPDATE ON "public"."user_data" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();

ALTER TABLE ONLY "public"."book_access"
    ADD CONSTRAINT "book_access_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."book_access"
    ADD CONSTRAINT "book_access_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");

ALTER TABLE ONLY "public"."book_access"
    ADD CONSTRAINT "book_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "notification_schedules_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."user_data"("user_id");

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_journal_id_fkey" FOREIGN KEY ("notebook_id") REFERENCES "public"."books"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id");

ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "public_notification_schedules_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "public_notifications_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id");

ALTER TABLE ONLY "public"."user_data"
    ADD CONSTRAINT "user_data_default_journal_fkey" FOREIGN KEY ("default_notebook") REFERENCES "public"."books"("id");

CREATE POLICY "Enable insert for authenticated users only" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (true);

CREATE POLICY "Enable insert for users based on user_id" ON "public"."leads" FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can create books" ON "public"."books" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));

CREATE POLICY "Users can delete their own book access records" ON "public"."book_access" FOR DELETE USING (("auth"."uid"() = "created_by"));

CREATE POLICY "Users can delete their own books" ON "public"."books" FOR DELETE TO "authenticated" USING (("owner_id" = "auth"."uid"()));

CREATE POLICY "Users can update their own book access records" ON "public"."book_access" FOR UPDATE USING (("auth"."uid"() = "created_by")) WITH CHECK (("auth"."uid"() = "created_by"));

CREATE POLICY "Users can update their own books" ON "public"."books" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"()));

CREATE POLICY "Users can view their own access" ON "public"."book_access" FOR SELECT TO "authenticated" USING ((("invited_email" = ("auth"."jwt"() ->> 'email'::"text")) OR ("user_id" = "auth"."uid"())));

CREATE POLICY "Users can view their own books and shared books" ON "public"."books" FOR SELECT TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR ("is_public" = true) OR (EXISTS ( SELECT 1
   FROM "public"."book_access"
  WHERE (("book_access"."book_id" = "books"."id") AND ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text")) AND ("book_access"."status" = 'accepted'::"text"))))));

ALTER TABLE "public"."book_access" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "book_access_management" ON "public"."book_access" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("created_by" = "auth"."uid"()) OR ("invited_email" = ("auth"."jwt"() ->> 'email'::"text"))));

ALTER TABLE "public"."books" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delete_notification_schedules" ON "public"."reminders" FOR DELETE USING (("auth"."uid"() = "owner_id"));

CREATE POLICY "delete_notifications" ON "public"."notifications" FOR DELETE USING (("auth"."uid"() = "owner_id"));

CREATE POLICY "delete_user_data" ON "public"."user_data" FOR DELETE USING (("auth"."uid"() = "user_id"));

CREATE POLICY "enable_delete_for_owners" ON "public"."books" FOR DELETE USING (("owner_id" = "auth"."uid"()));

CREATE POLICY "enable_insert_for_authenticated_users" ON "public"."books" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));

CREATE POLICY "enable_read_access_for_books_and_collaborators" ON "public"."books" FOR SELECT USING ((("owner_id" = "auth"."uid"()) OR ("is_public" = true) OR (EXISTS ( SELECT 1
   FROM "public"."book_access"
  WHERE (("book_access"."book_id" = "books"."id") AND ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text")))))));

CREATE POLICY "enable_update_for_owners_and_editors" ON "public"."books" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."book_access"
  WHERE (("book_access"."book_id" = "books"."id") AND ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text")) AND ("book_access"."access_level" = 'edit'::"public"."book_access_level")))));

CREATE POLICY "insert_notification_schedules" ON "public"."reminders" FOR INSERT WITH CHECK (("auth"."uid"() = "owner_id"));

CREATE POLICY "insert_user_data" ON "public"."user_data" FOR INSERT WITH CHECK (true);

ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;

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
          WHERE (("book_access"."book_id" = "books"."id") AND ("book_access"."invited_email" = ("auth"."jwt"() ->> 'email'::"text"))))) OR ((NOT "books"."archived") AND ("books"."is_public" = true)))))));

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

CREATE POLICY "select_notification_schedules" ON "public"."reminders" FOR SELECT USING (("auth"."uid"() = "owner_id"));

CREATE POLICY "select_notifications" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "owner_id"));

CREATE POLICY "select_user_data" ON "public"."user_data" FOR SELECT USING (("auth"."uid"() = "user_id"));

CREATE POLICY "update_notification_schedules" ON "public"."reminders" FOR UPDATE USING (("auth"."uid"() = "owner_id"));

CREATE POLICY "update_notifications" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "owner_id"));

CREATE POLICY "update_user_data" ON "public"."user_data" FOR UPDATE USING (("auth"."uid"() = "user_id"));

ALTER TABLE "public"."user_data" ENABLE ROW LEVEL SECURITY;

ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";

CREATE PUBLICATION "supabase_realtime_messages_publication" WITH (publish = 'insert, update, delete, truncate');

ALTER PUBLICATION "supabase_realtime_messages_publication" OWNER TO "supabase_admin";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."books";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."pages";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."reminders";

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

GRANT ALL ON FUNCTION "public"."archive_associated_data"() TO "anon";
GRANT ALL ON FUNCTION "public"."archive_associated_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_associated_data"() TO "service_role";

GRANT ALL ON FUNCTION "public"."extract_title_from_content"() TO "anon";
GRANT ALL ON FUNCTION "public"."extract_title_from_content"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_title_from_content"() TO "service_role";

GRANT ALL ON FUNCTION "public"."generate_slug"("input_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_slug"("input_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_slug"("input_text" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."highlight_search_results_in_page"("search_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."highlight_search_results_in_page"("search_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."highlight_search_results_in_page"("search_query" "text") TO "service_role";

GRANT ALL ON TABLE "public"."pages" TO "anon";
GRANT ALL ON TABLE "public"."pages" TO "authenticated";
GRANT ALL ON TABLE "public"."pages" TO "service_role";

GRANT ALL ON FUNCTION "public"."search_book_contents"("search_query" "text", "book_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_book_contents"("search_query" "text", "book_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_book_contents"("search_query" "text", "book_id" integer) TO "service_role";

GRANT ALL ON FUNCTION "public"."update_habit_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_habit_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_habit_timestamp"() TO "service_role";

GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "service_role";

GRANT ALL ON FUNCTION "public"."update_notebook_on_page_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_notebook_on_page_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_notebook_on_page_change"() TO "service_role";

GRANT ALL ON FUNCTION "public"."update_slug"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_slug"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_slug"() TO "service_role";

GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";

GRANT ALL ON TABLE "public"."book_access" TO "anon";
GRANT ALL ON TABLE "public"."book_access" TO "authenticated";
GRANT ALL ON TABLE "public"."book_access" TO "service_role";

GRANT ALL ON SEQUENCE "public"."book_access_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."book_access_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."book_access_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."books" TO "anon";
GRANT ALL ON TABLE "public"."books" TO "authenticated";
GRANT ALL ON TABLE "public"."books" TO "service_role";

GRANT ALL ON SEQUENCE "public"."journal_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."journal_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."journal_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";

GRANT ALL ON SEQUENCE "public"."leads_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."leads_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."leads_id_seq" TO "service_role";

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

GRANT ALL ON SEQUENCE "public"."page_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."page_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."page_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."user_data" TO "anon";
GRANT ALL ON TABLE "public"."user_data" TO "authenticated";
GRANT ALL ON TABLE "public"."user_data" TO "service_role";

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

RESET ALL;
