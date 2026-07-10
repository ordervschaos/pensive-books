-- Add profile_pic and intro fields to user_data table
ALTER TABLE user_data
ADD COLUMN IF NOT EXISTS profile_pic TEXT,
ADD COLUMN IF NOT EXISTS intro TEXT;

-- Drop and recreate the view to avoid column order issues
DROP VIEW IF EXISTS public_user_profiles;

CREATE VIEW public_user_profiles AS
SELECT
  user_id,
  username,
  email,
  profile_pic,
  intro,
  created_at
FROM user_data
WHERE username IS NOT NULL;

-- Grant select permission on the view
GRANT SELECT ON public_user_profiles TO authenticated, anon;
