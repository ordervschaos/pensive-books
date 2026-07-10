-- Give admins SELECT access on any book and any page, so they can browse
-- other users' shelves and book pages to apply content tags.

CREATE POLICY "admins_can_read_any_book"
  ON public.books
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

CREATE POLICY "admins_can_read_any_page"
  ON public.pages
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));
