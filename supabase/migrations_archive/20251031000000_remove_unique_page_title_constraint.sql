-- Remove unique constraint for page titles within a book
-- This allows pages to have duplicate titles within the same book

DROP INDEX IF EXISTS "public"."unique_book_page_title";
