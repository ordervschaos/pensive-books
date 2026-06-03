-- Surface that access was granted via the admin override, so the client can show
-- an "admin view" banner. Admins still report is_owner/can_edit = true (full owner
-- workspace), but `via_admin` lets the UI distinguish them from the real owner and
-- name whose book they're editing (`owner_label`, mirroring get_admin_stats).
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
  v_owner_label text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('has_access', false, 'can_edit', false, 'is_owner', false, 'via_admin', false);
  END IF;

  -- 1. Owner check
  SELECT owner_id INTO v_owner_id FROM books WHERE id = p_book_id;

  IF v_owner_id = v_user_id THEN
    RETURN jsonb_build_object('has_access', true, 'can_edit', true, 'is_owner', true, 'via_admin', false);
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
      'is_owner',   false,
      'via_admin',  false
    );
  END IF;

  -- 3. Admin check → full owner view, flagged as an admin override.
  IF EXISTS (SELECT 1 FROM admin_users WHERE user_id = v_user_id) THEN
    SELECT COALESCE(ud.username, ud.email)
      INTO v_owner_label
      FROM user_data ud
     WHERE ud.user_id = v_owner_id;

    RETURN jsonb_build_object(
      'has_access',  true,
      'can_edit',    true,
      'is_owner',    true,
      'via_admin',   true,
      'owner_label', v_owner_label
    );
  END IF;

  RETURN jsonb_build_object('has_access', false, 'can_edit', false, 'is_owner', false, 'via_admin', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_book_access(int) TO authenticated;
