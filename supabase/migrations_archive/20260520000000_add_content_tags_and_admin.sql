-- Add content tagging system

-- 1. content_tags column on books
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS content_tags text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_books_content_tags
  ON public.books USING gin(content_tags);

-- 2. Admin users table (read-only from client; only service_role can insert)
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read admin_users (to check their own status)
CREATE POLICY "admin_users_readable"
  ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (true);

-- No insert/update/delete policies for authenticated → only service_role can modify

-- 3. mature_content_enabled on user_data (nullable: null = not set, use local fallback)
ALTER TABLE public.user_data
  ADD COLUMN IF NOT EXISTS mature_content_enabled boolean DEFAULT NULL;

-- 4. Allow admins to update any book's content_tags (and other fields)
CREATE POLICY "admins_can_update_any_book"
  ON public.books
  FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));
