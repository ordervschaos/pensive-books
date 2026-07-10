-- Drop the redundant `update_books` policy. It is the last remaining books
-- policy with a direct `EXISTS book_access` subquery, which causes RLS
-- recursion through `Book owners can manage access` on book_access.
--
-- Functionality is preserved by other policies:
--  - Owners: `Users can update own books`, `Users can update their own books`
--  - Editors (access_level='edit', status='accepted'): handled below
--  - Admins: `admins_can_update_any_book`

-- Tighten the editor helper to also require status='accepted', matching the
-- original `update_books` semantics.
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
      AND book_access.status = 'accepted'
  );
$$;

DROP POLICY IF EXISTS "update_books" ON public.books;
