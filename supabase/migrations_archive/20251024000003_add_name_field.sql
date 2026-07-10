-- Add name field to user_data table
ALTER TABLE user_data
ADD COLUMN IF NOT EXISTS name TEXT;

-- Update existing users to use their Google name if available
-- This will need to be done via the application or manually

-- Drop and recreate public_user_profiles view to include name and remove email
DROP VIEW IF EXISTS public_user_profiles;

CREATE VIEW public_user_profiles AS
SELECT
  user_id,
  name,
  username,
  profile_pic,
  intro,
  created_at
FROM user_data
WHERE username IS NOT NULL;

-- Grant select permission on the view
GRANT SELECT ON public_user_profiles TO authenticated, anon;
