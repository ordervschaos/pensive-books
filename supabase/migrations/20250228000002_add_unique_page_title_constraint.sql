-- Add unique constraint for page titles within a book
-- This ensures [[page title]] links can uniquely identify pages within a book's context

-- Step 1: Handle duplicate pages by adding a numeric suffix
-- This ensures all pages have unique titles before we add the constraint
DO $$
DECLARE
  duplicate_record RECORD;
  page_to_rename RECORD;
  counter INTEGER;
  new_title TEXT;
  current_book_id INTEGER;
  current_title TEXT;
BEGIN
  -- For each book-title combination that has duplicates
  FOR duplicate_record IN (
    SELECT book_id, title
    FROM pages
    WHERE archived = false AND title IS NOT NULL AND title != ''
    GROUP BY book_id, title
    HAVING COUNT(*) > 1
  )
  LOOP
    counter := 2;
    current_book_id := duplicate_record.book_id;
    current_title := duplicate_record.title;

    -- For each duplicate page (except the first one), add a numeric suffix
    FOR page_to_rename IN (
      SELECT id
      FROM pages
      WHERE book_id = current_book_id
        AND title = current_title
        AND archived = false
      ORDER BY created_at
      OFFSET 1  -- Keep the first one as-is, rename the rest
    )
    LOOP
      new_title := current_title || ' (' || counter || ')';

      -- Make sure the new title doesn't already exist
      WHILE EXISTS (
        SELECT 1 FROM pages
        WHERE book_id = current_book_id
          AND title = new_title
          AND archived = false
      ) LOOP
        counter := counter + 1;
        new_title := current_title || ' (' || counter || ')';
      END LOOP;

      -- Update the page with the new unique title
      UPDATE pages
      SET title = new_title
      WHERE id = page_to_rename.id;

      counter := counter + 1;
    END LOOP;
  END LOOP;
END $$;

-- Step 2: Now add the unique index on book_id and title for non-archived pages
CREATE UNIQUE INDEX IF NOT EXISTS "unique_book_page_title"
ON "public"."pages"
USING "btree" ("book_id", "title")
WHERE ("archived" = false AND "title" IS NOT NULL AND "title" != '');

-- Add a comment explaining the constraint
COMMENT ON INDEX "public"."unique_book_page_title" IS 'Ensures page titles are unique within a book context for wiki-link functionality [[page title]]';
