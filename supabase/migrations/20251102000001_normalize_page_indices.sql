-- Normalize page indices to fix existing gaps
-- This is a one-time migration to clean up any existing index gaps

-- Function to normalize page indices for a single book
CREATE OR REPLACE FUNCTION normalize_book_page_indices(p_book_id INTEGER)
RETURNS void AS $$
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
$$ LANGUAGE plpgsql;

-- Run normalization for all books
DO $$
DECLARE
  book_record RECORD;
  total_books INTEGER;
  processed INTEGER := 0;
BEGIN
  -- Count total books
  SELECT COUNT(DISTINCT id) INTO total_books FROM books;

  -- Process each book
  FOR book_record IN
    SELECT DISTINCT id FROM books
    ORDER BY id
  LOOP
    PERFORM normalize_book_page_indices(book_record.id);
    processed := processed + 1;

    -- Log progress every 100 books
    IF processed % 100 = 0 THEN
      RAISE NOTICE 'Normalized % of % books', processed, total_books;
    END IF;
  END LOOP;

  RAISE NOTICE 'Completed: Normalized page indices for % books', total_books;
END $$;

-- The function can be kept for future manual use if needed
-- To manually normalize a specific book: SELECT normalize_book_page_indices(book_id);
