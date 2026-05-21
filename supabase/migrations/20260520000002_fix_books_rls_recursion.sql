-- Fix infinite recursion in books RLS policies.
--
-- The recursion path: books policies query book_access; book_access policies
-- query books; → loop. Triggered for the first time when an admin updates a
-- book they don't own.
--
-- Fix: route the cross-table lookups through SECURITY DEFINER functions that
-- bypass RLS on the inner read. Original policy semantics are preserved.

CREATE OR REPLACE FUNCTION public.user_has_book_access_accepted(_book_id integer)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.book_access
    WHERE book_access.book_id = _book_id
      AND book_access.invited_email = (auth.jwt() ->> 'email')
      AND book_access.status = 'accepted'
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_book_access_any_status(_book_id integer)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.book_access
    WHERE book_access.book_id = _book_id
      AND book_access.invited_email = (auth.jwt() ->> 'email')
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_book_editor(_book_id integer)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.book_access
    WHERE book_access.book_id = _book_id
      AND book_access.invited_email = (auth.jwt() ->> 'email')
      AND book_access.access_level = 'edit'
  );
$$;

-- Drop and recreate the three offending policies with identical semantics.

DROP POLICY IF EXISTS "Users can view their own books and shared books" ON public.books;
CREATE POLICY "Users can view their own books and shared books"
  ON public.books
  FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR is_public = true
    OR public.user_has_book_access_accepted(id)
  );

DROP POLICY IF EXISTS "enable_read_access_for_books_and_collaborators" ON public.books;
CREATE POLICY "enable_read_access_for_books_and_collaborators"
  ON public.books
  FOR SELECT
  USING (
    owner_id = auth.uid()
    OR is_public = true
    OR public.user_has_book_access_any_status(id)
  );

DROP POLICY IF EXISTS "enable_update_for_owners_and_editors" ON public.books;
CREATE POLICY "enable_update_for_owners_and_editors"
  ON public.books
  FOR UPDATE
  TO authenticated
  USING (public.user_is_book_editor(id));
