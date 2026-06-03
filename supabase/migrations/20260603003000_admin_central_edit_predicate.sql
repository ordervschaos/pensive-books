-- Centralize admin = owner-equivalent access for feature tables.
--
-- user_can_edit_book(_book_id) is the shared RLS predicate behind every book-scoped
-- feature table (book_evaluations, book_revisions, book_threads, book_thread_scans,
-- and the documented pattern for future ones). Folding the admin check in here makes
-- admins owner-equivalent across all of them at once — and any table added later that
-- reuses this helper inherits it for free — instead of one admins_can_* policy per
-- table.
--
-- Note: pages / book_access / books don't use this helper (inline predicates), so they
-- keep their own explicit admin policies from 20260520000000 / 20260603000000.
CREATE OR REPLACE FUNCTION public.user_can_edit_book(_book_id integer)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
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

-- Now redundant: the central predicate above already grants admins on book_evaluations.
DROP POLICY IF EXISTS "admins_can_access_any_evaluation" ON public.book_evaluations;
