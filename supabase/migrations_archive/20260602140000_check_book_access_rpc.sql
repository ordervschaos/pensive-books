-- Single server-side function that resolves all access tiers for a book.
-- Returns has_access / can_edit / is_owner so no admin logic lives in the client.
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

  -- 3. Admin check (kept server-side — invisible to client)
  IF EXISTS (SELECT 1 FROM admin_users WHERE user_id = v_user_id) THEN
    RETURN jsonb_build_object('has_access', true, 'can_edit', false, 'is_owner', false);
  END IF;

  RETURN jsonb_build_object('has_access', false, 'can_edit', false, 'is_owner', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_book_access(int) TO authenticated;
