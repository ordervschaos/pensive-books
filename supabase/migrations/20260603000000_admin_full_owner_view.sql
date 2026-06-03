-- Give admins the *full owner view* of any book, not the stripped reader view.
--
-- 1. check_book_access: the admin branch now reports can_edit + is_owner = true,
--    so the client renders the complete owner workspace (brief, AI tabs, edit /
--    publish actions) and bypasses the mature-content gate, exactly like the owner.
-- 2. RLS: admins already had SELECT on any page and UPDATE on any book. To let the
--    owner workspace actually persist, grant admins write access to any page and
--    full management of any book's collaborators (book_access).

-- 1. Admin branch of the access resolver → owner-equivalent.
CREATE OR REPLACE FUNCTION public.check_book_access(p_book_id int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_owner_id uuid;
  v_access_level text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('has_access', false, 'can_edit', false, 'is_owner', false);
  END IF;

  -- 1. Owner check
  SELECT owner_id INTO v_owner_id FROM books WHERE id = p_book_id;

  IF v_owner_id = v_user_id THEN
    RETURN jsonb_build_object('has_access', true, 'can_edit', true, 'is_owner', true);
  END IF;

  -- 2. Collaborator check
  SELECT access_level INTO v_access_level
  FROM book_access
  WHERE book_id = p_book_id
    AND invited_email = (SELECT email FROM auth.users WHERE id = v_user_id)
  LIMIT 1;

  IF v_access_level IS NOT NULL THEN
    RETURN jsonb_build_object(
      'has_access', true,
      'can_edit',   v_access_level = 'edit',
      'is_owner',   false
    );
  END IF;

  -- 3. Admin check → full owner view (can edit any book, bypasses mature gate).
  IF EXISTS (SELECT 1 FROM admin_users WHERE user_id = v_user_id) THEN
    RETURN jsonb_build_object('has_access', true, 'can_edit', true, 'is_owner', true);
  END IF;

  RETURN jsonb_build_object('has_access', false, 'can_edit', false, 'is_owner', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_book_access(int) TO authenticated;

-- 2. Admins can write (insert / update / delete) any page.
DROP POLICY IF EXISTS "admins_can_write_any_page" ON public.pages;
CREATE POLICY "admins_can_write_any_page"
  ON public.pages
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

-- 3. Admins can manage any book's collaborators.
DROP POLICY IF EXISTS "admins_can_manage_any_book_access" ON public.book_access;
CREATE POLICY "admins_can_manage_any_book_access"
  ON public.book_access
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));
