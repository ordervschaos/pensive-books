-- Fix create_next_page to exclude archived pages from MAX calculation
-- This prevents page index gaps when creating pages after deletions

CREATE OR REPLACE FUNCTION create_next_page(p_book_id INTEGER)
RETURNS TABLE (
  id INTEGER,
  book_id INTEGER,
  page_index INTEGER,
  content JSONB,
  html_content TEXT,
  page_type TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
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
$$ LANGUAGE plpgsql;
