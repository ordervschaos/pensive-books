-- Admin stats RPC for /admin dashboard
-- Returns aggregate totals + per-book breakdown. Admins only.
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'total_books',  (SELECT count(*) FROM books WHERE NOT is_archived),
    'total_pages',  (SELECT count(*) FROM pages WHERE archived = false OR archived IS NULL),
    'total_users',  (SELECT count(*) FROM user_data),
    'books', (
      SELECT COALESCE(jsonb_agg(b ORDER BY b.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT
          bk.id,
          bk.name,
          bk.slug,
          bk.owner_id,
          bk.created_at,
          bk.is_public,
          bk.published_at,
          bk.is_archived,
          ud.email        AS owner_email,
          ud.username     AS owner_username,
          (SELECT count(*) FROM pages p WHERE p.book_id = bk.id AND (p.archived = false OR p.archived IS NULL))::int AS page_count
        FROM books bk
        LEFT JOIN user_data ud ON ud.user_id = bk.owner_id
        WHERE NOT bk.is_archived
      ) b
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;
