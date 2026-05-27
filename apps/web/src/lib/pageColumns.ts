// Columns selected on the reader/editor page-fetch paths. Deliberately EXCLUDES the
// author-only `metadata` column (page objectives) so it never reaches readers — the same
// protection the books select applies to `brief`. Author-only code (the page objective
// bar, the TOC) fetches `metadata` separately, gated by edit permission.
//
// Keep this list complete (every pages column except `metadata`) so swapping it in for
// `select('*')` changes nothing for readers beyond dropping `metadata`.
export const READER_PAGE_COLUMNS =
  'id, owner_id, book_id, old_content, created_at, updated_at, archived, last_published_at, page_index, content, html_content, title, page_type, slug, is_draft';
