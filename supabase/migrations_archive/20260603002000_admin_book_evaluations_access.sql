-- book_evaluations has owner/editor-only RLS (user_can_edit_book), so admins with
-- the full owner view still couldn't read or run a book's "editor's read". Extend
-- the full-owner-powers treatment here too: admins can read and run evaluations on
-- any book. FOR ALL covers SELECT (initial load + Realtime) and INSERT/UPDATE
-- (running an eval). Permissive — OR's with the existing editor policies.
DROP POLICY IF EXISTS "admins_can_access_any_evaluation" ON public.book_evaluations;
CREATE POLICY "admins_can_access_any_evaluation"
  ON public.book_evaluations
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));
